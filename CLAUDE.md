# Geo Capital Dashboard — guide for agents

Read this before exploring the code: it maps where everything lives, so most tasks need only the files named here.
README.md (Italian) covers data sources, licenses, the pipeline's choices and deploy.

## What it is

A fully static React + MapLibre atlas (UI in Italian): globe / Equal Earth / Mercator map of states, capitals,
admin-1 regions and major cities, colored by a metric; side panel with rankings and country detail; a study mode
(quiz). A second page, `luce/` ("Ore di luce"), compares daylight, sunrise and sunset of up to 3 cities through the
year or a month, without the map. No backend: `scripts/build_data.py` precompiles everything into `public/data`,
GitHub Pages serves `dist/`.

## Commands

| Command | What |
| --- | --- |
| `npm run dev` | Vite dev server. URL is `http://localhost:5173/geo-capital-dashboard/` (base path), daylight page at `…/luce/`. Preview config: `.claude/launch.json` (`dev`). |
| `npm test` | Vitest (`src/**/*.test.ts`) |
| `npm run typecheck` / `npm run lint` | `tsc -b` / oxlint |
| `npm run build` | typecheck + production build into `dist/` |
| `npm run data` | Rebuild `public/data` + glyphs (network; ~1 min with a warm `.data-cache/`, much longer cold) |
| `npm run validate` | Plausibility checks on `public/data` (`scripts/validate_data.py`, `-v` for allowlisted flags) |
| `npm run fonts` | Copy Manrope woff2 subsets to `public/fonts/map`, rewrite `src/mapFonts.json` |
| `npm run flags` | Copy 4:3 SVG flags from `flag-icons` (MIT) to `public/flags/<ISO2>.svg` for every country with an ISO2 |

Gotcha: never delete `public/data/admin1/` (or any served folder) while the dev server runs: Vite stops serving it
and answers index.html, which the app shows as "Regioni non disponibili". The pipeline overwrites files in place and
removes only stale ones for this reason; if it happens anyway, restart the dev server.

In dev, the MapLibre instance is on `window.__map` (handy for `queryRenderedFeatures`, `getFeatureState`, `jumpTo`).
Map hover can be simulated by dispatching `MouseEvent('mousemove')` on `__map.getCanvas()`.

## Layout

```
scripts/build_data.py     data pipeline (Python stdlib only + mapshaper from node_modules)
scripts/validate_data.py  plausibility checks, ALLOWLIST of known-OK flags with reasons
scripts/copy_map_fonts.mjs map label fonts
scripts/copy_flags.mjs    flags from node_modules/flag-icons (+ its LICENSE)
public/data/              generated, committed (see "Data files")
public/fonts/             Noto Sans glyph PBFs (generated) + Manrope woff2 (map/)
public/flags/             <ISO2>.svg flags, committed; `flagUrl(country)` in data.ts, `<Flag>` in SidePanel.tsx
luce/index.html           second Vite entry (build.rolldownOptions.input in vite.config.ts) → src/daylight/main.tsx
src/App.tsx               state owner: view, metric, projection, background, selection, timeline year, night,
                          study mode, region store, color scales, URL hash sync, keyboard shortcuts
                          (R reset map, S study mode, / search, Esc close country)
src/urlState.ts           shareable state in the hash (#v=asia&m=gdp&c=JPN&p=mercator&b=relief&y=1990&n=1)
src/sun.ts                subsolar point and night polygon (terminator) for the day/night shade
src/sunTimes.ts           sunrise/sunset/civil twilight per local day (NOAA equations, refined at the event time),
                          zoneOffsets (Intl sampled daily, DST changes bisected to the minute), sunYear, sunToday,
                          formatClock/formatDuration/formatChange
src/time.ts               local time and UTC offsets of IANA zones via Intl
src/data.ts               fetch + decode dataset (+ land `neighbors` from shared topology arcs); loadPlaces()
                          (countries + cities only, for the daylight page); countryZone(); loadRegions()
                          (cached, adds countryId + colorIndex); loadHistory()/historyValue()/HISTORY_METRICS;
                          flagUrl(); targetCountryId()
src/types.ts              Country, Region, City, Metric, ViewId, Projection, HoverTarget
src/views.ts              VIEWS (continent bounds), METRICS (label, unit, regional, group for the picker),
                          METRIC_HINT, Italian continent/subregion labels
src/scale.ts              RAMPS per metric, log/linear scales, metricValue, all number formatting (it-IT)
src/projection.ts         Equal Earth via fake lon/lat through MapLibre's Mercator (see header comment)
src/gestures.ts           trackpad pinch/pan vs mouse wheel classification
src/labelPoint.ts         region name anchor: pole of inaccessibility of the largest part (polylabel algorithm)
src/useTheme.ts           light (default) / dark toggle, saved in localStorage `theme`, set as <html data-theme>
src/components/MapView.tsx    the map: style, sources, layers, feature-state sync, hover/click, camera
src/components/HeaderButtons.tsx  ThemeButton and ShareButton, shared by both pages
src/components/Controls.tsx   left card: theme, share + study buttons, search, view chips, MetricGrid (grouped buttons + ramp
                              swatch), projection, background, toggles (+ link to luce/), Legend, Timeline, folded "Fonti e scorciatoie".
                              The metric grid is kept expanded (user preference): the card scrolls on short screens;
                              a max-height ≤ 760px rule tightens spacing. Keep new controls compact or fold them.
                              Phones: a chevron folds the card to its header row (`.controls.collapsed`); it folds by
                              itself when a country is selected outside study mode (`focusCountryId`)
src/components/Legend.tsx     color bar + ticks + hovered value marker
src/components/Timeline.tsx   year slider + play under the legend (closed = latest data)
src/components/SidePanel.tsx  right card: Ranking (overview, with flags) or CountryDetail (flag, capital clock with
                              today's sunrise–sunset linking to luce/#c=<capital>, stats incl.
                              EXTRA_STATS, "Confina con" chips, regions table sortable by name/population/3rd column
                              with population default, cities with share of the country)
src/components/Tooltip.tsx    hover tooltip (desktop only) per HoverTarget kind
src/components/QuizPanel.tsx  study mode UI: ModePicker (grouped buttons / phone select), tools (progress on map,
                              Ricomincia, Azzera tutto), QuizSession (country modes), RegionQuiz + RegionSession
src/quiz/quiz.ts              pure quiz logic: eligible pool, modePool, distractors, population options,
                              borderQuestion, deck grading
src/index.css                 design tokens (:root, dark overrides) and all layout; QuizPanel.css for the quiz
src/daylight/                 the daylight page: DaylightApp.tsx (state, cards, table), charts.tsx (DayLengthChart,
                              SunTimesChart small multiples, DayStrip), days.ts (month names, spans, wording),
                              places.ts (Place index, search, PRESETS, hash state), CityPicker.tsx (combobox),
                              daylight.css (series + sky tokens, layout; also imports index.css)
```

## Data files (public/data)

- `countries.json`: `{ [ADM0_A3]: Country }` — name (it), nameEn, iso2/iso3, continent, subregion, type,
  population(+Year, Source), gdp, gdpPerCapita, lifeExpectancy, gdpPerCapitaPpp, elderlyShare (% 65+), fertility,
  urbanShare (%), co2PerCapita (t) — each with `<field>Year` —, area(+Source), capitals[{name, lat, lon,
  population}], label point + labelMinZoom (Natural Earth), bbox (framing, not full extent), admin1Count.
- `countries.topo.json`: country polygons, feature id = ADM0_A3.
- `cities.json`: `{ [ADM0_A3]: [name, lat, lon, population, timezone?][] }` (tuples, ≤20 per country, capitals
  excluded; the IANA zone only where it differs from the capital's, resolved to `City.timezone` on load).
- `admin1/<ADM0_A3>.json`: TopoJSON of regions; properties = Region: id, name (it), type, iso, population(+Year),
  area(+Source), gdp, gdpPerCapita, gdpYear, lifeExpectancy(+Year), capName/capLat/capLon/capPop, timezone (IANA, nearest GeoNames place to
  the capital; the tooltip falls back to the country's zone when it has only one). Optional fields are
  omitted when unknown. `countryId`, `colorIndex` and `label` (name anchor) are added client-side by `loadRegions`.
- `history/<metric>.json`: `{ from: firstYear, values: { [ADM0_A3]: (number|null)[] } }`, one value per year
  (World Bank, 1960–latest, trimmed to years where ≥40% of countries report). Density is derived client-side.
- Country `capitals[].timezone` (IANA, nearest GeoNames place) and `timezones` (zones of its GeoNames places,
  filtered by the system `zone.tab`, so border towns with a neighbour's zone do not count).
- `meta.json`: generatedAt + sources (shown in the UI footer; attribution required for CC BY sources).

Keys: country ids are Natural Earth `ADM0_A3` (not always ISO3: KOS, SDS…). Region ids are `adm1_code`
(`USA-3519`) or `ADM0|group` for dissolved countries (ITA, FRA, ESP, PHL, SVN, GBR: provinces merged into regions).

## Data pipeline (scripts/build_data.py → main())

1. Natural Earth admin-0 (1:50m) and admin-1 (1:10m) downloaded to `.data-cache/`; mapshaper simplifies, dissolves
   (`DISSOLVE_FIELD`) and splits admin-1 per country.
2. `build_countries`: World Bank indicators via `world_bank(code)` (latest non-empty value + year per ISO3; not
   cached; the newer ones are declared in the `WB_INDICATORS` table), Wikidata stats (population/area/capitals, cached incrementally in `.data-cache/wikidata_*.json`),
   area sanity checks against the polygon.
3. `build_admin1`: picks one Wikidata item per region (NE link vs ISO 3166-2 item, judged against the polygon's area
   and capital location), per-field plausibility, then `add_region_indicators` joins DOSE GDP and OECD life
   expectancy **by name** (`match_region_names`: exact, core name without generic words, then fuzzy ≥0.88 with same
   first two letters; one-to-one; population within ×2 when the source has it). Internal `_qids`/`_names` fields are
   dropped when writing.
4. `build_cities`: GeoNames cities5000 + Wikidata population + Italian names, de-duplicated (`suppress_nearby`).
   Wikidata's population is ignored when it exceeds GeoNames' by `CITY_WIKIDATA_MAX_RATIO` (×10): the P1566 link
   then points at the district/province (Masvingo 1.6 M vs 90 k).
   It also sets capital time zones and each country's `timezones` (ZONE_TAB filter), and gives a city its own
   GeoNames zone when it differs from the capital's (~190 cities; checked by `city.timezone` in validate_data.py).
5. `write_history` (called from `build_countries`): `HISTORY_INDICATORS` series → `public/data/history/`.
6. `download_fonts`, `write_meta`.

Caches in `.data-cache/` (gitignored, ~300 MB): delete a file to force a refresh. Region-level sources:
`DOSE_V2.9.csv`, `oecd_life_exp.csv`, `oecd_region_names.json`, `wikidata_names.json`.
The OECD SDMX API is picky: only `/data/<flow>,/all?lastNObservations=1&format=csvfile` worked reliably (500s otherwise).

## Map internals (MapView.tsx)

- Props flow in; a `latest` ref gives event handlers current props; `syncAll()` pushes everything to the map
  (feature-states, filters, source data, visibility); `moveCamera()` frames view or selection with padding for the
  floating cards. Style is built once (`buildStyle`); theme changes go through `applyTheme` + `syncColors`.
- Every GeoJSON source must go through `inView()` (Equal Earth re-projection) when set.
- Feature-state: countries `t` (0–1 on ramp, -1 no data), `dim`, `hidden` (drawn by its regions), `selected`, `hover`;
  regions `t`, `tint` (neighbour tints when metric is "none"), `hover`.
- Region fill: ramp where `t` is a number, else tint by `colorIndex` (greedy graph coloring from TopoJSON neighbours);
  see-through when a metric colors the map but the country has no regional values (the country keeps its color).
- Point icons are drawn on canvas (`DOTS`): capital = bullseye, region capital = filled dark, cities = plain dots.
  Region names (`region-label`, source `regionLabels` from `Region.label`) are the last layer, so the selected
  country's regions win collisions; country labels come right before them. Both hide with `labels` (study mode). Glyph URLs map Manrope stacks to Noto PBFs.
- Background (`background` prop, 'plain' | 'relief'): the `relief` raster layer (NASA GIBS Blue Marble, levels 0–8,
  `RELIEF_TILES`) sits right above the ocean; `syncBackground` shows it (never in Equal Earth: raster tiles can't
  follow the fake lon/lat) and swaps fill opacities (`countryFillOpacity`, `regionFillOpacity`: metric colors at 0.62,
  no fill with metric none, light wash on countries out of focus). `reliefPaint` tones it down on the dark theme.
  Known artifact: the globe's polar caps stretch the tiles' edge pixels (MapLibre, beyond ±85°).
- Night: `nightAt` prop → `night` fill layer from `nightPolygon` (sun.ts), via `inView()`; App refreshes the clock
  every 30 s. Quiz props: `pickMode` (every click → `onMapClick(lngLat, countryId)`, lon/lat un-projected in Equal
  Earth), `quizMarks` (click + answer points and a dashed line), `highlightRegionId` (`region-target` outline),
  `progress` (replaces the fill colors with ok/ko/todo by feature-state).
- Cursor: plain arrow at rest (CSS override of MapLibre's grab hand in index.css), `SELECT_CURSOR` (accent ring,
  SVG data URI) only on click targets (country, capital, city of another country, never in study mode), `grabbing`
  while dragging. `resetToken` prop re-runs `moveCamera` (R shortcut).

## App state (App.tsx)

- `selectedId` (country detail + its regions), `viewId`, `metric`, `projection`, `background`, toggles, `studying`,
  `quizRevealed`.
- `regionStore: Record<id, FeatureCollection | null>` loads regions for the selected country and, in study mode,
  the hovered one (`previewId`, 120 ms delay); `mapRegions` merges both for the map. `null` = failed; the
  `setSelectedId` wrapper drops failures so selecting again retries.
- Color scales: `colorScale()` over countries in focus; one region scale over regions of countries that have values.
  `regionColorNote()` explains in the panel (`.map-note`) and the legend why the selected country's regions are or
  are not colored: metric "none" (tints), timeline open, national-only metric, no regional data, or partial data.
- Study mode hides names/capitals/cities/tooltips until an answer (`hideAnswers`); the quiz drives `selectedId`
  and `quizMap` (QuizMapState: pickMode, marks, regionId, progress); map clicks come back as `mapPick`.
- Timeline: `year` (null = latest). History of the metric loads when the timeline is open or a country is selected
  (trend chart). With a year, countries are colored from the series on one scale over all years, regions are not
  colored, the ranking and tooltips use the year's values.
- URL: state is read once from the hash (`readUrlState`), written back with `replaceState` on every change and
  re-applied on `hashchange`. The share button (Controls) uses `navigator.share` on touch devices, else the clipboard.

## Daylight page (src/daylight, luce/)

- Places = capitals + cities.json, id `ADM0.Name` (e.g. `ITA.Roma`); state in the hash `#c=ITA.Roma,AUS.Sydney&m=6`
  (ids encoded one by one, m = month 1–12, none = whole year), last cities also in localStorage `daylight:places`.
  Unknown ids are dropped; with none left the first PRESET. A test checks every PRESET id against public/data.
- Each choice keeps its color slot (`series-1..3`, the first three dataviz categorical slots, validated for CVD) when
  others are removed; text never takes the series color, a line key next to it does.
- `sunYear` per city for the current year; charts take day indices into it (`Range` = the year or a month). One
  active day for cards, readouts and crosshairs: hover → pinned (click, touch, ←/→) → today or the 15th.
- Sun panels draw bands in local clock hours, copied at ±24 h and clipped to 0–24 so sunsets past midnight and white
  nights wrap; polar day/night come as 'up'/'down' (span = solar noon ± 12 h).

## Quiz (quiz.ts + QuizPanel.tsx)

Modes (grouped in QUIZ_MODES): capital, country (capital→state), locateCapital (click near the capital, right within
`LOCATE_CAPITAL_KM`), shape (the map frames the country with names hidden), locate (click the state), flag, border,
population, flashcard, regions (per country: capoluogo of a region, or which region is outlined; separate
RegionQuiz/RegionSession, sessions `session:regions:<ADM0>`). Pool = sovereign-ish states in the view
(`isQuizEligible`), narrowed per mode by `modePool` (shape needs area ≥ `SHAPE_MIN_AREA_KM2`, flag an ISO2 flag,
border a quiz-eligible land neighbour). `HIDES_COUNTRY` modes keep the country off the map until
answered. Border answers prefer a neighbour on the same continent (France → not Brazil via French Guiana). Deck: multiple choice asks each card once per round (wrong → back of the queue), flashcards use
Leitner-style review (REVIEW_SOON/REVIEW_LATER/MASTERY_STREAK). Map answers are graded by `gradeMapAnswer`
(distance to `answerPoint`: capital, or the country's label point). `deckStatus` feeds the progress map.
"Ricomincia" clears the current session key, "Azzera tutto" every `session:*` and `best:*` key. Sessions persist in
localStorage
`geo-capital-quiz:session:<mode>:<hash of pool ids>`; also `geo-capital-quiz:mode`, `geo-capital-quiz:best:<mode>`,
`geo-capital-quiz:show-progress`, `geo-capital-quiz:regions-country`, and `legend-collapsed`.

## Recipes

Add a country metric from the World Bank:
1. `build_data.py`: add `field: ("CODE", decimals)` to `WB_INDICATORS` (writes `field` + `fieldYear`).
2. `types.ts`: Country fields; add the field name to `Metric` (metric ids equal field names: `metricValue` reads
   `item[metric]`).
3. `scale.ts`: `RAMPS` entry (CARTO sequential; hues in use: Sunset, Emrld, Burg, Teal, Purp, Magenta, BluYl, Peach,
   PinkYl, DarkMint, BrwnYl), `LINEAR_METRICS` if the range is narrow (percentages, years, rates),
   `formatMetric`/`formatMetricCompact`. Negative values (growth, inflation) would need a diverging scale.
4. `views.ts`: `METRICS` entry with `group`, optional `METRIC_HINT`.
5. Fixture in `src/quiz/quiz.test.ts` (`country()` needs every Country field).
6. Show it: `EXTRA_STATS` in SidePanel, `ON_DEMAND` in Tooltip, `QuizPanel` Facts if relevant.
7. `npm run data`, `npm run validate`, update README sources/features.

Add a regional indicator: load the source in build_data.py, join with `match_region_names` inside
`add_region_indicators`, add Region fields in `types.ts`, `REGION_COLUMN` in SidePanel, tooltip row.

## Conventions

- UI text Italian; numbers via `scale.ts` formatters (it-IT: "58,9 Mln", "2552 Mld $", never "Bln").
- Code comments and identifiers in English; comments explain why, sparse. TS: no semicolons, single quotes,
  2 spaces, lines up to ~120. Python: stdlib only, type hints, `log()` for progress.
- Keep the site static: no API keys, no runtime calls to third-party services. Single exception: the optional relief
  background (NASA GIBS tiles, off by default); with the plain background nothing external is contacted.
- Colors are tokens in `index.css` `:root` with `:root[data-theme='dark']` overrides (not prefers-color-scheme); map colors live in `PALETTE` in MapView.tsx.
- Layout breakpoints: phone < 900px (bottom sheet panel, 40dvh), compact 900–1279px, desktop ≥ 1280px. On phones
  the country detail is compacted to fit the sheet (4-column stat tiles without notes, values on one line shrunk to
  fit by `useFitText` in SidePanel.tsx, icon-only back button) and
  the neighbours, regions and cities sections (`.section-toggle` details) start collapsed. The map attribution starts folded
  into its ⓘ button everywhere (MapView `load` handler); keep every CC BY source in `customAttribution`.
  Phones have no hover: a tap that selects nothing (region, place of the selected country) calls `onInspect` and App
  shows the tooltip content as a pinned card (`Tooltip pinned`), closed by the × , a tap on empty map or a camera move.
