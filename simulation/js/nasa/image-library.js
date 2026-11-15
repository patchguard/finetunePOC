/* =========================================================================
   NASA Image and Video Library
   https://images.nasa.gov  ·  API: https://images-api.nasa.gov  (no key needed)

   Used by:
   - Launch planner (view-launch.js): one photo per launch option, found with
     a search such as "Falcon 9 Vandenberg launch". The first result that has a
     thumbnail is shown; thumbnails come from images-assets.nasa.gov.

   Every NASA URL this page requests is listed in NASA_DATA_SOURCES.txt (in the Project folder, next to NasaApp_2026_SpaceMissionDesign).
   ========================================================================= */

const NASA_IMAGES = (() => {
  const API = 'https://images-api.nasa.gov';
  const cache = {};

  // Search queries for the launch-option photos (tried in order until one returns a thumbnail)
  const LAUNCH_PHOTO_QUERIES = {
    rideshare: ['Falcon 9 Vandenberg launch', 'Falcon 9 launch'],
    iss: ['CubeSat deploy International Space Station', 'NanoRacks CubeSat'],
    dedicated: ['Electron rocket launch', 'Rocket Lab Electron'],
    medium: ['Falcon 9 launch Vandenberg', 'Falcon 9'],
  };

  async function search(q, mediaType = 'image', page = 1) {
    const key = `${q}|${mediaType}|${page}`;
    if (cache[key]) return cache[key];
    const res = await fetch(`${API}/search?q=${encodeURIComponent(q)}&media_type=${mediaType}&page=${page}`);
    if (!res.ok) throw new Error('NASA Image Library ' + res.status);
    const j = await res.json();
    const items = j.collection.items.map(it => {
      const d = it.data[0] || {};
      return { id: d.nasa_id, title: d.title, date: (d.date_created || '').slice(0, 10), center: d.center, thumb: it.links && it.links[0] ? it.links[0].href : null };
    });
    return (cache[key] = { total: j.collection.metadata.total_hits, items });
  }

  // First search result with a thumbnail, trying each query in turn (null if offline / nothing found)
  async function firstPhoto(queries) {
    for (const q of queries) {
      try {
        const it = (await search(q, 'image')).items.find(i => i.thumb);
        if (it) return it;
      } catch { /* offline: try the next query */ }
    }
    return null;
  }

  return { search, firstPhoto, LAUNCH_PHOTO_QUERIES };
})();
