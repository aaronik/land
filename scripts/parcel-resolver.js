'use strict';

const DEFAULT_OPTIONS = { acreageTolerance: 0.005, minimumCorroboratingLots: 2 };

function lotNumber(record) {
  const match = String(record.title || '').match(/^\s*LOT\s*[#-]?\s*(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

function apnParts(apn) {
  const match = String(apn || '').match(/^(\d{3})-(\d{3})-(\d{3})$/);
  return match ? { prefix: `${match[1]}-${match[2]}`, suffix: Number(match[3]) } : null;
}

function acreageMatches(record, parcel, tolerance) {
  const listedAcres = Number(record.acres), gisAcres = Number(parcel.acres);
  return listedAcres > 0 && gisAcres > 0 && Math.abs(listedAcres - gisAcres) <= tolerance;
}

function candidateModel(record, parcel, tolerance) {
  const lot = lotNumber(record);
  const parts = apnParts(parcel.apn);
  if (lot === null || !parts || parts.suffix % 10 !== 0 || !acreageMatches(record, parcel, tolerance)) return null;
  const lotOffset = parts.suffix / 10 - lot;
  return { prefix: parts.prefix, lotOffset, key: `${parts.prefix}|${lotOffset}` };
}

function candidateMatches(record, parcel, tolerance, model = { lotOffset: 0 }) {
  const candidate = candidateModel(record, parcel, tolerance);
  return Boolean(candidate && candidate.lotOffset === model.lotOffset && (!model.prefix || candidate.prefix === model.prefix));
}

function groupByLocation(records) {
  const groups = new Map();
  for (const record of records) {
    if (lotNumber(record) === null || !Array.isArray(record.latLng) || record.latLng.length !== 2) continue;
    const key = record.latLng.map(value => Number(value).toFixed(6)).join(',');
    if (!groups.has(key)) groups.set(key, { latLng: record.latLng, records: [] });
    groups.get(key).records.push(record);
  }
  return [...groups.values()].filter(group => group.records.length >= 2);
}

function resolveGroup(group, parcels, options = {}) {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  const byModel = new Map();
  for (const record of group.records) for (const parcel of parcels) {
    const model = candidateModel(record, parcel, settings.acreageTolerance);
    if (!model) continue;
    if (!byModel.has(model.key)) byModel.set(model.key, { ...model, matches: [] });
    byModel.get(model.key).matches.push({ record, parcel, lot: lotNumber(record), prefix: model.prefix, lotOffset: model.lotOffset });
  }
  const models = [...byModel.values()].map(model => ({
    ...model,
    distinctLots: new Set(model.matches.map(match => match.lot)).size
  })).filter(model => model.distinctLots >= (model.lotOffset === 0 ? settings.minimumCorroboratingLots : Math.max(3, settings.minimumCorroboratingLots)))
    .sort((a, b) => b.distinctLots - a.distinctLots);
  if (!models.length || models[1]?.distinctLots === models[0].distinctLots) return { resolved: [], model: null, reason: 'no unique corroborated APN sequence' };
  const winner = models[0];
  const resolved = [];
  const usedApns = new Set();
  for (const record of group.records) {
    const candidates = winner.matches.filter(match => match.record === record && !usedApns.has(match.parcel.apn));
    if (candidates.length !== 1) continue;
    usedApns.add(candidates[0].parcel.apn);
    resolved.push(candidates[0]);
  }
  return {
    resolved,
    model: { prefix: winner.prefix, lotOffset: winner.lotOffset, key: winner.key },
    reason: resolved.length ? 'corroborated APN prefix, lot-number offset, and exact acreage' : 'no unique parcel assignments'
  };
}

function resolveSingleton(record, parcels, establishedModels, options = {}) {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  const candidates = [];
  for (const parcel of parcels) {
    const model = candidateModel(record, parcel, settings.acreageTolerance);
    if (model && establishedModels.has(model.key)) candidates.push({ record, parcel, lot: lotNumber(record), prefix: model.prefix, lotOffset: model.lotOffset });
  }
  if (candidates.length !== 1) return { resolved: [], reason: candidates.length ? 'ambiguous established-sequence candidates' : 'no candidate in an established APN sequence' };
  return { resolved: candidates, reason: 'established APN sequence, exact acreage, and bounded proximity' };
}

function resolvedRecord(match, corroboratingMlsNumbers, method) {
  const evidence = {
    resolver: 'subdivision-lot-sequence-v3',
    method,
    lotNumber: match.lot,
    lotOffset: match.lotOffset,
    listedAcres: Number(match.record.acres),
    gisAcres: Number(match.parcel.acres),
    apnPrefix: match.prefix,
    corroboratingMlsNumbers
  };
  const resolved = {
    ...match.record,
    APN: match.parcel.apn,
    parcelMatchSource: `deterministic secondary resolver: ${method}`,
    parcelMatchConfidence: 'high; assessor/title confirmation pending',
    parcelMatchEvidence: evidence
  };
  delete resolved.latLng;
  delete resolved.locationSource;
  delete resolved.category;
  return resolved;
}

async function resolveUnmappedParcels(records, queryNearbyParcels, options = {}) {
  const remaining = new Set(records);
  const resolvedRecords = [];
  const establishedModels = new Map();
  const groups = [];
  const candidateCache = new Map();
  const candidatesAt = async latLng => {
    const key = latLng.map(value => Number(value).toFixed(6)).join(',');
    if (!candidateCache.has(key)) candidateCache.set(key, Promise.resolve().then(() => queryNearbyParcels(latLng)));
    return candidateCache.get(key);
  };
  const addMatch = (match, corroboratingMlsNumbers, method) => {
    const resolved = resolvedRecord(match, corroboratingMlsNumbers, method);
    remaining.delete(match.record);
    resolvedRecords.push(resolved);
    const key = `${match.prefix}|${match.lotOffset}`;
    if (!establishedModels.has(key)) establishedModels.set(key, new Set());
    corroboratingMlsNumbers.forEach(number => establishedModels.get(key).add(number));
  };
  for (const group of groupByLocation(records)) {
    let parcels = [];
    try {
      parcels = await candidatesAt(group.latLng);
    } catch (error) {
      groups.push({ latLng: group.latLng, mlsNumbers: group.records.map(record => record.mlsNumber), status: 'query_failed', reason: error.message });
      continue;
    }
    const result = resolveGroup(group, parcels, options);
    const corroboratingMlsNumbers = result.resolved.map(item => item.record.mlsNumber);
    for (const match of result.resolved) addMatch(match, corroboratingMlsNumbers, 'corroborated APN sequence + exact acreage');
    groups.push({
      latLng: group.latLng,
      mlsNumbers: group.records.map(record => record.mlsNumber),
      status: result.resolved.length ? 'auto_mapped' : 'unresolved',
      reason: result.reason,
      model: result.model,
      assignments: result.resolved.map(match => ({ mlsNumber: match.record.mlsNumber, lotNumber: match.lot, lotOffset: match.lotOffset, apn: match.parcel.apn, listedAcres: match.record.acres, gisAcres: match.parcel.acres }))
    });
  }
  for (const record of records.filter(record => remaining.has(record) && lotNumber(record) !== null && Array.isArray(record.latLng))) {
    let parcels = [];
    try {
      parcels = await candidatesAt(record.latLng);
    } catch (error) {
      groups.push({ latLng: record.latLng, mlsNumbers: [record.mlsNumber], status: 'query_failed', reason: error.message });
      continue;
    }
    const result = resolveSingleton(record, parcels, new Set(establishedModels.keys()), options);
    for (const match of result.resolved) {
      const corroborating = [...(establishedModels.get(`${match.prefix}|${match.lotOffset}`) || [])];
      addMatch(match, corroborating, 'established APN sequence + exact acreage');
    }
    groups.push({
      latLng: record.latLng,
      mlsNumbers: [record.mlsNumber],
      status: result.resolved.length ? 'auto_mapped_singleton' : 'unresolved_singleton',
      reason: result.reason,
      assignments: result.resolved.map(match => ({ mlsNumber: match.record.mlsNumber, lotNumber: match.lot, lotOffset: match.lotOffset, apn: match.parcel.apn, listedAcres: match.record.acres, gisAcres: match.parcel.acres }))
    });
  }
  return {
    resolved: resolvedRecords,
    unmapped: records.filter(record => remaining.has(record)),
    report: { resolver: 'subdivision-lot-sequence-v3', evaluatedGroups: groups.length, mappedListings: resolvedRecords.length, establishedModels: [...establishedModels.keys()], groups }
  };
}

module.exports = { apnParts, candidateMatches, candidateModel, groupByLocation, lotNumber, resolveGroup, resolveSingleton, resolveUnmappedParcels };
