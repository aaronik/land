'use strict';

// Snapshot of all OSM surveillance nodes in a bounding box covering Siskiyou County.
// Review new points outside the county before committing; OSM is not an authoritative inventory.
const { writeFile } = require('node:fs/promises');
const path = require('node:path');

const BBOX = [-123.75, 41.15, -121.4, 42.01]; // west, south, east, north
const polygon = `POLYGON((${BBOX[0]} ${BBOX[1]},${BBOX[2]} ${BBOX[1]},${BBOX[2]} ${BBOX[3]},${BBOX[0]} ${BBOX[3]},${BBOX[0]} ${BBOX[1]}))`;
const query = `PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX osmkey: <https://www.openstreetmap.org/wiki/Key:>
PREFIX geof: <http://www.opengis.net/def/function/geosparql/>
SELECT ?osm WHERE {
  ?osm osmkey:man_made "surveillance" ; geo:hasGeometry/geo:asWKT ?geometry .
  FILTER(geof:sfWithin(?geometry, "${polygon}"^^geo:wktLiteral))
} LIMIT 1000`;

async function main() {
  const endpoint = `https://qlever.dev/api/osm-planet?${new URLSearchParams({ query })}`;
  const response = await fetch(endpoint, { headers: { Accept: 'application/sparql-results+json' } });
  if (!response.ok) throw new Error(`QLever: HTTP ${response.status}`);
  const results = (await response.json()).results.bindings;
  if (results.length >= 1000) throw new Error('Surveillance result limit reached; increase it before exporting');
  const ids = results.map(row => {
    const match = /^https:\/\/www\.openstreetmap\.org\/node\/(\d+)$/.exec(row.osm.value);
    if (!match) throw new Error(`Unexpected OSM object: ${row.osm.value}`);
    return match[1];
  });
  const nodesResponse = await fetch(`https://api.openstreetmap.org/api/0.6/nodes?nodes=${ids.join(',')}`);
  if (!nodesResponse.ok) throw new Error(`OSM API: HTTP ${nodesResponse.status}`);
  // Node's built-in fetch does not include an XML parser; parse only the node attributes and tags
  // from the OSM API's well-formed, self-closing XML. Values are decoded via a conservative entity map.
  const xml = await nodesResponse.text();
  const decode = text => text.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[0-9a-f]+);/gi, entity => {
    const known = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
    return known[entity] || (entity[1] === '#' ? String.fromCodePoint(parseInt(entity.slice(entity[2]?.toLowerCase() === 'x' ? 3 : 2, -1), entity[2]?.toLowerCase() === 'x' ? 16 : 10)) : entity);
  });
  const attrs = text => Object.fromEntries([...text.matchAll(/([\w:]+)="([^"]*)"/g)].map(([, key, value]) => [key, decode(value)]));
  const features = [...xml.matchAll(/<node\b([^>]*)>([\s\S]*?)<\/node>/g)].map(([, raw, body]) => {
    const node = attrs(raw);
    const tags = Object.fromEntries([...body.matchAll(/<tag\b([^>]*)\/>/g)].map(([, rawTag]) => { const tag = attrs(rawTag); return [tag.k, tag.v]; }));
    return { type: 'Feature', geometry: { type: 'Point', coordinates: [Number(node.lon), Number(node.lat)] }, properties: { id: node.id, ...tags } };
  }).filter(feature => feature.properties.man_made === 'surveillance');
  if (features.length !== ids.length) throw new Error(`Incomplete OSM response: ${features.length} of ${ids.length} nodes`);
  features.sort((a, b) => Number(a.properties.id) - Number(b.properties.id));
  const file = path.join(__dirname, '../data/surveillance.geojson');
  await writeFile(file, JSON.stringify({ type: 'FeatureCollection', features }, null, 2) + '\n');
  console.log(`Saved ${features.length} surveillance nodes in county-area bounding box to ${file}. Review locations outside Siskiyou before publishing.`);
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { BBOX, query };
