/* =========================================================================
   Mission: Blue Marble — catalog
   Parts (from the team sheets) + realistic engineering numbers the
   simulation needs. Fields marked est* are engineering estimates.
   img = NASA Image and Video Library nasa_id (not loaded by this page since the
         Satellite Builder moved to design.html; kept as photo credits)
   ========================================================================= */

const U_VOLUME = 1; // 1U = 10 × 10 × 10 cm

/* ---------------- DETECTORS ----------------
   swathKm: ground swath; pointKm: how far off-nadir it can be aimed (needs fine pointing)
   dataMB: data per observation; threshold: smallest leak it can see (kg CH4 / hour)
   dayOnly: needs sunlight; cloud: 0 = clouds don't matter, 1 = fully blocked             */
const DETECTORS = [
  {
    id: 'nir', cat: 'detector', name: 'Basic NIR Context Camera', maker: 'Generic CubeSat imager', price: 3500, eff: 25,
    mass: 0.3, power: 2, volume: 0.3, swathKm: 120, pointKm: 0, dataMB: 40, dayOnly: true, cloud: 1, threshold: Infinity, methane: false,
    img: 'NHQ201704060026',
    short: 'Daytime reference photos to tell a factory from a farm.',
    limits: 'Cannot see methane directly; blocked by clouds and night.',
    desc: 'A small near-infrared (0.75–0.9 µm) camera with about 30 m pixels. It cannot sense methane at all, but its pictures let analysts confirm what a methane hotspot actually is: a well pad, a landfill, a rice field or a feedlot. In the game it raises the attribution confidence of any methane detector on the same satellite by 10%, so reports pay more.',
    history: 'Earth-observing cameras in the near-infrared go back to Landsat 1 in 1972, whose Multispectral Scanner used a near-infrared band to separate healthy vegetation from soil and water. Today almost every CubeSat carries a cheap commercial camera like this one, built from the same kind of sensor found in phones and machine-vision cameras.',
  },
  {
    id: 'swir', cat: 'detector', name: 'Wide-Swath SWIR Scanner', maker: 'Grating spectrometer (TROPOMI-class)', price: 10000, eff: 60,
    mass: 1.2, power: 6, volume: 1, swathKm: 260, pointKm: 0, dataMB: 300, dayOnly: true, cloud: 1, threshold: 2500, methane: true,
    img: 'PIA15654',
    short: 'Maps continental strips to find regional methane hotspots.',
    limits: 'Only works in clear, sunny daytime conditions.',
    desc: 'Measures sunlight reflected from the ground in the 2.3 µm short-wave infrared band, where methane absorbs strongly. A wide swath means each place is seen often, but pixels are kilometres across, so only very large emitters (a few tonnes per hour) stand out. Needs the Sun: no data at night or through cloud.',
    history: 'This is a CubeSat-scale version of the approach used by TROPOMI on the European Sentinel-5P satellite (launched 2017), which maps methane across the whole planet every day and found unexpected super-emitters such as gas-field blowouts. NASA\'s OCO-2 (shown) uses the same grating-spectrometer idea for carbon dioxide.',
  },
  {
    id: 'mwir', cat: 'detector', name: 'MWIR Flare & Fire Tracker', maker: 'Mid-wave infrared radiometer', price: 14500, eff: 65,
    mass: 1.5, power: 8, volume: 1, swathKm: 160, pointKm: 0, dataMB: 120, dayOnly: false, cloud: 0.6, threshold: 600, methane: true,
    types: ['oilgas', 'coal', 'landfill'],
    img: 'PIA18795',
    short: 'Spots unlit flares, wildfires and hot gas plumes, day or night.',
    limits: 'Cuts through thin smoke but not thick storm clouds. Only sees hot industrial sources.',
    desc: 'Senses heat in the 3–5 µm mid-wave infrared. Burning or failed gas flares, fires and hot exhaust stand out day and night. It does not measure methane directly; it flags the industrial sites (flares that have blown out vent raw methane) where leaks are likely. Only finds oil & gas, coal and landfill sources.',
    history: 'Mid-wave infrared fire detection made NASA\'s MODIS (Terra 1999, Aqua 2002) and VIIRS instruments famous. NASA\'s FIRMS system turns those detections into fire alerts for firefighters within about three hours, and the same data is used to track gas flaring at oil fields worldwide.',
  },
  {
    id: 'lwir', cat: 'detector', name: 'LWIR Thermal Gas Imager', maker: 'Uncooled thermal imaging spectrometer', price: 19000, eff: 75,
    mass: 2.0, power: 12, volume: 1.5, swathKm: 110, pointKm: 0, dataMB: 220, dayOnly: false, cloud: 0.9, threshold: 400, methane: true, highDraw: true,
    tundraPenalty: 0.4,
    img: 'PIA22509',
    short: 'Tracks methane plumes by their heat signature, day and night.',
    limits: 'Loses accuracy over freezing tundra and oceans (low thermal contrast).',
    desc: 'Methane has a strong absorption band near 7.7 µm in the long-wave infrared. Because this band uses the Earth\'s own heat instead of sunlight, it works on the night side too. Accuracy depends on the temperature difference between the ground and the air, so cold tundra and cool oceans are hard.',
    history: 'NASA\'s ECOSTRESS thermal radiometer (shown) was installed on the ISS in 2018 to measure plant temperature and water stress. Industry has long used handheld thermal "optical gas imaging" cameras to spot leaks at valves; this instrument scales that idea up to orbit.',
  },
  {
    id: 'zoom', cat: 'detector', name: 'Point-Source Zoom Spectrometer', maker: 'High-resolution SWIR imaging spectrometer', price: 26000, eff: 90,
    mass: 2.5, power: 10, volume: 1.2, swathKm: 14, pointKm: 300, dataMB: 650, dayOnly: true, cloud: 1, threshold: 120, methane: true, needsPointing: true,
    img: 'PIA25146',
    short: 'Pinpoints the exact leaking facility for maximum scientist payouts.',
    limits: 'Requires precise steering (fine pointing) and clear skies.',
    desc: '25–60 m pixels in the 2.3 µm band and a narrow swath. It must be steered onto targets, which needs a star tracker, reaction wheels and a thruster able to hold precise pointing. In return it attributes plumes to a single well pad, pipeline segment or landfill cell, which is what operators need to fix them. Reports from this instrument pay double.',
    history: 'Facility-scale methane mapping from orbit took off with the Canadian GHGSat-D "Claire" microsatellite in 2016. NASA\'s EMIT imaging spectrometer (shown, installed on the ISS in 2022) was built to map dust minerals but turned out to detect more than 50 methane super-emitters in its first months. The Carbon Mapper Tanager-1 satellite (2024) carries a JPL-built spectrometer designed specifically for this job.',
  },
  {
    id: 'lidar', cat: 'detector', name: 'Active TDLAS Methane LIDAR', maker: 'Integrated-path differential absorption lidar', price: 38000, eff: 100,
    mass: 4.5, power: 30, volume: 3, swathKm: 4, pointKm: 120, dataMB: 30, dayOnly: false, cloud: 0.5, threshold: 150, methane: true, highDraw: true, needsPointing: true,
    img: 'AFRC2019-0070-28',
    short: 'Fires its own laser to detect methane 24/7 over land or ocean.',
    limits: 'Very heavy and drains massive battery power. Narrow footprint must be pointed.',
    desc: 'Fires two laser pulses: one tuned to a methane absorption line near 1.645 µm and one just beside it. The difference in the echoes gives the methane column with almost no false alarms, and because it brings its own light it works at night, over oceans and in polar winter. The price is power: 30 W while firing.',
    history: 'The French–German MERLIN mission (CNES/DLR) is building the first space methane lidar of this kind. NASA\'s airborne HALO lidar (shown) already measures methane and water vapour this way from a high-altitude aircraft, and NASA has flown lidars in orbit for decades: CALIPSO profiled clouds from 2006, and ICESat-2\'s ATLAS fires 10,000 pulses a second to measure ice height.',
  },
];

/* ---------------- BATTERIES ---------------- */
const BATTERIES = [
  {
    id: 'nicd', cat: 'battery', name: 'Vintage NiCd Pack', maker: 'Nickel-cadmium, 1980s heritage', price: 4500, eff: 30,
    wh: 20, mass: 0.70, volume: 0.5, dod: 0.25, lifeYears: 1, chargeC: 0.5, power: 0,
    img: '8898999',
    short: 'Heavy 1980s battery.',
    limits: 'Fails immediately with high-draw sensors (LWIR, LIDAR or laser comms). Dies after 1 year in orbit.',
    desc: '20 Wh of nickel-cadmium cells. Robust and cheap, but heavy (about 30 Wh/kg), it suffers from the "memory effect" and wears out after a few thousand deep cycles. A low-Earth-orbit satellite goes through about 5,500 eclipse cycles a year.',
    history: 'Nickel-cadmium batteries powered most satellites from the 1960s to the 1990s, including NASA\'s Solar Maximum Mission (shown, 1980). They were replaced first by nickel-hydrogen and then by lithium-ion as missions needed more energy for less mass.',
  },
  {
    id: 'nih2', cat: 'battery', name: 'Nickel-Hydrogen Tank', maker: 'Pressure-vessel NiH₂ cell', price: 9000, eff: 45,
    wh: 50, mass: 0.90, volume: 1, dod: 0.35, lifeYears: 10, chargeC: 0.5, power: 0,
    img: 'iss061e001616',
    short: 'Bulky legacy tech.',
    limits: 'Heavy mass caps orbit altitude unless paired with a stronger thruster.',
    desc: 'Hydrogen gas under pressure inside a steel-like vessel. Extremely long cycle life (tens of thousands of cycles), but bulky and only ~55 Wh/kg.',
    history: 'Nickel-hydrogen batteries kept the Hubble Space Telescope running from 1990 until astronauts replaced them on the final servicing mission in 2009. The International Space Station also ran on nickel-hydrogen batteries until spacewalkers swapped them for lithium-ion between 2017 and 2021 (shown).',
  },
  {
    id: 'li40', cat: 'battery', name: 'Small CubeSat Li-Ion (40 Wh)', maker: 'Commercial 18650 cells, space-screened', price: 11500, eff: 60,
    wh: 40, mass: 0.35, volume: 0.4, dod: 0.30, lifeYears: 4, chargeC: 1, power: 0,
    img: 'KSC-20170111-PH_DNG01_0008',
    short: 'Commercial 18650 space pack; lasts 3–5 years at a 30% depth of discharge.',
    limits: 'Brownouts during eclipses if running high-wattage parts.',
    desc: 'Four laptop-style 18650 lithium-ion cells with protection electronics and heaters. Light (~115 Wh/kg), but to survive thousands of cycles each eclipse may only use about 30% of the stored energy.',
    history: 'Using carefully screened commercial cells is what made CubeSats affordable. Since the first CubeSats flew in 2003, packs like this have powered thousands of university and commercial satellites.',
  },
  {
    id: 'li100', cat: 'battery', name: 'Large CubeSat Li-Ion (100 Wh)', maker: 'Flight-proven 18650 pack', price: 18500, eff: 75,
    wh: 100, mass: 0.80, volume: 1, dod: 0.30, lifeYears: 5, chargeC: 1, power: 0,
    img: 'KSC-20170111-PH_DNG01_0011',
    short: 'Handles midday methane orbits and heaters.',
    limits: 'Cannot power Active LIDAR + laser comms simultaneously.',
    desc: 'Eight to ten 18650 cells in a flight-proven 6U/12U pack with balancing and heaters. The standard choice for capable small satellites.',
    history: 'Packs of this size power most 6U science CubeSats, such as NASA\'s TROPICS hurricane satellites and MarCO, the first CubeSats sent to Mars (2018).',
  },
  {
    id: 'solid', cat: 'battery', name: 'Solid-State Prototype', maker: 'Experimental solid-electrolyte cell', price: 35000, eff: 85,
    wh: 150, mass: 0.40, volume: 0.5, dod: 0.40, lifeYears: 6, chargeC: 2, power: 0, risky: 0.15,
    img: 'KSC-20170111-PH_DNG01_0019',
    short: 'Experimental high-density cell that saves launch mass.',
    limits: '15% chance of random cell failure in orbit (−1.5 stars).',
    desc: 'Replaces the liquid electrolyte with a solid one: ~375 Wh/kg, no fire risk, fast charging. Still experimental: cells can crack or short after launch vibration and thermal cycling.',
    history: 'NASA\'s SABERS project (Solid-state Architecture Batteries for Enhanced Rechargeability and Safety) is developing solid-state cells for aircraft and spacecraft. No solid-state pack has a long flight record yet, which is exactly why it is risky.',
  },
  {
    id: 'ves', cat: 'battery', name: 'Space-Grade VES Module', maker: 'Saft VES aerospace Li-ion', price: 65000, eff: 90,
    wh: 1000, mass: 6.50, volume: 6, dod: 0.30, lifeYears: 12, chargeC: 0.7, power: 0,
    img: '04pd2542',
    short: 'Aerospace-grade module that survives 12+ years.',
    limits: '6.50 kg mass requires at least a Hydrazine thruster.',
    desc: '1 kWh of space-qualified lithium-ion cells in a structural module. Built for 15-year geostationary missions, so in low orbit it barely notices the daily cycling. Heavy and bulky for a small satellite.',
    history: 'Saft\'s VES cell family has flown on hundreds of satellites since the early 2000s, from telecom satellites to Earth-observation missions. Deep Impact\'s flight battery is shown being checked before launch in 2004.',
  },
  {
    id: 'rtg', cat: 'battery', name: 'Mini-RTG Nuclear Source', maker: 'Radioisotope thermoelectric generator', price: 450000, eff: 100,
    wh: 0, constantW: 100, mass: 45.0, volume: 60, dod: 1, lifeYears: 14, chargeC: 0, power: 0, trap: true,
    img: 'PIA23306',
    short: 'Constant 100 W from decaying plutonium-238. Built for deep space.',
    limits: 'Exceeds the $260,000 mission budget by itself. Needs launch approval (delay) and lowers public trust.',
    desc: 'Heat from plutonium-238 is converted into about 100 W of electricity by thermocouples, day and night, for over a decade. Wasteful in Earth orbit, where the Sun is free, and launching nuclear material requires presidential-level approval.',
    history: 'NASA\'s Multi-Mission RTG (shown) powers the Curiosity (2011) and Perseverance (2020) Mars rovers. It weighs about 45 kg and produces about 110 W at launch. RTGs also power Voyager 1 and 2, still talking to Earth after nearly 50 years.',
  },
];

/* ---------------- ENGINES (THRUSTERS) ----------------
   thrust N, isp s, prop = propellant kg (included in mass), firingW = power while firing
   tier: pointing/orbit capability ladder used by rules                                   */
const ENGINES = [
  {
    id: 'cold', cat: 'engine', name: 'Cold Gas Thruster (Nitrogen)', maker: 'Pressurised N₂ micro-propulsion', price: 15000, eff: 25,
    mass: 0.8, volume: 0.5, thrust: 0.05, isp: 65, prop: 0.15, firingW: 1, tier: 0,
    img: 'PIA20342',
    short: 'Pressurised nitrogen jets.',
    limits: 'Cannot reach polar orbits; lacks precision to aim Zoom Spectrometers or directional dishes.',
    desc: 'A tank of compressed nitrogen, valves and nozzles. No combustion, no heat, almost nothing to go wrong, but the exhaust is slow (Isp ≈ 65 s), so a full tank only gives a small satellite 10–30 m/s of Δv.',
    history: 'Cold gas is the oldest spacecraft propulsion. Astronauts flew untethered with nitrogen jets on NASA\'s Manned Maneuvering Unit in 1984, and the twin MarCO CubeSats (shown) used a cold-gas system to steer all the way to Mars in 2018.',
  },
  {
    id: 'resisto', cat: 'engine', name: 'Resistojet Thruster (Water)', maker: 'Electrothermal water thruster', price: 28000, eff: 40,
    mass: 1.2, volume: 1, thrust: 0.006, isp: 150, prop: 0.4, firingW: 20, tier: 1, electric: true,
    img: 'iss061e051961',
    short: 'Electrothermal water thruster.',
    limits: 'Steals battery power to heat fuel; brownout with Small Li-Ion or NiCd.',
    desc: 'Water is boiled and superheated by an electric resistor, then expanded through a nozzle. Safe, cheap propellant and roughly twice the efficiency of cold gas, but each firing draws about 20 W from the power system.',
    history: 'Resistojets have flown since the 1960s, and hydrazine resistojets kept Intelsat V communication satellites on station in the 1980s. JAXA\'s EQUULEUS CubeSat, launched on Artemis I in 2022, used a water resistojet called AQUARIUS.',
  },
  {
    id: 'hydrazine', cat: 'engine', name: 'Hydrazine Monopropellant', maker: '1 N catalytic thruster module', price: 45000, eff: 60,
    mass: 2.2, volume: 1.0, thrust: 1.0, isp: 220, prop: 0.9, firingW: 8, tier: 2,
    img: 'KSC-2009-1151',
    short: 'Classic chemical thruster; unlocks polar orbits and steady pointing.',
    limits: 'Fuel runs out after about 3 years of station-keeping. Toxic handling fees.',
    desc: 'Hydrazine decomposes instantly on a hot iridium catalyst bed, giving strong, precise pulses (1 N, Isp ≈ 220 s). Good for quick orbit changes, collision avoidance and holding pointing. Hydrazine is toxic, so fuelling needs protective suits and costs extra.',
    history: 'Catalytic hydrazine thrusters date back to the 1960s and have steered almost every kind of spacecraft since, from the Viking Mars landers to the Voyager probes and most of today\'s Earth-observation satellites.',
  },
  {
    id: 'ascent', cat: 'engine', name: 'Green Monopropellant (ASCENT)', maker: 'AF-M315E / ASCENT ionic liquid thruster', price: 68000, eff: 75,
    mass: 2.0, volume: 1.5, thrust: 1.0, isp: 235, prop: 1.0, firingW: 12, tier: 3,
    img: '201307090006HQ',
    short: '5-year station-keeping with zero toxic handling fees.',
    limits: 'Catalyst must be pre-heated (12 W) before firing.',
    desc: 'ASCENT is a non-toxic ionic-liquid propellant (hydroxylammonium nitrate blend). It is about 50% denser and gives ~10% more Isp than hydrazine, so the same tank holds much more Δv, and technicians can fuel it without hazmat suits.',
    history: 'NASA\'s Green Propellant Infusion Mission (GPIM) flew ASCENT for the first time in 2019 after launching on a Falcon Heavy. NASA\'s Lunar Flashlight CubeSat (2022) used it again. The propellant was originally developed by the U.S. Air Force Research Laboratory as AF-M315E.',
  },
  {
    id: 'espray', cat: 'engine', name: 'Electrospray Ion Thruster', maker: 'Micro-fabricated ionic-liquid emitters', price: 95000, eff: 85,
    mass: 1.1, volume: 1, thrust: 0.0004, isp: 1500, prop: 0.2, firingW: 10, tier: 3, electric: true, slewLimitKg: 3.0,
    img: 'GRC-2014-C-00768',
    short: 'Sips fuel for 10+ years.',
    limits: 'Thrust is too gentle to slew satellites over 3.0 kg quickly.',
    desc: 'Thousands of microscopic needles pull charged droplets and ions straight out of an ionic liquid with a strong electric field. Extremely efficient (Isp ≈ 1500 s) and tiny, but the thrust is about the weight of a grain of sand.',
    history: 'NASA\'s ST7 colloid thrusters, built by Busek, flew on the European LISA Pathfinder mission (2015) and held the spacecraft steadier than any before it. MIT\'s Space Propulsion Lab and spin-off companies have since shrunk electrospray thrusters to fit CubeSats.',
  },
  {
    id: 'dual', cat: 'engine', name: 'Dual-Mode Chemical-Electrospray', maker: 'Shared ASCENT tank, two thruster modes', price: 125000, eff: 92,
    mass: 2.8, volume: 2, thrust: 0.5, isp: 235, thrustE: 0.0005, ispE: 800, prop: 1.0, firingW: 15, tier: 4,
    img: 'CEB_6856',
    short: 'One tank for rapid pointing and 10-year electric cruising.',
    limits: 'Pricey and complex.',
    desc: 'The same ionic-liquid propellant can be burned on a catalyst for strong chemical thrust (0.5 N) or sprayed electrically for efficient low thrust (Isp ≈ 800 s). The flight software picks the mode: chemical for quick manoeuvres, electric for station-keeping.',
    history: 'The idea grew out of university research on ionic-liquid propellants; NASA Marshall has tested green-propellant dual-mode systems (shown). It is one of the most promising ways to give small satellites both agility and long life.',
  },
  {
    id: 'hall', cat: 'engine', name: 'Hall-Effect Ion Thruster (Xenon)', maker: '100 W-class Hall thruster + PPU', price: 160000, eff: 100,
    mass: 4.5, volume: 4, thrust: 0.007, isp: 1100, prop: 1.5, firingW: 100, tier: 5, electric: true, needsWh: 100,
    img: 'GRC-2017-C-01056',
    short: 'Keeps heavy Active LIDAR satellites in orbit for 10+ years.',
    limits: 'Requires high battery capacity (100 Wh+) and big solar arrays: draws 100 W.',
    desc: 'Xenon is ionised in a ring-shaped channel where a magnetic field traps electrons; the electric field then shoots the ions out at ~11 km/s. Gives a small satellite over 1 km/s of Δv, but only while 100 W of power is available.',
    history: 'Soviet engineers flew the first Hall thrusters on the Meteor weather satellite in 1971. The first U.S. Hall thruster in space was Busek\'s BHT-200 on TacSat-2 in 2006. Today thousands fly on Starlink satellites, and NASA\'s Psyche probe uses them to reach its metal asteroid.',
  },
];

/* ---------------- COMMUNICATION ----------------
   rate bps; optical = needs optical ground station and clear sky; directional = needs pointing   */
const TRANSMITTERS = [
  { id: 'uhf', cat: 'comms', name: 'UHF Transceiver II', maker: 'EnduroSat', band: 'UHF 400–438 MHz', rate: 19.6e3, price: 7900, mass: 0.195, power: 5.5, idle: 1.2, volume: 0.2, stars: [1, 5, 5, 5, 5], img: 'iss066e135744',
    short: 'Slow but works at any angle and in any weather.',
    desc: 'A half-duplex UHF radio with deployable tape-measure antennas. 19.6 kbps means a 600 MB spectrometer image would take about 70 hours of passes to download, so it is really a command and telemetry link.',
    history: 'EnduroSat was founded in Sofia, Bulgaria, in 2015 and makes complete CubeSat platforms. UHF radios descend from the amateur-radio links of the first student satellites; the very first CubeSats in 2003 used them.' },
  { id: 'sband', cat: 'comms', name: 'S-Band Transceiver', maker: 'EnduroSat', band: 'S-Band 2.2–2.29 GHz', rate: 125e3, price: 17500, mass: 0.246, power: 11, idle: 1.2, volume: 0.2, stars: [1, 5, 4, 4, 4], img: 'jsc2021e044610',
    short: 'Robust S-band link with patch antennas.',
    desc: 'A small S-band radio with flat patch antennas. Weather barely affects S-band, and the wide antenna beam needs little pointing, but 125 kbps is still slow for imaging spectrometers.',
    history: 'S-band has been NASA\'s workhorse for spacecraft telemetry since Apollo, whose Unified S-Band system carried voice, TV and data from the Moon.' },
  { id: 'srs4', cat: 'comms', name: 'SRS-4 Transceiver', maker: 'Satlab / NanoAvionics', band: 'S-Band 2.2–2.29 GHz', rate: 10e6, price: 25000, priceEst: true, mass: 0.253, power: 13.5, idle: 1.5, volume: 0.25, stars: [2, 5, 4, 4, 4], img: 'iss066e135704',
    short: 'Fast S-band software radio.',
    desc: 'A software-defined S-band transceiver reaching about 10 Mbps. A good balance between speed, weather resilience and simple pointing.',
    history: 'Satlab, based in Aalborg, Denmark, grew out of the same university CubeSat community as GomSpace. NanoAvionics, from Lithuania, integrates its radios into complete small satellites.' },
  { id: 'ewc27', cat: 'comms', name: 'EWC27 X-Band Tx', maker: 'Syrlinks (Safran)', band: 'X-Band 8.025–8.45 GHz', rate: 120e6, price: 35000, priceEst: true, mass: 0.225, power: 10, idle: 0.5, volume: 0.25, directional: true, stars: [3, 4, 3, 3, 4], img: 'KSC-2009-2954',
    short: 'Compact X-band transmitter, ~120 Mbps.',
    desc: 'X-band is the standard band for Earth-observation data. The higher frequency carries far more data, but the antenna beam is narrower, so the satellite must point at the ground station during each pass.',
    history: 'Syrlinks of Rennes, France, has supplied radios to hundreds of satellites and was bought by the French aerospace group Safran in 2022.' },
  { id: 'xband', cat: 'comms', name: 'X-Band Transmitter', maker: 'EnduroSat', band: 'X-Band 8.025–8.4 GHz', rate: 150e6, price: 34300, mass: 0.396, power: 18, idle: 0.42, volume: 0.3, directional: true, stars: [3, 4, 3, 3, 3], img: 'KSC-2009-2953',
    short: 'DVB-S2 X-band downlink, 150 Mbps.',
    desc: 'Uses the DVB-S2 standard from satellite television with adaptive coding: when the link is strong it speeds up, when weak it slows down instead of dropping out.',
    history: 'DVB-S2 was created for digital satellite TV in 2005. Small-satellite companies adopted it because cheap, proven ground receivers already existed.' },
  { id: 'xlink', cat: 'comms', name: 'XLink-S SDR', maker: 'IQ Spacecom', band: 'S-Band 2.2–2.29 GHz', rate: 200e6, price: 42500, priceEst: true, mass: 0.2, power: 15, idle: 4, volume: 0.25, stars: [3, 5, 4, 3, 4], img: 'iss066e135308',
    short: 'Very fast S-band software-defined radio.',
    desc: 'A software-defined radio that squeezes high data rates out of S-band with advanced modulation, keeping S-band\'s weather tolerance and wide beam.',
    history: 'IQ Spacecom is a Berlin-based maker of small-satellite radios. Software-defined radios can be re-programmed in orbit, so a satellite\'s link can be upgraded after launch.' },
  { id: 'ewc34', cat: 'comms', name: 'EWC34 High-Speed Tx', maker: 'Syrlinks (Safran)', band: 'X-Band 8.0–8.4 GHz', rate: 600e6, price: 77500, priceEst: true, mass: 0.5, power: 22.5, idle: 0.6, volume: 0.4, directional: true, stars: [4, 4, 3, 2, 3], img: 'KSC-2009-2952',
    short: 'High-speed X-band, 600 Mbps.',
    desc: 'Dual-polarisation X-band transmitter for imaging missions that generate gigabytes every orbit.',
    history: 'Transmitters in this class serve commercial Earth-imaging constellations that downlink terabytes a day.' },
  { id: 'cubelct', cat: 'comms', name: 'CubeLCT 100M', maker: 'TESAT-Spacecom', band: 'Optical laser 1550 nm', rate: 100e6, price: 125000, priceEst: true, mass: 0.38, power: 9, idle: 2, volume: 0.3, directional: true, optical: true, stars: [3, 1, 1, 2, 4], img: 'GSFC_20171208_Archive_e001396',
    short: 'Laser downlink in a CubeSat-sized box.',
    desc: 'Sends data on an invisible 1550 nm laser beam only a few hundred metres wide at the ground. No radio licence needed and very hard to intercept, but it needs an optical ground telescope, cloud-free skies and very precise pointing.',
    history: 'TESAT-Spacecom (Backnang, Germany) built the laser terminals that link Europe\'s Sentinel satellites to the EDRS relay satellites. NASA proved laser downlinks from the Moon with LLCD on LADEE in 2013 (622 Mbps), and its TBIRD CubeSat hit 200 Gbps in 2023.' },
  { id: 'xsdr', cat: 'comms', name: 'X-Band SDR', maker: 'EnduroSat', band: 'X-Band 8.0–8.4 GHz', rate: 1e9, price: 180000, mass: 0.8, power: 30, idle: 3, volume: 0.6, directional: true, stars: [4, 4, 3, 1, 2], img: 'KSC-2009-2949',
    short: 'Gigabit X-band full-duplex software radio.',
    desc: 'A full-duplex X-band SDR exceeding 1 Gbps. Moves an entire day of spectrometer data in a single pass, but burns 30 W while transmitting.',
    history: 'Gigabit-class X-band radios used to need refrigerator-sized boxes on large satellites; shrinking them into a few CubeSat units happened only in the 2020s.' },
  { id: 'scot80', cat: 'comms', name: 'SCOT80 Laser Terminal', maker: 'TESAT-Spacecom', band: 'Optical laser 1550 nm', rate: 10e9, price: 575000, priceEst: true, mass: 11.9, power: 70, idle: 10, volume: 25, directional: true, optical: true, trap: true, stars: [5, 1, 1, 1, 1], img: 'jsc2023e064876',
    short: 'Multi-gigabit laser terminal for constellations.',
    desc: 'A large laser terminal designed for satellite-to-satellite links across 8,000 km in big constellations. Far beyond what a single methane CubeSat needs.',
    history: 'Laser crosslinks now connect satellites in large defence and commercial constellations. NASA\'s ILLUMA-T terminal (shown) linked the ISS to the LCRD relay satellite in 2023.' },
];

/* ---------------- DATA STORAGE ---------------- */
const STORAGE = [
  { id: 'nanomind', cat: 'storage', name: 'NanoMind A3200', maker: 'GomSpace', capacityMB: 128, capacityTxt: '128 MB NOR + 32 kB FRAM', iface: 'CAN / I2C / SPI', price: 5000, priceEst: true, mass: 0.024, power: 0.9, rad: 15, volume: 0.1, isOBC: true, stars: [1, 1, 1, 5, 5], img: 'jsc2022e087161',
    short: 'Tiny flight computer with a little storage.',
    desc: 'A credit-card-sized flight computer built around an AVR32 microcontroller. Also serves as the satellite\'s main computer (no separate OBC needed). 128 MB fills after a single spectrometer image.',
    history: 'GomSpace was founded in 2007 by graduates of Aalborg University in Denmark, home of some of Europe\'s first student CubeSats. The NanoMind family flew on GomSpace\'s GOMX missions and many customer satellites.' },
  { id: 'kryten', cat: 'storage', name: 'Kryten-M3', maker: 'AAC Clyde Space', capacityMB: 4096, capacityTxt: '4 GB SLC + 16 MB MRAM', iface: 'SpaceWire / SPI / LVDS', price: 12500, priceEst: true, mass: 0.062, power: 0.4, rad: 20, volume: 0.1, isOBC: true, stars: [1, 2, 2, 4, 5], img: 'KSC-20180412-PH_CSH01_0011',
    short: 'Low-power flight computer with 4 GB flash.',
    desc: 'An FPGA-based on-board computer with an ARM Cortex-M3 core, error-correcting memory and 4 GB of flash. Also acts as the main computer.',
    history: 'Clyde Space (Glasgow) built the first Scottish satellite, UKube-1 (2014), and merged with Sweden\'s ÅAC Microtec in 2018 to form AAC Clyde Space.' },
  { id: 'cfc400', cat: 'storage', name: 'CHAMPS CFC-400', maker: 'Innoflight', capacityMB: 16384, capacityTxt: '16 GB SLC + 2 GB RAM', iface: 'Gigabit Ethernet / SpaceWire', price: 35000, priceEst: true, mass: 0.25, power: 6.3, rad: 40, volume: 0.3, isOBC: true, stars: [2, 3, 3, 3, 4], img: 'KSC-20180412-PH_CSH01_0013',
    short: 'Radiation-tolerant processor and recorder.',
    desc: 'A powerful radiation-tolerant computer with gigabit networking. Enough processing to run on-board cloud screening, and enough storage for a day of observations.',
    history: 'Innoflight, based in San Diego, builds radiation-tolerant computers and radios for U.S. government and commercial small satellites.' },
  { id: 'rh3480', cat: 'storage', name: 'RH3480 SSDR', maker: 'Mercury Systems', capacityMB: 480e3, capacityTxt: '480 GB SLC', iface: 'Serial RapidIO 3.125 Gbps', price: 80000, priceEst: true, mass: 0.75, power: 25, rad: 100, volume: 0.8, stars: [3, 4, 5, 2, 3], img: 'KSC-97pc177',
    short: 'Radiation-hardened solid-state data recorder.',
    desc: 'Radiation-hardened storage that survives more than 100 krad, enough for higher orbits or very long missions. Draws up to 25 W when writing.',
    history: 'Mercury Systems, of Andover, Massachusetts, builds rugged electronics for aerospace and defence. Solid-state recorders replaced spacecraft tape recorders in the late 1990s; Hubble got its first one in 1997.' },
  { id: 'simplistor', cat: 'storage', name: 'SimpliStor SSDR', maker: 'Frontgrade', capacityMB: 2.5e6, capacityTxt: '2.5 TB pSLC', iface: '10GBASE-KR (10 Gbps)', price: 120000, priceEst: true, mass: 1.2, power: 25, rad: 40, volume: 1.5, stars: [4, 4, 3, 2, 3], img: 'KSC-99padig049',
    short: '2.5 TB recorder with 10 Gb Ethernet.',
    desc: 'Huge capacity and fast Ethernet. A 3U VPX card designed for larger small satellites.',
    history: 'Frontgrade Technologies was formed in 2023 when Cobham Advanced Electronic Solutions (CAES) changed its name; the company has supplied space electronics for decades.' },
  { id: 'spacestor', cat: 'storage', name: 'SpaceStor 4TB MMU', maker: 'Frontgrade', capacityMB: 3.97e6, capacityTxt: '3.97 TB pSLC', iface: 'PCIe Gen 2 (4 Gbps)', price: 150000, priceEst: true, mass: 1.2, power: 15, rad: 50, volume: 1.5, stars: [4, 3, 4, 2, 3], img: 'KSC-99padig050',
    short: '4 TB mass-memory unit.',
    desc: 'A mass-memory unit with almost 4 TB of flash and PCIe. Lower power than SimpliStor, better radiation tolerance.',
    history: 'Mass-memory units like this store everything a large Earth-observation satellite sees until it can reach a ground station.' },
  { id: 'moog', cat: 'storage', name: 'Scalable SSR (6U)', maker: 'Moog', capacityMB: 10e6, capacityTxt: '1–10 TB modular', iface: '10G Ethernet / optical', price: 375000, priceEst: true, mass: 4.75, power: 45, rad: 100, volume: 6, trap: true, stars: [5, 5, 5, 1, 1], img: 'KSC-97pc174',
    short: 'Modular 10 TB recorder for large satellites.',
    desc: 'A modular recorder that scales to 10 TB with optical links. Built for large flagship satellites; on a CubeSat it would take most of the mass and power budget.',
    history: 'Moog, from East Aurora, New York, has built spacecraft components since the Apollo era, from thruster valves to avionics.' },
];

// effectiveness for star-rated parts (average of non-cost ratings)
function starEff(stars) { const s = stars.filter((_, i) => i !== 3); return Math.round(s.reduce((a, b) => a + b, 0) / (s.length * 5) * 100); }
TRANSMITTERS.forEach(t => { t.eff = starEff(t.stars); t.rateTxt = t.rate >= 1e9 ? (t.rate / 1e9) + ' Gbps' : t.rate >= 1e6 ? (t.rate / 1e6) + ' Mbps' : (t.rate / 1e3) + ' kbps'; });
STORAGE.forEach(s => { s.eff = starEff(s.stars); });
const TX_STAR_LABELS = ['Downlink speed', 'Weather resilience', 'Ease of aiming', 'Cost efficiency', 'Mass & power'];
const STORAGE_STAR_LABELS = ['Capacity', 'Transfer speed', 'Radiation shielding', 'Cost efficiency', 'Mass & power'];

const PART_CATS = [
  { key: 'detector', label: 'Detectors', icon: '🔭', parts: DETECTORS, max: 3 },
  { key: 'battery', label: 'Batteries', icon: '🔋', parts: BATTERIES, max: 4 },
  { key: 'engine', label: 'Engines', icon: '🚀', parts: ENGINES, max: 4 },
  { key: 'comms', label: 'Communication', icon: '📡', parts: TRANSMITTERS, max: 2 },
  { key: 'storage', label: 'Data Storage', icon: '💾', parts: STORAGE, max: 2 },
];
const ALL_PARTS = Object.fromEntries(PART_CATS.flatMap(c => c.parts).map(p => [p.id, p]));

/* ---------------- AUTOMATIC SUBSYSTEMS (not player-selectable) ---------------- */
const AUTO = {
  wheels: [
    { id: 'rw-nano', name: 'Nano reaction wheels ×3', maxMass: 5, mass: 0.13 * 3, power: 0.6 * 3, price: 8000 * 3, momentum: 0.0015, img: 'PIA25495' },
    { id: 'rw-small', name: 'Small reaction wheels ×3', maxMass: 15, mass: 0.25 * 3, power: 1 * 3, price: 15000 * 3, momentum: 0.02, img: 'PIA25495' },
    { id: 'rw-med', name: 'Medium reaction wheels ×4', maxMass: 45, mass: 0.6 * 4, power: 2 * 4, price: 30000 * 4, momentum: 0.1, img: 'PIA25495' },
    { id: 'rw-micro', name: 'Microsat reaction wheels ×4', maxMass: 250, mass: 1.2 * 4, power: 5 * 4, price: 60000 * 4, momentum: 0.4, img: 'PIA25495' },
  ],
  magnetorquers: { name: 'Magnetorquers ×3 (wheel desaturation)', mass: 0.15, power: 0.6, price: 9000, img: 'KSC-20180412-PH_CSH01_0018' },
  starTracker: { name: 'Star tracker (fine pointing)', mass: 0.1, power: 1, price: 35000, img: 'PIA26562' },
  sunSensors: { name: 'Coarse sun sensors ×6', mass: 0.05, power: 0.2, price: 5000, img: 'PIA26562' },
  gps: { name: 'GNSS receiver', mass: 0.05, power: 0.8, price: 6000, img: 'KSC-20180412-PH_CSH01_0011' },
  obc: { name: 'On-board computer', mass: 0.08, power: 0.4, price: 8000, volume: 0.2, img: 'KSC-20180412-PH_CSH01_0018' },
  eps: { name: 'Power conditioning (EPS)', mass: 0.15, power: 0.3, price: 7000, volume: 0.3, img: 'KSC-20180411-PH_CSH01_0008' },
  thermal: { name: 'MLI blankets + heaters', mass: 0.1, power: 1.0, price: 3000, img: 'iss050e031664' },
  // bus sizes: inner volume (U), structure mass, drag area (m², average tumbling/nadir), dimensions (m)
  buses: [
    { id: '1U', name: '1U CubeSat', volume: 1, mass: 0.1, area: 0.012, dims: [0.1, 0.1, 0.1135], price: 3000 },
    { id: '3U', name: '3U CubeSat', volume: 3, mass: 0.3, area: 0.025, dims: [0.1, 0.1, 0.3405], price: 7000 },
    { id: '6U', name: '6U CubeSat', volume: 6, mass: 0.9, area: 0.05, dims: [0.226, 0.1, 0.366], price: 15000 },
    { id: '12U', name: '12U CubeSat', volume: 12, mass: 1.8, area: 0.08, dims: [0.226, 0.226, 0.366], price: 28000 },
    { id: '16U', name: '16U CubeSat', volume: 16, mass: 2.6, area: 0.1, dims: [0.226, 0.226, 0.454], price: 38000 },
    { id: 'micro', name: 'ESPA-class microsatellite', volume: 120, mass: 18, area: 0.6, dims: [0.6, 0.6, 0.8], price: 150000 },
  ],
  // solar arrays: orbit-average power (W) at ~30% efficient cells
  arrays: [
    { id: 'body', name: 'Body-mounted solar cells', wPerU: 2.2, mass: 0.05, price: 4000, deploy: 0 },   // per U of bus
    { id: 'wings2', name: 'Deployable wings ×2', watts: 36, mass: 0.6, price: 45000, deploy: 2 },
    { id: 'wings4', name: 'Deployable wings ×4', watts: 72, mass: 1.1, price: 85000, deploy: 4 },
    { id: 'wingsXL', name: 'Large deployable arrays ×2', watts: 160, mass: 2.6, price: 160000, deploy: 2, xl: true },
    { id: 'micro', name: 'Microsat solar wings', watts: 420, mass: 8, price: 380000, deploy: 2, xl: true },
  ],
};

/* ---------------- LAUNCH ---------------- */
const LAUNCH_SITES = [
  { id: 'vsfb', name: 'Vandenberg SFB, California', lat: 34.74, lon: -120.57, azimuths: [150, 210], note: 'Southward over the Pacific: polar and Sun-synchronous orbits.' },
  { id: 'ksc', name: 'Kennedy / Cape Canaveral, Florida', lat: 28.57, lon: -80.65, azimuths: [35, 140], note: 'Eastward over the Atlantic: ISS and low-inclination orbits.' },
  { id: 'mahia', name: 'Mahia Peninsula, New Zealand', lat: -39.26, lon: 177.86, azimuths: [0, 180], note: 'Wide azimuth range: anything from 39° to retrograde.' },
  { id: 'wallops', name: 'Wallops Island, Virginia', lat: 37.83, lon: -75.49, azimuths: [38, 130], note: 'NASA\'s small-rocket range: mid-inclination orbits.' },
  { id: 'kourou', name: 'Kourou, French Guiana', lat: 5.24, lon: -52.77, azimuths: [-10.5, 93.5], note: 'Near the equator: biggest boost from Earth\'s rotation.' },
];

// Stage data from public specifications (rounded). thrust in N, isp in s, masses in kg.
const ROCKETS = {
  electron: {
    name: 'Electron-class small launcher', short: 'Small launcher', height: 18, diameter: 1.2, cd: 0.32, area: 1.13,
    stages: [
      { name: 'Stage 1', dry: 950, prop: 9250, thrustSL: 162e3, thrustVac: 192e3, ispSL: 303, ispVac: 311, engines: 9, minThrottle: 0.6, restarts: 0, color: '#1b1b1f' },
      { name: 'Stage 2', dry: 250, prop: 2050, thrustSL: 22e3, thrustVac: 25.8e3, ispSL: 280, ispVac: 343, engines: 1, minThrottle: 0.4, restarts: 3, color: '#1b1b1f' },
    ],
    fairing: 50, reliability: 0.94,
  },
  f9: {
    name: 'Falcon 9-class medium launcher', short: 'Medium launcher', height: 70, diameter: 3.7, cd: 0.3, area: 10.75,
    stages: [
      { name: 'Booster', dry: 25600, prop: 395700, thrustSL: 7607e3, thrustVac: 8227e3, ispSL: 282, ispVac: 311, engines: 9, minThrottle: 0.4, restarts: 3, reusable: true, color: '#f2f2f2' },
      { name: 'Second stage', dry: 3900, prop: 92670, thrustSL: 800e3, thrustVac: 981e3, ispSL: 200, ispVac: 348, engines: 1, minThrottle: 0.39, restarts: 3, color: '#f2f2f2' },
    ],
    fairing: 1900, reliability: 0.99,
  },
};

const LAUNCH_OPTIONS = [
  { id: 'rideshare', name: 'Rideshare slot', rocket: 'f9', site: 'vsfb', targetAlt: 525, targetInc: 'sso', perKg: 6500, minPrice: 40000, cadenceDays: 120, leadDays: 30, extraPayload: 5000,
    desc: 'Buy a slot on a Transporter-style rideshare to Sun-synchronous orbit. Cheapest per kilogram, fixed date and orbit (≈525 km SSO from Vandenberg). You fly the shared rocket; other customers are on board, so the autopilot will hold the manifest orbit unless you override.' },
  { id: 'iss', name: 'ISS cargo + CubeSat deployer', rocket: 'f9', site: 'ksc', targetAlt: 415, targetInc: 51.6, perU: 60000, minPrice: 60000, cadenceDays: 90, leadDays: 45, cubesatOnly: true, extraPayload: 12000,
    desc: 'Your CubeSat rides to the ISS in a cargo ship and is pushed out of the Japanese airlock deployer. Low orbit (≈415 km, 51.6°): sharp images but short life from drag, and it cannot see the Arctic.' },
  { id: 'dedicated', name: 'Dedicated small launcher', rocket: 'electron', site: 'mahia', price: 7500000, cadenceDays: 0, leadDays: 45, maxPayload: 300, anySite: true,
    desc: 'A whole Electron-class rocket for your satellites: any orbit, any date after 45 days of preparation, full manual control. Can carry several satellites to build a constellation.' },
  { id: 'medium', name: 'Dedicated medium launcher', rocket: 'f9', site: 'vsfb', price: 69750000, cadenceDays: 0, leadDays: 90, maxPayload: 15000, anySite: true,
    desc: 'A Falcon 9-class rocket all to yourself. Massive capacity for deploying a whole constellation in one go, and the booster can land and be reused.' },
];

/* ---------------- GROUND STATIONS (real sites) ---------------- */
const GROUND_STATIONS = [
  { id: 'sval', name: 'Svalbard (SvalSat)', lat: 78.23, lon: 15.39, optical: false },
  { id: 'troll', name: 'Troll, Antarctica', lat: -72.01, lon: 2.54, optical: false },
  { id: 'fair', name: 'Fairbanks, Alaska', lat: 64.86, lon: -147.85, optical: false },
  { id: 'kir', name: 'Kiruna, Sweden', lat: 67.86, lon: 20.96, optical: false },
  { id: 'wal', name: 'Wallops, Virginia', lat: 37.94, lon: -75.46, optical: false },
  { id: 'hart', name: 'Hartebeesthoek, South Africa', lat: -25.89, lon: 27.69, optical: false },
  { id: 'punta', name: 'Punta Arenas, Chile', lat: -52.94, lon: -70.85, optical: false },
  { id: 'hawaii', name: 'South Point, Hawaii', lat: 19.01, lon: -155.66, optical: false },
  { id: 'dongara', name: 'Dongara, Australia', lat: -29.05, lon: 115.35, optical: false },
  { id: 'mcm', name: 'McMurdo, Antarctica', lat: -77.85, lon: 166.67, optical: false },
  { id: 'octl', name: 'Table Mountain OCTL (optical)', lat: 34.38, lon: -117.68, optical: true },
  { id: 'hale', name: 'Haleakalā (optical)', lat: 20.71, lon: -156.26, optical: true },
  { id: 'ogs', name: 'Tenerife ESA OGS (optical)', lat: 28.30, lon: -16.51, optical: true },
];
const GS_PER_MIN = 10;   // USD per minute of ground-station downlink time (commercial network pricing, simplified)

/* ---------------- EMISSION SITES ----------------
   rate: background emissions of the region in t/h (feeds the national total)
   leakRate: expected new super-emitter events per year; fix: months to repair after a report
   cloud: average cloud fraction; iso: ISO 3166 numeric of the country                     */
const SITE_TYPES = {
  oilgas: { label: 'Oil & gas', color: '#ff8a3d', fixMonths: [1, 4], fixShare: 0.95 },
  coal: { label: 'Coal mine', color: '#a1887f', fixMonths: [12, 36], fixShare: 0.5 },
  landfill: { label: 'Landfill', color: '#c0ca33', fixMonths: [6, 24], fixShare: 0.6 },
  agriculture: { label: 'Agriculture', color: '#66bb6a', fixMonths: [24, 60], fixShare: 0.25 },
  wetland: { label: 'Wetland (natural)', color: '#4fc3f7', fixMonths: null, fixShare: 0 },
  permafrost: { label: 'Permafrost (natural)', color: '#b39ddb', fixMonths: null, fixShare: 0 },
};
const SITES = [
  { id: 'permian', name: 'Permian Basin', lat: 31.9, lon: -102.5, type: 'oilgas', iso: 840, leakRate: 14, cloud: 0.25 },
  { id: 'marcellus', name: 'Appalachian / Marcellus', lat: 41.0, lon: -77.5, type: 'oilgas', iso: 840, leakRate: 5, cloud: 0.6 },
  { id: 'sanjuan', name: 'San Juan Basin (Four Corners)', lat: 36.8, lon: -108.2, type: 'oilgas', iso: 840, leakRate: 4, cloud: 0.25 },
  { id: 'bakken', name: 'Bakken', lat: 47.9, lon: -103.3, type: 'oilgas', iso: 840, leakRate: 4, cloud: 0.5 },
  { id: 'cv', name: 'California Central Valley dairies', lat: 36.4, lon: -119.8, type: 'agriculture', iso: 840, leakRate: 2, cloud: 0.2 },
  { id: 'montney', name: 'Montney / NE British Columbia', lat: 56.0, lon: -120.5, type: 'oilgas', iso: 124, leakRate: 3, cloud: 0.6 },
  { id: 'hudson', name: 'Hudson Bay Lowlands', lat: 55.0, lon: -85.0, type: 'wetland', iso: 124, leakRate: 0, cloud: 0.65 },
  { id: 'northslope', name: 'Alaska North Slope', lat: 69.5, lon: -150.0, type: 'permafrost', iso: 840, leakRate: 0, cloud: 0.7 },
  { id: 'cantarell', name: 'Bay of Campeche offshore', lat: 19.4, lon: -92.0, type: 'oilgas', iso: 484, leakRate: 4, cloud: 0.5, offshore: true },
  { id: 'maracaibo', name: 'Lake Maracaibo', lat: 10.0, lon: -71.6, type: 'oilgas', iso: 862, leakRate: 6, cloud: 0.55 },
  { id: 'vacamuerta', name: 'Vaca Muerta', lat: -38.5, lon: -69.0, type: 'oilgas', iso: 32, leakRate: 3, cloud: 0.3 },
  { id: 'bsas', name: 'Buenos Aires Norte III landfill', lat: -34.53, lon: -58.6, type: 'landfill', iso: 32, leakRate: 2, cloud: 0.45 },
  { id: 'amazon', name: 'Central Amazon floodplain', lat: -3.5, lon: -60.0, type: 'wetland', iso: 76, leakRate: 0, cloud: 0.8 },
  { id: 'pantanal', name: 'Pantanal', lat: -17.5, lon: -57.0, type: 'wetland', iso: 76, leakRate: 0, cloud: 0.5 },
  { id: 'brcattle', name: 'Mato Grosso cattle', lat: -13.0, lon: -55.5, type: 'agriculture', iso: 76, leakRate: 2, cloud: 0.55 },
  { id: 'madrid', name: 'Madrid Valdemingómez landfill', lat: 40.33, lon: -3.62, type: 'landfill', iso: 724, leakRate: 1, cloud: 0.35 },
  { id: 'silesia', name: 'Upper Silesia coal', lat: 50.2, lon: 19.0, type: 'coal', iso: 616, leakRate: 3, cloud: 0.65 },
  { id: 'hassirmel', name: 'Hassi R\'Mel gas field', lat: 32.9, lon: 3.3, type: 'oilgas', iso: 12, leakRate: 5, cloud: 0.15 },
  { id: 'hassimess', name: 'Hassi Messaoud', lat: 31.7, lon: 6.1, type: 'oilgas', iso: 12, leakRate: 4, cloud: 0.12 },
  { id: 'libya', name: 'Sirte Basin', lat: 29.0, lon: 19.0, type: 'oilgas', iso: 434, leakRate: 3, cloud: 0.1 },
  { id: 'nigerdelta', name: 'Niger Delta', lat: 5.0, lon: 6.5, type: 'oilgas', iso: 566, leakRate: 6, cloud: 0.75 },
  { id: 'lagos', name: 'Lagos Olusosun landfill', lat: 6.6, lon: 3.38, type: 'landfill', iso: 566, leakRate: 1, cloud: 0.7 },
  { id: 'sudd', name: 'Sudd wetland', lat: 7.5, lon: 30.5, type: 'wetland', iso: 728, leakRate: 0, cloud: 0.5 },
  { id: 'congo', name: 'Cuvette Centrale (Congo Basin)', lat: 0.0, lon: 18.0, type: 'wetland', iso: 180, leakRate: 0, cloud: 0.8 },
  { id: 'rumaila', name: 'Rumaila (Basra)', lat: 30.5, lon: 47.3, type: 'oilgas', iso: 368, leakRate: 5, cloud: 0.1 },
  { id: 'southpars', name: 'South Pars / Asaluyeh', lat: 27.5, lon: 52.6, type: 'oilgas', iso: 364, leakRate: 5, cloud: 0.15 },
  { id: 'ghawar', name: 'Eastern Province fields', lat: 25.4, lon: 49.6, type: 'oilgas', iso: 682, leakRate: 2, cloud: 0.1 },
  { id: 'tkmcoast', name: 'Turkmenistan Caspian coast', lat: 39.4, lon: 53.4, type: 'oilgas', iso: 795, leakRate: 9, cloud: 0.15 },
  { id: 'galkynysh', name: 'Galkynysh gas field', lat: 37.5, lon: 62.3, type: 'oilgas', iso: 795, leakRate: 7, cloud: 0.12 },
  { id: 'mubarek', name: 'Mubarek gas region', lat: 39.25, lon: 65.25, type: 'oilgas', iso: 860, leakRate: 4, cloud: 0.15 },
  { id: 'tengiz', name: 'Tengiz / Atyrau', lat: 46.15, lon: 53.4, type: 'oilgas', iso: 398, leakRate: 4, cloud: 0.3 },
  { id: 'urengoy', name: 'Urengoy gas field', lat: 66.0, lon: 76.7, type: 'oilgas', iso: 643, leakRate: 6, cloud: 0.7, tundra: true },
  { id: 'yamal', name: 'Yamal Peninsula', lat: 70.0, lon: 70.0, type: 'oilgas', iso: 643, leakRate: 4, cloud: 0.7, tundra: true },
  { id: 'kuzbass', name: 'Kuzbass coal basin', lat: 54.0, lon: 87.0, type: 'coal', iso: 643, leakRate: 4, cloud: 0.6 },
  { id: 'siberia', name: 'Kolyma thermokarst lakes', lat: 68.5, lon: 161.4, type: 'permafrost', iso: 643, leakRate: 0, cloud: 0.6 },
  { id: 'wsib', name: 'West Siberian peatlands', lat: 62.0, lon: 75.0, type: 'wetland', iso: 643, leakRate: 0, cloud: 0.65 },
  { id: 'shanxi', name: 'Shanxi coal mines', lat: 37.8, lon: 112.5, type: 'coal', iso: 156, leakRate: 8, cloud: 0.4 },
  { id: 'ordos', name: 'Ordos / Inner Mongolia coal', lat: 39.6, lon: 109.8, type: 'coal', iso: 156, leakRate: 5, cloud: 0.3 },
  { id: 'sichuan', name: 'Sichuan Basin rice & gas', lat: 30.6, lon: 104.0, type: 'agriculture', iso: 156, leakRate: 2, cloud: 0.8 },
  { id: 'jharia', name: 'Jharia coalfield', lat: 23.75, lon: 86.4, type: 'coal', iso: 356, leakRate: 3, cloud: 0.5 },
  { id: 'delhi', name: 'Delhi Ghazipur landfill', lat: 28.62, lon: 77.33, type: 'landfill', iso: 356, leakRate: 2, cloud: 0.35 },
  { id: 'mumbai', name: 'Mumbai Deonar landfill', lat: 19.07, lon: 72.92, type: 'landfill', iso: 356, leakRate: 2, cloud: 0.5 },
  { id: 'punjab', name: 'Punjab livestock & rice', lat: 31.0, lon: 75.5, type: 'agriculture', iso: 356, leakRate: 2, cloud: 0.35 },
  { id: 'lahore', name: 'Lahore landfill & livestock', lat: 31.5, lon: 74.3, type: 'landfill', iso: 586, leakRate: 2, cloud: 0.35 },
  { id: 'bangladesh', name: 'Ganges delta rice paddies', lat: 23.7, lon: 90.4, type: 'agriculture', iso: 50, leakRate: 1, cloud: 0.6 },
  { id: 'kalimantan', name: 'Kalimantan peat & oil', lat: -1.5, lon: 116.0, type: 'oilgas', iso: 360, leakRate: 3, cloud: 0.8 },
  { id: 'bowen', name: 'Bowen Basin coal', lat: -22.0, lon: 148.0, type: 'coal', iso: 36, leakRate: 4, cloud: 0.3 },
  { id: 'surat', name: 'Surat Basin coal-seam gas', lat: -27.0, lon: 150.5, type: 'oilgas', iso: 36, leakRate: 2, cloud: 0.3 },
];

/* National methane emissions (Mt CH4 per year, approximate 2020s values rounded from
   EDGAR and the IEA Global Methane Tracker; for gameplay, not citation). ISO numeric keys. */
const COUNTRY_CH4 = {
  156: 65, 356: 31, 840: 28, 643: 33, 76: 21, 360: 15, 364: 10, 586: 8, 566: 9, 36: 6, 484: 7, 124: 5, 32: 6, 795: 5.5,
  682: 4, 368: 5, 12: 4, 862: 4, 398: 4, 50: 5, 231: 6, 180: 6, 729: 5, 764: 5, 704: 6, 104: 4, 170: 4, 804: 3, 276: 2,
  250: 2.6, 826: 2, 818: 4, 834: 3, 792: 3, 860: 4, 434: 2, 414: 1.5, 784: 2, 634: 1.5, 608: 3, 458: 2.5, 604: 1.5, 68: 1.5,
  710: 3, 404: 2.5, 24: 2, 496: 1.5, 392: 1, 410: 1.2, 380: 1.6, 724: 1.6, 616: 2, 512: 1.2, 31: 1, 148: 2, 728: 2,
  800: 2, 466: 2, 562: 2, 450: 1.5, 508: 1.2, 894: 1.2, 120: 1.2, 600: 1.5, 858: 1, 218: 1, 4: 1.5, 524: 1, 642: 1.2,
  528: 0.8, 554: 1.3, 372: 0.6, 152: 0.6, 116: 1, 418: 0.6, 144: 0.4, 716: 1, 454: 0.5, 706: 1.5, 288: 0.8, 384: 0.8,
};

/* ---------------- COUNTRY RESPONSE PROFILES ----------------
   How each country's methane changes and how it reacts to satellite evidence.
   g    = business-as-usual emission growth per year (recent trends, rounded:
          falling in the EU/UK/Japan, flat in the US/Russia, rising in South Asia
          and Africa where farming, waste and gas use grow)
   resp = how strongly and quickly regulators act on published leak evidence
          (0.25 = slow/opaque, 1.2 = fast with strong methane rules)
   Gameplay estimates, rounded; not for citation.                              */
const COUNTRY_PROFILE = (() => {
  const P = {};
  const set = (isos, g, resp) => isos.forEach(i => { P[i] = { g, resp }; });
  set([276, 250, 826, 380, 724, 528, 372, 616, 642, 31], -0.010, 1.15);   // EU, UK & close neighbours
  set([392, 410], -0.006, 1.0);                                           // Japan, South Korea
  set([840], 0.000, 0.95); set([124], 0.000, 1.1); set([36], -0.002, 0.9); set([554], -0.002, 1.0);
  set([484, 32, 152, 170, 218, 604, 858], 0.005, 0.7);                    // Latin America (oil, gas, cattle)
  set([76], 0.008, 0.75); set([68, 600], 0.008, 0.55);
  set([156], 0.004, 0.75); set([356], 0.012, 0.6); set([360, 458, 764, 704, 608], 0.008, 0.65);
  set([50, 586, 4, 524, 104, 116, 418, 144], 0.014, 0.45);                // South & Southeast Asia, fast-growing
  set([643, 398, 795, 860, 31], 0.000, 0.35);                             // Russia & Central Asia gas producers
  set([364, 368, 434, 862, 12], 0.010, 0.3);                              // opaque oil & gas producers
  set([682, 784, 634, 414, 512], 0.008, 0.55);                            // Gulf producers (some flaring rules)
  set([566, 24, 818, 788, 792], 0.014, 0.45);
  set([231, 180, 729, 728, 834, 404, 800, 466, 562, 148, 508, 894, 120, 454, 716, 706, 288, 384], 0.022, 0.4); // Sub-Saharan Africa
  set([710], 0.002, 0.65); set([804], -0.010, 0.6); set([496], 0.015, 0.45);
  return P;
})();
// share of a country's methane that can realistically be cut, by source
// (IEA: ~70% of oil & gas methane is avoidable with existing tech; coal and waste about half; farming much less)
const ABATABLE = { oilgas: 0.7, coal: 0.5, landfill: 0.55, agriculture: 0.25, wetland: 0, permafrost: 0 };

/* ---------------- NASA MEDIA SUGGESTIONS ---------------- */
