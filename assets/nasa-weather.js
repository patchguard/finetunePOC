// Launch-site weather read from live NASA GIBS imagery (no DOM code; the Design page shows the results).
// The Design page saves the result to localStorage (cfx.launch.v1) for the simulation page.
const LAUNCH_KEY = 'cfx.launch.v1';
const GIBS_TILES = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const WX_DATE = new Date(Date.now() - 864e5).toISOString().slice(0, 10); // daily layers lag ~1 day

// LAUNCH_SITES comes from assets/sites.js; the player picks the site on the Design page.

// Live GOES geostationary imagery ("default" time = latest image, about 10 minutes old).
const GOES = { east: { name: 'GOES-East', minLon: -110, maxLon: -20 }, west: { name: 'GOES-West', minLon: -180, maxLon: -110 } };
const goesFor = lon => lon >= -110 && lon <= -20 ? 'east' : lon >= -180 && lon < -110 ? 'west' : null;
const goesUrl = (sat, layer, level) =>
  `${GIBS_TILES}/GOES-${sat === 'east' ? 'East' : 'West'}_ABI_${layer}/default/default/GoogleMapsCompatible_Level${level}/{z}/{y}/{x}.png`;
const MODIS_CLOUD = `${GIBS_TILES}/MODIS_Terra_Cloud_Fraction_Day/default/${WX_DATE}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`;
const MODIS_TRUE = `${GIBS_TILES}/MODIS_Terra_CorrectedReflectance_TrueColor/default/${WX_DATE}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;

// Official GIBS colour key for MODIS Cloud Fraction (colormaps/v1.3/MODIS_Cloud_Fraction.xml), middle of each band.
const CLOUD_COLORMAP = [
  { rgb: [183, 15, 141], v: 0.08 }, { rgb: [0, 0, 170], v: 0.21 }, { rgb: [0, 136, 238], v: 0.34 },
  { rgb: [0, 136, 0], v: 0.47 }, { rgb: [255, 255, 0], v: 0.6 }, { rgb: [187, 136, 0], v: 0.72 }, { rgb: [110, 0, 0], v: 0.85 }
];
const brightness = ([r, g, b]) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;
const saturation = ([r, g, b]) => (Math.max(r, g, b) - Math.min(r, g, b)) / 255;

function cloudFromPixel(px) {
  if (!px || px[3] === 0) return 0; // transparent = no cloud reported
  return CLOUD_COLORMAP.reduce((best, c) => {
    const d = (px[0] - c.rgb[0]) ** 2 + (px[1] - c.rgb[1]) ** 2 + (px[2] - c.rgb[2]) ** 2;
    return d < best.d ? { d, v: c.v } : best;
  }, { d: Infinity, v: 0 }).v;
}

function lonLatToTile(lat, lon, z) {
  const n = 2 ** z, r = lat * Math.PI / 180;
  const fx = (lon + 180) / 360 * n, fy = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n;
  return { x: Math.floor(fx), y: Math.floor(fy), px: Math.floor((fx % 1) * 256), py: Math.floor((fy % 1) * 256) };
}

// Loads the 256×256 tile containing (lat, lon) onto a canvas. Resolves null if unavailable.
function loadTile(tpl, lat, lon, z) {
  const t = lonLatToTile(lat, lon, z);
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      canvas.getContext('2d').drawImage(img, 0, 0);
      resolve({ canvas, t });
    };
    img.onerror = () => resolve(null);
    img.src = tpl.replace('{z}', z).replace('{y}', t.y).replace('{x}', t.x);
  });
}
async function samplePixel(tpl, lat, lon, z) {
  const tile = await loadTile(tpl, lat, lon, z);
  return tile ? Array.from(tile.canvas.getContext('2d').getImageData(tile.t.px, tile.t.py, 1, 1).data) : null;
}

// Returns { source, cloud 0..1, storm, wind m/s, live }.
async function readWeather(lat, lon) {
  const sat = goesFor(lon);
  let cloud = null, storm = false, source = '';
  if (sat) {
    const ir = await samplePixel(goesUrl(sat, 'Band13_Clean_Infrared', 6), lat, lon, 5);
    if (ir && ir[3] > 0) {
      cloud = Math.min(1, Math.max(0, (brightness(ir) - 0.35) / 0.5)); // estimate: brighter IR = colder cloud
      storm = saturation(ir) > 0.35; // coloured IR = very cold storm tops
      source = `${GOES[sat].name} Clean Infrared (live)`;
    }
  }
  if (cloud == null) {
    const px = await samplePixel(MODIS_CLOUD, lat, lon, 4);
    if (px) { cloud = cloudFromPixel(px); source = `MODIS Terra Cloud Fraction (${WX_DATE})`; }
  }
  if (cloud == null) { cloud = Math.random() * 0.6; source = 'No NASA data here: simulated'; }
  // GIBS has no live upper-level wind, so wind is simulated (cloudier skies → windier).
  const wind = +(3 + cloud * 12 + Math.random() * 6).toFixed(1);
  return { source, cloud: +cloud.toFixed(2), storm, wind, live: source.includes('live') };
}

// Simplified launch commit criteria → verdict and failure risk.
function judgeWeather(w) {
  const reasons = [];
  if (w.storm) reasons.push('Thunderstorm cloud tops nearby (lightning risk)');
  if (w.cloud > 0.75) reasons.push(`Thick cloud cover (${Math.round(w.cloud * 100)}%)`);
  if (w.wind > 15) reasons.push(`High winds (${w.wind} m/s)`);
  if (reasons.length) return { verdict: 'NO-GO', risk: 0.35, reasons };
  if (w.cloud > 0.5 || w.wind > 11) return { verdict: 'HOLD', risk: 0.1, reasons: ['Marginal clouds or wind'] };
  return { verdict: 'GO', risk: 0.02, reasons: ['Weather within limits'] };
}
