/* =========================================================================
   Boot: load config (from teammates' pages), new game or continue a save,
   then run the main loop.
   ========================================================================= */

(function boot() {
  const params = new URLSearchParams(location.search);
  const cfg = loadConfig();
  let loaded = false;
  const saved = safeGet(STORE.save);
  if (saved && params.get('new') !== '1') {
    try {
      const S = SIM.load(saved);
      // a new config from the Start / Design pages (different length or start) means a new game
      // any change to the mission settings (Design page) means a new game; only the agency name can change mid-game
      const same = ['durationYears', 'startDate', 'difficulty', 'startFunds', 'annualBudget', 'eventScale'].every(k => String(S.cfg[k] ?? DEFAULT_CONFIG[k]) === String(cfg[k]));
      if (same && !S.ended) {
        S.cfg = { ...S.cfg, ...cfg };
        loaded = true;
      }
    } catch (e) { console.warn('Save ignored:', e.message); }
  }
  if (!loaded) { SIM.newGame(cfg); safeDel(STORE.decisions); }
  const S = SIM.state;
  S.paused = true;
  let demoNote = null;
  // Demo mode for testing and presentations: simulation.html?new=1&demo=1 (add &demo=flight to start on the pad)
  if (params.get('demo') && !loaded) {
    const parts = { zoom: 1, li100: 1, hydrazine: 1, ewc27: 1, cfc400: 1 };
    S.current = { name: 'MethaneSat-1', parts: { ...parts } };
    S.designs.push({ name: 'MethaneSat-1', parts: { ...parts } }, { name: 'WideScan', parts: { swir: 1, nir: 1, li40: 1, ascent: 1, srs4: 1, kryten: 1 } });
    const mk = (alt, inc, raan, M) => ({ a: ORB.RE + alt * 1000, e: 0.0008, i: inc * ORB.DEG, raan, argp: 0, M, epoch: S.t });
    SIM.addSatellite('MethaneSat-1', parts, mk(550, ORB.ssoInclination(550e3) / ORB.DEG, 1.2, 0));
    SIM.addSatellite('WideScan-A', S.designs[1].parts, mk(500, 97.4, 2.9, 2));
    SIM.addSatellite('WideScan-B', S.designs[1].parts, mk(500, 97.4, 2.9, 5));
    SIM.advance(3 * 86400); for (let k = 0; k < 40; k++) SIM.advance(7200);
    // test hook: &adv=<months> lets the demo world run for that many months
    if (params.get('adv')) for (let k = 0; k < +params.get('adv'); k++) SIM.advance(30.44 * 86400);
    S.advDone = true;
    // test hook: &utc=<hour> moves the clock to that UTC hour (e.g. daylight launches from Vandenberg: &utc=20)
    if (params.get('utc')) { const hr = new Date(S.t).getUTCHours() + new Date(S.t).getUTCMinutes() / 60; const add = ((+params.get('utc') - hr) % 24 + 24) % 24; for (let k = 0; k < Math.ceil(add); k++) SIM.advance(Math.min(3600, (add - k) * 3600)); }
    const r = SIM.bookLaunch('rideshare', S.designs[0], 1, { alt: 525, inc: ORB.ssoInclination(525e3) / ORB.DEG, site: 'vsfb', recover: true });
    if (params.get('demo') === 'flight' && r.ok) { r.launch.date = S.t; r.launch.status = 'ready'; setTimeout(() => {
      UI.show('launch'); $('[data-fly]') && $('[data-fly]').click();
      // test hooks: &ff=<seconds> fast-forwards the flight physics, &deploy=1 deploys, &fmap=1 opens the map view
      const ff = +params.get('ff');
      if (ff) { LaunchView.fastForward(ff); if (params.get('deploy')) { LaunchView.deploy(); if (params.get('deploy') === 'orbit') $('[data-fm="orbit"]') && $('[data-fm="orbit"]').click(); } }
      if (params.get('fmap')) LaunchView.setMap(true);
    }, 300); }
    safeSet('mbm.sim.seenHelp', '1');
    demoNote = 'Demo mode: three satellites already in orbit and a launch booked.';
  }
  // the satellite designed on design.html
  const input = DESIGN_INPUT.sync(S);
  if (input) LaunchView.preselect(input.design.name);

  // test hook: &adv=<months> without the demo runs an empty world forward
  if (params.get('adv') && !S.advDone && !loaded) for (let k = 0; k < +params.get('adv'); k++) SIM.advance(30.44 * 86400);
  delete S.advDone;
  UI.bind();
  GUIDE.init();
  UI.setWarp(S.warp || DEFAULT_WARP);

  let view = 'map';
  try { view = sessionStorage.getItem('mbm.view') || (S.satellites.length ? 'map' : 'launch'); } catch { /* ignore */ }
  if (input && input.isNew && !params.get('demo')) view = 'launch';
  // nothing in orbit yet: open straight on the Launch tab, ready to press 🚀 Launch
  if (!S.satellites.some(s => s.status === 'active') && !params.get('demo')) view = 'launch';
  if (params.get('view')) view = params.get('view');
  UI.show(view);
  UI.updateTop(true);

  // test hook: &endnow=complete ends the game through the normal end-of-game path (end screen, then the report)
  if (params.get('endnow')) setTimeout(() => SIM.end(params.get('endnow')), 600);
  // test hook: &click=<css selector>[|<selector>…] clicks controls after load (e.g. map toggles)
  if (params.get('click')) setTimeout(() => params.get('click').split('|').forEach(sel => { const el = document.querySelector(sel); if (el) el.click(); }), 400);
  // test hook: &select=1 opens the first satellite in the Orbit Viewer
  if (params.get('select') && S.satellites.length) setTimeout(() => { UI.show('orbit'); OrbitView.select(S.satellites[0].id); }, 200);
  if (demoNote) UI.toast(demoNote, 'good');
  else if (loaded) UI.toast(`Welcome back. Continuing from ${SIM.fmtDate(S.t)}.`, 'good', 'Save loaded');
  // (no welcome dialog: the page opens ready to launch; the tutorial is still under ? in the top bar)
  else if (!safeGet('mbm.sim.seenHelp')) safeSet('mbm.sim.seenHelp', '1');
  else if (input && input.isNew) UI.toast(`${input.design.name} arrived from the Design step. Book a launch for it.`, 'good', 'Design received');
  if (!input && !demoNote) UI.toast('No satellite design found. Configure one on the Design step first.', 'warn');

  function help() {
    safeSet('mbm.sim.seenHelp', '1');
    UI.modal(`<h2>Mission: Blue Marble</h2>
      <p>You have <b>${S.cfg.durationYears} years</b> and <b>${fmt$(S.funds)}</b> to find methane leaks from space and slow global warming. Money arrives every month and grows when your data leads to repairs.</p>
      <ol style="padding-left:18px;line-height:1.7">
        <li><b>🔧 Your satellite</b> comes from the Design step. The frame, reaction wheels and solar panels are added for you.</li>
        <li><b>🚀 Launch:</b> book a ride for it, then fly it on launch day. The autopilot can do it all, or you can take the controls.</li>
        <li><b>🛰️ Orbit Viewer:</b> watch your fleet in 3D, then click a satellite to point it, fire its thrusters or transmit data.</li>
        <li><b>🌡️ Methane Emissions:</b> see where methane comes from, where your satellites look and which leaks you've found.</li>
        <li><b>⏩ Time:</b> press ▶ (or Space) to start the clock and » to speed up. Time pauses for launches and decisions.</li>
      </ol>
      <p class="fine">Keyboard: 1–4 switch views · Space pause · , and . change speed.</p>
      <div class="modal-actions"><button class="btn" id="m-start">Plan a launch →</button></div>`);
    $('#m-start').onclick = () => { UI.closeModal(); UI.show('launch'); };
  }
  window.blueMarbleHelp = GUIDE.showHelp;

  // main loop
  let last = performance.now();
  function loop(now) {
    const raw = (now - last) / 1000;
    const dt = Math.min(0.25, raw);
    last = now;
    try {
      GUIDE.frame(dt);
      if (LaunchView.flying) LaunchView.frame(dt);
      else SIM.tick(Math.min(1, raw)); // the world clock keeps its speed even on slow computers
      UI.updateTop();
      MapView.frame(); OrbitView.frame(); OpsView.frame();
    } catch (e) { console.error(e); }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  window.addEventListener('beforeunload', () => SIM.save());
})();
