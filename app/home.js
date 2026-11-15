// Home page: shows the next step in the loop and the status of each step.
(function Home() {
  const BM = window.BlueMarble;
  const st = BM.state();
  const esc = BM.esc;
  const money = n => '$' + Math.round(n || 0).toLocaleString('en-US');

  const NEXT = {
    design: st.results && st.reportRead
      ? { k: 'Next: iterate', h: 'Improve your satellite', p: `Your last mission scored <b>${st.results.score}</b>. The debrief lists what to change; open the builder and fly a better design.`, href: 'design.html', btn: '🔧 Improve the design' }
      : { k: 'Step 1', h: 'Design your first satellite', p: 'Pick the parts, set the mission conditions and check the launch weather. It takes about two minutes.', href: 'design.html', btn: '🚀 Start mission' },
    simulate: st.sim && !st.sim.ended
      ? { k: 'Mission in progress', h: `Year ${st.sim.year} of ${st.sim.years}`, p: `${st.sim.satellites} satellite${st.sim.satellites === 1 ? '' : 's'} in orbit · ${money(st.sim.funds)} in the bank. Your game is saved; pick up where you left off.`, href: 'simulation.html', btn: '▶ Continue the simulation' }
      : { k: 'Step 2', h: `Launch ${esc(st.design ? st.design.missionName : 'your satellite')}`, p: 'Your design is ready. Book a launch, fly it to orbit and start hunting methane leaks.', href: 'simulation.html', btn: '🚀 Go to simulation' },
    feedback: { k: 'Step 3 · new report', h: 'Your mission debrief is ready', p: st.results ? `Score <b>${st.results.score}</b> · ${esc(st.results.rank || '')}. See what worked, what didn't, and what to change.` : '', href: 'feedback.html?from=simulation', btn: '📈 Read the feedback' },
  }[st.next];

  const card = document.getElementById('next-card');
  const hasProgress = st.design || st.sim || st.results;
  card.innerHTML = `<div class="k">${NEXT.k}</div><h2>${NEXT.h}</h2><p>${NEXT.p}</p>
    <a class="btn go big" href="${NEXT.href}">${NEXT.btn}</a>
    ${hasProgress ? `<div class="reset"><span>Want a clean start?</span><button class="secondary small" id="reset-btn">Reset all progress</button></div>` : ''}`;

  // two-click reset (no browser dialogs)
  const rb = document.getElementById('reset-btn');
  if (rb) {
    let armed = false;
    rb.onclick = () => {
      if (!armed) { armed = true; rb.textContent = 'Click again to erase designs, game and reports'; rb.classList.add('warn'); setTimeout(() => { armed = false; rb.textContent = 'Reset all progress'; }, 4000); return; }
      try {
        Object.keys(localStorage).filter(k => /^(cfx\.design|mbm\.|bm\.)/.test(k)).forEach(k => localStorage.removeItem(k));
        sessionStorage.removeItem('mbm.view');
      } catch { /* storage blocked */ }
      location.reload();
    };
  }

  // status pill on each loop card
  const status = {
    design: st.design ? ['good', '✓ ' + (st.design.missionName || 'Saved')] : ['accent', 'Start here'],
    simulate: st.sim && !st.sim.ended ? ['warn', `● Year ${st.sim.year}/${st.sim.years}`] : st.sim && st.sim.ended ? ['good', '✓ Mission ended'] : st.design ? ['accent', 'Ready'] : ['', 'Needs a design'],
    feedback: st.results ? [st.reportRead ? 'good' : 'warn', `${st.reportRead ? '✓' : 'New'} · score ${st.results.score}`] : ['', 'After the mission'],
  };
  document.querySelectorAll('.loop-card').forEach(c => {
    const [cls, txt] = status[c.dataset.step];
    const p = c.querySelector('[data-status]');
    p.className = 'pill ' + cls; p.textContent = txt;
    c.classList.toggle('is-next', c.dataset.step === st.next);
  });
})();
