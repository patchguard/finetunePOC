/* =========================================================================
   Launch flight physics + adaptive autopilot (pure, no DOM)

   Full 3D, in an Earth-centred inertial frame (the same frame as orbit.js:
   z = north pole, x = vernal equinox). The Earth turns underneath at the
   sidereal rate, so the pad starts with Earth's rotation speed.

   Forces and effects:
   - Gravity: inverse-square plus J2 (Earth's equatorial bulge).
   - Thrust: varies with outside air pressure (sea-level vs vacuum thrust and Isp).
   - Atmosphere: US Standard Atmosphere 1976 below 86 km (temperature,
     pressure, density, speed of sound); Vallado density table above.
   - Wind: a jet-stream profile peaking near 11 km plus gusts; it changes the
     airflow, the angle of attack and the dynamic pressure.
   - Aerodynamics: drag coefficient that rises through the sound barrier
     (transonic drag rise) and falls when supersonic; extra drag and a normal
     (lift) force at angle of attack.
   - Stability: the vehicle is aerodynamically stable (centre of pressure
     behind the centre of mass), so the air turns its nose into the airflow.
     Engine gimbal (or small thrusters when coasting) can hold it off the
     airflow only as far as the control torque allows.
   - Structural limits: dynamic pressure, q × angle of attack, and g-load.
   - Heating: Sutton–Graves convective heating at high speed, coupling to
     air temperature at low speed, sunlight, Earth's infrared and radiation
     to cold space. The skin heats on ascent and burns up on re-entry from
     orbit. The payload is protected by the fairing until it is jettisoned;
     after that free-molecular heating (and cold in Earth's shadow) reaches it.
   - Staging, fairing, engine failures, booster recovery, propulsive landing.
   ========================================================================= */

const FLIGHT = (() => {
  const MU = 3.986004418e14, R = 6371000, G0 = 9.80665, DEG = Math.PI / 180;
  const OMEGA = 7.2921159e-5, J2 = 1.08262668e-3, RJ = 6378137, SIGMA = 5.670374e-8;
  const clampN = (x, a, b) => Math.max(a, Math.min(b, x));

  /* ---------- small vector helpers (arrays of 3) ---------- */
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = a => Math.hypot(a[0], a[1], a[2]);
  const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const angle = (a, b) => Math.acos(clampN(dot(norm(a), norm(b)), -1, 1));
  // rotate unit vector a toward unit vector b by at most maxAng (rad)
  function rotateToward(a, b, maxAng) {
    const ang = angle(a, b);
    if (ang <= maxAng || ang < 1e-9) return norm(b);
    let axis = cross(a, b);
    if (len(axis) < 1e-9) axis = Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]);
    axis = norm(axis);
    const c = Math.cos(maxAng), s = Math.sin(maxAng);
    // Rodrigues
    return norm(add(add(mul(a, c), mul(cross(axis, a), s)), mul(axis, dot(axis, a) * (1 - c))));
  }

  /* ---------- Earth rotation ---------- */
  const theta = f => f.theta0 + OMEGA * f.t;
  const ecefToEci = (p, th) => { const c = Math.cos(th), s = Math.sin(th); return [c * p[0] - s * p[1], s * p[0] + c * p[1], p[2]]; };
  const eciToEcef = (p, th) => { const c = Math.cos(th), s = Math.sin(th); return [c * p[0] + s * p[1], -s * p[0] + c * p[1], p[2]]; };
  const earthVel = r => [-OMEGA * r[1], OMEGA * r[0], 0]; // ω × r

  /* ---------- atmosphere ---------- */
  // US Standard Atmosphere 1976 layers: base altitude m, base temperature K, lapse K/m, base pressure Pa
  const SA = [[0, 288.15, -0.0065, 101325], [11000, 216.65, 0, 22632.06], [20000, 216.65, 0.001, 5474.889], [32000, 228.65, 0.0028, 868.0187],
    [47000, 270.65, 0, 110.9063], [51000, 270.65, -0.0028, 66.93887], [71000, 214.65, -0.002, 3.956420], [86000, 186.87, 0, 0.3734]];
  const RAIR = 287.053, GM_R = G0 * 0.0289644 / 8.31446;
  function atmosphere(h) {
    if (h < 0) h = 0;
    if (h < 86000) {
      let L = SA[0];
      for (const row of SA) { if (h >= row[0]) L = row; else break; }
      const [hb, Tb, lap, pb] = L, dh = h - hb;
      const T = Tb + lap * dh;
      const p = lap === 0 ? pb * Math.exp(-GM_R * dh / Tb) : pb * Math.pow(Tb / T, GM_R / lap);
      return { T, p, rho: p / (RAIR * T), a: Math.sqrt(1.4 * RAIR * T) };
    }
    // thermosphere: hot and almost empty
    const rho = ORB.density(h, 1);
    const T = 186.87 + (1000 - 186.87) * (1 - Math.exp(-(h - 86000) / 60000));
    return { T, p: rho * RAIR * T, rho, a: Math.sqrt(1.4 * RAIR * T) };
  }
  const P0 = 101325;

  // drag coefficient vs Mach for a slender rocket (transonic drag rise, then falling)
  const CD_M = [[0, 0.30], [0.6, 0.30], [0.9, 0.42], [1.05, 0.58], [1.2, 0.62], [1.5, 0.55], [2, 0.47], [3, 0.38], [5, 0.31], [10, 0.28]];
  function cdMach(M) {
    if (M >= CD_M[CD_M.length - 1][0]) return CD_M[CD_M.length - 1][1];
    for (let i = 1; i < CD_M.length; i++) if (M < CD_M[i][0]) { const [m0, c0] = CD_M[i - 1], [m1, c1] = CD_M[i]; return c0 + (c1 - c0) * (M - m0) / (m1 - m0); }
    return 0.3;
  }
  const CN_ALPHA = 2.0; // normal-force slope per radian (slender body)

  /* ---------- local frame at a position ---------- */
  function local(r) {
    const up = norm(r);
    let east = cross([0, 0, 1], up);
    if (len(east) < 1e-9) east = [1, 0, 0];
    east = norm(east);
    const north = cross(up, east);
    return { up, east, north };
  }
  function dirFromPH(r, pitchDeg, hdgDeg) {
    const { up, east, north } = local(r);
    const p = pitchDeg * DEG, hd = hdgDeg * DEG;
    const hz = add(mul(east, Math.sin(hd)), mul(north, Math.cos(hd)));
    return norm(add(mul(hz, Math.cos(p)), mul(up, Math.sin(p))));
  }
  function phFromDir(r, d) {
    const { up, east, north } = local(r);
    const pitch = Math.asin(clampN(dot(d, up), -1, 1)) / DEG;
    let hdg = Math.atan2(dot(d, east), dot(d, north)) / DEG;
    if (hdg < 0) hdg += 360;
    return { pitch, hdg };
  }
  const horizontal = (r, vec) => { const up = norm(r); return sub(vec, mul(up, dot(vec, up))); };
  // direction `pitch` degrees above the horizon, in the vertical plane of horizontal reference `ref`
  function dirP(r, pitchDeg, ref) {
    const up = norm(r), h = norm(horizontal(r, ref));
    const p = pitchDeg * DEG;
    return norm(add(mul(h, Math.cos(p)), mul(up, Math.sin(p))));
  }
  const elevation = (r, vec) => Math.asin(clampN(dot(norm(vec), norm(r)), -1, 1)) / DEG;

  /* ---------- create ---------- */
  function create({ rocketId, payloadKg, site, inc, targetAlt, reliability, recover = true, manifestAlt = null, launchMs = Date.UTC(2027, 0, 1) }) {
    const rk = ROCKETS[rocketId];
    const lat = site.lat * DEG;
    // launch azimuth for the requested inclination (sin az = cos i / cos lat), chosen inside the range-safety window
    const s = Math.cos(inc * DEG) / Math.cos(lat);
    const a1 = Math.asin(clampN(s, -1, 1)) / DEG;
    const cands = [a1, 180 - a1].map(a => ((a % 360) + 360) % 360);
    const inWin = a => { const [lo, hi] = site.azimuths; const aa = a > 180 && lo < 0 ? a - 360 : a; return aa >= lo && aa <= hi; };
    const az = cands.find(inWin) ?? cands[0];
    const theta0 = ORB.gmst(launchMs);
    const siteEcef = mul(ORB.latLonToUnit(site.lat, site.lon), R);
    const r0 = ecefToEci(siteEcef, theta0);
    const L0 = local(r0);
    const d0 = add(mul(L0.east, Math.sin(az * DEG)), mul(L0.north, Math.cos(az * DEG)));
    const planeN = norm(cross(L0.up, d0)); // target orbit plane (inertial)
    const vPad = OMEGA * R * Math.cos(lat) * Math.sin(az * DEG);
    // winds: jet stream strength and direction for this launch
    const wind = { dir: Math.random() * 360, peak: 15 + Math.random() * 40, gust: [0, 0], gustT: 0 };
    const f = {
      rk, rocketId, site, inc, az, lat: site.lat, targetAlt, manifestAlt, launchMs, theta0, siteEcef, planeN,
      stages: rk.stages.map(st => ({ ...st, propLeft: st.prop, engineFactor: 1 })),
      stageIdx: 0, fairing: rk.fairing, payload: payloadKg, deployed: false,
      r: r0, v: earthVel(r0), att: L0.up, cmd: L0.up, pitch: 90, heading: az, roll: 0,
      t: -10, throttle: 0, launched: false, liftedOff: false, landed: false, ended: false, outcome: null,
      maxQ: 0, q: 0, g: 0, aoa: 0, mach: 0, air: atmosphere(0), heatFlux: 0, fmh: 0, alphaHold: 180,
      skinT: 288, payloadT: 293, maxSkinT: 288, maxPayloadT: 293, minPayloadT: 293, payloadExposedFmh: 0, payloadDamage: null,
      wind, recover, boosterRecovered: null, separations: [],
      ap: { engaged: true, program: 'ascend', phase: '', target: targetAlt * 1000, manualUntil: -1e9, lastNote: '' },
      log: [], anomaly: null, path: [], nextPath: 0, reliability, sunlit: true,
    };
    if (Math.random() > reliability) f.anomaly = { t: 15 + Math.random() * 120, kind: Math.random() < 0.7 ? 'engine' : 'catastrophic', done: false };
    note(f, `T−10 s · ${rk.name} on ${site.name}. Azimuth ${az.toFixed(1)}° for ${inc.toFixed(1)}°; Earth's rotation gives ${vPad.toFixed(0)} m/s. Upper winds ${f.wind.peak.toFixed(0)} m/s.`);
    return f;
  }
  function note(f, msg, kind = '') { f.log.push({ t: f.t, msg, kind }); if (f.log.length > 80) f.log.shift(); }

  /* ---------- state helpers ---------- */
  const rmag = f => len(f.r);
  const alt = f => rmag(f) - R;
  function mass(f) {
    let m = f.payload + (f.fairing || 0);
    for (let i = f.stageIdx; i < f.stages.length; i++) m += f.stages[i].dry + f.stages[i].propLeft;
    return m;
  }
  // lit = engines burning (landing burns use only a few of a booster's engines)
  function stageThrust(f, st, p = f.air.p) { return (st.thrustVac + (st.thrustSL - st.thrustVac) * Math.min(1, p / P0)) * st.engineFactor * ((st.lit || st.engines) / st.engines); }
  function stageIsp(f, st, p = f.air.p) { return st.ispVac + (st.ispSL - st.ispVac) * Math.min(1, p / P0); }
  const surfaceVel = f => sub(f.v, earthVel(f.r));
  function windVel(f, h) {
    const { up, east, north } = local(f.r);
    const w = f.wind;
    const speed = 4 + w.peak * Math.exp(-(((h - 11500) / 5500) ** 2)) + 8 * Math.exp(-(((h - 45000) / 12000) ** 2));
    const fade = h > 60000 ? Math.exp(-(h - 60000) / 8000) : 1;
    const dir = add(mul(east, Math.sin(w.dir * DEG)), mul(north, Math.cos(w.dir * DEG)));
    return add(mul(dir, speed * fade), mul(add(mul(east, w.gust[0]), mul(north, w.gust[1])), fade * (h < 20000 ? 1 : 0.3)));
  }
  const airVel = f => { const h = alt(f); return h > 120e3 ? surfaceVel(f) : sub(surfaceVel(f), windVel(f, h)); };

  function orbit(f) {
    const r = rmag(f), v2 = dot(f.v, f.v), v = Math.sqrt(v2);
    const eps = v2 / 2 - MU / r;
    const hv = cross(f.r, f.v), h = len(hv);
    const vr = dot(f.v, f.r) / r, vt = Math.sqrt(Math.max(0, v2 - vr * vr));
    const ev = mul(sub(mul(f.r, v2 - MU / r), mul(f.v, r * vr)), 1 / MU);
    const e = len(ev);
    const inc = Math.acos(clampN(hv[2] / (h || 1), -1, 1)) / DEG;
    if (eps >= 0) return { r, v, vr, vt, e, a: Infinity, ap: Infinity, pe: (h * h / MU / (1 + e)) - R, tAp: Infinity, escape: true, inc, hv, ev };
    const a = -MU / (2 * eps), p = h * h / MU;
    const rp = a * (1 - e), ra = a * (1 + e);
    let nu = e > 1e-9 ? Math.acos(clampN((p / r - 1) / e, -1, 1)) : 0;
    if (vr < 0) nu = 2 * Math.PI - nu;
    const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
    let M = E - e * Math.sin(E); if (M < 0) M += 2 * Math.PI;
    const n = Math.sqrt(MU / a ** 3);
    const tAp = M <= Math.PI ? (Math.PI - M) / n : (3 * Math.PI - M) / n;
    const tPe = (2 * Math.PI - M) / n;
    return { r, v, vr, vt, e, a, p, ap: ra - R, pe: rp - R, tAp, tPe, period: 2 * Math.PI / n, nu, escape: false, inc, hv, ev };
  }
  function dvLeft(f) {
    let m = mass(f), dv = 0;
    for (let i = f.stageIdx; i < f.stages.length; i++) {
      const st = f.stages[i];
      dv += st.ispVac * G0 * Math.log(m / (m - st.propLeft));
      m -= st.dry + st.propLeft;
    }
    return dv;
  }
  function downrangeKm(f) {
    const p = eciToEcef(f.r, theta(f));
    return angle(p, f.siteEcef) * R / 1000;
  }

  /* ---------- guidance helpers ---------- */
  // horizontal steering direction that flies into the target plane (yaw steering cancels out-of-plane speed)
  function planeRef(f, gain = 3) {
    const up = norm(f.r);
    const t = norm(horizontal(f.r, cross(f.planeN, up)));
    const w = dot(f.v, f.planeN);
    // drift back into the plane too: aim for a sideways speed that removes the sideways offset over ~3 minutes
    const wWanted = clampN(-dot(f.r, f.planeN) / 180, -150, 150);
    const vh = len(horizontal(f.r, f.v));
    const corr = clampN(gain * (wWanted - w) / Math.max(300, vh), -0.35, 0.35);
    return norm(horizontal(f.r, add(t, mul(f.planeN, corr))));
  }
  function clampCone(d, axis, maxDeg) { return angle(d, axis) > maxDeg * DEG ? rotateToward(axis, d, maxDeg * DEG) : d; }

  /* ---------- autopilot (closed loop: recomputed from the current state every step) ---------- */
  function autopilot(f) {
    const ap = f.ap;
    const h = alt(f), o = orbit(f);
    const st = f.stages[f.stageIdx];
    const m = mass(f);
    const thrust = st ? stageThrust(f, st) : 0;
    const acc = thrust / m;
    const surf = surfaceVel(f), sp = len(surf);
    const up = norm(f.r);
    const pro = norm(f.v);
    const target = ap.target;
    let dir = f.cmd, throttle = f.throttle;
    const vCirc = rr => Math.sqrt(MU / rr);

    if ((ap.program === 'ascend' || ap.program === 'circularize') && h > 20e3 && !ap.adaptedLow) {
      const needed = vCirc(R + target) - o.vt + Math.max(0, -o.vr) * 0.5 + (h < 100e3 ? 300 : 0);
      if (dvLeft(f) < needed * 0.92 && o.vt > 2000) {
        ap.adaptedLow = true;
        const newT = Math.max(180e3, Math.min(target, (o.ap > 150e3 ? o.ap : 200e3)));
        if (newT < target - 5e3) { ap.target = newT; note(f, `Autopilot: not enough Δv for ${(target / 1000).toFixed(0)} km, adapting to ${(newT / 1000).toFixed(0)} km.`, 'warn'); }
      }
    }

    switch (ap.program) {
      case 'ascend': {
        throttle = 1;
        const ref = planeRef(f);
        if (h < 600 || sp < 60) dir = up;
        else {
          const turnEnd = Math.min(160e3, 0.32 * target + 45e3);
          let prof = 90 - 88 * Math.pow(clampN((h - 600) / (turnEnd - 600), 0, 1), 0.55);
          const air = airVel(f);
          const progEl = elevation(f.r, air);
          if (f.q > 6000) prof = clampN(prof, progEl - 4, progEl + 4);
          if (h > 45e3) {
            const tt = Math.max(30, (target - h) / Math.max(200, o.vr + 1));
            const vrWanted = clampN((target - h) / Math.max(60, Math.min(tt, 250)), -50, 2200);
            prof = clampN(prof + (vrWanted - o.vr) * 0.02, -20, 60);
          }
          dir = dirP(f.r, prof, ref);
          // through max-Q stay within a few degrees of the airflow (the structure can't take side loads)
          if (f.q > 6000) dir = clampCone(dir, norm(air), 4);
          if (f.q > 32000) throttle = clampN(1 - (f.q - 32000) / 15000, st.minThrottle, 1);
          if (acc / G0 > 5.5) throttle = clampN(5.5 * G0 * m / (thrust || 1), st.minThrottle, 1);
        }
        if (o.ap >= target - 500 && h > 30e3) {
          throttle = 0; dir = pro;
          if (h > 70e3 || o.vr < 400) { ap.program = 'circularize'; note(f, `Apoapsis ${(o.ap / 1000).toFixed(0)} km reached. Coasting to circularise.`); }
        }
        if (f.recover && f.stageIdx === 0 && f.stages[0].reusable && f.stages[0].propLeft < f.stages[0].prop * 0.09 && f.stages.length > 1) stage(f, 'Booster cut-off (landing reserve)');
        break;
      }
      case 'circularize': {
        const ra = R + Math.min(o.ap, target + 40e3);
        const vAtAp = Math.sqrt(MU * (2 / ra - 1 / o.a));
        const dvNeed = Math.max(0, vCirc(ra) - vAtAp);
        const burnT = acc > 0 ? dvNeed / acc : 1e9;
        const go = ap.phase === 'burning' || o.tAp < burnT / 2 + 3 || o.vr < -20 || o.escape;
        if (!go) { throttle = 0; dir = pro; ap.phase = `waiting · burn in ${Math.max(0, o.tAp - burnT / 2).toFixed(0)} s`; break; }
        ap.phase = 'burning';
        const vrD = clampN((Math.min(target, o.ap) - h) / 40, -120, 120);
        dir = dirP(f.r, clampN((vrD - o.vr) * 0.35, -35, 45), planeRef(f, 3));
        throttle = 1;
        if (o.pe >= Math.min(target - 25e3, o.ap - 6e3) || (o.pe > 150e3 && o.e < 0.003) || !st || (st.propLeft <= 0 && f.stageIdx >= f.stages.length - 1)) {
          throttle = 0; ap.program = 'hold-prograde'; ap.phase = '';
          note(f, `Orbit achieved: ${(o.ap / 1000).toFixed(0)} × ${(o.pe / 1000).toFixed(0)} km at ${o.inc.toFixed(2)}°. Ready to deploy.`, 'good');
        }
        break;
      }
      case 'raise': case 'lower': {
        const X = target, upw = ap.program === 'raise';
        if (!ap.phase || ap.phase === 'burn1') {
          ap.phase = 'burn1';
          dir = upw ? pro : mul(pro, -1); throttle = 1;
          if (upw ? o.ap >= X - 300 : o.pe <= X + 300) { throttle = 0; ap.phase = 'coast'; note(f, `Transfer burn done. Coasting to ${upw ? 'apoapsis' : 'periapsis'}.`); }
        } else if (ap.phase === 'coast' || ap.phase === 'burn2') {
          const tTo = upw ? o.tAp : o.tPe;
          const rr = R + X;
          const vAt = Math.sqrt(MU * (2 / rr - 1 / o.a));
          const burnT = acc > 0 ? Math.abs(vCirc(rr) - vAt) / acc : 1e9;
          if (ap.phase === 'coast' && tTo > burnT / 2 + 2 && tTo < o.period - 30) { throttle = 0; dir = pro; break; }
          ap.phase = 'burn2'; throttle = 1;
          dir = upw ? dirP(f.r, clampN(-o.vr * 0.35, -35, 35), f.v) : dirP(f.r, clampN(-o.vr * 0.35, -35, 35), mul(f.v, -1));
          if (upw ? o.pe >= X - 5e3 || o.e < 0.0015 : o.ap <= X + 5e3 || o.e < 0.0015) { throttle = 0; ap.program = 'hold-prograde'; ap.phase = ''; note(f, `New orbit: ${(o.ap / 1000).toFixed(0)} × ${(o.pe / 1000).toFixed(0)} km.`, 'good'); }
        }
        break;
      }
      case 'deorbit': {
        dir = mul(pro, -1); throttle = 1;
        if (o.pe < 25e3 || !st || st.propLeft <= 0) { throttle = 0; ap.program = 'land'; note(f, 'Deorbit burn complete. Entering the atmosphere.'); }
        break;
      }
      case 'land': {
        const vr = dot(surf, up);
        // high up, point engine-first into the actual airflow (wind included); near the ground, against the ground track
        const flow = h > 3000 ? airVel(f) : surf;
        dir = len(flow) > 1 ? norm(mul(flow, -1)) : up;
        // final approach: stay nearly upright (at most 15° of tilt to kill the last sideways drift)
        if (h < 3000) dir = clampCone(norm(add(mul(surf, -1), mul(up, 5))), up, h < 300 ? 8 : 15);
        const canBurn = st && st.propLeft > 0 && (st.restarts > 0 || f.throttle > 0);
        if (sp > 2500 && h > 15e3) { throttle = 0; ap.phase = 're-entry'; break; }
        if (f.q > 3000 && vr > 0) { throttle = 0; dir = norm(airVel(f)); ap.phase = 'coasting up, waiting for low dynamic pressure'; break; }
        if (!canBurn) { throttle = 0; ap.phase = 'ballistic'; break; }
        // still climbing: coast up to the top of the arc first
        if (vr > 0 && h > 1500) { throttle = 0; dir = norm(airVel(f)); ap.phase = 'coasting to the top of the arc'; break; }
        if (vr < 0 && sp > 850 && h < 70e3 && h > 18e3) { st.lit = Math.min(3, st.engines); throttle = 1; ap.phase = 'entry burn'; break; }
        // "suicide burn": light only as many engines as needed (about 2.5 g), as late as possible,
        // then follow a constant-deceleration profile that reaches zero speed at the ground
        const tOne = stageThrust(f, { ...st, lit: 1 }) ;
        const n = ap.phase === 'landing burn' ? (st.lit || st.engines) : clampN(Math.ceil(2.5 * G0 * m / tOne), 1, st.engines);
        const amax = tOne * n / m;
        const aPlan = Math.max(0.5, (amax * 0.85 - G0) * 0.75);
        const stopDist = sp * sp / (2 * aPlan);
        if (ap.phase !== 'landing burn' && h > stopDist + 150 && h > 300) { st.lit = st.engines; throttle = 0; ap.phase = `falling · burn at ${(stopDist / 1000).toFixed(1)} km`; break; }
        if (ap.phase !== 'landing burn') { st.lit = n; if (n < st.engines) note(f, `Landing burn on ${n} of ${st.engines} engines.`); }
        ap.phase = 'landing burn';
        const vWanted = -Math.sqrt(2.25 + 2 * aPlan * Math.max(0, h - 2));
        const vertShare = Math.max(0.4, dot(dir, up)); // part of the thrust that pushes upward (the rest kills sideways speed)
        throttle = clampN((G0 + aPlan + (vWanted - vr) * 1.5) / vertShare / (amax || 1), 0, 1);
        // engines can't throttle below their minimum: briefly cut them instead of climbing back up
        if (throttle > 0 && throttle < st.minThrottle) throttle = throttle < st.minThrottle * 0.6 ? 0 : st.minThrottle;
        break;
      }
      case 'hold-prograde': dir = pro; throttle = 0; break;
      case 'hold-retrograde': dir = mul(pro, -1); throttle = 0; break;
      case 'hold-radial': dir = up; throttle = 0; break;
      default: break;
    }
    return { dir, throttle };
  }

  /* ---------- actions ---------- */
  function stage(f, why = 'Staging') {
    if (f.stageIdx >= f.stages.length - 1) { note(f, 'No more stages.', 'warn'); return false; }
    const st = f.stages[f.stageIdx];
    if (st.reusable) {
      const reserve = st.propLeft / st.prop;
      f.boosterRecovered = f.recover && reserve >= 0.07 && Math.random() < 0.95;
      note(f, f.boosterRecovered ? `${st.name} separated and is flying back to land on the droneship.` : `${st.name} separated${reserve < 0.07 && f.recover ? ' without enough propellant to land' : ''}; it will be expended.`, f.boosterRecovered ? 'good' : '');
    } else note(f, `${why}: ${st.name} separated.`);
    f.separations.push({ kind: 'stage', idx: f.stageIdx, t: f.t, r: f.r.slice(), v: f.v.slice(), att: f.att.slice() });
    f.stageIdx++;
    f.throttle = f.ap.engaged ? f.throttle : 0;
    return true;
  }
  function jettisonFairing(f, manual) {
    if (!f.fairing) return;
    const h = alt(f);
    note(f, `Fairing jettisoned at ${(h / 1000).toFixed(0)} km${f.fmh > 1135 ? ` (free-molecular heating ${(f.fmh / 1000).toFixed(1)} kW/m², above the 1.1 kW/m² payload limit!)` : ''}.`, f.fmh > 1135 ? 'bad' : '');
    f.separations.push({ kind: 'fairing', t: f.t, r: f.r.slice(), v: f.v.slice(), att: f.att.slice() });
    f.fairing = 0;
  }

  /* ---------- thermal model ---------- */
  function thermal(f, dt, h, vAir, air) {
    const sunDir = ORB.sunDir(f.launchMs + f.t * 1000);
    f.sunlit = !ORB.inEclipse(f.r, sunDir);
    const r = rmag(f);
    const viewEarth = 0.5 * (1 - Math.sqrt(Math.max(0, 1 - (R / r) ** 2))) * 2; // fraction of sky filled by Earth
    const solar = f.sunlit ? 1361 * 0.25 * 0.35 : 0;                 // absorbed sunlight (white paint, ~¼ of the area faces the Sun)
    const earthIR = 237 * viewEarth * 0.85 * 0.5;
    const M = vAir / air.a;
    // aerodynamic heating: Sutton–Graves stagnation flux averaged over the skin, plus convection toward recovery temperature
    const rn = clampN(f.rk.diameter / 2, 0.3, 1.8);
    const qsg = 1.7415e-4 * Math.sqrt(air.rho / rn) * vAir ** 3;
    const Tr = air.T * (1 + 0.17 * M * M);
    const hc = 6 * Math.min(1, air.rho / 1.225) + 3 * Math.sqrt(air.rho * vAir); // vanishes in near-vacuum
    const qAero = qsg * 0.35, qConv = hc * (Tr - f.skinT);
    const skinIn = (qAero > Math.abs(qConv) ? qAero : qConv) + solar + earthIR;
    const skinOut = 0.85 * SIGMA * (f.skinT ** 4 - 3 ** 4);
    f.heatFlux = qsg * 0.35;
    f.skinT += (skinIn - skinOut) / 7000 * dt;             // ~3 mm aluminium skin
    f.maxSkinT = Math.max(f.maxSkinT, f.skinT);
    // payload: inside the fairing it follows the fairing's inner wall slowly; outside it gets free-molecular heating
    f.fmh = 0.5 * air.rho * vAir ** 3;
    if (f.fairing) f.payloadT += (Math.min(f.skinT, 330) - f.payloadT) / 1800 * dt;
    else if (!f.deployed) {
      const pin = f.fmh * 0.6 + (f.sunlit ? 1361 * 0.3 * 0.4 : 0) + 237 * viewEarth * 0.5 + 25; // 25 W/m²: payload heaters
      const pout = 0.8 * SIGMA * (f.payloadT ** 4 - 3 ** 4);
      f.payloadT += (pin - pout) / 25000 * dt;
      f.payloadExposedFmh = Math.max(f.payloadExposedFmh, f.fmh);
    }
    f.maxPayloadT = Math.max(f.maxPayloadT, f.payloadT);
    f.minPayloadT = Math.min(f.minPayloadT, f.payloadT);
  }
  // damage the satellites will carry into orbit (applied when they are deployed)
  function payloadDamage(f) {
    const d = [];
    if (f.payloadExposedFmh > 3000 || f.maxPayloadT > 400) d.push({ kind: 'heat', severe: true, text: 'Overheated during ascent: solar cells and battery damaged' });
    else if (f.payloadExposedFmh > 1135 || f.maxPayloadT > 345) d.push({ kind: 'heat', severe: false, text: 'Heated above its limits during ascent: instrument calibration drifted' });
    if (f.minPayloadT < 233) d.push({ kind: 'cold', severe: f.minPayloadT < 213, text: 'Got too cold while waiting in Earth\'s shadow: battery capacity reduced' });
    return d;
  }

  /* ---------- integrate ---------- */
  function step(f, dt, input) {
    if (f.ended || f.hold) return; // hold: on the pad, waiting for the player to choose how to launch
    f.t += dt;
    if (f.t < 0) { f.r = ecefToEci(f.siteEcef, theta(f)); f.v = earthVel(f.r); f.att = norm(f.r); f.cmd = f.att; return; }
    if (!f.launched) { f.launched = true; note(f, 'Ignition!', 'good'); }
    const now = f.t;
    const manual = input && now < f.ap.manualUntil;
    let throttle = f.throttle;
    if (f.ap.engaged && !manual) {
      if (f.ap.wasManual) { f.ap.wasManual = false; const o = orbit(f); note(f, `Autopilot re-planning from the current trajectory (Ap ${(o.ap / 1000).toFixed(0)} km, Pe ${(o.pe / 1000).toFixed(0)} km).`, 'adapt'); f.ap.adaptFlash = now + 3; }
      const c = autopilot(f); f.cmd = c.dir; throttle = c.throttle;
      // orbital burns: wait until the nose points the right way before lighting the engine (turning takes a while in space)
      if (throttle > 0 && !['ascend', 'land'].includes(f.ap.program) && f.liftedOff && angle(f.att, f.cmd) > 10 * DEG) { throttle = 0; f.ap.phase = (f.ap.phase || '').replace(/ · turning$/, '') + ' · turning'; }
      // never push a light stage harder than 5 g
      const stA = f.stages[f.stageIdx];
      if (throttle > 0 && stA && f.liftedOff) { const full = stageThrust(f, stA, f.air.p); const lim = 5 * G0 * mass(f) / (full || 1); if (lim < throttle) throttle = Math.max(stA.minThrottle, lim); }
      const ph = phFromDir(f.r, f.cmd); f.pitch = ph.pitch; f.heading = ph.hdg;
    } else {
      if (manual) f.ap.wasManual = true;
      f.pitch = clampN(f.pitch, -90, 90); f.heading = ((f.heading % 360) + 360) % 360;
      f.cmd = dirFromPH(f.r, f.pitch, f.heading);
    }
    f.throttle = clampN(throttle, 0, 1);

    // anomalies
    if (f.anomaly && !f.anomaly.done && now > f.anomaly.t && f.stageIdx === 0) {
      f.anomaly.done = true;
      const st = f.stages[0];
      if (f.anomaly.kind === 'engine' && st.engines > 1) { st.engineFactor = (st.engines - 1) / st.engines; note(f, `⚠ Engine anomaly: one of ${st.engines} first-stage engines shut down. Thrust −${(100 / st.engines).toFixed(0)}%.`, 'bad'); }
      else return fail(f, 'Catastrophic first-stage failure');
    }

    const st = f.stages[f.stageIdx];
    const m = mass(f);
    const r = rmag(f), h = r - R;
    f.air = atmosphere(h);
    const air = f.air;
    // gusts (random walk, a few m/s)
    if (h < 30e3) { f.wind.gust = f.wind.gust.map(g => g * Math.exp(-dt / 8) + (Math.random() - 0.5) * Math.sqrt(dt) * 1.6); }
    const va = airVel(f), vAir = len(va);
    const vaHat = vAir > 0.5 ? mul(va, 1 / vAir) : null;
    f.q = 0.5 * air.rho * vAir * vAir;
    f.mach = vAir / air.a;

    // thrust
    let acc = [0, 0, 0], T = 0;
    if (st && st.propLeft > 0 && f.throttle > 0) {
      const thr = f.throttle < st.minThrottle ? st.minThrottle : f.throttle;
      T = stageThrust(f, st) * thr;
      const mdot = T / (stageIsp(f, st) * G0);
      const burn = Math.min(st.propLeft, mdot * dt);
      st.propLeft -= burn;
      f.thrustOn = true;
      if (st.propLeft <= 0) { note(f, `${st.name} burnout.`); if (f.ap.engaged && f.stageIdx < f.stages.length - 1) stage(f, 'Auto-staging'); }
    } else f.thrustOn = false;

    // attitude: control torque vs aerodynamic restoring torque (the vehicle is stable: the air turns its nose into the wind)
    const Lh = f.rk.height;
    const ctrlTorque = f.thrustOn ? T * Math.sin(6 * DEG) * 0.45 * Lh : 0.004 * m * G0 * 0.45 * Lh;
    const aeroPerRad = f.q * f.rk.area * CN_ALPHA * 0.12 * Lh;
    // a returning booster falls engine-first (grid fins out) once it is coming down; otherwise nose-first
    const engineFirst = f.ap.landing && f.ap.program === 'land' && dot(surfaceVel(f), norm(f.r)) < 0;
    f.engineFirst = engineFirst;
    const stableDir = vaHat ? (engineFirst ? mul(vaHat, -1) : vaHat) : null;
    let want = f.cmd;
    f.alphaHold = 180;
    if (stableDir && aeroPerRad > 1) {
      f.alphaHold = Math.min(180, ctrlTorque / aeroPerRad / DEG);
      if (angle(want, stableDir) > f.alphaHold * DEG) want = rotateToward(stableDir, want, f.alphaHold * DEG);
    }
    // the nose swings more slowly in thick, fast air (the stable airframe resists turning)
    const slew = (f.thrustOn ? 10 : 4) / (1 + f.q / 15000) * DEG * dt * (f.liftedOff ? 1 : 0);
    f.att = f.liftedOff ? rotateToward(f.att, want, slew) : norm(f.r);
    if (T > 0) acc = add(acc, mul(f.att, T / m));

    // gravity with J2
    const z2 = (f.r[2] / r) ** 2, k = 1.5 * J2 * (RJ / r) ** 2;
    const gfac = -MU / (r ** 3);
    const grav = [gfac * f.r[0] * (1 + k * (1 - 5 * z2)), gfac * f.r[1] * (1 + k * (1 - 5 * z2)), gfac * f.r[2] * (1 + k * (3 - 5 * z2))];
    acc = add(acc, grav);

    // aerodynamics: drag (Mach-dependent, more at angle of attack) and normal force
    f.aoa = 0;
    if (vaHat && air.rho > 1e-12) {
      const alpha = angle(f.att, vaHat);
      const aero = f.engineFirst ? Math.min(alpha, Math.PI - alpha) : alpha;
      f.aoa = aero / DEG;
      const cd = f.rk.cd / 0.30 * cdMach(f.mach) * (1 + 2.5 * Math.sin(aero) ** 2);
      acc = add(acc, mul(vaHat, -f.q * cd * f.rk.area / m));
      const side = sub(f.att, mul(vaHat, dot(f.att, vaHat)));
      if (len(side) > 1e-6) acc = add(acc, mul(norm(side), f.q * f.rk.area * CN_ALPHA * Math.sin(aero) * Math.cos(aero) / m));
    }
    f.maxQ = Math.max(f.maxQ, f.q);
    f.g = len(sub(acc, grav)) / G0;

    // integrate (semi-implicit Euler); hold-down clamps keep the rocket on the pad until thrust beats weight
    if (!f.liftedOff) {
      const upAcc = dot(acc, norm(f.r)) + dot(earthVel(f.r), earthVel(f.r)) / r;
      if (upAcc > 0.2 && f.thrustOn) { f.liftedOff = true; note(f, 'Liftoff!', 'good'); }
      else { f.r = ecefToEci(f.siteEcef, theta(f)); f.v = earthVel(f.r); thermal(f, dt, 0, vAir, air); return; }
    }
    f.v = add(f.v, mul(acc, dt));
    f.r = add(f.r, mul(f.v, dt));

    thermal(f, dt, h, vAir, air);
    // fairing comes off once free-molecular heating is low enough for the payload (industry rule: < 1135 W/m²)
    if (f.fairing && f.ap.engaged && h > 90e3 && f.fmh < 1135) jettisonFairing(f);

    // limits
    if (f.q > 85000) return fail(f, `Structural breakup at ${(f.q / 1000).toFixed(0)} kPa dynamic pressure`);
    if (f.q > 5000 && f.q / 1000 * f.aoa > 260) return fail(f, `Structural breakup: ${f.aoa.toFixed(0)}° angle of attack at ${(f.q / 1000).toFixed(0)} kPa (side load too high)`);
    if (f.thrustOn && f.g > 12) return fail(f, `Vehicle overstressed at ${f.g.toFixed(1)} g`);
    if (f.skinT > 1000) {
      f.ended = true; f.burnedUp = true;
      f.outcome = f.deployed ? { ok: true, disposal: true } : { ok: false, reason: `Vehicle overheated (${Math.round(f.skinT - 273)}°C skin) and broke up` };
      note(f, f.deployed ? 'Stage re-entered and burned up over the ocean: controlled disposal complete.' : `✖ Aerodynamic heating destroyed the vehicle (${Math.round(f.skinT - 273)}°C).`, f.deployed ? 'good' : 'bad');
      return;
    }
    // ground contact
    if (alt(f) < 0 && f.t > 5) {
      const spd = len(surfaceVel(f));
      if (spd < 8) { f.ended = true; f.landed = true; f.outcome = { ok: f.deployed, landed: true, speed: spd }; note(f, `Touchdown at ${spd.toFixed(1)} m/s. ${f.deployed ? 'Stage recovered.' : 'Vehicle and payload recovered.'}`, 'good'); return; }
      return fail(f, `Impact at ${spd.toFixed(0)} m/s`);
    }
    if (f.t >= f.nextPath) { f.path.push(f.r.slice()); f.nextPath = f.t + (h < 100e3 ? 2 : 10); if (f.path.length > 3000) f.path.splice(0, 1); }
  }
  function fail(f, reason) { f.ended = true; f.outcome = { ok: false, reason }; note(f, `✖ ${reason}.`, 'bad'); }

  // Convert the flight state to Keplerian elements for the world simulation (keeps the altitude: the world uses the equatorial radius)
  function toElements(f, launchMs, worldMs) {
    const r = rmag(f), rr = alt(f) + ORB.RE, k = Math.sqrt(r / rr);
    return ORB.rv2coe(mul(norm(f.r), rr), mul(f.v, k), worldMs);
  }

  return {
    create, step, orbit, alt, mass, dvLeft, stage, jettisonFairing, surfaceVel, airVel, toElements, note, payloadDamage,
    local, dirFromPH, phFromDir, downrangeKm, theta, atmosphere, cdMach, ecefToEci, eciToEcef, R, MU, OMEGA,
    vec: { add, sub, mul, dot, cross, len, norm, angle, rotateToward },
  };
})();
