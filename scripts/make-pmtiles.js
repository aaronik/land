'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { LAYERS } = require('./layers');

const root = path.resolve(__dirname, '..');
const raw = path.join(root, 'data', 'raw');
const generated = path.join(root, 'data', 'generated');
const configs = {
  parcels: { min: 8, max: 15, fields: LAYERS.parcels.fields.filter(field => field !== 'OBJECTID') },
  zoning: { min: 7, max: 14, fields: LAYERS.zoning.fields.filter(field => field !== 'OBJECTID') },
  roads: { min: 8, max: 14, fields: LAYERS.roads.fields.filter(field => field !== 'FID') },
  railroads: { min: 7, max: 14, fields: LAYERS.railroads.fields.filter(field => field !== 'OBJECTID') },
  fire_hazard: { min: 7, max: 14, fields: LAYERS.fire_hazard.fields.filter(field => field !== 'FID') },
  public_land: { min: 6, max: 13, fields: LAYERS.public_land.fields.filter(field => field !== 'OBJECTID') },
  flood: { min: 8, max: 14, fields: LAYERS.flood.fields.filter(field => field !== 'OBJECTID') },
  soils: { min: 9, max: 14, fields: LAYERS.soils.fields },
  huc12: { min: 7, max: 14, fields: LAYERS.huc12.fields.filter(field => field !== 'objectid') },
  wetlands: { min: 9, max: 14, fields: LAYERS.wetlands.fields.filter(field => field !== 'OBJECTID') }
};

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`);
}

function main() {
  fs.mkdirSync(generated, { recursive: true });
  const requested = process.argv.slice(2);
  const names = requested.length ? requested : Object.keys(configs);
  for (const name of names) {
    const config = configs[name];
    const input = path.join(raw, `${name}.geojson`);
    if (!config || !fs.existsSync(input)) throw new Error(`Missing raw layer: ${name}`);
    const mbtiles = path.join(generated, `${name}.mbtiles`);
    const pmtiles = path.join(generated, `${name}.pmtiles`);
    const args = ['--force', `--output=${mbtiles}`, `--layer=${name}`, `--minimum-zoom=${config.min}`, `--maximum-zoom=${config.max}`, '--drop-densest-as-needed', '--coalesce-densest-as-needed', '--extend-zooms-if-still-dropping', '--read-parallel', '--exclude-all'];
    for (const field of config.fields) args.push(`--include=${field}`);
    args.push(input);
    console.log(`Building ${name}.pmtiles…`);
    run('tippecanoe', args);
    run('pmtiles', ['convert', mbtiles, pmtiles]);
    fs.rmSync(mbtiles);
  }
}

try { main(); } catch (error) { console.error(error); process.exit(1); }
