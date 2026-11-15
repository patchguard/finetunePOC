// Hover notes for the Design page: a simple, plain-language meaning of each part's traits.
// Shown when hovering a part in Hardware, Selected Parts, Build Overview bars or the satellite diagram.
// Needs OPTIONS, LABELS (and RATINGS if present) from parts.js. Launch sites use their own desc from sites.js.

// What each category does, in one line.
const CATEGORY_NOTES = {
  battery: 'Batteries store solar power so the satellite keeps working on Earth\'s night side. Wh = how much energy it holds (a phone battery is about 15 Wh).',
  thruster: 'Thrusters are small engines that keep the satellite in its orbit and turn it to aim the instruments.',
  storage: 'Storage holds your measurements until the satellite flies over a ground station and can send them down.',
  transmitter: 'The transmitter sends your data down to Earth. Faster means more data delivered per pass.',
  detector: 'The detector is the instrument that actually finds methane. It is the most important choice for the mission.',
  site: 'Where the rocket launches from. Today\'s weather there can delay or cancel the launch.'
};

// Simple meaning of each part's traits.
const NOTES = {
  battery: {
    nicd: 'Old, heavy and cheap. Holds very little energy (20 Wh) and wears out within a year. Cannot power hungry parts like LIDAR, LWIR or laser radios.',
    nih2: 'Lasts a very long time but is heavy. Holds 50 Wh. Its weight drags your orbit lower unless your thruster is strong (Hydrazine or better).',
    liion40: 'Small and light (40 Wh). Fine for simple sensors, but it should only be drained 30% each orbit, so power-hungry parts make it run flat at night.',
    liion100: 'A reliable all-rounder (100 Wh). Enough for most designs, but not for LIDAR and a laser radio running at the same time.',
    solid: 'Light and powerful prototype (150 Wh). High risk: a 15% chance some cells fail in space and you lose half its capacity.',
    ves: 'A huge space-grade battery (1,000 Wh) that lasts 12+ years. Very heavy (6.5 kg), so it needs at least a Hydrazine thruster.',
    rtg: 'Nuclear power: makes 100 W all the time, day or night, with no sunlight needed. Extremely expensive and very heavy (45 kg).'
  },
  thruster: {
    coldgas: 'Puffs of compressed nitrogen. Cheap but weak: cannot reach polar orbits, cannot aim precise instruments or dish antennas, and only handles light satellites.',
    resistojet: 'Heats water with electricity to push. It borrows battery power, so with a small battery you get brownouts (power cuts).',
    hydrazine: 'Classic rocket fuel. Strong enough for polar orbits and steady aiming, but the fuel runs out after about 3 years.',
    ascent: 'A modern, non-toxic fuel. Keeps the satellite in orbit for about 5 years and aims well.',
    electrospray: 'Tiny ion jets that sip fuel for 10+ years. The push is very gentle, so heavy satellites turn slowly.',
    dualmode: 'Two thrusters in one: a quick chemical burst for aiming plus an efficient electric mode that lasts 10 years.',
    hall: 'A powerful plasma engine that keeps heavy satellites in orbit for 10+ years. Needs a battery of 100 Wh or more.'
  },
  storage: {
    a3200: 'Tiny memory (128 MB, like an old USB stick). Cheap and light, but fills up fast and is easily damaged by space radiation.',
    kryten: '4 GB of memory. Small and power-efficient, with a little radiation protection.',
    cfc400: '16 GB with a fast connection and decent radiation protection. A balanced choice.',
    rh3480: '480 GB with the toughest radiation protection. Expensive and uses more power.',
    simplistor: '2.5 TB with very fast transfers. Large and power-hungry, with average radiation protection.',
    spacestor: 'Almost 4 TB with good radiation protection and lower power use than similar units.',
    moog: 'Up to 10 TB, the fastest and toughest, but big, heavy, power-hungry and very expensive.'
  },
  transmitter: {
    uhf: 'A simple radio. Very slow (like dial-up internet) but cheap, reliable in any weather, and needs no aiming.',
    sband: 'A slightly faster radio. Still slow, but works in all weather and is easy to point.',
    srs4: 'A good radio for small satellites (10 Mbps). Works in any weather.',
    ewc27: 'An X-Band dish: fast (100+ Mbps) but must be pointed at the ground station, so it needs a steady thruster.',
    xband: 'A fast X-Band dish (150 Mbps). Needs careful aiming and uses a fair bit of power.',
    xlink: 'A fast S-Band radio (200 Mbps) that copes well with weather and is easy to aim.',
    ewc34: 'A very fast X-Band dish (600 Mbps). Expensive and power-hungry, and it needs good aiming.',
    cubelct: 'A laser link: sends data with light. Fast, but clouds block it and it needs very precise aiming.',
    xsdr: 'An extremely fast X-Band radio (1+ Gbps). Very expensive and uses a lot of power.',
    scot80: 'A huge laser terminal (up to 100 Gbps). The fastest option, but clouds block it, it is heavy, and it costs a fortune.'
  },
  detector: {
    nir: 'A basic camera that takes daytime photos to tell what a site is (a factory, a farm). It cannot see methane itself.',
    swir: 'Scans wide strips of land to spot big methane areas. Needs sunlight and clear skies, so it is blind at night and under clouds.',
    mwir: 'Sees heat from flares, fires and hot gas, day or night. Thin smoke is fine, but thick storm clouds block it.',
    lwir: 'Reads heat signatures of methane plumes day and night. Less accurate over frozen tundra or oceans.',
    zoom: 'A sharp spectrometer that pinpoints the exact leaking facility. Needs clear skies and precise steering.',
    lidar: 'Fires its own laser, so it finds methane day or night, over land or sea, with no false alarms. Heavy and very power-hungry.'
  }
};

// Plain words for the rating colours.
const ratingWord = v => (v >= 75 ? 'Strong' : v >= 50 ? 'OK' : 'Weak');

function noteHtml(cat, id) {
  const esc = t => String(t).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const part = OPTIONS[cat] && OPTIONS[cat].find(o => o.id === id);
  if (!part) return '';
  const meaning = cat === 'site' ? part.desc : (NOTES[cat] && NOTES[cat][id]) || part.desc;
  const r = typeof RATINGS !== 'undefined' && RATINGS[cat] ? RATINGS[cat][id] : null;
  return `<div class="note-title">${esc(part.name)}</div>`
    + (r != null ? `<div class="note-rating">${ratingWord(r)} · ${r}%</div>` : '')
    + `<p>${esc(meaning)}</p>`
    + `<p class="note-cat">${esc(LABELS[cat] || '')}: ${esc(CATEGORY_NOTES[cat] || '')}</p>`;
}

// One floating note, shown for any element with data-note-cat and data-note-id.
const noteBox = document.createElement('div');
noteBox.className = 'part-note';
noteBox.setAttribute('role', 'tooltip');
noteBox.hidden = true;
document.body.appendChild(noteBox);

function placeNote(x, y) {
  const pad = 14, w = noteBox.offsetWidth, h = noteBox.offsetHeight;
  let left = x + pad, top = y + pad;
  if (left + w > window.innerWidth - 8) left = x - w - pad;
  if (top + h > window.innerHeight - 8) top = y - h - pad;
  noteBox.style.left = `${Math.max(8, left)}px`;
  noteBox.style.top = `${Math.max(8, top)}px`;
}
function showNote(el, x, y) {
  const cat = el.dataset.noteCat, id = el.dataset.noteId || (el.tagName === 'SELECT' ? el.value : '');
  const html = noteHtml(cat, id);
  if (!html) return hideNote();
  noteBox.innerHTML = html;
  noteBox.hidden = false;
  placeNote(x, y);
}
function hideNote() { noteBox.hidden = true; }

document.addEventListener('mouseover', e => {
  const el = e.target.closest && e.target.closest('[data-note-cat]');
  if (el) showNote(el, e.clientX, e.clientY); else hideNote();
});
document.addEventListener('mousemove', e => { if (!noteBox.hidden) placeNote(e.clientX, e.clientY); });
// Keyboard users: show the note while a dropdown has focus.
document.addEventListener('focusin', e => {
  const el = e.target.closest && e.target.closest('[data-note-cat]');
  if (!el) return;
  const r = el.getBoundingClientRect();
  showNote(el, r.right, r.top);
});
document.addEventListener('focusout', hideNote);
document.addEventListener('change', e => {
  if (e.target.matches && e.target.matches('select[data-note-cat]') && !noteBox.hidden) {
    const r = e.target.getBoundingClientRect();
    showNote(e.target, r.right, r.top);
  }
});
window.addEventListener('scroll', hideNote, { passive: true });
