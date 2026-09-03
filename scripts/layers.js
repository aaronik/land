'use strict';

const SISKIYOU_BBOX = '-123.73,40.98,-121.43,42.02';
const SOIL_WFS = 'https://SDMDataAccess.sc.egov.usda.gov/Spatial/SDMWGS84Geographic.wfs';
const SOIL_FIELDS = ['areasymbol', 'musym', 'nationalmusym', 'mukey', 'muname', 'slopegraddcp', 'brockdepmin', 'wtdepannmin', 'flodfreqdcd', 'drclassdcd', 'hydgrpdcd', 'engdwobdcd'];

function normalizeApn(value) {
  const match = String(value || '').match(/(\d{3})\D?(\d{3})\D?([A-Z0-9]{3,})/i);
  return match ? `${match[1]}-${match[2]}-${match[3].toUpperCase()}` : '';
}

function listingConfidence({ source, listedAcres, gisAcres }) {
  if (!source) return 'unmatched';
  if (/listing APN|override/i.test(source)) return 'provided';
  if (!(listedAcres > 0) || !(gisAcres > 0)) return 'coordinate_match';
  const ratio = listedAcres / gisAcres;
  if (ratio >= 0.75 && ratio <= 1.25) return 'probable';
  if (ratio > 1.25) return 'possible_multi_parcel';
  return 'ambiguous';
}

async function defaultRequest(url, params) {
  const response = await fetch(`${url}/query?${new URLSearchParams(params)}`);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  const data = await response.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  return data;
}

async function fetchArcGISLayer(config, request = params => defaultRequest(config.url, params)) {
  const spatial = config.bbox ? {
    geometry: config.bbox,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects'
  } : {};
  const countData = await request({ f: 'json', where: config.where || '1=1', returnCountOnly: 'true', ...spatial });
  const expected = Number(countData.count || 0);
  const pageSize = config.pageSize || 2000;
  const features = [];
  while (features.length < expected) {
    const data = await request({
      f: 'geojson', where: config.where || '1=1', outFields: config.fields.join(','), returnGeometry: 'true',
      outSR: '4326', orderByFields: `${config.objectId || 'OBJECTID'} ASC`, resultOffset: features.length,
      resultRecordCount: pageSize, ...(config.maxAllowableOffset ? { maxAllowableOffset: config.maxAllowableOffset, geometryPrecision: config.geometryPrecision || 6 } : {}), ...spatial
    });
    const batch = data.features || [];
    features.push(...batch);
    if (!batch.length) break;
  }
  if (features.length !== expected) throw new Error(`${config.name || 'layer'} incomplete: collected ${features.length} of ${expected}`);
  return { type: 'FeatureCollection', features };
}

function decodeXml(value) {
  return String(value || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function parseSoilGml(xml, fields = SOIL_FIELDS) {
  const features = [];
  for (const member of xml.matchAll(/<gml:featureMember>([\s\S]*?)<\/gml:featureMember>/g)) {
    const body = member[1];
    const fid = body.match(/\bfid="([^"]+)"/)?.[1] || '';
    const polygons = [];
    for (const polygonMatch of body.matchAll(/<gml:Polygon>([\s\S]*?)<\/gml:Polygon>/g)) {
      const rings = [];
      for (const ringMatch of polygonMatch[1].matchAll(/<gml:(?:outer|inner)BoundaryIs>[\s\S]*?<gml:coordinates>([\s\S]*?)<\/gml:coordinates>[\s\S]*?<\/gml:(?:outer|inner)BoundaryIs>/g)) {
        // This NRCS WFS advertises EPSG:4326 axis order and emits latitude,longitude.
        const ring = ringMatch[1].trim().split(/\s+/).map(pair => pair.split(',').map(Number)).filter(pair => pair.length >= 2 && pair.every(Number.isFinite)).map(([lat, lon]) => [lon, lat]);
        if (ring.length >= 4) rings.push(ring);
      }
      if (rings.length) polygons.push(rings);
    }
    if (!polygons.length) continue;
    const properties = {};
    for (const field of fields) properties[field] = decodeXml(body.match(new RegExp(`<ms:${field}>([\\s\\S]*?)<\\/ms:${field}>`))?.[1]?.trim() || '');
    properties.fid = fid;
    features.push({
      type: 'Feature', properties,
      geometry: polygons.length === 1 ? { type: 'Polygon', coordinates: polygons[0] } : { type: 'MultiPolygon', coordinates: polygons }
    });
  }
  return features;
}

async function fetchSoilLayer(config, request = fetch) {
  const [west, south, east, north] = config.bbox.split(',').map(Number);
  const step = 0.25;
  const features = new Map();
  for (let y = south; y < north; y += step) for (let x = west; x < east; x += step) {
    const params = new URLSearchParams({
      service: 'WFS', version: '1.1.0', request: 'GetFeature', typeName: config.typeName,
      bbox: `${x},${y},${Math.min(x + step, east)},${Math.min(y + step, north)}`
    });
    const response = await request(`${config.url}?${params}`);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${config.name}`);
    const batch = parseSoilGml(await response.text(), config.fields);
    for (const feature of batch) features.set(feature.properties.fid || feature.properties.mupolygonkey, feature);
  }
  return { type: 'FeatureCollection', features: [...features.values()] };
}

const LAYERS = {
  parcels: {
    name: 'Siskiyou County parcels',
    url: 'https://services3.arcgis.com/JmPiYilyU1x5zuxM/arcgis/rest/services/Siskiyou_Parcels_Public/FeatureServer/0',
    fields: ['OBJECTID', 'APN', 'Asmt', 'Acres', 'LandUse1', 'FeeParcel', 'TRA', 'NeighborhoodCode', 'Section', 'Township', 'Range', 'TimberPreserve', 'AgPreserve']
  },
  zoning: {
    name: 'Siskiyou County zoning',
    url: 'https://services3.arcgis.com/JmPiYilyU1x5zuxM/arcgis/rest/services/CDD_Zoning_Districts_Public/FeatureServer/0',
    fields: ['OBJECTID', 'zoning', 'zoneclass']
  },
  roads: {
    name: 'Siskiyou County roads',
    url: 'https://services3.arcgis.com/JmPiYilyU1x5zuxM/arcgis/rest/services/Roads_Public/FeatureServer/0',
    objectId: 'FID', fields: ['FID', 'ROADNAME', 'NUM_LANES', 'SUR_TYPE', 'Label_Cate']
  },
  forest_roads: {
    name: 'USFS Motor Vehicle Use Map roads',
    url: 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_01/MapServer/1',
    objectId: 'objectid',
    bbox: SISKIYOU_BBOX,
    // These are the Forest Service System-road symbols; the MVUM service also
    // carries local roads for reference, which belong in the county road layer.
    where: "symbol IN ('1','2','3','4','11','12')",
    fields: ['objectid', 'id', 'name', 'field_id', 'symbol', 'mvum_symbol_name', 'jurisdiction', 'operationalmaintlevel', 'surfacetype', 'seasonal', 'passengervehicle', 'highclearancevehicle', 'forestname', 'districtname', 'routestatus']
  },
  railroads: {
    name: 'USDOT/FRA active rail network',
    url: 'https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services/NTAD_North_American_Rail_Network_Lines/FeatureServer/0',
    bbox: SISKIYOU_BBOX,
    // NARN NET codes A/R/T/X are normally abandoned, removed, trail, or out of
    // service. FRA still marks the reactivated McCloud Railway (MCR) as X, so
    // retain that known-active corridor; F is a ferry connection rather than track.
    where: "NET IN ('M','I','O','S','Y','Z') OR (NET = 'X' AND RROWNER1 = 'MCR')",
    fields: ['OBJECTID', 'FRAARCID', 'RROWNER1', 'RROWNER2', 'RROWNER3', 'DIVISION', 'SUBDIV', 'BRANCH', 'YARDNAME', 'PASSNGR', 'TRACKS', 'NET']
  },
  waterways: {
    name: 'USGS NHD rivers and streams',
    url: 'https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/6',
    bbox: SISKIYOU_BBOX,
    where: 'ftype = 460',
    maxAllowableOffset: 0.00001,
    geometryPrecision: 6,
    fields: ['OBJECTID', 'permanent_identifier', 'gnis_name', 'lengthkm', 'reachcode', 'fcode', 'visibilityfilter']
  },
  waterbodies: {
    name: 'USGS NHD lakes and reservoirs',
    url: 'https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/12',
    bbox: SISKIYOU_BBOX,
    where: 'FTYPE IN (390, 436)',
    maxAllowableOffset: 0.00001,
    geometryPrecision: 6,
    fields: ['OBJECTID', 'PERMANENT_IDENTIFIER', 'GNIS_NAME', 'AREASQKM', 'REACHCODE', 'FTYPE', 'FCODE', 'VISIBILITYFILTER']
  },
  summits: {
    name: 'USGS GNIS mountains and summits',
    url: 'https://carto.nationalmap.gov/arcgis/rest/services/geonames/MapServer/5',
    bbox: SISKIYOU_BBOX,
    where: "gaz_featureclass = 'Summit'",
    fields: ['OBJECTID', 'gaz_id', 'gaz_name', 'gaz_featureclass', 'fcode', 'state_alpha', 'county_name']
  },
  towns: {
    name: 'USGS GNIS populated places',
    url: 'https://carto.nationalmap.gov/arcgis/rest/services/geonames/MapServer/3',
    bbox: SISKIYOU_BBOX,
    fields: ['OBJECTID', 'gaz_id', 'gaz_name', 'gaz_featureclass', 'fcode', 'state_alpha', 'county_name']
  },
  springs: {
    name: 'USGS NHD springs',
    url: 'https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/0',
    bbox: SISKIYOU_BBOX,
    where: 'FTYPE = 458',
    fields: ['OBJECTID', 'PERMANENT_IDENTIFIER', 'GNIS_NAME', 'FTYPE', 'FCODE']
  },
  geology: {
    name: 'USGS State Geologic Map Compilation surface geology',
    type: 'usgs-geology-wfs',
    url: 'https://mrdata.usgs.gov/services/wfs/sgmc2',
    bbox: SISKIYOU_BBOX,
    fields: ['state', 'orig_label', 'sgmc_label', 'unit_link', 'material_class', 'unit_name', 'unit_age', 'unit_description', 'lithology']
  },
  fire_hazard: {
    name: 'Siskiyou County fire hazard severity',
    url: 'https://services3.arcgis.com/JmPiYilyU1x5zuxM/arcgis/rest/services/FireHazardSeverity_Public/FeatureServer/0',
    objectId: 'FID', fields: ['FID', 'HAZ_CODE', 'HAZ_CLASS', 'RESP']
  },
  wildfire_perimeters: {
    name: 'Siskiyou County historic wildfire perimeters',
    url: 'https://services3.arcgis.com/JmPiYilyU1x5zuxM/arcgis/rest/services/HistoricFirePerimeters_Public/FeatureServer/0',
    objectId: 'FID',
    bbox: SISKIYOU_BBOX,
    where: "YEAR_ >= '1900' AND YEAR_ < '2019'",
    fields: ['FID', 'YEAR_', 'AGENCY', 'UNIT_ID', 'FIRE_NAME', 'ALARM_DATE', 'CONT_DATE', 'REPORT_AC', 'GIS_ACRES']
  },
  recent_wildfire_perimeters: {
    name: 'Siskiyou County recent wildfire perimeters',
    url: 'https://services3.arcgis.com/JmPiYilyU1x5zuxM/arcgis/rest/services/Siskiyou_Fire_Perimeters_2019_to_2025/FeatureServer/329',
    bbox: SISKIYOU_BBOX,
    fields: ['OBJECTID', 'YEAR_', 'AGENCY', 'UNIT_ID', 'FIRE_NAME', 'INC_NUM', 'ALARM_DATE', 'CONT_DATE', 'CAUSE', 'GIS_ACRES', 'IRWINID']
  },
  public_land: {
    name: 'PAD-US federal fee managers',
    url: 'https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Federal_Fee_Managers_Authoritative_PADUS/FeatureServer/0',
    bbox: SISKIYOU_BBOX,
    fields: ['OBJECTID', 'Own_Name', 'Own_Type', 'Mang_Name', 'Mang_Type', 'Unit_Nm', 'Pub_Access', 'GIS_Acres']
  },
  flood: {
    name: 'FEMA NFHL flood hazard zones',
    url: 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28',
    bbox: SISKIYOU_BBOX,
    pageSize: 500,
    maxAllowableOffset: 0.00005,
    geometryPrecision: 6,
    fields: ['OBJECTID', 'FLD_ZONE', 'ZONE_SUBTY', 'SFHA_TF', 'STATIC_BFE', 'DEPTH', 'VELOCITY']
  },
  soils: {
    name: 'USDA NRCS SSURGO soil map units',
    type: 'wfs-gml',
    url: SOIL_WFS,
    bbox: SISKIYOU_BBOX,
    typeName: 'mapunitpolyextended',
    fields: SOIL_FIELDS
  },
  farmland: {
    name: 'California Important Farmland (FMMP)',
    url: 'https://gis.conservation.ca.gov/server/rest/services/DLRP/CaliforniaImportantFarmland_mostrecent/MapServer/0',
    bbox: SISKIYOU_BBOX,
    fields: ['OBJECTID', 'county_nam', 'upd_year', 'polygon_ac', 'polygon_ty']
  },
  rcra_sites: {
    name: 'EPA RCRA hazardous waste handlers',
    url: 'https://services.arcgis.com/cJ9YHowT8TU7DUyn/ArcGIS/rest/services/RCRA_Handlers/FeatureServer/3',
    bbox: SISKIYOU_BBOX,
    fields: ['OBJECTID', 'HANDLER_ID', 'HANDLER_NAME', 'LOCATION_ADDRESS', 'FEDERAL_GENERATOR_STATUS', 'OPERATING_TSDF', 'OPERATING_TSDF_DESC', 'IS_CA', 'PERMITTED_STATUS', 'TSDF_YES_NO']
  },
  huc12: {
    name: 'USGS HUC-12 subwatersheds',
    url: 'https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6',
    bbox: SISKIYOU_BBOX,
    objectId: 'objectid',
    maxAllowableOffset: 0.00002,
    geometryPrecision: 6,
    fields: ['objectid', 'huc12', 'name', 'hutype', 'humod', 'tohuc', 'areaacres', 'areasqkm', 'states']
  },
  wetlands: {
    name: 'USFWS National Wetlands Inventory',
    url: 'https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0',
    bbox: SISKIYOU_BBOX,
    where: 'Wetlands.OBJECTID > 0',
    objectId: 'Wetlands.OBJECTID', fields: ['OBJECTID', 'ATTRIBUTE', 'WETLAND_TYPE', 'ACRES']
  },
  critical_habitat_final: {
    name: 'USFWS final critical habitat',
    url: 'https://services.arcgis.com/QVENGdaPbd4LUkLV/ArcGIS/rest/services/USFWS_Critical_Habitat/FeatureServer/0',
    bbox: SISKIYOU_BBOX,
    fields: ['OBJECTID', 'comname', 'sciname', 'unit', 'subunit', 'unitname', 'subunitname', 'status', 'fedreg', 'pubdate', 'effectdate', 'listing_status']
  },
  critical_habitat_proposed: {
    name: 'USFWS proposed critical habitat',
    url: 'https://services.arcgis.com/QVENGdaPbd4LUkLV/ArcGIS/rest/services/USFWS_Critical_Habitat/FeatureServer/2',
    bbox: SISKIYOU_BBOX,
    fields: ['OBJECTID', 'comname', 'sciname', 'unit', 'subunit', 'unitname', 'subunitname', 'status', 'fedreg', 'pubdate', 'effectdate', 'listing_status']
  },
  cell_att: {
    name: 'AT&T 4G LTE coverage',
    url: 'https://services3.arcgis.com/JmPiYilyU1x5zuxM/arcgis/rest/services/ATT_4G_LTE/FeatureServer/17',
    fields: ['OBJECTID', 'brandname', 'technology', 'mindown', 'minup', 'minsignal']
  },
  cell_tmobile: {
    name: 'T-Mobile 4G LTE coverage',
    url: 'https://services3.arcgis.com/JmPiYilyU1x5zuxM/arcgis/rest/services/T_Mobile_4G_LTE/FeatureServer/21',
    fields: ['OBJECTID', 'brandname', 'technology', 'mindown', 'minup', 'minsignal']
  },
  cell_verizon: {
    name: 'Verizon 4G LTE coverage',
    url: 'https://services3.arcgis.com/JmPiYilyU1x5zuxM/arcgis/rest/services/Verizon_4G_LTE/FeatureServer/22',
    fields: ['OBJECTID', 'brandname', 'technology', 'mindown', 'minup', 'minsignal']
  },
  pct: {
    name: 'Pacific Crest Trail',
    url: 'https://services3.arcgis.com/JmPiYilyU1x5zuxM/arcgis/rest/services/Siskiyou_Pacific_Crest_Trail/FeatureServer/168',
    fields: ['OBJECTID', 'OWNERNAME', 'OWNERTYPE', 'DESIGNATIO', 'MANAGEMENT', 'REV_DATE']
  },
  pct_markers: {
    name: 'Pacific Crest Trail mile markers',
    url: 'https://services3.arcgis.com/JmPiYilyU1x5zuxM/arcgis/rest/services/Siskiyou_Pacific_Crest_Trail_Markers/FeatureServer/225',
    fields: ['OBJECTID', 'Mile', 'Mile_SoBo', 'RouteID']
  },
  groundwater_basins: {
    name: 'DWR Bulletin 118 groundwater basins',
    url: 'https://utility.arcgis.com/usrsvcs/servers/49807a1fbc584631bdf88d9ca71dd083/rest/services/Geoscientific/i08_B118_CA_GroundwaterBasins/MapServer/0',
    bbox: SISKIYOU_BBOX,
    fields: ['OBJECTID', 'Basin_Number', 'Basin_Subbasin_Number', 'Basin_Name', 'Basin_Subbasin_Name', 'Region_Office', 'Date_Data_Applies_To', 'Area_Acres', 'Area_SqMiles']
  },
  groundwater_wells: {
    name: 'DWR well completion reports',
    url: 'https://utility.arcgis.com/usrsvcs/servers/c074ca40fd684e41babd776eebefd009/rest/services/Environment/i07_WellCompletionReports/MapServer/0',
    where: "CountyName = 'Siskiyou'",
    pageSize: 1000,
    fields: ['OBJECTID', 'WCRNumber', 'CountyName', 'PlannedUseFormerUse', 'RecordType', 'PermitDate', 'DateWorkEnded', 'TotalDrillDepth', 'TotalCompletedDepth', 'StaticWaterLevel', 'WellYield', 'WellYieldUnitofMeasure', 'TestType', 'PumpTestLength', 'MethodofDeterminationLL', 'LLAccuracy', 'WCRLinks', 'NearbyReportCount', 'NearbyMedianDepthFt', 'NearbyStaticLevelMinFt', 'NearbyStaticLevelMaxFt', 'NearbyYieldMinGpm', 'NearbyYieldMaxGpm', 'NearbyNewestDate']
  }
};

module.exports = { fetchArcGISLayer, fetchSoilLayer, parseSoilGml, LAYERS, listingConfidence, normalizeApn };
