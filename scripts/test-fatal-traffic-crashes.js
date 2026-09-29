'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { parseCsv, extractCounty } = require('./refresh-fatal-traffic-crashes.js');

assert.deepEqual(parseCsv('a,b\r\n"road, name","multi\nline"\r\n'), [['a', 'b'], ['road, name', 'multi\nline']]);
const headers = 'STATE,COUNTY,ST_CASE,YEAR,MONTH,DAY,FATALS,LATITUDE,LONGITUD,TWAY_ID,TWAY_ID2,TYP_INTNAME';
const csv = [headers, '6,93,123,2023,2,3,2,41.5,-122.4,"County, Road",,Not an Intersection', '6,93,124,2023,3,4,1,99.9999,999.9999,,,', '6,1,125,2023,3,4,1,41.5,-122.4,,,'].join('\n');
const { features, missingLocation } = extractCounty(csv, 2023);
assert.equal(features.length, 1);
assert.equal(missingLocation, 1);
assert.deepEqual(features[0].geometry.coordinates, [-122.4, 41.5]);
assert.equal(features[0].properties.road, 'County, Road');
assert.equal(features[0].properties.fatalities, 2);
assert.throws(() => extractCounty(headers + '\n6,93,123,2024,2,3,2,41.5,-122.4,,,', 2023));
const data = JSON.parse(readFileSync(path.join(__dirname, '..', 'data', 'fatal-traffic-crashes.geojson')));
assert.equal(data.features.length, 125);
assert.equal(new Set(data.features.map(f => `${f.properties.year}-${f.properties.case}`)).size, 125);
assert.deepEqual([...new Set(data.features.map(f => f.properties.year))], [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024]);
console.log('FARS CSV parsing, coordinate filtering, and 10-year archive tests passed.');
