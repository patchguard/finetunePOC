/* =========================================================================
   Satellite design engineering (pure, no DOM)
   Input: { partId: quantity }. Output: automatic subsystems, budgets,
   capabilities, warnings and a 0–100 design score.
   ========================================================================= */

const DESIGN = (() => {
  const MISSION_BUDGET = 260000;
  const BUDGET_TIERS = [{ max: 200000, stars: 5 }, { max: 260000, stars: 4 }, { max: 300000, stars: 3 }, { max: 400000, stars: 2 }, { max: Infinity, stars: 1 }];
  const WEIGHTS = { detection: 30, battery: 20, engine: 20, communication: 15, budget: 15 };
  const ECLIPSE_H = 0.6;        // ~36 min eclipse per LEO orbit
  const SUNLIT_FRACTION = 0.63;
  const INSTRUMENT_DUTY = 0.35; // fraction of the orbit instruments operate (land + targets)
  const TX_DUTY = 0.05;         // fraction of the day in contact with a ground station

  function expand(parts) {
    const items = [];
    for (const [id, qty] of Object.entries(parts || {})) {
      const p = ALL_PARTS[id];
      if (p && qty > 0) items.push({ part: p, qty });
    }
    return items;
  }
  const byCat = (items, cat) => items.filter(i => i.part.cat === cat);
  const sum = (items, f) => items.reduce((s, i) => s + f(i.part) * i.qty, 0);

  function compute(parts) {
    const items = expand(parts);
    const det = byCat(items, 'detector'), bat = byCat(items, 'battery'), eng = byCat(items, 'engine');
    const com = byCat(items, 'comms'), sto = byCat(items, 'storage');
    const has = id => items.some(i => i.part.id === id);
    const maxTier = eng.length ? Math.max(...eng.map(i => i.part.tier)) : -1;
    const needsFine = det.some(i => i.part.needsPointing) || com.some(i => i.part.directional);

    // --- automatic subsystems ---
    const auto = [];
    if (!sto.some(i => i.part.isOBC)) auto.push({ ...AUTO.obc, key: 'obc' });
    auto.push({ ...AUTO.eps, key: 'eps' });
    auto.push({ ...(needsFine ? AUTO.starTracker : AUTO.sunSensors), key: needsFine ? 'star' : 'sun' });
    auto.push({ ...AUTO.gps, key: 'gps' });
    auto.push({ ...AUTO.magnetorquers, key: 'mtq' });
    auto.push({ ...AUTO.thermal, key: 'thermal' });

    // volume → bus
    const partVol = sum(items, p => p.volume || 0.2);
    const autoVol = auto.reduce((s, a) => s + (a.volume || 0.05), 0) + 0.5; // + wheels/harness
    const needVol = (partVol + autoVol) * 1.1;
    const bus = AUTO.buses.find(b => b.volume >= needVol) || null;
    const busUsed = bus || AUTO.buses[AUTO.buses.length - 1];

    // mass before wheels/arrays
    let mass = sum(items, p => p.mass) + auto.reduce((s, a) => s + a.mass, 0) + busUsed.mass;
    const wheels = AUTO.wheels.find(w => w.maxMass >= mass * 1.2) || AUTO.wheels[AUTO.wheels.length - 1];
    mass += wheels.mass;

    // --- power ---
    const busLoad = auto.reduce((s, a) => s + a.power, 0) + wheels.power;
    const instLoad = sum(det, p => p.power);
    const storeLoad = sum(sto, p => p.power) * 0.5;
    const txPeak = com.length ? Math.max(...com.map(i => i.part.power)) : 0;
    const txIdle = sum(com, p => p.idle || 0.5);
    const rtgW = sum(bat, p => p.constantW || 0);
    const avgLoad = busLoad + instLoad * INSTRUMENT_DUTY + storeLoad + txPeak * TX_DUTY + txIdle;
    const peakLoad = busLoad + instLoad + storeLoad + txPeak + (eng.length ? Math.max(...eng.map(i => i.part.firingW)) : 0);
    // pick the smallest array that covers the orbit-average load with 20% margin
    const needArray = Math.max(0, avgLoad * 1.2 - rtgW);
    const bodyW = busUsed.id === 'micro' ? 90 : AUTO.arrays[0].wPerU * busUsed.volume;
    let array;
    if (needArray <= bodyW || (busUsed.id === 'micro' && needArray <= bodyW)) array = { ...AUTO.arrays[0], watts: bodyW, price: AUTO.arrays[0].price * Math.max(1, busUsed.volume / 3), mass: AUTO.arrays[0].mass * busUsed.volume };
    else array = AUTO.arrays.slice(1).find(a => a.watts >= needArray) || AUTO.arrays[AUTO.arrays.length - 1];
    if (rtgW && needArray <= 0) array = { ...AUTO.arrays[0], watts: bodyW, price: 4000, mass: 0.05 * busUsed.volume };
    mass += array.mass;
    const harness = mass * 0.05;
    mass += harness;
    const genAvg = array.watts + rtgW;

    // battery
    const batteryWh = sum(bat, p => p.wh || 0);
    const usableWh = sum(bat, p => (p.wh || 0) * p.dod);
    const eclipseNeed = Math.max(0, (avgLoad + 1 - rtgW)) * ECLIPSE_H;
    const batteryLife = bat.length ? Math.max(...bat.map(i => i.part.lifeYears)) : 0;

    // --- propulsion ---
    const propMass = sum(eng, p => p.prop);
    const dryMass = mass - propMass;
    let dvChem = 0, dvElec = 0, thrustChem = 0, thrustElec = 0, ispChem = 0, ispElec = 0;
    const chemProp = sum(eng.filter(i => !i.part.electric), p => p.prop);
    const elecProp = sum(eng.filter(i => i.part.electric), p => p.prop);
    eng.forEach(i => {
      const p = i.part;
      if (p.electric) { thrustElec += p.thrust * i.qty; ispElec = Math.max(ispElec, p.isp); }
      else { thrustChem += p.thrust * i.qty; ispChem = Math.max(ispChem, p.isp); }
      if (p.thrustE) { thrustElec += p.thrustE * i.qty; ispElec = Math.max(ispElec, p.ispE); }
    });
    if (chemProp) dvChem = ispChem * ORB.G0 * Math.log(mass / (mass - chemProp));
    if (elecProp) dvElec = ispElec * ORB.G0 * Math.log(mass / (mass - elecProp));
    // dual-mode: the shared tank can be spent either way; show electric figure as the best case
    if (has('dual')) dvElec = Math.max(dvElec, (ALL_PARTS.dual.ispE) * ORB.G0 * Math.log(mass / (mass - ALL_PARTS.dual.prop * parts.dual)));
    const dvTotal = dvChem + dvElec;

    // --- pointing ---
    let pointing = needsFine ? 0.95 : 0.6;
    if (maxTier < 0) pointing = 0.35;            // no thrusters to unload / steady
    else if (maxTier === 0) pointing = Math.min(pointing, 0.3);
    else if (maxTier === 1) pointing = Math.min(pointing, 0.6);
    const esprayOnly = eng.length && eng.every(i => i.part.id === 'espray');
    if (esprayOnly && mass > ALL_PARTS.espray.slewLimitKg) pointing = Math.min(pointing, 0.5);

    // --- data ---
    const storageMB = sto.length ? sum(sto, p => p.capacityMB) : 512; // OBC default
    const dataPerDay = sum(det, p => p.dataMB * (5 + p.swathKm / 25));
    const bestRate = com.length ? Math.max(...com.map(i => i.part.rate)) : 0;
    const downPerDay = bestRate * 6 * 8 * 60 * 0.8 / 8 / 1e6; // 6 passes × 8 min

    // --- cost ---
    const hardware = sum(items, p => p.price) + auto.reduce((s, a) => s + a.price, 0) + wheels.price + busUsed.price + array.price;
    const integration = Math.round(hardware * 0.12);
    const licensing = 15000;
    const toxicFee = has('hydrazine') ? 12000 * parts.hydrazine : 0;
    const cost = hardware + integration + licensing + toxicFee;
    const partsCost = sum(items, p => p.price);

    const comp = {
      items, auto, bus, busUsed, wheels, array, mass, dryMass, propMass, harness, volumeNeeded: needVol,
      busLoad, instLoad, avgLoad, peakLoad, genAvg, rtgW, batteryWh, usableWh, eclipseNeed, batteryLife,
      dvChem, dvElec, dvTotal, thrustChem, thrustElec, ispChem, ispElec, maxTier, pointing, needsFine,
      storageMB, dataPerDay, downPerDay, bestRate, cost, partsCost, hardware, integration, licensing, toxicFee,
      cdAOverM: 2.2 * (busUsed.area + (array.deploy ? array.watts / 300 * 0.5 * 0.3 : 0)) / Math.max(0.5, mass),
      detectors: det.map(i => i.part), comms: com.map(i => i.part), batteries: bat.map(i => i.part), engines: eng.map(i => i.part),
      hasNIR: has('nir'), hasMethane: det.some(i => i.part.methane), optical: com.some(i => i.part.optical),
    };
    comp.issues = rules(comp, parts);
    comp.score = score(comp);
    return comp;
  }

  function rules(c, parts) {
    const out = [];
    const add = (level, cat, text, why, penalty = 0) => out.push({ level, cat, text, why, penalty });
    const has = id => (parts[id] || 0) > 0;
    const highDraw = c.detectors.some(d => d.highDraw) || c.comms.some(t => t.optical);
    const maxWh = c.batteries.length ? Math.max(...c.batteries.map(b => b.wh || 0)) : 0;

    if (!c.items.length) return out;
    if (!c.batteries.length) add('fail', 'battery', 'No battery or power source.', 'Every satellite needs stored energy to survive Earth\'s shadow, which covers about a third of each orbit.', 30);
    if (!c.comms.length) add('fail', 'comms', 'No transmitter: data can never reach Earth.', 'Without a radio or laser, observations stay trapped on board and nobody can act on them.', 30);
    if (!c.detectors.length) add('fail', 'detector', 'No detector on board.', 'The mission is to find methane; a satellite without an instrument returns nothing.', 30);
    else if (!c.hasMethane) add('warn', 'detector', 'No instrument can see methane.', 'The NIR camera only photographs sites; it needs a methane detector alongside it.', 15);
    if (!c.bus) add('fail', 'frame', `Parts need ${c.volumeNeeded.toFixed(0)}U of volume, more than the largest frame.`, 'Remove large parts such as the RTG, SCOT80 or Moog recorder.', 25);

    if (has('nicd')) {
      if (highDraw) add('fail', 'battery', 'NiCd pack fails immediately with high-draw parts (LWIR, LIDAR or laser comms).', 'High current drains old NiCd cells below their safe voltage, and they never recover.', 25);
      else add('info', 'battery', 'NiCd pack dies after about 1 year in orbit.', 'LEO satellites see ~5,500 charge cycles a year; NiCd cells wear out fast.', 3);
    }
    if (has('nih2') && c.maxTier < 2) add('warn', 'battery', 'Nickel-Hydrogen mass caps your orbit altitude. Pair it with Hydrazine or stronger.', 'Heavier satellites need more Δv to hold altitude against drag.', 6);
    if (has('li40') && maxWh <= 40 && c.avgLoad > 25) add('warn', 'battery', `Small Li-Ion browns out in eclipse: parts draw ${c.avgLoad.toFixed(1)} W.`, 'At 30% depth of discharge it only gives 12 Wh per eclipse.', 8);
    if (maxWh === 100 && !c.batteries.some(b => b.wh > 100 || b.constantW) && has('lidar') && c.comms.some(t => t.optical))
      add('fail', 'battery', 'Large Li-Ion cannot power Active LIDAR and a laser terminal at the same time.', 'Both draw their peak power during passes; the pack voltage collapses.', 20);
    if (has('solid')) add('info', 'battery', 'Solid-state prototype: 15% chance of cell failure in orbit (−1.5 stars).', 'Experimental cells have no flight heritage.', 0);
    if (has('ves') && c.maxTier < 2) add('fail', 'engine', 'The 6.5 kg VES module needs at least a Hydrazine thruster.', 'A heavy satellite with weak thrusters cannot hold its orbit or point.', 20);
    if (has('rtg')) add('fail', 'battery', 'Mini-RTG costs more than the whole $260,000 mission budget on its own.', 'Nuclear sources also need years of launch approval and worry the public.', 15);

    if (c.maxTier === 0) {
      if (has('zoom')) add('fail', 'engine', 'Cold gas jets cannot hold the Zoom Spectrometer on target.', 'Cold gas pulses are too coarse for arc-second pointing.', 18);
      if (c.comms.some(t => t.directional)) add('warn', 'engine', 'Cold gas jets struggle to aim a directional dish or laser.', 'Directional links need steady pointing at the ground station.', 10);
    }
    if (has('resisto') && maxWh < 50 && !c.rtgW) add('fail', 'engine', 'Resistojet steals battery power: brownout with Small Li-Ion or NiCd.', 'Heating water draws ~20 W, more than a small pack can deliver.', 18);
    if (has('espray') && c.engines.every(e => e.id === 'espray') && c.mass > 3) add('warn', 'engine', `Electrospray is too gentle to slew a ${c.mass.toFixed(1)} kg satellite quickly.`, 'Thrust of 0.4 mN barely moves a heavy satellite.', 8);
    if (has('hall') && c.batteryWh < 100 && !c.rtgW) add('fail', 'engine', `Hall thruster needs 100 Wh+ of battery (you have ${c.batteryWh} Wh).`, 'It draws 100 W while firing, including through eclipses.', 18);
    if (has('hydrazine')) add('info', 'engine', 'Hydrazine fuel lasts about 3 years of station-keeping; toxic handling fee added.', 'Fuelling hydrazine requires hazmat procedures.', 2);
    if (has('lidar') && c.batteryWh < 100 && !c.rtgW) add('warn', 'detector', 'Active LIDAR drains massive power: battery under 100 Wh.', 'The laser draws 30 W whenever it fires.', 10);
    if (has('nir') && !c.hasMethane) { /* covered above */ } else if (has('nir')) add('info', 'detector', 'NIR camera boosts attribution of methane detections (+10% payouts).', 'Photos show what kind of facility is leaking.', 0);
    if (has('scot80')) add('fail', 'comms', 'SCOT80 is a 12 kg, $575k terminal built for relay satellites.', 'Oversized for a single small satellite.', 15);
    if (has('moog')) add('fail', 'storage', 'Moog 6U recorder is far beyond a small satellite\'s mass and power.', 'It alone needs 45 W.', 15);
    if (c.comms.some(t => t.optical)) add('info', 'comms', 'Laser downlinks need optical ground stations and clear skies.', 'Only three optical stations exist in this network.', 2);

    if (c.genAvg < c.avgLoad) add('fail', 'power', `Power deficit: generates ${c.genAvg.toFixed(0)} W, needs ${c.avgLoad.toFixed(0)} W on average.`, 'The battery will drain every orbit until the satellite shuts down.', 20);
    else if (c.usableWh < c.eclipseNeed && !c.rtgW && c.batteries.length) add('warn', 'power', `Eclipse needs ${c.eclipseNeed.toFixed(0)} Wh but batteries safely give ${c.usableWh.toFixed(0)} Wh.`, 'Instruments will be switched off in Earth\'s shadow to protect the battery.', 8);
    if (c.engines.length === 0) add('warn', 'engine', 'No thrusters: no station-keeping, no collision avoidance.', 'Drag will slowly pull the satellite down and it cannot dodge debris.', 10);
    else if (c.dvTotal < 25) add('warn', 'engine', `Only ${c.dvTotal.toFixed(0)} m/s of Δv.`, 'Enough for a few collision-avoidance burns, not years of station-keeping below 500 km.', 4);
    if (c.dataPerDay > c.downPerDay * 1.2 && c.comms.length) add('warn', 'comms', `Data bottleneck: ~${fmtMB(c.dataPerDay)}/day collected, ~${fmtMB(c.downPerDay)}/day downlinked.`, 'Storage will fill and observations will be lost. Use a faster radio or fewer data-heavy instruments.', 6);
    if (c.partsCost > 260000) add('warn', 'budget', `Chosen parts cost ${'$' + Math.round(c.partsCost).toLocaleString()}, over the $260,000 mission budget.`, 'The budget rating drops, and less money is left for launches and operations.', 0);
    return out;
  }

  function fmtMB(mb) { return mb >= 1e6 ? (mb / 1e6).toFixed(1) + ' TB' : mb >= 1000 ? (mb / 1000).toFixed(1) + ' GB' : mb.toFixed(0) + ' MB'; }

  function budgetStars(cost) { return BUDGET_TIERS.find(t => cost <= t.max).stars; }

  function score(c) {
    const best = (arr) => arr.length ? Math.max(...arr.map(p => p.eff || 0)) / 100 : 0;
    const comm = (best(c.comms) + (c.items.some(i => i.part.cat === 'storage') ? best(c.items.filter(i => i.part.cat === 'storage').map(i => i.part)) : 0)) / 2;
    const stars = c.items.length ? budgetStars(c.partsCost) : 0;
    const parts = {
      detection: WEIGHTS.detection * best(c.detectors.filter(d => d.methane)),
      battery: WEIGHTS.battery * best(c.batteries),
      engine: WEIGHTS.engine * best(c.engines),
      communication: WEIGHTS.communication * comm,
      budget: WEIGHTS.budget * stars / 5,
    };
    const penalty = c.issues.reduce((s, i) => s + i.penalty, 0);
    const raw = Object.values(parts).reduce((a, b) => a + b, 0);
    return { parts, penalty, stars, total: Math.max(0, Math.min(100, Math.round(raw - penalty))) };
  }

  return { compute, budgetStars, fmtMB, MISSION_BUDGET, WEIGHTS };
})();
