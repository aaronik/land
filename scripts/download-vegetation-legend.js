'use strict';
// Snapshot the official LANDFIRE EVT 2025 legend, not a third-party taxonomy.
const fs = require('fs');
const path = require('path');
const SOURCE = 'https://www.landfire.gov/sites/default/files/CSV/LF2025/LF2025_EVT.csv';
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (char === ',' || char === '\n')) {
      row.push(cell.trim()); cell = '';
      if (char === '\n') { rows.push(row); row = []; }
    } else if (char !== '\r' || quoted) cell += char;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows;
}
async function main() {
  const response = await fetch(SOURCE);
  if (!response.ok) throw new Error(`LANDFIRE legend returned ${response.status}`);
  const [header, ...rows] = parseCsv(await response.text());
  const columns = Object.fromEntries(header.map((name, i) => [name, i]));
  const lookup = {};
  for (const row of rows) {
    const key = row[columns.VALUE];
    if (key && row[columns.EVT_NAME]) {
      const rgb = ['R', 'G', 'B'].map(channel => Number(row[columns[channel]]));
      lookup[key] = {
        name: row[columns.EVT_NAME], lifeform: row[columns.EVT_LF], physiognomy: row[columns.EVT_PHYS],
        color: rgb.every(value => Number.isInteger(value) && value >= 0 && value <= 255)
          ? `#${rgb.map(value => value.toString(16).padStart(2, '0')).join('')}` : null
      };
    }
  }
  if (Object.keys(lookup).length < 500) throw new Error('Incomplete LANDFIRE legend');
  fs.writeFileSync(path.join(__dirname, '../data/generated/landfire-evt-2025.json'), JSON.stringify(lookup));
  console.log(`Saved ${Object.keys(lookup).length} official LANDFIRE EVT classes`);
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { parseCsv };
