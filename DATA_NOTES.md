# DATA_NOTES — NUSANTARA 1950

Everything here is **approximate**. Each section says what was used, what replaced what the spec asked for, and why.
Regenerate everything with `npm run data:all` (after `node tools/fetch_raw.mjs` once). Numbers are checked by `tools/04_report.mjs` → `DATA_REPORT.md`.

## 1. Sources actually used

| Item | Spec asked for | Used | Why |
|---|---|---|---|
| Kecamatan boundaries | HDX COD-AB → geoBoundaries ADM3 → GADM 3 | **github.com/cahyadsn/wilayah_boundaries** (MIT), `db/kec/*.sql`, plus `cahyadsn/wilayah` `wilayah.sql` for names | HDX, geoboundaries.org and GADM hosts are blocked in the build sandbox (HTTP 403 at the proxy). geoBoundaries on GitHub has no IDN ADM3 file. This repo has 7,284 kecamatan polygons (Kepmendagri 300.2.2-2430/2025 codes) hosted on GitHub raw. |
| Population raster | GHS-POP R2023A epoch 1975, 30 arc-sec | **Not available (blocked).** Fallback method (see §4) | `jeodpp.jrc.ec.europa.eu` blocked. |
| Terrain raster | ETOPO 2022, 60 arc-sec | **Not available (blocked).** Fallback: ridge-line elevation proxy (see §5) | `ngdc.noaa.gov` blocked. |
| 1961 census provincial populations | — | Hand-entered from memory in `config/world.json` (±5 %) | Used only for group shares, then rescaled to 75 M. |

**To upgrade to real rasters** (optional, future work): download
`https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_POP_GLOBE_R2023A/GHS_POP_E1975_GLOBE_R2023A_4326_30ss/V1-0/GHS_POP_E1975_GLOBE_R2023A_4326_30ss_V1_0.zip`
and ETOPO 2022 60 s (`https://www.ngdc.noaa.gov/thredds/fileServer/global/ETOPO2022/60s/60s_surface_elev_gtif/ETOPO_2022_v1_60s_N90W180_surface.tif`) into `data_raw/`.
The zonal-statistics scripts are **not written** (they could not be tested without the files); `geotiff` and `flatbush` are already installed.

## 2. Boundaries (tools/01a–01c)
* `01a_parse`: SQL → GeoJSON. Source stores `[lat,lng]`; depth-3 = Polygon, depth-4 = MultiPolygon. 7,284 features; every kecamatan name/kabupaten/province resolved from `wilayah.sql`.
* `01b_clean`: mapshaper `snap` + `-clean gap-fill-area=2km2` (removes slivers/gaps, resolves overlaps), exported as TopoJSON with 0.0001° quantisation (~11 m). **One kecamatan was lost by cleaning**: `81.05.16 Ukar Sengan` (Maluku). Final count **7,283**.
* The source is already simplified (≈284 k vertices total), so no further simplification was applied. Shape quality is "good at province/regency zoom, slightly angular at kecamatan zoom". Shared topology is intact (21 k shared arcs).
* `bps_code`: the property is named per the spec but holds the **Kemendagri code without dots** (e.g. `110101`), which differs from BPS codes in places.
* Derived (`kecamatan_geo.json`): `area_km2` (turf geodesic), `label` (point-on-surface), `coastal` (owns an arc used by no other kecamatan — land borders with Malaysia/PNG/Timor-Leste are therefore also flagged "coastal"; the share is 34 %), `island` (connected component of the adjacency graph; 234 components), `neighbors` (shared-arc adjacency, symmetric; 131 kecamatan have no land neighbour).
* Total area 1.894 M km² (land area of Indonesia ≈ 1.91 M km²).

## 3. 1950 administration (tools/regency_parents.src.csv → 02_admin1950)
* **Provinces** (12): Sumatera Utara (incl. Aceh), Sumatera Tengah (Sumbar, Riau, Kepri, Jambi), Sumatera Selatan (Sumsel, Bengkulu, Lampung, Babel), Jawa Barat (incl. DKI, Banten), Jawa Tengah, DI Yogyakarta, Jawa Timur, Kalimantan, Sulawesi, Maluku (incl. Maluku Utara), Sunda Kecil (Bali, NTB, NTT), **Irian Barat (locked, joins 1963)**.
* **Regencies**: 514 modern kabupaten/kota → **250** regencies by rolling back pemekaran. `tools/regency_parents.csv` lists every merge (modern code → ultimate 1950 parent, approximate year formed, confidence `high|med|low|root|auto`). Confidence is "high" where I am sure of the pemekaran year and parent, "med" where the 1950 parent is plausible but uncertain, "low" for Irian Barat (grouped into 8 afdeeling-like regencies).
* 30 cities are kept as separate **kota** (the spec list plus Pontianak and Ambon at medium confidence). All five Jakarta kota + Kepulauan Seribu become one `Kota Jakarta Raya`. Other modern kota merge into the surrounding kabupaten.
* Renamed merged regencies: Indragiri, Kepulauan Riau, Jakarta Raya, Kotawaringin, Maluku Utara.
* Nine kota have fewer than 5 kecamatan (Bukittinggi 3, Magelang 3, …) — below the game's kabupaten/kota minimums but they are historical starting units and are grandfathered.
* **Capitals**: kota → a hand-chosen central kecamatan (`CENTER_NAME` in `03b_attributes.mjs`, fallback smallest-area connected kecamatan); kabupaten → a few overrides (historical seats where I am fairly sure), else highest-density kecamatan with a boost for name matches. **Heuristic — expect mistakes.** Provincial capitals: Medan, Bukittinggi, Palembang, Bandung, Semarang, Yogyakarta, Surabaya, Banjarmasin, Makassar, Ambon, Singaraja (Buleleng), Jayapura.

## 4. Population (fallback method: "census-group × area-power × city decay")
1. National total **75.0 M** (`targets1950.population`).
2. Population is split into 26 groups of modern provinces using **1961 census shares** (`census1961_thousands_by_group`, from memory, ±5 %). Banten is grouped with Jawa Barat, Kepri with Riau, Babel with Sumsel, Gorontalo with Sulut, Sulbar with Sulsel, Kaltara with Kaltim, all Papua together.
3. The 30 kept cities get their (1961 city population × 0.789) as a fixed total, distributed over their kecamatan by `area × exp(−distance_to_core / τ)`, τ = √(city area)/3.2 km clamped to [1.2, 10]. City 1961 populations are rounded recollections.
4. Everything else: `weight = area^0.45 × boosts` (modern kota not kept ×1.6, tiny kecamatan <15 km² ×1.5, coastal ×1.15, mountain ×0.85, swamp ×0.55, lognormal noise σ=0.15); group remainder is split by weight.
5. Result: Java 49.8 M (real 1950 ≈ 50 M), density Jawa Tengah 421 /km², DIY 555 /km², Kalimantan 6 /km². **Individual kecamatan populations are only as good as the area-power heuristic** (large rural kecamatan are probably ±50 %).
6. **Population sample points** (`popsamples.json`) are **synthetic** (urban core cluster + uniform rural scatter, 3–16 points) because there is no raster. Used by the split tool to apportion people.
7. **Urban share**: 1.5 % + density term; capitals ≥ 30 %; kept-city kecamatan `0.15 + 0.8·exp(−d/1.3τ)`; modern-kota-merged ≥ 30 %; globally rescaled to **12.0 %**.

## 5. Terrain (fallback method)
Elevation proxy = max over 19 hand-placed ridge polylines (Barisan, Java spine, Nusa Tenggara arc, Schwaner–Müller, Meratus, Sulawesi arms, Papua central range, …) of `peak × exp(−(d / (0.95·L))²)` (Gaussian cross-section), ×(0.75..1.25) noise + 5..30 m. Java spine peak 2200 m / L 16 km; Java south hills peak 450 m / L 20 km. Classes: mountains >700 m, hills >220 m, coastal lowland (coastal and <40 m), else lowland. Swamp/peat flag: provinces 14–16, 18–19, 61–65, 91–94 where proxy <28 m, >55 km from a ridge, coastal or next to a coastal kecamatan, area >60 km², not a kota. Terrain is a **hand-drawn approximation**, not measured elevation.

## 6. Seeds (tools/seeds/*.json → public/data/seeds.json)
* `resources.json`: 69 known + 24 hidden points (oil, gas, tin, coal, bauxite, gold, copper, nickel, geothermal, hydro, plantation belts, sugar belts, rice bowls). Coordinates from memory; each has a confidence flag; `knownYear` marks when hidden ones become discoverable in "Historical" mode (Minas/Duri 1952; Arun 1971; Badak 1972; Natuna 1973; Grasberg 1960; …).
* `infrastructure.json`: 16 rail lines (113 stations; Aceh tram 750 mm flagged degraded), 5 trunk-road corridors (Jalan Raya Pos etc.), 42 ports (level 1–3), 20 industry seeds (refineries Plaju, Sungai Gerong, Balikpapan, Pangkalan Brandan, Cepu; Semen Padang; sugar mills; textiles; tin works). Stations are placed by **coordinates**, not names (more robust than name matching). All resolve to a kecamatan; offshore points snap to the nearest label point (max 23 km).
* Rail/road lines are routed station-to-station by Dijkstra over the kecamatan adjacency graph (distance between label points). 541 kecamatan lie on rail paths, 513 on trunk roads. These are **topological stand-ins**; M4 will refine the actual track geometry.

## 7. Attribute formulas (tools/03b_attributes.mjs)
All targets in `config/world.json`. Province-level inputs: GDP-per-capita factor, literacy base, life-expectancy offset.
* **Sector labor shares** start from a rural-Java template (food 64 %, plantation 3, fisheries 2, forestry 2, mining 0.2, oil/gas 0.1, manufacturing 8, construction 1.2, services 19, tourism 0.5) and are modified by: urban share (shifts 90 %·u of agrarian labor to manufacturing 30 %/services 60 %/construction 8 %/tourism 2 %), coastal & small-island (fisheries), forestry on thin-density outer islands, resource seeds (plantation/sugar belts radius ~30 km, rice bowls 30 km, mines 6 km, oil in-kecamatan), industry seeds, ports, Bali tourism; ±6 % noise; then agricultural jobs are iterated to **75 %** nationally.
* **Output** = workers (42 % of pop) × labor share × sector productivity × location multipliers × lognormal noise × province factor; agricultural output scaled to **57.5 %** of GDP; whole economy scaled so GDP = 75 M × Rp 9.889 M (= target/9) in **2026 prices**; GDP per capita capped at 12× national (not binding).
* **Specialty**: the sector with the highest location-multiplied labor concentration (+ runner-up), multiplier 1.0–1.35.
* **Capital stock** = GRDP × (1.8 + 0.8·urban + 1.2·enclave).
* **Literacy** = province base + (0.92−base)·0.75·urban^0.8 + noise (+0.1 for university cities) → scaled to 40 % (pop-weighted). **Mean years of schooling** = 2.4·lit^1.35·(1+0.5·urban) → scaled to 1.0. **Expected years** = 3 + 5.5·lit + 1.5·urban. **Life expectancy** = 40 + province offset + 3·urban + 2.5·ln(GDPpc/national) + noise −1.5 (swamp) → shifted to mean 40.0. **Poverty** = 0.62/(GDPpc/national)^0.9, clamped 8–92 % (national ≈ 65 %, an assumption — no 1950 poverty line exists). **Age structure**: 0–14 = 40 % − 4 %·urban, 65+ = 4 %.
* **Services**: school level (0–4) by university city / kota / urban share / literacy; health level (0–4) by kota / capital / urban share; clean water 4 % + 35 %·urban^0.9; electrification 0.4 % + 55 %·urban^1.2 + enclave bonus, scaled to a pop-weighted **5 %**.
* Universities (level 4): Jakarta, Yogyakarta, Bandung, Surabaya, Bogor (approximate).
* **Culture** (flavor only): ~60 groups assigned by modern kabupaten code.

## 8. Calibration status of the starting state (from DATA_REPORT.md)
Population 75.00 M · GDP/cap Rp 9.89 juta · urban 12.0 % · literacy 40.0 % · MYS 1.00 · life expectancy 40.0 · agriculture 75 % of jobs / 57.5 % of output · electrification 5.0 % · capital/output 1.94. Province relative GDP per capita: Sumut 1.23, Jabar+Jakarta 1.21, Sumsel 1.12, Sumteng 1.07, Kalimantan 1.03, Jatim 1.00, DIY 0.96, Jateng 0.84, Maluku 0.82, Sulawesi 0.81, Sunda Kecil 0.69, Irian Barat 0.56.
Sim calibration (headless harness) is not done yet — see PROGRESS.md.

## Simulation calibration status (M3)
- Economic history is *not* fitted year by year. The GDP-per-capita "historical Indonesia" line in Statistics is an approximate shape (`HIST.gdpPerCapitaIndex` in `src/sim/balance.ts`) for orientation only.
- Preliminary result: passive policy reaches roughly 50 % of the 2026 target; sector TFP growth, Mincer return (0.06), capital share (0.25), reallocation rate (0.04/yr), medical progress and initial TFR (6.1) were tuned for plausible national shapes (population ~275 M by 2026). Final calibration and the policy comparison (historical / passive / smart) are done in M7 and will be recorded here.

## Transport model status (M4)
- All numbers in `config/transport.json` are modelling assumptions in the right order of magnitude (costs per km by terrain, average door-to-door speeds), not engineering data. Cost index (1950 = 0.45 of 2026) reflects cheaper labour.
- Market access uses a gravity kernel exp(−0.3 · hours); production elasticities by sector (`thetaMA`) are in `balance`. The access baseline is re-fixed (`ma0`) whenever a split or merge changes the map, so edits do not create free output.
- The coarse (long-distance) layer is an approximation: regency hubs, 90 h cutoff, refreshed every 5 years and on completions.
- Coast flag: faces with < 1 km of coastline are not coastal (slivers in the boundary data). Five river ports keep their port level without a coast.
- Calibration of `spanKmPerHour`, the access elasticities and construction prices happens in M7 with the headless policies.

## Industry and finance model status (M5)
- Industry catalog numbers (costs ×2.5 vs the first draft, build months, value added, margins, requirements) and partner quotas are modelling assumptions in the right order of magnitude. They are not firm-level or treaty data; the partner list and year windows follow general history (reparations from 1958, IGGI from 1967, ADB from 1966, etc.).
- Legacy external debt (Round Table Conference) is a stylised share of GDP at 3 %, ending 2000; terms of later loans are typical but approximate.
- Seeded 1950 industries and hidden deposits come from `tools/seeds/` and are approximate locations and sizes.
- Value added feeds output additively (`production = y0·A·mult·(1+link) + ind`), with the baseline re-fixed so seeds do not create output at start.
- Calibration of costs, value added, quotas, investment climate weights and alignment speed is deferred to M7 with the headless policies.

## Events and disasters model status (M6)
- Event dates in the historical timeline follow the general record (Korean War boom 1950–51, regional rebellions 1957–58, Konfrontasi 1963–66, 1965 upheaval, oil shocks 1973 / 1979, 1986 collapse, 1997–98 crisis, 2008 GFC, 2020 pandemic); the sizes of their effects are modelling assumptions, not estimates. Oil and commodity price paths come from `config/industries.json` (`price`) and are approximate indices.
- The eight historical disasters use approximate epicentres and sizes; random disasters use hand-set annual rates and province weights (seismic and volcanic zones, monsoon floods, peat fires) — a sketch of hazard geography, not a hazard map. Death-rate and damage scales are order-of-magnitude.
- Decision effects (Dutch seizure, Irian Barat, investment law, family planning, autonomy, fuel subsidy, resettlement) are stylised; the real events were more complex and slower.
- Calibration of shock depths, random rates and score weights happens in M7.

## Deployment
- `npm run build` → `dist/`; `node server.mjs` serves it (also what Heroku runs through the `Procfile`). Heroku: `heroku create`, then `git push heroku main` (the Node buildpack runs `heroku-postbuild` = `vite build`) — or connect the GitHub repo in the Heroku dashboard.
