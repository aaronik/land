// Soil particle percentages describe the component/horizon at the selected
// map unit, not a constant value for every polygon of a texture class.
export const SOIL_PARTICLES = ['sand', 'silt', 'clay'];

export function soilParticleText(properties, particle) {
  const value = properties?.[`${particle}_pct`];
  return typeof value === 'number' && Number.isFinite(value) ? `${value}%` : 'Not reported';
}

export function buildSoilLegend(root) {
  const key = root.querySelector('.soil-texture-key');
  for (const span of [...key.querySelectorAll(':scope > span')].filter(row => row.querySelector('i'))) {
    const texture = span.textContent.trim();
    span.dataset.soilTexture = texture === 'Not rated / other' ? 'Not rated' : texture;
    span.classList.add('soil-texture-heading');
    let previous = span;
    for (const particle of SOIL_PARTICLES) {
      const row = root.createElement('span');
      row.className = 'soil-particle-row';
      row.dataset.soilTexture = span.dataset.soilTexture;
      row.dataset.soilParticle = particle;
      row.style.setProperty('--soil-base', span.querySelector('i').style.getPropertyValue('--key-color'));
      const swatch = root.createElement('i');
      swatch.setAttribute('aria-hidden', 'true');
      const name = root.createElement('span');
      name.textContent = particle[0].toUpperCase() + particle.slice(1);
      const output = root.createElement('output');
      output.textContent = '—';
      row.append(swatch, name, output);
      previous.after(row);
      previous = row;
    }
  }
}

export function updateSoilLegendValues(root, properties) {
  for (const row of root.querySelectorAll('.soil-particle-row')) {
    row.querySelector('output').textContent = properties && (properties.texture_group || 'Not rated') === row.dataset.soilTexture
      ? soilParticleText(properties, row.dataset.soilParticle) : '—';
  }
}
