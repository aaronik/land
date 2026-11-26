const PERIODIC_URL = 'https://data.cnra.ca.gov/dataset/periodic-groundwater-level-measurements';
const CONTINUOUS_URL = 'https://data.cnra.ca.gov/dataset/continuous-groundwater-level-measurements';
const COMPLETION_URL = 'https://data.cnra.ca.gov/dataset/well-completion-reports';
const SERIES = [
  ['periodic', 'Periodic readings'],
  ['automated', 'Automated readings (periodic archive)'],
  ['monthly', 'Monthly means (continuous archive)']
];
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const present = value => value != null && !/^(?:|n\/?a|unknown)$/i.test(String(value).trim());
const withUnit = (value, unit) => present(value) ? `${esc(value)}${unit ? ` ${esc(unit)}` : ''}` : 'Not reported';
const line = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
const fields = rows => `<dl class="groundwater-fields">${rows.map(([label, value, unit]) => line(label, withUnit(value, unit))).join('')}</dl>`;
const link = (url, title) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${title} ↗</a>`;
const format = value => value.toLocaleString('en-US', { maximumFractionDigits: 3 });
const range = (low, high, unit) => !present(low) || !present(high) ? 'Not reported' : low === high ? withUnit(low, unit) : `${esc(low)}–${withUnit(high, unit)}`;

function reportDate(raw) {
  if (!present(raw)) return '';
  const date = new Date(typeof raw === 'string' && /^-?\d+$/.test(raw) ? Number(raw) : raw);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '';
}

function originalReport(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:' && url.hostname === 'cadwr.app.box.com') return link(url.href, 'View original DWR report');
  } catch { /* No valid original report link. */ }
  return link(COMPLETION_URL, 'Search the DWR completion-report dataset');
}

export function completionCard(p) {
  return `<h3>Reported well completion</h3><p class="meta">DWR report ${withUnit(p.WCRNumber)} · ${withUnit(p.RecordType)}</p>
    ${fields([['Use', p.PlannedUseFormerUse], ['Work ended', reportDate(p.DateWorkEnded)], ['Permit date', reportDate(p.PermitDate)], ['Legacy log', p.LegacyLogNumber]])}
    <section class="sales-history"><h4>Construction and test (as reported)</h4>
    ${fields([['Completed depth', p.TotalCompletedDepth, 'ft'], ['Drilled depth', p.TotalDrillDepth, 'ft'], ['Screen top', p.TopOfPerforatedInterval, 'ft'], ['Screen bottom', p.BottomofPerforatedInterval, 'ft'], ['Casing diameter', p.CasingDiameter, 'in'], ['Drilling method', p.DrillingMethod], ['Drilling fluid', p.Fluid], ['Static water level', p.StaticWaterLevel, 'ft'], ['Test drawdown', p.TotalDrawDown, 'ft'], ['Reported yield', p.WellYield, present(p.WellYieldUnitofMeasure) ? p.WellYieldUnitofMeasure : '(unit not reported)'], ['Test type', p.TestType], ['Test duration', p.PumpTestLength, 'hr']])}</section>
    <section class="sales-history"><h4>Approximate 1-mile report summary</h4><p>${withUnit(p.NearbyReportCount)} mapped reports (may include this record and duplicates) · median completed depth ${withUnit(p.NearbyMedianDepthFt, 'ft')}<br>Static level: ${range(p.NearbyStaticLevelMinFt, p.NearbyStaticLevelMaxFt, 'ft')}<br>Yield: ${range(p.NearbyYieldMinGpm, p.NearbyYieldMaxGpm, 'GPM')}<br>Latest work-ended date: ${withUnit(p.NearbyNewestDate)}</p></section>
    ${fields([['Map location accuracy', p.LLAccuracy], ['Location method', p.MethodofDeterminationLL], ['PLSS reference', p.MTRS]])}
    <p class="source-note">These are completion or other well-work reports, not current readings. Many mapped locations are one-mile PLSS section centroids; multiple reports can share a point or describe the same well. Verify the original log. Nearby reports don’t predict parcel depth, yield, or water quality.</p><p>${originalReport(p.WCRLinks)}</p><div data-well-history></div>`;
}

const reportKey = value => String(value ?? '').trim().toUpperCase();
export function matchingStations(stations, props) {
  const ids = new Set([props.WCRNumber, props.LegacyLogNumber].map(reportKey).filter(id => /^(?:WCR\d{4}-\d+|[A-Z]?\d+)$/.test(id)));
  return Object.values(stations).filter(station => ids.has(reportKey(station.report)));
}

function stationTitle(station) {
  return station.name || station.swn || station.site;
}

function seriesChart(label, readings) {
  const first = readings[0], last = readings.at(-1);
  // Treat source-local timestamps as calendar positions. No conversion is displayed.
  const timestamp = date => Date.parse(`${date.replace(' ', 'T')}${date.length === 10 ? 'T00:00:00' : ''}Z`);
  const start = timestamp(first[0]), span = timestamp(last[0]) - start;
  const min = readings.reduce((value, [, depth]) => Math.min(value, depth), Infinity);
  const max = readings.reduce((value, [, depth]) => Math.max(value, depth), -Infinity);
  const x = date => span ? 46 + 238 * (timestamp(date) - start) / span : 165;
  const y = depth => max === min ? 50 : 16 + 68 * (depth - min) / (max - min);
  const qualified = readings.reduce((count, [, , quality]) => count + (!['Good', '1', '2'].includes(quality) ? 1 : 0), 0);
  const dots = readings.map(([date, depth, quality]) => `<circle cx="${x(date).toFixed(1)}" cy="${y(depth).toFixed(1)}" r="${readings.length > 365 ? 1.25 : 2}" class="${['Good', '1', '2'].includes(quality) ? 'well-reading' : 'well-flagged'}"/>`).join('');
  const firstDate = first[0].slice(0, 10), lastDate = last[0].slice(0, 10);
  return `<section class="sales-history"><h4>${label}</h4><p>${readings.length.toLocaleString()} ${readings.length === 1 ? 'entry' : 'entries'} · ${firstDate}${lastDate === firstDate ? '' : ` to ${lastDate}`}<br>Latest: <strong>${format(last[1])} ft</strong> (${lastDate}; ${esc(last[2] ? (/^\d+$/.test(last[2]) ? `DWR QC ${last[2]}` : last[2]) : 'quality not reported')})</p>
    <svg class="groundwater-chart" viewBox="0 0 300 106" role="img" aria-label="${label}: ${format(min)} to ${format(max)} feet below ground surface; deeper values are lower. Latest: ${format(last[1])} feet.">
    <path d="M46 12 V85 H284" fill="none" stroke="currentColor" opacity=".35"/><text x="42" y="${max === min ? 54 : 20}" text-anchor="end">${format(min)}</text>${max !== min ? `<text x="42" y="88" text-anchor="end">${format(max)}</text>` : ''}<text x="46" y="102">${firstDate.slice(0, 4)}</text>${firstDate.slice(0, 4) !== lastDate.slice(0, 4) ? `<text x="284" y="102" text-anchor="end">${lastDate.slice(0, 4)}</text>` : ''}${dots}</svg>
    <p class="source-note">Feet below ground surface; deeper plots lower.${qualified ? ` Gold: ${qualified.toLocaleString()} entries with another or unreported DWR quality designation.` : ''}</p></section>`;
}

function downloadReadings(station, document) {
  const quote = value => `"${String(value).replaceAll('"', '""')}"`;
  const rows = [['series', 'source_local_date_time', 'depth_ft_below_ground', 'dwr_quality']];
  for (const [kind, label] of SERIES) for (const reading of station[kind]) rows.push([label, ...reading]);
  const url = URL.createObjectURL(new Blob([rows.map(row => row.map(quote).join(',')).join('\r\n')], { type: 'text/csv' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `groundwater-${station.site}.csv`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createGroundwaterViewer({ details, historyUrl, fetchHistory = url => fetch(url) }) {
  let snapshot;
  const load = () => snapshot ||= Promise.resolve().then(() => fetchHistory(historyUrl)).then(response => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }).catch(error => { snapshot = undefined; throw error; });

  async function openStation(props, alternatives = []) {
    details.innerHTML = `<h3>Groundwater monitoring station</h3><p class="meta">CA DWR · ${esc(stationTitle(props))}</p>
      ${fields([['Site code', props.site], ['State well number', props.swn], ['Basin', [props.basin, props.basinCode].filter(Boolean).join(' · ')], ['Program', props.program], ['Well depth', props.depth, 'ft'], ['Use', props.use], ['Well type', props.wellType], ['DWR-linked completion reference', props.report]])}
      <div data-well-alternatives></div><div data-well-history><p role="status">Loading DWR history…</p></div>
      <p class="source-note">Station history is not a current reading or a prediction for other wells. Measurements can be irregular; the separate archives may overlap. A negative depth represents water above ground surface.</p>
      <p>${[props.swn && link(`https://wdl.water.ca.gov/StationDetails.aspx?Station=${encodeURIComponent(props.swn)}`, 'DWR station record'), link(PERIODIC_URL, 'Periodic source'), link(CONTINUOUS_URL, 'Continuous source')].filter(Boolean).join(' · ')}</p>`;
    const choices = details.querySelector('[data-well-alternatives]');
    if (alternatives.length) {
      choices.textContent = 'Other stations at this tap: ';
      for (const station of alternatives) {
        const button = choices.ownerDocument.createElement('button');
        button.type = 'button';
        button.textContent = `${stationTitle(station)} (${station.site})`;
        button.addEventListener('click', () => void openStation(station, [props, ...alternatives.filter(item => item.site !== station.site)]));
        choices.append(button);
      }
    }
    const target = details.querySelector('[data-well-history]');
    try {
      const { extract, stations } = await load();
      if (!target.isConnected) return;
      const station = stations[props.site];
      if (!station) throw new Error('Station missing from snapshot');
      const charts = SERIES.filter(([kind]) => station[kind].length).map(([kind, label]) => seriesChart(label, station[kind]));
      const screens = station.screens.map(([top, bottom]) => `${withUnit(top)} to ${withUnit(bottom)} ft`).join('; ');
      target.innerHTML = `${screens ? `<p>Screen intervals below ground: ${screens}</p>` : ''}${charts.join('') || '<p>No usable depth-to-water measurements in this snapshot.</p>'}${charts.length ? '<p><button type="button" data-well-csv>Download this station’s readings (CSV)</button></p>' : ''}<p class="source-note">Periodic archive extract: ${esc(extract)}.</p>`;
      target.querySelector('[data-well-csv]')?.addEventListener('click', () => downloadReadings(station, details.ownerDocument));
    } catch {
      if (target.isConnected) target.textContent = 'Groundwater history is unavailable. Try the DWR source links below.';
    }
  }

  async function openCompletion(props, alternatives = []) {
    details.innerHTML = completionCard(props);
    const target = details.querySelector('[data-well-history]');
    if (alternatives.length) {
      const choices = details.ownerDocument.createElement('details');
      choices.className = 'sales-history groundwater-choices';
      choices.innerHTML = `<summary>${alternatives.length} other ${alternatives.length === 1 ? 'report' : 'reports'} at this tap</summary>`;
      for (const record of alternatives) {
        const button = choices.ownerDocument.createElement('button');
        button.type = 'button';
        button.textContent = [record.WCRNumber || `Record ${record.OBJECTID}`, record.RecordType, reportDate(record.DateWorkEnded)].filter(Boolean).join(' · ');
        button.addEventListener('click', () => void openCompletion(record, [props, ...alternatives.filter(item => item.OBJECTID !== record.OBJECTID)]));
        choices.append(button);
      }
      target.before(choices);
    }
    try {
      const matched = matchingStations((await load()).stations, props);
      if (!target.isConnected || !matched.length) return;
      target.className = 'sales-history';
      target.innerHTML = '<h4>DWR-linked monitoring history</h4><p>Matched by the report number supplied by DWR, not by location.</p>';
      for (const station of matched) {
        const button = target.ownerDocument.createElement('button');
        button.type = 'button';
        button.textContent = `${stationTitle(station)} (${station.site})`;
        button.addEventListener('click', () => void openStation(station, matched.filter(item => item.site !== station.site)));
        target.append(button);
      }
    } catch { /* The report remains usable independently of the history snapshot. */ }
  }

  return { openStation, openCompletion };
}
