/* =========================================================================
   Launch: planner (vehicle, site, orbit, schedule) and flight (KSP-style
   manual control with an adaptive autopilot you can interrupt or command).
   ========================================================================= */

const LaunchView = (() => {
  let sel = { design: null, opt: 'rideshare', qty: 1, site: null, alt: 525, inc: 'sso', incCustom: 97.6, recover: true };
  let flight = null, flightL = null, mapMode = false, flightWarp = 1, launchMs = 0, keys = {}, lastHud = 0, optImgs = {};
  const WARPS_F = [1, 2, 4, 10, 50, 100, 500];

  function preselect(name) { sel.design = name; }
  const designs = () => { const S = SIM.state; const list = [...S.designs]; if (S.current && Object.keys(S.current.parts).length && !list.some(d => d.name === S.current.name)) list.push(S.current); return list; };

  /* ======================= PLANNER ======================= */
  function incFor(opt) {
    if (sel.inc === 'sso') return ORB.ssoInclination(sel.alt * 1000) / ORB.DEG;
    if (sel.inc === 'iss') return 51.6;
    if (sel.inc === 'polar') return 90;
    return +sel.incCustom;
  }
  function feasibility(site, inc) {
    const lat = Math.abs(site.lat);
    if (inc < lat - 0.01 || inc > 180 - lat + 0.01) return { ok: false, msg: `From ${site.lat.toFixed(1)}° latitude the lowest inclination you can reach directly is ${lat.toFixed(1)}°.` };
    const s = Math.cos(inc * ORB.DEG) / Math.cos(site.lat * ORB.DEG);
    const a1 = Math.asin(clamp(s, -1, 1)) / ORB.DEG;
    const cands = [a1, 180 - a1].map(a => ((a % 360) + 360) % 360);
    const [lo, hi] = site.azimuths;
    const ok = cands.find(a => { const aa = a > 180 && lo < 0 ? a - 360 : a; return aa >= lo && aa <= hi; });
    if (ok == null) return { ok: false, msg: `Range safety: from ${site.name} rockets may only fly azimuths ${lo}°–${hi}°. This orbit needs ${cands.map(a => a.toFixed(0) + '°').join(' or ')}.` };
    const boost = 465.1 * Math.cos(site.lat * ORB.DEG) * Math.sin(ok * ORB.DEG);
    return { ok: true, az: ok, boost };
  }

  function renderPlanner() {
    const S = SIM.state;
    const box = $('#launch-planner');
    const ds = designs();
    if (!sel.design || !ds.some(d => d.name === sel.design)) sel.design = ds.some(d => d.name === S.current.name) ? S.current.name : ds.length ? ds[ds.length - 1].name : null;
    const d = ds.find(x => x.name === sel.design);
    const comp = d ? DESIGN.compute(d.parts) : null;
    const opt = LAUNCH_OPTIONS.find(o => o.id === sel.opt);
    if (opt.id === 'rideshare') { sel.alt = sel.alt || 525; }
    if (opt.id === 'iss') { sel.alt = 415; sel.inc = 'iss'; }
    const site = LAUNCH_SITES.find(s => s.id === (opt.anySite ? (sel.site || opt.site) : opt.site));
    const inc = incFor(opt);
    const feas = feasibility(site, inc);
    const price = comp ? SIM.launchPrice(opt, comp, sel.qty) : 0;
    const total = comp ? price + comp.cost * sel.qty : 0;
    const date = SIM.nextLaunchDate(opt);
    const rk = ROCKETS[opt.rocket];
    const payload = comp ? comp.mass * sel.qty : 0;
    const tooHeavy = opt.maxPayload && payload > opt.maxPayload;
    const cubesatBad = opt.cubesatOnly && comp && comp.busUsed.id === 'micro';
    const fails = comp ? comp.issues.filter(i => i.level === 'fail') : [];
    const scheduled = S.launches.filter(l => l.status !== 'flown');
    const nextL = scheduled.filter(l => l.status === 'scheduled').sort((a, b) => a.date - b.date)[0] || null;
    const flown = S.launches.filter(l => l.status === 'flown').slice(-6).reverse();
    box.innerHTML = `<div class="lp-grid">
      <div class="panel">
        <h2>Plan a launch</h2>
        <p class="fine" style="margin-top:0">Pick a design, a ride to space and a target orbit. You'll fly the rocket yourself on launch day, with an autopilot you can take over from at any moment.</p>
        ${!ds.length ? `<div class="note warn">No satellite design yet. Configure one on the Design step, then press Simulate.</div><a class="btn" href="${PAGES.design}">🔧 Open Design Configuration</a>` : `
        <h3>Satellite</h3>
        <div class="form-grid">
          <span>Design</span><select id="lp-design">${ds.map(x => `<option ${x.name === sel.design ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
          <span>How many</span><div class="row" style="margin:0"><input type="number" id="lp-qty" min="1" max="12" value="${sel.qty}"><span class="muted">${comp ? `${comp.busUsed.name} · ${comp.mass.toFixed(2)} kg each · ${fmt$(comp.cost)} to build (your parts ${fmt$(comp.partsCost)}) · score ${comp.score.total}` : ''}</span></div>
        </div>
        ${comp ? `<p class="fine" style="margin:6px 0 0">Parts: ${Object.keys(d.parts).map(id => esc(ALL_PARTS[id].name) + (d.parts[id] > 1 ? ' ×' + d.parts[id] : '')).join(' · ')}. Frame, reaction wheels, solar arrays and other subsystems are added automatically. <a href="${PAGES.design}">Change the design</a></p>` : ''}
        ${fails.length ? `<div class="note warn">This design has ${fails.length} critical problem${fails.length > 1 ? 's' : ''}: ${fails.map(f => esc(f.text)).join(' ')} It will still fly, but expect it to fail in orbit.</div>` : ''}
        <h3>Ride to space</h3>
        <div class="opt-grid">${LAUNCH_OPTIONS.map(o => `<button class="opt ${o.id === sel.opt ? 'on' : ''}" data-opt="${o.id}">
          <img alt="" data-optimg="${o.id}" src="${optImgs[o.id] || ''}" ${optImgs[o.id] ? '' : 'style="display:none"'}>
          <div class="ob"><b>${esc(o.name)}</b><span class="price">${comp ? fmt$(SIM.launchPrice(o, comp, sel.qty)) : '—'}</span>
          <p>${esc(o.desc)}</p><p class="mono" style="color:var(--muted)">${ROCKETS[o.rocket].name} · ${o.cadenceDays ? `every ${o.cadenceDays} days` : `${o.leadDays}-day lead`}</p></div></button>`).join('')}</div>
        <h3>Orbit</h3>
        <div class="form-grid">
          <span>Launch site</span>${opt.anySite ? `<select id="lp-site">${LAUNCH_SITES.map(s => `<option value="${s.id}" ${s.id === site.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>` : `<b>${esc(site.name)}</b>`}
          <span></span><span class="fine" style="margin:0">${esc(site.note)}</span>
          <span>Altitude</span><div class="row" style="margin:0"><input type="range" id="lp-alt" min="300" max="1200" step="5" value="${sel.alt}" ${opt.id === 'iss' ? 'disabled' : ''} style="flex:1"><b class="mono" style="width:70px">${sel.alt} km</b></div>
          <span>Inclination</span><div class="seg">${[['sso', `Sun-synchronous (${(ORB.ssoInclination(sel.alt * 1000) / ORB.DEG).toFixed(1)}°)`], ['iss', 'ISS 51.6°'], ['polar', 'Polar 90°'], ['custom', 'Custom']].map(([k, l]) => `<button data-inc="${k}" class="${sel.inc === k ? 'on' : ''}" ${opt.id === 'iss' && k !== 'iss' ? 'disabled' : ''}>${l}</button>`).join('')}</div>
          ${sel.inc === 'custom' ? `<span></span><div class="row" style="margin:0"><input type="number" id="lp-inc" min="0" max="180" step="0.1" value="${sel.incCustom}"> °</div>` : ''}
          ${rk.stages[0].reusable ? `<span>Booster</span><label class="check"><input type="checkbox" id="lp-recover" ${sel.recover ? 'checked' : ''}> Recover the booster (keeps 9% fuel in reserve, refunds part of the price)</label>` : ''}
        </div>
        <div class="note ${feas.ok ? '' : 'warn'}">${feas.ok ? `Launch azimuth ${feas.az.toFixed(1)}°. Earth's rotation ${feas.boost >= 0 ? 'gives you' : 'costs you'} <b class="mono">${Math.abs(feas.boost).toFixed(0)} m/s</b>. ${orbitAdvice(sel.alt, inc)}` : esc(feas.msg)}</div>
        <h3>Cost</h3>
        <div class="kv">${comp ? `<span>Your parts</span><b>${fmt$(comp.partsCost * sel.qty)}</b><span>Subsystems, frame &amp; integration</span><b>${fmt$((comp.cost - comp.partsCost) * sel.qty)}</b>` : ''}<span>Build ${sel.qty}× satellite</span><b>${fmt$(comp ? comp.cost * sel.qty : 0)}</b><span>Launch</span><b>${fmt$(price)}${S.t < S.launchDiscountUntil ? ' (50% partnership discount)' : ''}</b>
          <span>Total</span><b>${fmt$(total)}</b><span>Funds after launch</span><b style="color:${S.funds - total < 0 ? 'var(--fail)' : ''}">${fmt$(S.funds - total)}</b><span>Launch</span><b>Now (straight to orbit)</b><span>Payload mass</span><b>${payload.toFixed(1)} kg${opt.maxPayload ? ` of ${opt.maxPayload} kg` : ''}</b></div>
        ${comp ? extrasHTML(comp, sel.qty) : ''}
        ${tooHeavy ? `<div class="note warn">Too heavy for this rocket.</div>` : ''}${cubesatBad ? `<div class="note warn">The ISS deployer only takes CubeSats (up to 16U).</div>` : ''}
        <div class="book-row">
          <button class="btn" id="lp-book" ${feas.ok && comp && !tooHeavy && !cubesatBad ? '' : 'disabled'}>${S.satellites.length ? '🚀 Launch another' : '🚀 Launch'}</button>
          ${nextL ? `<button class="btn warp-orbit" data-warp-orbit="${nextL.id}" title="Jump to launch day, fly to orbit automatically, then release the satellite">⏭ Warp to orbit</button>
          <button class="btn ghost" data-warp="${nextL.id}" title="Jump to launch day and fly the rocket yourself">⏩ Warp to launch day</button>` : ''}
        </div>
        ${nextL ? `<p class="fine" style="margin:6px 0 0">Booked: ${esc(nextL.designName)} launches on ${SIM.fmtDate(nextL.date)}. <b>⏭ Warp to orbit</b> skips straight to releasing the satellite; <b>⏩ Warp to launch day</b> lets you fly the rocket.</p>` : ''}`}
      </div>
      <div class="panel">
        <h2>Launch schedule</h2>
        ${scheduled.length ? `<ul class="sched">${scheduled.map(l => {
          const o = LAUNCH_OPTIONS.find(x => x.id === l.opt);
          const days = (l.date - S.t) / 86400000;
          return `<li class="${l.status === 'ready' ? 'ready' : ''}"><div class="row" style="margin:0;justify-content:space-between"><b>${l.qty}× ${esc(l.designName)}</b><span class="mono">${l.status === 'ready' ? '🟠 ON THE PAD' : `T−${days >= 1 ? days.toFixed(1) + ' days' : (days * 24).toFixed(1) + ' h'}`}</span></div>
            <span class="muted">${esc(o.name)} · ${esc(LAUNCH_SITES.find(s => s.id === l.site).name)} · ${l.target.alt} km, ${l.target.inc.toFixed(1)}° · ${SIM.fmtDate(l.date)}</span>
            <div class="row" style="margin:0">${l.status === 'ready' ? `<button class="btn" data-fly="${l.id}">🚀 Go to the pad</button><button class="btn small" data-orbit-now="${l.id}">⏭ Warp to orbit</button>` : `<button class="btn small warp-orbit" data-warp-orbit="${l.id}">⏭ Warp to orbit</button><button class="btn small ghost" data-warp="${l.id}">⏩ Warp to launch day</button>`}<button class="btn small ghost" data-scrub="${l.id}">Scrub (50% refund)</button></div></li>`;
        }).join('')}</ul>` : '<p class="muted">Nothing scheduled.</p>'}
        ${flown.length ? `<h3>Past launches</h3><ul class="sched">${flown.map(l => `<li><b>${l.qty}× ${esc(l.designName)}</b><span class="muted">${SIM.fmtDate(l.date)} · ${l.outcome === 'success' ? '✅ success' : l.outcome === 'recovered' ? '↩ aborted, payload recovered' : '❌ failure'}</span></li>`).join('')}</ul>` : ''}
        <h3>How launching works</h3>
        <p class="fine" style="margin-top:0"><b>🚀 Launch</b> builds the satellite, launches it and releases it into orbit at once; the mission clock then runs at 1 year per second and Mission Control shows what happens. The launch-weather risk from the Design page still applies.</p>
        <p class="fine" style="margin-top:0">Launches booked in an older game still work like this: 1. Choose a ride.<br>2. Press <b>⏭ Warp to orbit</b>: time jumps to launch day and the rocket flies itself to orbit. (Prefer to fly? Press <b>⏩ Warp to launch day</b> instead, then <b>🚀 Go to the pad</b>.)<br>3. Press <b>🛰️ Deploy satellite</b>, decide what happens to the empty rocket stage, and pick where to go next.</p>
        <h3>Flying it yourself</h3>
        <div class="keys">The flight is fully 3D. Drag with the mouse to look around the rocket, scroll to zoom (all the way out to see the whole planet).<br><kbd>W</kbd>/<kbd>S</kbd> pitch · <kbd>A</kbd>/<kbd>D</kbd> yaw (turn left/right) · <kbd>Q</kbd>/<kbd>E</kbd> roll · <kbd>Shift</kbd>/<kbd>Ctrl</kbd> throttle · <kbd>Z</kbd> full / <kbd>X</kbd> cut · <kbd>Space</kbd> stage · <kbd>T</kbd> autopilot on/off · <kbd>F</kbd> drop the fairing · <kbd>M</kbd> map view · <kbd>,</kbd>/<kbd>.</kbd> time warp · <kbd>Enter</kbd> deploy.<br>Real forces act on the rocket: gravity, thrust that changes with air pressure, drag that peaks at the sound barrier, winds aloft, heating and cold. The rocket is stable, so the air keeps its nose pointed into the wind, but steering hard while the air pressure is high (max-Q) can break it apart, and dropping the fairing below ~100 km cooks the satellites.<br>
        Touching the controls pauses the autopilot. When you let go for 2.5 s it re-plans from wherever you left the rocket. You can also give it a command at any time: take off, reach orbit, circularise, change orbit, deorbit, or land.</div>
      </div>
    </div>`;
    bindPlanner(d, comp, opt, site, inc, feas);
    loadOptImages();
  }

  // Itemised list of what the build cost adds on top of the parts chosen on design.html
  function extrasHTML(comp, qty) {
    const rows = [
      [comp.busUsed.name + ' frame', comp.busUsed.price],
      [comp.wheels.name, comp.wheels.price],
      [comp.array.name, comp.array.price],
      ...comp.auto.map(a => [a.name, a.price]),
      ['Integration & testing (12% of hardware)', comp.integration],
      ['Licences (radio spectrum, remote sensing)', comp.licensing],
      ...(comp.toxicFee ? [['Hydrazine handling & fuelling', comp.toxicFee]] : []),
    ];
    return `<details class="note" style="margin-top:8px"><summary>Breakdown of Subsystems, frame &amp; integration costs</summary>
      <div class="kv" style="margin-top:6px">${rows.map(([n, p]) => `<span>${esc(n)}</span><b>${fmt$(p)}</b>`).join('')}<span>Total${qty > 1 ? ' per satellite' : ''}</span><b>${fmt$(comp.cost - comp.partsCost)}</b></div></details>`;
  }

  function orbitAdvice(alt, inc) {
    const tips = [];
    if (alt < 400) tips.push('Very low: sharp images but heavy drag, so expect months, not years, without thrusters.');
    else if (alt < 600) tips.push('Classic Earth-observation altitude: good detail, drag manageable with station-keeping.');
    else if (alt > 900) tips.push('High: long life and wide coverage, but more radiation and coarser detail.');
    if (inc < 60) tips.push(`Can't see above ${inc.toFixed(0)}° latitude: no Arctic permafrost, Yamal or Alaska.`);
    else if (inc > 95 && inc < 100) tips.push('Sun-synchronous: same local time every pass, ideal for sunlight-hungry SWIR instruments.');
    return tips.join(' ');
  }

  async function loadOptImages() {
    for (const [id, queries] of Object.entries(NASA_IMAGES.LAUNCH_PHOTO_QUERIES)) {
      if (optImgs[id]) continue;
      const it = await NASA_IMAGES.firstPhoto(queries);
      if (it) { optImgs[id] = it.thumb; const img = document.querySelector(`[data-optimg="${id}"]`); if (img) { img.src = it.thumb; img.style.display = ''; img.title = `${it.title} (NASA, ${it.id})`; } }
    }
  }

  function bindPlanner(d, comp, opt, site, inc, feas) {
    const S = SIM.state;
    const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
    on('#lp-design', 'change', e => { sel.design = e.target.value; renderPlanner(); });
    on('#lp-qty', 'change', e => { sel.qty = clamp(Math.round(+e.target.value || 1), 1, 12); renderPlanner(); });
    on('#lp-site', 'change', e => { sel.site = e.target.value; renderPlanner(); });
    on('#lp-alt', 'input', e => { sel.alt = +e.target.value; e.target.nextElementSibling.textContent = sel.alt + ' km'; });
    on('#lp-alt', 'change', () => renderPlanner());
    on('#lp-inc', 'change', e => { sel.incCustom = clamp(+e.target.value, 0, 180); renderPlanner(); });
    on('#lp-recover', 'change', e => { sel.recover = e.target.checked; });
    $$('#launch-planner [data-opt]').forEach(x => x.onclick = () => { sel.opt = x.dataset.opt; const o = LAUNCH_OPTIONS.find(y => y.id === sel.opt); if (o.targetAlt) sel.alt = o.targetAlt; if (o.targetInc === 'sso') sel.inc = 'sso'; renderPlanner(); });
    $$('#launch-planner [data-inc]').forEach(x => x.onclick = () => { sel.inc = x.dataset.inc; renderPlanner(); });
    on('#lp-book', 'click', () => {
      const r = SIM.bookLaunch(sel.opt, d, sel.qty, { alt: sel.alt, inc, site: site.id, recover: sel.recover });
      if (!r.ok) { UI.toast(r.msg, 'bad'); return; }
      launchNow(r.launch);
    });
    $$('#launch-planner [data-warp]').forEach(x => x.onclick = () => { autoOrbit = null; GUIDE.warpToLaunch(x.dataset.warp); UI.updateTop(true); });
    $$('#launch-planner [data-warp-orbit]').forEach(x => x.onclick = () => { autoOrbit = x.dataset.warpOrbit; GUIDE.warpToLaunch(x.dataset.warpOrbit, { toOrbit: true }); UI.updateTop(true); });
    $$('#launch-planner [data-orbit-now]').forEach(x => x.onclick = () => flyToOrbit(S.launches.find(l => l.id === x.dataset.orbitNow)));
    $$('#launch-planner [data-scrub]').forEach(x => x.onclick = () => {
      const L = S.launches.find(l => l.id === x.dataset.scrub);
      SIM.ledger(Math.round((L.price + L.satCost) * 0.5), `Scrubbed launch refund: ${L.designName}`);
      L.status = 'flown'; L.outcome = 'scrubbed';
      SIM.decision('launch', `Scrubbed ${L.designName}`, 'Cancelling recovers half the money but loses the slot.', 'Half of the cost was refunded.');
      UI.updateTop(true); renderPlanner();
    });
    $$('#launch-planner [data-fly]').forEach(x => x.onclick = () => startFlight(S.launches.find(l => l.id === x.dataset.fly)));
  }

  /* ======================= FLIGHT ======================= */
  function startFlight(L) {
    const S = SIM.state;
    const opt = LAUNCH_OPTIONS.find(o => o.id === L.opt);
    const comp = DESIGN.compute(L.parts);
    const site = LAUNCH_SITES.find(s => s.id === L.site);
    launchMs = S.t + 10000;
    flight = FLIGHT.create({
      rocketId: opt.rocket, payloadKg: comp.mass * L.qty + 10 + (opt.extraPayload || 0), site, inc: L.target.inc, targetAlt: L.target.alt,
      reliability: ROCKETS[opt.rocket].reliability * (S.cfg.agency === 'startup' ? 0.97 : 1), recover: L.target.recover !== false, manifestAlt: opt.id === 'rideshare' ? opt.targetAlt : null,
      launchMs,
    });
    flight.ap.engaged = true;
    flightL = L; mapMode = false; flightWarp = 1;
    S.flightActive = true; S.paused = true;
    $('#launch-planner').hidden = true; $('#flight').hidden = false; $('#flight-msg').hidden = true;
    SIM.decision('launch', `Launching ${L.qty}× ${L.designName}`, 'The autopilot flies a gravity turn into the target orbit plane. Taking manual control lets you change the trajectory, but too much angle of attack at high dynamic pressure breaks the rocket, and dropping the fairing too low overheats the satellites.', 'Flight in progress.');
    ensureScene();
    FlightScene.start(flight);
    flight.hold = true; // the countdown waits for the player's choice
    renderHudStatic();
    padChoice();
  }
  // Launch control: three clear ways to fly
  function padChoice() {
    const site = flight.site.name;
    flightMessage('🚀 Ready for launch', `<b>${esc(flightL.qty > 1 ? flightL.qty + '× ' : '')}${esc(flightL.designName)}</b> is on the pad at ${esc(site)}, going to a <b>${flightL.target.alt} km</b> orbit at <b>${flightL.target.inc.toFixed(1)}°</b>. How do you want to fly?
      <span class="fm-options"><span><b>🚀 Launch with autopilot</b>: the autopilot flies the whole way; you watch, and can take over at any time.</span>
      <span><b>⏭ Warp to orbit</b>: the flight is simulated in a second and you go straight to releasing the satellite.</span>
      <span><b>🕹️ Fly it myself</b>: you steer (W/S pitch, A/D turn, Shift/Ctrl throttle, Space stage). Hard to master!</span></span>`,
      [['skip', '⏭ Warp to orbit'], ['auto', '🚀 Launch with autopilot'], ['manual', '🕹️ Fly it myself']]);
  }
  // ⏭ Warp to orbit: works at any moment, autopilot on or off. The autopilot takes over to finish the climb,
  // and the real physics runs in fast-forward (so failures can still happen).
  function warpToOrbit() {
    const f = flight; if (!f || f.ended) return;
    if (f.deployed) { UI.toast('The satellite is already deployed.'); return; }
    const o0 = FLIGHT.orbit(f);
    if (o0.pe > 150e3) { orbitPrompt(true); return; }
    f.hold = false;
    $('#flight-msg').hidden = true;
    const wasManual = !f.ap.engaged;
    f.ap.engaged = true; f.ap.manualUntil = -1e9; f.ap.landing = false;
    if (!['ascend', 'circularize'].includes(f.ap.program)) { f.ap.program = FLIGHT.alt(f) > 70e3 && o0.ap > 100e3 ? 'circularize' : 'ascend'; f.ap.phase = ''; }
    if (wasManual) FLIGHT.note(f, 'Warp to orbit: the autopilot takes over from your current trajectory.', 'adapt');
    const t0 = f.t;
    let guard = 0;
    while (!f.ended && f.ap.program !== 'hold-prograde' && f.t - t0 < 6000 && guard++ < 400000) {
      const fine = f.thrustOn || FLIGHT.alt(f) < 130e3;
      FLIGHT.step(f, fine ? 0.02 : 0.5, false);
    }
    const simSec = Math.max(0, f.t - Math.max(0, t0));
    if (simSec > 0) SIM.advance(simSec);
    renderHudStatic();
    if (f.ended) { onFlightEnd(); return; }
    const o = FLIGHT.orbit(f);
    FLIGHT.note(f, `⏭ Warped ${Math.round((f.t - t0) / 60)} minutes of flight.`, 'good');
    if (o.pe > 150e3) orbitPrompt(true);
    else UI.toast('Could not reach a stable orbit (not enough fuel left?). Try a lower target or land / abort.', 'warn');
  }
  // big, clear prompt once a stable orbit is reached
  function orbitPrompt(force) {
    const f = flight; if (!f || f.deployed || f.ended) return;
    if (f.orbitPrompted && !force) return;
    f.orbitPrompted = true;
    const o = FLIGHT.orbit(f);
    flightMessage('✅ You made it to orbit!', `${(o.ap / 1000).toFixed(0)} × ${(o.pe / 1000).toFixed(0)} km at ${o.inc.toFixed(2)}° (target ${flightL.target.alt} km, ${f.inc.toFixed(1)}°).<br>Release your satellite to start its mission.`,
      [['deploy', '🛰️ Deploy satellite'], ['stay', 'Not yet']]);
  }
  function ensureScene() {
    if (!FlightScene.ready) FlightScene.init($('#flight-canvas'));
    if (!$('#flight-labels')) { const d = document.createElement('div'); d.id = 'flight-labels'; d.hidden = true; $('#flight').appendChild(d); }
    FlightScene.resize();
  }

  function endFlight() {
    const S = SIM.state;
    S.flightActive = false;
    flight = null; flightL = null;
    $('#flight').hidden = true; $('#launch-planner').hidden = false;
    renderPlanner();
    UI.updateTop(true);
  }

  function deploy() {
    const f = flight, S = SIM.state, L = flightL;
    if (!f || f.deployed) return;
    const o = FLIGHT.orbit(f);
    if (o.pe < 150e3) { UI.toast(`Periapsis is ${(o.pe / 1000).toFixed(0)} km. Satellites need at least 150 km or they re-enter within days.`, 'warn', 'Deploy'); return; }
    if (f.fairing) FLIGHT.jettisonFairing(f);
    f.deployed = true;
    f.payload -= DESIGN.compute(L.parts).mass * L.qty;
    const el0 = FLIGHT.toElements(f, launchMs, S.t);
    const damage = FLIGHT.payloadDamage(f);
    for (let k = 0; k < L.qty; k++) {
      // constellation: spread satellites evenly along the orbit
      const el = { ...el0, M: ORB.wrap(el0.M + (L.qty > 1 ? k / L.qty * ORB.TAU : 0)) };
      const name = L.qty > 1 ? `${L.designName}-${String.fromCharCode(65 + k)}` : L.designName;
      const sat = SIM.addSatellite(name, L.parts, el, { opt: L.opt, date: SIM.fmtDate(S.t) });
      // heat or cold suffered during the flight comes along into orbit
      damage.forEach(d => {
        sat.faults.push({ t: S.t, part: d.kind, text: d.text });
        if (d.kind === 'heat') { sat.calibDrift = true; if (d.severe) sat.batteryHealth = Math.max(0.3, sat.batteryHealth - 0.35); }
        if (d.kind === 'cold') sat.batteryHealth = Math.max(0.3, sat.batteryHealth - (d.severe ? 0.3 : 0.15));
      });
    }
    if (damage.length) SIM.logEvent('bad', `${L.designName}: ${damage.map(d => d.text.toLowerCase()).join('; ')}.`);
    if (L.qty > 1) SIM.logEvent('info', `In reality a constellation is spread by tiny drift manoeuvres over weeks; here the ${L.qty} satellites are phased evenly around the orbit.`);
    const res = { ok: true, apo: o.ap / 1000, peri: o.pe / 1000, inc: o.inc };
    if (f.manifestAlt && Math.abs(o.ap / 2 + o.pe / 2 - f.manifestAlt * 1000) > 60e3) {
      SIM.logEvent('bad', 'Rideshare customers were deployed far from the manifest orbit. The launch provider is not happy.');
      SIM.state.trust = Math.max(0, SIM.state.trust - 2);
    }
    if (f.boosterRecovered) { const refund = Math.round(L.price * 0.3); SIM.ledger(refund, 'Booster recovery credit'); FLIGHT.note(f, `Booster landed: ${fmt$(refund)} credit for reuse.`, 'good'); }
    SIM.launchResult(L, res);
    FLIGHT.note(f, `Deployed ${L.qty}× ${L.designName} into ${(o.ap / 1000).toFixed(0)} × ${(o.pe / 1000).toFixed(0)} km at ${o.inc.toFixed(2)}°.`, 'good');
    flightMessage(L.qty > 1 ? '🛰️ Satellites deployed!' : '🛰️ Satellite deployed!', `${L.qty}× ${esc(L.designName)} in a ${(o.ap / 1000).toFixed(0)} × ${(o.pe / 1000).toFixed(0)} km orbit at ${o.inc.toFixed(2)}°.${damage.length ? `<br><br><b style="color:var(--warn)">⚠ ${esc(damage.map(d => d.text).join('. '))}.</b>` : ''}${stageChoiceHTML()}`,
      [['go-orbit', '🛰️ See it in the Orbit Viewer'], ['go-launch', '🚀 Plan another launch'], ['go-map', '🌡️ Methane map']]);
  }

  function flightMessage(title, html, buttons) {
    const box = $('#flight-msg');
    box.innerHTML = `<h2>${title}</h2><p>${html}</p><div class="modal-actions" style="justify-content:center">${buttons.map(([id, l]) => `<button class="btn ${['leave', 'close', 'stay', 'manual', 'auto', 'go-launch', 'go-map'].includes(id) ? 'ghost' : ''}" data-fm="${id}">${l}</button>`).join('')}</div>`;
    box.hidden = false;
    $$('#flight-msg [data-fm]').forEach(b => b.onclick = () => {
      const id = b.dataset.fm;
      box.hidden = true;
      if (id === 'auto') { flight.hold = false; flight.ap.engaged = true; FLIGHT.note(flight, 'Launch with autopilot.'); renderHudStatic(); }
      if (id === 'manual') { flight.hold = false; flight.ap.engaged = false; flight.throttle = 1; FLIGHT.note(flight, 'Manual flight: the engines light at T−0. Press T any time to hand over to the autopilot.'); renderHudStatic(); }
      if (id === 'skip') warpToOrbit();
      if (id === 'deploy') deploy();
      if (id === 'deorbit') { flight.ap.engaged = true; flight.ap.program = 'deorbit'; flight.ap.phase = ''; flightWarp = 10; }
      if (id === 'deorbit-exit') deorbitAndExit();
      if (id === 'go-orbit') finishFlight('orbit');
      if (id === 'go-launch') finishFlight('launch');
      if (id === 'go-map') finishFlight('map');
      if (id === 'leave') { SIM.state.debris.push({ name: `${flightL ? flightL.designName : ''} upper stage`, el: FLIGHT.toElements(flight, launchMs, SIM.state.t) }); SIM.logEvent('info', 'Upper stage left in orbit as debris.'); endFlight(); }
      if (id === 'orbit') { if (flight && !flight.ended) SIM.state.debris.push({ name: 'Upper stage', el: FLIGHT.toElements(flight, launchMs, SIM.state.t) }); endFlight(); UI.show('orbit'); }
      if (id === 'close') endFlight();
      if (id === 'retry') { endFlight(); }
    });
  }

  // After deploying: the stage's deorbit burn and re-entry are simulated in a second, then the player is back to planning.
  // the "what about the empty rocket stage?" checkbox shown after deploying
  function stageChoiceHTML() {
    return `<label class="fm-check"><input type="checkbox" id="fm-deorbit" checked> <span><b>Bring the empty rocket stage down safely</b><br><small>It burns up over the ocean: no space junk, and the public likes it (+1 support). Untick to leave it in orbit as debris.</small></span></label>
      <b class="fm-where">Where to next?</b>`;
  }
  // leave the flight: deal with the stage as chosen, then open the chosen view
  function finishFlight(dest) {
    const keep = $('#fm-deorbit');
    const deorbit = keep ? keep.checked : true;
    if (flight && !flight.ended) {
      if (deorbit) { deorbitAndExit(); }
      else { SIM.state.debris.push({ name: `${flightL ? flightL.designName : ''} upper stage`, el: FLIGHT.toElements(flight, launchMs, SIM.state.t) }); SIM.logEvent('info', 'Upper stage left in orbit as debris.'); endFlight(); }
    } else if (flight) endFlight();
    UI.show(dest);
  }
  function deorbitAndExit() {
    const f = flight; if (!f) return;
    if (!f.ended) {
      f.hold = false; f.ap.engaged = true; f.ap.manualUntil = -1e9; f.ap.program = 'deorbit'; f.ap.phase = ''; f.ap.landing = false;
      const t0 = f.t; let guard = 0;
      while (!f.ended && f.t - t0 < 20000 && guard++ < 600000) FLIGHT.step(f, (f.thrustOn || FLIGHT.alt(f) < 130e3) ? 0.05 : 1, false);
      if (f.t > t0) SIM.advance(f.t - t0);
    }
    const out = f.outcome || {};
    if (out.disposal) { SIM.state.trust = Math.min(100, SIM.state.trust + 1); SIM.logEvent('good', 'Upper stage deorbited and burned up: responsible disposal (trust +1).'); UI.toast('The upper stage burned up safely over the ocean. Public support +1.', 'good', 'Stage disposed'); }
    else if (!f.ended || !out.landed) { SIM.state.debris.push({ name: `${flightL ? flightL.designName : ''} upper stage`, el: FLIGHT.toElements(f, launchMs, SIM.state.t) }); UI.toast('The stage did not have enough fuel to come down, so it stays in orbit as debris.', 'warn'); }
    endFlight();
  }
  function onFlightEnd() {
    const f = flight, L = flightL;
    const out = f.outcome || {};
    if (f.deployed) {
      if (out.disposal) { SIM.state.trust = Math.min(100, SIM.state.trust + 1); SIM.logEvent('good', 'Upper stage deorbited and burned up: responsible disposal (trust +1).'); }
      flightMessage(out.disposal ? '🔥 Stage disposed' : out.landed ? '✅ Stage landed' : 'Flight over', out.disposal ? 'The upper stage burned up harmlessly. Clean space is good space.' : esc(out.reason || ''), [['orbit', '🛰️ Orbit Viewer'], ['close', 'Back to launch planning']]);
      return;
    }
    if (out.landed) {
      const refund = Math.round(L.satCost * 0.8);
      SIM.ledger(refund, `Payload recovered after abort: ${L.designName}`);
      L.status = 'flown'; L.outcome = 'recovered';
      SIM.decision('launch', `Aborted and landed ${L.designName}`, 'Aborting saves the payload if the vehicle can land.', `Payload recovered; ${fmt$(refund)} of hardware value saved.`);
      flightMessage('↩ Abort: vehicle landed', `The payload was recovered and ${fmt$(refund)} of hardware value saved. Book another launch to try again.`, [['close', 'Back to launch planning']]);
      return;
    }
    SIM.launchResult(L, { ok: false, reason: out.reason || 'unknown' });
    flightMessage('❌ Launch failure', `${esc(out.reason || 'The vehicle was lost')}. The ${L.qty > 1 ? 'satellites were' : 'satellite was'} lost.`, [['close', 'Back to launch planning']]);
  }

  /* ---------- controls (KSP-style) ---------- */
  function manual() { if (!flight) return; flight.ap.manualUntil = flight.t + 2.5; }
  const FLIGHT_KEYS = ['w', 's', 'a', 'd', 'q', 'e', 'shift', 'control', 'z', 'x', ' ', 't', 'm', 'f', 'k', ',', '.', 'enter'];
  function onKey(e, down) {
    if (!flight || UI.active() !== 'launch' || e.target.closest('input, select, textarea')) return;
    const k = e.key.toLowerCase();
    if (FLIGHT_KEYS.includes(k) || e.code === 'Space') e.preventDefault();
    keys[k] = down;
    if (!down) return;
    if (k === ' ' || e.code === 'Space') { manual(); FLIGHT.stage(flight, 'Manual staging'); }
    if (k === 'z') { manual(); flight.throttle = 1; }
    if (k === 'x') { manual(); flight.throttle = 0; }
    if (k === 't') toggleAP();
    if (k === 'm') mapMode = !mapMode;
    if (k === 'f') { manual(); FLIGHT.jettisonFairing(flight, true); }
    if (k === '.') setFlightWarp(+1);
    if (k === ',') setFlightWarp(-1);
    if (k === 'enter') deploy();
    if (k === 'k') warpToOrbit();
  }
  function toggleAP() { flight.ap.engaged = !flight.ap.engaged; FLIGHT.note(flight, flight.ap.engaged ? 'Autopilot engaged.' : 'Autopilot disengaged: full manual control.'); renderHudStatic(); }
  function setFlightWarp(d) {
    const i = WARPS_F.indexOf(flightWarp);
    flightWarp = WARPS_F[clamp(i + d, 0, WARPS_F.length - 1)];
  }
  function command(cmd) {
    const ap = flight.ap;
    const val = +($('#ap-alt') ? $('#ap-alt').value : 0) * 1000;
    ap.engaged = true; ap.manualUntil = -1e9; ap.phase = ''; ap.adaptedLow = false;
    const o = FLIGHT.orbit(flight);
    if (cmd === 'ascend') { ap.program = FLIGHT.alt(flight) > 70e3 && o.ap > 100e3 ? 'circularize' : 'ascend'; if (val) ap.target = val; }
    if (cmd === 'circ') { ap.program = 'circularize'; ap.target = Math.max(150e3, Math.min(o.ap, val || o.ap)); }
    if (cmd === 'change') { ap.target = val; ap.program = val > (o.ap + o.pe) / 2 ? 'raise' : 'lower'; }
    if (cmd === 'deorbit') ap.program = 'deorbit';
    if (cmd === 'land') { ap.program = 'land'; flight.ap.landing = true; }
    if (cmd === 'prograde') ap.program = 'hold-prograde';
    if (cmd === 'retrograde') ap.program = 'hold-retrograde';
    if (cmd === 'radial') ap.program = 'hold-radial';
    FLIGHT.note(flight, `Command: ${cmd}${['ascend', 'change', 'circ'].includes(cmd) ? ` (${(ap.target / 1000).toFixed(0)} km)` : ''}.`);
    renderHudStatic();
  }

  /* ---------- HUD ---------- */
  function renderHudStatic() {
    const f = flight; if (!f) return;
    $('#hud-right').innerHTML = `
      <h3 style="margin-top:0">Mission steps</h3><ol class="mission-steps" id="mission-steps"></ol>
      <div class="big-actions">
        <button class="btn block" id="btn-skip" title="Simulate the rest of the climb in a second (autopilot on or off)">⏭ Warp to orbit <small>(skip the climb)</small></button>
        <button class="btn block" id="btn-deploy2" ${f.deployed ? 'disabled' : ''}>🛰️ Deploy satellite ⏎</button>
      </div>
      <div class="panel-head" style="margin-top:10px"><h3>Autopilot</h3><button class="btn small ${f.ap.engaged ? '' : 'ghost'}" id="ap-toggle" title="Turn the autopilot on or off (T)">${f.ap.engaged ? 'ON' : 'OFF'} (T)</button></div>
      <div class="ap-state" id="ap-state"></div>
      <details class="adv"${advOpen.cmds ? ' open' : ''} data-sec="cmds"><summary>Autopilot commands (advanced)</summary>
      <div class="row"><span class="muted">Target</span><input type="number" id="ap-alt" value="${Math.round(f.ap.target / 1000)}" min="150" max="2000" style="width:80px"> km</div>
      <div class="btn-grid">
        <button class="btn small" data-cmd="ascend">${f.launched ? 'To orbit' : 'Take off'}</button>
        <button class="btn small ghost" data-cmd="circ">Circularise</button>
        <button class="btn small ghost" data-cmd="change">Change orbit</button>
        <button class="btn small ghost" data-cmd="prograde">Prograde</button>
        <button class="btn small ghost" data-cmd="retrograde">Retrograde</button>
        <button class="btn small ghost" data-cmd="radial">Radial out</button>
        <button class="btn small ghost" data-cmd="deorbit">Deorbit</button>
        <button class="btn small ghost" data-cmd="land">Land / abort</button>
        <button class="btn small" id="btn-deploy" ${f.deployed ? 'disabled' : ''}>Deploy ⏎</button>
      </div></details>
      <h3>Stages</h3><div class="stage-stack" id="stage-stack"></div>
      <h3>Flight log</h3><ul class="log-list" id="flight-log" style="max-height:200px;overflow:auto"></ul>`;
    $('#ap-toggle').onclick = toggleAP;
    $$('#hud-right [data-cmd]').forEach(b => b.onclick = () => command(b.dataset.cmd));
    $('#btn-deploy').onclick = deploy;
    $('#btn-deploy2').onclick = () => flight && flight.deployed ? exitPrompt() : deploy();
    $('#btn-skip').onclick = warpToOrbit;
    $('#hud-bottom').innerHTML = `
      <canvas class="navball" id="navball" width="220" height="220"></canvas>
      <div class="throttle" title="Throttle"><i id="thr-bar"></i></div>
      <div style="display:grid;gap:6px">
        <div class="row" style="margin:0"><button class="btn small ghost" data-k="pitchUp" title="W">▲ Pitch</button><button class="btn small ghost" data-k="pitchDown" title="S">▼ Pitch</button><button class="btn small ghost" data-k="yawL" title="A">◀ Yaw</button><button class="btn small ghost" data-k="yawR" title="D">Yaw ▶</button></div>
        <div class="row" style="margin:0"><button class="btn small ghost" data-k="thrUp" title="Shift">＋ Throttle</button><button class="btn small ghost" data-k="thrDown" title="Ctrl">− Throttle</button><button class="btn small ghost" data-k="fairing" title="F">Fairing F</button></div>
        <div class="row" style="margin:0"><button class="btn small" data-k="stage">Stage ␣</button><button class="btn small ghost" data-k="map">Map M</button><button class="btn small ghost" data-k="abort">Exit</button></div>
      </div>
      <div style="display:grid;gap:4px;text-align:center"><span class="muted" style="font-size:11px" title="How fast the flight plays (limited to 4× in the air or while the engine burns)">FLIGHT SPEED</span><div class="row" style="margin:0"><button class="btn small ghost" data-k="wDown">«</button><b class="mono" id="fw-label">1×</b><button class="btn small ghost" data-k="wUp">»</button></div></div>`;
    $$('#hud-bottom [data-k]').forEach(b => {
      const k = b.dataset.k;
      b.onclick = () => {
        if (k === 'pitchUp') { manual(); flight.pitch += 2; } if (k === 'pitchDown') { manual(); flight.pitch -= 2; }
        if (k === 'yawL') { manual(); flight.heading -= 2; } if (k === 'yawR') { manual(); flight.heading += 2; }
        if (k === 'thrUp') { manual(); flight.throttle = clamp(flight.throttle + 0.1, 0, 1); } if (k === 'thrDown') { manual(); flight.throttle = clamp(flight.throttle - 0.1, 0, 1); }
        if (k === 'fairing') { manual(); FLIGHT.jettisonFairing(flight, true); }
        if (k === 'stage') { manual(); FLIGHT.stage(flight, 'Manual staging'); } if (k === 'map') mapMode = !mapMode;
        if (k === 'wUp') setFlightWarp(1); if (k === 'wDown') setFlightWarp(-1);
        if (k === 'abort') exitPrompt();
      };
    });
  }
  function exitPrompt() {
    if (flight.deployed) { flightMessage('Leave the flight', `Your satellite is in orbit.${stageChoiceHTML()}`, [['go-orbit', '🛰️ See it in the Orbit Viewer'], ['go-launch', '🚀 Plan another launch'], ['go-map', '🌡️ Methane map'], ['stay', 'Stay here']]); return; }
    flightMessage('Exit the flight?', 'Leaving before deploying means losing the satellites. Use “Land / abort” to try to save them instead.', [['land-now', 'Abort and land'], ['scrap', 'Abandon flight (lose payload)'], ['resume', 'Keep flying']]);
    $$('#flight-msg [data-fm="land-now"]').forEach(x => x.onclick = () => { $('#flight-msg').hidden = true; command('land'); });
    $$('#flight-msg [data-fm="scrap"]').forEach(x => x.onclick = () => { $('#flight-msg').hidden = true; flight.ended = true; flight.outcome = { ok: false, reason: 'Flight abandoned' }; });
    $$('#flight-msg [data-fm="resume"]').forEach(x => x.onclick = () => { $('#flight-msg').hidden = true; });
  }

  const advOpen = { cmds: false, air: false, heat: false, more: false };
  document.addEventListener('toggle', e => { const d = e.target; if (d && d.matches && d.matches('details.adv') && d.dataset.sec) { advOpen[d.dataset.sec] = d.open; if (d.open && flight) updateHud(); } }, true);
  const fmtT = s => { const a = Math.abs(s); const m = Math.floor(a / 60), ss = Math.floor(a % 60); return `${s < 0 ? 'T−' : 'T+'}${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`; };
  const degC = k => `${Math.round(k - 273.15)}°C`;
  const fmtFlux = x => x >= 1000 ? (x / 1000).toFixed(1) + ' kW/m²' : x.toFixed(0) + ' W/m²';
  function updateHud() {
    const f = flight;
    const o = FLIGHT.orbit(f);
    const h = FLIGHT.alt(f);
    const V = FLIGHT.vec;
    const up = V.norm(f.r);
    const sv = FLIGHT.surfaceVel(f);
    const vr = V.dot(f.v, up);
    const air = f.air;
    const qWarn = f.q / 1000 * f.aoa;
    const pressure = air.p > 100 ? (air.p / 1000).toFixed(1) + ' kPa' : air.p > 0.1 ? air.p.toFixed(1) + ' Pa' : '≈ vacuum';
    // the panel is built once per flight; only the numbers are replaced, so the fold-out sections stay clickable
    if (!$('#hl-traj') || $('#hud-left').dataset.flight !== String(f.launchMs)) {
      $('#hud-left').dataset.flight = String(f.launchMs);
      $('#hud-left').innerHTML = `<div class="panel-head"><h3>${esc(f.rk.name)}</h3></div>
      <div class="hud-sec">Trajectory</div><div class="kv" id="hl-traj"></div>
      <details class="adv"${advOpen.more ? ' open' : ''} data-sec="more"><summary>More flight data</summary><div class="kv" id="hl-more"></div></details>
      <details class="adv"${advOpen.air ? ' open' : ''} data-sec="air"><summary>Air &amp; forces</summary><div class="kv" id="hl-air"></div></details>
      <details class="adv"${advOpen.heat ? ' open' : ''} data-sec="heat"><summary>Heat &amp; cold</summary><div class="kv" id="hl-heat"></div></details>`;
    }
    $('#hl-traj').innerHTML = `
      <span>Mission time</span><b>${fmtT(f.t)}</b><span>Altitude</span><b>${(h / 1000).toFixed(h < 10000 ? 2 : 1)} km</b>
      <span>Vertical speed</span><b>${vr.toFixed(0)} m/s</b><span>Surface speed</span><b>${V.len(sv).toFixed(0)} m/s</b>
      <span>Orbital speed</span><b>${o.v.toFixed(0)} m/s</b><span>Apoapsis</span><b>${o.escape ? '∞' : (o.ap / 1000).toFixed(1) + ' km'}</b>
      <span>Periapsis</span><b style="color:${o.pe > 150e3 ? 'var(--good)' : o.pe > 0 ? 'var(--warn)' : ''}">${(o.pe / 1000).toFixed(1)} km</b><span>Time to apoapsis</span><b>${isFinite(o.tAp) ? (o.tAp / 60).toFixed(1) + ' min' : '—'}</b>
      <span>Inclination</span><b>${o.inc.toFixed(2)}° <small class="muted">target ${f.inc.toFixed(1)}°</small></b>`;
    $('#hl-more').innerHTML = `<span>Pitch · heading</span><b>${f.pitch.toFixed(1)}° · ${f.heading.toFixed(0)}°</b>
      <span>Downrange</span><b>${FLIGHT.downrangeKm(f).toFixed(0)} km</b><span>Δv remaining</span><b>${FLIGHT.dvLeft(f).toFixed(0)} m/s</b>`;
    $('#hl-air').innerHTML = `
      <span>Air pressure</span><b>${pressure}</b><span>Air temperature</span><b>${degC(air.T)}${air.p < 1 ? ' <small class="muted">too thin to matter</small>' : ''}</b>
      <span>Mach</span><b>${f.mach.toFixed(2)}${f.mach > 0.9 && f.mach < 1.2 && h < 20e3 ? ' <small class="muted">sound barrier</small>' : ''}</b><span>Dyn. pressure (Q)</span><b style="color:${f.q > 40000 ? 'var(--fail)' : f.q > 25000 ? 'var(--warn)' : ''}">${(f.q / 1000).toFixed(1)} kPa <small class="muted">max ${(f.maxQ / 1000).toFixed(1)}</small></b>
      <span>Angle of attack</span><b style="color:${qWarn > 150 ? 'var(--fail)' : qWarn > 90 ? 'var(--warn)' : ''}">${f.q < 20 ? '— <small class="muted">no air</small>' : f.aoa.toFixed(1) + '°'}${qWarn > 90 ? ' ⚠ side load' : ''}</b><span>Aero stability</span><b>${f.alphaHold >= 90 ? 'controls dominate' : `air limits you to ${f.alphaHold.toFixed(0)}°`}</b>
      <span>G-load</span><b>${f.g.toFixed(2)} g</b><span>Mass</span><b>${(FLIGHT.mass(f) / 1000).toFixed(2)} t</b>`;
    $('#hl-heat').innerHTML = `
      <span>Aero heating</span><b style="color:${f.heatFlux > 1e5 ? 'var(--fail)' : f.heatFlux > 2e4 ? 'var(--warn)' : ''}">${fmtFlux(f.heatFlux)}</b><span>Skin temperature</span><b style="color:${f.skinT > 800 ? 'var(--fail)' : f.skinT > 550 ? 'var(--warn)' : ''}">${degC(f.skinT)}</b>
      <span>Payload temperature</span><b style="color:${f.payloadT > 345 || f.payloadT < 240 ? 'var(--warn)' : ''}">${degC(f.payloadT)}${f.fairing ? ' <small class="muted">in fairing</small>' : ''}</b><span>${f.fairing ? 'Heating if fairing dropped' : 'Free-molecular heating'}</span><b style="color:${f.fmh > 1135 ? 'var(--warn)' : 'var(--good)'}">${fmtFlux(f.fmh)}</b>
      <span>Sunlight</span><b>${f.sunlit ? '☀️ in sunlight' : "🌑 Earth's shadow"}</b>`;
    const manualNow = f.t < f.ap.manualUntil;
    const apEl = $('#ap-state');
    if (apEl) {
      const adapt = f.ap.adaptFlash && f.t < f.ap.adaptFlash;
      apEl.className = 'ap-state ' + (!f.ap.engaged ? 'manual' : manualNow ? 'manual' : adapt ? 'adapt' : 'auto');
      apEl.textContent = !f.ap.engaged ? 'MANUAL: autopilot off' : manualNow ? `MANUAL OVERRIDE · resuming in ${(f.ap.manualUntil - f.t).toFixed(1)} s` : adapt ? 'ADAPTING to your inputs…' : `AUTO · ${f.ap.program}${f.ap.phase ? ' · ' + f.ap.phase : ''}`;
    }
    const ms = $('#mission-steps');
    if (ms) {
      const steps = [
        ['Liftoff', f.liftedOff],
        ['Through max-Q (peak air pressure)', f.liftedOff && FLIGHT.alt(f) > 18e3 && f.q < f.maxQ * 0.6],
        ['Booster separation', f.stageIdx > 0],
        ['Nose fairing released', !f.fairing],
        ['Stable orbit', o.pe > 150e3],
        ['Satellite deployed', f.deployed],
      ];
      const cur = steps.findIndex(x => !x[1]);
      ms.innerHTML = steps.map(([t, ok], i) => `<li class="${ok ? 'done' : i === cur ? 'now' : ''}">${ok ? '✓' : i === cur ? '▶' : '○'} ${t}</li>`).join('');
    }
    const sk = $('#btn-skip'); if (sk) sk.disabled = f.deployed || f.ended || o.pe > 150e3;
    const d2 = $('#btn-deploy2');
    if (d2) {
      const label = f.deployed ? '✅ Exit flight' : '🛰️ Deploy satellite ⏎';
      if (d2.textContent !== label) d2.textContent = label;
      d2.disabled = !f.deployed && o.pe < 150e3;
      d2.classList.toggle('ready', f.deployed || o.pe >= 150e3);
    }
    if (o.pe > 150e3 && !f.deployed && !f.hold && $('#flight-msg').hidden) orbitPrompt(false);
    const ss = $('#stage-stack');
    if (ss) ss.innerHTML = f.stages.map((s, i) => `<div class="stage-row ${i < f.stageIdx ? 'muted' : ''}"><div class="lbl" style="display:flex;justify-content:space-between"><span>${i === f.stageIdx ? '▶ ' : ''}${esc(s.name)}${s.engineFactor < 1 ? ' ⚠ engine out' : ''}</span><b class="mono">${i < f.stageIdx ? 'separated' : (s.propLeft / 1000).toFixed(1) + ' t'}</b></div>
      <div class="bar"><i class="${s.propLeft / s.prop < 0.15 ? 'warn' : 'good'}" style="width:${i < f.stageIdx ? 0 : s.propLeft / s.prop * 100}%"></i></div></div>`).join('')
      + `<div class="stage-row">${f.fairing ? 'Fairing on (F to jettison)' : 'Fairing jettisoned'} · payload ${(f.payload / 1000).toFixed(2)} t ${f.deployed ? '(deployed)' : ''}</div>`;
    const lg = $('#flight-log');
    if (lg && lg.childElementCount !== f.log.length) lg.innerHTML = f.log.slice().reverse().map(l => `<li><span class="d">${fmtT(l.t)}</span><span class="${l.kind === 'bad' ? 'bad' : l.kind === 'good' ? 'good' : ''}">${esc(l.msg)}</span></li>`).join('');
    $('#thr-bar').style.height = (f.throttle * 100) + '%';
    $('#fw-label').textContent = flightWarp + '×';
    const bd = $('#btn-deploy'); if (bd) bd.disabled = f.deployed || o.pe < 150e3;
    $('#hud-top').textContent = `${flightL.designName} · ${fmtT(f.t)} · ${!f.liftedOff ? 'on the pad' : o.pe > 150e3 ? 'IN ORBIT' : h > 100e3 ? 'in space' : 'ascending'}${mapMode ? ' · MAP' : ''} · drag to look around, scroll to zoom`;
    drawNavball();
  }

  // navball: horizon by pitch, heading tape, and prograde / retrograde markers relative to where the nose points
  function drawNavball() {
    const cv = $('#navball'); if (!cv) return;
    const g = cv.getContext('2d'), w = cv.width, R = w / 2 - 6, f = flight;
    const V = FLIGHT.vec;
    g.clearRect(0, 0, w, w);
    g.save(); g.beginPath(); g.arc(w / 2, w / 2, R, 0, Math.PI * 2); g.clip();
    const k = R / 90;
    const off = clamp(f.pitch, -90, 90) * k;
    g.fillStyle = '#2b6cb0'; g.fillRect(0, 0, w, w / 2 + off);
    g.fillStyle = '#8a5a2b'; g.fillRect(0, w / 2 + off, w, w);
    g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1; g.fillStyle = '#fff'; g.font = '11px JetBrains Mono';
    for (let p = -60; p <= 60; p += 30) { const y = w / 2 + off - p * k; g.beginPath(); g.moveTo(w / 2 - 30, y); g.lineTo(w / 2 + 30, y); g.stroke(); if (p) g.fillText(String(p), w / 2 + 34, y + 4); }
    for (let d = -60; d <= 60; d += 15) {
      const hd = Math.round((f.heading + d) / 15) * 15; const x = w / 2 + (hd - f.heading) * k; const lab = ((hd % 360) + 360) % 360;
      g.fillText(lab === 0 ? 'N' : lab === 90 ? 'E' : lab === 180 ? 'S' : lab === 270 ? 'W' : String(lab), x - 8, 24);
    }
    const marker = (vec, back) => {
      if (V.len(vec) < 1) return;
      const ph = FLIGHT.phFromDir(f.r, V.norm(vec));
      const dh = ((ph.hdg - f.heading + 540) % 360) - 180;
      const x = w / 2 + clamp(dh * Math.cos(f.pitch * Math.PI / 180), -88, 88) * k, y = w / 2 - clamp(ph.pitch - f.pitch, -88, 88) * k;
      g.strokeStyle = '#ffd257'; g.lineWidth = 3; g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.stroke();
      g.beginPath();
      if (back) { g.moveTo(x - 6, y - 6); g.lineTo(x + 6, y + 6); g.moveTo(x + 6, y - 6); g.lineTo(x - 6, y + 6); } else { g.moveTo(x, y - 9); g.lineTo(x, y - 16); }
      g.stroke();
    };
    const pro = FLIGHT.alt(f) < 40e3 ? FLIGHT.surfaceVel(f) : f.v;
    marker(pro, false);
    marker(V.mul(pro, -1), true);
    g.restore();
    g.strokeStyle = '#ffd257'; g.lineWidth = 3; g.beginPath(); g.moveTo(w / 2 - 34, w / 2); g.lineTo(w / 2 - 10, w / 2); g.lineTo(w / 2, w / 2 + 8); g.lineTo(w / 2 + 10, w / 2); g.lineTo(w / 2 + 34, w / 2); g.stroke();
    g.strokeStyle = 'rgba(120,170,255,.5)'; g.lineWidth = 3; g.beginPath(); g.arc(w / 2, w / 2, R, 0, Math.PI * 2); g.stroke();
  }

  /* ---------- per-frame ---------- */
  function frame(realDt) {
    if (!flight) return;
    const f = flight;
    // continuous keys: W/S pitch, A/D yaw (heading), Q/E roll, Shift/Ctrl throttle
    if (keys.w) { manual(); f.pitch += 25 * realDt; }
    if (keys.s) { manual(); f.pitch -= 25 * realDt; }
    if (keys.a) { manual(); f.heading -= 25 * realDt; }
    if (keys.d) { manual(); f.heading += 25 * realDt; }
    if (keys.q) f.roll -= 60 * realDt;
    if (keys.e) f.roll += 60 * realDt;
    if (keys.shift) { manual(); f.throttle = clamp(f.throttle + 0.8 * realDt, 0, 1); }
    if (keys.control) { manual(); f.throttle = clamp(f.throttle - 0.8 * realDt, 0, 1); }
    // physics warp: limited under thrust or in the atmosphere
    const h = FLIGHT.alt(f);
    let w = flightWarp;
    if ((f.thrustOn || h < 80e3) && w > 4) w = 4;
    f._warp = w;
    const sim = Math.min(realDt, 0.1) * w;
    const fine = f.thrustOn || h < 130e3;
    const dt = fine ? 0.02 : 0.5;
    let n = Math.ceil(sim / dt);
    if (n > 3000) n = 3000;
    const wasEnded = f.ended;
    for (let i = 0; i < n && !f.ended; i++) FLIGHT.step(f, sim / n, true);
    // the world clock follows the flight
    if (f.t > 0) SIM.advance(Math.max(0, sim));
    if (!wasEnded && f.ended) onFlightEnd();
    if (UI.active() === 'launch' && flight) {
      FlightScene.render(f, { mapMode, labels: $('#flight-labels') });
      if (performance.now() - lastHud > 120) { updateHud(); lastHud = performance.now(); }
    }
  }

  function show() {
    if (flight) { $('#launch-planner').hidden = true; $('#flight').hidden = false; ensureScene(); renderHudStatic(); }
    else { $('#flight').hidden = true; $('#launch-planner').hidden = false; renderPlanner(); }
  }

  window.addEventListener('keydown', e => onKey(e, true));
  window.addEventListener('keyup', e => onKey(e, false));
  window.addEventListener('resize', () => { if (flight) FlightScene.resize(); });
  SIM.on('launches', () => { if (UI.active() === 'launch' && !flight) renderPlanner(); });

  // test hook: run the flight physics for `secs` seconds without drawing
  function fastForward(secs) {
    const f = flight; if (!f) return;
    f.hold = false; $('#flight-msg').hidden = true;
    const end = f.t + secs;
    while (flight && !f.ended && f.t < end) {
      const fine = f.thrustOn || FLIGHT.alt(f) < 130e3;
      const wasEnded = f.ended;
      FLIGHT.step(f, fine ? 0.02 : 0.5, false);
      if (!wasEnded && f.ended) onFlightEnd();
    }
    if (f.t > 0) SIM.advance(secs);
  }
  // called on launch day: if the player chose "⏭ Warp to orbit", fly straight to orbit
  let autoOrbit = null;
  function autoFly(L) {
    if (!autoOrbit || autoOrbit !== L.id) return false;
    autoOrbit = null;
    const waited = typeof GUIDE !== 'undefined' ? GUIDE.warpSummaryHTML() : '';
    UI.show('launch');
    startFlight(L);
    warpToOrbit();
    if (waited && !$('#flight-msg').hidden) $('#flight-msg p').insertAdjacentHTML('beforeend', waited);
    return true;
  }
  // launch day, straight to orbit (used by the schedule and the launch-day pop-up)
  // 🚀 Launch: no waiting for launch day and no flight scene. The rocket goes now (with the launch-weather
  // risk from the Design page), the satellites are released at the target orbit, and the mission clock runs.
  function launchNow(L) {
    const S = SIM.state;
    L.date = S.t;
    let risk = 0.03;
    try { const w = JSON.parse(safeGet('cfx.launch.v1') || 'null'); if (w && w.judge) risk = Math.min(0.6, Math.max(0.02, w.judge.risk)); } catch { /* no weather check */ }
    if (Math.random() < risk) {
      SIM.launchResult(L, { ok: false, reason: `the rocket failed in flight (launch-weather risk ${Math.round(risk * 100)}%)` });
      UI.toast(`${L.designName} was lost at launch (weather risk ${Math.round(risk * 100)}%). Try again or pick a site with better weather.`, 'bad', 'Launch failed');
      UI.updateTop(true); renderPlanner();
      return;
    }
    const { alt, inc } = L.target;
    const raan = Math.random() * ORB.TAU;
    for (let k = 0; k < L.qty; k++) {
      const el = { a: ORB.RE + alt * 1000, e: 0.0008, i: inc * ORB.DEG, raan, argp: 0, M: L.qty > 1 ? k / L.qty * ORB.TAU : 0, epoch: S.t };
      SIM.addSatellite(L.qty > 1 ? `${L.designName}-${String.fromCharCode(65 + k)}` : L.designName, L.parts, el, { opt: L.opt, date: SIM.fmtDate(S.t) });
    }
    SIM.launchResult(L, { ok: true, apo: alt, peri: alt, inc });
    UI.toast(`${L.qty}× ${L.designName} is in orbit at ${alt} km. The mission is running.`, 'good', '🚀 Launched');
    S.paused = false;
    UI.setWarp(DEFAULT_WARP);
    UI.show('ops');
    UI.updateTop(true);
  }
  function flyToOrbit(L) { if (!L || L.status !== 'ready') return; UI.show('launch'); startFlight(L); warpToOrbit(); }
  return { autoFly, flyToOrbit, show, frame, preselect, renderPlanner, deploy, fastForward, setMap: on => { mapMode = on; }, get flying() { return !!flight; }, get flight() { return flight; }, warpToOrbit };
})();
UI.register('launch', LaunchView);
