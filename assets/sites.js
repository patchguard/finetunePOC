// Launch sites, shared by the Design page (where the player picks one) and the NASA Data page (weather check).
// Sites in the Americas get live GOES weather; the others use yesterday's MODIS cloud data.
const LAUNCH_SITES = [
  { id: 'cape',        name: 'Cape Canaveral, USA',   lat: 28.5,  lon: -80.6,  desc: 'Florida coast, 28.5°N. Live GOES-East weather.' },
  { id: 'vandenberg',  name: 'Vandenberg, USA',       lat: 34.7,  lon: -120.6, desc: 'California coast, 34.7°N, used for polar launches. Live GOES-West weather.' },
  { id: 'kourou',      name: 'Kourou, French Guiana', lat: 5.2,   lon: -52.8,  desc: 'Near the equator, 5.2°N. Live GOES-East weather.' },
  { id: 'baikonur',    name: 'Baikonur, Kazakhstan',  lat: 45.9,  lon: 63.3,   desc: 'Inland steppe, 45.9°N. Weather from yesterday\'s MODIS data.' },
  { id: 'plesetsk',    name: 'Plesetsk, Russia',      lat: 62.9,  lon: 40.6,   desc: 'Northern Russia, 62.9°N. Weather from yesterday\'s MODIS data.' },
  { id: 'sriharikota', name: 'Sriharikota, India',    lat: 13.7,  lon: 80.2,   desc: 'India\'s east coast, 13.7°N. Weather from yesterday\'s MODIS data.' },
  { id: 'wenchang',    name: 'Wenchang, China',       lat: 19.6,  lon: 110.95, desc: 'Hainan Island, 19.6°N. Weather from yesterday\'s MODIS data.' },
  { id: 'tanegashima', name: 'Tanegashima, Japan',    lat: 30.4,  lon: 131.0,  desc: 'Southern Japan, 30.4°N. Weather from yesterday\'s MODIS data.' },
  { id: 'mahia',       name: 'Mahia Peninsula, NZ',   lat: -39.3, lon: 177.9,  desc: 'New Zealand, 39.3°S. Weather from yesterday\'s MODIS data.' }
];
