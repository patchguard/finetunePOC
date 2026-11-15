/* =========================================================================
   Shared by the game's Methane Emissions map (view-map.js) and the mission
   report on feedback.html (report.js), so both maps look exactly the same:
   colour scales, legends, country borders.
   No page code; everything sits inside MAPC so it can't clash with other scripts.
   ========================================================================= */

const MAPC = (() => {
  // single-hue ramps: dim (near zero) → bright (high) on the dark map surface
  const RAMPS = {
    emissions: ['#2b1608', '#4d230b', '#73320e', '#9c4312', '#c65618', '#ec6d24', '#ff9150', '#ffbb8a'],
    intensity: ['#2b1608', '#4d230b', '#73320e', '#9c4312', '#c65618', '#ec6d24', '#ff9150', '#ffbb8a'],
    warming: ['#2a0e14', '#4a1420', '#6e1a2b', '#931f35', '#b9283f', '#da3a4c', '#f1606a', '#ff9ea2'],
    policy: ['#0b2117', '#0f3524', '#124a31', '#16613f', '#1a7a4e', '#21945e', '#2fb072', '#5fd196'],
    // diverging: teal = emissions falling, neutral grey = unchanged, red = rising
    trend: ['#1f8a9e', '#3aa5b6', '#6cc0cc', '#a3d8de', '#5a606c', '#eaa3a3', '#dc6f6f', '#c94444', '#a32222'],
    site: ['#4d230b', '#73320e', '#9c4312', '#c65618', '#ec6d24', '#ff9150', '#ffbb8a', '#ffe2c8'],
  };
  const SCALES = {
    emissions: { title: 'Methane emissions (Mt CH₄ / year)', min: 0.2, max: 70, log: true, fmt: v => v < 1 ? v.toFixed(1) : v.toFixed(0) },
    intensity: { title: 'Emissions per area (t CH₄ / km² / year)', min: 0.3, max: 30, log: true, fmt: v => v.toFixed(v < 1 ? 1 : 0) },
    warming: { title: 'Local warming vs pre-industrial (°C)', min: 0.8, max: 5, log: false, fmt: v => v.toFixed(1) },
    policy: { title: 'Leak-control policy strength (% of emissions cut)', min: 0, max: 45, log: false, fmt: v => v.toFixed(0) },
    trend: { title: 'Emissions now vs the start of the game (%)', min: -40, max: 40, log: false, fmt: v => (v > 0 ? '+' : '') + v.toFixed(0) },
    site: { title: 'Methane from each site region (t/h)', min: 5, max: 1500, log: true, fmt: v => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(0) },
  };
  const RING = { r: '#ff5d6c', b: '#4cc3ff', g: '#3ddc84', w: '#ffffff' };
  const clampN = (x, a, b) => Math.max(a, Math.min(b, x));

  function rampColor(mode, v) {
    const s = SCALES[mode], r = RAMPS[mode];
    if (v == null || !isFinite(v)) return null;
    let f = s.log ? (Math.log(Math.max(v, s.min)) - Math.log(s.min)) / (Math.log(s.max) - Math.log(s.min)) : (v - s.min) / (s.max - s.min);
    f = clampN(f, 0, 0.999);
    return r[Math.floor(f * r.length)];
  }
  function legendHTML(mode, extraEnds = false) {
    const s = SCALES[mode], r = RAMPS[mode];
    const mid = s.log ? Math.sqrt(s.min * s.max) : (s.min + s.max) / 2;
    const trend = mode === 'trend';
    return `<div class="title">${s.title}</div><div class="ramp" style="background:linear-gradient(90deg,${r.join(',')})"></div>
      <div class="ends"><span>${s.fmt(s.min)}${trend ? ' falling' : ''}</span><span>${s.fmt(mid)}</span><span>${s.fmt(s.max)}${trend ? ' rising' : '+'}</span></div>`;
  }
  // circle size for a site: by active leak flow (source view) or by total regional emissions (amount view)
  const siteRadius = (mode, leakRate, total) => mode === 'amount' ? 4 + Math.log10(total + 1) * 4 : 4 + Math.sqrt(leakRate + 0.5) * 1.6;

  /* ---------- geometry ---------- */
  function ringArea(ring) { // km², spherical approximation
    let a = 0;
    for (let i = 0; i < ring.length; i++) {
      const [l1, p1] = ring[i], [l2, p2] = ring[(i + 1) % ring.length];
      a += (l2 - l1) * Math.PI / 180 * (2 + Math.sin(p1 * Math.PI / 180) + Math.sin(p2 * Math.PI / 180));
    }
    return Math.abs(a * 6371 * 6371 / 2);
  }
  function featureStats(f) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let area = 0, latSum = 0, n = 0, biggest = 0, cLat = 0;
    for (const p of polys) {
      const a = ringArea(p[0]); area += a;
      if (a > biggest) { biggest = a; let s = 0; p[0].forEach(c => { s += c[1]; }); cLat = s / p[0].length; }
      p[0].forEach(c => { latSum += c[1]; n++; });
    }
    return { area, lat: cLat || latSum / Math.max(1, n) };
  }

  // Country borders (Natural Earth 1:110m via world-atlas). Countries that cross the 180° meridian
  // (Russia, Fiji…) would smear a stripe across the map, so their rings are unwrapped.
  let countriesPromise = null;
  function loadCountries() {
    if (countriesPromise) return countriesPromise;
    countriesPromise = fetch('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json').then(r => r.json()).then(topo => {
      const features = topojson.feature(topo, topo.objects.countries).features;
      features.forEach(f => {
        const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
        polys.forEach(p => p.forEach(ring => {
          const lons = ring.map(c => c[0]);
          if (Math.max(...lons) - Math.min(...lons) > 180) ring.forEach(c => { if (c[0] < 0) c[0] += 360; });
        }));
        const st = featureStats(f); f.properties._area = st.area; f.properties._lat = st.lat;
      });
      return features;
    });
    countriesPromise.catch(() => { countriesPromise = null; });
    return countriesPromise;
  }
  // a fresh copy (each Leaflet map needs its own GeoJSON objects)
  const cloneFeatures = features => features.map(f => ({ ...f, properties: { ...f.properties } }));

  return { RAMPS, SCALES, RING, rampColor, legendHTML, siteRadius, featureStats, loadCountries, cloneFeatures };
})();
