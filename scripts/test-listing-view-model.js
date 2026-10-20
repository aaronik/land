'use strict';

const assert = require('assert/strict');

(async () => {
  const { createListingData } = await import('../assets/data/listings.js');
  const state = {
    enabledCategories: new Set(['private-land']), minimumAcreage: 0, listedSince: '',
    saleData: {
      features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-122, 41], [-121, 41], [-121, 42], [-122, 41]]] }, properties: { APN: '001-002-003', Acres: 10, records: [{ kind: 'private', category: 'private-land', title: '10 Main Street', price: 250000, acres: '10', listingDate: '2026-01-01' }] } }],
      unmappedListings: [{ kind: 'private', category: 'private-land', title: '20 Main Street', price: 100000, acres: 5, latLng: [41.5, -122.5], mlsNumber: '2' }, { kind: 'private', category: 'private-land', title: '21 Main Street', price: 110000, acres: 6, latLng: [41.5, -122.5], mlsNumber: '1' }]
    }
  };
  const listings = createListingData(() => state);
  assert.equal(listings.filteredMappedListings().length, 1);
  assert.equal(listings.salePointGeoJson().features[0].properties.markerLabel, '250k/10');
  state.saleData.features.push({
    type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-120, 40], [-119, 40], [-119, 41], [-120, 40]]] },
    properties: { APN: '001-002-004', Acres: 10, records: [{ kind: 'private', category: 'private-land', title: '10 Main Street', price: 250000, acres: '10', listingDate: '2026-01-01', mlsNumber: 'MULTI-1' }] }
  });
  state.saleData.features[0].properties.records[0].mlsNumber = 'MULTI-1';
  assert.equal(listings.salePointGeoJson().features.length, 1, 'a listing linked to multiple parcels has one marker');
  assert.equal(listings.unmappedGeoJson().features.length, 2);
  assert.notDeepEqual(listings.unmappedGeoJson().features[0].geometry.coordinates, listings.unmappedGeoJson().features[1].geometry.coordinates);
  assert.equal(listings.filteredMappedListings().length, 2);
  state.saleData.unmappedListings.push({ kind: 'private', category: 'private-commercial', propertyType: 'commercial', title: 'Main Street shop', price: 150000, acres: 2, latLng: [41.5, -122.5], mlsNumber: 'C1' });
  state.enabledCategories.add('private-commercial');
  state.enabledPropertyTypes = new Set(['commercial']);
  assert.equal(listings.filteredUnmappedListings().length, 1, 'commercial listing visible with both filters enabled');
  assert.equal(listings.unmappedGeoJson().features[0].properties.category, 'private-commercial');
  state.enabledPropertyTypes.delete('commercial');
  state.enabledPropertyTypes.add('land');
  assert.equal(listings.filteredUnmappedListings().length, 0, 'property type filter hides commercial');
  state.enabledPropertyTypes.add('commercial');
  state.enabledCategories.delete('private-commercial');
  assert.equal(listings.filteredUnmappedListings().length, 0, 'map category filter hides commercial');
  state.saleData.features.push({
    type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-123, 41], [-122, 41], [-122, 42], [-123, 41]]] },
    properties: { APN: '001-002-005', Acres: 2, records: [], salesHistory: [{ kind: 'sale-history', propertyType: 'commercial', mlsNumber: 'SOLD-C1', soldPrice: 200000, soldDate: '2026-02-24', acres: 2 }] }
  });
  state.enabledCategories.add('previous-listing');
  assert.equal(listings.filteredMappedListings().filter(feature => feature.properties.APN === '001-002-005').length, 1, 'commercial sale appears in sold history layer');
  assert.equal(listings.salePointGeoJson().features.find(feature => feature.properties.salesHistory?.[0]?.mlsNumber === 'SOLD-C1')?.properties.displayCategory, 'previous-listing');
  state.enabledCategories.delete('previous-listing');
  assert.equal(listings.filteredMappedListings().filter(feature => feature.properties.APN === '001-002-005').length, 0, 'sold history toggle hides commercial sale');
  state.minimumAcreage = 11;
  assert.equal(listings.filteredMappedListings().length, 0);
  console.log('Passed: listing view-model filtering and marker layout tests.');
})().catch(error => { console.error(error); process.exit(1); });
