/* =========================================================================
   Shared interface: tabs, top bar, time controls, toasts, modals
   ========================================================================= */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt$ = n => (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
const fmtK$ = n => { const a = Math.abs(n); const s = n < 0 ? '−$' : '$'; return a >= 1e6 ? s + (a / 1e6).toFixed(2) + 'M' : a >= 1e4 ? s + (a / 1e3).toFixed(0) + 'k' : s + Math.round(a).toLocaleString('en-US'); };
const fmtKg = kg => kg < 1 ? (kg * 1000).toFixed(0) + ' g' : kg.toFixed(kg < 10 ? 2 : 1) + ' kg';
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const starsHTML = (n, max = 5) => { const f = Math.round(n); return `<span class="stars">${'★'.repeat(f)}<span class="off">${'★'.repeat(Math.max(0, max - f))}</span></span>`; };

const UI = (() => {
  const WARPS = [1, 10, 60, 600, 3600, 21600, 86400, 604800, 2629800, 7889400, 31557600];
  const WARP_LABEL = { 1: '1×', 10: '10×', 60: '1 min/s', 600: '10 min/s', 3600: '1 h/s', 21600: '6 h/s', 86400: '1 day/s', 604800: '1 wk/s', 2629800: '1 mo/s', 7889400: '3 mo/s', 31557600: '1 yr/s' };
  const views = {};
  let current = 'map';

  function register(name, api) { views[name] = api; }
  function show(name) {
    if (!views[name]) return;
    current = name;
    $$('.tabs button').forEach(b => { b.classList.toggle('on', b.dataset.view === name); b.setAttribute('aria-selected', b.dataset.view === name); });
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    views[name].show && views[name].show();
    try { sessionStorage.setItem('mbm.view', name); } catch { /* ignore */ }
  }
  const active = () => current;

  function toast(msg, kind = '', title = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.innerHTML = (title ? `<b>${esc(title)}</b>` : '') + esc(msg);
    const box = $('#toasts');
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => el.remove(), kind === 'bad' ? 7000 : 4500);
  }

  function modal(html, { wide = false, onClose } = {}) {
    const d = $('#modal');
    d.classList.toggle('wide', wide);
    $('#modal-body').innerHTML = html;
    d.onclose = () => { onClose && onClose(); };
    if (!d.open) d.showModal();
    return d;
  }
  function closeModal() { const d = $('#modal'); if (d.open) d.close(); }

  /* ---------- time controls ---------- */
  function setWarp(w) {
    const S = SIM.state; if (!S) return;
    S.warp = w;
    $('#warp-label').textContent = WARP_LABEL[w] || w + '×';
  }
  function faster() { const S = SIM.state; const i = WARPS.indexOf(S.warp); setWarp(WARPS[Math.min(WARPS.length - 1, (i < 0 ? 4 : i) + 1)]); }
  function slower() { const S = SIM.state; const i = WARPS.indexOf(S.warp); setWarp(WARPS[Math.max(0, (i < 0 ? 4 : i) - 1)]); }
  function togglePause(force) {
    const S = SIM.state; if (!S || S.ended) return;
    if (S.flightActive) { toast('The world clock follows the rocket during a launch.', 'warn'); return; }
    S.paused = force !== undefined ? force : !S.paused;
    updateTop();
  }

  /* ---------- top bar ---------- */
  let lastTop = 0;
  function updateTop(force) {
    const S = SIM.state; if (!S) return;
    const now = performance.now();
    if (!force && now - lastTop < 120) return;
    lastTop = now;
    const d = new Date(S.t);
    $('#clock-date').textContent = d.toISOString().slice(0, 10);
    const y = Math.floor(SIM.years()) + 1;
    $('#clock-sub').textContent = `${d.toISOString().slice(11, 16)} UTC · year ${Math.min(y, S.cfg.durationYears)} of ${S.cfg.durationYears}${S.coarse && !S.paused ? ' · fast-sim' : ''}`;
    const pb = $('#btn-pause');
    pb.textContent = S.paused ? '▶' : '⏸';
    pb.classList.toggle('running', !S.paused);
    $('#st-funds').textContent = fmtK$(S.funds);
    $('#st-funds').style.color = S.funds < 0 ? 'var(--fail)' : '';
    $('#st-trust').textContent = S.trust.toFixed(0) + '%';
    $('#st-trust-bar').style.width = S.trust + '%';
    $('#st-science').textContent = S.science.toLocaleString();
    $('#st-dt').textContent = '+' + S.climate.dT.toFixed(2) + '°C';
    $('#st-dt').style.color = S.climate.dT > 2 ? 'var(--fail)' : S.climate.dT > 1.5 ? 'var(--warn)' : '';
    $('#st-ch4').textContent = S.climate.ch4.toFixed(0) + ' ppb';
    $('#st-sats').textContent = S.satellites.filter(s => s.status === 'active').length;
    $('#launch-dot').hidden = !S.launches.some(l => l.status === 'ready');
  }

  function bind() {
    $$('.tabs button').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));
    $('#btn-pause').addEventListener('click', () => togglePause());
    $('#btn-faster').addEventListener('click', faster);
    $('#btn-slower').addEventListener('click', slower);
    $('#btn-round').addEventListener('click', endButton);
    document.addEventListener('keydown', e => {
      if (e.target.closest('input, textarea, select') || $('#modal').open) return;
      if (SIM.state && SIM.state.flightActive && current === 'launch') return; // flight keys
      if (e.code === 'Space') { e.preventDefault(); togglePause(); }
      else if (e.key === '.' || e.key === '>') faster();
      else if (e.key === ',' || e.key === '<') slower();
      else if (/^[1-4]$/.test(e.key)) show(['launch', 'ops', 'map', 'orbit'][+e.key - 1]);
    });
    SIM.on('log', e => {
      $('#ticker').textContent = `${e.date} · ${e.msg}`;
      if (e.kind === 'bad' && /failed|lost|re-entered|bankrupt|browned out in eclipse/i.test(e.msg) && !/browned/.test(e.msg)) toast(e.msg, 'bad');
      if (/Breaking/.test(e.msg)) toast(e.msg, 'warn', 'News');
    });
    SIM.on('detection', ({ site, leak, sat }) => { if (SIM.state.warp <= 86400) toast(`${sat.name} found a ${leak.rate.toFixed(1)} t/h leak at ${site.name}.`, 'good', 'Leak reported'); });
    SIM.on('pending', p => { if (p) showPending(p); });
    SIM.on('launchReady', L => {
      updateTop(true);
      if (typeof LaunchView !== 'undefined' && LaunchView.autoFly(L)) return;
      const waited = typeof GUIDE !== 'undefined' ? GUIDE.warpSummaryHTML() : '';
      modal(`<h2>🚀 Launch day</h2><p>${esc(L.qty)}× <b>${esc(L.designName)}</b> is on the pad. The world clock is paused until you fly or scrub.</p>${waited}
        <div class="modal-actions"><button class="btn ghost" id="m-later">Later</button><button class="btn ghost" id="m-go">🚀 Go to the pad</button><button class="btn" id="m-orbit">⏭ Warp to orbit</button></div>`);
      $('#m-later').onclick = closeModal;
      $('#m-orbit').onclick = () => { closeModal(); LaunchView.flyToOrbit(L); };
      $('#m-go').onclick = () => { closeModal(); show('launch'); setTimeout(() => { const b = document.querySelector(`[data-fly="${L.id}"]`); if (b) b.click(); }, 60); };
    });
    SIM.on('report', r => { if (SIM.state.warp <= 604800 && r.grade !== 'F') toast(`Grade ${r.grade}: ${r.detections} leaks, ${r.sites} sites in ${r.countries.length} countries${r.grant ? `, ${fmt$(r.grant)} grant` : ''}. Regulators in those countries feel the pressure.`, r.quality >= 0.6 ? 'good' : '', 'Monthly data report'); });
    SIM.on('ended', showEnd);
    // a decision that came up before the page was ready (e.g. while fast-forwarding) still needs an answer
    if (SIM.state && SIM.state.pending) setTimeout(() => showPending(SIM.state.pending), 0);
  }

  function showPending(p) {
    modal(`<h2>${esc(p.title)}</h2><p>${esc(p.text)}</p>
      <div class="choice-list">${p.options.map(o => `<button data-opt="${o.id}"><b>${esc(o.label)}</b><small>${esc(o.explain)}</small></button>`).join('')}</div>`);
    $$('#modal-body [data-opt]').forEach(b => b.onclick = () => { closeModal(); SIM.resolvePending(b.dataset.opt); updateTop(true); });
  }

  // The player can end the mission at any time; the report opens on the Feedback page.
  function confirmEndMission() {
    const S = SIM.state; if (!S || S.ended) return;
    S.paused = true; updateTop(true);
    const left = Math.max(0, (S.tEnd - S.t) / (365.25 * 86400000));
    modal(`<h2>End the mission now?</h2>
      <p>Your agency stops here and the final mission report opens on the Feedback page.</p>
      ${left > 0.05 ? `<div class="note warn"><b>${left.toFixed(1)} of ${S.cfg.durationYears} years are still left.</b> The review measures what you achieved against the <b>whole</b> ${S.cfg.durationYears}-year mission, so ending early lowers your score${left / S.cfg.durationYears > 0.75 ? ', and ending this soon counts as an abandoned mission' : ''}.</div>` : ''}
      <div class="kv"><span>Leaks reported / fixed</span><b>${S.stats.leaksDetected} / ${S.stats.leaksFixed}</b><span>Satellites active</span><b>${S.satellites.filter(s => s.status === 'active').length}</b>
      <span>Methane vs no-action world</span><b>${(S.climate.ch4 - (S.climate.ch4bau || S.climate.ch4)).toFixed(1)} ppb</b></div>
      <div class="modal-actions"><button class="btn ghost" id="m-cancel">Keep playing</button><button class="btn" id="m-end">End mission → report</button></div>`);
    $('#m-cancel').onclick = closeModal;
    $('#m-end').onclick = () => { closeModal(); endedByPlayer = true; SIM.end('ended'); };
  }
  let endedByPlayer = false;
  const REPORT_URL = () => PAGES.results + (PAGES.results.includes('?') ? '&' : '?') + 'from=simulation';

  function showEnd(r) {
    updateTop(true);
    // ended by the player, or failed (every satellite lost): go straight to the report
    if (endedByPlayer || r.reason === 'lost') { location.href = REPORT_URL(); return; }
    const why = { lost: 'Every satellite was lost. The mission failed.', complete: `The ${r.durationYears}-year mission is complete.`, ended: 'You ended the mission.', bankrupt: 'Your agency ran out of money and went bankrupt.', trust: 'Public support fell to zero. You were removed as Mission Director.', tipping: 'Warming reached the +2.5°C tipping point.' }[r.reason] || 'Game over.';
    modal(`<h2>${r.reason === 'complete' ? '🏁 Mission complete' : '⚠️ Game over'}</h2><p>${esc(why)}</p>
      <div class="score-row" style="margin:12px 0"><div class="ring" style="--p:${r.score};--c:var(--good)"><b>${r.score}</b><small>/100</small></div>
      <div><div style="font-size:18px;font-weight:700;color:var(--accent-2)">${esc(r.rank)}</div>${starsHTML(r.stars)}</div></div>
      <p class="fine" id="m-count">Opening the mission report in 8 s…</p>
      <div class="modal-actions"><button class="btn ghost" id="m-stay">Stay and look around</button><button class="btn" id="m-results">See the mission report →</button></div>`);
    let n = 8;
    const timer = setInterval(() => { n--; const el = $('#m-count'); if (el) el.textContent = `Opening the mission report in ${n} s…`; if (n <= 0) { clearInterval(timer); location.href = REPORT_URL(); } }, 1000);
    $('#m-stay').onclick = () => { clearInterval(timer); closeModal(); UI.toast('The mission is over. Use “Mission report” in the top bar when you are ready.', '', 'Mission over'); $('#btn-round').textContent = '📄 Mission report'; $('#btn-round').hidden = false; };
    $('#m-results').onclick = () => { clearInterval(timer); location.href = REPORT_URL(); };
  }
  function endButton() { if (SIM.state && SIM.state.ended) location.href = REPORT_URL(); else confirmEndMission(); }

  return { register, show, active, toast, modal, closeModal, setWarp, faster, slower, togglePause, updateTop, bind, WARPS };
})();

/* Small reusable line chart (canvas) with crosshair tooltip.
   series: [{ label, color, values: [number], dash }] ; xs: [ms] */
function lineChart(canvas, xs, series, { unit = '', fmt = v => v.toFixed(1), yMin, yMax, refLine } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (xs.length < 2) { ctx.fillStyle = '#8396ba'; ctx.font = '12px Space Grotesk'; ctx.fillText('Collecting data…', 10, h / 2); return; }
  const all = series.flatMap(s => s.values).filter(v => v != null && isFinite(v));
  let lo = yMin ?? Math.min(...all), hi = yMax ?? Math.max(...all);
  if (refLine != null) { lo = Math.min(lo, refLine); hi = Math.max(hi, refLine); }
  if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const L = 52, R = 10, T = 8, B = 20;
  const X = i => L + (xs[i] - xs[0]) / (xs[xs.length - 1] - xs[0]) * (w - L - R);
  const Y = v => T + (1 - (v - lo) / (hi - lo)) * (h - T - B);
  ctx.font = '10.5px JetBrains Mono';
  ctx.fillStyle = '#8396ba'; ctx.strokeStyle = 'rgba(120,170,255,.10)'; ctx.lineWidth = 1;
  for (let k = 0; k <= 3; k++) {
    const v = lo + (hi - lo) * k / 3, y = Y(v);
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(w - R, y); ctx.stroke();
    ctx.fillText(fmt(v), 4, y + 3);
  }
  const y0 = new Date(xs[0]).getUTCFullYear(), y1 = new Date(xs[xs.length - 1]).getUTCFullYear();
  const stepY = Math.max(1, Math.ceil((y1 - y0) / 6));
  for (let yr = y0; yr <= y1; yr += stepY) {
    const t = Date.UTC(yr, 0, 1);
    if (t < xs[0]) continue;
    const x = L + (t - xs[0]) / (xs[xs.length - 1] - xs[0]) * (w - L - R);
    ctx.fillText(String(yr), x - 14, h - 5);
  }
  if (refLine != null) { ctx.strokeStyle = 'rgba(255,93,108,.6)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(L, Y(refLine)); ctx.lineTo(w - R, Y(refLine)); ctx.stroke(); ctx.setLineDash([]); }
  for (const s of series) {
    ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.setLineDash(s.dash || []);
    ctx.beginPath();
    s.values.forEach((v, i) => { if (v == null) return; i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)); });
    ctx.stroke(); ctx.setLineDash([]);
  }
  // hover: crosshair + tooltip
  const wrap = canvas.parentElement;
  let tip = wrap.querySelector('.chart-tip');
  if (!tip) { tip = document.createElement('div'); tip.className = 'chart-tip'; tip.hidden = true; wrap.appendChild(tip); }
  canvas.onmousemove = e => {
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const tx = xs[0] + (mx - L) / (w - L - R) * (xs[xs.length - 1] - xs[0]);
    let best = 0; for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - tx) < Math.abs(xs[best] - tx)) best = i;
    tip.hidden = false;
    tip.innerHTML = `<span class="mono">${new Date(xs[best]).toISOString().slice(0, 7)}</span><br>` + series.map(s => `${esc(s.label)}: <b class="mono">${fmt(s.values[best])}${unit}</b>`).join('<br>');
    tip.style.left = Math.min(w - 150, X(best) + 10) + 'px';
    tip.style.top = (canvas.offsetTop + 6) + 'px';
    canvas._hoverX = X(best);
    // redraw crosshair
    lineChart.crosshair(canvas, X(best), T, h - B);
  };
  canvas.onmouseleave = () => { tip.hidden = true; lineChart.crosshair(canvas, null); };
  canvas._snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
}
lineChart.crosshair = (canvas, x, top, bottom) => {
  const ctx = canvas.getContext('2d');
  if (canvas._snapshot) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.putImageData(canvas._snapshot, 0, 0); ctx.restore(); }
  if (x == null) return;
  ctx.strokeStyle = 'rgba(231,238,252,.35)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
};
