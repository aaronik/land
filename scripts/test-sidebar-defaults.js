'use strict';
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { readFileSync } = require('node:fs');

(async () => {
  const { resetFilterControl } = await import('../assets/state/ui.js');
  const { readParcelQuestUsage, incrementParcelQuestUsage } = await import('../assets/state/parcelquest.js');
  const dom = new JSDOM(readFileSync(require.resolve('../index.html'), 'utf8'), { url: 'https://example.test/' });
  for (const select of dom.window.document.querySelectorAll('#minimum-beds, #minimum-baths')) {
    select.value = '2';
    resetFilterControl(select);
    assert.equal(select.selectedOptions[0].textContent, 'Any');
    select.options[1].defaultSelected = true;
    select.value = '2';
    resetFilterControl(select);
    assert.equal(select.selectedIndex, 1);
  }
  Object.defineProperty(globalThis, 'localStorage', { value: dom.window.localStorage, configurable: true });
  const key = `shasta-land-parcelquest:${new Date().toISOString().slice(0, 7)}`;
  localStorage.setItem(key, '3');
  assert.equal(readParcelQuestUsage(), 3);
  assert.equal(incrementParcelQuestUsage(), 4);
  assert.equal(readParcelQuestUsage(), 4);
  assert.equal(localStorage.getItem(key), '4');
  dom.window.close();
  console.log('Passed: sidebar select defaults and ParcelQuest usage persistence.');
})().catch(error => { console.error(error); process.exit(1); });
