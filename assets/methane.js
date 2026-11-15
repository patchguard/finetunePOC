// Methane Hotspots page: CarbonTracker-CH4 monthly flux from the US Greenhouse Gas Center, on a 3D globe (globe.gl)
// textured with NASA GIBS Blue Marble. Point values come from the GHG Center point API and are cached in localStorage.
const GHG = 'https://earth.gov/ghgcenter/api/raster/collections/ct-ch4-monthgrid-v2025/items';
// Whole-Earth NASA GIBS Blue Marble (equirectangular), used as the globe's surface.
const BASE = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=BlueMarble_NextGeneration&STYLES=&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH=2048&HEIGHT=1024&FORMAT=image/jpeg';
const RANGE = { total: 50, fossil: 50, microbial: 30, pyrogenic: 8 }; // colour scale max per source (g/m²/yr)
const CACHE_KEY = 'cfx.ch4Cache.v1';
const LAST = 311; // 2023-12, the latest month published

// Known methane regions to rank (sample point near the centre of each).
const REGIONS = [
  { name: 'Permian Basin, USA', lat: 32.0, lon: -103.0 },
  { name: 'Appalachia (Marcellus), USA', lat: 40.5, lon: -79.5 },
  { name: 'Alberta oil sands, Canada', lat: 57.0, lon: -111.5 },
  { name: 'Turkmenistan gas fields', lat: 39.0, lon: 55.0 },
  { name: 'Basra oil fields, Iraq', lat: 30.5, lon: 47.5 },
  { name: 'Shanxi coal, China', lat: 37.5, lon: 112.5 },
  { name: 'West Siberia gas, Russia', lat: 64.0, lon: 75.0 },
  { name: 'Indo-Gangetic Plain, India', lat: 26.5, lon: 80.5 },
  { name: 'Bangladesh rice & wetlands', lat: 23.7, lon: 90.4 },
  { name: 'Niger Delta, Nigeria', lat: 5.0, lon: 6.5 },
  { name: 'Congo Basin wetlands', lat: 0.5, lon: 18.0 },
  { name: 'Amazon wetlands, Brazil', lat: -3.0, lon: -60.0 },
  { name: 'Pantanal, Brazil', lat: -17.5, lon: -57.0 },
  { name: 'Sudd wetland, South Sudan', lat: 7.5, lon: 30.5 },
  { name: 'Hassi R\'Mel, Algeria', lat: 32.9, lon: 3.3 },
  { name: 'Netherlands & Ruhr, Europe', lat: 51.5, lon: 6.5 }
];

const $ = id => document.getElementById(id);
const monthId = i => `${1998 + Math.floor(i / 12)}${String(i % 12 + 1).padStart(2, '0')}`;
const monthLabel = i => new Date(Date.UTC(1998 + Math.floor(i / 12), i % 12, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const readCache = () => { try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { return {}; } };

// ---------- 3D globe (globe.gl) ----------
const globeEl = $('globe');
const globe = Globe()(globeEl)
  .width(globeEl.clientWidth).height(480)
  .backgroundColor('#091121')
  .showAtmosphere(true).atmosphereColor('#6fa8ff').atmosphereAltitude(0.15)
  .pointColor(() => '#ff4fa0').pointRadius(0.6)
  .pointLabel(d => `<b>${d.name}</b><br>${d.v.toFixed(1)} g/m²/yr`)
  .ringColor(() => '#ffffff').ringMaxRadius(3).ringPropagationSpeed(2).ringRepeatPeriod(900);
globe.pointOfView({ lat: 25, lng: 10, altitude: 2.2 });
// Slow auto-spin until the user grabs the globe.
globe.controls().autoRotate = true;
globe.controls().autoRotateSpeed = 0.4;
globeEl.addEventListener('pointerdown', () => { globe.controls().autoRotate = false; });
window.addEventListener('resize', () => globe.width(globeEl.clientWidth));

const loadImg = url => new Promise((resolve, reject) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('image failed to load'));
  img.src = url;
});
let earthImg = null;
const earthReady = loadImg(BASE).then(img => (earthImg = img)).catch(() => null);

// Whole-world methane image for one month/source (equirectangular, same layout as the Earth image).
const fluxImageUrl = (i, src) =>
  `${GHG}/ct-ch4-monthgrid-v2025-${monthId(i)}/bbox/-180,-90,180,90/1024x512.png?assets=${src}&rescale=0,${RANGE[src]}&colormap_name=purd`;

// Paints Earth, then methane on top. Low methane is made transparent so the planet shows through.
function composeTexture(flux) {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 1024;
  const ctx = c.getContext('2d');
  if (earthImg) ctx.drawImage(earthImg, 0, 0, c.width, c.height);
  else { ctx.fillStyle = '#0b2545'; ctx.fillRect(0, 0, c.width, c.height); }
  const m = document.createElement('canvas');
  m.width = flux.width; m.height = flux.height;
  const mctx = m.getContext('2d');
  mctx.drawImage(flux, 0, 0);
  const px = mctx.getImageData(0, 0, m.width, m.height), d = px.data;
  for (let k = 0; k < d.length; k += 4) {
    const strength = 1 - (0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2]) / 255; // purd: darker = more methane
    d[k + 3] = d[k + 3] ? Math.round(Math.min(1, strength * 1.8) * 230) : 0;
  }
  mctx.putImageData(px, 0, 0);
  ctx.drawImage(m, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.9);
}

let monthReq = 0;
async function showMonth() {
  const i = +$('month').value, src = $('source').value, req = ++monthReq;
  $('monthOut').textContent = monthLabel(i);
  $('midLabel').textContent = RANGE[src] / 2;
  $('maxLabel').textContent = `${RANGE[src]}+`;
  $('globeStatus').textContent = 'Loading methane data…';
  await earthReady;
  try {
    const flux = await loadImg(fluxImageUrl(i, src));
    if (req !== monthReq) return; // a newer month/source was chosen meanwhile
    globe.globeImageUrl(composeTexture(flux));
    $('globeStatus').textContent = `${$('source').selectedOptions[0].text} · ${monthLabel(i)}${earthImg ? '' : ' (NASA base image unavailable)'}`;
  } catch {
    if (req === monthReq) $('globeStatus').textContent = `Couldn't load methane data for ${monthLabel(i)}.`;
  }
}

// Point value: g CH4/m²/yr for one source at one place and month. Cached so it isn't downloaded twice.
async function pointValue(lat, lon, i, src) {
  const key = `${monthId(i)}:${src}:${lat.toFixed(2)},${lon.toFixed(2)}`, cache = readCache();
  if (cache[key] != null) return cache[key];
  const r = await fetch(`${GHG}/ct-ch4-monthgrid-v2025-${monthId(i)}/point/${lon.toFixed(3)},${lat.toFixed(3)}?assets=${src}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const v = Math.max(0, (await r.json()).values[0] || 0);
  cache[key] = +v.toFixed(3);
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* storage full */ }
  return cache[key];
}
globe.onGlobeClick(async ({ lat, lng }) => {
  const lon = ((lng + 540) % 360) - 180;
  globe.ringsData([{ lat, lng }]);
  const where = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
  $('pointInfo').textContent = `${where}: loading…`;
  try {
    const v = await pointValue(lat, lon, +$('month').value, $('source').value);
    $('pointInfo').textContent = `📍 ${where}: ${v.toFixed(2)} g/m²/yr (${$('source').selectedOptions[0].text}, ${monthLabel(+$('month').value)})`;
  } catch (err) { $('pointInfo').textContent = `📍 ${where}: couldn't read this point (${err.message}).`; }
});

// ---------- ranking ----------
let rankReq = 0;
async function rankRegions() {
  const i = +$('month').value, src = $('source').value, req = ++rankReq;
  $('rankStatus').textContent = 'Reading methane values for each region…';
  const vals = await Promise.all(REGIONS.map(async g => {
    try { return { ...g, v: await pointValue(g.lat, g.lon, i, src) }; } catch { return { ...g, v: null }; }
  }));
  if (req !== rankReq) return; // a newer month/source was chosen meanwhile
  const ok = vals.filter(g => g.v != null).sort((a, b) => b.v - a.v).slice(0, 10);
  const top = (ok[0] && ok[0].v) || 1;
  $('ranking').innerHTML = '';
  ok.forEach((g, n) => {
    const row = document.createElement('div');
    row.className = 'rank';
    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('div');
    fill.style.width = `${g.v / top * 100}%`;
    fill.style.background = '#e7298a';
    bar.appendChild(fill);
    const span = t => Object.assign(document.createElement('span'), { textContent: t });
    row.append(span(`${n + 1}.`), span(g.name), bar, span(g.v.toFixed(1)));
    row.onclick = () => { globe.controls().autoRotate = false; globe.pointOfView({ lat: g.lat, lng: g.lon, altitude: 1.1 }, 1200); };
    $('ranking').appendChild(row);
  });
  // Spikes on the globe: taller = more methane.
  globe.pointsData(ok.map(g => ({ ...g, lng: g.lon })))
    .pointAltitude(d => 0.02 + 0.35 * d.v / top);
  const failed = vals.length - ok.length;
  $('rankStatus').textContent = `${$('source').selectedOptions[0].text}, ${monthLabel(i)} (g/m²/yr).${failed ? ` ${failed} region(s) couldn't be read.` : ''}`;
}

// ---------- controls ----------
let timer = null;
function refresh() { showMonth(); rankRegions(); }
$('month').value = LAST;
$('month').addEventListener('input', showMonth);    // map follows the slider while dragging
$('month').addEventListener('change', rankRegions); // ranking updates when released
$('source').addEventListener('change', refresh);
$('playBtn').onclick = () => {
  if (timer) { clearTimeout(timer); timer = null; $('playBtn').textContent = '▶ Play'; rankRegions(); return; }
  $('playBtn').textContent = '❚❚ Pause';
  // Each month repaints the whole globe, so wait for one to finish before starting the next.
  const step = async () => {
    $('month').value = (+$('month').value + 1) % (LAST + 1);
    await showMonth();
    if (timer) timer = setTimeout(step, 700);
  };
  timer = setTimeout(step, 0);
};
refresh();
