'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '../assets/app.source.js'), 'utf8');
const start = app.indexOf('function loadListingTypeVisibility() {');
const end = app.indexOf('function saveListingTypeVisibility() {', start);
assert.ok(start >= 0 && end > start, 'listing visibility loader exists');
const load = app.slice(start, end);

for (const saved of [null, '{invalid', JSON.stringify({ 'private-land': false, 'previous-listing': true })]) {
  const inputs = [
    { value: 'private-land', checked: true },
    { value: 'previous-listing', checked: false },
    { value: 'tax-delinquent', checked: false }
  ];
  const context = vm.createContext({
    listingTypeInputs: inputs,
    LISTING_TYPE_STORAGE_KEY: 'listing-types',
    localStorage: { getItem: () => saved },
    Set
  });
  vm.runInContext(`let enabledCategories = new Set(['private-land', 'previous-listing', 'tax-delinquent']); ${load} loadListingTypeVisibility();`, context);
  const enabled = Array.from(vm.runInContext('enabledCategories', context));
  assert.deepEqual(enabled, inputs.filter(input => input.checked).map(input => input.value), `map categories match checkboxes with saved state ${saved}`);
}
console.log('Passed: listing category visibility initializes from checkboxes with or without storage.');
