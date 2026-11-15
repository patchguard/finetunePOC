/* =========================================================================
   Design page additions (step 1): the summary in the action bar, feedback
   carried over from the last mission, "focus a part" links from the
   Feedback page (design.html?focus=detector) and the My designs library.
   Uses the globals of assets/design.js (readForm, applyForm, BUDGET) and
   assets/parts.js (OPTIONS, RATINGS, LABELS).
   ========================================================================= */
(function DesignPage() {
  const BM = window.BlueMarble;
  const esc = BM.esc;
  const money = n => '$' + Math.round(n).toLocaleString('en-US');
  const el = id => document.getElementById(id);
  const CATS = ['battery', 'thruster', 'storage', 'transmitter', 'detector'];
  const partOf = (cat, id) => OPTIONS[cat].find(o => o.id === id) || {};

  /* ---------- summary in the sticky action bar ---------- */
  function summary() {
    const cfg = readForm();
    const cost = CATS.reduce((s, k) => s + (partOf(k, cfg[k]).cost || 0), 0);
    const missing = missingParts(cfg);
    const overall = Math.round(CATS.reduce((s, k) => s + (RATINGS[k][cfg[k]] || 0), 0) / CATS.length);
    const left = BUDGET - cost;
    const site = partOf('site', cfg.site);
    el('designSummary').innerHTML = `
      <span>🛰️ <b>${esc(cfg.missionName)}</b></span>
      <span>Parts <b class="mono">${money(cost)}</b></span>
      <span>Left <b class="mono ${left < 0 ? 'bad' : 'ok'}">${left < 0 ? '−' : ''}${money(Math.abs(left))}</b></span>
      <span>${missing.length ? `Parts chosen <b class="mono">${5 - missing.length}/5</b>` : `Overall <b class="mono" style="color:${overall >= 75 ? 'var(--good)' : overall >= 50 ? 'var(--warn)' : 'var(--fail)'}">${overall}%</b>`}</span>
      <span>📍 ${esc(site.name || '')}</span>`;
  }
  [...CATS, 'site'].forEach(k => el(k).addEventListener('change', summary));
  // Mission settings saves "Starting funds" on every input: refresh the Funds left pill and the summary right after
  const refreshBudget = () => setTimeout(() => { update(); summary(); }, 0);
  el('mission-settings').addEventListener('input', refreshBudget);
  el('mission-settings').addEventListener('click', e => { if (e.target.closest('button')) refreshBudget(); });
  el('missionName').addEventListener('input', summary);
  summary();

  /* ---------- jump to a part (from the Feedback page or a lesson) ---------- */
  function focusField(field) {
    const target = field === 'mission-settings' ? el('mission-settings') : el(field);
    if (!target) return;
    const box = field === 'mission-settings' ? target : target;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    box.classList.remove('focus-flash'); void box.offsetWidth; box.classList.add('focus-flash');
    setTimeout(() => box.classList.remove('focus-flash'), 3400);
    if (target.tagName === 'SELECT') setTimeout(() => target.focus({ preventScroll: true }), 400);
  }

  /* ---------- feedback carried over from the last mission ---------- */
  const st = BM.state();
  const cleared = st.results && (BM.readJSON(BM.KEYS.cleared) || {}).sig === BM.resultsSig(st.results);
  if (st.results && !cleared) {
    const runInfo = BM.recordRun(st.results);
    const flown = runInfo && runInfo.run.design;
    const lessons = (window.BlueMarbleLessons ? BlueMarbleLessons(st.results, flown || readForm()) : []).slice(0, 3);
    const carry = el('carry');
    carry.hidden = false;
    carry.innerHTML = `
      <div class="panel-head">
        <h2 style="margin:0">↺ What your last mission taught you</h2>
        <span style="display:flex;gap:8px;align-items:center"><span class="pill ${st.results.score >= 60 ? 'good' : st.results.score >= 40 ? 'warn' : 'bad'}" title="Score of your last mission">Last mission: ${st.results.score} · ${esc(st.results.rank || '')}</span>
        <button class="secondary small" id="carryHide" style="margin:0" title="Hide the last mission's feedback">✕</button></span>
      </div>
      <p class="small" style="margin:6px 0 0">${flown ? `Flown design: <b>${esc(flown.missionName)}</b>. ` : ''}Change the parts below, then simulate again to beat your score. <a href="feedback.html?from=simulation">Full debrief →</a></p>
      <div class="lessons">${lessons.map(l => `
        <div class="lesson"><span class="i" aria-hidden="true">${l.icon}</span><div>
          <b class="lt">${esc(l.title)}</b><p>${l.text}</p>
          <button class="secondary small" data-focus="${l.field}">Change ${esc(l.field === 'mission-settings' ? 'mission settings' : (LABELS[l.field] || l.field).toLowerCase())} →</button>
        </div></div>`).join('')}</div>`;
    carry.querySelectorAll('[data-focus]').forEach(b => b.onclick = () => focusField(b.dataset.focus));
    el('carryHide').onclick = () => { BM.writeJSON(BM.KEYS.cleared, { sig: BM.resultsSig(st.results), at: Date.now() }); carry.hidden = true; };
  }
  const focus = new URLSearchParams(location.search).get('focus');
  if (focus) setTimeout(() => focusField(focus), 350);

  /* ---------- My designs library ---------- */
  const LIB = BM.KEYS.library;
  const lib = () => BM.readJSON(LIB) || [];
  function renderLib() {
    const list = lib();
    const runs = BM.readJSON(BM.KEYS.runs) || [];
    el('library').innerHTML = list.length ? list.map((d, i) => {
      const overall = Math.round(CATS.reduce((s, k) => s + (RATINGS[k][d.cfg[k]] || 0), 0) / CATS.length);
      const cost = CATS.reduce((s, k) => s + (partOf(k, d.cfg[k]).cost || 0), 0);
      // only flights of exactly this build (same name and same parts), so a deleted and re-saved design starts clean
      const flights = runs.filter(r => r.design && r.design.missionName === d.cfg.missionName && CATS.every(k => r.design[k] === d.cfg[k]) && r.at >= Date.parse(d.created || 0));
      const best = flights.length ? Math.max(...flights.map(r => r.score)) : null;
      return `<div class="lib-row">
        <span class="name">${esc(d.cfg.missionName)}</span>
        <span class="meta">${CATS.map(k => esc(partOf(k, d.cfg[k]).name || '?').replace(/\s*\(.*?\)/g, '')).join(' · ')}<br>
          ${money(cost)} · overall ${overall}%${best != null ? ` · best score <b>${best}</b> (${flights.length} flight${flights.length > 1 ? 's' : ''})` : ''} · saved ${new Date(d.savedAt).toLocaleDateString()}</span>
        <button class="small" data-load="${i}">Load</button>
        <button class="secondary small" data-del="${i}" title="Remove from My designs">✕</button></div>`;
    }).join('') : '<p class="muted small" style="margin:0">No saved designs yet. Save a build to compare it with later iterations.</p>';
    el('library').querySelectorAll('[data-load]').forEach(b => b.onclick = () => {
      const d = lib()[+b.dataset.load]; if (!d) return;
      applyForm(d.cfg); summary(); if (typeof checkWeather === 'function') checkWeather();
      el('libNote').textContent = `Loaded “${d.cfg.missionName}”.`;
    });
    el('library').querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      const list2 = lib(); const [gone] = list2.splice(+b.dataset.del, 1);
      BM.writeJSON(LIB, list2); renderLib();
      el('libNote').textContent = gone ? `Removed “${gone.cfg.missionName}”.` : '';
    });
  }
  el('saveNamedBtn').onclick = () => {
    const cfg = readForm();
    if (missingParts(cfg).length) { el('libNote').textContent = 'Choose all five parts before saving the design.'; return; }
    const old = lib().find(d => d.cfg.missionName === cfg.missionName);
    const list = lib().filter(d => d.cfg.missionName !== cfg.missionName);
    const now = new Date().toISOString();
    list.unshift({ cfg, savedAt: now, created: old ? (old.created || '1970-01-01') : now });
    BM.writeJSON(LIB, list.slice(0, 12));
    el('libNote').textContent = `Saved “${cfg.missionName}”. Rename the mission to keep several versions.`;
    renderLib();
  };
  renderLib();
  // 🗑 Clear all: saved designs, flight history and the last mission's feedback (the running game is kept)
  let clearArmed = false;
  el('clearLibBtn').onclick = () => {
    const b = el('clearLibBtn');
    if (!clearArmed) { clearArmed = true; b.textContent = 'Click again to clear designs and scores'; setTimeout(() => { clearArmed = false; b.textContent = '🗑 Clear all'; }, 4000); return; }
    clearArmed = false; b.textContent = '🗑 Clear all';
    BM.writeJSON(LIB, []); BM.writeJSON(BM.KEYS.runs, []);
    const r = BM.readJSON(BM.KEYS.results);
    if (r) BM.writeJSON(BM.KEYS.cleared, { sig: BM.resultsSig(r), at: Date.now() });
    el('carry').hidden = true;
    renderLib();
    el('libNote').textContent = 'Cleared saved designs, scores and last-mission feedback.';
  };


})();
