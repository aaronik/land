'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');

const root = path.resolve(__dirname, '..');
const defaultFile = path.join(root, 'data', 'parcel-overrides.json');
const GIS = 'https://services3.arcgis.com/JmPiYilyU1x5zuxM/arcgis/rest/services/Siskiyou_Parcels_Public/FeatureServer/0/query';
const DEFAULT_SOURCE = 'manual override: user-verified listing APN';
const DEFAULT_CONFIDENCE = 'manually verified';

function normalizeApn(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 9 ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}` : '';
}

function parseApns(value) {
  return [...new Set(String(value || '').split(/[\s,]+/).map(normalizeApn).filter(Boolean))];
}

function normalizeListingNumber(value) {
  const input = String(value || '').trim();
  const urlMatch = input.match(/\/idx\/listing\/[^/]+\/([^/?#]+)/i);
  return decodeURIComponent(urlMatch?.[1] || input).toUpperCase();
}

function loadOverrides(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

function saveOverrides(file, overrides) {
  const sorted = Object.fromEntries(Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(sorted, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

async function verifyApns(apns) {
  const where = apns.map(apn => `APN = '${apn.replace(/'/g, "''")}'`).join(' OR ');
  const query = new URLSearchParams({ f: 'json', where, outFields: 'APN,Acres,LandUse1', returnGeometry: 'false' });
  const response = await fetch(`${GIS}?${query}`);
  if (!response.ok) throw new Error(`County GIS returned ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(`County GIS: ${data.error.message || 'query failed'}`);
  const found = new Map((data.features || []).map(feature => {
    const attributes = feature.attributes || {};
    return [normalizeApn(attributes.APN), attributes];
  }));
  const missing = apns.filter(apn => !found.has(apn));
  if (missing.length) throw new Error(`APN not found in county GIS: ${missing.join(', ')}`);
  return apns.map(apn => ({ apn, acres: Number(found.get(apn).Acres) || null, landUse: found.get(apn).LandUse1 || '' }));
}

function usage() {
  console.log(`Parcel override helper

Usage:
  npm run override -- add <MLS> <APN[,APN...]> [--notes "..."]
  npm run override -- show <MLS>
  npm run override -- list
  npm run override -- remove <MLS>
  npm run override                 # interactive add

Options:
  --source <text>       Evidence/source description
  --confidence <text>   Confidence description
  --no-verify           Skip county GIS APN verification
  --force               Replace an existing MLS override
  --file <path>         Use another override file (mainly for tests)`);
}

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--no-verify' || arg === '--force' || arg === '--help') options[arg.slice(2)] = true;
    else if (arg.startsWith('--')) {
      if (argv[i + 1] === undefined) throw new Error(`${arg} requires a value`);
      options[arg.slice(2)] = argv[++i];
    } else positional.push(arg);
  }
  return { positional, options };
}

async function interactiveValues() {
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return {
      mls: (await prompt.question('Listing/MLS number or listing URL: ')).trim(),
      apns: (await prompt.question('APN(s), comma-separated: ')).trim(),
      notes: (await prompt.question('Notes/address: ')).trim()
    };
  } finally {
    prompt.close();
  }
}

async function main(argv = process.argv.slice(2)) {
  const { positional, options } = parseArgs(argv);
  if (options.help || positional[0] === 'help') return usage();
  const file = path.resolve(options.file || process.env.PARCEL_OVERRIDES_FILE || defaultFile);
  const command = positional[0] || 'add';
  const overrides = loadOverrides(file);

  if (command === 'list') {
    for (const [mls, value] of Object.entries(overrides)) console.log(`${mls}\t${(value.apns || []).join(', ')}\t${value.notes || ''}`);
    return;
  }
  if (command === 'show') {
    const mls = normalizeListingNumber(positional[1]);
    const value = overrides[mls];
    if (!value) throw new Error(`No override for listing ${mls || '(missing)'}`);
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  if (command === 'remove') {
    const mls = normalizeListingNumber(positional[1]);
    if (!overrides[mls]) throw new Error(`No override for listing ${mls || '(missing)'}`);
    delete overrides[mls];
    saveOverrides(file, overrides);
    console.log(`Removed override for MLS ${mls}`);
    return;
  }
  if (command !== 'add') throw new Error(`Unknown command: ${command}`);

  const interactive = positional.length === 0;
  const answers = interactive ? await interactiveValues() : {};
  const mls = normalizeListingNumber(interactive ? answers.mls : positional[1]);
  const apns = parseApns(interactive ? answers.apns : positional[2]);
  const notes = String(options.notes ?? answers.notes ?? '').trim();
  if (!/^[A-Z0-9][A-Z0-9._-]{4,}$/.test(mls)) throw new Error('Provide a valid listing/MLS number or listing URL');
  if (!apns.length) throw new Error('Provide at least one valid 9-digit APN');
  if (overrides[mls] && !options.force) throw new Error(`MLS ${mls} already has an override; use --force to replace it`);

  if (!options['no-verify']) {
    const parcels = await verifyApns(apns);
    for (const parcel of parcels) console.log(`Verified ${parcel.apn}${parcel.acres ? ` · ${parcel.acres} acres` : ''}${parcel.landUse ? ` · land use ${parcel.landUse}` : ''}`);
  }

  overrides[mls] = {
    apns,
    source: options.source || DEFAULT_SOURCE,
    confidence: options.confidence || DEFAULT_CONFIDENCE,
    ...(notes ? { notes } : {})
  };
  saveOverrides(file, overrides);
  console.log(`Saved MLS ${mls} → ${apns.join(', ')} in ${path.relative(root, file)}`);
  console.log('Run `npm run refresh` when you want to regenerate the map data.');
}

if (require.main === module) main().catch(error => { console.error(`Error: ${error.message}`); process.exitCode = 1; });

module.exports = { loadOverrides, normalizeApn, normalizeListingNumber, parseApns, saveOverrides };
