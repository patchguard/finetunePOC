/* =========================================================================
   Satellite design input from design.html (Design step).

   design.html saves the player's choice to localStorage["cfx.design.v1"]:
     { missionName, battery, thruster, storage, transmitter, detector, savedAt }
   with one part id per category (ids from assets/parts.js). This file maps
   those ids to the simulation's catalog (js/catalog.js) and adds the design
   to the game, so it can be launched from the Launch view.
   ========================================================================= */

const DESIGN_INPUT = (() => {
  // assets/parts.js id -> js/catalog.js id (only ids that differ are listed)
  const ID_MAP = {
    battery: { liion40: 'li40', liion100: 'li100' },
    thruster: { coldgas: 'cold', resistojet: 'resisto', electrospray: 'espray', dualmode: 'dual' },
    storage: { a3200: 'nanomind' },
    transmitter: {},
    detector: {},
  };

  function read() {
    try { return JSON.parse(safeGet(STORE.design) || 'null'); } catch { return null; }
  }

  // Convert a saved design.html record into { name, parts: { catalogId: 1, … }, missing: [] }
  function convert(saved) {
    const parts = {}, missing = [];
    for (const cat of Object.keys(ID_MAP)) {
      const raw = saved[cat];
      if (!raw) continue;
      const id = ID_MAP[cat][raw] || raw;
      if (ALL_PARTS[id]) parts[id] = (parts[id] || 0) + 1;
      else missing.push(`${cat}: ${raw}`);
    }
    return { name: String(saved.missionName || 'MethaneWatch-1').slice(0, 40), parts, missing };
  }

  // Add (or refresh) the design from design.html in the game. Returns the design, or null if none saved.
  function sync(S) {
    const saved = read();
    if (!saved) return null;
    const d = convert(saved);
    if (d.missing.length) console.warn('Unknown part ids from design.html:', d.missing);
    if (!Object.keys(d.parts).length) return null;
    const stamp = saved.savedAt || JSON.stringify(saved);
    const isNew = S.designInputStamp !== stamp;
    const design = { name: d.name, parts: d.parts, fromDesignPage: true };
    const i = S.designs.findIndex(x => x.name === d.name);
    if (i >= 0) S.designs[i] = design; else S.designs.push(design);
    S.current = { name: design.name, parts: { ...design.parts } };
    if (isNew) {
      S.designInputStamp = stamp;
      const comp = DESIGN.compute(design.parts);
      SIM.decision('design', `Design received: ${design.name}`,
        'Designed on the Design step: ' + Object.keys(design.parts).map(id => ALL_PARTS[id].name).join(', ') + '.',
        `Ready to launch: ${comp.busUsed.name}, ${comp.mass.toFixed(2)} kg, ${fmt$(comp.cost)} to build including the automatic subsystems, design score ${comp.score.total}.`,
        { parts: design.parts, score: comp.score.total, cost: comp.cost, partsCost: comp.partsCost });
    }
    return { design, isNew };
  }

  return { read, convert, sync, ID_MAP };
})();
