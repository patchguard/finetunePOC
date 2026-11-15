// Build Overview for the Design page: a rating bar per part category and a satellite diagram of the chosen parts.
// Needs OPTIONS, LABELS and RATINGS from parts.js.
const BUILD_KEYS = ['battery', 'thruster', 'storage', 'transmitter', 'detector'];
const rateColor = v => (v >= 75 ? '#7ee0a1' : v >= 50 ? '#ffd27a' : '#ff8a8a');
const escXml = t => String(t).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const shortName = n => n.replace(/\s*\(.*?\)/g, '').slice(0, 26);

// Bar graph: one row per category plus the overall average.
function renderRatings(cfg, el) {
  const vals = BUILD_KEYS.map(k => RATINGS[k][cfg[k]]);
  const rows = BUILD_KEYS.map((k, i) => [LABELS[k], vals[i], k]);
  rows.push(['Overall', Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)]);
  el.innerHTML = '';
  for (const [label, v, k] of rows) {
    const row = document.createElement('div');
    row.className = label === 'Overall' ? 'rating overall' : 'rating';
    if (k) { row.dataset.noteCat = k; row.dataset.noteId = cfg[k]; }
    const name = document.createElement('span');
    name.textContent = label;
    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('div');
    fill.style.width = `${v}%`;
    fill.style.background = rateColor(v);
    bar.appendChild(fill);
    const num = document.createElement('span');
    num.textContent = `${v}%`;
    num.style.color = rateColor(v);
    row.append(name, bar, num);
    el.appendChild(row);
  }
}
// Satellite diagram (SVG). Each part sits in its own spot, coloured by rating, and its shape changes with the choice.
function renderSatellite(cfg, el) {
  const r = k => RATINGS[k][cfg[k]], col = k => rateColor(r(k));
  const name = k => escXml(shortName(OPTIONS[k].find(o => o.id === cfg[k]).name));
  const tx = cfg.transmitter, det = cfg.detector, laser = ['cubelct', 'scot80'].includes(tx);
  const dish = ['ewc27', 'xband', 'ewc34', 'xsdr'].includes(tx);
  const plume = 14 + r('thruster') * 0.5;                         // stronger thruster = longer flame
  const battH = 30 + Math.min(60, OPTIONS.battery.find(o => o.id === cfg.battery).cost / 2000); // pricier pack = bigger box
  let s = '';

  // Solar panels and the main body
  s += '<rect x="20" y="150" width="120" height="70" rx="4" fill="#1d3b6a" stroke="#6fa8ff"/>'
     + '<rect x="380" y="150" width="120" height="70" rx="4" fill="#1d3b6a" stroke="#6fa8ff"/>';
  for (let i = 1; i < 4; i++) s += `<line x1="${20 + i * 30}" y1="150" x2="${20 + i * 30}" y2="220" stroke="#6fa8ff" stroke-opacity=".4"/>`
     + `<line x1="${380 + i * 30}" y1="150" x2="${380 + i * 30}" y2="220" stroke="#6fa8ff" stroke-opacity=".4"/>`;
  s += '<line x1="140" y1="185" x2="180" y2="185" stroke="#9aa" stroke-width="3"/><line x1="340" y1="185" x2="380" y2="185" stroke="#9aa" stroke-width="3"/>';
  s += '<rect x="180" y="110" width="160" height="160" rx="8" fill="#22324d" stroke="#8fa3c0" stroke-width="2"/>';

  // Transmitter on top: dish, laser terminal, or whip antenna
  if (dish) s += `<line x1="260" y1="110" x2="260" y2="80" stroke="#aaa" stroke-width="3"/><path d="M225 80 Q260 40 295 80 Z" fill="${col('transmitter')}" stroke="#222"/>`;
  else if (laser) s += `<rect x="245" y="72" width="30" height="38" rx="4" fill="${col('transmitter')}" stroke="#222"/><line x1="260" y1="72" x2="260" y2="20" stroke="#ff5252" stroke-width="2" stroke-dasharray="5 4"/>`;
  else s += `<line x1="260" y1="110" x2="260" y2="40" stroke="${col('transmitter')}" stroke-width="4"/><circle cx="260" cy="38" r="5" fill="${col('transmitter')}"/>`;

  // Battery and storage inside the body
  s += `<rect x="195" y="${255 - battH}" width="55" height="${battH}" rx="4" fill="${col('battery')}" stroke="#222"/>`
     + `<rect x="212" y="${249 - battH}" width="20" height="6" fill="${col('battery')}"/>`
     + `<text x="222" y="245" font-size="11" text-anchor="middle" fill="#0a1120" font-weight="bold">BATT</text>`;
  s += `<rect x="265" y="130" width="60" height="45" rx="4" fill="${col('storage')}" stroke="#222"/>`
     + `<text x="295" y="157" font-size="11" text-anchor="middle" fill="#0a1120" font-weight="bold">DATA</text>`;

  // Detector underneath, pointing at Earth. LIDAR fires a laser; passive sensors show a viewing cone.
  s += `<rect x="235" y="270" width="50" height="22" rx="4" fill="${col('detector')}" stroke="#222"/>`;
  s += det === 'lidar'
    ? '<line x1="260" y1="292" x2="260" y2="345" stroke="#ff5252" stroke-width="3"/>'
    : `<path d="M245 292 L215 345 L305 345 L275 292 Z" fill="${col('detector')}" fill-opacity=".18"/>`;

  // Thruster on the side, flame length shows strength
  s += `<path d="M340 230 L362 222 L362 258 L340 250 Z" fill="${col('thruster')}" stroke="#222"/>`
     + `<path d="M362 228 L${362 + plume} 240 L362 252 Z" fill="#ffb347" fill-opacity=".85"/>`;

  // Labels with leader lines
  const label = (x, y, lx, ly, k, anchor) =>
    `<g data-note-cat="${k}" data-note-id="${escXml(cfg[k])}" style="cursor:help">`
    + `<line x1="${x}" y1="${y}" x2="${lx}" y2="${ly}" stroke="#5b6b85"/>`
    + `<text x="${lx}" y="${ly - 4}" font-size="12" fill="#edf4ff" text-anchor="${anchor}">${LABELS[k]} · ${r(k)}%</text>`
    + `<text x="${lx}" y="${ly + 10}" font-size="10" fill="#bac9df" text-anchor="${anchor}">${name(k)}</text></g>`;
  s += label(222, 230, 20, 300, 'battery', 'start') + label(295, 150, 500, 110, 'storage', 'end')
     + label(260, 60, 20, 40, 'transmitter', 'start') + label(260, 285, 500, 330, 'detector', 'end')
     + label(370, 240, 500, 270, 'thruster', 'end');

  el.innerHTML = `<svg viewBox="0 0 520 360" role="img" aria-label="Satellite build diagram" style="width:100%;background:#0b1424;border-radius:12px">${s}</svg>`;
}
