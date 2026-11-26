'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const json = file => JSON.parse(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));

async function main() {
  const { createGroundwaterViewer, completionCard, matchingStations } = await import('../assets/ui/groundwater.js');
  const site = '413273N1223142W001';
  const second = { site: '413283N1223117W001', name: 'Second completion', report: 'WCR2022-000828', screens: [], periodic: [], automated: [], monthly: [] };
  const station = { ...second, site, name: '<DWR station>', report: '713273', swn: '40N04W09G002M', screens: [[120, 150]],
    periodic: [['2010-01-01 00:00:00', -1, 'Good'], ['2012-01-01 00:00:00', 25, 'Questionable']],
    monthly: [['2013-01-01', 17, '15']] };
  const stations = { [site]: station, [second.site]: second };
  const report = { WCRNumber: 'WCR1950-000007', LegacyLogNumber: ' 713273 ', DateWorkEnded: -181526400000, TotalDrillDepth: '177', StaticWaterLevel: 0 };
  assert.deepEqual(matchingStations(stations, report), [station]);
  assert.deepEqual(matchingStations(stations, { WCRNumber: second.report.toLowerCase() }), [second]);
  assert.deepEqual(matchingStations(stations, { WCRNumber: '71327' }), []);
  const html = completionCard({ ...report, WCRLinks: 'javascript:alert(1)' });
  assert.match(html, /1964-04-01/);
  assert.match(html, /Completed depth<\/dt><dd>Not reported/);
  assert.match(html, /Drilled depth<\/dt><dd>177 ft/);
  assert.match(html, /Static water level<\/dt><dd>0 ft/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(completionCard({ WCRLinks: 'https://cadwr.app.box.com/v/WellCompletionReports/file/42' }), /View original DWR report/);

  const { window } = new JSDOM('<div id="details"></div>');
  const details = window.document.getElementById('details');
  let calls = 0;
  const viewer = createGroundwaterViewer({ details, historyUrl: '/test.json', fetchHistory: async () => ({ ok: true, json: async () => {
    calls++;
    return { stations, extract: '2026-11-25' };
  } }) });
  await viewer.openCompletion(report);
  assert.match(details.textContent, /DWR-linked monitoring history/);
  const button = details.querySelector('button');
  assert.match(button.textContent, /<DWR station>/);
  button.click();
  await new Promise(setImmediate);
  assert.equal(details.querySelectorAll('svg').length, 2);
  assert.doesNotMatch(details.innerHTML, /NaN/);
  assert.match(details.textContent, /Latest:\s*25 ft/);
  assert.match(details.textContent, /Questionable/);
  assert.match(details.textContent, /DWR QC 15/);
  assert.match(details.textContent, /120 to 150 ft/);
  assert(details.querySelector('[data-well-csv]'));
  assert.equal(calls, 1, 'History snapshot is reused');
  await viewer.openStation(second, [station]);
  assert.match(details.textContent, /No usable depth/);
  details.querySelector('[data-well-alternatives] button').click();
  await new Promise(setImmediate);
  assert.equal(details.querySelectorAll('svg').length, 2);
  const stale = viewer.openStation(second);
  details.innerHTML = '<h3>Another selection</h3>';
  await stale;
  assert.equal(details.textContent, 'Another selection');
  const offline = createGroundwaterViewer({ details, historyUrl: '/missing', fetchHistory: async () => ({ ok: false }) });
  await offline.openStation(station);
  assert.match(details.textContent, /history is unavailable/);

  const points = json('data/groundwater-monitoring.geojson').features;
  const history = json('data/groundwater-monitoring-history.json').stations;
  assert.equal(new Set(points.map(feature => feature.id)).size, points.length);
  assert.equal(points.length, Object.keys(history).length);
  for (const feature of points) {
    const s = history[feature.id];
    assert.equal(s.site, feature.properties.site);
    assert.equal(s.report, feature.properties.report);
    assert.equal(s.readingCount, feature.properties.readingCount);
    assert.equal(s.readingCount, s.periodic.length + s.automated.length + s.monthly.length);
    for (const series of [s.periodic, s.automated, s.monthly]) {
      assert(series.every(([date, depth], i) => Number.isFinite(depth) && /^\d{4}-\d{2}-\d{2}/.test(date) && (!i || series[i - 1][0] <= date)));
    }
  }
  assert(points.some(feature => feature.properties.readingCount === 0));
  assert(Object.values(history).some(s => s.monthly.length && s.periodic.length));
  console.log('Passed: DWR report joins, groundwater details, chart states, and snapshot consistency.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
