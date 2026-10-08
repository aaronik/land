import { defaultDrawings, parcel7NorthBendCorrection as correction } from './default-drawings.js';

export const defaultDrawingIds = defaultDrawings.map(item => item.id);
export const DRAWINGS_KEY = 'shasta-land-atlas.polygon-drawings.v1';
export const SEEDS_KEY = 'shasta-land-atlas.polygon-seeds.v1';

export function missingDefaultDrawings(drawings, seen = []) {
  const known = new Set([...drawings.map(item => item.id), ...seen]);
  return defaultDrawings.filter(item => !known.has(item.id)).map(item => structuredClone(item));
}

// Save drawings before the ledger: a failed write can never mark an absent seed
// as delivered. A seen-but-absent drawing represents a local deletion.
export function loadSeededDrawings(storage) {
  let drawings = [], seen = [];
  try {
    const raw = storage.getItem(DRAWINGS_KEY);
    const value = raw === null ? [] : JSON.parse(raw);
    if (!Array.isArray(value)) throw new Error('Invalid saved drawings');
    drawings = value.filter(item => item && Array.isArray(item.vertices) && item.vertices.length >= 3)
      .map(item => ({ ...item, visible: item.visible !== false }));
  } catch {
    // Do not overwrite unreadable existing data. Defaults still work in memory.
    return structuredClone(defaultDrawings);
  }
  try {
    const value = JSON.parse(storage.getItem(SEEDS_KEY) || '[]');
    if (Array.isArray(value)) seen = value.filter(id => typeof id === 'string');
  } catch { /* A damaged ledger must not discard saved polygons. */ }
  const legacy = drawings.find(item => item.id === correction.id && JSON.stringify(item.vertices) === JSON.stringify(correction.previousVertices));
  if (legacy) {
    try {
      const backupKey = `${DRAWINGS_KEY}.backup.${correction.revision}`;
      if (storage.getItem(backupKey) === null) storage.setItem(backupKey, storage.getItem(DRAWINGS_KEY));
      const updated = structuredClone(defaultDrawings.find(item => item.id === correction.id));
      const corrected = drawings.map(item => item !== legacy ? item : {
        ...item, vertices: updated.vertices, geometryRevision: correction.revision,
        name: item.name === correction.previousName ? updated.name : item.name
      });
      storage.setItem(DRAWINGS_KEY, JSON.stringify(corrected));
      drawings = corrected;
    } catch { /* Keep previous geometry if backup or persistence fails. */ }
  }
  const additions = missingDefaultDrawings(drawings, seen);
  const merged = [...drawings, ...additions];
  const nextSeen = [...new Set([...seen, ...defaultDrawings.map(item => item.id)])];
  try {
    if (additions.length) storage.setItem(DRAWINGS_KEY, JSON.stringify(merged));
    if (JSON.stringify(nextSeen) !== JSON.stringify(seen)) storage.setItem(SEEDS_KEY, JSON.stringify(nextSeen));
  } catch { /* Storage blocked/full: show in memory without claiming persistence. */ }
  return merged;
}
