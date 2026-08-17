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

async function resolveUnmappedParcels(records, queryNearbyParcels, options = {}) {
  const remaining = new Set(records);
  const resolvedRecords = [];
  const groups = [];
  for (const group of groupByLocation(records)) {
    let parcels = [];
    try {
      parcels = await queryNearbyParcels(group.latLng);
    } catch (error) {
      groups.push({ latLng: group.latLng, mlsNumbers: group.records.map(record => record.mlsNumber), status: 'query_failed', reason: error.message });
      continue;
    }
    const result = resolveGroup(group, parcels, options);
    for (const match of result.resolved) {
      const evidence = {
        resolver: 'subdivision-lot-sequence-v1',
        lotNumber: match.lot,
        listedAcres: Number(match.record.acres),
        gisAcres: Number(match.parcel.acres),
        apnPrefix: match.prefix,
        corroboratingMlsNumbers: result.resolved.map(item => item.record.mlsNumber)
      };
      const resolved = {
        ...match.record,
        APN: match.parcel.apn,
        parcelMatchSource: 'deterministic secondary resolver: lot/APN sequence + exact acreage',
        parcelMatchConfidence: 'high; assessor/title confirmation pending',
        parcelMatchEvidence: evidence
      };
      delete resolved.latLng;
      delete resolved.locationSource;
      delete resolved.category;
      remaining.delete(match.record);
      resolvedRecords.push(resolved);
    }
    groups.push({
      latLng: group.latLng,
      mlsNumbers: group.records.map(record => record.mlsNumber),
      status: result.resolved.length ? 'auto_mapped' : 'unresolved',
      reason: result.reason,
      assignments: result.resolved.map(match => ({ mlsNumber: match.record.mlsNumber, lotNumber: match.lot, apn: match.parcel.apn, listedAcres: match.record.acres, gisAcres: match.parcel.acres }))
    });
  }
  return { resolved: resolvedRecords, unmapped: records.filter(record => remaining.has(record)), report: { resolver: 'subdivision-lot-sequence-v1', evaluatedGroups: groups.length, mappedListings: resolvedRecords.length, groups } };
}

module.exports = { apnParts, candidateMatches, groupByLocation, lotNumber, resolveGroup, resolveUnmappedParcels };
