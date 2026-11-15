# Mission: Blue Marble — clean app

One app, one loop:

```
            ┌──────────────────────── ↺ iterate ────────────────────────┐
            ▼                                                           │
 index.html → ① design.html → ② simulation.html → ③ feedback.html ──────┘
  (home)       Design            Simulate            Feedback
                    optional research: hotspots.html · imagery.html (NASA Data)
```

## Pages

| Page | Step | What it does |
|---|---|---|
| `index.html` | Home | Mission brief, the loop explained, a **next step** button that knows where you are, reset progress |
| `design.html` | 1 Design | Parts, mission settings, build overview, live launch weather, **My designs** library, feedback carried over from the last mission, sticky *Save & simulate* bar |
| `simulation.html` | 2 Simulate | The game (map, orbit, launch, mission control). *End mission & get feedback* opens step 3; *Edit design* goes back to step 1 |
| `feedback.html` | 3 Feedback | Mission report, **Take it back to Design** (advice with *Fix in Design →* links that open the builder on that part), iteration history, decision log |
| `hotspots.html`, `imagery.html` | NASA Data | Methane globe (US GHG Center) and NASA GIBS imagery, linked to the detector choice |

## Shared code (`app/`)

- `theme.css` – design tokens (from the game theme in `simulation/css/sim.css`) and page components
- `shell.css` / `shell.js` – the one app bar on every page: brand · `1 Design › 2 Simulate › 3 Feedback ↺` · NASA Data. Each step shows its live status (saved design, year x of y, score) and the next step pulses.
- `lessons.js` – turns `mbm.results` into concrete design advice (which part to change and to what)
- `engine-check.js` – instant design check with the simulation's own rules (`simulation/js/design.js`): errors and warnings are shown on the Design page (red/amber fields with ⛔ ERROR / ⚠ CHECK flags) and on the Feedback page (flagged parts of the design that flew)
- `home.js`, `design-page.js`, `feedback-page.js`, `sim-shell.css` – page-specific glue

## Engine (unchanged except page links/wording)

`assets/` (parts, sites, weather, design form) and `simulation/` (simulation, report, settings). Pages still talk only through `localStorage` as described in `simulation/HANDOFF.md`. New keys: `bm.seen` (report read), `bm.runs` (iteration history), `bm.library` (My designs).

## Default design and mission

- Default mission: **10 years** (`DEFAULT_CONFIG.durationYears` in `simulation/js/config.js`); the player can pick 10, 25, 50 or 100 in Mission settings.
- Default design (`DEFAULTS` in `assets/parts.js`): Space-Grade VES battery · Green Monopropellant (ASCENT) · CHAMPS CFC-400 · EWC27 X-Band · Point-Source Zoom Spectrometer · Cape Canaveral. Measured with the engine: 42 of 43 ten-year runs ended in *Mission success* (score 80–86).

## Launch and game speed

- **🚀 Launch** (Launch tab) builds the satellite, launches it and releases it into orbit at once (the launch-weather risk from the Design page still applies), then opens Mission Control with the clock running.
- The clock runs at **1 year per second** (`DEFAULT_WARP` in `simulation/js/config.js`), so a mission takes as many seconds as the years chosen in Mission settings. Game decisions (budget votes, debris alerts) still pause it; « slows it down.
- **Mission Control** updates live: status (running / paused / decision needed), date and year progress, every satellite's state, the latest events, and 12-month trends on the key numbers.

## What changed from the old site

- One header and one visual style everywhere (previously: 4 different navs and 3 stylesheets).
- The old `feedback.html` contained a second, unrelated game ("Methane Watch Tycoon"); it is removed from the flow so Feedback only reports on *your* mission. The old pages are kept in `_legacy/` for reference.
- *My designs* (save / load) on the Design page now works (the old buttons had no code behind them).
- *Funds left* on the Design page follows the Mission settings' starting funds as you change them.
- The decision log (`mbm.decisions`) the simulation was already writing is now shown on the Feedback page.

## Run locally

```
python -m http.server 8765
```
then open http://127.0.0.1:8765/ (pages must be served from the same origin to share progress).

Test hook: `simulation.html?new=1&demo=1&adv=36&endnow=complete` plays a demo mission and opens the Feedback page.
