/* =========================================================================
   Feedback page (step 3). simulation/report/report.js draws the mission
   report; this file closes the loop around it:
     - "Take it back to Design": advice from app/lessons.js, each with a link
       that opens the Design page on the part to change (design.html?focus=…)
     - Iterations: every finished mission with the design that flew it
     - Decision log: each choice with the explanation before and the result after
     - an empty state while no mission has ended yet
   ========================================================================= */
(function FeedbackPage() {
  const BM = window.BlueMarble;
  const esc = BM.esc;
  const el = id => document.getElementById(id);
  const st = BM.state();
  const R = st.results;
  const CATS = ['battery', 'thruster', 'storage', 'transmitter', 'detector', 'site'];
  const partName = (cat, id) => { const p = (OPTIONS[cat] || []).find(o => o.id === id); return p ? p.name.replace(/\s*\(.*?\)/g, '') : id; };

  /* ---------- no finished mission yet ---------- */
  if (!R) {
    const e = el('empty'); e.hidden = false; e.classList.add('empty');
    if (st.sim && !st.sim.ended) {
      e.innerHTML = `<div class="big-ico" aria-hidden="true">🛰️</div><h2>Your mission is still flying</h2>
        <p>Year ${st.sim.year} of ${st.sim.years}. The full report appears here when the mission ends — when time runs out, or when you press
        <b>🏁 End mission &amp; get feedback</b> in the simulation. Meanwhile, every decision so far is explained below.</p>
        <div class="btn-row"><a class="btn go" href="simulation.html">▶ Back to the simulation</a><a class="btn ghost" href="design.html">🔧 Adjust the design</a></div>`;
    } else {
      e.innerHTML = `<div class="big-ico" aria-hidden="true">📈</div><h2>No mission report yet</h2>
        <p>Design a satellite and fly a mission first. Your debrief — verdict, climate impact and design advice — appears here when it ends.</p>
        <div class="btn-row">${st.design ? '<a class="btn go" href="simulation.html">🚀 Go to the simulation</a>' : '<a class="btn go" href="design.html">🔧 Design a satellite</a>'}</div>`;
    }
  }

  /* ---------- close the loop ---------- */
  let runInfo = null;
  if (R) {
    runInfo = BM.recordRun(R) || { run: { design: BM.readJSON(BM.KEYS.design) }, runs: [], index: 0 };
    BM.markSeen(R);
    BM.render(); // the step bar now shows the report as read and Design as the next step
    const flown = runInfo.run.design;
    const lessons = BlueMarbleLessons(R, flown || {}).slice(0, 4);
    const p = el('loop-panel'); p.hidden = false;
    p.innerHTML = `
      <div class="panel-head"><h2 style="margin:0">↺ Take it back to Design</h2>
        <span class="muted small">Iteration ${runInfo.index + 1}${runInfo.runs.length > 1 ? ` of ${runInfo.runs.length}` : ''}</span></div>
      ${flown ? `<p class="small" style="margin:8px 0 0">Design that flew: <b>${esc(flown.missionName)}</b></p>
        <div class="flown">${CATS.map(k => `<span class="pill" data-part="${k}" title="${esc(LABELS[k])}">${esc(partName(k, flown[k]))}</span>`).join('')}</div>` : ''}
      <div id="designErrors"></div>
      <div class="lessons">${lessons.map(l => `
        <div class="lesson"><span class="i" aria-hidden="true">${l.icon}</span><div>
          <div class="area">${esc(l.area)}</div><b class="lt">${esc(l.title)}</b><p>${l.text}</p>
          <a class="btn small ghost" href="design.html?focus=${encodeURIComponent(l.field)}">Fix in Design →</a></div></div>`).join('')}</div>
      <div class="btn-row">
        <a class="btn go" href="design.html">🔧 Improve the design</a>
        <a class="btn ghost" href="simulation.html" title="Opening the simulation after a finished mission starts a new game with your saved design">🚀 Fly the same design again</a>
        <a class="btn ghost" href="#decisions-panel">📜 Decision log</a>
      </div>`;
    // design errors (the engine's own rules), marked on the parts that caused them
    if (flown && window.BlueMarbleCheck) BlueMarbleCheck(flown).then(res => {
      if (!res) return;
      // after a failed mission, the notes about lifetime (battery, thruster, power) explain what went wrong, so show them too
      const lost = R.reason === 'lost';
      // what actually broke in flight counts as a design problem too (e.g. a battery that wears out before the mission ends)
      const flight = window.BlueMarbleFlightIssues ? BlueMarbleFlightIssues(R, flown) : [];
      const bad = [...flight, ...res.issues.filter(i => i.level !== 'info' || (lost && ['battery', 'engine', 'power'].includes(i.cat)))];
      CATS.forEach(k => {
        const mine = bad.filter(i => i.field === k), pill = p.querySelector(`[data-part="${k}"]`);
        if (!pill || !mine.length) return;
        const fail = mine.some(i => i.level === 'fail');  // (info items only appear here after a failed mission)
        pill.className = 'pill ' + (fail ? 'fail-solid' : 'warn');
        pill.textContent = (fail ? '⛔ ' : '⚠ ') + pill.textContent;
        pill.title = mine.map(i => i.text).join(' ');
      });
      const scoreBox = `<div class="score"><span class="muted small">Design score</span><br><b style="color:${res.score >= 70 ? 'var(--good)' : res.score >= 45 ? 'var(--warn)' : 'var(--fail)'}">${res.score}</b><span class="muted">/100</span></div>`;
      if (!bad.length) {
        el('designErrors').innerHTML = `<div class="panel check-panel ok" style="margin-top:12px;padding:14px"><div class="check-head"><span class="big" aria-hidden="true">✅</span>
          <div><h2>No design errors</h2><p class="small" style="margin:2px 0 0">Checked with the simulation's engineering rules (power, mass, pointing, data, budget). The result comes from how the mission was flown and the quality of the parts.</p></div>${scoreBox}</div></div>`;
        return;
      }
      const fails = bad.filter(i => i.level === 'fail').length;
      el('designErrors').innerHTML = `<div class="panel check-panel ${fails ? 'fail' : 'warn'}" style="margin-top:12px;padding:14px">
        <div class="check-head"><span class="big" aria-hidden="true">${fails ? '⛔' : '⚠️'}</span><div><h2>${fails ? `${fails} design problem${fails > 1 ? 's' : ''} ${flight.length ? 'caused the failure' : 'hurt this mission'}` : (lost ? `${bad.length} design issue${bad.length > 1 ? 's' : ''} behind the failure` : `${bad.length} design warning${bad.length > 1 ? 's' : ''}`)}</h2>
        <p class="small" style="margin:2px 0 0">Fix these first: they cost performance on every mission, however well you play.</p></div>
        <div class="score"><span class="muted small">Design score</span><br><b style="color:${res.score >= 70 ? 'var(--good)' : res.score >= 45 ? 'var(--warn)' : 'var(--fail)'}">${res.score}</b><span class="muted">/100</span></div></div>
        <div class="issues">${bad.map(i => `<div class="issue ${i.level}"><span class="tag">${i.flight ? 'FAILED IN FLIGHT' : i.level === 'fail' ? 'ERROR' : i.level === 'warn' ? 'WARNING' : 'LIKELY CAUSE'}</span>
          <div><b>${esc(i.text)}</b><small>${esc(i.why)}</small></div>
          <a class="btn small ghost" href="design.html?focus=${i.field}">Fix in Design →</a></div>`).join('')}</div></div>`;

      if (flight.length) { // the rules alone looked fine, but the part failed in flight: don't show the score as good
        const sc = el('designErrors').querySelector('.score');
        if (sc) { sc.querySelector('.muted').textContent = 'Rules score'; sc.querySelector('b').style.color = 'var(--fail)'; sc.title = 'Score from the engineering rules only; the flight showed a part that does not last the mission.'; }
      }
    });
    // put the loop right under the verdict, before the long statistics
    const hero = document.querySelector('.bmr-hero');
    if (hero) hero.after(p);
  }

  /* ---------- iterations ---------- */
  const runs = BM.readJSON(BM.KEYS.runs) || [];
  if (runs.length) {
    const p = el('runs-panel'); p.hidden = false;
    const curSig = R ? BM.resultsSig(R) : '';
    const sub = (r, k) => (r.subscores || {})[k] ?? '–';
    p.innerHTML = `<div class="panel-head"><h2 style="margin:0">📊 Your iterations</h2><span class="muted small">Every finished mission in this browser</span></div>
      <div class="table-scroll"><table class="runs"><thead><tr><th>#</th><th>Design</th><th>Score</th><th>Δ</th><th>Climate</th><th>Detection</th><th>Science</th><th>Trust</th><th>Budget</th><th>Mission</th></tr></thead><tbody>
      ${runs.map((r, i) => {
        const d = i ? r.score - runs[i - 1].score : null;
        return `<tr class="${r.sig === curSig ? 'current' : ''}"><td>${i + 1}</td><td class="name">${esc(r.design ? r.design.missionName : '—')}${r.sig === curSig ? ' <span class="pill accent">this report</span>' : ''}</td>
          <td><b>${r.score}</b> <span class="stars">${'★'.repeat(r.stars || 0)}</span></td>
          <td class="delta ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d == null ? '' : (d > 0 ? '+' : '') + d}</td>
          <td>${sub(r, 'climate')}</td><td>${sub(r, 'detection')}</td><td>${sub(r, 'science')}</td><td>${sub(r, 'trust')}</td><td>${sub(r, 'budget')}</td>
          <td>${esc(r.difficulty || '')} · ${r.yearsPlayed ?? '?'}/${r.durationYears ?? '?'} y</td></tr>`;
      }).join('')}</tbody></table></div>`;
    const bmr = document.getElementById('bmr');
    if (bmr) bmr.after(p); // after the report, before the decision log
  }

  /* ---------- decision log ---------- */
  const decisions = (R && Array.isArray(R.decisions) && R.decisions.length ? R.decisions : BM.readJSON('mbm.decisions')) || [];
  if (decisions.length) {
    const ICON = { design: '🔧', 'launch-booked': '📅', launch: '🚀', satellite: '🛰️', debris: '☄️', budget: '💰' };
    const types = [...new Set(decisions.map(d => d.type))];
    const p = el('decisions-panel'); p.hidden = false;
    p.innerHTML = `<div class="panel-head"><h2 style="margin:0">📜 Decision log</h2><span class="muted small">${decisions.length} choices · what each one meant before, and what happened after</span></div>
      <div class="chips" role="group" aria-label="Filter decisions"><button class="chip on" data-type="">All</button>${types.map(t => `<button class="chip" data-type="${esc(t)}">${ICON[t] || '•'} ${esc(t.replace('-', ' '))}</button>`).join('')}</div>
      <div class="decisions" id="dec-list"></div>`;
    const list = el('dec-list');
    const draw = type => {
      list.innerHTML = decisions.slice().reverse().filter(d => !type || d.type === type).map(d => `
        <details class="dec"><summary><span aria-hidden="true">${ICON[d.type] || '•'}</span><span class="date">${esc(d.date || '')}</span><span class="t">${esc(d.title)}</span></summary>
          <div class="ba"><div><h4>Before: the trade-off</h4>${esc(d.before || '—')}</div><div><h4>After: what happened</h4>${esc(d.after || 'Still playing out.')}</div></div></details>`).join('');
    };
    p.querySelectorAll('.chip').forEach(c => c.onclick = () => { p.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === c)); draw(c.dataset.type); });
    draw('');
  }
})();
