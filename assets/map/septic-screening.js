import snapshot from '../data/septic-screening.json' with { type: 'json' };

export const SEPTIC_LAYER_ID = 'septic-screening';
const COLORS = {
  'Not limited': '#318f79',
  'Somewhat limited': '#d49a31',
  'Very limited': '#b74d67',
  'Not rated': '#92949c'
};
const PROGRAM_URL = 'https://www.siskiyoucounty.gov/environmentalhealth/page/individual-sewage-disposal';
const INQUIRY_URL = 'https://www.siskiyoucounty.gov/sites/default/files/fileattachments/environmental_health/page/1361/property_information_inquiry_form.pdf';

export function septicColorExpression() {
  const keysByRating = Object.entries(COLORS).filter(([rating]) => rating !== 'Not rated').map(([rating, color]) => ({
    color, keys: Object.keys(snapshot.mapUnits).filter(key => snapshot.mapUnits[key]?.[0] === rating)
  }));
  return ['match', ['to-string', ['get', 'mukey']], ...keysByRating.filter(({ keys }) => keys.length).flatMap(({ keys, color }) => [keys, color]), COLORS['Not rated']];
}

export function septicRating(mukey) {
  const key = String(mukey ?? '');
  if (!Object.hasOwn(snapshot.mapUnits, key)) return { label: 'No matching SSURGO rating', reasons: [] };
  const record = snapshot.mapUnits[key];
  if (!record) return { label: 'Not rated', reasons: [] };
  const [label, share, reasons] = record;
  return { label, share, reasons };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

export function septicPopupHtml(properties) {
  const { label, share, reasons } = septicRating(properties.mukey);
  const context = [properties.muname, properties.mukey ? `Map unit ${properties.mukey}` : ''].filter(Boolean).map(escapeHtml).join(' · ');
  const factors = reasons.length ? `<p>Reported limitations:</p><ul>${reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>` : '';
  return `<section class="septic-popup-content"><h3>Septic tank absorption fields</h3>${context ? `<p class="meta">${context}</p>` : ''}<p><strong>${escapeHtml(label)}</strong>${share ? ` · ${share}% of the map unit’s estimated soil composition carries this class` : ''}</p>${factors}<p class="source-note"><a href="https://websoilsurvey.nrcs.usda.gov/" target="_blank" rel="noopener noreferrer">USDA NRCS SSURGO</a> · ${snapshot.retrieved} snapshot. Mapped soil screening only; not a perc test, a system design, or a permit decision. Verify on site.</p></section>`;
}

export function septicPermitHistoryHtml(apn) {
  if (!apn) return '';
  return `<section class="sales-history"><h4>Septic permit history</h4><p>No verified public permit history is available in this map. That does not mean there is no permit or septic system.</p><p>Enter APN <strong>${escapeHtml(apn)}</strong> and check “Septic” on the County’s <a href="${INQUIRY_URL}" target="_blank" rel="noopener noreferrer">Property Information Inquiry Form (PDF) ↗</a>, then send it to Environmental Health as directed on the form. <a href="${PROGRAM_URL}" target="_blank" rel="noopener noreferrer">County sewage disposal program ↗</a></p></section>`;
}
