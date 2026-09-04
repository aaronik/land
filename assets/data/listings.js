'use strict';

export function createListingData(getState) {
  const state = () => getState();
  const compactNumber = value => {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return '';
    return new Intl.NumberFormat('en-US', { maximumSignificantDigits: 3, useGrouping: false }).format(number).toLowerCase();
  };
  const categories = feature => new Set((feature.properties.records || []).map(record => record.category));
  const normalizeSearch = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const recordAcreage = record => {
    const acres = Number(String(record.acres ?? '').replace(/,/g, ''));
    return Number.isFinite(acres) ? acres : null;
  };
  const recordMatchesListingDate = record => {
    const { listedSince, listedBefore } = state();
    if (!listedSince && !listedBefore) return true;
    return typeof record.listingDate === 'string' && (!listedSince || record.listingDate >= listedSince) && (!listedBefore || record.listingDate <= listedBefore);
  };
  const recordMatchesDiscoveryFilters = record => {
    if (record.kind !== 'private') return true;
    const { minimumPrice = 0, maximumPrice = 0, minimumPricePerAcre = 0, maximumPricePerAcre = 0, enabledPropertyTypes = new Set(), minimumBeds = 0, minimumBaths = 0, listingKeywords = '' } = state();
    const price = Number(record.price);
    const acres = recordAcreage(record);
    const pricePerAcre = Number.isFinite(price) && acres > 0 ? price / acres : null;
    if ((minimumPrice && (!Number.isFinite(price) || price < minimumPrice)) || (maximumPrice && (!Number.isFinite(price) || price > maximumPrice))) return false;
    if ((minimumPricePerAcre && (pricePerAcre === null || pricePerAcre < minimumPricePerAcre)) || (maximumPricePerAcre && (pricePerAcre === null || pricePerAcre > maximumPricePerAcre))) return false;
    if (enabledPropertyTypes.size && !enabledPropertyTypes.has(record.propertyType)) return false;
    if (minimumBeds && Number(record.beds) < minimumBeds) return false;
    if (minimumBaths && Number(record.baths) < minimumBaths) return false;
    return !listingKeywords || normalizeSearch([record.title, record.propertyType, record.propertySubType, record.listingSource].filter(Boolean).join(' ')).includes(listingKeywords);
  };
  const acreageMatches = acres => {
    const { minimumAcreage, maximumAcreage } = state();
    return (!minimumAcreage || (acres !== null && acres >= minimumAcreage)) && (!maximumAcreage || (acres !== null && acres <= maximumAcreage));
  };
  const recordIsVisible = (record, fallbackAcres) => {
    const { enabledCategories } = state();
    const acres = recordAcreage(record) ?? recordAcreage({ acres: fallbackAcres });
    return enabledCategories.has(record.category) && recordMatchesListingDate(record) && recordMatchesDiscoveryFilters(record) && acreageMatches(acres);
  };
  const searchableFeature = feature => {
    const { enabledCategories } = state();
    const records = (feature.properties.records || []).filter(record => enabledCategories.has(record.category) && recordMatchesListingDate(record) && recordMatchesDiscoveryFilters(record) && acreageMatches(recordAcreage(record) ?? recordAcreage({ acres: feature.properties.Acres })));
    return records.length ? { ...feature, properties: { ...feature.properties, records } } : null;
  };
  const firstCategory = feature => {
    const { enabledCategories } = state();
    return [...categories(feature)].find(value => enabledCategories.has(value)) || [...categories(feature)][0];
  };
  const markerLabel = properties => {
    const { enabledCategories } = state();
    const records = Array.isArray(properties.records) ? properties.records : [properties];
    const record = records.find(item => item.kind === 'private' && enabledCategories.has(item.category));
    if (!record) return '';
    const price = Number(record.price);
    const abbreviatedPrice = price >= 1e6 ? `${compactNumber(price / 1e6)}m` : price >= 1e3 ? `${compactNumber(price / 1e3)}k` : compactNumber(price);
    const acres = compactNumber(record.acres);
    return abbreviatedPrice && acres ? `${abbreviatedPrice}/${acres}` : '';
  };
  const featureCenter = feature => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const collect = value => {
      if (typeof value?.[0] === 'number') {
        minX = Math.min(minX, value[0]); maxX = Math.max(maxX, value[0]);
        minY = Math.min(minY, value[1]); maxY = Math.max(maxY, value[1]);
      } else value?.forEach(collect);
    };
    collect(feature.geometry?.coordinates);
    return Number.isFinite(minX) ? [(minX + maxX) / 2, (minY + maxY) / 2] : null;
  };
  const filteredMappedListings = () => (state().saleData?.features || []).map(searchableFeature).filter(Boolean);
  const filteredUnmappedListings = () => (state().saleData?.unmappedListings || []).filter(record => recordIsVisible(record));
  const saleGeoJson = () => ({ type: 'FeatureCollection', features: filteredMappedListings().map(feature => ({ ...feature, properties: { ...feature.properties, displayCategory: firstCategory(feature) } })) });
  const listingMarkerKey = record => {
    const mls = normalizeSearch(record.mlsNumber);
    if (mls) return `mls:${mls}`;
    // Non-MLS private listings can still be linked to multiple parcels.
    if (record.kind === 'private' && record.url) return `private-url:${record.url}`;
    return '';
  };
  const salePointGeoJson = () => {
    const markers = new Map();
    for (const feature of filteredMappedListings()) {
      const point = featureCenter(feature);
      if (!point) continue;
      for (const [index, record] of (feature.properties.records || []).entries()) {
        // An MLS listing may be associated with several parcel polygons. Keep its
        // first parcel as the marker's location, but emit only one marker.
        const key = listingMarkerKey(record) || `parcel:${feature.properties.APN}:${index}`;
        if (markers.has(key)) continue;
        markers.set(key, {
          type: 'Feature', geometry: { type: 'Point', coordinates: point },
          properties: { ...feature.properties, records: [record], displayCategory: record.category, markerLabel: markerLabel({ records: [record] }) }
        });
      }
    }
    return { type: 'FeatureCollection', features: [...markers.values()] };
  };
  const separatedUnmappedListings = () => {
    const groups = new Map();
    for (const record of filteredUnmappedListings()) {
      const key = record.latLng.map(value => Number(value).toFixed(6)).join(',');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(record);
    }
    return [...groups.values()].flatMap(records => records.sort((a, b) => String(a.mlsNumber).localeCompare(String(b.mlsNumber))).map((record, index) => ({ record, index, count: records.length })));
  };
  const separatedCoordinate = (latLng, index, count) => {
    if (count === 1) return [latLng[1], latLng[0]];
    const angle = -Math.PI / 2 + index * Math.PI * 2 / count;
    const radiusFeet = 100, latitudeFeetPerDegree = 364000;
    const longitudeFeetPerDegree = latitudeFeetPerDegree * Math.cos(latLng[0] * Math.PI / 180);
    return [latLng[1] + Math.cos(angle) * radiusFeet / longitudeFeetPerDegree, latLng[0] + Math.sin(angle) * radiusFeet / latitudeFeetPerDegree];
  };
  const unmappedGeoJson = () => ({ type: 'FeatureCollection', features: separatedUnmappedListings().map(({ record, index, count }) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: separatedCoordinate(record.latLng, index, count) }, properties: { ...record, sharedLocationCount: count, markerLabel: markerLabel(record) } })) });
  return { categories, featureCenter, filteredMappedListings, filteredUnmappedListings, markerLabel, normalizeSearch, saleGeoJson, salePointGeoJson, unmappedGeoJson };
}
