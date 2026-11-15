/* =========================================================================
   Design check: runs the simulation's own engineering rules
   (simulation/js/design.js → DESIGN.compute) on a design from the Design
   page, without running the simulation. Gives the same errors (fail),
   warnings (warn) and notes (info) the satellite will suffer in orbit.

   The engine files declare globals (e.g. LAUNCH_SITES) that clash with the
   Design page's own scripts, so they are loaded into a private scope.
   Only global: window.BlueMarbleCheck(design) → Promise<{ score, issues, comp }>
   ========================================================================= */
(function () {
  // assets/parts.js id → simulation/js/catalog.js id (same table as simulation/js/design-input.js)
  const ID_MAP = {
    battery: { liion40: 'li40', liion100: 'li100' },
    thruster: { coldgas: 'cold', resistojet: 'resisto', electrospray: 'espray', dualmode: 'dual' },
    storage: { a3200: 'nanomind' }, transmitter: {}, detector: {},
  };
  // engine issue category → the Design page field that fixes it
  const FIELD = { battery: 'battery', power: 'battery', engine: 'thruster', comms: 'transmitter', storage: 'storage', detector: 'detector', frame: 'battery', budget: 'battery' };
  const FILES = ['simulation/js/orbit.js', 'simulation/js/catalog.js', 'simulation/js/design.js'];
  let engine = null;
  function load() {
    if (!engine) engine = Promise.all(FILES.map(f => fetch(f).then(r => { if (!r.ok) throw new Error(f + ' ' + r.status); return r.text(); })))
      .then(src => new Function(src.join('\n;\n') + '\n;return { DESIGN, ALL_PARTS };')())
      .catch(e => { console.warn('Design check unavailable:', e.message); engine = null; return null; });
    return engine;
  }
  window.BlueMarbleCheck = async function (design) {
    const E = await load();
    if (!E || !design) return null;
    const parts = {};
    for (const cat of Object.keys(ID_MAP)) {
      const raw = design[cat]; if (!raw) continue;
      const id = ID_MAP[cat][raw] || raw;
      if (E.ALL_PARTS[id]) parts[id] = (parts[id] || 0) + 1;
    }
    const comp = E.DESIGN.compute(parts);
    const issues = comp.issues.map(i => ({ ...i, field: FIELD[i.cat] || 'battery' }))
      .sort((a, b) => ({ fail: 0, warn: 1, info: 2 }[a.level] - { fail: 0, warn: 1, info: 2 }[b.level]) || b.penalty - a.penalty);
    return { score: comp.score.total, issues, comp };
  };
})();
