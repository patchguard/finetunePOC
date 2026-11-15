/* =========================================================================
   Methane Emissions map (Leaflet + NASA GIBS + simulated choropleth)
   ========================================================================= */

const MapView = (() => {
  let map, base, labels, countryLayer, siteLayer, trackLayer, satLayer, gsLayer, nightLayer;
  let features = [], choro = 'emissions', baseKey = 'bluemarble', siteMode = 'source';
  const overlays = {}; const onOverlays = new Set();
  let selected = null; // { kind: 'country'|'site', id }
  let lastTracks = 0, lastSats = 0, lastChoro = 0;

  // colour scales and border loading are shared with the mission report (map-common.js)
  const { RAMPS, SCALES, rampColor, featureStats } = MAPC;

  // Arctic amplification and land/ocean contrast (land warms ~1.5× the global mean, the Arctic ~3–4×)
  function localWarming(lat) {
    const dT = SIM.state.climate.dT;
    const amp = lat > 60 ? 2.6 + (lat - 60) / 30 * 1.2 : lat > 40 ? 1.6 + (lat - 40) / 20 : lat < -60 ? 1.2 : 1.35;
    return dT * amp;
  }

  function valueFor(f, mode) {
    const iso = String(+f.id);
    const e = SIM.countryEmission(iso);
    if (mode === 'emissions') return e ? e.now : null;
    if (mode === 'intensity') return e ? e.now * 1e6 / f.properties._area : null;
    if (mode === 'warming') return localWarming(f.properties._lat);
    if (mode === 'policy') return e ? e.mitigation * 100 : null;
    if (mode === 'trend') return e ? e.trend * 100 : null;
    return null;
  }

  function styleCountry(f) {
    if (choro === 'none') return { stroke: true, color: 'rgba(200,220,255,.25)', weight: 0.6, fillOpacity: 0 };
    const v = valueFor(f, choro);
    const col = rampColor(choro, v);
    const sel = selected && selected.kind === 'country' && selected.id === f.id;
    return { stroke: true, color: sel ? '#ffffff' : 'rgba(200,220,255,.28)', weight: sel ? 2 : 0.6, fillColor: col || '#000', fillOpacity: col ? 0.62 : 0 };
  }

  function legendHTML() {
    if (choro === 'none') return '';
    const s = SCALES[choro], r = RAMPS[choro];
    const mid = s.log ? Math.sqrt(s.min * s.max) : (s.min + s.max) / 2;
    return `<div class="title">${s.title}</div><div class="ramp" style="background:linear-gradient(90deg,${r.join(',')})"></div>
      <div class="ends"><span>${s.fmt(s.min)}${choro === 'trend' ? ' falling' : ''}</span><span>${s.fmt(mid)}</span><span>${s.fmt(s.max)}${choro === 'trend' ? ' rising' : '+'}</span></div>`;
  }

  /* ---------- init ---------- */
  async function init() {
    map = L.map('map', { worldCopyJump: true, minZoom: 2, zoomControl: false, preferCanvas: false }).setView([25, 20], 2);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    map.createPane('countries').style.zIndex = 350;
    map.createPane('night').style.zIndex = 360;
    map.createPane('tracks').style.zIndex = 420;
    setBase('bluemarble');
    labels = NASA_GIBS.leafletLayer('labels');

    // base & overlay pickers
    $('#base-seg').innerHTML = ['bluemarble', 'truecolor', 'night'].map(k => `<button data-base="${k}" class="${k === baseKey ? 'on' : ''}">${NASA_GIBS.LAYERS[k].title.split(' (')[0]}</button>`).join('');
    $('#base-seg').addEventListener('click', e => { const b = e.target.closest('[data-base]'); if (b) setBase(b.dataset.base); });
    const ovs = ['methane', 'co', 'sst', 'lst', 'clouds', 'labels'];
    $('#gibs-overlays').innerHTML = ovs.map(k => `<button class="chip" data-ov="${k}">${NASA_GIBS.LAYERS[k].title}</button>`).join('');
    $('#gibs-overlays').addEventListener('click', e => {
      const b = e.target.closest('[data-ov]'); if (!b) return;
      const k = b.dataset.ov;
      onOverlays.has(k) ? onOverlays.delete(k) : onOverlays.add(k);
      syncOverlays();
    });
    const dIn = $('#gibs-date'); dIn.value = NASA_GIBS.isoDay(1); dIn.max = NASA_GIBS.isoDay(0);
    dIn.addEventListener('change', () => setBase(baseKey, true));

    $('#choro-seg').addEventListener('click', e => {
      const b = e.target.closest('[data-choro]'); if (!b) return;
      choro = b.dataset.choro;
      $$('#choro-seg button').forEach(x => x.classList.toggle('on', x === b));
      recolor(); $('#choro-legend').innerHTML = legendHTML();
    });
    $('#choro-legend').innerHTML = legendHTML();
    $('#site-seg').addEventListener('click', e => {
      const b = e.target.closest('[data-sm]'); if (!b) return;
      siteMode = b.dataset.sm;
      $$('#site-seg button').forEach(x => x.classList.toggle('on', x === b));
      drawSites(); $('#site-legend').innerHTML = siteLegendHTML();
    });
    $('#site-legend').innerHTML = siteLegendHTML();

    siteLayer = L.layerGroup().addTo(map);
    trackLayer = L.layerGroup({ pane: 'tracks' }).addTo(map);
    satLayer = L.layerGroup().addTo(map);
    gsLayer = L.layerGroup();
    nightLayer = L.layerGroup().addTo(map);
    GROUND_STATIONS.forEach(gs => L.circleMarker([gs.lat, gs.lon], { radius: 5, color: gs.optical ? '#c792ff' : '#9ad1ff', weight: 2, fillOpacity: 0.3 })
      .bindTooltip(`📡 ${esc(gs.name)}${gs.optical ? ' (laser)' : ''}`).addTo(gsLayer));
    $('#lyr-sites').addEventListener('change', e => e.target.checked ? siteLayer.addTo(map) : map.removeLayer(siteLayer));
    $('#lyr-tracks').addEventListener('change', e => { e.target.checked ? trackLayer.addTo(map) : map.removeLayer(trackLayer); });
    $('#lyr-swath').addEventListener('change', () => { lastTracks = 0; drawTracks(); });
    $('#lyr-gs').addEventListener('change', e => e.target.checked ? gsLayer.addTo(map) : map.removeLayer(gsLayer));
    $('#lyr-night').addEventListener('change', e => e.target.checked ? nightLayer.addTo(map) : map.removeLayer(nightLayer));
    map.on('zoomend', () => { lastTracks = 0; drawTracks(); });

    drawSites();
    renderDetail();
    try {
      features = await MAPC.loadCountries();
      countryLayer = L.geoJSON({ type: 'FeatureCollection', features }, {
        pane: 'countries', style: styleCountry,
        onEachFeature: (f, layer) => {
          layer.on('click', () => { selected = { kind: 'country', id: f.id, f }; recolor(); renderDetail(); });
          layer.on('mouseover', () => layer.setStyle({ weight: 1.6, color: '#ffffff' }));
          layer.on('mouseout', () => countryLayer.resetStyle(layer));
          layer.bindTooltip(() => tooltipFor(f), { sticky: true });
        },
      }).addTo(map);
    } catch (err) {
      UI.toast('Could not load country borders: ' + err.message, 'bad');
    }
  }

  function tooltipFor(f) {
    const v = valueFor(f, choro === 'none' ? 'emissions' : choro);
    const s = SCALES[choro === 'none' ? 'emissions' : choro];
    return `<b>${esc(f.properties.name)}</b><br>${s.title.split(' (')[0]}: <span class="mono">${v == null ? 'no data' : s.fmt(v)}${choro === 'policy' ? '%' : choro === 'warming' ? '°C' : ''}</span>`;
  }

  function setBase(key, force) {
    if (baseKey === key && base && !force) return;
    baseKey = key;
    if (base) map.removeLayer(base);
    base = NASA_GIBS.leafletLayer(key, $('#gibs-date').value).addTo(map);
    base.bringToBack();
    $$('#base-seg button').forEach(b => b.classList.toggle('on', b.dataset.base === key));
    $('#gibs-date').disabled = NASA_GIBS.LAYERS[key].time !== 'daily';
  }
  function syncOverlays() {
    ['methane', 'co', 'sst', 'lst', 'clouds'].forEach(k => {
      if (onOverlays.has(k) && !overlays[k]) overlays[k] = NASA_GIBS.leafletLayer(k).addTo(map);
      if (!onOverlays.has(k) && overlays[k]) { map.removeLayer(overlays[k]); delete overlays[k]; }
    });
    if (onOverlays.has('labels')) labels.addTo(map); else map.removeLayer(labels);
    $$('#gibs-overlays .chip').forEach(c => c.classList.toggle('on', onOverlays.has(c.dataset.ov)));
    const leg = [...onOverlays].map(k => ({ key: k, ...NASA_GIBS.LAYERS[k] })).filter(l => l.legend);
    $('#gibs-legend').innerHTML = leg.map(l => `<div class="fine" style="margin-top:8px">${esc(l.title)}</div><img alt="${esc(l.title)} colour scale" src="${NASA_GIBS.legendUrl(l.key)}">`).join('');
  }

  function recolor() { if (countryLayer) countryLayer.setStyle(styleCountry); lastChoro = performance.now(); }

  /* ---------- sites ---------- */
  function siteLegendHTML() {
    const ring = '<div style="margin-top:6px">Ring: <span style="color:#ff5d6c">red</span> = big leak nobody has reported · <span style="color:#4cc3ff">blue</span> = reported, awaiting repair · <span style="color:#3ddc84">green</span> = repaired.</div>';
    if (siteMode === 'amount') {
      const s = SCALES.site, r = RAMPS.site;
      return `<div class="title">${s.title}</div><div class="ramp" style="background:linear-gradient(90deg,${r.join(',')})"></div>
        <div class="ends"><span>${s.fmt(s.min)}</span><span>${s.fmt(Math.sqrt(s.min * s.max))}</span><span>${s.fmt(s.max)}+</span></div>
        <div style="margin-top:4px">Regional emissions plus active leaks. Brighter and bigger = more methane. Falls as countries act on your data.</div>${ring}`;
    }
    return `<div class="title">Source of the methane</div>${Object.entries(SITE_TYPES).map(([k, t]) => `<div><span class="dot" style="background:${t.color}"></span>${t.label}</div>`).join('')}
      <div style="margin-top:4px">Size = active leak flow.</div>${ring}`;
  }
  function drawSites() {
    siteLayer.clearLayers();
    SITES.forEach((site, i) => {
      const st = SIM.siteStatus(i);
      const type = SITE_TYPES[site.type];
      const undetected = st.active.filter(l => l.status === 'active');
      const rate = st.rate;
      const em = SIM.siteEmission(i);
      const r = siteMode === 'amount' ? 4 + Math.log10(em.total + 1) * 4 : 4 + Math.sqrt(rate + 0.5) * 1.6;
      const ring = undetected.some(l => l.rate > 20) ? '#ff5d6c' : st.reported.length ? '#4cc3ff' : st.fixed.length && !undetected.length ? '#3ddc84' : '#ffffff';
      const fill = siteMode === 'amount' ? rampColor('site', em.total) : type.color;
      const m = L.circleMarker([site.lat, site.lon], { radius: r, color: ring, weight: 2, fillColor: fill, fillOpacity: siteMode === 'amount' ? 0.85 : 0.75 });
      m.bindTooltip(`<b>${esc(site.name)}</b><br>${type.label}<br>≈ ${em.total.toFixed(0)} t/h total (${(em.total * 8.766e-3).toFixed(2)} Mt/yr)<br>${rate.toFixed(1)} t/h from active leaks`);
      m.on('click', () => { selected = { kind: 'site', i }; renderDetail(); });
      m.addTo(siteLayer);
    });
  }

  /* ---------- tracks & satellites ---------- */
  function splitWrap(pts) {
    const out = [[]];
    for (let k = 0; k < pts.length; k++) {
      if (k && Math.abs(pts[k][1] - pts[k - 1][1]) > 180) out.push([]);
      out[out.length - 1].push(pts[k]);
    }
    return out;
  }
  function drawTracks() {
    const S = SIM.state;
    trackLayer.clearLayers();
    const z = map.getZoom();
    const kmPerPx = 40075 / (256 * Math.pow(2, z));
    const showSwath = $('#lyr-swath').checked;
    S.satellites.filter(s => s.status === 'active').forEach((sat, n) => {
      const P = ORB.period(sat.el.a);
      const pts = [];
      for (let dt = -P * 0.25; dt <= P * 1.1; dt += 60) {
        const st = ORB.stateAt(sat.el, S.t + dt * 1000);
        pts.push([st.lat, st.lon]);
      }
      const color = n % 2 ? '#9085e9' : '#7cf2c8';
      splitWrap(pts).forEach(seg => {
        if (showSwath && sat.comp.detectors.length) {
          const sw = Math.max(...sat.comp.detectors.map(d => d.swathKm + (sat.attitude.mode === 'target' ? 2 * (d.pointKm || 0) : 0)));
          L.polyline(seg, { color, weight: Math.max(2, sw / kmPerPx), opacity: 0.18, interactive: false, pane: 'tracks' }).addTo(trackLayer);
        }
        L.polyline(seg, { color, weight: 1.5, opacity: 0.85, dashArray: '4 4', interactive: false, pane: 'tracks' }).addTo(trackLayer);
      });
    });
    lastTracks = performance.now();
  }
  function drawSats() {
    const S = SIM.state;
    satLayer.clearLayers();
    S.satellites.filter(s => s.status === 'active').forEach(sat => {
      const st = ORB.stateAt(sat.el, S.t);
      L.marker([st.lat, st.lon], { icon: L.divIcon({ className: 'sat-icon', html: '🛰️', iconSize: [20, 20] }) })
        .bindTooltip(`<b>${esc(sat.name)}</b><br>${(st.alt / 1000).toFixed(0)} km · ${sat.safeMode ? 'safe mode' : 'operating'}`)
        .on('click', () => { UI.show('orbit'); OrbitView.select(sat.id); })
        .addTo(satLayer);
    });
    lastSats = performance.now();
  }
  function drawNight() {
    nightLayer.clearLayers();
    const t = SIM.state.t;
    const s = ORB.eciToEcef(ORB.sunDir(t), ORB.gmst(t));
    const sunLat = Math.asin(s[2]) / ORB.DEG, sunLon = Math.atan2(s[1], s[0]) / ORB.DEG;
    const dec = sunLat * ORB.DEG;
    const pts = [];
    for (let lon = -180; lon <= 180; lon += 2) {
      const ha = (lon - sunLon) * ORB.DEG;
      const lat = Math.atan(-Math.cos(ha) / Math.tan(Math.abs(dec) < 1e-4 ? 1e-4 : dec)) / ORB.DEG;
      pts.push([lat, lon]);
    }
    const pole = dec > 0 ? -85.05 : 85.05; // Web Mercator cannot draw the poles themselves
    const poly = [[pole, -180], ...pts, [pole, 180]];
    L.polygon(poly, { pane: 'night', stroke: false, fillColor: '#000814', fillOpacity: 0.42, interactive: false }).addTo(nightLayer);
  }

  /* ---------- side panels ---------- */
  function renderDetail() {
    const S = SIM.state;
    const box = $('#map-detail');
    if (!selected) {
      box.innerHTML = `<h3>Select a country or site</h3><p class="fine" style="margin-top:0">Click a country to see its emissions trend and how its regulators respond to your data, or a circle to see the leaks your satellites have found there.</p>
        <p class="fine">Every leak you report and every monthly data report builds evidence. Countries with fast-acting regulators cut emissions within a few years; opaque producers barely move; places your satellites never see keep growing.</p>`;
    } else if (selected.kind === 'country') {
      const f = selected.f;
      const e = SIM.countryEmission(String(+f.id));
      const sites = SITES.map((s, i) => [s, i]).filter(([s]) => String(s.iso) === String(+f.id));
      box.innerHTML = `<div class="panel-head"><h3>${esc(f.properties.name)}</h3><button class="icon-btn" id="md-close" aria-label="Close">✕</button></div>
        ${e ? countryHTML(e, f) : ''}${e ? '' : `
<p class="muted">Small emitter, not tracked individually.</p><div class="kv"><span>Local warming</span><b>+${localWarming(f.properties._lat).toFixed(2)}°C</b></div>`}
        ${sites.length ? `<h3>Monitored sites</h3><ul class="leak-list">${sites.map(([s, i]) => `<li><a href="#" data-site="${i}">${esc(s.name)}</a><span class="mono">${SIM.siteStatus(i).rate.toFixed(1)} t/h</span></li>`).join('')}</ul>` : ''}`;
    } else {
      const i = selected.i, site = SITES[i], st = SIM.siteStatus(i), type = SITE_TYPES[site.type];
      const known = [...st.active.filter(l => l.status === 'detected'), ...st.reported];
      const hidden = st.active.filter(l => l.status === 'active');
      box.innerHTML = `<div class="panel-head"><h3>${esc(site.name)}</h3><button class="icon-btn" id="md-close" aria-label="Close">✕</button></div>
        <div><span class="dot" style="background:${type.color}"></span>${type.label} · ${site.lat.toFixed(1)}°, ${site.lon.toFixed(1)}°</div>
        <div class="kv" style="margin-top:8px"><span>Leak flow now</span><b>${st.rate.toFixed(1)} t/h</b><span>Unreported leaks</span><b>${hidden.length}</b>
        <span>Reported / awaiting repair</span><b>${known.length}</b><span>Repaired</span><b>${st.fixed.length}</b><span>Satellite looks</span><b>${st.observations}</b>
        <span>Typical cloud cover</span><b>${Math.round(site.cloud * 100)}%</b><span>Repair time once reported</span><b>${type.fixMonths ? type.fixMonths.join('–') + ' months' : 'natural, cannot fix'}</b></div>
        ${hidden.length ? `<p class="note warn">${hidden.length} leak${hidden.length > 1 ? 's are' : ' is'} still unreported here. Their exact size is unknown until a satellite with the right instrument sees ${hidden.length > 1 ? 'them' : 'it'}.${site.cloud > 0.6 ? ' Frequent clouds: day-only SWIR instruments will struggle, LIDAR or LWIR can see through more often.' : ''}${Math.abs(site.lat) > 60 ? ' High latitude: needs a polar or Sun-synchronous orbit.' : ''}</p>` : ''}
        ${known.length || st.fixed.length ? `<ul class="leak-list">${[...known, ...st.fixed].slice(0, 12).map(l => `<li><span>${l.rate.toFixed(1)} t/h ${l.attributed ? '· facility-level' : ''}</span><span class="status-pill st-${l.status}">${l.status === 'detected' ? 'on board, not downlinked' : l.status}</span></li>`).join('')}</ul>` : ''}`;
    }
    const c = $('#md-close'); if (c) c.onclick = () => { selected = null; recolor(); renderDetail(); };
    $$('#map-detail [data-site]').forEach(a => a.onclick = e => { e.preventDefault(); selected = { kind: 'site', i: +a.dataset.site }; renderDetail(); const s = SITES[+a.dataset.site]; map.flyTo([s.lat, s.lon], 5); });
    renderGlobal();
  }

  function countryHTML(e, f) {
    const pct = v => (v > 0 ? '+' : '') + (v * 100).toFixed(0) + '%';
    const bauChange = e.bau / e.base - 1;
    const respTxt = e.resp >= 0.9 ? 'Fast: strong methane rules' : e.resp >= 0.6 ? 'Moderate' : e.resp >= 0.4 ? 'Slow' : 'Very slow, little transparency';
    const evPct = Math.min(100, e.evidence / (e.evidence + 30) * 100 / 0.7);
    const tips = [];
    if (!e.detections && !e.reports) tips.push('No data from your satellites yet. Regulators here have nothing to act on.');
    if (e.cap < 0.35) tips.push('Most methane here comes from farming, which is hard to cut: even perfect data only goes so far.');
    if (e.cap >= 0.6) tips.push('Mostly oil & gas leaks: very fixable once found.');
    if (e.resp < 0.45) tips.push('Regulators respond slowly. It takes years of sustained evidence to change much.');
    if (e.evidence > 1 && e.evidence < 4) tips.push('Evidence is fading: keep satellites passing over this region.');
    return `<div class="big-num">${e.now.toFixed(1)} <small class="muted" style="font-size:13px">Mt CH₄/yr</small> <b class="mono ${e.trend <= 0 ? 'delta-good' : 'delta-bad'}" style="font-size:14px">${pct(e.trend)}</b></div>
      <div class="fine" style="margin:2px 0 0">since the start · no-action world: ${pct(bauChange)}</div>
      <div class="kv" style="margin-top:8px"><span>At the start</span><b>${e.base.toFixed(1)} Mt</b><span>Growth now</span><b>${(e.growth * 100).toFixed(1)}%/yr</b>
      <span>Policy cut</span><b>${(e.mitigation * 100).toFixed(1)}% <small class="muted">of max ${(e.cap * 100).toFixed(0)}%</small></b><span>Regulators</span><b>${respTxt}</b>
      <span>Leaks you reported</span><b>${e.detections}</b><span>Data delivered</span><b>${e.dataMB >= 1024 ? (e.dataMB / 1024).toFixed(1) + ' GB' : Math.round(e.dataMB) + ' MB'} · ${e.reports} reports</b>
      <span>Active leaks</span><b>${(e.leaks / 8.766e-3).toFixed(0)} t/h</b><span>Local warming</span><b>+${localWarming(f.properties._lat).toFixed(2)}°C</b></div>
      <div class="fine" style="margin-top:8px">Evidence regulators have from you</div><div class="bar"><i class="good" style="width:${evPct.toFixed(0)}%"></i></div>
      ${tips.length ? `<p class="fine">${tips.join(' ')}</p>` : ''}`;
  }

  function renderGlobal() {
    const S = SIM.state, c = S.climate;
    let unreported = 0, reported = 0;
    S.sites.forEach(ss => ss.leaks.forEach(l => { if (l.status === 'active' || l.status === 'detected') unreported++; else if (l.status === 'reported') reported++; }));
    const diff = (c.ch4bau || c.ch4) - c.ch4;
    let falling = 0, rising = 0;
    Object.keys(S.countries).forEach(iso => { const e = SIM.countryEmission(iso); if (e.trend < -0.01) falling++; else if (e.trend > 0.01) rising++; });
    const rep = S.reports && S.reports[S.reports.length - 1];
    $('#map-global').innerHTML = `<h3>Global methane</h3>
      <div class="big-num">${c.ch4.toFixed(1)} <small class="muted" style="font-size:13px">ppb</small></div>
      <div class="fine" style="margin-top:2px">No-action world: <b class="mono">${(c.ch4bau || c.ch4).toFixed(1)} ppb</b> · you: <b class="mono ${diff >= 0 ? 'delta-good' : 'delta-bad'}">${diff >= 0 ? '−' : '+'}${Math.abs(diff).toFixed(1)} ppb</b></div>
      <div class="kv" style="margin-top:10px"><span>Total emissions</span><b>${c.total.toFixed(0)} Mt/yr</b><span>Human-caused</span><b>${c.anthro.toFixed(0)} Mt/yr</b>
      <span>Natural (wetlands, permafrost)</span><b>${c.natural.toFixed(0)} Mt/yr</b><span>Super-emitter leaks</span><b>${(c.leakMt || 0).toFixed(1)} Mt/yr</b>
      <span>Warming</span><b>+${c.dT.toFixed(2)}°C</b><span>Warming avoided</span><b>${((c.avoidedC || 0) * 1000).toFixed(1)} m°C</b>
      <span>Leaks unreported / reported</span><b>${unreported} / ${reported}</b><span>Repaired so far</span><b>${S.stats.leaksFixed}</b>
      <span>Countries cutting / rising</span><b>${falling} / ${rising}</b></div>
      ${rep ? `<div class="fine" style="margin-top:8px">Latest data report (${rep.month}): <b class="mono">grade ${rep.grade}</b> · ${rep.detections} leaks · ${rep.sites} sites · ${rep.grant ? fmt$(rep.grant) + ' grant' : 'no grant'}</div>` : '<div class="fine" style="margin-top:8px">No data reports yet: launch a satellite.</div>'}`;
  }

  /* ---------- frame ---------- */
  function frame() {
    if (!map || UI.active() !== 'map') return;
    const now = performance.now();
    const fast = SIM.state.warp >= 21600 && !SIM.state.paused;
    if (now - lastSats > (fast ? 500 : 250)) { drawSats(); drawNight(); }
    if (now - lastTracks > (fast ? 1500 : 4000)) drawTracks();
    if (now - lastChoro > 2500) { recolor(); drawSites(); if (!selected || selected.kind !== 'country') renderDetail(); else renderGlobal(); }
  }

  function show() {
    if (!map) init();
    setTimeout(() => { map.invalidateSize(); lastTracks = 0; lastSats = 0; frame(); }, 30);
  }
  function focusSite(id) { const i = SITES.findIndex(s => s.id === id); if (i < 0) return; selected = { kind: 'site', i }; UI.show('map'); setTimeout(() => { map.flyTo([SITES[i].lat, SITES[i].lon], 5); renderDetail(); }, 60); }

  return { show, frame, focusSite };
})();
UI.register('map', MapView);
