# Hand-off: simulation.html ↔ the team's pages

```
index.html  →  design.html  →  simulation.html  →  feedback.html
 (start)       (satellite)     (gameplay)          (results)
```

`simulation.html` sits next to `design.html`; its code lives in `simulation/`. Pages talk only through the browser's `localStorage`, so all pages must be opened from the same place (the same folder on disk, or the same website).

Page links are at the top of `simulation/js/config.js` (`PAGES`):

| Key | Link | Used for |
|---|---|---|
| `start` | `index.html` | Link in Mission Control |
| `design` | `design.html` | "Change the design" in the Launch view; link in Mission Control |
| `nasaData` | `nasa-data.html` | Link in Mission Control |
| `feedback` | `feedback.html` | (same page as `results`) |
| `results` | `feedback.html?from=simulation` | The mission report: opened when time runs out, on game over, or when the player presses **End mission** |

## What simulation.html READS

### `cfx.design.v1`: the satellite, written by design.html (`assets/design.js`)

```json
{ "missionName": "MethaneWatch-1", "battery": "liion100", "thruster": "hydrazine",
  "storage": "cfc400", "transmitter": "ewc27", "detector": "swir", "savedAt": "2026-11-14T10:00:00.000Z" }
```

- `simulation/js/design-input.js` maps the `assets/parts.js` ids to the simulation's catalog. Only these ids differ: `liion40`→`li40`, `liion100`→`li100`, `coldgas`→`cold`, `resistojet`→`resisto`, `electrospray`→`espray`, `dualmode`→`dual`, `a3200`→`nanomind`. Every id in `parts.js` is tested to map to the right category at the same price.
- The design is added to the game under its `missionName` and opens in the Launch view. The frame, reaction wheels, solar arrays, star tracker, computer and other subsystems are sized automatically.
- Pressing **Simulate** again with a changed design adds or replaces that design in the running game. A new `missionName` adds a second design, so the player can fly several kinds of satellite.
- If you add a part to `parts.js`, add the same part (with its engineering numbers) to `simulation/js/catalog.js`, or it is skipped with a console warning.

### `mbm.config`: the game conditions, written by the **Mission settings** panel on design.html

`simulation/settings/mission-settings.js` (loaded by design.html after `simulation/js/config.js`) adds the panel and saves every change immediately:

```json
{ "agencyName": "Blue Marble Space Agency", "durationYears": 25, "difficulty": "director",
  "startFunds": 1500000, "annualBudget": 900000, "startDate": "2027-01-01T00:00:00Z", "eventScale": 1 }
```

- `durationYears` 1–100; `difficulty` `cadet`, `director` or `crisis`; `startFunds` and `annualBudget` in US dollars; `startDate` 1 January of 2026–2040; `eventScale` 0.5 (rare), 1 (normal) or 1.8 (frequent) random events.
- Missing or out-of-range values fall back to the defaults above (`DEFAULT_CONFIG` in `simulation/js/config.js`).
- Changing anything except `agencyName` starts a new game the next time simulation.html opens; otherwise the saved game continues. The panel warns about this when a game is in progress.
- URL overrides for tests: `simulation.html?years=50&difficulty=crisis`. `?new=1` forces a fresh game.

## What simulation.html WRITES

### `mbm.results`: when the game ends, then the page opens feedback.html

```json
{
  "reason": "complete | ended | bankrupt | trust | tipping",
  "score": 74, "stars": 4, "rank": "Mission Specialist",
  "subscores": { "climate": 70, "detection": 85, "science": 90, "trust": 61, "budget": 55 },
  "durationYears": 25, "yearsPlayed": 25, "difficulty": "director", "agencyName": "...",
  "climate": { "ch4ppb": 1990.2, "ch4ppbStart": 1935, "ch4ppbBusinessAsUsual": 2260.1, "tempAnomalyC": 1.86, "methaneWarmingC": 0.05, "warmingAvoidedC": 0.081, "emissionsMtPerYear": 560.1 },
  "stats": { "leaksDetected": 900, "leaksFixed": 700, "mtAvoided": 410.5, "launches": 6, "launchFailures": 0, "satsLost": 1, "dataMB": 1.2e7, "satellitesActive": 4 },
  "finances": { "fundsRemaining": 3200000, "grants": 2100000 },
  "satellites": [{ "name": "...", "status": "active", "designScore": 77, "detections": 300, "altKm": 540, "incDeg": 97.6 }],
  "history": [{ "t": 1798761600000, "ch4": 1935, "bau": 1935, "dT": 1.32, "funds": 1500000, "trust": 55, "emis": 634, "detected": 0, "fixed": 0 }],
  "decisions": [ "..." ]
}
```

- Score weights: climate 35%, leak detection 20%, science 15%, trust 15%, budget 15%. Ranks run from Rookie Director to Guardian of Earth. Stars = score / 20 (0–5).
- Every sub-score is measured against the **whole planned mission** (`durationYears`), so ending early or doing nothing can't score well:
  - climate: ppb of methane prevented vs the no-action world, full marks at 60 ppb (0 if no satellite was ever deployed: the difference is then only random noise);
  - leak detection: leaks reported ÷ planned years, full marks at 60 per year; science: points ÷ planned years, full marks at 6,000 per year;
  - trust and budget: scaled by `completion` (share of the mission actually played); budget is 0 if no satellite was deployed or the agency is in debt.
- `completion` (0–1), `effectiveness` (0–1: share of the methane rise expected over the full mission that was prevented) and `expectedRisePpb` are included.
- `ch4ppbBusinessAsUsual` is a "nobody did anything" world, so feedback.html can show what the player changed.
- `history` is monthly (about 240 points at most) and ready to chart.
- `reports`: the last 36 monthly data reports: `{ month, grade (A–F), quality (0–1), mb, detections, attributed, sites, countries: [ISO codes], grant }`.
- `regions`: the 25 biggest emitting countries: `{ iso (numeric ISO 3166), emissionsMt, startMt, noActionMt, changePct, policyCutPct, leaksReported }`. This shows where the player's data changed the world and where it didn't.

- `reason`: `complete` (time ran out), `ended` (the player pressed **End mission**), or a game over (`bankrupt`, `trust`, `tipping`).
- `finances` also has `startFunds`, `totalSpent`, `totalEarned`, and `spending` / `income` broken down by category (`[{ label, amount }]`, largest first).
- `reportGrades`: how many monthly data reports got each grade, e.g. `{ "A": 51, "B": 9 }`.
- `mapFrames`: snapshots of the methane map for the report's before / after maps and timelapse:
  `{ countries: [ISO numbers], sites: [{ name, lat, lon, type }], types: { oilgas: { label, color }, … }, frames: [{ t, ch4, dT, c: [Mt/yr per country], s: [t/h per site region], l: [t/h of active leaks per site], r: "ring code per site" }] }`.
  Ring codes: `r` big unreported leak, `b` reported and awaiting repair, `g` repaired, `w` nothing special. Frames are monthly; long games keep at most ~360 (older months are thinned, the first and last are always kept).

### The mission report on feedback.html

feedback.html loads `simulation/report/report.js` and `report.css` (plus Leaflet, topojson-client, `simulation/js/nasa/gibs.js` and `simulation/js/map-common.js`). Everything sits in one function and every CSS class starts with `bmr-`, so it does not touch feedback.html's own code or styles.

- It shows the report when the page is opened as `feedback.html?from=simulation` (what the Simulation page does), or when `mbm.results` exists and there is no report from feedback.html's own design game.
- If both exist and the page is opened without `from=simulation`, feedback.html's own report shows with a link bar to the mission report. `feedback.html?view=flight` always shows feedback.html's own report.
- Contents: verdict (success / partial success / failed) with score, stars and rank; how effective the mission was (methane vs the no-action world, warming avoided, methane kept out of the air, leaks); score breakdown; charts; statistics (money spent and received, funds, satellites deployed / working / lost, data, data reports); where the money went and came from; satellites; countries; and at the bottom the methane map at the start and at the end side by side, plus a timelapse with play / pause, speed and a slider. Countries can be coloured by emissions or by change since the start; sites by source or by amount, exactly like the game's map.
- Verdict rule: a game over is a failure; ending the mission in its first quarter is "Mission abandoned". Otherwise it is a success when the score is at least 60, the climate sub-score at least 45 and effectiveness at least 8%; a partial success when effectiveness is at least 2% or the score at least 40; and a failure otherwise.

### `mbm.decisions`: the decision log with explanations before and after each choice

An array (the last 500). One entry is added each time the player makes a meaningful choice: receiving a design from design.html, booking a launch, flying it, a manoeuvre, an attitude mode, safe mode, a debris dodge, a budget vote and so on.

```json
{ "id": "d4k2j9x", "t": 1798761600000, "date": "2027-01-01", "year": 2027,
  "type": "design | launch-booked | launch | satellite | debris | budget",
  "title": "Design received: MethaneWatch-1",
  "before": "What it does and its trade-off, shown before the choice",
  "after": "What actually happened as a result",
  "data": { "...": "type-specific details" } }
```

The list is cleared when a brand-new game starts.

### `mbm.sim.save`
The simulation's own save. Other pages should not edit it.
