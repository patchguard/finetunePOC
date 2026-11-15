/* =========================================================================
   Orbital mechanics (pure functions, SI units, no DOM)
   - Keplerian elements with J2 secular drift (node regression, apsidal motion)
   - ECI <-> ECEF via GMST, low-precision solar ephemeris, cylindrical eclipse
   - Exponential atmosphere (Vallado table) with a solar-cycle factor
   ========================================================================= */

const ORB = (() => {
  const MU = 3.986004418e14;      // m^3/s^2
  const RE = 6378137;             // equatorial radius, m
  const J2 = 1.08262668e-3;
  const OMEGA_E = 7.2921159e-5;   // rad/s
  const G0 = 9.80665;
  const DEG = Math.PI / 180;
  const TAU = Math.PI * 2;

  /* ---------- vectors ---------- */
  const v = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: a => Math.hypot(a[0], a[1], a[2]),
    norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  };
  const wrap = a => ((a % TAU) + TAU) % TAU;
  const wrapPi = a => { a = wrap(a); return a > Math.PI ? a - TAU : a; };

  /* ---------- time ---------- */
  const julian = ms => ms / 86400000 + 2440587.5;
  function gmst(ms) {
    const d = julian(ms) - 2451545.0;
    return wrap((280.46061837 + 360.98564736629 * d) * DEG);
  }
  // Low-precision Sun direction in ECI (Astronomical Almanac, ~0.01°)
  function sunDir(ms) {
    const n = julian(ms) - 2451545.0;
    const L = (280.460 + 0.9856474 * n) * DEG;
    const g = (357.528 + 0.9856003 * n) * DEG;
    const lam = L + (1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG;
    const eps = (23.439 - 0.0000004 * n) * DEG;
    return [Math.cos(lam), Math.cos(eps) * Math.sin(lam), Math.sin(eps) * Math.sin(lam)];
  }

  /* ---------- elements ---------- */
  function solveKepler(M, e) {
    let E = e < 0.8 ? M : Math.PI;
    for (let k = 0; k < 30; k++) {
      const f = E - e * Math.sin(E) - M;
      const d = f / (1 - e * Math.cos(E));
      E -= d;
      if (Math.abs(d) < 1e-12) break;
    }
    return E;
  }
  const meanMotion = a => Math.sqrt(MU / (a * a * a));
  const period = a => TAU / meanMotion(a);

  // el = { a, e, i, raan, argp, M, epoch(ms) }
  function coe2rv(el) {
    const { a, e, i, raan, argp, M } = el;
    const E = solveKepler(wrap(M), e);
    const cosE = Math.cos(E), sinE = Math.sin(E);
    const r = a * (1 - e * cosE);
    const nu = Math.atan2(Math.sqrt(1 - e * e) * sinE, cosE - e);
    const p = a * (1 - e * e);
    const xp = r * Math.cos(nu), yp = r * Math.sin(nu);
    const h = Math.sqrt(MU * p);
    const vxp = -MU / h * Math.sin(nu), vyp = MU / h * (e + Math.cos(nu));
    const cO = Math.cos(raan), sO = Math.sin(raan), ci = Math.cos(i), si = Math.sin(i), cw = Math.cos(argp), sw = Math.sin(argp);
    const R11 = cO * cw - sO * sw * ci, R12 = -cO * sw - sO * cw * ci;
    const R21 = sO * cw + cO * sw * ci, R22 = -sO * sw + cO * cw * ci;
    const R31 = sw * si, R32 = cw * si;
    return {
      r: [R11 * xp + R12 * yp, R21 * xp + R22 * yp, R31 * xp + R32 * yp],
      v: [R11 * vxp + R12 * vyp, R21 * vxp + R22 * vyp, R31 * vxp + R32 * vyp],
      nu,
    };
  }

  function rv2coe(r, vel, epoch) {
    const rm = v.len(r), vm = v.len(vel);
    const h = v.cross(r, vel), hm = v.len(h);
    const nvec = [-h[1], h[0], 0], nm = Math.hypot(nvec[0], nvec[1]);
    const evec = v.sub(v.mul(r, vm * vm / MU - 1 / rm), v.mul(vel, v.dot(r, vel) / MU));
    let e = v.len(evec);
    const energy = vm * vm / 2 - MU / rm;
    const a = -MU / (2 * energy);
    const i = Math.acos(Math.max(-1, Math.min(1, h[2] / hm)));
    let raan = nm > 1e-9 ? Math.acos(Math.max(-1, Math.min(1, nvec[0] / nm))) : 0;
    if (nvec[1] < 0) raan = TAU - raan;
    let argp, nu;
    if (e < 1e-7) { // circular: measure from node
      e = 0; argp = 0;
      nu = nm > 1e-9 ? Math.acos(Math.max(-1, Math.min(1, v.dot(nvec, r) / (nm * rm)))) : Math.atan2(r[1], r[0]);
      if (r[2] < 0) nu = TAU - nu;
    } else {
      argp = nm > 1e-9 ? Math.acos(Math.max(-1, Math.min(1, v.dot(nvec, evec) / (nm * e)))) : Math.atan2(evec[1], evec[0]);
      if (evec[2] < 0) argp = TAU - argp;
      nu = Math.acos(Math.max(-1, Math.min(1, v.dot(evec, r) / (e * rm))));
      if (v.dot(r, vel) < 0) nu = TAU - nu;
    }
    const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
    const M = wrap(E - e * Math.sin(E));
    return { a, e, i, raan: wrap(raan), argp: wrap(argp), M, epoch };
  }

  // J2 secular rates (rad/s)
  function j2Rates(el) {
    const n = meanMotion(el.a);
    const p = el.a * (1 - el.e * el.e);
    const k = 1.5 * n * J2 * (RE / p) ** 2;
    const ci = Math.cos(el.i);
    return { raan: -k * ci, argp: 0.5 * k * (5 * ci * ci - 1), M: n + 0.5 * k * Math.sqrt(1 - el.e * el.e) * (3 * ci * ci - 1) };
  }

  function propagate(el, ms) {
    const dt = (ms - el.epoch) / 1000;
    const r = j2Rates(el);
    return { ...el, raan: wrap(el.raan + r.raan * dt), argp: wrap(el.argp + r.argp * dt), M: wrap(el.M + r.M * dt), epoch: ms };
  }

  function eciToEcef(r, theta) {
    const c = Math.cos(theta), s = Math.sin(theta);
    return [c * r[0] + s * r[1], -s * r[0] + c * r[1], r[2]];
  }
  function ecefToLatLon(p) {
    const lon = Math.atan2(p[1], p[0]);
    const lat = Math.atan2(p[2], Math.hypot(p[0], p[1]));
    return { lat: lat / DEG, lon: lon / DEG, alt: v.len(p) - RE };
  }
  function latLonToUnit(lat, lon) {
    const la = lat * DEG, lo = lon * DEG;
    return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  }

  // State at time ms: ECI position/velocity, ECEF unit sub-point, lat/lon
  function stateAt(el0, ms) {
    const el = propagate(el0, ms);
    const { r, v: vel } = coe2rv(el);
    const ecef = eciToEcef(r, gmst(ms));
    const ll = ecefToLatLon(ecef);
    return { el, r, v: vel, ecef, unit: v.norm(ecef), lat: ll.lat, lon: ll.lon, alt: v.len(r) - RE };
  }

  // Cylindrical Earth shadow
  function inEclipse(r, sun) {
    const proj = v.dot(r, sun);
    if (proj > 0) return false;
    const perp = v.len(v.sub(r, v.mul(sun, proj)));
    return perp < RE;
  }
  // Fraction of a circular orbit spent in Earth's shadow, from beta angle
  function eclipseFraction(a, beta) {
    const h = a - RE;
    const bstar = Math.asin(RE / a);
    if (Math.abs(beta) >= bstar) return 0;
    return Math.acos(Math.sqrt(h * h + 2 * RE * h) / (a * Math.cos(beta))) / Math.PI;
  }
  function betaAngle(el, sun) {
    const nrm = [Math.sin(el.raan) * Math.sin(el.i), -Math.cos(el.raan) * Math.sin(el.i), Math.cos(el.i)];
    return Math.asin(Math.max(-1, Math.min(1, v.dot(nrm, sun))));
  }

  // Minimum angle (rad) from unit vector q to the great-circle arc p1→p2, and where along it (0..1)
  function arcDistance(p1, p2, q) {
    const n = v.cross(p1, p2);
    const nl = v.len(n);
    const d1 = Math.acos(Math.max(-1, Math.min(1, v.dot(p1, q))));
    const d2 = Math.acos(Math.max(-1, Math.min(1, v.dot(p2, q))));
    if (nl < 1e-12) return d1 < d2 ? { d: d1, f: 0, cross: d1 } : { d: d2, f: 1, cross: d2 };
    const nn = v.mul(n, 1 / nl);
    const cross = Math.asin(Math.max(-1, Math.min(1, v.dot(nn, q))));
    // foot of perpendicular
    const foot = v.norm(v.sub(q, v.mul(nn, v.dot(nn, q))));
    const arc = Math.acos(Math.max(-1, Math.min(1, v.dot(p1, p2))));
    const a1 = Math.acos(Math.max(-1, Math.min(1, v.dot(p1, foot))));
    const a2 = Math.acos(Math.max(-1, Math.min(1, v.dot(p2, foot))));
    if (Math.abs(a1 + a2 - arc) < 1e-6) return { d: Math.abs(cross), f: a1 / arc, cross };
    return d1 < d2 ? { d: d1, f: 0, cross: Math.sign(cross) * d1 } : { d: d2, f: 1, cross: Math.sign(cross) * d2 };
  }

  // Max Earth-central angle for a ground station to see a satellite above an elevation mask
  function visibilityAngle(alt, minElevDeg = 10) {
    const eps = minElevDeg * DEG;
    return Math.acos(RE / (RE + alt) * Math.cos(eps)) - eps;
  }

  /* ---------- atmosphere ---------- */
  // [base altitude km, density kg/m3, scale height km] (Vallado, Table 8-4)
  const ATM = [
    [0, 1.225, 7.249], [25, 3.899e-2, 6.349], [30, 1.774e-2, 6.682], [40, 3.972e-3, 7.554], [50, 1.057e-3, 8.382],
    [60, 3.206e-4, 7.714], [70, 8.770e-5, 6.549], [80, 1.905e-5, 5.799], [90, 3.396e-6, 5.382], [100, 5.297e-7, 5.877],
    [110, 9.661e-8, 7.263], [120, 2.438e-8, 9.473], [130, 8.484e-9, 12.636], [140, 3.845e-9, 16.149], [150, 2.070e-9, 22.523],
    [180, 5.464e-10, 29.740], [200, 2.789e-10, 37.105], [250, 7.248e-11, 45.546], [300, 2.418e-11, 53.628], [350, 9.518e-12, 53.298],
    [400, 3.725e-12, 58.515], [450, 1.585e-12, 60.828], [500, 6.967e-13, 63.822], [600, 1.454e-13, 71.835], [700, 3.614e-14, 88.667],
    [800, 1.170e-14, 124.64], [900, 5.245e-15, 181.05], [1000, 3.019e-15, 268.00],
  ];
  function density(altM, solarFactor = 1) {
    const h = altM / 1000;
    if (h < 0) return 1.225;
    let row = ATM[0];
    for (const r of ATM) { if (h >= r[0]) row = r; else break; }
    const rho = row[1] * Math.exp(-(h - row[0]) / row[2]);
    // the thermosphere swells with solar activity; below ~90 km it doesn't
    return h > 90 ? rho * solarFactor : rho;
  }
  // 11-year solar cycle multiplier for thermospheric density (solar max ≈ 2.4×, min ≈ 0.45×)
  function solarFactor(ms) {
    const years = (ms - Date.UTC(2025, 0, 1)) / (365.25 * 86400000); // cycle 25 max ≈ 2025
    return 1.35 + 1.0 * Math.cos(TAU * years / 11);
  }

  // Semi-major axis decay rate (m/s) for a near-circular orbit
  function decayRate(a, cdAOverM, solar) {
    const rho = density(a - RE, solar);
    return -Math.sqrt(MU * a) * rho * cdAOverM;
  }

  // Radiation (krad/yr behind ~2 mm Al) — rough LEO model; inner belt / SAA grows fast with altitude
  function doseRate(altKm, incDeg) {
    const base = 0.08 * Math.exp((altKm - 400) / 260);
    const polar = incDeg > 60 ? 1.3 : 1.0;
    return base * polar;
  }

  const circSpeed = a => Math.sqrt(MU / a);
  // Δv for a two-burn Hohmann transfer between circular orbits
  function hohmann(a1, a2) {
    const at = (a1 + a2) / 2;
    const dv1 = Math.abs(Math.sqrt(MU / a1) * (Math.sqrt(a2 / at) - 1));
    const dv2 = Math.abs(Math.sqrt(MU / a2) * (1 - Math.sqrt(a1 / at)));
    return { dv1, dv2, total: dv1 + dv2, time: Math.PI * Math.sqrt(at ** 3 / MU) };
  }
  // Inclination of a sun-synchronous orbit at altitude h (m)
  function ssoInclination(h) {
    const a = RE + h;
    const target = TAU / (365.2422 * 86400);
    const k = 1.5 * meanMotion(a) * J2 * (RE / a) ** 2;
    return Math.acos(Math.max(-1, Math.min(1, -target / k)));
  }

  // Local mean solar time (hours) at a longitude given the Sun direction
  function localSolarTime(lonDeg, ms) {
    const s = sunDir(ms);
    const sunRa = Math.atan2(s[1], s[0]);
    const lonInertial = lonDeg * DEG + gmst(ms);
    return ((wrap(lonInertial - sunRa) / TAU) * 24 + 12) % 24;
  }
  function sunElevation(lat, lon, ms) {
    const s = eciToEcef(sunDir(ms), gmst(ms));
    return Math.asin(Math.max(-1, Math.min(1, v.dot(latLonToUnit(lat, lon), s)))) / DEG;
  }

  return {
    MU, RE, J2, OMEGA_E, G0, DEG, TAU, v, wrap, wrapPi, julian, gmst, sunDir, solveKepler, meanMotion, period,
    coe2rv, rv2coe, j2Rates, propagate, eciToEcef, ecefToLatLon, latLonToUnit, stateAt, inEclipse,
    eclipseFraction, betaAngle, arcDistance, visibilityAngle, density, solarFactor, decayRate, doseRate,
    circSpeed, hohmann, ssoInclination, localSolarTime, sunElevation,
  };
})();

if (typeof module !== 'undefined') module.exports = ORB;
