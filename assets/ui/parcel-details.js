'use strict';

const ZONING_QUERY_URL = 'https://services3.arcgis.com/JmPiYilyU1x5zuxM/arcgis/rest/services/CDD_Zoning_Districts_Public/FeatureServer/0/query';
const ZONING_CODE_URL = 'https://library.municode.com/ca/siskiyou_county/codes/code_of_ordinances?nodeId=TIT10PLZO';
const ZONING_EXPLANATIONS = [
  [/^AG-1(?:-|$)/, ['Prime Agriculture (AG-1)', 'AG-1 is Siskiyou County’s Prime Agriculture district. It is applied to prime agricultural land—land the County identifies for protection because of its agricultural capability and importance.', 'AG-1 and AG-2 both support agricultural uses, but AG-1 is the prime-agricultural category. If this label includes “B-40” or “B-80,” the number is a combining-district minimum parcel size in acres. Confirm uses, splits, homes, and permits with County Planning.']],
  [/^AG-2(?:-|$)/, ['Non-Prime Agriculture (AG-2)', 'AG-2 is Siskiyou County’s Non-Prime Agriculture district. It is the County’s agricultural category for land that is not designated prime agricultural land.', 'AG-2 still supports agricultural uses, but differs from AG-1 in the County’s prime-versus-non-prime agricultural-land classification. If this label includes “B-20,” “B-40,” or “B-80,” the number is a combining-district minimum parcel size in acres. Confirm uses, splits, homes, and permits with County Planning.']],
  [/^R-R/, ['Rural residential district', 'This is a Siskiyou County rural residential zoning district. It is intended for rural residential development and related uses, subject to the specific district standards and any required County approvals.', 'The suffix, if present, is part of the mapped district designation. Review the County code and verify setbacks, density, access, water, septic, and permit requirements with County Planning before relying on it.']],
  [/^RES-/, ['Residential district', 'This is a Siskiyou County residential zoning district. Residential districts regulate the type and intensity of residential development, along with related uses and development standards.', 'The exact RES district and any suffix matter. Zoning alone does not establish what can be built or divided; County Planning must confirm the rules that apply to a proposed use.']],
  [/^C-/, ['Commercial district', 'This is a Siskiyou County commercial zoning district. Commercial districts are used for business-oriented land uses, with the exact district determining which uses and development standards apply.', 'The exact designation—including any suffix—controls. Confirm allowed uses, conditional-use permits, parking, access, and building standards with County Planning.']],
  [/^M-/, ['Industrial district', 'This is a Siskiyou County industrial zoning district. Industrial districts accommodate industrial and related business uses, subject to the specific district’s use and development standards.', 'The precise designation and any suffix are important. Verify the proposed use, permit path, utilities, access, and environmental requirements with County Planning.']],
  [/^O$/, ['Open space district', 'This is Siskiyou County’s open space zoning district. Open space zoning is generally used to manage land for open-space and resource values rather than intensive development.', 'The mapped designation is only a starting point. Confirm all applicable use restrictions and approval requirements with County Planning.']],
  [/^PD/, ['Planned development district', 'This is a Siskiyou County planned development designation. Planned developments can have site-specific plans and conditions, so the parenthetical label is especially important to the applicable rules.', 'Review the adopted planned-development approval as well as the County code. County Planning can confirm the requirements for this parcel and any proposed change or new use.']],
  [/^TP/, ['Timber preserve district', 'This is a Siskiyou County timber preserve zoning district. Timber preserve zoning is intended to support long-term timber and resource management, subject to County and state requirements.', 'Zoning is not a complete forestry or development determination. Confirm the applicable County standards and any state timber, access, water, or environmental permits.']],
  [/^WETLANDS$/, ['Wetlands map designation', 'The County zoning layer identifies this area as wetlands. Wetland mapping is a screening flag and may indicate that development needs additional agency review.', 'It is not a jurisdictional wetland determination. Confirm conditions on the ground and any County, state, or federal permitting requirements before planning work.']],
  [/^(Incorporated|ROW)/, ['Not a County zoning district', 'This map label indicates incorporated area or right-of-way rather than an unincorporated Siskiyou County zoning district.', 'The relevant city or road agency—not Siskiyou County’s unincorporated-area zoning code—may control land-use rules. Confirm jurisdiction before proceeding.']]
];

export function createParcelDetails({ detailsElement, directionsOrigin, featureCenter, getApnIndex, getSaleData, wildfirePerimetersQueryUrl, recentWildfirePerimetersQueryUrl, parcelsQueryUrl, addressPointsQueryUrl, onParcelQuest, onSaveResearch, onAdjustParcel, isParcelAdjusted, onClose }) {
  const zoningByApn = new Map();
  const addressPointsByApn = new Map();
  const wildfireHistoryByApn = new Map();
  let zoningRequestId = 0;
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const money = value => value ? `$${Number(value).toLocaleString()}` : '';
  const matchingSale = apn => getSaleData()?.features.find(feature => feature.properties.APN === apn);
  const parcelQueryPoint = apn => {
    const feature = matchingSale(apn);
    if (feature) return featureCenter(feature);
    const bbox = getApnIndex()[apn]?.bbox;
    return bbox ? [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] : null;
  };
  const displayAddress = records => (records.find(record => record.kind === 'private')?.title || '').replace(/,\s*(?:CA|California)(?:\s+\d{5}(?:-\d{4})?)?\s*$/i, '').trim();
  const recordCard = (record, extraLink = '') => {
    if (record.kind === 'private') {
      const home = record.category === 'private-home';
      const mlsPhoto = /^[A-Z]{2}-[A-Z]+$/.test(String(record.mlsId || '')) && record.mlsNumber
        ? `https://idx-photos-ihouseprd.b-cdn.net/${encodeURIComponent(record.mlsId)}/${encodeURIComponent(record.mlsNumber)}/org/000.jpg?width=640`
        : (record.listingSource === 'Mt. Shasta Realty' || record.listingSource === 'Coldwell Banker Mountain Gate') && record.mlsNumber
          ? `https://idx-photos-ihouseprd.b-cdn.net/CA-SISKIYOU/${encodeURIComponent(record.mlsNumber)}/org/000.jpg?width=640`
          : '';
      const photoUrl = record.primaryPhoto || mlsPhoto;
      const primaryPhoto = photoUrl && /^https:\/\//.test(photoUrl)
        ? `<a class="record-primary-photo" href="${escapeHtml(record.url)}" target="_blank" rel="noopener" aria-label="Open listing for ${escapeHtml(record.title || 'this property')}"><img src="${escapeHtml(photoUrl)}" alt="Primary photo for ${escapeHtml(record.title || 'this property')}" loading="lazy" onerror="this.closest('a').remove()"></a>`
        : '';
      const homeDetails = home ? [record.beds && `${record.beds} bd`, record.baths && `${record.baths} ba`, record.sqft && `${Number(record.sqft).toLocaleString()} sq ft`].filter(Boolean).join(' · ') : '';
      const listingDate = /^\d{4}-\d{2}-\d{2}$/.test(record.listingDate) ? new Date(`${record.listingDate}T12:00:00`).toLocaleDateString() : '';
      return `<article class="record ${home ? 'home' : ''}">${primaryPhoto}<strong>${home ? 'Private home' : 'Private land'}</strong><p>${escapeHtml(record.title || '')}</p><p>${money(record.price)} · ${escapeHtml(record.acres || '—')} acres${homeDetails ? ` · ${escapeHtml(homeDetails)}` : ''} · ${escapeHtml(record.status || '')}${listingDate ? ` · Listed ${escapeHtml(listingDate)}` : ''}</p>${record.url ? `<a href="${escapeHtml(record.url)}" target="_blank" rel="noopener">Open listing ↗</a>` : ''}${extraLink}</article>`;
    }
    return `<article class="record public"><strong>Public auction record</strong><p>${escapeHtml(record.minimumBid || 'No parsed minimum')} · ${escapeHtml(record.status || 'Unknown status')}</p><p>${escapeHtml(record.source || '')}</p>${record.sourceUrl ? `<a href="${escapeHtml(record.sourceUrl)}" target="_blank" rel="noopener">Source PDF ↗</a>` : ''}${extraLink}</article>`;
  };
  const salesHistorySection = records => !records.length ? '<section class="sales-history"><h4>Sales history</h4><p class="muted">No matched public sold-listing history was found for this APN.</p></section>' : `<section class="sales-history"><h4>Sales history</h4>${records.map(record => `<article><strong>${money(record.soldPrice)}</strong><span>${escapeHtml(new Date(`${record.soldDate}T12:00:00`).toLocaleDateString())}</span>${record.listPrice ? `<small>Listed at ${money(record.listPrice)}</small>` : ''}<small>${escapeHtml(record.title || '')} · MLS ${escapeHtml(record.mlsNumber || '—')}</small></article>`).join('')}<p class="source-note">Public IDX sold-listing data matched to the county parcel by APN or exact county address. This is not a complete deed history.</p></section>`;
  const researchKey = apn => `shasta-land-research:${apn}`;
  const parcelQuestUsageKey = () => `siskiyou-county-lookup:${new Date().toISOString().slice(0, 7)}`;
  const parcelMapOwnerLink = () => '<a class="parcel-map-owner-link" href="https://map.parcelmap.app/california/siskiyou" target="_blank" rel="noopener noreferrer">Open on Parcel Map ↗</a>';
  const researchControls = apn => {
    if (!apn) return '';
    const saved = JSON.parse(localStorage.getItem(researchKey(apn)) || '{}');
    const opens = Number(localStorage.getItem(parcelQuestUsageKey()) || 0);
    return `<section class="research"><h4>Parcel research</h4><div class="research-actions"><button type="button" data-copy-apn>Copy APN</button><button type="button" data-parcelquest>Open on ParcelQuest ↗</button>${parcelMapOwnerLink()}</div><textarea data-research-notes rows="4" placeholder="Notes stored only in this browser">${escapeHtml(saved.notes || '')}</textarea><button type="button" data-save-research>Save private notes</button><p>ParcelQuest is Siskiyou County Assessor’s official parcel, value, and map lookup; the APN is copied before it opens. Parcel Map is a separate external owner lookup and does not support a direct parcel link. ${opens} ParcelQuest lookup${opens === 1 ? '' : 's'} opened from this browser this month.</p></section>`;
  };
  const zoningForParcel = async apn => {
    if (zoningByApn.has(apn)) return zoningByApn.get(apn);
    const point = parcelQueryPoint(apn); if (!point) return '';
    const url = new URL(ZONING_QUERY_URL);
    url.search = new URLSearchParams({ f: 'json', geometry: point.join(','), geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'zoning,zoneclass', returnGeometry: 'false' });
    const response = await fetch(url); if (!response.ok) throw new Error(`zoning query returned ${response.status}`);
    const data = await response.json(); if (data.error) throw new Error(data.error.message || 'zoning query failed');
    const zoning = [...new Set((data.features || []).map(feature => feature.attributes?.zoning || feature.attributes?.zoneclass).filter(Boolean))].join(' / ');
    zoningByApn.set(apn, zoning); return zoning;
  };
  const zoningExplanation = zoning => ZONING_EXPLANATIONS.find(([pattern]) => pattern.test(zoning))?.[1] || ['County zoning designation', 'This is the zoning designation returned by Siskiyou County’s public zoning map.', 'Review the County code and confirm the allowed uses and development standards with County Planning before relying on this map.'];
  const openZoningExplainer = zoning => {
    const [title, summary, guidance] = zoningExplanation(zoning);
    const dialog = document.createElement('dialog');
    dialog.className = 'zoning-explainer-dialog';
    dialog.innerHTML = `<button class="dialog-close" type="button" aria-label="Close zoning information">×</button><h2>${escapeHtml(zoning)}: ${escapeHtml(title)}</h2><p>${escapeHtml(summary)}</p><p>${escapeHtml(guidance)}</p><p class="source-note">This is a plain-language map aid, not a zoning determination. <a href="${ZONING_CODE_URL}" target="_blank" rel="noopener noreferrer">Read Siskiyou County Code, Title 10 ↗</a></p>`;
    dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog); dialog.showModal();
  };
  const updateParcelZoning = async apn => {
    const requestId = ++zoningRequestId, target = detailsElement.querySelector('[data-selected-zoning]'); if (!target || !apn) return;
    try {
      const zoning = await zoningForParcel(apn);
      if (requestId !== zoningRequestId || !target.isConnected) return;
      target.innerHTML = zoning ? ` · <button class="zoning-explainer-trigger" type="button" data-zoning-explainer="${escapeHtml(zoning)}" aria-label="Learn about ${escapeHtml(zoning)} zoning">${escapeHtml(zoning)}</button>` : ' · Not available';
      target.querySelector('[data-zoning-explainer]')?.addEventListener('click', event => openZoningExplainer(event.currentTarget.dataset.zoningExplainer));
    }
    catch (error) { if (requestId === zoningRequestId && target.isConnected) target.textContent = ' · Unavailable'; console.warn(error); }
  };
  const wildfireDate = value => { const timestamp = Number(value); return Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toLocaleDateString() : ''; };
  const wildfireHistoryForParcel = async apn => {
    if (wildfireHistoryByApn.has(apn)) return wildfireHistoryByApn.get(apn);
    const parcelUrl = new URL(parcelsQueryUrl);
    parcelUrl.search = new URLSearchParams({ f: 'json', where: `APN = '${String(apn).replace(/'/g, "''")}'`, outFields: 'APN', returnGeometry: 'true', outSR: '4326' });
    const parcelResponse = await fetch(parcelUrl);
    if (!parcelResponse.ok) throw new Error(`parcel geometry query returned ${parcelResponse.status}`);
    const parcelData = await parcelResponse.json();
    const geometry = parcelData.features?.[0]?.geometry;
    if (!geometry) return [];
    const fireUrl = new URL(wildfirePerimetersQueryUrl);
    const query = { f: 'json', where: "YEAR_ >= '1900' AND YEAR_ < '2019'", geometry: JSON.stringify(geometry), geometryType: 'esriGeometryPolygon', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'YEAR_,AGENCY,UNIT_ID,FIRE_NAME,ALARM_DATE,CONT_DATE,REPORT_AC,GIS_ACRES', returnGeometry: 'false', orderByFields: 'YEAR_ DESC' };
    fireUrl.search = new URLSearchParams(query);
    const recentFireUrl = new URL(recentWildfirePerimetersQueryUrl);
    recentFireUrl.search = new URLSearchParams({ ...query, where: '1=1', outFields: 'YEAR_,AGENCY,UNIT_ID,FIRE_NAME,INC_NUM,ALARM_DATE,CONT_DATE,CAUSE,GIS_ACRES,IRWINID' });
    const [fireResponse, recentFireResponse] = await Promise.all([fetch(fireUrl), fetch(recentFireUrl)]);
    if (!fireResponse.ok) throw new Error(`wildfire query returned ${fireResponse.status}`);
    if (!recentFireResponse.ok) throw new Error(`recent wildfire query returned ${recentFireResponse.status}`);
    const [fireData, recentFireData] = await Promise.all([fireResponse.json(), recentFireResponse.json()]);
    if (fireData.error) throw new Error(fireData.error.message || 'wildfire query failed');
    if (recentFireData.error) throw new Error(recentFireData.error.message || 'recent wildfire query failed');
    const unique = new Map();
    for (const fire of [...(fireData.features || []), ...(recentFireData.features || [])].map(feature => feature.attributes).filter(Boolean)) unique.set(`${fire.FIRE_NAME}|${fire.ALARM_DATE}|${fire.INC_NUM || ''}`, fire);
    const fires = [...unique.values()].sort((a, b) => Number(b.ALARM_DATE || 0) - Number(a.ALARM_DATE || 0));
    wildfireHistoryByApn.set(apn, fires);
    return fires;
  };
  const wildfireHistorySection = apn => `<section class="sales-history wildfire-history" data-wildfire-history><h4>Historic wildfire perimeters</h4><p class="muted">Checking county incident perimeters…</p></section>`;
  const officialAddress = properties => {
    const number = properties.FullAddNum || [properties.AddNum_Pre, properties.AddNumber, properties.AddNum_Suf].filter(Boolean).join('');
    const street = String(properties.FullSt_Add || '').trim();
    return (street && (!number || new RegExp(`^${String(number).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`, 'i').test(street)) ? street : [number, street].filter(Boolean).join(' ')).replace(/\s+/g, ' ').trim();
  };
  const addressPointsForParcel = async apn => {
    if (addressPointsByApn.has(apn)) return addressPointsByApn.get(apn);
    const parcelUrl = new URL(parcelsQueryUrl);
    parcelUrl.search = new URLSearchParams({ f: 'json', where: `APN = '${String(apn).replace(/'/g, "''")}'`, outFields: 'APN', returnGeometry: 'true', outSR: '4326' });
    const parcelResponse = await fetch(parcelUrl);
    if (!parcelResponse.ok) throw new Error(`parcel geometry query returned ${parcelResponse.status}`);
    const parcelData = await parcelResponse.json();
    const geometry = parcelData.features?.[0]?.geometry;
    if (!geometry) return { official: [], nearby: [] };
    const query = { f: 'json', where: '1=1', geometry: JSON.stringify(geometry), geometryType: 'esriGeometryPolygon', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'FullAddNum,FullSt_Add,MSAGComm,Post_Code,title,Longitude,Latitude', returnGeometry: 'false' };
    const officialUrl = new URL(addressPointsQueryUrl); officialUrl.search = new URLSearchParams(query);
    const officialResponse = await fetch(officialUrl);
    if (!officialResponse.ok) throw new Error(`address point query returned ${officialResponse.status}`);
    const officialData = await officialResponse.json();
    if (officialData.error) throw new Error(officialData.error.message || 'address point query failed');
    const result = { official: (officialData.features || []).map(feature => feature.attributes).filter(Boolean) };
    addressPointsByApn.set(apn, result);
    return result;
  };
  const addressPointsSection = () => '';
  const updateAddressPoints = async apn => {
    const target = detailsElement.querySelector('[data-selected-address]'); if (!target || !apn) return;
    try {
      const { official } = await addressPointsForParcel(apn);
      if (!target.isConnected) return;
      const address = [...new Set(official.map(officialAddress).filter(Boolean))][0];
      target.textContent = address || '';
      target.hidden = !address;
    } catch (error) { if (target.isConnected) { target.textContent = ''; target.hidden = true; } console.warn(error); }
  };
  const updateWildfireHistory = async apn => {
    const target = detailsElement.querySelector('[data-wildfire-history]'); if (!target || !apn) return;
    try {
      const fires = await wildfireHistoryForParcel(apn);
      if (!target.isConnected) return;
      target.innerHTML = `<h4>Historic wildfire perimeters</h4>${fires.length ? fires.map(fire => `<article><strong>${escapeHtml(fire.FIRE_NAME || 'Unnamed fire')} · ${escapeHtml(fire.YEAR_ || 'Year not reported')}</strong><span>${escapeHtml(fire.AGENCY || 'Agency not reported')}</span><small>${wildfireDate(fire.ALARM_DATE) ? `Alarmed ${escapeHtml(wildfireDate(fire.ALARM_DATE))}` : 'Alarm date not reported'}${fire.GIS_ACRES || fire.REPORT_AC ? ` · ${Number(fire.GIS_ACRES || fire.REPORT_AC).toLocaleString(undefined, { maximumFractionDigits: 1 })} mapped acres` : ''}</small></article>`).join('') : '<p class="muted">No county historic-fire perimeter intersects this parcel.</p>'}<p class="source-note">Intersection with a mapped incident perimeter—not burn severity, current fuels, damage, evacuation status, or insurance availability.</p>`;
    } catch (error) { if (target.isConnected) target.innerHTML = '<h4>Historic wildfire perimeters</h4><p class="muted">County perimeter history is temporarily unavailable.</p>'; console.warn(error); }
  };
  const parcelDirectionsLink = apn => {
    const point = parcelQueryPoint(apn); if (!point) return '';
    const url = new URL('https://www.google.com/maps/dir/');
    url.search = new URLSearchParams({ api: '1', origin: directionsOrigin, destination: `${point[1]},${point[0]}`, travelmode: 'driving' });
    return `<a class="directions-link" href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer">Directions from Mt. Shasta City Park ↗</a>`;
  };
  const bindResearchControls = apn => {
    detailsElement.querySelector('[data-copy-apn]')?.addEventListener('click', () => navigator.clipboard.writeText(apn));
    detailsElement.querySelector('[data-parcelquest]')?.addEventListener('click', () => onParcelQuest(apn));
    detailsElement.querySelector('[data-save-research]')?.addEventListener('click', () => { localStorage.setItem(researchKey(apn), JSON.stringify({ notes: detailsElement.querySelector('[data-research-notes]').value, updated: new Date().toISOString() })); onSaveResearch(apn); });
    detailsElement.querySelector('[data-adjust-parcel]')?.addEventListener('click', async event => { const button = event.currentTarget; const active = await onAdjustParcel?.(apn); button.textContent = active ? 'Hide aligned outline' : 'Show aligned outline'; });
    detailsElement.querySelector('[data-close-parcel]')?.addEventListener('click', onClose);
  };
  const showParcelDetails = (properties, saleFeature = matchingSale(properties.APN)) => {
    const p = { ...(saleFeature?.properties || {}), ...properties }, records = saleFeature?.properties.records || p.records || [], salesHistory = saleFeature?.properties.salesHistory || p.salesHistory || [];
    const directions = parcelDirectionsLink(p.APN), cards = records.map((record, index) => recordCard(record, index === 0 ? directions : '')).join('');
    detailsElement.innerHTML = `<div class="details-heading"><h3>${escapeHtml(displayAddress(records) || 'Parcel')}</h3><button class="close-parcel" type="button" data-close-parcel aria-label="Close selected parcel" title="Close selected parcel">×</button></div><p class="meta">${escapeHtml(p.Acres ?? getApnIndex()[p.APN]?.acres ?? '—')} GIS acres<span data-selected-zoning> · Zoning…</span>${p.APN ? ` · APN ${escapeHtml(p.APN)}` : ''}</p><p class="meta" data-selected-address hidden></p>${cards || `${directions}<p class="muted">Official county parcel. No current listing or auction record is attached.</p>`}${researchControls(p.APN)}${salesHistorySection(salesHistory)}${addressPointsSection()}${wildfireHistorySection(p.APN)}<section class="parcel-alignment"><h4>Align parcel outline</h4><p>Use the yellow copy to line up the county outline with field evidence. Drag the outline to move it; drag the yellow handle to rotate it. This alignment is saved in this browser only.</p><button type="button" data-adjust-parcel>${isParcelAdjusted?.(p.APN) ? 'Hide aligned outline' : 'Show aligned outline'}</button></section>`;
    updateParcelZoning(p.APN); updateAddressPoints(p.APN); updateWildfireHistory(p.APN); bindResearchControls(p.APN);
  };
  return { recordCard, showParcelDetails };
}
