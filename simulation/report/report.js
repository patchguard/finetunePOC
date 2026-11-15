/* =========================================================================
   Mission: Blue Marble — mission report, shown on feedback.html when a
   simulation mission ends (time ran out, the player ended it, or game over).

   Reads localStorage["mbm.results"] written by simulation.html (see
   simulation/HANDOFF.md). Shows: verdict (success / partial / fail), how
   effective the mission was, money, satellites and other statistics, charts,
   and at the bottom the methane map at the start and at the end, plus a
   timelapse of the map changing (same colours and symbols as the game).

   Everything lives inside this one function so nothing clashes with
   feedback.html's own code. Needs: Leaflet, topojson-client,
   simulation/js/nasa/gibs.js and simulation/js/map-common.js.
   ========================================================================= */

(function BlueMarbleReport() {
  const params = new URLSearchParams(location.search);
  let R = null;
  try { R = JSON.parse(localStorage.getItem('mbm.results') || 'null'); } catch { R = null; }
  if (!R || params.get('view') === 'flight') return;
  // feedback.html also reports flights from its own design game; show ours when the simulation sent the player here,
  // or when there is nothing else to show, and otherwise offer a link
  let ownFlight = null;
  try { ownFlight = localStorage.getItem('methane-tycoon-lastflight'); } catch { /* ignore */ }
  const anchor = document.querySelector('.wrap > header') || document.body.firstElementChild;
  if (params.get('from') !== 'simulation' && ownFlight) {
    const bar = document.createElement('div');
    bar.className = 'bmr bmr-switch';
    bar.innerHTML = `🌍 You also have a <b>Mission: Blue Marble</b> report (${esc(R.gameEnd || '')}). <a href="?from=simulation">Open the mission report →</a>`;
    anchor.after(bar);
    return;
  }

  /* ---------- helpers ---------- */
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  const money = n => (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
  const moneyK = n => { const a = Math.abs(n), s = n < 0 ? '−$' : '$'; return a >= 1e6 ? s + (a / 1e6).toFixed(2) + 'M' : a >= 1e4 ? s + (a / 1e3).toFixed(0) + 'k' : s + Math.round(a).toLocaleString('en-US'); };
  const num = (n, d = 0) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
  const dataSize = mb => mb >= 1048576 ? (mb / 1048576).toFixed(1) + ' TB' : mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : Math.round(mb) + ' MB';
  const ymd = t => new Date(t).toISOString().slice(0, 10);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

  /* ---------- verdict ---------- */
  const C = R.climate || {}, ST = R.stats || {}, FI = R.finances || {};
  // Judged against the WHOLE planned mission: ending early (or doing nothing) can't look like a success.
  // without a single satellite the methane difference is random noise, not the player's doing
  const prevented = ST.launches ? (C.ch4ppbBusinessAsUsual || 0) - (C.ch4ppb || 0) : 0;
  const completion = R.completion != null ? R.completion : Math.min(1, (R.yearsPlayed || 0) / Math.max(0.5, R.durationYears || 1));
  const expectedRise = R.expectedRisePpb != null ? R.expectedRisePpb
    : (R.yearsPlayed > 0.25 ? ((C.ch4ppbBusinessAsUsual || 0) - (C.ch4ppbStart || 0)) / R.yearsPlayed * R.durationYears : 15 * R.durationYears);
  const effectiveness = (R.effectiveness != null ? R.effectiveness : Math.max(0, Math.min(1, prevented / Math.max(1, expectedRise)))) * 100;
  const gameOver = ['bankrupt', 'trust', 'tipping', 'lost'].includes(R.reason);
  const abandoned = R.reason === 'ended' && completion < 0.25;
  let verdict, cls;
  if (gameOver) { verdict = 'Mission failed'; cls = 'fail'; }
  else if (abandoned) { verdict = 'Mission abandoned'; cls = 'fail'; }
  // success: a good score AND a real dent in global methane over the planned mission
  else if (R.score >= 60 && (R.subscores || {}).climate >= 45 && effectiveness >= 8) { verdict = 'Mission success'; cls = 'success'; }
  else if (effectiveness >= 2 || R.score >= 40) { verdict = 'Partial success'; cls = 'partial'; }
  else { verdict = 'Mission failed'; cls = 'fail'; }
  const yearsLeft = Math.max(0, (R.durationYears || 0) - (R.yearsPlayed || 0));
  const reasonText = {
    complete: `The ${R.durationYears}-year mission ran its full course.`,
    ended: `You ended the mission after ${num(R.yearsPlayed, 1)} of ${R.durationYears} years.`,
    bankrupt: `The agency ran out of money and went bankrupt after ${num(R.yearsPlayed, 1)} of ${R.durationYears} years.`,
    trust: `Public support fell to zero and the Mission Director was removed after ${num(R.yearsPlayed, 1)} of ${R.durationYears} years.`,
    tipping: 'Global warming reached the +2.5°C tipping point.',
    lost: `Every satellite failed after ${num(R.yearsPlayed, 1)} of ${R.durationYears} years${(R.satellites || []).find(s => s.cause) ? ` (${(R.satellites || []).find(s => s.cause).cause})` : ''}, so the mission stopped.`,
  }[R.reason] || 'The mission ended.';
  const verdictWhy = cls === 'success'
    ? `Your satellites found the leaks that mattered and the world listened: methane ended ${num(prevented, 1)} ppb below where it would have been without you.`
    : abandoned
      ? `The mission stopped with ${num(yearsLeft, 1)} years still to go, before your satellites could make a real difference. Leak repairs and new rules take years to pay off, and the review measures what you achieved against the whole ${R.durationYears}-year mission.`
      : cls === 'partial'
        ? `You made a difference (${num(prevented, 1)} ppb less methane than the no-action world), but it was small compared with the ${num(expectedRise, 0)} ppb rise expected over the full mission${R.reason === 'ended' ? ', and the mission ended early' : ''}.`
        : gameOver ? 'The mission was cut short before it could change the outcome.' : 'Methane ended no lower than in a world without your agency.';

  /* ---------- page ---------- */
  const root = el('section', 'bmr');
  root.id = 'bmr';
  ['.steps', '.grid', '.note'].forEach(sel => document.querySelectorAll('.wrap > ' + sel).forEach(n => { n.style.display = 'none'; }));
  // the page header ("CurioFrontierX · NASA Space Apps 2026 …") belongs to feedback.html's own report; hide it here
  const header = document.querySelector('.wrap > header'); if (header) header.style.display = 'none';
  (header ? header.parentElement.firstElementChild : anchor).before(root);
  document.title = `Mission report · ${R.agencyName || 'Mission: Blue Marble'}`;

  const stars = n => `<span class="bmr-stars" aria-label="${n} of 5 stars">${'★'.repeat(n)}<span class="bmr-off">${'★'.repeat(5 - n)}</span></span>`;
  // navigation at the top: the Blue Marble logo goes home (like the game's top-left logo)
  root.append(el('nav', 'bmr-topbar', `<a class="bmr-home" href="index.html" title="Home"><span class="bmr-globe" aria-hidden="true">🌍</span> Blue Marble</a>
    <span class="bmr-navlinks"><a class="bmr-btn" href="simulation.html">🛰️ Look around the finished game</a><a class="bmr-btn primary" href="design.html">🔁 Play again</a></span>`));
  root.append(el('div', `bmr-panel bmr-hero ${cls}`, `
    <div>
      <div class="bmr-eyebrow">Mission: Blue Marble · ${esc(R.agencyName || '')} · ${esc(R.gameStart || '')} → ${esc(R.gameEnd || '')}</div>
      <div class="bmr-verdict">${verdict}</div>
      <p><b>${esc(reasonText)}</b> ${esc(verdictWhy)}</p>
      <p class="bmr-muted">Mission effectiveness: <b class="bmr-mono" style="color:var(--bmr-ink)">${effectiveness.toFixed(effectiveness < 1 && effectiveness > 0 ? 1 : 0)}%</b> of the ${num(expectedRise, 0)} ppb methane rise expected over the full ${R.durationYears}-year mission was prevented · mission completed: <b class="bmr-mono" style="color:var(--bmr-ink)">${(completion * 100).toFixed(0)}%</b> (${num(R.yearsPlayed, 1)} of ${R.durationYears} years).</p>
    </div>
    <div class="bmr-score"><div class="bmr-ring" style="--p:${R.score};--bmr-c:var(--bmr-${cls === 'success' ? 'good' : cls === 'partial' ? 'warn' : 'bad'})"><b>${R.score}</b><small>out of 100</small></div>
      ${stars(R.stars || 0)}<div class="bmr-rank">${esc(R.rank || '')}</div></div>`));

  /* ---------- effectiveness ---------- */
  const co2e = (ST.mtAvoided || 0) * 81; // 20-year global warming potential of methane ≈ 81
  const eff = el('div', 'bmr-panel', `<h2>How effective was the mission?</h2><p class="bmr-sub">Compared with a world where nobody launched methane satellites.</p>
    <div class="bmr-tiles">
      <div class="bmr-tile ${prevented > 0.05 ? 'good' : prevented < -0.05 ? 'bad' : ''}"><div class="bmr-k">Methane vs no-action world</div><div class="bmr-v">${Math.abs(prevented) < 0.05 ? 'no change' : (prevented > 0 ? '−' : '+') + num(Math.abs(prevented), 1) + ' ppb'}</div><div class="bmr-s">${num(C.ch4ppb, 1)} ppb now, ${num(C.ch4ppbBusinessAsUsual, 1)} without you</div></div>
      <div class="bmr-tile ${C.warmingAvoidedC > 0 ? 'good' : ''}"><div class="bmr-k">Warming avoided</div><div class="bmr-v">${num((C.warmingAvoidedC || 0) * 1000, 1)} m°C</div><div class="bmr-s">world now +${num(C.tempAnomalyC, 2)}°C above pre-industrial</div></div>
      <div class="bmr-tile ${ST.mtAvoided > 0 ? 'good' : ''}"><div class="bmr-k">Methane kept out of the air</div><div class="bmr-v">${num(ST.mtAvoided, 1)} Mt</div><div class="bmr-s">≈ ${num(co2e, 0)} Mt CO₂-equivalent (20-year)</div></div>
      <div class="bmr-tile"><div class="bmr-k">Leaks reported / repaired</div><div class="bmr-v">${num(ST.leaksDetected)} / ${num(ST.leaksFixed)}</div><div class="bmr-s">${num(ST.missedLeaks)} big leaks went unreported</div></div>
      <div class="bmr-tile"><div class="bmr-k">Emissions at the end</div><div class="bmr-v">${num(C.emissionsMtPerYear, 0)} Mt/yr</div><div class="bmr-s">all sources, natural included</div></div>
    </div>
    <h3 style="margin-top:18px">Score breakdown</h3><div class="bmr-subs" id="bmr-subs"></div>`);
  root.append(eff);
  const planYears = Math.max(0.5, R.durationYears || 1);
  const SUBS = [
    ['climate', 'Climate', '35%', v => `${num(Math.max(0, prevented), 1)} ppb less methane than the no-action world (full marks at 60 ppb).${v >= 60 ? ' A clear dent in global methane.' : v >= 30 ? ' A real but modest effect.' : ' Global methane barely changed because of the mission.'}`],
    ['detection', 'Leak detection', '20%', () => `${num(ST.leaksDetected)} leaks reported; full marks need about 60 per year over the whole ${R.durationYears}-year mission (${num(60 * planYears)}).`],
    ['science', 'Science', '15%', () => `${num(R.science)} science points from ${dataSize(ST.dataMB || 0)} of data; full marks need about 6,000 per planned year.`],
    ['trust', 'Public support', '15%', () => `${num(R.trust, 0)}% support at the end, counted for the ${(completion * 100).toFixed(0)}% of the mission you ran the agency.`],
    ['budget', 'Budget', '15%', () => ST.launches ? `${moneyK(FI.fundsRemaining || 0)} left at the end. Money kept while flying a mission counts, scaled by how much of the mission you completed.` : 'No satellites were deployed, so leftover money is not an achievement.'],
  ];

  const subs = R.subscores || {};
  eff.querySelector('#bmr-subs').innerHTML = SUBS.map(([k, label, w, why]) => { const v = subs[k] || 0; return `<div class="bmr-subrow"><div class="bmr-lbl"><b>${label}</b><small>${w} of the score</small></div><div class="bmr-bar"><i style="width:${v}%"></i></div><b class="bmr-mono" style="text-align:right">${v}</b><div class="bmr-why">${esc(why(v))}</div></div>`; }).join('');

  /* ---------- charts ---------- */
  const H = (R.history || []).filter(h => h && h.t);
  const charts = el('div', 'bmr-two');
  charts.append(chartPanel('Atmospheric methane (ppb)', [{ key: 'ch4', label: 'Your world', color: 'var(--bmr-s1)' }, { key: 'bau', label: 'No-action world', color: 'var(--bmr-s2)', dashed: true }], v => num(v, 1)));
  charts.append(chartPanel('Agency funds', [{ key: 'funds', label: 'Funds', color: 'var(--bmr-s1)' }], v => moneyK(v)));
  root.append(charts);

  function chartPanel(title, series, fmtY) {
    const p = el('div', 'bmr-panel bmr-chart', `<h3>${title}</h3>${series.length > 1 ? `<div class="bmr-legend">${series.map(s => `<span><i style="background:${s.color}${s.dashed ? ';background:repeating-linear-gradient(90deg,' + s.color + ' 0 4px,transparent 4px 7px)' : ''}"></i>${s.label}</span>`).join('')}</div>` : ''}<canvas></canvas><div class="bmr-tip"></div>`);
    requestAnimationFrame(() => drawChart(p.querySelector('canvas'), p.querySelector('.bmr-tip'), series, fmtY));
    return p;
  }
  function cssColor(c, node) { if (!c.startsWith('var(')) return c; return getComputedStyle(node).getPropertyValue(c.slice(4, -1)).trim() || '#3987e5'; }
  function drawChart(cv, tip, series, fmtY) {
    if (H.length < 2) { cv.replaceWith(el('p', 'bmr-muted', 'Not enough history to chart.')); return; }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth, Hh = cv.clientHeight;
    cv.width = W * dpr; cv.height = Hh * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr);
    const pad = { l: 64, r: 12, t: 8, b: 24 };
    const t0 = H[0].t, t1 = H[H.length - 1].t;
    let lo = Infinity, hi = -Infinity;
    series.forEach(s => H.forEach(h => { const v = h[s.key]; if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }));
    if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
    const span = hi - lo; lo -= span * 0.05; hi += span * 0.05;
    const X = t => pad.l + (t - t0) / (t1 - t0 || 1) * (W - pad.l - pad.r);
    const Y = v => pad.t + (1 - (v - lo) / (hi - lo)) * (Hh - pad.t - pad.b);
    const ink = 'rgba(200,215,240,.55)';
    function paint(hx) {
      g.clearRect(0, 0, W, Hh);
      g.font = '11px JetBrains Mono, monospace'; g.fillStyle = ink; g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 1;
      for (let k = 0; k <= 3; k++) { const v = lo + (hi - lo) * k / 3, y = Y(v); g.beginPath(); g.moveTo(pad.l, y); g.lineTo(W - pad.r, y); g.stroke(); g.fillText(fmtY(v), 4, y + 4); }
      const y0 = new Date(t0).getUTCFullYear(), y1 = new Date(t1).getUTCFullYear(), step = Math.max(1, Math.ceil((y1 - y0) / 6));
      for (let y = y0; y <= y1; y += step) { const t = Date.UTC(y, 0, 1); if (t >= t0) g.fillText(String(y), X(t) - 14, Hh - 6); }
      series.forEach(s => {
        g.strokeStyle = cssColor(s.color, cv); g.lineWidth = 2; g.setLineDash(s.dashed ? [5, 4] : []);
        g.beginPath(); let started = false;
        H.forEach(h => { const v = h[s.key]; if (v == null) return; const x = X(h.t), y = Y(v); started ? g.lineTo(x, y) : g.moveTo(x, y); started = true; });
        g.stroke(); g.setLineDash([]);
      });
      if (hx != null) { g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(hx, pad.t); g.lineTo(hx, Hh - pad.b); g.stroke(); }
    }
    paint();
    cv.addEventListener('mousemove', e => {
      const rect = cv.getBoundingClientRect(), x = e.clientX - rect.left;
      const t = t0 + (x - pad.l) / (W - pad.l - pad.r) * (t1 - t0);
      let best = H[0]; H.forEach(h => { if (Math.abs(h.t - t) < Math.abs(best.t - t)) best = h; });
      paint(X(best.t));
      tip.style.display = 'block'; tip.style.left = X(best.t) + 'px'; tip.style.top = (Y(best[series[0].key]) + 40) + 'px';
      tip.innerHTML = `<b>${ymd(best.t)}</b><br>${series.map(s => `${s.label}: ${best[s.key] != null ? fmtY(best[s.key]) : '—'}`).join('<br>')}`;
    });
    cv.addEventListener('mouseleave', () => { tip.style.display = 'none'; paint(); });
  }

  /* ---------- statistics ---------- */
  const sats = R.satellites || [];
  const grades = R.reportGrades || {};
  const gradeTxt = ['A', 'B', 'C', 'D', 'F'].filter(g => grades[g]).map(g => `${grades[g]}× ${g}`).join(' · ') || 'none';
  const spent = FI.totalSpent != null ? FI.totalSpent : null;
  root.append(el('div', 'bmr-panel', `<h2>Mission statistics</h2><p class="bmr-sub">${num(R.yearsPlayed, 1)} years played · difficulty: ${esc(R.difficulty || '')}</p>
    <div class="bmr-tiles">
      <div class="bmr-tile"><div class="bmr-k">Total money spent</div><div class="bmr-v">${spent != null ? moneyK(spent) : '—'}</div><div class="bmr-s">${spent != null ? money(spent) : 'not recorded in this save'}</div></div>
      <div class="bmr-tile"><div class="bmr-k">Total money received</div><div class="bmr-v">${FI.totalEarned != null ? moneyK(FI.totalEarned) : '—'}</div><div class="bmr-s">budget, grants and leak payments</div></div>
      <div class="bmr-tile"><div class="bmr-k">Funds at the end</div><div class="bmr-v">${moneyK(FI.fundsRemaining || 0)}</div><div class="bmr-s">started with ${moneyK(FI.startFunds || 0)}</div></div>
      <div class="bmr-tile"><div class="bmr-k">Satellites deployed</div><div class="bmr-v">${num(ST.launches)}</div><div class="bmr-s">${num(ST.satellitesActive)} still working at the end</div></div>
      <div class="bmr-tile ${ST.satsLost ? 'bad' : ''}"><div class="bmr-k">Satellites lost</div><div class="bmr-v">${num(ST.satsLost)}</div><div class="bmr-s">${num(ST.launchFailures)} launch failure${ST.launchFailures === 1 ? '' : 's'}</div></div>
      <div class="bmr-tile"><div class="bmr-k">Data downlinked</div><div class="bmr-v">${dataSize(ST.dataMB || 0)}</div><div class="bmr-s">${num(ST.scienceObs)} observations</div></div>
      <div class="bmr-tile"><div class="bmr-k">Monthly data reports</div><div class="bmr-v">${Object.values(grades).reduce((a, b) => a + b, 0)}</div><div class="bmr-s">${gradeTxt}</div></div>
      <div class="bmr-tile"><div class="bmr-k">Science points</div><div class="bmr-v">${num(R.science)}</div><div class="bmr-s">public support ${num(R.trust, 0)}% at the end</div></div>
    </div>`));

  /* ---------- money ---------- */
  const hbars = (items, color) => {
    if (!items || !items.length) return '<p class="bmr-muted">Not recorded in this save.</p>';
    const max = Math.max(...items.map(i => i.amount));
    return `<div class="bmr-hbars">${items.slice(0, 8).map(i => `<div class="bmr-hbar"><span>${esc(i.label)}</span><div class="bmr-bar"><i style="width:${(i.amount / max * 100).toFixed(1)}%;background:${color}"></i></div><span class="bmr-amt">${moneyK(i.amount)}</span></div>`).join('')}</div>`;
  };
  root.append(el('div', 'bmr-two', `<div class="bmr-panel"><h3>Where the money went</h3>${hbars(FI.spending, 'var(--bmr-s2)')}</div><div class="bmr-panel"><h3>Where the money came from</h3>${hbars(FI.income, 'var(--bmr-s1)')}</div>`));

  /* ---------- satellites + regions ---------- */
  const satRows = sats.map(s => `<tr><td>${esc(s.name)}</td><td>${s.status === 'active' ? '<span class="bmr-good">working</span>' : `<span class="bmr-bad">${esc(s.status)}</span>`}</td><td class="bmr-num">${s.altKm} km · ${s.incDeg}°</td><td class="bmr-num">${num(s.detections)}</td><td class="bmr-num">${dataSize(s.dataMB || 0)}</td><td class="bmr-num">${s.designScore}</td><td class="bmr-num">${esc(s.launched || '')}</td></tr>`).join('');
  const regionsPanel = el('div', 'bmr-panel', '<h3>Countries: where the mission made a difference</h3><div class="bmr-scroll" id="bmr-regions"><p class="bmr-muted">Loading country names…</p></div>');
  root.append(el('div', 'bmr-two', `<div class="bmr-panel"><h3>Satellites</h3>${sats.length ? `<div class="bmr-scroll"><table class="bmr-table"><tr><th>Name</th><th>Status</th><th class="bmr-num">Orbit</th><th class="bmr-num">Leaks</th><th class="bmr-num">Data</th><th class="bmr-num">Design</th><th class="bmr-num">Launched</th></tr>${satRows}</table></div>` : '<p class="bmr-muted">No satellites reached orbit.</p>'}</div>`));
  root.lastElementChild.append(regionsPanel);

  /* ---------- maps: start vs end, and the timelapse ---------- */
  const MF = R.mapFrames;
  const maps = el('div', 'bmr-panel', `<h2>The methane map: before and after</h2>
    <p class="bmr-sub">The same map as the Methane Emissions tab: country colours and site circles come from the game, on NASA Blue Marble imagery (GIBS).</p>
    <div class="bmr-controls">
      <span class="bmr-muted">Colour countries by</span><div class="bmr-seg" data-ctl="choro"><button data-v="emissions" class="bmr-on">Methane emissions</button><button data-v="trend">Change since the start</button></div>
      <span class="bmr-muted">Show sites by</span><div class="bmr-seg" data-ctl="sites"><button data-v="source" class="bmr-on">Source (cause)</button><button data-v="amount">Amount</button></div>
    </div>
    <div class="bmr-maps"><div class="bmr-mapbox"><div class="bmr-map" id="bmr-map-start"></div><div class="bmr-maplabel" id="bmr-lbl-start"></div></div>
      <div class="bmr-mapbox"><div class="bmr-map" id="bmr-map-end"></div><div class="bmr-maplabel" id="bmr-lbl-end"></div></div></div>
    <h3 style="margin-top:20px">Timelapse</h3>
    <div class="bmr-mapbox"><div class="bmr-map bmr-big" id="bmr-map-tl"></div><div class="bmr-maplabel" id="bmr-lbl-tl"></div></div>
    <div class="bmr-player"><button class="bmr-btn primary" id="bmr-play">▶ Play</button><div class="bmr-seg" id="bmr-speed"><button data-v="2">Slow</button><button data-v="6" class="bmr-on">Normal</button><button data-v="15">Fast</button></div>
      <input type="range" id="bmr-slider" min="0" value="0" aria-label="Timelapse position"></div>
    <div class="bmr-mono bmr-date" id="bmr-date"></div>
    <div class="bmr-legendbox" id="bmr-legend"></div>`);
  root.append(maps);


  if (!MF || !MF.frames || !MF.frames.length) {
    maps.querySelector('.bmr-maps').replaceWith(el('p', 'bmr-muted', 'This mission was saved before map snapshots were recorded, so there is no before-and-after map. Play a new mission to see it.'));
    maps.querySelectorAll('.bmr-mapbox, .bmr-player, .bmr-controls, h3').forEach(n => n.remove());
    loadNamesOnly();
    return;
  }
  if (typeof L === 'undefined' || typeof MAPC === 'undefined') { maps.append(el('p', 'bmr-muted', 'The map library could not load (no internet connection?).')); loadNamesOnly(); return; }

  const frames = MF.frames, first = frames[0], last = frames[frames.length - 1];
  const isoIndex = new Map(MF.countries.map((iso, i) => [iso, i]));
  let choro = 'emissions', siteMode = 'source', tl = 0, playing = false, timer = null, fps = 6;

  function countryValue(frame, iso) {
    const i = isoIndex.get(iso); if (i == null) return null;
    const v = frame.c[i];
    if (choro === 'trend') { const v0 = first.c[i]; return v0 > 0 ? (v / v0 - 1) * 100 : null; }
    return v;
  }
  function makeMap(id, frame, labelId, labelTitle) {
    // one whole world fills the map (fractional zoom), so it never repeats sideways
    const m = L.map(id, { worldCopyJump: true, zoomSnap: 0.25, minZoom: 0.5, maxZoom: 7, zoomControl: false, attributionControl: true });
    m.fitBounds([[-58, -170], [80, 180]]);
    L.control.zoom({ position: 'topright' }).addTo(m);
    NASA_GIBS.leafletLayer('bluemarble').addTo(m);
    m.createPane('countries').style.zIndex = 350;
    const state = { map: m, frame, countries: null, sites: [], labelId, labelTitle };
    state.siteLayer = L.layerGroup().addTo(m);
    MF.sites.forEach((s, i) => {
      const c = L.circleMarker([s.lat, s.lon], { radius: 5, weight: 2, fillOpacity: 0.8 }).addTo(state.siteLayer);
      c.bindTooltip(() => siteTip(state.frame, i));
      state.sites.push(c);
    });
    return state;
  }
  function siteTip(frame, i) {
    const s = MF.sites[i], t = MF.types[s.type] || { label: s.type };
    return `<b>${esc(s.name)}</b><br>${esc(t.label)}<br>≈ ${num(frame.s[i])} t/h total (${(frame.s[i] * 8.766e-3).toFixed(2)} Mt/yr)<br>${num(frame.l[i], 1)} t/h from active leaks`;
  }
  function styleCountries(state) {
    if (!state.countries) return;
    state.countries.setStyle(f => {
      const v = countryValue(state.frame, +f.id);
      const col = MAPC.rampColor(choro, v);
      return { stroke: true, color: 'rgba(200,220,255,.28)', weight: 0.6, fillColor: col || '#000', fillOpacity: col ? 0.62 : 0 };
    });
  }
  function styleSites(state) {
    const fr = state.frame;
    state.sites.forEach((c, i) => {
      const s = MF.sites[i], t = MF.types[s.type] || { color: '#999' };
      c.setRadius(MAPC.siteRadius(siteMode, fr.l[i], fr.s[i]));
      c.setStyle({ color: MAPC.RING[fr.r[i]] || '#fff', fillColor: siteMode === 'amount' ? MAPC.rampColor('site', fr.s[i]) : t.color, fillOpacity: siteMode === 'amount' ? 0.85 : 0.75 });
    });
  }
  function label(state) {
    const fr = state.frame;
    document.getElementById(state.labelId).innerHTML = `<b>${state.labelTitle}${state.labelTitle ? ' · ' : ''}${ymd(fr.t)}</b>CH₄ ${num(fr.ch4, 1)} ppb · ${fr.dT != null ? '+' + num(fr.dT, 2) + '°C' : ''}`;
  }
  function refresh(state) { styleCountries(state); styleSites(state); label(state); }

  const views = [makeMap('bmr-map-start', first, 'bmr-lbl-start', 'Start'), makeMap('bmr-map-end', last, 'bmr-lbl-end', R.reason === 'complete' ? 'End' : 'End (mission stopped)'), makeMap('bmr-map-tl', first, 'bmr-lbl-tl', '')];
  // the before / after maps move together
  let syncing = false;
  const [vs, ve] = views;
  [[vs, ve], [ve, vs]].forEach(([a, b]) => a.map.on('move', () => { if (syncing) return; syncing = true; b.map.setView(a.map.getCenter(), a.map.getZoom(), { animate: false }); syncing = false; }));
  views.forEach(refresh);

  MAPC.loadCountries().then(features => {
    views.forEach(v => {
      v.countries = L.geoJSON({ type: 'FeatureCollection', features: MAPC.cloneFeatures(features) }, { pane: 'countries', interactive: true,
        onEachFeature: (f, layer) => layer.bindTooltip(() => countryTip(v.frame, f), { sticky: true }) }).addTo(v.map);
      styleCountries(v);
    });
    renderRegions(features);
  }).catch(() => { document.getElementById('bmr-regions').innerHTML = '<p class="bmr-muted">Country borders could not load (no internet connection?).</p>'; renderRegions([]); });

  function countryTip(frame, f) {
    const i = isoIndex.get(+f.id);
    if (i == null) return `<b>${esc(f.properties.name)}</b><br>Small emitter, not tracked individually`;
    const v = frame.c[i], v0 = first.c[i];
    return `<b>${esc(f.properties.name)}</b><br>${num(v, 1)} Mt CH₄/yr · ${v >= v0 ? '+' : '−'}${num(Math.abs(v / v0 - 1) * 100, 0)}% vs the start`;
  }

  // controls
  maps.querySelectorAll('[data-ctl] button').forEach(b => b.addEventListener('click', () => {
    const seg = b.parentElement; seg.querySelectorAll('button').forEach(x => x.classList.toggle('bmr-on', x === b));
    if (seg.dataset.ctl === 'choro') choro = b.dataset.v; else siteMode = b.dataset.v;
    views.forEach(refresh); legend();
  }));
  function legend() {
    const sitesLeg = siteMode === 'amount' ? MAPC.legendHTML('site') + '<div style="margin-top:4px">Regional emissions plus active leaks; bigger and brighter = more methane.</div>'
      : `<div class="title">Site source</div>${Object.values(MF.types).map(t => `<span style="margin-right:10px"><span class="bmr-dot" style="background:${t.color}"></span>${esc(t.label)}</span>`).join('')}<div style="margin-top:4px">Size = active leak flow.</div>`;
    document.getElementById('bmr-legend').innerHTML = `<div>${MAPC.legendHTML(choro)}</div><div>${sitesLeg}<div style="margin-top:4px">Ring: <span style="color:${MAPC.RING.r}">red</span> big unreported leak · <span style="color:${MAPC.RING.b}">blue</span> reported, awaiting repair · <span style="color:${MAPC.RING.g}">green</span> repaired.</div></div>`;
  }
  legend();

  // timelapse
  const slider = document.getElementById('bmr-slider'), playBtn = document.getElementById('bmr-play'), dateEl = document.getElementById('bmr-date');
  slider.max = frames.length - 1;
  const tlView = views[2];
  function showFrame(k) {
    tl = Math.max(0, Math.min(frames.length - 1, k));
    tlView.frame = frames[tl];
    refresh(tlView);
    slider.value = tl;
    const f = frames[tl], i0 = first;
    dateEl.textContent = `${ymd(f.t)} · ${(tl + 1)}/${frames.length} · CH₄ ${num(f.ch4, 1)} ppb (${f.ch4 >= i0.ch4 ? '+' : '−'}${num(Math.abs(f.ch4 - i0.ch4), 1)})`;
  }
  function stop() { playing = false; clearInterval(timer); playBtn.textContent = '▶ Play'; }
  function play() {
    if (tl >= frames.length - 1) showFrame(0);
    playing = true; playBtn.textContent = '⏸ Pause';
    clearInterval(timer);
    timer = setInterval(() => { if (tl >= frames.length - 1) { stop(); return; } showFrame(tl + 1); }, 1000 / fps);
  }
  playBtn.addEventListener('click', () => playing ? stop() : play());
  slider.addEventListener('input', () => { stop(); showFrame(+slider.value); });
  document.querySelectorAll('#bmr-speed button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#bmr-speed button').forEach(x => x.classList.toggle('bmr-on', x === b));
    fps = +b.dataset.v; if (playing) play();
  }));
  showFrame(0);
  // Leaflet maps created while the page was still laying out need a size refresh
  setTimeout(() => views.forEach(v => { v.map.invalidateSize(); if (v !== views[1]) v.map.fitBounds([[-58, -170], [80, 180]]); }), 200);
  // test hook: ?from=simulation&tl=<frame> jumps the timelapse, &tlplay=1 starts it
  // test hooks: &choro=trend, &sites=amount preset the map modes
  if (params.get('choro')) { const b = maps.querySelector(`[data-ctl="choro"] [data-v="${params.get('choro')}"]`); if (b) b.click(); }
  if (params.get('sites')) { const b = maps.querySelector(`[data-ctl="sites"] [data-v="${params.get('sites')}"]`); if (b) b.click(); }
  if (params.get('tl')) showFrame(+params.get('tl'));
  if (params.get('tlplay')) play();

  /* ---------- regions table ---------- */
  function loadNamesOnly() { if (typeof MAPC !== 'undefined') MAPC.loadCountries().then(renderRegions).catch(() => renderRegions([])); else renderRegions([]); }
  function renderRegions(features) {
    const names = new Map((features || []).map(f => [+f.id, f.properties.name]));
    const rg = (R.regions || []).slice();
    const box = document.getElementById('bmr-regions');
    if (!rg.length) { box.innerHTML = '<p class="bmr-muted">Not recorded in this save.</p>'; return; }
    rg.sort((a, b) => (a.changePct - (a.noActionMt / a.startMt - 1) * 100) - (b.changePct - (b.noActionMt / b.startMt - 1) * 100));
    box.innerHTML = `<table class="bmr-table"><tr><th>Country</th><th class="bmr-num">Now (Mt/yr)</th><th class="bmr-num">Change</th><th class="bmr-num">Without you</th><th class="bmr-num">Policy cut</th><th class="bmr-num">Leaks</th></tr>${rg.map(x => {
      const bau = (x.noActionMt / x.startMt - 1) * 100;
      return `<tr><td>${esc(names.get(x.iso) || 'Country ' + x.iso)}</td><td class="bmr-num">${num(x.emissionsMt, 1)}</td><td class="bmr-num ${x.changePct < 0 ? 'bmr-good' : 'bmr-bad'}">${x.changePct > 0 ? '+' : ''}${num(x.changePct, 0)}%</td><td class="bmr-num bmr-muted">${bau > 0 ? '+' : ''}${num(bau, 0)}%</td><td class="bmr-num">${num(x.policyCutPct, 0)}%</td><td class="bmr-num">${num(x.leaksReported)}</td></tr>`;
    }).join('')}</table><p class="bmr-muted" style="font-size:12px;margin:8px 0 0">The 25 biggest emitters, sorted by how much better they did than in the no-action world.</p>`;
  }
})();
