'use strict';

const DEFAULT_OPTIONS = { acreageTolerance: 0.02, minimumCorroboratingLots: 2 };

function lotNumber(record) {
  const match = String(record.title || '').match(/^\s*LOT\s*[#-]?\s*(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

function apnParts(apn) {
  const match = String(apn || '').match(/^(\d{3})-(\d{3})-(\d{3})$/);
  return match ? { prefix: `${match[1]}-${match[2]}`, suffix: Number(match[3]) } : null;
}

function candidateMatches(record, parcel, tolerance) {
  const lot = lotNumber(record);
  const parts = apnParts(parcel.apn);
  const listedAcres = Number(record.acres), gisAcres = Number(parcel.acres);
  return lot !== null && parts && parts.suffix === lot * 10 && listedAcres > 0 && gisAcres > 0 && Math.abs(listedAcres - gisAcres) <= tolerance;
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
  const matches = [];
  for (const record of group.records) {
    const candidates = parcels.filter(parcel => candidateMatches(record, parcel, settings.acreageTolerance));
    if (candidates.length === 1) matches.push({ record, parcel: candidates[0], lot: lotNumber(record), prefix: apnParts(candidates[0].apn).prefix });
  }
  const byPrefix = new Map();
  for (const match of matches) {
    if (!byPrefix.has(match.prefix)) byPrefix.set(match.prefix, []);
    byPrefix.get(match.prefix).push(match);
  }
  const corroborated = [...byPrefix.entries()]
    .map(([prefix, prefixMatches]) => ({ prefix, matches: prefixMatches, distinctLots: new Set(prefixMatches.map(match => match.lot)).size }))
    .filter(result => result.distinctLots >= settings.minimumCorroboratingLots)
    .sort((a, b) => b.distinctLots - a.distinctLots);
  if (!corroborated.length || corroborated[1]?.distinctLots === corroborated[0].distinctLots) return { resolved: [], reason: 'no unique corroborated APN prefix' };
  const winner = corroborated[0];
  const usedApns = new Set();
  const resolved = winner.matches.filter(match => {
    if (usedApns.has(match.parcel.apn)) return false;
    usedApns.add(match.parcel.apn);
    return true;
  });
  return { resolved, reason: resolved.length ? 'corroborated lot/APN sequence and exact acreage' : 'no unique parcel assignments' };
}

function resolveSingleton(record, parcels, establishedPrefixes, options = {}) {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  const candidates = parcels.filter(parcel => {
    if (!candidateMatches(record, parcel, settings.acreageTolerance)) return false;
    return establishedPrefixes.has(apnParts(parcel.apn).prefix);
  });
  if (candidates.length !== 1) return { resolved: [], reason: candidates.length ? 'ambiguous established-prefix candidates' : 'no candidate in an established APN prefix' };
  const parcel = candidates[0];
  return {
    resolved: [{ record, parcel, lot: lotNumber(record), prefix: apnParts(parcel.apn).prefix }],
    reason: 'established APN prefix, lot/APN sequence, exact acreage, and bounded proximity'
  };
}

function resolvedRecord(match, corroboratingMlsNumbers, method) {
  const evidence = {
    resolver: 'subdivision-lot-sequence-v2',
    method,
    lotNumber: match.lot,
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
  const establishedPrefixes = new Map();
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
    if (!establishedPrefixes.has(match.prefix)) establishedPrefixes.set(match.prefix, new Set());
    corroboratingMlsNumbers.forEach(number => establishedPrefixes.get(match.prefix).add(number));
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
    for (const match of result.resolved) addMatch(match, corroboratingMlsNumbers, 'shared-pin lot/APN sequence + exact acreage');
    groups.push({
      latLng: group.latLng,
      mlsNumbers: group.records.map(record => record.mlsNumber),
      status: result.resolved.length ? 'auto_mapped' : 'unresolved',
      reason: result.reason,
      assignments: result.resolved.map(match => ({ mlsNumber: match.record.mlsNumber, lotNumber: match.lot, apn: match.parcel.apn, listedAcres: match.record.acres, gisAcres: match.parcel.acres }))
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
    const result = resolveSingleton(record, parcels, new Set(establishedPrefixes.keys()), options);
    for (const match of result.resolved) {
      const corroborating = [...(establishedPrefixes.get(match.prefix) || [])];
      addMatch(match, corroborating, 'established APN prefix + lot/APN sequence + exact acreage');
    }
    groups.push({
      latLng: record.latLng,
      mlsNumbers: [record.mlsNumber],
      status: result.resolved.length ? 'auto_mapped_singleton' : 'unresolved_singleton',
      reason: result.reason,
      assignments: result.resolved.map(match => ({ mlsNumber: match.record.mlsNumber, lotNumber: match.lot, apn: match.parcel.apn, listedAcres: match.record.acres, gisAcres: match.parcel.acres }))
    });
  }
  return { resolved: resolvedRecords, unmapped: records.filter(record => remaining.has(record)), report: { resolver: 'subdivision-lot-sequence-v2', evaluatedGroups: groups.length, mappedListings: resolvedRecords.length, establishedPrefixes: [...establishedPrefixes.keys()], groups } };
}

module.exports = { apnParts, candidateMatches, groupByLocation, lotNumber, resolveGroup, resolveSingleton, resolveUnmappedParcels };
