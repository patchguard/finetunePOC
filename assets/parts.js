// Parts catalog for the Design Configuration page. Prices in US dollars.
// Storage/transmitter prices listed as a range use the midpoint of that range.
// The budget is shared with the simulation: the Design page reads the agency's funds (see agencyBudget in design.js).

const OPTIONS = {
  battery: [
    { id: 'nicd',     name: 'Vintage NiCd Pack',             cost: 4500,   desc: '30% effectiveness. Heavy 1980s battery (20 Wh, 0.70 kg). Fails immediately with high-draw sensors (LWIR, LIDAR, TBIRD Laser). Dies after 1 year in orbit.' },
    { id: 'nih2',     name: 'Nickel-Hydrogen Tank',          cost: 9000,   desc: '45% effectiveness. Bulky legacy tech (50 Wh, 0.90 kg). Heavy mass caps orbit altitude unless paired with a stronger thruster.' },
    { id: 'liion40',  name: 'Small CubeSat Li-Ion (40 Wh)',  cost: 11500,  desc: '60% effectiveness. Commercial 18650 pack (40 Wh, 0.35 kg). Lasts 3–5 years at 30% DoD, but browns out in eclipse with high-wattage parts.' },
    { id: 'liion100', name: 'Large CubeSat Li-Ion (100 Wh)', cost: 18500,  desc: '75% effectiveness. Flight-proven pack (100 Wh, 0.80 kg). Handles midday orbits and heaters, but cannot power Active LIDAR + TBIRD Laser together.' },
    { id: 'solid',    name: 'Solid-State Prototype',         cost: 35000,  desc: '85% effectiveness (high risk). Experimental 150 Wh, 0.40 kg cell. Saves launch mass, but 15% random failure risk in orbit (−1.5 stars).' },
    { id: 'ves',      name: 'Space-Grade VES Module',        cost: 65000,  desc: '90% effectiveness. Saft VES module (1,000 Wh, 6.50 kg). Survives 12+ years, but needs at least a Hydrazine thruster.' },
    { id: 'rtg',      name: 'Mini-RTG Nuclear Source',       cost: 450000, desc: '100% effectiveness (deep space). Constant 100 W, 45.0 kg. Very expensive: eats a large share of the agency budget (trap item).' }
  ],
  thruster: [
    { id: 'coldgas',     name: 'Cold Gas Thruster (Nitrogen)',     cost: 15000,  desc: '25% effectiveness. Nitrogen jets (0.8 kg). Cannot reach polar orbits; too imprecise to aim Zoom Spectrometers or directional dishes.' },
    { id: 'resistojet',  name: 'Resistojet Thruster (Water)',      cost: 28000,  desc: '40% effectiveness. Electrothermal water thruster (1.2 kg). Steals battery power; brownout penalty with Small Li-Ion or NiCd.' },
    { id: 'hydrazine',   name: 'Hydrazine Monopropellant',         cost: 45000,  desc: '60% effectiveness. Chemical thruster (2.2 kg). Unlocks polar orbits and steadies Zoom Spectrometers and X-Band dishes; fuel runs out after 3 years.' },
    { id: 'ascent',      name: 'Green Monopropellant (ASCENT)',    cost: 68000,  desc: '75% effectiveness. Non-toxic ionic liquid thruster (2.0 kg). 5-year station-keeping across global orbits, no toxic handling fees.' },
    { id: 'electrospray', name: 'Electrospray Ion Thruster',       cost: 95000,  desc: '85% effectiveness. Ionic droplet thruster (1.1 kg). Lasts 10+ years, but too gentle to slew satellites over 3.0 kg quickly.' },
    { id: 'dualmode',    name: 'Dual-Mode Chemical-Electrospray',  cost: 125000, desc: '92% effectiveness. Hybrid sharing one ASCENT tank for rapid pointing and 10-year electric cruising (2.8 kg).' },
    { id: 'hall',        name: 'Hall-Effect Ion Thruster (Xenon)', cost: 160000, desc: '100% effectiveness. Plasma thruster (4.5 kg). Keeps heavy Active LIDAR satellites in orbit 10+ years; needs high battery capacity.' }
  ],
  storage: [
    { id: 'a3200',     name: 'GomSpace NanoMind A3200',   cost: 5000,   desc: '128 MB + 32 kB FRAM, ~10 Mbps, 0.024 kg, 0.9 W, 10–20 krad. Capacity ★, Speed ★, Radiation ★, Cost ★★★★★, Mass/Power ★★★★★.' },
    { id: 'kryten',    name: 'AAC Clyde Space Kryten-M3', cost: 12500,  desc: '4 GB + 16 MB MRAM, SpaceWire, 0.062 kg, 0.4 W, 20 krad. Capacity ★, Speed ★★, Radiation ★★, Cost ★★★★, Mass/Power ★★★★★.' },
    { id: 'cfc400',    name: 'Innoflight CHAMPS CFC-400', cost: 35000,  desc: '16 GB + 2 GB RAM, Gigabit Ethernet, 0.25 kg, 6.3 W, 30–50 krad. Capacity ★★, Speed ★★★, Radiation ★★★, Cost ★★★, Mass/Power ★★★★.' },
    { id: 'rh3480',    name: 'Mercury RH3480 SSDR',       cost: 80000,  desc: '480 GB, SRIO 3.125 Gbps, 0.75 kg, up to 25 W, >100 krad. Capacity ★★★, Speed ★★★★, Radiation ★★★★★, Cost ★★, Mass/Power ★★★.' },
    { id: 'simplistor', name: 'Frontgrade SimpliStor SSDR', cost: 120000, desc: '2.5 TB, 10 Gbps Ethernet, ~1.2 kg, <25 W, 30–50 krad. Capacity ★★★★, Speed ★★★★, Radiation ★★★, Cost ★★, Mass/Power ★★★.' },
    { id: 'spacestor', name: 'Frontgrade SpaceStor 4TB MMU', cost: 150000, desc: '3.97 TB, PCIe 4 Gbps, ~1.2 kg, <15 W, up to 50 krad. Capacity ★★★★, Speed ★★★, Radiation ★★★★, Cost ★★, Mass/Power ★★★.' },
    { id: 'moog',      name: 'Moog Scalable SSR (6U)',    cost: 375000, desc: '1–10 TB, up to 100 Gbps, 3.5–6 kg, 30–60 W, 100+ krad. Capacity ★★★★★, Speed ★★★★★, Radiation ★★★★★, Cost ★, Mass/Power ★. Very expensive.' }
  ],
  transmitter: [
    { id: 'uhf',     name: 'EnduroSat UHF Transceiver II',  cost: 7900,   desc: 'UHF, 19.6 kbps, 195 g, 5.5 W. Speed ★, Weather ★★★★★, Aiming ★★★★★, Cost ★★★★★, Mass/Power ★★★★★.' },
    { id: 'sband',   name: 'EnduroSat S-Band Transceiver',  cost: 17500,  desc: 'S-Band, 125 kbps, 246 g, 11 W. Speed ★, Weather ★★★★★, Aiming ★★★★, Cost ★★★★, Mass/Power ★★★★.' },
    { id: 'srs4',    name: 'Satlab / NanoAvionics SRS-4',   cost: 25000,  desc: 'S-Band, 10 Mbps, 253 g, 12–15 W. Speed ★★, Weather ★★★★★, Aiming ★★★★, Cost ★★★★, Mass/Power ★★★★.' },
    { id: 'ewc27',   name: 'Syrlinks EWC27 X-Band Tx',      cost: 35000,  desc: 'X-Band, 100–140 Mbps, 225 g, 10 W. Speed ★★★, Weather ★★★★, Aiming ★★★, Cost ★★★, Mass/Power ★★★★.' },
    { id: 'xband',   name: 'EnduroSat X-Band Transmitter',  cost: 34300,  desc: 'X-Band, 150 Mbps, 396 g, 18 W. Speed ★★★, Weather ★★★★, Aiming ★★★, Cost ★★★, Mass/Power ★★★.' },
    { id: 'xlink',   name: 'IQ Spacecom XLink-S SDR',       cost: 42500,  desc: 'S-Band, 200 Mbps, 200 g, <15 W. Speed ★★★, Weather ★★★★★, Aiming ★★★★, Cost ★★★, Mass/Power ★★★★.' },
    { id: 'ewc34',   name: 'Syrlinks EWC34 High-Speed Tx',  cost: 77500,  desc: 'X-Band, 600 Mbps, ~500 g, 20–25 W. Speed ★★★★, Weather ★★★★, Aiming ★★★, Cost ★★, Mass/Power ★★★.' },
    { id: 'cubelct', name: 'TESAT CubeLCT 100M (Laser)',    cost: 125000, desc: 'Optical 1550 nm, 100 Mbps, ~380 g, 8–10 W. Speed ★★★, Weather ★, Aiming ★, Cost ★★, Mass/Power ★★★★.' },
    { id: 'xsdr',    name: 'EnduroSat X-Band SDR',          cost: 180000, desc: 'X-Band, 1+ Gbps, ~800 g, 25–35 W. Speed ★★★★, Weather ★★★★, Aiming ★★★, Cost ★, Mass/Power ★★.' },
    { id: 'scot80',  name: 'TESAT SCOT80 Laser Terminal',   cost: 575000, desc: 'Optical, 10–100 Gbps, 11.9 kg, 60–80 W. Speed ★★★★★, Weather ★, Aiming ★, Cost ★, Mass/Power ★. Very expensive.' }
  ],
  detector: [
    { id: 'nir',   name: 'Basic NIR Context Camera',       cost: 3500,  desc: '25% effectiveness. Daytime reference photos to tell a factory from a farm. Cannot see methane; blocked by clouds and night.' },
    { id: 'swir',  name: 'Wide-Swath SWIR Scanner',        cost: 10000, desc: '60% effectiveness. Scans continental strips for major methane hotspots. Clear, sunny daytime only.' },
    { id: 'mwir',  name: 'MWIR Flare & Fire Tracker',      cost: 14500, desc: '65% effectiveness. Spots unlit flares, wildfires and hot plumes day or night. Cuts thin smoke; blocked by thick storm clouds.' },
    { id: 'lwir',  name: 'LWIR Thermal Gas Imager',        cost: 19000, desc: '75% effectiveness. Tracks methane plumes by heat, day and night. Less accurate over frozen tundra or oceans.' },
    { id: 'zoom',  name: 'Point-Source Zoom Spectrometer', cost: 26000, desc: '90% effectiveness. High-resolution SWIR interferometer that pinpoints leaking facilities. Needs precise steering and clear skies.' },
    { id: 'lidar', name: 'Active TDLAS Methane LIDAR',     cost: 38000, desc: '100% effectiveness. Own infrared laser detects methane 24/7 over land or ocean, no false alarms. Very heavy, drains lots of power.' }
  ],
  // Launch sites come from assets/sites.js (load it before this file). No launch fee.
  site: LAUNCH_SITES.map(s => ({ ...s, cost: 0 }))
};

const LABELS = { battery: 'Battery', thruster: 'Thruster', storage: 'Data storage', transmitter: 'Transmitter', detector: 'Detector', site: 'Launch site' };
// Default design: completes the default 10-year mission (long-life VES battery, 5-year ASCENT thruster, Zoom detector for a clear climate impact)
const DEFAULTS = { missionName: 'MethaneWatch-1', battery: 'ves', thruster: 'ascent', storage: 'cfc400', transmitter: 'ewc27', detector: 'zoom', site: 'cape' };

// How good each part is (0–100), shown as bars on the Design page.
// Battery, thruster, detector: the catalog's effectiveness %.
// Storage: average of the catalog's capacity, speed, radiation and mass/power stars (cost left out; the budget covers it).
// Transmitter: (3 × downlink speed + weather + aiming + mass/power stars) / 30, since speed matters most for getting data down.
const RATINGS = {
  battery: { nicd: 30, nih2: 45, liion40: 60, liion100: 75, solid: 85, ves: 90, rtg: 100 },
  thruster: { coldgas: 25, resistojet: 40, hydrazine: 60, ascent: 75, electrospray: 85, dualmode: 92, hall: 100 },
  storage: { a3200: 40, kryten: 50, cfc400: 60, rh3480: 75, simplistor: 70, spacestor: 70, moog: 80 },
  transmitter: { uhf: 60, sband: 53, srs4: 63, ewc27: 67, xband: 63, xlink: 73, ewc34: 73, cubelct: 50, xsdr: 70, scot80: 60 },
  detector: { nir: 25, swir: 60, mwir: 65, lwir: 75, zoom: 90, lidar: 100 }
};
