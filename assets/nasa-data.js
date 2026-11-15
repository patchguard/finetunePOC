// NASA Data Configuration: fetch live NASA GIBS imagery (WMS) and relate it to the saved design.
const STORAGE_KEY = 'cfx.nasaData.v1';
const DESIGN_KEY = 'cfx.design.v1';
const GIBS_WMS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';

const LAYERS = [
  { id: 'MODIS_Terra_CorrectedReflectance_TrueColor', name: 'MODIS Terra — True Color', type: 'day', format: 'image/jpeg' },
  { id: 'VIIRS_SNPP_CorrectedReflectance_TrueColor', name: 'VIIRS SNPP — True Color', type: 'day', format: 'image/jpeg' },
  { id: 'MODIS_Terra_Cloud_Fraction_Day', name: 'MODIS Terra — Cloud Fraction (Day)', type: 'cloud', format: 'image/png' },
  { id: 'VIIRS_SNPP_DayNightBand_ENCC', name: 'VIIRS — Day/Night Band (Night)', type: 'night', format: 'image/png' }
];
// WMS 1.3.0 + EPSG:4326 axis order: minLat, minLon, maxLat, maxLon
const REGIONS = [
  { id: 'global',  name: 'Global',                         bbox: [-90, -180, 90, 180] },
  { id: 'permian', name: 'Permian Basin, USA (oil & gas)', bbox: [29, -106, 35, -100] },
  { id: 'turkmen', name: 'Turkmenistan (gas fields)',      bbox: [36, 52, 42, 62] },
  { id: 'amazon',  name: 'Amazon wetlands, Brazil',        bbox: [-8, -66, 0, -54] },
  { id: 'siberia', name: 'West Siberia (permafrost/gas)',  bbox: [60, 66, 70, 82] },
  { id: 'shanxi',  name: 'Shanxi, China (coal mining)',    bbox: [34, 110, 40, 115] }
];

const $ = id => document.getElementById(id);
$('layer').innerHTML = LAYERS.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
$('region').innerHTML = REGIONS.map(r => `<option value="${r.id}">${r.name}</option>`).join('');

// GIBS daily products usually lag about a day, so default to yesterday (UTC).
const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
$('date').max = yesterday;
const DEFAULTS = { layer: LAYERS[0].id, region: 'permian', date: yesterday, resolution: '1024' };

function readForm() {
  return { layer: $('layer').value, region: $('region').value, date: $('date').value || yesterday, resolution: $('resolution').value };
}

function applyForm(cfg) {
  const c = { ...DEFAULTS, ...cfg };
  $('layer').value = LAYERS.some(l => l.id === c.layer) ? c.layer : DEFAULTS.layer;
  $('region').value = REGIONS.some(r => r.id === c.region) ? c.region : DEFAULTS.region;
  $('date').value = c.date;
  $('resolution').value = ['512', '1024', '2048'].includes(c.resolution) ? c.resolution : DEFAULTS.resolution;
}

function buildUrl(cfg) {
  const layer = LAYERS.find(l => l.id === cfg.layer);
  const [minLat, minLon, maxLat, maxLon] = REGIONS.find(r => r.id === cfg.region).bbox;
  const width = Number(cfg.resolution);
  const height = Math.max(1, Math.round(width * (maxLat - minLat) / (maxLon - minLon)));
  const params = new URLSearchParams({
    SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.3.0',
    LAYERS: layer.id, STYLES: '', CRS: 'EPSG:4326',
    BBOX: [minLat, minLon, maxLat, maxLon].join(','),
    WIDTH: width, HEIGHT: height, FORMAT: layer.format, TIME: cfg.date
  });
  return `${GIBS_WMS}?${params}`;
}

function updateOutlook() {
  const layer = LAYERS.find(l => l.id === readForm().layer);
  let design = null;
  try { design = JSON.parse(localStorage.getItem(DESIGN_KEY)); } catch { /* ignore */ }
  const inst = design ? design.detector : null;
  const DETECTORS = {
    nir: 'Basic NIR Context Camera', swir: 'Wide-Swath SWIR Scanner', mwir: 'MWIR Flare & Fire Tracker',
    lwir: 'LWIR Thermal Gas Imager', zoom: 'Point-Source Zoom Spectrometer', lidar: 'Active TDLAS Methane LIDAR'
  };
  $('designText').textContent = design ? design.missionName : 'None saved';
  $('instText').textContent = DETECTORS[inst] || '—';
  $('layerType').textContent = { day: 'Daytime reflectance', cloud: 'Cloud cover', night: 'Night-time' }[layer.type];

  // Sunlight-dependent detectors are blind at night and under clouds.
  const swirOnly = ['nir', 'swir', 'zoom'].includes(inst);
  const msgs = {
    day: 'Daytime view: passive SWIR works where skies are clear. White areas are clouds that block methane retrievals.',
    cloud: swirOnly
      ? 'High cloud-fraction areas are effectively invisible to your sunlight-based detector.'
      : 'Your detector copes better with thin cloud, but thick storm cloud still limits retrievals.',
    night: swirOnly
      ? 'At night your sunlight-based detector collects no usable signal. Thermal (MWIR/LWIR) or LIDAR detectors work at night.'
      : 'Your detector can still measure on the night side.'
  };
  $('outlook').textContent = (design ? '' : 'Save a design on the Design Configuration page for a tailored outlook. ') + msgs[layer.type];
}

function loadImagery() {
  const cfg = readForm();
  $('mapTitle').textContent = `${LAYERS.find(l => l.id === cfg.layer).name} — ${REGIONS.find(r => r.id === cfg.region).name} — ${cfg.date}`;
  $('mapStatus').textContent = 'Loading imagery from NASA GIBS…';
  $('map').onload = () => { $('mapStatus').textContent = ''; };
  $('map').onerror = () => { $('mapStatus').textContent = 'Could not load imagery. Try another date or layer (not every layer has data for every date).'; };
  $('map').src = buildUrl(cfg);
  updateOutlook();
}

function toast(msg) { $('toast').textContent = msg; setTimeout(() => { $('toast').textContent = ''; }, 3000); }

$('loadBtn').onclick = loadImagery;
$('saveBtn').onclick = () => { localStorage.setItem(STORAGE_KEY, JSON.stringify(readForm())); toast('Data settings saved.'); };
['layer', 'region'].forEach(id => $(id).addEventListener('change', updateOutlook));

let saved = null;
try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { /* ignore */ }
applyForm(saved || DEFAULTS);
loadImagery();
