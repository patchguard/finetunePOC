/* =========================================================================
   Mission: Blue Marble — world simulation (no DOM)
   Time, satellites (orbits, drag, power, attitude, data, propulsion),
   methane leaks and repairs, national policy, atmospheric methane,
   temperature, money, trust, random events, saving and final results.
   ========================================================================= */

const SIM = (() => {
  const YEAR = 365.25 * 86400;      // s
  const DAY = 86400;
  const MT_PER_TPH = 8.766e-3;      // 1 t/h sustained for a year = 8,766 t = 0.008766 Mt
  const TG_PER_PPB = 2.78;          // Tg (Mt) CH4 per ppb of global mean mixing ratio
  const CH4_LIFETIME = 9.1;         // years
  const LISTENERS = {};
  let S = null;

  const on = (ev, fn) => { (LISTENERS[ev] = LISTENERS[ev] || []).push(fn); };
  const emit = (ev, data) => (LISTENERS[ev] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } });
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const uid = p => p + Math.random().toString(36).slice(2, 8);
  const years = () => (S.t - S.t0) / 1000 / YEAR;
  const fmtDate = ms => new Date(ms).toISOString().slice(0, 10);
  const money = n => (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');

  // difficulty settings, with the player's choice of how often random events happen
  function makeDiff(cfg) { const d = DIFFICULTY[cfg.difficulty] || DIFFICULTY.director; return { ...d, eventRate: d.eventRate * (cfg.eventScale ?? 1) }; }

  /* ===================== countries ===================== */
  // level = emissions before policy cuts (grows at the country's own rate, slowed by abatement investment)
  // bauLevel = the same country in the no-action world; evidence = how much verified data regulators have
  function newCountry(mt) { return { base: mt, level: mt, bauLevel: mt, mitigation: 0, detections: 0, evidence: 0, dataMB: 0, reports: 0 }; }
  function newMonth() { return { mb: 0, det: 0, attr: 0, countries: {}, sites: {} }; }
  const _cap = {};
  function profile(iso) {
    const p = COUNTRY_PROFILE[+iso] || { g: 0.012, resp: 0.5 };
    if (_cap[iso] == null) {
      const idx = (COUNTRY_SITES[String(iso)] || []).filter(i => SITE_TYPES[SITES[i].type].fixShare > 0);
      _cap[iso] = idx.length ? idx.reduce((a, i) => a + ABATABLE[SITES[i].type], 0) / idx.length : 0.4;
    }
    return { g: p.g + 0.004 * (S.diff.leakRate - 1), resp: p.resp, cap: _cap[iso] };
  }
  function upgradeCountries() { // saves from before regional policy
    const y = years();
    for (const c of Object.values(S.countries)) if (c.level == null) {
      const grown = c.base * Math.pow(1.006, y);
      Object.assign(c, { level: grown, bauLevel: grown, evidence: c.detections * 0.2, dataMB: 0, reports: 0 });
    }
    S.reports = S.reports || []; S.month = S.month || newMonth();
    if (!S.money) { // older save: rebuild what the ledger still remembers
      S.money = { spent: 0, earned: 0, by: {} };
      S.ledger.forEach(e => { if (e.amount < 0) S.money.spent -= e.amount; else S.money.earned += e.amount; const k = moneyCategory(e.label); S.money.by[k] = (S.money.by[k] || 0) + e.amount; });
    }
    S.mapFrames = S.mapFrames || { every: 1, n: 0, frames: [] };
  }

  /* ===================== new game / load ===================== */
  function newGame(cfg) {
    const t0 = Date.parse(cfg.startDate) || Date.UTC(2027, 0, 1);
    const countries = {};
    for (const [iso, mt] of Object.entries(COUNTRY_CH4)) countries[iso] = newCountry(mt);
    const sites = SITES.map(s => ({ id: s.id, leaks: [], observations: 0, lastObs: 0, monitored: 0 }));
    S = {
      v: 2, cfg, diff: makeDiff(cfg), t0, t: t0, tEnd: t0 + cfg.durationYears * YEAR * 1000,
      funds: cfg.startFunds, trust: 55, science: 0, budgetCutUntil: 0, launchDiscountUntil: 0,
      climate: { ch4: 1935, ch4_0: 1935, dTch4: 0, dT: 1.32, nonCH4_0: 1.32, anthro: 0, natural: 0 },
      countries, sites,
      satellites: [], debris: [], launches: [],
      designs: [], current: { name: 'MethaneSat-1', parts: {} },
      log: [], decisions: [], ledger: [], history: [], reports: [], month: newMonth(), money: { spent: 0, earned: 0, by: {} }, mapFrames: { every: 1, n: 0, frames: [] },
      stats: { leaksDetected: 0, leaksFixed: 0, mtAvoided: 0, launches: 0, launchFailures: 0, satsLost: 0, passes: 0, dataMB: 0, grants: 0, missedLeaks: 0, scienceObs: 0 },
      nextMonth: t0 + 30.44 * DAY * 1000, nextRound: t0 + cfg.roundLengthMonths * 30.44 * DAY * 1000, roundStart: t0,
      warp: DEFAULT_WARP, paused: true, ended: false, pending: null, flightActive: false,
    };
    // seed some active leaks so there is something to find on day one
    SITES.forEach((site, i) => { for (let k = 0; k < Math.round(site.leakRate * 0.35); k++) spawnLeak(i, true); });
    updateEmissions();
    pushHistory();
    captureFrame(true);
    logEvent('info', `${cfg.agencyName} founded. Mission: find methane leaks and slow warming by ${new Date(S.tEnd).getUTCFullYear()}.`);
    return S;
  }

  function load(json) {
    const data = JSON.parse(json);
    if (!data || data.v !== 2) throw new Error('Incompatible save');
    S = data;
    S.diff = makeDiff(S.cfg);
    S.satellites.forEach(rehydrate);
    upgradeCountries();
    S.paused = true; S.pending = null; S.flightActive = false;
    return S;
  }
  function save() {
    if (!S) return false;
    const copy = { ...S, satellites: S.satellites.map(s => ({ ...s, comp: undefined, _prev: undefined })) };
    copy.log = S.log.slice(-300);
    return safeSet(STORE.save, JSON.stringify(copy));
  }
  function rehydrate(sat) { sat.comp = DESIGN.compute(sat.parts); sat._prev = null; }

  /* ===================== logging & decisions ===================== */
  function logEvent(kind, msg, extra) {
    const e = { t: S.t, date: fmtDate(S.t), kind, msg, ...extra };
    S.log.push(e);
    if (S.log.length > 600) S.log.splice(0, S.log.length - 600);
    emit('log', e);
    return e;
  }
  // Decision record for the Feedback page: what the player chose, why it matters (before) and what happened (after)
  function decision(type, title, before, after, data) {
    const d = { id: uid('d'), t: S.t, date: fmtDate(S.t), year: new Date(S.t).getUTCFullYear(), type, title, before, after, data };
    S.decisions.push(d);
    try {
      const all = JSON.parse(safeGet(STORE.decisions) || '[]');
      all.push(d);
      safeSet(STORE.decisions, JSON.stringify(all.slice(-500)));
    } catch { /* ignore */ }
    emit('decision', d);
    return d;
  }
  // Money in/out. Small recurring items are grouped per month so the ledger stays readable.
  // categories for the mission report's money breakdown
  function moneyCategory(label, group) {
    const L = group || label || '';
    if (/^Build/.test(L)) return 'Building satellites';
    if (/^Launch/.test(L)) return 'Launches';
    if (/^Mission operations/.test(L)) return 'Mission operations';
    if (/^Recalibration/.test(L)) return 'Repairs & recalibration';
    if (/Scrubbed|recovered after abort|Booster recovery/.test(L)) return 'Refunds & recovery credits';
    return L;
  }
  function ledger(amount, label, group) {
    S.funds += amount;
    const M = S.money || (S.money = { spent: 0, earned: 0, by: {} });
    if (amount < 0) M.spent -= amount; else M.earned += amount;
    const cat = moneyCategory(label, group);
    M.by[cat] = (M.by[cat] || 0) + amount;
    const key = group || label;
    const month = new Date(S.t).toISOString().slice(0, 7);
    const last = S.ledger.length ? S.ledger[S.ledger.length - 1] : null;
    const same = S.ledger.slice(-40).reverse().find(e => e.key === key && e.month === month && group);
    if (same) { same.amount += amount; same.count = (same.count || 1) + 1; same.t = S.t; }
    else S.ledger.push({ t: S.t, month, key, amount, label: group || label });
    if (S.ledger.length > 1500) S.ledger.splice(0, S.ledger.length - 1500);
    return last;
  }
  function adjustTrust(d, why) {
    const before = S.trust;
    S.trust = Math.max(0, Math.min(100, S.trust + d));
    if (why && Math.abs(d) >= 1) logEvent(d > 0 ? 'good' : 'bad', `${why} (trust ${d > 0 ? '+' : ''}${d.toFixed(1)})`);
    return S.trust - before;
  }

  /* ===================== leaks ===================== */
  function spawnLeak(siteIndex, seed, big) {
    const site = SITES[siteIndex];
    if (!site.leakRate && !big) return null;
    // heavy-tailed super-emitter distribution: 0.15–100 t/h, median ≈ 3 t/h
    const rate = big ? rand(40, 150) : 0.15 * Math.pow(10, Math.pow(Math.random(), 1.25) * 2.8);
    const leak = {
      id: uid('L'), rate, origRate: rate, start: seed ? S.t - rand(0, 200) * DAY * 1000 : S.t, status: 'active',
      // intermittent leaks stop on their own after months
      selfStop: S.t + (big ? rand(0.8, 2.5) : -Math.log(Math.random()) * 0.75) * YEAR * 1000,
      detectedBy: null, reportT: 0, fixT: 0, attributed: false, big: !!big,
    };
    S.sites[siteIndex].leaks.push(leak);
    return leak;
  }
  function activeLeakRate(site) { return site.leaks.reduce((s, l) => s + (l.status === 'stopped' ? 0 : l.rate), 0); }

  /* ===================== emissions & climate ===================== */
  function updateEmissions() {
    const y = years();
    const growth = Math.pow(1 + 0.008 * S.diff.leakRate, y); // small emitters not tracked individually
    let anthro = 0;
    for (const c of Object.values(S.countries)) anthro += c.level * (1 - c.mitigation);
    const restOfWorld = 22 * growth;
    let leaks = 0;
    S.sites.forEach(s => { leaks += activeLeakRate(s); });
    const leakMt = leaks * MT_PER_TPH;
    const warmAbove = Math.max(0, S.climate.dT - 1.2);
    const natural = 205 * (1 + 0.03 * warmAbove) + 6 * warmAbove; // wetlands + permafrost feedback
    S.climate.anthro = anthro + restOfWorld + leakMt;
    S.climate.leakMt = leakMt;
    S.climate.natural = natural;
    S.climate.total = S.climate.anthro + natural;
    // business-as-usual shadow world: same growth, no policy, leaks never reported
    let bauAll = 0;
    for (const c of Object.values(S.countries)) bauAll += c.bauLevel;
    S.climate.bauTotal = bauAll + 22 * growth + bauLeakMt() * growth + natural;
  }
  // steady-state leak load if nobody ever reports a leak (spawn rate × mean lifetime × mean size)
  let _bauLeak = null;
  function bauLeakMt() {
    if (_bauLeak !== null) return _bauLeak;
    let mean = 0; const n = 4000;
    for (let k = 0; k < n; k++) mean += 0.15 * Math.pow(10, Math.pow((k + 0.5) / n, 1.25) * 2.8);
    mean /= n;
    _bauLeak = SITES.reduce((s, x) => s + x.leakRate, 0) * S.diff.leakRate * 0.75 * mean * MT_PER_TPH;
    return _bauLeak;
  }
  function stepClimate(dtYears) {
    const c = S.climate;
    const dC = c.total / TG_PER_PPB - c.ch4 / CH4_LIFETIME;
    c.ch4 += dC * dtYears;
    if (c.ch4bau == null) c.ch4bau = c.ch4_0;
    c.ch4bau += ((c.bauTotal || c.total) / TG_PER_PPB - c.ch4bau / CH4_LIFETIME) * dtYears;
    c.avoidedC = 0.8 * 1.65 * 0.036 * (Math.sqrt(c.ch4bau) - Math.sqrt(c.ch4));
    // methane forcing incl. indirect ozone + stratospheric water (×1.65), λ = 0.8 K/(W m⁻²), 4-year response
    const F = 1.65 * 0.036 * (Math.sqrt(c.ch4) - Math.sqrt(c.ch4_0));
    const target = 0.8 * F;
    c.dTch4 += (target - c.dTch4) * Math.min(1, dtYears / 4);
    c.dT = c.nonCH4_0 + S.diff.warmingRate * years() + c.dTch4;
  }

  /* ===================== satellites ===================== */
  function addSatellite(name, parts, el, launchInfo) {
    const comp = DESIGN.compute(parts);
    const sat = {
      id: uid('S'), name, parts: { ...parts }, el, launched: S.t, status: 'active', safeMode: false,
      mass: comp.mass, prop: comp.propMass, soc: comp.batteryWh || 0, batteryHealth: 1, cellFailed: false,
      targetAlt: el.a * (1 - el.e) - ORB.RE, stationKeep: true, instrumentOn: true, autoDownlink: true, forceDownlink: false,
      attitude: { mode: 'nadir', roll: 0, pitch: 0, yaw: 0, momentum: 0.1, targetSite: null },
      queue: [], usedMB: 0, dose: 0, faults: [], burns: [], maneuver: null, contact: {},
      stats: { obs: 0, detections: 0, downMB: 0, passes: 0, lostMB: 0, science: 0 },
      launch: launchInfo || null,
    };
    rehydrate(sat);
    if (comp.batteries.some(b => b.risky) && Math.random() < 0.15) {
      sat.cellFailed = true;
      sat.faults.push({ t: S.t, text: 'Solid-state cell failure: battery capacity −40%' });
    }
    S.satellites.push(sat);
    S.stats.launches++;
    logEvent('good', `${name} deployed into a ${Math.round(sat.targetAlt / 1000)} km × ${(el.i / ORB.DEG).toFixed(1)}° orbit.`);
    emit('satellites');
    return sat;
  }

  function capacityWh(sat) {
    const c = sat.comp;
    return (c.batteryWh || 0) * sat.batteryHealth * (sat.cellFailed ? 0.6 : 1);
  }
  function usableFloor(sat) {
    // keep state of charge above (1 - DoD) to protect cycle life
    const bats = sat.comp.batteries.filter(b => b.wh);
    if (!bats.length) return 0;
    const dod = bats.reduce((s, b) => s + b.dod * b.wh, 0) / bats.reduce((s, b) => s + b.wh, 0);
    return capacityWh(sat) * (1 - dod);
  }

  // Apply an impulsive Δv (m/s) in the local frame: prograde (T), normal (N), radial (R)
  function applyDv(sat, dvT, dvN = 0, dvR = 0, chemical = true) {
    const dv = Math.hypot(dvT, dvN, dvR);
    if (dv <= 0) return 0;
    const eng = sat.comp.engines;
    const isp = chemical ? (sat.comp.ispChem || sat.comp.ispElec) : (sat.comp.ispElec || sat.comp.ispChem);
    if (!isp || sat.prop <= 1e-6) return 0;
    const maxDv = isp * ORB.G0 * Math.log(sat.mass / (sat.mass - sat.prop));
    const use = Math.min(dv, maxDv);
    const f = use / dv;
    const st = ORB.stateAt(sat.el, S.t);
    const T = ORB.v.norm(st.v), Rr = ORB.v.norm(st.r), N = ORB.v.norm(ORB.v.cross(st.r, st.v));
    const nv = ORB.v.add(st.v, ORB.v.add(ORB.v.mul(T, dvT * f), ORB.v.add(ORB.v.mul(N, dvN * f), ORB.v.mul(Rr, dvR * f))));
    sat.el = ORB.rv2coe(st.r, nv, S.t);
    const mp = sat.mass * (1 - Math.exp(-use / (isp * ORB.G0)));
    sat.prop = Math.max(0, sat.prop - mp);
    sat.mass -= mp;
    return use;
  }

  function hasChem(sat) { return sat.comp.thrustChem > 0; }
  function hasElec(sat) { return sat.comp.thrustElec > 0; }
  function dvLeft(sat) {
    const isp = sat.comp.ispChem || sat.comp.ispElec || sat.comp.ispE;
    if (!isp || sat.prop <= 0) return 0;
    return isp * ORB.G0 * Math.log(sat.mass / (sat.mass - sat.prop));
  }

  /* Maneuver commands from the player (Orbit Viewer).
     type: 'altitude' (value km) | 'inclination' (value deg) | 'burn' (dir, value m/s) | 'deorbit' | 'avoid' */
  function command(sat, cmd) {
    if (sat.status !== 'active') return { ok: false, msg: 'Satellite is not active.' };
    const st = ORB.stateAt(sat.el, S.t);
    if (!sat.comp.engines.length) return { ok: false, msg: 'This satellite has no thrusters.' };
    if (sat.prop <= 0.0005) return { ok: false, msg: 'Out of propellant.' };
    const useChem = hasChem(sat) && cmd.mode !== 'electric';
    let msg = '';
    if (cmd.type === 'altitude') {
      const a2 = ORB.RE + cmd.value * 1000;
      const a1 = sat.el.a;
      if (useChem) {
        const h = ORB.hohmann(a1, a2);
        if (h.total > dvLeft(sat) + 0.1) return { ok: false, msg: `Needs ${h.total.toFixed(1)} m/s; only ${dvLeft(sat).toFixed(1)} m/s left.` };
        const s = Math.sign(a2 - a1);
        applyDv(sat, s * h.dv1, 0, 0, true);
        sat.burns.push({ t: S.t + h.time * 1000, dvT: s * h.dv2, chemical: true, label: 'Circularise' });
        msg = `Hohmann transfer: ${h.dv1.toFixed(1)} m/s now, ${h.dv2.toFixed(1)} m/s in ${(h.time / 60).toFixed(0)} min.`;
      } else {
        const dv = Math.abs(ORB.circSpeed(a1) - ORB.circSpeed(a2));
        if (dv > dvLeft(sat) + 0.1) return { ok: false, msg: `Needs ${dv.toFixed(1)} m/s; only ${dvLeft(sat).toFixed(1)} m/s left.` };
        sat.maneuver = { kind: 'spiral', targetA: a2, label: `Electric spiral to ${cmd.value} km` };
        const days = dv / (sat.comp.thrustElec / sat.mass) / DAY;
        msg = `Low-thrust spiral: ${dv.toFixed(1)} m/s over ~${days.toFixed(days < 10 ? 1 : 0)} days (when power allows).`;
      }
      sat.targetAlt = cmd.value * 1000;
    } else if (cmd.type === 'inclination') {
      const di = (cmd.value - sat.el.i / ORB.DEG) * ORB.DEG;
      const vc = ORB.circSpeed(sat.el.a);
      if (useChem) {
        const dv = 2 * vc * Math.sin(Math.abs(di) / 2);
        if (dv > dvLeft(sat) + 0.1) return { ok: false, msg: `Plane change needs ${dv.toFixed(0)} m/s; only ${dvLeft(sat).toFixed(1)} m/s left. Plane changes are very expensive.` };
        // executed at the node: rotate the orbit plane, keep everything else
        const isp = sat.comp.ispChem;
        const mp = sat.mass * (1 - Math.exp(-dv / (isp * ORB.G0)));
        sat.el = { ...ORB.propagate(sat.el, S.t), i: sat.el.i + di };
        sat.prop -= mp; sat.mass -= mp;
        msg = `Plane change of ${(di / ORB.DEG).toFixed(2)}° at the next node: ${dv.toFixed(1)} m/s.`;
      } else {
        const dv = Math.PI / 2 * vc * Math.abs(di);
        if (dv > dvLeft(sat) + 0.1) return { ok: false, msg: `Needs ${dv.toFixed(0)} m/s; only ${dvLeft(sat).toFixed(1)} m/s left.` };
        sat.maneuver = { kind: 'plane', targetI: sat.el.i + di, label: `Electric plane change to ${cmd.value}°` };
        msg = `Low-thrust plane change: ${dv.toFixed(0)} m/s (Edelbaum).`;
      }
    } else if (cmd.type === 'burn') {
      const d = { prograde: [1, 0, 0], retrograde: [-1, 0, 0], normal: [0, 1, 0], antinormal: [0, -1, 0], radial: [0, 0, 1], antiradial: [0, 0, -1] }[cmd.dir];
      if (useChem) { const used = applyDv(sat, d[0] * cmd.value, d[1] * cmd.value, d[2] * cmd.value, true); msg = `Burned ${used.toFixed(2)} m/s ${cmd.dir}.`; }
      else { sat.maneuver = { kind: 'burn', dir: d, remaining: cmd.value, label: `${cmd.value} m/s ${cmd.dir} (electric)` }; msg = `Electric burn of ${cmd.value} m/s ${cmd.dir} started.`; }
      sat.targetAlt = Math.round((ORB.propagate(sat.el, S.t).a - ORB.RE));
    } else if (cmd.type === 'deorbit') {
      sat.stationKeep = false;
      const rp = ORB.RE + 60e3;
      const ra = sat.el.a * (1 + sat.el.e);
      const vNow = Math.sqrt(ORB.MU * (2 / ra - 1 / sat.el.a));
      const vNew = Math.sqrt(ORB.MU * (2 / ra - 2 / (ra + rp)));
      const need = vNow - vNew;
      if (useChem && need <= dvLeft(sat)) { applyDv(sat, -need, 0, 0, true); msg = `Deorbit burn ${need.toFixed(1)} m/s: reentry within one orbit.`; }
      else { sat.maneuver = { kind: 'spiral', targetA: ORB.RE + 100e3, label: 'Deorbit spiral' }; msg = 'Not enough impulse for a direct deorbit: spiralling down.'; }
      sat.decommissioning = true;
    } else if (cmd.type === 'avoid') {
      const used = applyDv(sat, useChem ? 0.3 : 0.05, 0, 0, useChem);
      msg = `Avoidance burn ${used.toFixed(2)} m/s.`;
    }
    logEvent('info', `${sat.name}: ${msg}`);
    emit('satellites');
    return { ok: true, msg };
  }

  function nextBurns(sat) {
    const due = sat.burns.filter(b => b.t <= S.t);
    if (!due.length) return;
    due.forEach(b => applyDv(sat, b.dvT, 0, 0, b.chemical));
    sat.burns = sat.burns.filter(b => b.t > S.t);
  }

  /* ===================== per-step satellite physics ===================== */
  function stepSatellite(sat, dt, sun, solar) {
    if (sat.status !== 'active') return;
    const c = sat.comp;
    const t2 = S.t + dt * 1000;
    // drag
    const el = ORB.propagate(sat.el, S.t);
    const da = ORB.decayRate(el.a, c.cdAOverM * (c.mass / sat.mass), solar) * dt;
    sat.el = { ...el, a: el.a + da };
    const perigee = sat.el.a * (1 - sat.el.e) - ORB.RE;
    if (perigee < 120e3) { reenter(sat); return; }

    const prev = sat._prev || ORB.stateAt(sat.el, S.t);
    const cur = ORB.stateAt(sat.el, t2);
    sat._prev = cur;
    sat.alt = cur.alt; sat.lat = cur.lat; sat.lon = cur.lon;
    const mid = ORB.v.mul(ORB.v.add(prev.r, cur.r), 0.5);
    const eclipse = ORB.inEclipse(mid, sun);
    sat.eclipse = eclipse;

    // ---------- attitude ----------
    const att = sat.attitude;
    const mtqDump = sat.faults.some(f => f.part === 'mtq') ? 0 : 0.035;
    const gain = { nadir: 0.02, target: 0.05, sun: 0.01, station: 0.03, manual: 0.03 }[att.mode] || 0.02;
    att.momentum = Math.max(0, Math.min(1.05, att.momentum + (gain - mtqDump * (att.momentum > 0.1 ? 1 : 0.3)) * dt / DAY));
    const saturated = att.momentum >= 1;
    let pointQ = c.pointing * (saturated ? 0.3 : 1);

    // ---------- power ----------
    const sunFactor = att.mode === 'sun' ? 1.35 : att.mode === 'target' ? 0.85 : 1;
    const deployFail = sat.faults.some(f => f.part === 'array') ? 0.5 : 1;
    const gen = (eclipse ? 0 : c.array.watts / 0.63 * sunFactor * deployFail * 0.92) + c.rtgW * Math.pow(0.97, years());
    const dayside = !eclipse;
    const instrOn = sat.instrumentOn && !sat.safeMode;
    let load = c.busLoad + (eclipse ? 1.5 : 0);
    if (instrOn) load += c.detectors.reduce((s, d) => s + ((d.dayOnly && !dayside) ? 0.3 : d.power * 0.35), 0);
    load += c.comms.reduce((s, x) => s + (x.idle || 0.5), 0);

    // ---------- propulsion ----------
    let firing = false;
    if (sat.maneuver && sat.prop > 0) {
      const canFire = hasElec(sat) ? (sat.soc > usableFloor(sat) + capacityWh(sat) * 0.1 || c.rtgW > 50) : true;
      if (canFire) {
        firing = true;
        const acc = (hasElec(sat) ? c.thrustElec : c.thrustChem) / sat.mass;
        let dv = acc * dt;
        const m = sat.maneuver;
        if (m.kind === 'spiral') {
          const s = Math.sign(m.targetA - sat.el.a);
          const used = applyDv(sat, s * dv, 0, 0, !hasElec(sat));
          if (!used || (s > 0 ? sat.el.a >= m.targetA : sat.el.a <= m.targetA)) { sat.maneuver = null; logEvent('info', `${sat.name}: ${m.label} complete.`); }
        } else if (m.kind === 'plane') {
          const u = sat.el.argp + ORB.coe2rv(sat.el).nu;
          const s = Math.sign(m.targetI - sat.el.i) * Math.sign(Math.cos(u));
          const used = applyDv(sat, 0, s * dv, 0, !hasElec(sat));
          if (!used || Math.abs(sat.el.i - m.targetI) < 0.0005) { sat.maneuver = null; logEvent('info', `${sat.name}: ${m.label} complete.`); }
        } else if (m.kind === 'burn') {
          dv = Math.min(dv, m.remaining);
          const used = applyDv(sat, m.dir[0] * dv, m.dir[1] * dv, m.dir[2] * dv, !hasElec(sat));
          m.remaining -= used;
          if (!used || m.remaining <= 1e-4) { sat.maneuver = null; logEvent('info', `${sat.name}: ${m.label} complete.`); }
        }
      }
    } else if (sat.stationKeep && sat.prop > 0 && sat.targetAlt && !sat.decommissioning) {
      const altNow = sat.el.a - ORB.RE;
      if (altNow < sat.targetAlt - 2000) {
        const need = ORB.circSpeed(sat.el.a) - ORB.circSpeed(ORB.RE + sat.targetAlt);
        if (hasChem(sat)) applyDv(sat, Math.abs(need), 0, 0, true);
        else if (sat.soc > usableFloor(sat) + capacityWh(sat) * 0.1 || c.rtgW > 50) { firing = true; applyDv(sat, Math.min(Math.abs(need), c.thrustElec / sat.mass * dt), 0, 0, false); }
        if (sat.prop <= 0.0005 && !sat.outOfFuelLogged) { sat.outOfFuelLogged = true; logEvent('bad', `${sat.name} is out of propellant. Drag will now lower its orbit.`); }
      }
    }
    if (firing) load += c.engines.reduce((s, e) => Math.max(s, e.firingW), 0);

    // ---------- observations ----------
    const site_reach = [];
    if (instrOn && att.mode !== 'sun' && c.detectors.length) {
      for (let i = 0; i < SITES.length; i++) {
        const site = SITES[i];
        if (Math.abs(site.lat - cur.lat) > 25 && Math.abs(site.lat - prev.lat) > 25) continue;
        const q = siteUnit(i);
        const ad = ORB.arcDistance(prev.unit, cur.unit, q);
        const crossKm = ad.cross * ORB.RE / 1000;
        for (const d of c.detectors) {
          let reachOK = false, q2 = 1;
          if (att.mode === 'manual') {
            const offset = (cur.alt / 1000) * Math.tan(att.roll * ORB.DEG);
            reachOK = Math.abs(crossKm - offset) < d.swathKm / 2 && Math.abs(att.pitch) < 10;
          } else if (Math.abs(crossKm) < d.swathKm / 2) reachOK = true;
          else if (att.mode === 'target' && d.pointKm && Math.abs(crossKm) < d.swathKm / 2 + d.pointKm && (!att.targetSite || att.targetSite === site.id)) { reachOK = true; q2 = pointQ; }
          else if (att.mode === 'nadir' && d.pointKm && Math.abs(crossKm) < d.swathKm / 2 + d.pointKm * 0.5 && pointQ > 0.8) { reachOK = true; q2 = pointQ * 0.85; }
          if (!reachOK) continue;
          site_reach.push(i);
          observe(sat, i, d, q2, ad, prev, cur, dt);
        }
      }
    }
    if (instrOn && site_reach.length) load += 0; // already counted in duty-cycle average

    // ---------- ground contacts ----------
    let txTime = 0;
    const nowContacts = {};
    for (const gs of GROUND_STATIONS) {
      const q = gsUnit(gs);
      const lam = ORB.visibilityAngle(cur.alt);
      const ad = ORB.arcDistance(prev.unit, cur.unit, q);
      if (ad.d >= lam) continue;
      const L = Math.acos(Math.max(-1, Math.min(1, ORB.v.dot(prev.unit, cur.unit)))) || 1e-9;
      const hc = Math.sqrt(lam * lam - ad.d * ad.d);
      const c0 = ad.f * L;
      const overlap = Math.max(0, Math.min(L, c0 + hc) - Math.max(0, c0 - hc));
      const secs = overlap / L * dt;
      if (secs <= 0) continue;
      nowContacts[gs.id] = true;
      if (!sat.contact[gs.id]) { sat.stats.passes++; S.stats.passes++; }
      if (!(sat.autoDownlink || sat.forceDownlink) || !sat.queue.length) continue;
      // choose the best link usable with this station
      const links = c.comms.filter(x => (x.optical ? gs.optical : !gs.optical));
      if (!links.length) continue;
      let rate = 0;
      for (const x of links) {
        let r = x.rate * 0.8;
        if (x.directional) r *= pointQ > 0.5 ? 1 : 0.05;
        if (x.optical && Math.random() < 0.55) r = 0; // clouds over the telescope
        rate = Math.max(rate, r);
      }
      if (sat.safeMode) rate = Math.min(rate, 9.6e3);
      if (rate <= 0) continue;
      // only pay for the minutes actually needed to empty the queue
      const used = Math.min(secs, sat.usedMB * 8e6 / rate + 1);
      txTime += used;
      ledger(-GS_PER_MIN * used / 60, '', 'Ground-station time');
      downlink(sat, rate * used / 8 / 1e6, gs);
    }
    sat.contact = nowContacts;
    sat.inContact = Object.keys(nowContacts).length > 0;
    if (!sat.inContact && sat.forceDownlink && !sat.queue.length) sat.forceDownlink = false;
    if (txTime > 0) load += c.comms.reduce((s, x) => Math.max(s, x.power), 0) * Math.min(1, txTime / dt);

    // ---------- battery ----------
    const cap = capacityWh(sat);
    if (cap > 0) {
      sat.soc = Math.max(0, Math.min(cap, sat.soc + (gen - load) * dt / 3600));
      const floor = usableFloor(sat);
      if (!sat.safeMode && sat.soc < floor * 0.85) {
        sat.safeMode = true; sat.brownouts = (sat.brownouts || 0) + 1;
        if (sat.brownouts <= 3 || sat.brownouts % 25 === 0) logEvent('bad', `${sat.name} browned out ${eclipse ? 'in eclipse' : ''}: instruments off, safe mode.`);
      } else if (sat.safeMode && sat.soc > cap * 0.6 && !sat.manualSafe) sat.safeMode = false;
      // wear: calendar + cycling
      const lifeY = Math.max(...c.batteries.map(b => b.lifeYears || 5));
      sat.batteryHealth = Math.max(0.05, sat.batteryHealth - dt / (lifeY * YEAR) * 0.5);
      if (sat.batteryHealth < 0.3 && !c.rtgW) die(sat, 'battery worn out');
    } else if (c.rtgW) sat.soc = 0; else if (gen < load) { sat.safeMode = true; }

    // ---------- radiation ----------
    sat.dose += ORB.doseRate(cur.alt / 1000, sat.el.i / ORB.DEG) * dt / YEAR;
    const tol = c.items.filter(i => i.part.rad).map(i => i.part.rad);
    const weakest = tol.length ? Math.min(...tol) : 20;
    if (sat.dose > weakest && Math.random() < 0.25 * dt / YEAR) {
      sat.faults.push({ t: S.t, part: 'storage', text: 'Radiation damage corrupted the data recorder (capacity halved).' });
      sat.storagePenalty = (sat.storagePenalty || 1) * 0.5;
      logEvent('bad', `${sat.name}: radiation damage to the data recorder.`);
    }
    nextBurns(sat);
  }

  const _siteUnits = [];
  function siteUnit(i) { return _siteUnits[i] || (_siteUnits[i] = ORB.latLonToUnit(SITES[i].lat, SITES[i].lon)); }
  const _gsUnits = {};
  function gsUnit(gs) { return _gsUnits[gs.id] || (_gsUnits[gs.id] = ORB.latLonToUnit(gs.lat, gs.lon)); }

  function storageCap(sat) { return sat.comp.storageMB * (sat.storagePenalty || 1); }

  const COUNTRY_SITES = {};
  SITES.forEach((s, i) => { (COUNTRY_SITES[String(s.iso)] = COUNTRY_SITES[String(s.iso)] || []).push(i); });

  function poisson(mean) {
    if (mean <= 0) return 0;
    if (mean > 30) return Math.max(0, Math.round(mean + Math.sqrt(mean) * (Math.random() + Math.random() + Math.random() - 1.5) * 2));
    let L = Math.exp(-mean), k = 0, p = 1;
    do { k++; p *= Math.random(); } while (p > L);
    return k - 1;
  }

  // Fraction of time a satellite of inclination i spends near latitude φ, relative to a uniform spread
  function latDensity(phi, inc, halfWidth) {
    const maxLat = inc > Math.PI / 2 ? Math.PI - inc : inc;
    if (Math.abs(phi) > maxLat + halfWidth) return 0;
    const s = Math.sin(maxLat) ** 2 - Math.sin(Math.min(Math.abs(phi), maxLat - halfWidth * 0.5)) ** 2;
    return Math.min(6, 2 / (Math.PI * Math.sqrt(Math.max(1e-4, s))));
  }

  /* Orbit-averaged step for fast time-warp */
  function stepSatelliteCoarse(sat, dt, sun, solar) {
    if (sat.status !== 'active') return;
    const c = sat.comp;
    const el = ORB.propagate(sat.el, S.t);
    sat.el = { ...el, a: el.a + ORB.decayRate(el.a, c.cdAOverM * (c.mass / sat.mass), solar) * dt };
    if (sat.el.a * (1 - sat.el.e) - ORB.RE < 120e3) { reenter(sat); return; }
    const cur = ORB.stateAt(sat.el, S.t + dt * 1000);
    sat._prev = null;
    sat.alt = cur.alt; sat.lat = cur.lat; sat.lon = cur.lon;
    const P = ORB.period(sat.el.a);
    const f = ORB.eclipseFraction(sat.el.a, ORB.betaAngle(sat.el, sun));
    sat.eclipse = false;

    const att = sat.attitude;
    const mtqDump = sat.faults.some(x => x.part === 'mtq') ? 0 : 0.035;
    const gain = { nadir: 0.02, target: 0.05, sun: 0.01, station: 0.03, manual: 0.03 }[att.mode] || 0.02;
    att.momentum = Math.max(0, Math.min(1.05, att.momentum + (gain - mtqDump * (att.momentum > 0.1 ? 1 : 0.3)) * dt / DAY));
    const pointQ = c.pointing * (att.momentum >= 1 ? 0.3 : 1);

    // orbit-average power and eclipse survival
    const sunFactor = att.mode === 'sun' ? 1.35 : att.mode === 'target' ? 0.85 : 1;
    const deployFail = sat.faults.some(x => x.part === 'array') ? 0.5 : 1;
    const gen = c.array.watts / 0.63 * sunFactor * deployFail * 0.92 * (1 - f) + c.rtgW * Math.pow(0.97, years());
    const instrOn = sat.instrumentOn && !sat.safeMode;
    let load = c.busLoad + 1.5 * f + c.comms.reduce((s, x) => s + (x.idle || 0.5), 0);
    if (instrOn) load += c.detectors.reduce((s, d) => s + d.power * 0.35 * (d.dayOnly ? (1 - f) : 1), 0);
    let firing = false;
    const cap = capacityWh(sat);
    let avail = 1;
    if (cap > 0) {
      const floor = usableFloor(sat);
      const eclipseWh = load * f * P / 3600;
      const spare = Math.max(0, cap - floor * 0.85);
      avail = eclipseWh > 0 ? Math.min(1, spare / eclipseWh) : 1;
      if (avail < 0.98) {
        sat.brownouts = (sat.brownouts || 0) + Math.round(dt / P * (1 - avail));
        if (!sat.lowPowerLogged) { sat.lowPowerLogged = true; logEvent('bad', `${sat.name} cannot carry its full load through eclipses: instruments run ${(avail * 100).toFixed(0)}% of the time.`); }
      }
      const net = gen - load;
      sat.soc = Math.max(0, Math.min(cap, sat.soc + net * dt / 3600));
      if (net < 0 && sat.soc < floor * 0.85) { sat.safeMode = true; avail = 0; }
      else if (sat.safeMode && sat.soc > cap * 0.6 && !sat.manualSafe) sat.safeMode = false;
      const lifeY = Math.max(...c.batteries.map(b => b.lifeYears || 5));
      sat.batteryHealth = Math.max(0.05, sat.batteryHealth - dt / (lifeY * YEAR) * 0.5);
      if (sat.batteryHealth < 0.3 && !c.rtgW) { die(sat, 'battery worn out'); return; }
    } else if (!c.rtgW && gen < load) { sat.safeMode = true; avail = 0; }

    // propulsion (electric thrusters only fire in sunlight unless an RTG supplies power)
    if (sat.maneuver && sat.prop > 0) {
      const duty = hasElec(sat) && !c.rtgW ? (1 - f) * 0.8 : 1;
      const acc = (hasElec(sat) ? c.thrustElec : c.thrustChem) / sat.mass;
      let dv = acc * dt * duty;
      const m = sat.maneuver;
      firing = true;
      if (m.kind === 'spiral') {
        const s = Math.sign(m.targetA - sat.el.a);
        const used = applyDv(sat, s * dv, 0, 0, !hasElec(sat));
        if (!used || (s > 0 ? sat.el.a >= m.targetA : sat.el.a <= m.targetA)) { sat.maneuver = null; logEvent('info', `${sat.name}: ${m.label} complete.`); }
      } else if (m.kind === 'plane') {
        const isp = c.ispElec || c.ispChem;
        const di = Math.min(Math.abs(m.targetI - sat.el.i), dv * 2 / Math.PI / ORB.circSpeed(sat.el.a));
        const used = di * Math.PI / 2 * ORB.circSpeed(sat.el.a);
        const mp = sat.mass * (1 - Math.exp(-used / (isp * ORB.G0)));
        if (mp > sat.prop) { sat.maneuver = null; } else {
          sat.prop -= mp; sat.mass -= mp; sat.el.i += Math.sign(m.targetI - sat.el.i) * di;
          if (Math.abs(sat.el.i - m.targetI) < 0.0005) { sat.maneuver = null; logEvent('info', `${sat.name}: ${m.label} complete.`); }
        }
      } else if (m.kind === 'burn') {
        dv = Math.min(dv, m.remaining);
        const used = applyDv(sat, m.dir[0] * dv, m.dir[1] * dv, m.dir[2] * dv, !hasElec(sat));
        m.remaining -= used;
        if (!used || m.remaining <= 1e-4) { sat.maneuver = null; logEvent('info', `${sat.name}: ${m.label} complete.`); }
      }
    } else if (sat.stationKeep && sat.prop > 0 && sat.targetAlt && !sat.decommissioning && sat.el.a - ORB.RE < sat.targetAlt - 2000) {
      const need = ORB.circSpeed(sat.el.a) - ORB.circSpeed(ORB.RE + sat.targetAlt);
      if (hasChem(sat)) applyDv(sat, Math.abs(need), 0, 0, true);
      else { firing = true; applyDv(sat, Math.min(Math.abs(need), c.thrustElec / sat.mass * dt * (1 - f)), 0, 0, false); }
      if (sat.prop <= 0.0005 && !sat.outOfFuelLogged) { sat.outOfFuelLogged = true; logEvent('bad', `${sat.name} is out of propellant. Drag will now lower its orbit.`); }
    }

    // statistically sampled observations
    const crossings = 2 * dt / P;
    if (instrOn && att.mode !== 'sun' && avail > 0) {
      for (let i = 0; i < SITES.length; i++) {
        const site = SITES[i];
        const latR = site.lat * ORB.DEG;
        const circ = 2 * Math.PI * (ORB.RE / 1000) * Math.max(0.05, Math.cos(latR));
        for (const d of c.detectors) {
          let width = d.swathKm, q2 = 1;
          if (d.pointKm && (att.mode === 'target' || (att.mode === 'nadir' && pointQ > 0.8))) { width += 2 * d.pointKm * (att.mode === 'target' ? 1 : 0.5); q2 = pointQ * (att.mode === 'target' ? 1 : 0.85); }
          if (att.mode === 'target' && att.targetSite && att.targetSite !== site.id) { width = d.swathKm; q2 = 1; }
          const dens = latDensity(latR, sat.el.i, width / 2 / (ORB.RE / 1000));
          if (!dens) continue;
          // each orbit crosses every reachable latitude twice; near the turning latitude the track runs along it
          let mean = 0.6 * crossings * Math.min(1, width / circ) * avail * Math.min(4, dens / latDensity(0, sat.el.i, 0));
          if (d.dayOnly) mean *= sat.el.i > 95 * ORB.DEG && sat.el.i < 100 * ORB.DEG ? 0.5 : 0.45;
          const n = Math.min(8, poisson(mean));
          for (let k = 0; k < n; k++) observe(sat, i, d, q2, { f: Math.random() }, null, cur, dt, true);
        }
      }
    }

    // statistically sampled ground contacts
    const lam = ORB.visibilityAngle(cur.alt);
    const capFrac = (1 - Math.cos(lam)) / 2;
    let contactS = 0, passes = 0, txTime = 0;
    for (const gs of GROUND_STATIONS) {
      const frac = capFrac * latDensity(gs.lat * ORB.DEG, sat.el.i, lam);
      if (!frac) continue;
      const secs = dt * frac;
      const passDur = lam / Math.PI * P;
      passes += secs / passDur;
      contactS += secs;
      if (!(sat.autoDownlink || sat.forceDownlink) || !sat.queue.length) continue;
      const links = c.comms.filter(x => (x.optical ? gs.optical : !gs.optical));
      if (!links.length) continue;
      let rate = 0;
      for (const x of links) {
        let r = x.rate * 0.8;
        if (x.directional) r *= pointQ > 0.5 ? 1 : 0.05;
        if (x.optical) r *= 0.45; // clouds over the telescopes
        rate = Math.max(rate, r);
      }
      if (sat.safeMode) rate = Math.min(rate, 9.6e3);
      if (rate <= 0) continue;
      const used = Math.min(secs, sat.usedMB * 8e6 / rate + 1);
      txTime += used;
      ledger(-GS_PER_MIN * used / 60, '', 'Ground-station time');
      downlink(sat, rate * used / 8 / 1e6, gs);
    }
    const np = Math.round(passes);
    sat.stats.passes += np; S.stats.passes += np;
    sat.inContact = false;
    if (sat.forceDownlink && !sat.queue.length) sat.forceDownlink = false;

    sat.dose += ORB.doseRate(cur.alt / 1000, sat.el.i / ORB.DEG) * dt / YEAR;
    const tol = c.items.filter(i => i.part.rad).map(i => i.part.rad);
    if (sat.dose > (tol.length ? Math.min(...tol) : 20) && Math.random() < 0.25 * dt / YEAR) {
      sat.faults.push({ t: S.t, part: 'storage', text: 'Radiation damage corrupted the data recorder (capacity halved).' });
      sat.storagePenalty = (sat.storagePenalty || 1) * 0.5;
      logEvent('bad', `${sat.name}: radiation damage to the data recorder.`);
    }
    nextBurns(sat);
  }

  function observe(sat, i, det, pointQ, ad, prev, cur, dt, coarse) {
    const site = SITES[i], ss = S.sites[i];
    const tObs = S.t + ad.f * dt * 1000;
    if (!coarse) {
      if (ss.lastObsBy === sat.id + det.id && tObs - ss.lastObs < 20 * 60000) return; // one look per pass
      ss.lastObs = tObs; ss.lastObsBy = sat.id + det.id;
      const sunEl = ORB.sunElevation(site.lat, site.lon, tObs);
      if (det.dayOnly && sunEl < 12) return;
    }
    const clear = Math.random() > site.cloud * det.cloud;
    ss.observations++; sat.stats.obs++; S.stats.scienceObs++;
    ss.monitored = S.t;
    // every look produces data, even with nothing found
    const room = storageCap(sat) - sat.usedMB;
    if (room < det.dataMB) { sat.stats.lostMB += det.dataMB; return; }
    let eff = det.eff / 100;
    if (det.tundraPenalty && (site.tundra || site.offshore || Math.abs(site.lat) > 60)) eff *= det.tundraPenalty;
    if (sat.calibDrift) eff *= 0.85;
    const found = [];
    if (clear && det.methane && (!det.types || det.types.includes(site.type))) {
      for (const leak of ss.leaks) {
        if (leak.status !== 'active') continue;
        if (leak.rate * 1000 < det.threshold) continue;
        if (Math.random() < eff * pointQ) { leak.status = 'detected'; leak.detectedBy = sat.id; leak.attributed = det.id === 'zoom' || det.id === 'lidar'; found.push(leak.id); }
      }
    }
    const natural = SITE_TYPES[site.type].fixShare === 0;
    sat.queue.push({ mb: det.dataMB, mb0: det.dataMB, site: i, leaks: found, det: det.id, natural: natural && clear && det.methane, t: tObs, prio: found.length ? 2 : natural ? 1 : 0 });
    sat.queue.sort((a, b) => b.prio - a.prio);
    sat.usedMB += det.dataMB;
  }

  function downlink(sat, mb, gs) {
    let budget = mb;
    while (budget > 0 && sat.queue.length) {
      const pkt = sat.queue[0];
      const take = Math.min(budget, pkt.mb);
      pkt.mb -= take; budget -= take;
      sat.usedMB = Math.max(0, sat.usedMB - take);
      sat.stats.downMB += take; S.stats.dataMB += take;
      if (pkt.mb <= 1e-6) { sat.queue.shift(); deliver(sat, pkt, gs); }
    }
    if (!sat.queue.length) { sat.usedMB = 0; sat.forceDownlink = false; }
  }

  // A packet arrives on the ground: science points, reports, grants, policy pressure
  function deliver(sat, pkt, gs) {
    const site = SITES[pkt.site], ss = S.sites[pkt.site];
    S.science += 1;
    // every delivered look counts toward this month's data report and the country's evidence
    const m = S.month || (S.month = newMonth());
    m.mb += pkt.mb0 || 0; m.sites[pkt.site] = 1;
    const cc = S.countries[site.iso];
    if (cc) { m.countries[site.iso] = 1; cc.dataMB += pkt.mb0 || 0; cc.evidence += 0.002; }
    sat.stats.science += 1;
    if (pkt.natural) { S.science += 4; sat.stats.science += 4; }
    for (const id of pkt.leaks) {
      const leak = ss.leaks.find(l => l.id === id);
      if (!leak || leak.status !== 'detected') continue;
      leak.status = 'reported'; leak.reportT = S.t;
      const type = SITE_TYPES[site.type];
      const [m1, m2] = type.fixMonths || [0, 0];
      leak.fixT = S.t + rand(m1, m2) * 30.44 * DAY * 1000 * (1.4 - S.trust / 100);
      sat.stats.detections++; S.stats.leaksDetected++;
      const mult = (leak.attributed ? 1.6 : 1) * (sat.comp.hasNIR ? 1.1 : 1);
      const grant = Math.round(Math.min(25000, 1500 + 300 * leak.rate) * mult);
      ledger(grant, `Leak report: ${site.name}`, 'Leak report payments');
      S.stats.grants += grant;
      S.science += Math.round(5 + leak.rate * 2);
      adjustTrust(0.02 + Math.min(0.3, leak.rate / 150));
      const c = S.countries[site.iso];
      if (c) { c.detections++; c.evidence += leak.attributed ? 0.4 : 0.25; }
      m.det++; if (leak.attributed) m.attr++;
      logEvent('good', `📡 ${sat.name} reported a ${leak.rate.toFixed(1)} t/h ${type.label.toLowerCase()} leak at ${site.name} via ${gs.name}. Grant ${money(grant)}.`, { site: site.id });
      emit('detection', { site, leak, sat });
    }
  }

  function reenter(sat) {
    sat.status = 'reentered';
    sat.endT = S.t;
    if (sat.decommissioning) { logEvent('info', `${sat.name} re-entered and burned up as planned. Responsible end of life.`); adjustTrust(0.5); }
    else { S.stats.satsLost++; sat.deathCause = 'orbit decayed and it re-entered the atmosphere'; logEvent('bad', `${sat.name} re-entered the atmosphere and burned up.`); adjustTrust(-2, 'Satellite lost to drag'); }
    emit('satellites');
    if (!S.ended && !S.satellites.some(s => s.status === 'active') && !S.launches.some(l => l.status === 'scheduled' || l.status === 'ready')) end('lost');
  }
  function die(sat, why) {
    if (sat.status !== 'active') return;
    sat.status = 'dead'; sat.endT = S.t; S.stats.satsLost++; sat.deathCause = why;
    logEvent('bad', `${sat.name} has failed: ${why}. It is now space debris.`);
    adjustTrust(-1.5);
    S.debris.push({ name: sat.name + ' (dead)', el: sat.el });
    emit('satellites');
    // mission failed: no satellite left working and none on the way, so stop now and show the report
    if (!S.ended && !S.satellites.some(s => s.status === 'active') && !S.launches.some(l => l.status === 'scheduled' || l.status === 'ready')) end('lost');
  }

  /* ===================== leaks over time ===================== */
  function stepLeaks(dt) {
    const dtY = dt / YEAR;
    S.sites.forEach((ss, i) => {
      const site = SITES[i];
      const c = S.countries[site.iso];
      const mit = c ? c.mitigation : 0;
      // new super-emitter events (fewer where regulation has bitten)
      const lambda = site.leakRate * S.diff.leakRate * (1 - 1.2 * mit) * dtY;
      if (Math.random() < lambda) spawnLeak(i);
      for (const l of ss.leaks) {
        if ((l.status === 'active') && S.t > l.selfStop) l.status = 'stopped';
        if (l.status === 'active' && l.big && !l.missed && S.t - l.start > 120 * DAY * 1000) {
          l.missed = true; S.stats.missedLeaks++;
          adjustTrust(-2.5, `A ${l.rate.toFixed(0)} t/h super-emitter at ${site.name} went unreported for 4 months`);
        }
        if (l.status === 'reported' && S.t >= l.fixT) {
          const share = SITE_TYPES[site.type].fixShare;
          l.status = 'fixed'; l.fixedAt = S.t; S.stats.leaksFixed++;
          l.rate *= (1 - share); if (l.rate < 0.05) l.rate = 0;
          adjustTrust(0.08);
          logEvent('good', `🔧 Operators repaired the leak at ${site.name} (${(share * 100).toFixed(0)}% of the flow stopped).`, { site: site.id });
        }
        // avoided emissions accumulate while a repaired leak would otherwise have kept flowing
        if (l.status === 'fixed' && S.t - l.fixedAt < 0.75 * YEAR * 1000) S.stats.mtAvoided += ((l.origRate || l.rate) - l.rate) * MT_PER_TPH * dtY;
      }
      if (ss.leaks.length > 40) ss.leaks = ss.leaks.filter(l => !(l.status === 'stopped' || (l.status === 'fixed' && S.t - l.fixedAt > YEAR * 1000)));
    });
    // regional response: evidence → regulation (up to what the country's sources allow) and slower growth.
    // Fast responders act within a couple of years; opaque producers barely move. Evidence fades if monitoring stops.
    for (const [iso, c] of Object.entries(S.countries)) {
      const pr = profile(iso);
      c.bauLevel *= Math.exp(pr.g * dtY);
      const ev = c.evidence * pr.resp;
      const sat = ev / (ev + 30);                      // diminishing returns: the first verified leaks matter most
      const slow = 0.012 * sat;                       // abatement investment slows emission growth
      c.level *= Math.exp((pr.g - slow) * dtY);
      const target = pr.cap * sat * (0.4 + 0.6 * S.trust / 100);
      const tau = (target > c.mitigation ? 4 : 6) / Math.max(0.25, pr.resp); // rules take years to write and enforce
      c.mitigation += (target - c.mitigation) * Math.min(1, dtY / tau);
      c.evidence *= Math.exp(-dtY / 2.9);
      S.stats.mtAvoided += Math.max(0, c.bauLevel - c.level * (1 - c.mitigation)) * dtY;
    }
  }

  /* ===================== monthly economy & events ===================== */
  function monthly() {
    const cut = S.t < S.budgetCutUntil ? 0.85 : 1;
    const income = S.cfg.annualBudget / 12 * S.diff.fundMult * (0.6 + S.trust / 125) * cut;
    ledger(income, 'Monthly appropriation');
    const active = S.satellites.filter(s => s.status === 'active');
    if (active.length) ledger(-2500 * active.length, `Mission operations (${active.length} satellites)`);
    S.trust += (52 - S.trust) * 0.004; // public attention fades toward neutral
    monthlyReport();
    pushHistory();
    captureFrame();
    randomEvents();
    save();
    emit('month');
    // loss conditions
    // budget and public support are fixed by the mission settings and are not shown while flying,
    // so they no longer end the mission (no bankruptcy, no dismissal): only technical outcomes matter
    if (S.trust < 1) S.trust = 1;
    if (S.climate.dT >= 2.5) return end('tipping');
  }

  // Monthly data report: graded on data volume, leaks found, sites covered and facility-level attribution.
  // Good reports bring a grant and public trust, and push regulators in every country they cover.
  function monthlyReport() {
    const m = S.month || newMonth();
    S.month = newMonth();
    if (!m.mb && !S.satellites.some(s => s.status === 'active')) return;
    const nS = Object.keys(m.sites).length, isos = Object.keys(m.countries);
    const q = 0.25 * Math.min(1, m.mb / 256000) + 0.35 * Math.min(1, m.det / 15) + 0.25 * Math.min(1, nS / 38) + 0.15 * (m.det ? m.attr / m.det : 0);
    const grade = q >= 0.8 ? 'A' : q >= 0.6 ? 'B' : q >= 0.4 ? 'C' : q >= 0.2 ? 'D' : 'F';
    const grant = Math.round(40 * q * q * S.diff.fundMult) * 1000;
    if (grant > 0) { ledger(grant, `Monthly data report, grade ${grade}`, 'Data report grants'); S.stats.grants += grant; }
    adjustTrust(0.3 * q - 0.04);
    for (const iso of isos) { const c = S.countries[iso]; if (c) { c.evidence += 0.15 * q; c.reports++; } }
    const rep = { t: S.t, month: fmtDate(S.t).slice(0, 7), mb: Math.round(m.mb), detections: m.det, attributed: m.attr, sites: nS, countries: isos, grade, quality: +q.toFixed(2), grant };
    S.reports.push(rep); if (S.reports.length > 240) S.reports.shift();
    const size = m.mb >= 1024 ? (m.mb / 1024).toFixed(1) + ' GB' : Math.round(m.mb) + ' MB';
    logEvent(q >= 0.6 ? 'good' : q < 0.2 ? 'bad' : 'info', `📑 Data report ${rep.month}: grade ${grade} · ${size}, ${m.det} leaks, ${nS} sites in ${isos.length} countries${grant ? ` · ${money(grant)} grant` : ''}.`);
    emit('report', rep);
  }

  // Map snapshot for the mission report's before / after maps and timelapse.
  // Countries: emissions (Mt/yr). Sites: total regional emissions and leak flow (t/h), plus a ring code:
  // r = big unreported leak, b = reported and awaiting repair, g = repaired, w = nothing special.
  const COUNTRY_KEYS = Object.keys(COUNTRY_CH4);
  function ringCode(i) {
    const ls = S.sites[i].leaks;
    if (ls.some(l => l.status === 'active' && l.rate > 20)) return 'r';
    if (ls.some(l => l.status === 'reported')) return 'b';
    if (ls.some(l => l.status === 'fixed') && !ls.some(l => l.status === 'active')) return 'g';
    return 'w';
  }
  function captureFrame(force) {
    const F = S.mapFrames || (S.mapFrames = { every: 1, n: 0, frames: [] });
    if (!force && (F.n++ % F.every)) return;
    F.frames.push({
      t: S.t, ch4: +S.climate.ch4.toFixed(1), dT: +S.climate.dT.toFixed(3),
      c: COUNTRY_KEYS.map(iso => +countryEmission(iso).now.toFixed(2)),
      s: SITES.map((_, i) => Math.round(siteEmission(i).total)),
      l: SITES.map((_, i) => +activeLeakRate(S.sites[i]).toFixed(1)),
      r: SITES.map((_, i) => ringCode(i)).join(''),
    });
    // keep long games small: when there are too many frames, drop every other one and sample half as often
    if (F.frames.length > 360) { const last = F.frames[F.frames.length - 1]; F.frames = F.frames.filter((_, i) => i % 2 === 0); if (F.frames[F.frames.length - 1] !== last) F.frames.push(last); F.every *= 2; }
  }

  function pushHistory() {
    S.history.push({ t: S.t, ch4: +S.climate.ch4.toFixed(1), dT: +S.climate.dT.toFixed(3), funds: Math.round(S.funds), trust: +S.trust.toFixed(1),
      emis: +S.climate.total.toFixed(1), bau: +(S.climate.ch4bau || S.climate.ch4).toFixed(1), anthro: +S.climate.anthro.toFixed(1), sats: S.satellites.filter(s => s.status === 'active').length,
      detected: S.stats.leaksDetected, fixed: S.stats.leaksFixed });
  }

  function randomEvents() {
    const r = S.diff.eventRate;
    const active = S.satellites.filter(s => s.status === 'active');
    if (Math.random() < 0.05 * r) {
      const hit = active.filter(s => Math.random() < 0.5);
      hit.forEach(s => { if (s.dose > 5 || Math.random() < 0.3) { s.safeMode = true; } });
      logEvent('bad', `☀️ Solar storm: ${hit.length} satellite${hit.length === 1 ? '' : 's'} dropped into safe mode; the upper atmosphere swells and drag rises.`);
    }
    if (active.length && Math.random() < 0.035 * active.length * r) {
      const sat = pick(active);
      S.pending = { type: 'debris', sat: sat.id, title: `Conjunction alert: ${sat.name}`,
        text: `A piece of debris will pass within ${(rand(80, 400)).toFixed(0)} m of ${sat.name} in 26 hours. Collision probability is estimated at 1 in ${Math.round(rand(800, 4000))}.`,
        options: [
          { id: 'dodge', label: 'Dodge (burn propellant)', explain: 'Uses a small amount of Δv now; the safe choice operators make when probability exceeds 1 in 10,000.' },
          { id: 'risk', label: 'Accept the risk', explain: 'Saves propellant, but a collision would destroy the satellite and create a debris cloud.' },
        ] };
      // handled automatically, no pop-up: the satellite dodges if its thruster still has propellant
      // (a design question); the outcome goes into the event log and the decision log
      const canDodge = sat.prop > 0.0005 && sat.comp.engines.length > 0;
      resolvePending('dodge');
      if (canDodge) logEvent('info', `☄️ ${sat.name} dodged a piece of debris with an avoidance burn.`);
      else if (sat.status === 'active') logEvent('bad', `☄️ Debris passed close to ${sat.name}: no propellant left to dodge, it was lucky this time.`);
    }
    if (Math.random() < 0.035 * (S.trust / 50)) {
      const g = Math.round(rand(80, 250) * 1000 * (S.trust / 60));
      ledger(g, 'Government grant'); logEvent('good', `💰 Government grant of ${money(g)} for your methane monitoring work.`);
    }
    if (Math.random() < 0.06 * r) {
      const oil = SITES.map((s, i) => [s, i]).filter(([s]) => s.type === 'oilgas');
      const [site, i] = pick(oil);
      const leak = spawnLeak(i, false, true);
      leak.origRate = leak.rate;
      logEvent('bad', `🚨 Breaking: reports of a major gas release near ${site.name}. Satellites with the right instrument and orbit can confirm it.`, { site: site.id });
      emit('bigleak', { site, leak });
    }
    // (the 'Budget cut vote' pop-up was removed: only technical decisions, such as debris alerts, pause the mission)
    if (Math.random() < 0.02 * r) { S.launchDiscountUntil = S.t + 180 * DAY * 1000; logEvent('good', '🤝 International partnership: launches booked in the next 6 months cost 50% less.'); }
    active.forEach(s => {
      if (Math.random() < 0.025 * r && !s.calibDrift) { s.calibDrift = true; logEvent('bad', `${s.name}: instrument calibration drift (−15% sensitivity). Recalibrate from the Orbit Viewer.`); }
      // early cell degradation: old NiCd often, screened space-grade VES cells rarely, everything else in between
      const bf = s.comp.batteries.some(b => b.id === 'nicd') ? 0.05 : s.comp.batteries.some(b => b.id === 'ves') ? 0.002 : 0.008;
      if (Math.random() < bf * r) { s.batteryHealth *= 0.75; logEvent('bad', `${s.name}: battery cell degraded early (capacity −25%).`); }
    });
  }

  function resolvePending(optionId) {
    const p = S.pending; if (!p) return;
    S.pending = null;
    if (p.type === 'debris') {
      const sat = S.satellites.find(s => s.id === p.sat);
      if (optionId === 'dodge') {
        const ok = sat && sat.prop > 0.0005 && sat.comp.engines.length;
        if (ok) { command(sat, { type: 'avoid' }); decision('debris', p.title, p.options[0].explain, 'Avoidance burn performed; collision risk eliminated.'); }
        else { const hit = Math.random() < 0.05; if (hit && sat) die(sat, 'collision with debris'); decision('debris', p.title, p.options[0].explain, hit ? 'No propellant to dodge, and the debris hit.' : 'No propellant to dodge, but the debris missed.'); }
      } else {
        const hit = Math.random() < 0.02;
        if (hit && sat) die(sat, 'collision with debris');
        decision('debris', p.title, p.options[1].explain, hit ? 'The debris struck the satellite.' : 'The debris passed safely this time.');
      }
    } else if (p.type === 'budget') {
      if (optionId === 'present' && S.science >= 150) { S.science -= 150; decision('budget', p.title, p.options[0].explain, 'The cut was defeated.'); logEvent('good', 'Your data presentation defeated the budget cut.'); }
      else { S.budgetCutUntil = S.t + YEAR * 1000; decision('budget', p.title, p.options[1].explain, 'Income reduced by 15% for 12 months.'); logEvent('bad', 'Budget cut: income −15% for 12 months.'); }
    }
    emit('pending', null);
  }

  /* ===================== main tick ===================== */
  function tick(realDt) {
    if (!S || S.paused || S.ended || S.pending) return;
    // at 1 year/s a frame can cover several weeks: advance in month-sized pieces so nothing is skipped
    let simDt = Math.min(realDt * S.warp, YEAR);
    while (simDt > 1e-6 && !S.paused && !S.ended && !S.pending) {
      const d = Math.min(simDt, 86400 * 30);
      advance(d);
      simDt -= d;
    }
  }

  /* Fine mode (≤ 2 h of game time per frame): every satellite is stepped along its real ground
     track and each pass over a site or ground station is evaluated geometrically.
     Coarse mode (fast time-warp): orbit-averaged power and statistically sampled passes, so
     decades can be simulated in minutes while keeping the same expected outcomes. */
  let worldAcc = 0;
  function advance(simDt) {
    const coarse = simDt > 7200;
    S.coarse = coarse;
    const step = coarse ? Math.min(6 * 3600, Math.max(1800, simDt / 40)) : Math.min(300, Math.max(10, simDt / 20));
    let left = simDt;
    let guard = 0;
    while (left > 1e-6 && guard++ < 600 && !S.ended) {
      const dt = Math.min(step, left);
      const sun = ORB.sunDir(S.t + dt * 500);
      const solar = ORB.solarFactor(S.t);
      for (const sat of S.satellites) coarse ? stepSatelliteCoarse(sat, dt, sun, solar) : stepSatellite(sat, dt, sun, solar);
      worldAcc += dt;
      if (worldAcc >= 3 * 3600 || dt >= left) { stepLeaks(worldAcc); updateEmissions(); stepClimate(worldAcc / YEAR); worldAcc = 0; }
      S.t += dt * 1000;
      left -= dt;
      for (const L of S.launches) if (L.status === 'scheduled' && S.t >= L.date) { L.status = 'ready'; S.paused = true; emit('launchReady', L); logEvent('info', `🚀 Launch day for ${L.designName}! Go to the Launch tab.`); return; }
      if (S.t >= S.nextMonth) { S.nextMonth += 30.44 * DAY * 1000; monthly(); if (S.ended || S.pending) return; }
      if (S.t >= S.nextRound && !S.roundPrompted) { S.roundPrompted = true; emit('roundDue'); }
      if (S.t >= S.tEnd) { end('complete'); return; }
    }
  }

  /* ===================== launches ===================== */
  function launchPrice(opt, comp, qty) {
    let p;
    if (opt.price) p = opt.price;
    else if (opt.perKg) p = Math.max(opt.minPrice, opt.perKg * comp.mass * qty);
    else p = Math.max(opt.minPrice, opt.perU * (comp.busUsed.volume) * qty);
    if (S && S.t < S.launchDiscountUntil) p *= 0.5;
    return Math.round(p);
  }
  function nextLaunchDate(opt) {
    const lead = S.t + opt.leadDays * DAY * 1000;
    if (!opt.cadenceDays) return lead;
    const period = opt.cadenceDays * DAY * 1000;
    let d = S.t0 + period * 0.5;
    while (d < lead) d += period;
    return d;
  }
  function bookLaunch(optId, design, qty, target) {
    const opt = LAUNCH_OPTIONS.find(o => o.id === optId);
    const comp = DESIGN.compute(design.parts);
    const satCost = comp.cost * qty;
    const lp = launchPrice(opt, comp, qty);
    const total = satCost + lp;
    if (S.funds - total < -100000) return { ok: false, msg: `Not enough funds: need ${money(total)}.` };
    if (opt.cubesatOnly && comp.busUsed.id === 'micro') return { ok: false, msg: 'The ISS deployer only takes CubeSats up to 16U.' };
    if (opt.maxPayload && comp.mass * qty > opt.maxPayload) return { ok: false, msg: `Too heavy for this rocket (${opt.maxPayload} kg max).` };
    ledger(-satCost, `Build ${qty}× ${design.name}`);
    ledger(-lp, `Launch: ${opt.name}`);
    const L = { id: uid('L'), opt: optId, designName: design.name, parts: { ...design.parts }, qty, date: nextLaunchDate(opt), status: 'scheduled', target, price: lp, satCost, site: target.site || opt.site };
    S.launches.push(L);
    decision('launch-booked', `Booked ${opt.name} for ${qty}× ${design.name}`,
      `Launch choice trades cost against control: ${opt.desc}`,
      `Paid ${money(satCost)} to build and ${money(lp)} to launch. Launch date ${fmtDate(L.date)}.`, { opt: optId, qty, target, cost: total, score: comp.score.total });
    logEvent('info', `Booked ${opt.name} on ${fmtDate(L.date)} for ${qty}× ${design.name} (${money(total)}).`);
    emit('launches');
    return { ok: true, launch: L };
  }

  function launchResult(L, outcome) {
    L.status = 'flown';
    L.outcome = outcome.ok ? 'success' : 'failure';
    if (!outcome.ok) {
      S.stats.launchFailures++;
      adjustTrust(-4, `Launch failure: ${outcome.reason}`);
      decision('launch', `Launch of ${L.designName} failed`, 'Flying a rocket means managing thrust, pitch, dynamic pressure and fuel.', `Failure: ${outcome.reason}. Satellites lost: ${L.qty}.`);
    } else {
      adjustTrust(1.5, 'Successful launch');
      decision('launch', `Launched ${L.qty}× ${L.designName}`, 'Orbit choice decides what your satellite can see and how long it lives.',
        `Reached ${outcome.apo.toFixed(0)} × ${outcome.peri.toFixed(0)} km at ${outcome.inc.toFixed(1)}°.`);
    }
    emit('launches');
  }

  /* ===================== rounds & end ===================== */
  function roundSummary() {
    const h0 = S.history.find(h => h.t >= S.roundStart) || S.history[0];
    const h1 = S.history[S.history.length - 1];
    return {
      from: fmtDate(S.roundStart), to: fmtDate(S.t), yearsPlayed: +years().toFixed(2), durationYears: S.cfg.durationYears,
      funds: Math.round(S.funds), trust: +S.trust.toFixed(1), science: S.science,
      ch4: +S.climate.ch4.toFixed(1), dT: +S.climate.dT.toFixed(3),
      ch4Change: +(h1.ch4 - h0.ch4).toFixed(1), dTChange: +(h1.dT - h0.dT).toFixed(3),
      leaksDetectedThisRound: h1.detected - h0.detected, leaksFixedThisRound: h1.fixed - h0.fixed,
      activeSatellites: S.satellites.filter(s => s.status === 'active').map(s => ({ name: s.name, altKm: Math.round((s.el.a - ORB.RE) / 1000), incDeg: +(s.el.i / ORB.DEG).toFixed(1), detections: s.stats.detections, score: s.comp.score.total })),
      decisions: S.decisions.filter(d => d.t >= S.roundStart),
    };
  }
  function endRound() {
    const sum = roundSummary();
    safeSet(STORE.round, JSON.stringify(sum));
    S.roundStart = S.t; S.nextRound = S.t + S.cfg.roundLengthMonths * 30.44 * DAY * 1000; S.roundPrompted = false;
    save();
    return sum;
  }

  function results(reason) {
    const bau = S.climate.ch4bau || S.climate.ch4;
    const c = S.climate;
    const sats = S.satellites;
    // Everything is judged against the WHOLE planned mission, so quitting early (or doing nothing) can't score well.
    const planned = Math.max(0.5, S.cfg.durationYears);
    const played = years();
    const completion = Math.max(0, Math.min(1, played / planned));
    // ppb less methane than the no-action world. Without a single satellite the difference is just random leak noise, not the player's doing.
    const prevented = S.stats.launches ? bau - c.ch4 : 0;
    // methane rise expected over the full mission without you (measured once a few months have passed; ~15 ppb/yr before that)
    const bauRise = played > 0.25 ? (bau - c.ch4_0) / played * planned : 15 * planned;
    const effectiveness = Math.max(0, Math.min(1, prevented / Math.max(1, bauRise)));
    const M = S.money || { spent: 0, earned: 0 };
    const clamp100 = v => Math.max(0, Math.min(100, Math.round(v)));
    const sub = {
      climate: clamp100(prevented / 60 * 100),                               // 60 ppb prevented = full marks; nothing changed = 0
      detection: clamp100(S.stats.leaksDetected / planned / 60 * 100),      // 60 leaks per planned year = full marks
      science: clamp100(S.science / planned / 6000 * 100),                  // 6,000 science points per planned year = full marks
      trust: clamp100(S.trust * completion),                                // support only counts for the time you actually ran the agency
      // money left over only counts if the agency actually flew a mission with it
      budget: S.funds < 0 || !S.stats.launches ? 0 : clamp100(completion * 100 * (1 - M.spent / Math.max(1, S.cfg.startFunds + M.earned))),
    };
    const total = Math.round(sub.climate * 0.35 + sub.detection * 0.2 + sub.science * 0.15 + sub.trust * 0.15 + sub.budget * 0.15);
    const ranks = [[90, 'Guardian of Earth'], [75, 'Chief Engineer'], [60, 'Mission Specialist'], [40, 'Flight Controller'], [0, 'Rookie Director']];
    return {
      version: 1, reason, finishedAt: new Date().toISOString(), gameStart: fmtDate(S.t0), gameEnd: fmtDate(S.t),
      durationYears: S.cfg.durationYears, yearsPlayed: +years().toFixed(2), difficulty: S.cfg.difficulty, agencyName: S.cfg.agencyName,
      score: total, stars: Math.max(0, Math.min(5, Math.round(total / 20))), rank: ranks.find(r => total >= r[0])[1], subscores: sub,
      completion: +completion.toFixed(3), effectiveness: +effectiveness.toFixed(3), expectedRisePpb: +bauRise.toFixed(1),
      climate: { ch4ppb: +c.ch4.toFixed(1), ch4ppbStart: c.ch4_0, ch4ppbBusinessAsUsual: +bau.toFixed(1), tempAnomalyC: +c.dT.toFixed(3), methaneWarmingC: +c.dTch4.toFixed(3), warmingAvoidedC: +(c.avoidedC || 0).toFixed(3), emissionsMtPerYear: +c.total.toFixed(1) },
      stats: { ...S.stats, mtAvoided: +S.stats.mtAvoided.toFixed(2), satellitesActive: sats.filter(s => s.status === 'active').length },
      finances: (() => {
        const M = S.money || { spent: 0, earned: 0, by: {} };
        const cats = Object.entries(M.by).map(([label, amount]) => ({ label, amount: Math.round(amount) }));
        return {
          startFunds: S.cfg.startFunds, fundsRemaining: Math.round(S.funds), grants: Math.round(S.stats.grants),
          totalSpent: Math.round(M.spent), totalEarned: Math.round(M.earned),
          spending: cats.filter(c => c.amount < 0).sort((a, b) => a.amount - b.amount).map(c => ({ label: c.label, amount: -c.amount })),
          income: cats.filter(c => c.amount > 0).sort((a, b) => b.amount - a.amount),
        };
      })(),
      trust: +S.trust.toFixed(1), science: S.science,
      satellites: sats.map(s => ({ name: s.name, status: s.status, launched: fmtDate(s.launched), ended: s.endT ? fmtDate(s.endT) : null, cause: s.deathCause || null, designScore: s.comp.score.total, detections: s.stats.detections, dataMB: Math.round(s.stats.downMB), altKm: Math.round((s.el.a - ORB.RE) / 1000), incDeg: +(s.el.i / ORB.DEG).toFixed(1) })),
      history: S.history.filter((_, i) => i % Math.max(1, Math.floor(S.history.length / 240)) === 0),
      decisions: S.decisions,
      reports: S.reports.slice(-36),
      reportGrades: S.reports.reduce((g, x) => { g[x.grade] = (g[x.grade] || 0) + 1; return g; }, {}),
      mapFrames: {
        countries: COUNTRY_KEYS.map(Number),
        sites: SITES.map(x => ({ name: x.name, lat: x.lat, lon: x.lon, type: x.type })),
        types: Object.fromEntries(Object.entries(SITE_TYPES).map(([k, t]) => [k, { label: t.label, color: t.color }])),
        frames: (S.mapFrames || { frames: [] }).frames,
      },
      regions: Object.keys(S.countries).map(iso => ({ iso: +iso, ...countryEmission(iso) })).sort((a, b) => b.now - a.now).slice(0, 25)
        .map(e => ({ iso: e.iso, emissionsMt: +e.now.toFixed(2), startMt: e.base, noActionMt: +e.bau.toFixed(2), changePct: +(e.trend * 100).toFixed(1), policyCutPct: +(e.mitigation * 100).toFixed(1), leaksReported: e.detections })),
    };
  }
  function end(reason) {
    if (S.ended) return;
    S.ended = true; S.paused = true;
    captureFrame(true);
    const r = results(reason);
    safeSet(STORE.results, JSON.stringify(r));
    save();
    emit('ended', r);
  }

  /* ===================== queries for the UI ===================== */
  function siteStatus(i) {
    const ss = S.sites[i];
    const active = ss.leaks.filter(l => l.status === 'active' || l.status === 'detected');
    const reported = ss.leaks.filter(l => l.status === 'reported');
    const fixed = ss.leaks.filter(l => l.status === 'fixed');
    return { active, reported, fixed, rate: activeLeakRate(ss), monitored: ss.monitored && S.t - ss.monitored < 30 * DAY * 1000, observations: ss.observations };
  }
  function countryEmission(iso) {
    const c = S.countries[iso]; if (!c) return null;
    let leaks = 0;
    (COUNTRY_SITES[String(iso)] || []).forEach(i => { leaks += activeLeakRate(S.sites[i]) * MT_PER_TPH; });
    const pr = profile(iso);
    const ev = c.evidence * pr.resp;
    const now = c.level * (1 - c.mitigation) + leaks;
    return {
      now, leaks, base: c.base, bau: c.bauLevel, mitigation: c.mitigation, detections: c.detections, evidence: c.evidence, dataMB: c.dataMB, reports: c.reports,
      trend: (c.level * (1 - c.mitigation)) / c.base - 1, growth: pr.g - 0.012 * ev / (ev + 30), bauGrowth: pr.g, resp: pr.resp, cap: pr.cap,
      policyTarget: pr.cap * ev / (ev + 30) * (0.4 + 0.6 * S.trust / 100),
    };
  }
  // total methane coming from a site's region (t/h): its share of national (or natural) emissions plus active leaks
  function siteEmission(i) {
    const site = SITES[i], type = SITE_TYPES[site.type];
    const leaks = activeLeakRate(S.sites[i]);
    let regional;
    if (type.fixShare === 0) {
      const nNat = SITES.filter(x => SITE_TYPES[x.type].fixShare === 0).length;
      regional = (S.climate.natural || 205) * 0.5 / nNat / MT_PER_TPH;
    } else {
      const c = S.countries[site.iso];
      const n = (COUNTRY_SITES[String(site.iso)] || []).filter(k => SITE_TYPES[SITES[k].type].fixShare > 0).length || 1;
      regional = c ? c.level * (1 - c.mitigation) * 0.45 / n / MT_PER_TPH : 0;
    }
    return { total: regional + leaks, regional, leaks };
  }
  // predict next ground contact (any station) within the next `hours`
  function nextContact(sat, hours = 24) {
    let el = sat.el;
    for (let dt = 0; dt < hours * 3600; dt += 30) {
      const st = ORB.stateAt(el, S.t + dt * 1000);
      const lam = ORB.visibilityAngle(st.alt);
      for (const gs of GROUND_STATIONS) {
        const d = Math.acos(Math.max(-1, Math.min(1, ORB.v.dot(st.unit, gsUnit(gs)))));
        if (d < lam && sat.comp.comms.some(x => x.optical ? gs.optical : !gs.optical)) return { t: S.t + dt * 1000, gs, inS: dt };
      }
    }
    return null;
  }

  return {
    siteEmission, profile,
    get state() { return S; }, on, emit, newGame, load, save, tick, advance, addSatellite, command, applyDv, bookLaunch, launchResult,
    launchPrice, nextLaunchDate, resolvePending, endRound, roundSummary, end, results, siteStatus, countryEmission, nextContact,
    capacityWh, usableFloor, dvLeft, storageCap, decision, logEvent, ledger, fmtDate, money, years, YEAR, DAY, MT_PER_TPH,
  };
})();
