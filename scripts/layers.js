'use strict';

const SISKIYOU_BBOX = '-123.73,40.98,-121.43,42.02';

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
      resultRecordCount: pageSize, ...spatial
    });
    const batch = data.features || [];
    features.push(...batch);
    if (!batch.length) break;
  }
  if (features.length !== expected) throw new Error(`${config.name || 'layer'} incomplete: collected ${features.length} of ${expected}`);
  return { type: 'FeatureCollection', features };
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
  fire_hazard: {
    name: 'Siskiyou County fire hazard severity',
    url: 'https://services3.arcgis.com/JmPiYilyU1x5zuxM/arcgis/rest/services/FireHazardSeverity_Public/FeatureServer/0',
    objectId: 'FID', fields: ['FID', 'HAZ_CODE', 'HAZ_CLASS', 'RESP']
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
    fields: ['OBJECTID', 'FLD_ZONE', 'ZONE_SUBTY', 'SFHA_TF', 'STATIC_BFE', 'DEPTH', 'VELOCITY']
  },
  wetlands: {
    name: 'USFWS National Wetlands Inventory',
    url: 'https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0',
    bbox: SISKIYOU_BBOX,
    objectId: 'OBJECTID', fields: ['OBJECTID', 'ATTRIBUTE', 'WETLAND_TYPE', 'ACRES']
  }
};

module.exports = { fetchArcGISLayer, LAYERS, listingConfidence, normalizeApn };
