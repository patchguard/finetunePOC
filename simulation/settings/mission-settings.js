/* =========================================================================
   Mission settings panel on design.html: the game conditions the player picks
   before pressing Simulate. Saved immediately to localStorage["mbm.config"],
   which simulation.html reads (see simulation/HANDOFF.md). Changing any
   setting other than the agency name starts a new game on the next Simulate.

   Needs simulation/js/config.js (DEFAULT_CONFIG). Everything sits inside one
   function and every id/class starts with ms- so it can't clash with design.js.
   ========================================================================= */

(function MissionSettings() {
  const host = document.getElementById('mission-settings');
  if (!host || typeof DEFAULT_CONFIG === 'undefined') return;

  const KEY = 'mbm.config';
  const DIFF = {
    cadet: 'Cadet: more money, slower warming, fewer leaks',
    director: 'Director: the realistic middle ground',
    crisis: 'Crisis: tight money, fast warming, frequent leaks',
  };
  const EVENTS = { 0.5: 'Rare', 1: 'Normal', 1.8: 'Frequent' };
  const GAME_KEYS = ['durationYears', 'startDate', 'difficulty', 'startFunds', 'annualBudget', 'eventScale'];

  const read = () => { try { return { ...DEFAULT_CONFIG, ...(JSON.parse(localStorage.getItem(KEY) || '{}') || {}) }; } catch { return { ...DEFAULT_CONFIG }; } };
  const write = cfg => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* storage blocked */ } };
  // parseFloat drops only decimal zeros (2.50 → 2.5); the old regex also ate the 0 of 10 and showed $10M as $1M
  const money = n => n >= 1e6 ? '$' + parseFloat((n / 1e6).toFixed(2)) + 'M' : '$' + Math.round(n / 1000) + 'k';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // a game in progress in this browser?
  let game = null;
  try {
    const raw = localStorage.getItem('mbm.sim.save');
    if (raw) { const s = JSON.parse(raw); if (s && s.cfg && !s.ended) game = { cfg: s.cfg, year: (s.t - s.t0) / 31557600000 + 1 }; }
  } catch { /* ignore */ }

  const style = document.createElement('style');
  style.textContent = `
    #mission-settings .ms-row { display: flex; align-items: center; gap: 10px; }
    #mission-settings .ms-row input[type=range] { flex: 1; accent-color: #8de0d2; padding: 0; }
    #mission-settings .ms-val { min-width: 92px; text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }
    #mission-settings .ms-quick { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
    #mission-settings .ms-quick button { margin: 0; padding: 4px 10px; font-size: .85rem; background: #304461; color: #edf4ff; }
    #mission-settings .ms-quick button.ms-on { background: #8de0d2; color: #091121; }
    #mission-settings .ms-hint { font-size: .85rem; margin: 4px 0 0; }
    #mission-settings .ms-note { margin-top: 14px; padding: 10px 12px; border-radius: 10px; border: 1px solid #304461; font-size: .9rem; }
    #mission-settings .ms-note.ms-warn { border-color: #ffd27a; color: #ffd27a; }
    #mission-settings .ms-summary { margin-top: 12px; font-size: .9rem; color: #bac9df; }`;
  document.head.appendChild(style);

  const years = [];
  for (let y = 2026; y <= 2040; y++) years.push(y);
  host.innerHTML = `
    <h2>Mission settings</h2>
    <p class="muted ms-hint">The game conditions. Saved automatically and used when you press Simulate.</p>
    <label for="ms-agency">Agency name</label>
    <input id="ms-agency" maxlength="40">
    <label for="ms-years">Mission length</label>
    <div class="ms-row"><input type="range" id="ms-years" min="1" max="100" step="1"><span class="ms-val" id="ms-years-v"></span></div>
    <div class="ms-quick" id="ms-years-quick">${[10, 25, 50, 100].map(y => `<button type="button" data-y="${y}">${y} years</button>`).join('')}</div>
    <label for="ms-diff">Difficulty</label>
    <select id="ms-diff">${Object.entries(DIFF).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
    <label for="ms-funds">Starting funds</label>
    <div class="ms-row"><input type="range" id="ms-funds" min="250000" max="10000000" step="250000"><span class="ms-val" id="ms-funds-v"></span></div>
    <label for="ms-budget">Yearly budget from the government</label>
    <div class="ms-row"><input type="range" id="ms-budget" min="200000" max="3000000" step="100000"><span class="ms-val" id="ms-budget-v"></span></div>
    <p class="muted ms-hint">Paid monthly; it grows or shrinks with public support.</p>
    <label for="ms-start">Start year</label>
    <select id="ms-start">${years.map(y => `<option value="${y}">${y}</option>`).join('')}</select>
    <label for="ms-events">Random events (solar storms, budget votes, debris, super-emitters)</label>
    <select id="ms-events">${Object.entries(EVENTS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
    <div class="ms-summary" id="ms-summary"></div>
    <div class="ms-note" id="ms-note" hidden></div>
    <button type="button" class="secondary" id="ms-reset">Reset to defaults</button>`;

  const $ = id => document.getElementById(id);
  function fill(cfg) {
    $('ms-agency').value = cfg.agencyName || '';
    $('ms-years').value = cfg.durationYears;
    $('ms-diff').value = DIFF[cfg.difficulty] ? cfg.difficulty : 'director';
    $('ms-funds').value = cfg.startFunds;
    $('ms-budget').value = cfg.annualBudget;
    $('ms-start').value = new Date(cfg.startDate).getUTCFullYear();
    const ev = Object.keys(EVENTS).reduce((best, k) => Math.abs(k - cfg.eventScale) < Math.abs(best - cfg.eventScale) ? k : best, '1');
    $('ms-events').value = ev;
    show(cfg);
  }
  function collect() {
    const cfg = read();
    cfg.agencyName = $('ms-agency').value.trim() || DEFAULT_CONFIG.agencyName;
    cfg.durationYears = +$('ms-years').value;
    cfg.difficulty = $('ms-diff').value;
    cfg.startFunds = +$('ms-funds').value;
    cfg.annualBudget = +$('ms-budget').value;
    cfg.startDate = `${$('ms-start').value}-01-01T00:00:00Z`;
    cfg.eventScale = +$('ms-events').value;
    return cfg;
  }
  function show(cfg) {
    $('ms-years-v').textContent = `${cfg.durationYears} year${cfg.durationYears === 1 ? '' : 's'}`;
    $('ms-funds-v').textContent = money(cfg.startFunds);
    $('ms-budget-v').textContent = money(cfg.annualBudget) + '/yr';
    document.querySelectorAll('#ms-years-quick button').forEach(b => b.classList.toggle('ms-on', +b.dataset.y === +cfg.durationYears));
    const y0 = new Date(cfg.startDate).getUTCFullYear();
    $('ms-summary').innerHTML = `Your mission runs from <b>${y0}</b> to <b>${y0 + +cfg.durationYears}</b>. The final review measures what you achieve against the whole ${cfg.durationYears}-year mission.`;
    const note = $('ms-note');
    if (game) {
      const changed = GAME_KEYS.some(k => String(game.cfg[k] ?? DEFAULT_CONFIG[k]) !== String(cfg[k]));
      note.hidden = false;
      note.className = 'ms-note' + (changed ? ' ms-warn' : '');
      note.innerHTML = changed
        ? `⚠ These settings differ from your game in progress (year ${Math.floor(game.year)} of ${game.cfg.durationYears}). Pressing Simulate will start a <b>new game</b>.`
        : `You have a game in progress (year ${Math.floor(game.year)} of ${game.cfg.durationYears}). Pressing Simulate continues it. Changing these settings starts a new game instead.`;
    } else note.hidden = true;
  }
  function save() { const cfg = collect(); write(cfg); show(cfg); }

  ['ms-agency', 'ms-years', 'ms-diff', 'ms-funds', 'ms-budget', 'ms-start', 'ms-events'].forEach(id => $(id).addEventListener('input', save));
  document.querySelectorAll('#ms-years-quick button').forEach(b => b.addEventListener('click', () => { $('ms-years').value = b.dataset.y; save(); }));
  $('ms-reset').addEventListener('click', () => { const keep = read(); const cfg = { ...keep, ...DEFAULT_CONFIG }; write(cfg); fill(cfg); });

  // first visit: if a game is running, show its settings so pressing Simulate continues it
  let cfg = read();
  try { if (!localStorage.getItem(KEY) && game) cfg = { ...cfg, ...game.cfg }; } catch { /* ignore */ }
  fill(cfg);
  write(collect());
})();
