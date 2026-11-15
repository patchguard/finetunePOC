/* =========================================================================
   Player guidance: makes the game easier to pick up without removing anything.

   - Warp to launch day: plays the waiting time quickly (a few seconds), slowing
     down as launch day approaches. Every event in between still happens; a banner
     shows them as they come, decisions still pause the clock, and on arrival a
     "while you waited" summary lists what happened.
   - Tutorial: a coach card that walks a new player through a whole first
     mission (book → warp → fly → deploy → run time → reports), highlighting the
     button to press and moving on when the player does it.
   - Next-step hint: a 💡 button in the top bar that always says what to do next
     (and does it when clicked).
   - Flight hints: one line over the 3D flight explaining what is happening.
   - Help (?): controls, the goal, and a button to restart the tutorial.
   ========================================================================= */

const GUIDE = (() => {
  let tut = null;            // { step, base: {...} } while the tutorial runs
  let warp = null;           // launch-day warp in progress
  let lastFrame = 0;

  /* ===================== warp to launch day ===================== */
  function warpToLaunch(id, opts = {}) {
    const S = SIM.state;
    const L = S.launches.find(l => l.id === id) || S.launches.filter(l => l.status === 'scheduled').sort((a, b) => a.date - b.date)[0];
    if (!L || L.status !== 'scheduled') return;
    warp = { toOrbit: !!opts.toOrbit, id: L.id, name: L.designName, from: S.t, prevWarp: S.warp, leaks: 0, fixes: 0, reports: [], events: [], start: performance.now() };
    S.paused = false;
    banner();
  }
  function stopWarp(silent) {
    if (!warp) return;
    const S = SIM.state;
    UI.setWarp(warp.prevWarp || DEFAULT_WARP);
    if (!silent) { S.paused = true; UI.toast('Warp stopped. Press ▶ to keep the clock running, or warp again from the Launch tab.'); }
    warp = null;
    banner();
    UI.updateTop(true);
  }
  function warpFrame() {
    if (!warp) return;
    const S = SIM.state;
    const L = S.launches.find(l => l.id === warp.id);
    if (!L || L.status !== 'scheduled') { // arrived (the launch-day pop-up shows the summary) or the launch was scrubbed
      if (warp && warp.done !== true) { UI.setWarp(DEFAULT_WARP); warp = null; banner(); }
      return;
    }
    if (S.paused && !S.pending) { stopWarp(true); UI.toast('Warp stopped.'); return; }
    // cover the remaining time in about a second's worth of "half-lives": fast far away, slow near the day
    const left = Math.max(0, (L.date - S.t) / 1000);
    S.warp = Math.max(6 * 3600, Math.min(30 * 86400, left / 0.9));
    const wl = document.getElementById('warp-label'); if (wl) wl.textContent = S.warp >= 86400 ? (S.warp / 86400).toFixed(0) + ' days/s' : (S.warp / 3600).toFixed(0) + ' h/s';
    if (performance.now() - (warp.lastBanner || 0) > 150) { warp.lastBanner = performance.now(); banner(L, left); }
  }
  function banner(L, left) {
    let el = document.getElementById('warp-banner');
    if (!warp) { if (el) el.hidden = true; return; }
    if (!el) {
      el = document.createElement('div'); el.id = 'warp-banner'; el.className = 'warp-banner';
      document.body.appendChild(el);
    }
    el.hidden = false;
    const days = left != null ? left / 86400 : 0;
    const ev = warp.events.slice(-3).reverse().map(e => `<li>${esc(e)}</li>`).join('');
    el.innerHTML = `<div class="wb-head"><b>${warp.toOrbit ? '⏭ Warping to orbit' : '⏩ Warping to launch day'} · ${esc(warp.name)}</b><span class="mono">${days >= 1 ? days.toFixed(0) + ' days' : (days * 24).toFixed(0) + ' h'} to go · ${SIM.fmtDate(SIM.state.t)}</span>
      <button class="btn small ghost" id="wb-stop">Stop</button></div>
      <div class="wb-stats">${warp.leaks} leaks reported · ${warp.fixes} repaired · ${warp.reports.length} data report${warp.reports.length === 1 ? '' : 's'}${SIM.state.pending ? ' · <b>waiting for your decision</b>' : ''}</div>
      ${ev ? `<ul class="wb-events">${ev}</ul>` : '<div class="wb-events fine">Events along the way appear here.</div>'}`;
    const b = document.getElementById('wb-stop'); if (b) b.onclick = () => stopWarp();
  }
  function onLog(e) {
    if (!warp) return;
    if (/^🔧/.test(e.msg)) warp.fixes++;
    if (/📡/.test(e.msg)) return; // individual leak reports are counted, not listed
    warp.events.push(`${e.date} · ${e.msg}`);
    if (warp.events.length > 60) warp.events.shift();
  }
  // used by the launch-day pop-up: what happened during the warp
  function warpSummaryHTML() {
    if (!warp) return '';
    const w = warp;
    warp.done = true;
    const days = (SIM.state.t - w.from) / 86400000;
    const grades = w.reports.map(r => r.grade).join(', ');
    const list = w.events.slice(-8).reverse().map(e => `<li>${esc(e)}</li>`).join('');
    const html = `<div class="note"><b>While you waited (${days.toFixed(0)} days):</b> ${w.leaks} leaks reported, ${w.fixes} repaired${w.reports.length ? `, data report grade${w.reports.length > 1 ? 's' : ''} ${grades}` : ''}.
      ${list ? `<ul class="wb-events" style="margin-top:6px">${list}</ul>` : ''}</div>`;
    UI.setWarp(DEFAULT_WARP);
    warp = null; banner();
    return html;
  }

  /* ===================== tutorial ===================== */
  const flight = () => LaunchView.flight;
  const S_ = () => SIM.state;
  const TUT = [
    { title: 'Welcome, Director', info: true,
      text: s => `Your job: find methane leaks from space so they get fixed, and slow global warming over the next <b>${s.cfg.durationYears} years</b>. Methane is a powerful greenhouse gas, and big leaks from oil & gas sites, coal mines and landfills are fixable once someone sees them.<br><br>The top bar shows your money 💰, public support 🌍, warming 🌡️ and methane. The clock is paused for now.` },
    { title: 'The methane map', view: 'map', info: true, target: '#view-map .map-wrap',
      text: () => 'This map shows where methane comes from. <b>Orange countries</b> emit more. <b>Circles</b> are big emission sites; their colour says what causes the methane. Your satellites will find leaks here, and repaired sites turn green.' },
    { title: 'Send your satellite to space', target: '[data-view="launch"]', done: () => UI.active() === 'launch',
      text: () => 'Your satellite from the Design page is ready. Open the <b>🚀 Launch</b> tab.' },
    { title: 'Launch', view: 'launch', target: '#lp-book', done: s => s.satellites.length > 0,
      text: () => 'The cheapest ride is a <b>Rideshare slot</b> (already selected) to a Sun-synchronous orbit. Scroll down and press <b>🚀 Launch</b>: the satellite goes straight to orbit and the mission clock starts.' },
    { title: 'Results', target: '[data-view="ops"]', done: () => UI.active() === 'ops',
      text: () => 'Every leak you report brings money and gets repaired. Each month you also get a <b>data report</b> graded A–F. <b>📊 Mission Control</b> shows them live, with your charts.' },
    { title: 'You\'re ready!', info: true, last: true,
      text: () => 'That\'s the whole loop. Tips:<ul style="margin:6px 0 0 16px;padding:0"><li>More satellites cover more of the planet; they wear out after some years, so plan replacements.</li><li>Countries react to your evidence at different speeds; check them on the map.</li><li><b>?</b> in the top bar brings this tutorial and the controls back.</li><li>Press <b>🏁 End mission</b> when you\'re done (the review counts the whole mission), or play until time runs out.</li></ul>' },
  ];
  function saveTut() { safeSet('mbm.tutorial', JSON.stringify(tut ? { on: true, step: tut.step } : { on: false })); }
  function startTutorial() {
    tut = { step: 0, base: {} };
    saveTut(); enterStep(); card();
  }
  function stopTutorial(finished) {
    tut = null; saveTut(); clearHL();
    const c = document.getElementById('coach'); if (c) c.hidden = true;
    if (finished) UI.toast('Tutorial complete. The 💡 hint in the top bar keeps suggesting next steps.', 'good');
  }
  function enterStep() {
    const st = TUT[tut.step]; if (!st) return;
    tut.base = st.start ? st.start(S_()) : {};
    if (st.view && UI.active() !== st.view && !LaunchView.flying) UI.show(st.view);
  }
  function go(delta) {
    tut.step = Math.max(0, Math.min(TUT.length - 1, tut.step + delta));
    saveTut(); enterStep(); card();
  }
  function card() {
    let c = document.getElementById('coach');
    if (!tut) { if (c) c.hidden = true; return; }
    if (!c) { c = document.createElement('div'); c.id = 'coach'; c.className = 'coach'; document.body.appendChild(c); }
    const st = TUT[tut.step];
    c.hidden = false;
    const needView = st.view && UI.active() !== st.view && !(st.view === 'launch' && LaunchView.flying);
    c.innerHTML = `<div class="coach-top"><span class="coach-step">Tutorial · ${tut.step + 1} / ${TUT.length}</span><button class="icon-btn" id="coach-x" title="Close the tutorial" aria-label="Close">✕</button></div>
      <h3>${st.title}</h3><div class="coach-text">${st.text(S_())}</div>
      ${needView ? `<div class="coach-need">First open the <b>${{ map: '🌡️ Methane Emissions', launch: '🚀 Launch', orbit: '🛰️ Orbit Viewer', ops: '📊 Mission Control' }[st.view]}</b> tab.</div>` : ''}
      <div class="coach-actions">${tut.step > 0 ? '<button class="btn small ghost" id="coach-back">← Back</button>' : '<span></span>'}
      ${st.info ? `<button class="btn small" id="coach-next">${st.last ? 'Finish' : 'Next →'}</button>` : '<span class="coach-wait">Do the highlighted step to continue · <a href="#" id="coach-skip">skip</a></span>'}</div>`;
    c.querySelector('#coach-x').onclick = () => stopTutorial(false);
    const nb = c.querySelector('#coach-next'); if (nb) nb.onclick = () => st.last ? stopTutorial(true) : go(1);
    const bb = c.querySelector('#coach-back'); if (bb) bb.onclick = () => go(-1);
    const sk = c.querySelector('#coach-skip'); if (sk) sk.onclick = e => { e.preventDefault(); go(1); };
    c.dataset.step = tut.step;
  }
  function clearHL() { document.querySelectorAll('.guide-hl').forEach(e => e.classList.remove('guide-hl')); }
  function highlight() {
    clearHL();
    const st = tut && TUT[tut.step];
    if (!st || !st.target) return;
    // if the step needs another tab first, point at that tab instead
    let sel = st.target;
    if (st.view && UI.active() !== st.view && !(st.view === 'launch' && LaunchView.flying)) sel = `[data-view="${st.view}"]`;
    const els = [...document.querySelectorAll(sel)].filter(e => e.offsetParent !== null || e.tagName === 'DIALOG');
    els.forEach(e => e.classList.add('guide-hl'));
    if (els[0] && tut.scrolled !== tut.step + sel) { tut.scrolled = tut.step + sel; try { els[0].scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* ignore */ } }
  }
  function tutFrame() {
    if (!tut) return;
    const st = TUT[tut.step];
    if (st && st.done && st.done(S_(), tut.base)) { go(1); return; }
    if (+document.getElementById('coach')?.dataset.step !== tut.step) card();
    // refresh the "open this tab first" line when the view changes
    const c = document.getElementById('coach');
    if (c && st && st.view) { const need = !!c.querySelector('.coach-need'); const want = UI.active() !== st.view && !(st.view === 'launch' && LaunchView.flying); if (need !== want) card(); }
    highlight();
  }

  /* ===================== help & first run ===================== */
  function showHelp() {
    const S = S_();
    UI.modal(`<h2>How to play</h2>
      <p>Find methane leaks from space so they get fixed, and slow global warming over <b>${S.cfg.durationYears} years</b>. The review at the end counts the whole mission.</p>
      <ol style="padding-left:18px;line-height:1.7;margin:8px 0">
        <li><b>🔧 Satellite Builder</b> (Design page): choose your satellite's parts and the game settings.</li>
        <li><b>🚀 Launch:</b> pick a ride and press <b>🚀 Launch</b>; the satellite goes straight to orbit and time runs at 1 year per second.</li>
        <li><b>▶ / »</b> run and speed up time. Satellites report leaks as they pass over them; leaks get repaired and countries tighten their rules.</li>
        <li><b>🌡️ Map</b> and <b>📊 Mission Control</b> show what changed, including monthly data reports (A–F).</li>
        <li>Satellites wear out: keep booking launches. More satellites cover more of the world.</li>
      </ol>
      <div class="kv"><span>Switch views</span><b>1 2 3 4</b><span>Pause / play</span><b>Space</b><span>Slower / faster</span><b>, .</b>
      <span>Flight</span><b>W/S pitch · A/D turn · Shift/Ctrl throttle · Space stage · T autopilot · K warp to orbit · M map · Enter deploy</b></div>
      <div class="modal-actions"><button class="btn ghost" id="m-tut">🎓 ${tut ? 'Restart' : 'Start'} the tutorial</button><button class="btn" id="m-close">Close</button></div>`);
    $('#m-close').onclick = UI.closeModal;
    $('#m-tut').onclick = () => { UI.closeModal(); startTutorial(); };
  }
  function firstRun() {
    const S = S_();
    UI.modal(`<h2>Welcome to Mission: Blue Marble</h2>
      <p>You run a young space agency with <b>${fmt$(S.funds)}</b> and <b>${S.cfg.durationYears} years</b> to find methane leaks from space and slow global warming.</p>
      <p>New here? The tutorial walks you through your first launch and shows you where everything is. It takes about 5 minutes and you can leave it any time.</p>
      <div class="modal-actions"><button class="btn ghost" id="m-skip">I know how to play</button><button class="btn" id="m-tut">🎓 Start the tutorial</button></div>`);
    $('#m-tut').onclick = () => { UI.closeModal(); startTutorial(); };
    $('#m-skip').onclick = () => { UI.closeModal(); UI.toast('Press ? in the top bar any time for help or the tutorial.', '', 'Tip'); };
  }

  /* ===================== wiring ===================== */
  function init() {
    SIM.on('log', onLog);
    SIM.on('detection', () => { if (warp) warp.leaks++; });
    SIM.on('report', r => { if (warp) warp.reports.push(r); });
    const hb = document.getElementById('btn-help'); if (hb) hb.onclick = showHelp;
    let saved = null; try { saved = JSON.parse(safeGet('mbm.tutorial') || 'null'); } catch { /* ignore */ }
    if (saved && saved.on) { tut = { step: Math.min(saved.step || 0, TUT.length - 1), base: {} }; enterStep(); card(); }
  }
  function frame(dt) {
    warpFrame();
    const now = performance.now();
    if (now - lastFrame < 200) return;
    lastFrame = now;
    tutFrame();
  }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  return { init, frame, warpToLaunch, stopWarp, warpSummaryHTML, startTutorial, showHelp, firstRun, get warping() { return !!warp; }, get tutorial() { return !!tut; } };
})();
