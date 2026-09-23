'use strict';

const assert = require('assert');

(async () => {
  const { municipalZoningExplanation } = await import('../assets/ui/parcel-details.js');
  const shasta = municipalZoningExplanation({ zoning: 'C-1', jurisdiction: 'Mount Shasta', zoneclass: 'Downtown Commercial', map_date: '2017' });
  assert.equal(shasta.title, 'Downtown Commercial');
  assert.match(shasta.summary, /Downtown Commercial district/);
  assert.match(shasta.guidance, /Mount Shasta Planning/);
  assert.doesNotMatch(shasta.summary + shasta.guidance, /Siskiyou County commercial zoning district|County Planning/);
  assert.match(shasta.date, /2017/);
  assert.equal(shasta.code.url, 'https://ecode360.com/51184723');

  const dunsmuir = municipalZoningExplanation({ zoning: 'C-1', jurisdiction: 'Dunsmuir', zoneclass: 'Neighborhood Commercial', map_date: '2009' });
  assert.equal(dunsmuir.title, 'Neighborhood Commercial');
  assert.equal(dunsmuir.code, undefined);

  const unknown = municipalZoningExplanation({ zoning: 'NA', jurisdiction: 'Mount Shasta', zoneclass: '', map_date: '2017' });
  assert.equal(unknown.title, 'Municipal zoning designation');
  assert.match(unknown.summary, /does not provide a district description/);
  console.log('Passed: municipal zoning explanations retain local meanings, jurisdiction, dates, and correct code links.');
})().catch(error => { console.error(error); process.exit(1); });
