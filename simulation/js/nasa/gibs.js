/* =========================================================================
   NASA GIBS (Global Imagery Browse Services)
   https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api
   No API key needed; CORS enabled.

   Used by:
   - Methane Emissions map (view-map.js): WMTS tiles for base maps and overlays,
     plus legend SVGs.
   - Orbit Viewer (view-orbit.js) and the 3D launch view (flight-scene.js):
     WMS GetMap whole-Earth images that wrap the 3D globe (day, night, methane).
   - 3D launch view (flight-scene.js): a WMS GetMap image of the region around
     the launch site, used as the ground near the pad.

   Every NASA URL this page requests is listed in NASA_DATA_SOURCES.txt (in the Project folder, next to NasaApp_2026_SpaceMissionDesign).
   ========================================================================= */

const NASA_GIBS = (() => {
  const WMTS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
  const WMS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';
  const LEGENDS = 'https://gibs.earthdata.nasa.gov/legends';

  const isoDay = off => new Date(Date.now() - off * 864e5).toISOString().slice(0, 10);

  // time: 'daily' = user-picked date (default yesterday), 'none' = static layer,
  // 'default' = GIBS picks the latest available, or a fixed ISO date.
  const LAYERS = {
    truecolor: { title: 'True Color (VIIRS NOAA-20)', id: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor', tms: 'GoogleMapsCompatible_Level9', ext: 'jpg', max: 9, time: 'daily', base: true },
    bluemarble: { title: 'Blue Marble', id: 'BlueMarble_ShadedRelief_Bathymetry', tms: 'GoogleMapsCompatible_Level8', ext: 'jpeg', max: 8, time: 'none', base: true },
    night: { title: 'Night Lights', id: 'VIIRS_Black_Marble', tms: 'GoogleMapsCompatible_Level8', ext: 'png', max: 8, time: '2016-01-01', base: true },
    methane: { title: 'AIRS Methane (real, monthly)', id: 'AIRS_L3_Methane_400hPa_Volume_Mixing_Ratio_Monthly_Day', tms: 'GoogleMapsCompatible_Level6', ext: 'png', max: 6, time: 'default', opacity: 0.55, legend: 'AIRS_Methane_Volume_Mixing_Ratio_H' },
    co: { title: 'AIRS Carbon Monoxide', id: 'AIRS_L3_Carbon_Monoxide_500hPa_Volume_Mixing_Ratio_Monthly_Day', tms: 'GoogleMapsCompatible_Level6', ext: 'png', max: 6, time: 'default', opacity: 0.6, legend: 'AIRS_Carbon_Monoxide_Volume_Mixing_Ratio_H' },
    sst: { title: 'Sea Surface Temperature', id: 'GHRSST_L4_MUR_Sea_Surface_Temperature', tms: 'GoogleMapsCompatible_Level7', ext: 'png', max: 7, time: 'default', opacity: 0.7, legend: 'GHRSST_Sea_Surface_Temperature_H' },
    lst: { title: 'Land Surface Temp (day)', id: 'MODIS_Terra_Land_Surface_Temp_Day', tms: 'GoogleMapsCompatible_Level7', ext: 'png', max: 7, time: 'default', opacity: 0.65 },
    clouds: { title: 'Cloud Fraction (AIRS)', id: 'AIRS_L2_Total_Cloud_Fraction_Day', tms: 'GoogleMapsCompatible_Level6', ext: 'png', max: 6, time: 'default', opacity: 0.5 },
    labels: { title: 'Borders & Labels', id: 'Reference_Labels_15m', tms: 'GoogleMapsCompatible_Level13', ext: 'png', max: 9, time: 'none' },
  };

  // Whole-Earth images for the 3D globe (WMS, EPSG:4326, equirectangular)
  const GLOBE = {
    day: { id: 'BlueMarble_ShadedRelief_Bathymetry', width: 4096, height: 2048, format: 'image/jpeg' },
    night: { id: 'VIIRS_Black_Marble', width: 2048, height: 1024, format: 'image/png', time: '2016-01-01' },
    methane: { id: 'AIRS_L3_Methane_400hPa_Volume_Mixing_Ratio_Monthly_Day', width: 1024, height: 512, format: 'image/png' },
  };

  function tileUrl(key, date) {
    const L0 = LAYERS[key];
    let time = L0.time;
    if (time === 'daily') time = date || isoDay(1);
    return `${WMTS}/${L0.id}/default/${time === 'none' ? '' : time + '/'}${L0.tms}/{z}/{y}/{x}.${L0.ext}`;
  }

  function leafletLayer(key, date) {
    const L0 = LAYERS[key];
    return L.tileLayer(tileUrl(key, date), {
      maxNativeZoom: L0.max, maxZoom: 10, opacity: L0.opacity ?? 1, crossOrigin: true,
      bounds: [[-85.0511, -180], [85.0511, 180]],
      attribution: '<a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener">NASA GIBS</a>',
    });
  }

  const legendUrl = key => LAYERS[key].legend ? `${LEGENDS}/${LAYERS[key].legend}.svg` : null;

  function globeImage(key) {
    const g = GLOBE[key];
    const p = new URLSearchParams({ SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.3.0', LAYERS: g.id, CRS: 'EPSG:4326', BBOX: '-90,-180,90,180', WIDTH: g.width, HEIGHT: g.height, FORMAT: g.format, STYLES: '' });
    if (g.time) p.set('TIME', g.time);
    if (g.format === 'image/png') p.set('TRANSPARENT', 'TRUE');
    return `${WMS}?${p}`;
  }

  // Regional image around a launch site for the 3D launch view's ground (WMS, EPSG:4326 lat/lon box)
  function regionImage(minLat, minLon, maxLat, maxLon, width = 2048) {
    const height = Math.max(256, Math.round(width * (maxLat - minLat) / (maxLon - minLon)));
    const p = new URLSearchParams({ SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.3.0', LAYERS: 'BlueMarble_ShadedRelief_Bathymetry', CRS: 'EPSG:4326',
      BBOX: [minLat, minLon, maxLat, maxLon].map(v => v.toFixed(3)).join(','), WIDTH: width, HEIGHT: Math.min(4096, height), FORMAT: 'image/jpeg', STYLES: '' });
    return `${WMS}?${p}`;
  }

  return { LAYERS, GLOBE, tileUrl, leafletLayer, legendUrl, globeImage, regionImage, isoDay };
})();
