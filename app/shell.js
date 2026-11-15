/* =========================================================================
   Mission: Blue Marble — app shell shared by every page.

   The game is one loop:   1 Design  →  2 Simulate  →  3 Feedback  ↺
   This file draws the app bar (the loop as a stepper, plus NASA Data) and
   works out where the player is in the loop from localStorage, which is how
   the pages already talk to each other (see simulation/HANDOFF.md):

     cfx.design.v1   the satellite design sent to the simulation (design.html)
     mbm.sim.save    the running / finished simulation (simulation.html)
     mbm.results     the final results of the last mission (feedback.html)
     bm.seen         { sig, at }: when the player last read that report
     bm.runs         one entry per finished mission, for comparing iterations

   Usage: <nav id="appbar" data-step="design|simulate|feedback|home|data"></nav>
   then load this script right after it. Anything with [data-appbar-extra]
   is moved to the right side of the bar.
   Everything is inside one function; the only global is window.BlueMarble.
   ========================================================================= */
(function BlueMarbleShell() {
  const PAGES = {
    home: 'index.html',
    design: 'design.html',
    simulate: 'simulation.html',
    feedback: 'feedback.html?from=simulation',
    data: 'hotspots.html',
  };
  const KEYS = { design: 'cfx.design.v1', save: 'mbm.sim.save', results: 'mbm.results', seen: 'bm.seen', runs: 'bm.runs', library: 'bm.library', cleared: 'bm.cleared' };

  const readJSON = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
  const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const resultsSig = r => r ? [r.finishedAt, r.agencyName, r.gameStart, r.gameEnd, r.score, r.reason].join('|') : '';

  // Where is the player in the loop?
  function state() {
    const design = readJSON(KEYS.design);
    let sim = null;
    const s = readJSON(KEYS.save);
    if (s && s.cfg) {
      const years = s.t && s.t0 ? (s.t - s.t0) / 31557600000 : 0;
      sim = {
        ended: !!s.ended,
        year: Math.min(Math.floor(years) + 1, s.cfg.durationYears || 1),
        years: s.cfg.durationYears,
        funds: s.funds,
        satellites: Array.isArray(s.satellites) ? s.satellites.filter(x => x && x.status === 'active').length : 0,
      };
    }
    const results = readJSON(KEYS.results);
    const seen = readJSON(KEYS.seen);
    const reportRead = !!(results && seen && seen.sig === resultsSig(results));
    // the design was changed after the player read the last report: they are iterating
    const redesigned = !!(reportRead && design && design.savedAt && Date.parse(design.savedAt) > (seen.at || 0));
    let next;
    if (!design) next = 'design';
    else if (sim && !sim.ended) next = 'simulate';
    else if (results && !reportRead) next = 'feedback';
    else if (results && !redesigned) next = 'design';
    else next = 'simulate';
    return { design, sim, results, reportRead, redesigned, next };
  }

  function stepInfo(st) {
    const d = st.design, sim = st.sim, r = st.results;
    return [
      {
        key: 'design', n: 1, title: 'Design', href: PAGES.design,
        sub: d ? (st.reportRead && !st.redesigned ? 'Improve it ↺' : d.missionName || 'Saved design') : 'Start here',
        done: !!d && !(st.reportRead && !st.redesigned), live: false,
      },
      {
        key: 'simulate', n: 2, title: 'Simulate', href: PAGES.simulate,
        sub: sim && !sim.ended ? `Year ${sim.year} of ${sim.years}` : sim && sim.ended ? 'Mission ended' : d ? 'Ready to launch' : 'Needs a design',
        done: !!(sim && sim.ended), live: !!(sim && !sim.ended),
      },
      {
        key: 'feedback', n: 3, title: 'Feedback', href: PAGES.feedback,
        sub: r ? `Score ${r.score} · ${'★'.repeat(r.stars || 0) || '☆'}` : sim && !sim.ended ? 'Decision log' : 'After the mission',
        done: st.reportRead, live: false,
      },
    ];
  }

  function render() {
    const host = document.getElementById('appbar');
    if (!host) return;
    const page = host.dataset.step || '';
    const st = state();
    const steps = stepInfo(st);
    host.className = 'ab';
    host.setAttribute('aria-label', 'Mission steps');
    const extras = [...document.querySelectorAll('[data-appbar-extra]')];
    host.innerHTML = `
      <a class="ab-brand" href="${PAGES.home}" title="Mission: Blue Marble home"><span class="ab-globe" aria-hidden="true">🌍</span><span>Blue Marble</span></a>
      <ol class="ab-steps">
        ${steps.map((s, i) => `
          ${i ? '<li class="ab-sep" aria-hidden="true">›</li>' : ''}
          <li><a class="ab-step ${s.key === page ? 'on' : ''} ${s.done ? 'done' : ''} ${s.live ? 'live' : ''} ${st.next === s.key && s.key !== page ? 'next' : ''}"
               href="${s.href}" ${s.key === page ? 'aria-current="step"' : ''} title="Step ${s.n}: ${s.title}${st.next === s.key ? ' (next step)' : ''}">
            <span class="ab-n">${s.done && s.key !== page ? '✓' : s.n}</span>
            <span class="ab-t"><b>${s.title}</b><small>${esc(s.sub)}</small></span></a></li>`).join('')}
        <li><a class="ab-loop" href="${PAGES.design}" title="Close the loop: take the feedback back to the design" aria-label="Back to Design">↺</a></li>
      </ol>
      <div class="ab-right">
        <a class="ab-link ${page === 'data' ? 'on' : ''}" href="${PAGES.data}" title="Explore real NASA methane data and imagery">📡 <span>NASA Data</span></a>
      </div>`;
    const right = host.querySelector('.ab-right');
    extras.forEach(x => { x.classList.add('ab-extra'); right.prepend(x); });
  }

  // Record a finished mission once, with the design that flew it, so iterations can be compared.
  function recordRun(results) {
    if (!results) return null;
    const sig = resultsSig(results);
    // the player cleared their designs and scores: don't bring this mission back into the history
    if ((readJSON(KEYS.cleared) || {}).sig === sig) return null;
    const runs = readJSON(KEYS.runs) || [];
    let run = runs.find(r => r.sig === sig);
    if (!run) {
      run = {
        sig, at: Date.now(), score: results.score, stars: results.stars, rank: results.rank, reason: results.reason,
        subscores: results.subscores || {}, difficulty: results.difficulty, durationYears: results.durationYears,
        yearsPlayed: results.yearsPlayed, effectiveness: results.effectiveness, design: readJSON(KEYS.design),
      };
      runs.push(run);
      writeJSON(KEYS.runs, runs.slice(-20));
    }
    return { run, runs: readJSON(KEYS.runs) || runs, index: runs.indexOf(run) };
  }
  function markSeen(results) { if (results) writeJSON(KEYS.seen, { sig: resultsSig(results), at: Date.now() }); }

  window.BlueMarble = { PAGES, KEYS, readJSON, writeJSON, esc, state, render, recordRun, markSeen, resultsSig };
  render();
  // another tab (e.g. the simulation) changed the game: refresh the bar
  window.addEventListener('storage', e => { if (!e.key || Object.values(KEYS).includes(e.key)) render(); });
})();
