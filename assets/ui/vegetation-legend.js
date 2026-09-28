// The LANDFIRE EVT service renders the RGB values in its official 2025 CSV.
// Class colors are not unique: different ecological systems can share a swatch.
export function buildVegetationLegend(root, classes) {
  const container = root.querySelector('.vegetation-legend-classes');
  const status = root.querySelector('.vegetation-legend-status');
  const fragment = root.createDocumentFragment();
  const entries = Object.entries(classes).filter(([code, item]) => /^\d+$/.test(code) && item.name && /^#[0-9a-f]{6}$/i.test(item.color || ''));
  entries.sort((a, b) => a[1].name.localeCompare(b[1].name) || Number(a[0]) - Number(b[0]));
  for (const [code, item] of entries) {
    const row = root.createElement('span');
    row.dataset.vegetationCode = code;
    const swatch = root.createElement('i');
    swatch.style.setProperty('--key-color', item.color);
    swatch.setAttribute('aria-hidden', 'true');
    row.append(swatch, root.createTextNode(item.name));
    fragment.append(row);
  }
  container.replaceChildren(fragment);
  status.textContent = `${entries.length} official LANDFIRE classes · tap the map to find its class.`;
}

export function highlightVegetationLegend(root, code) {
  const container = root.querySelector('.vegetation-legend-classes');
  const old = container.querySelector('.vegetation-selected');
  old?.classList.remove('vegetation-selected');
  const row = code ? [...container.children].find(item => item.dataset.vegetationCode === String(code)) : null;
  row?.classList.add('vegetation-selected');
  if (row) container.scrollTop = row.offsetTop - container.offsetTop - Math.round(container.clientHeight / 3);
  return row || null;
}
