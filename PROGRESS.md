# NUSANTARA 1950 — Progress

## Status
| Milestone | State |
|---|---|
| M0 Data pipeline | **Done** (fallback data — see DATA_NOTES.md; 21/21 checks in DATA_REPORT.md) |
| M1 Map, selection, inspector, modes | **Done** (browser-verified) |
| M2 Admin editing | **Done** (browser-verified; 15 tests) |
| M3 Simulation core | **Done** (browser-verified; 23 tests in 6 files) |
| M4 Infrastructure & market access | **Done** (browser-verified; 34 tests in 7 files) |
| M5 Industries & finance | **Done** (browser-verified; 46 tests in 8 files) |
| M6 Events, decisions, ending | **Done** (browser-verified; 57 tests in 9 files) |
| M7 | Pending (calibration, performance, tutorial, polish) |

## How to run
```
npm install
npm run data:all     # only if you want to regenerate public/data (outputs are already committed)
npm run dev          # http://localhost:5173
npm test
npm run build
```

## Done (M0 + M1)
- Pipeline in `/tools` (pure Node, no GDAL, Windows-safe): boundaries → TopoJSON with shared arcs, adjacency, coast, islands; 1950 administrative rollback (250 regencies, 12 provinces, Irian Barat locked); seeds; synthetic attributes calibrated to `config/world.json`; report.
- 7,2xx kecamatan rendered via MapLibre with feature-state colouring; 8 map modes (political, density, GDP/capita, IPM, specialty, electrification, terrain, infrastructure).
- Click / Shift-add / Alt-subtract, box and lasso selection; inspector with Kecamatan / Regency / Province scopes and Overview / Demography / Economy / Infrastructure tabs; search; zoom-dependent labels.
- IPM formula (BPS method) with tests.

## Done (M2)
- `src/geo`: editable boundary store (`arcs.ts`: every border polyline stored once with its two owning kecamatan; meshes, adjacency and coast flags are derived from it), `split.ts` / `merge.ts` (jsts noding + polygonize on the shared 0.0001° integer grid, so shared edges stay exact), slivers rejected (<0.5 km² or <2 %), area checked ≤ 0.5 %.
- `src/admin`: command layer. Every edit is a command that is *planned* (rule checks, cost, persiapan months, geometry preview) before it is *applied*: createRegency, moveKecamatan, mergeRegencies, createProvince, moveRegency, mergeProvinces, splitKecamatan, mergeKecamatan, rename, setCapital. Rules and costs: `config/admin.json`.
- `src/game.ts`: treasury (`cash`), month counter, history, strictly-LIFO undo (allowed while the edit is not yet effective: same month, or the new unit is still in persiapan).
- UI: Admin tab in the inspector, preview-and-confirm dialogs, Split tool (4th tool: click points across a kecamatan, double-click / Enter to finish), Undo button + Ctrl+Z, cash chip, new regencies/provinces hatched while in persiapan.
- Splits conserve people, urban people, output and capital exactly (attributes follow synthetic sample points, the urban core and resource sites); split piece ids are `<parent>~n` with lineage kept.
- Tests: `tests/split.test.ts`, `tests/geo.test.ts`, `tests/admin.test.ts` (area ≤ 0.5 %, conservation, adjacency, contiguity incl. sea links, undo round trips, split < 2 s).

## Done (M3)
- `src/sim/*`: pure-TS `SimCore` (runs in a Web Worker via Comlink and in Node for the headless harness). Monthly step: demography (3 age boxes, migration along income gradients, transmigration) → social indicators (life expectancy, schooling, poverty, urbanisation, electricity/water, IPM) → economy (10 sectors, baseline-normalised production with human capital, capital deepening, electricity, governance, stability) → fiscal → aggregates → macro (inflation, stability, win/lose flags).
- Fiscal system: central taxes (PPh, sales tax → VAT from 1983, excise, customs, oil & gas, royalties), regional PAD/DBH, DAU/DAK, operating costs per kecamatan/regency/province, funding ratio → governance, deficit financing (bonds → central-bank money → inflation), surplus repays debt, APBN adopted for next January, one APBN-P per year (Jun–Sep), optional 3 %-of-GDP deficit rule.
- Clock (pause + 4 speeds, Space / 1–4), status bar (cash, balance, debt, progress to target, inflation, stability), Budget window, Regions table, Statistics charts (uPlot, grey approximate historical ghost line), inspector Budget and History tabs, map modes *tax revenue*, *funding ratio*, *stability*.
- Save / Load: 5 manual slots + 3 rolling autosaves (every game month, throttled), export/import file (deflated binary: header JSON + typed arrays); load replays the geometry edit log, then overwrites all state.
- Tests: budget identity (Δcash and Δdebt, every month), population conservation (migration, transmigration, births − deaths), save-format round trip, resumed-run tracking, plus the M0–M2 suites.

## Done (M4)
- `config/transport.json` holds every tunable: 6 road classes (track → high-capacity toll, with unlock years), 4 rail classes, 5 port levels, terrain cost factors, cost index by year, speeds, maintenance, rail fares and freight, access decay.
- `src/sim/transport.ts`: travel graph over kecamatan (roads by class × condition, off-road fallback, rail express edges between *stations only* with dwell time, sea links between ports), Dijkstra router, **market access** `ma_i = Σ pop_j·exp(−0.3·T_ij)/P` (local out to 10 h + a coarse regency-hub layer out to 90 h), travel time to regency / province capital (feeds span of control in governance).
- Production now uses `(ma/ma0)^θ_sector`; roads therefore pay back through output, not through a hard-coded bonus.
- Construction queue (`projects.ts`, `transportSim.ts`): road / rail / upgrade / station / port projects with unlock years, cost scaled by year and by governance (overrun), paid monthly, finish after the build time; pause / cancel. Cost enters the budget identity as spending.
- Maintenance is a budget line (*Maintenance*, % of GDP): coverage = funded / required; below 100 % road and rail condition decay (slower speeds), above it they recover. Rail earns fare + freight revenue (gravity model between stations) against operating costs.
- UI: Build road / Build railway / Build port tools on the tool rail (click start, optional waypoints, Enter), project dialog with route length, cost, build time, **access-gain heat map**, estimated output gain and payback (economic and fiscal); Transport window (network lengths and condition, maintenance coverage, rail finances, projects under construction, railway lines with Upgrade); inspector *Infra* tab (access index, minutes to regency / province capital, Add station, Build / upgrade port); map mode *Market access*; roads, rail, stations, ports and projects drawn on the map.
- Geometry edits re-thread rail lines and queued projects through new pieces (split) or the kept kecamatan (merge); geo-undo restores them.
- Coast flag now ignores slivers < 1 km (`ports.minCoastKm`): 81 inland kecamatan (e.g. in Bandung) were "coastal" because of boundary-vintage gaps. Five river ports (Palembang, Pontianak, Banjarmasin, Samarinda, Batanghari) stay buildable / upgradable.
- New tests (`tests/transport.test.ts`): route contiguity, plan rules (unlock year, adjacency, already-built, upgrade cheaper), access rises after a completed road, rail only helps stations, ports link islands, construction cost enters spending with the budget identity intact, maintenance decay / recovery, split / merge re-threading, save round trip with projects.

## Done (M5)
- `config/industries.json` holds every tunable: 32 industry types (unlock year, sector, cost, build months, value added, margin, FDI eligibility, requirements, inputs, resource, linkage and power spill-over, TFP bonus, peak and decay), 10 financing partners (legacy, US, World Bank, Japan reparations, ADB, IGGI, Japan ODA, USSR, Eastern Europe, China), FDI offers, aid, alignment, climate, nationalise / privatise, exploration and debt parameters.
- `src/sim/industry.ts`: requirements (schooling, electricity, port within a few hops, road class or station, inputs, resource), capacity by type, FDI offers (turnkey / joint venture / BOT) gated by the investment law and climate, partner quotas that scale with GDP and shrink as alignment moves away from the bloc, value-added rows (`ind`, `link`, `pwr`) that feed production, nationalisation compensation and privatisation price, remap on split / merge.
- `src/sim/finance.ts`: legacy (Round Table) debt seeded at start, program loans, amortisation with grace, debt by creditor, investment climate (law, stability, alignment, governance, nationalisation memory, debt stress, income and infrastructure), alignment drift.
- `src/sim/industrySim.ts`: monthly build progress and outlay (APBN), aid draw, completion (TFP bonus), profits (state-owned revenue, foreign profit leakage), divestment, resource exploration revealing hidden deposits.
- Cash identity now includes external amortisation (`extRepay`); tests in `sim`, `transport` and `industry` assert it.
- Baseline now normalises against seeded industries so starting output is unchanged (`rebaseline`).
- UI: **Industry** window (My industries / Catalog / Deposits; Nationalise, Sell, Pause, Cancel, Develop), build-industry dialog with requirement checklist, financing choice (Budget / Foreign investment / Aid loan), cost, value added, payback; **Finance** window (KPIs, climate bars, investment law, alignment slider, aid partners with budget-support Draw, loans with Repay 10 % / all, debt by creditor); industry tool on the tool rail; industries and revealed deposits on the map; Budget row *Resource exploration*; inspector *Infra* tab lists industries.
- New tests (`tests/industry.test.ts`, 12): rules, FDI offers, aid by alignment, APBN flow and identity, FDI, aid loan with grace and amortisation, quota, nationalise and climate, exploration, climate drivers, split / merge remap, save round trip.

## Done (M6)
- `config/events.json` holds everything tunable: ending rules and score weights, the Randomized event pool, the dated historical timeline, disaster kinds with province weights, 8 famous historical disasters, and 7 decisions with their effects.
- `src/sim/events.ts` (runs at the start of each month inside `SimCore.step`, so the worker and the headless harness behave identically):
  - **Shocks** (temporary effects): output multipliers (national by sector, or per province), oil and commodity price multipliers, stability, investment-climate and inflation offsets, mortality, one-off real depreciation of foreign debt. Continuous effects fade over the last quarter of the duration.
  - **Historical mode**: Korean War boom and bust, 1957 rebellions, Konfrontasi, 1965 upheaval, 1973 / 1979 oil shocks (prices come from the history tables), 1986 collapse and devaluation, 1997–98 Asian crisis, 2008 GFC, 2010 boom, 2014 bust, 2020 pandemic. **Randomized mode**: the same families arrive as Poisson draws from a seeded generator (the generator state is in the save, so a seed replays the same world); price tables are replaced by a smooth trend.
  - **Disasters** (both modes): earthquake, eruption, flood (Dec–Feb), drought, forest fire, tsunami; epicentre by province weights (locked provinces excluded), size log-skewed. Deaths scale with local income (vulnerability), capital is destroyed, output falls around the epicentre and recovers linearly; the treasury pays 30 % of the capital lost over 12 months (Budget row *Disaster relief*). Disaster deaths are part of the national death count. Historical mode adds Agung 1963, Galunggung 1982, Flores 1992, 1997 haze, Aceh 2004, Yogyakarta 2006, Merapi 2010, Palu 2018.
  - **Decisions** (open in both modes, pause the game, can be deferred; the default applies at the deadline): Resettlement 1952, Dutch enterprises Dec 1957 (seize / compensate into the legacy debt / leave), West New Guinea 1962 (sets the join date), investment law 1967, family planning 1968, regional autonomy 1999 (scales the DAU pool), fuel-subsidy squeeze (repeats when oil is high and subsidies are large).
  - **Irian Barat now really joins** the republic (province unlock in the worker, passed back to the map) in May 1963 by default, Jan 1963 after mobilisation, 1969 if deferred.
  - **Win**: GDP per capita ≥ Rp 89 M (2026 prices) for 3 months. **Lose** (each toggleable in Settings): hyperinflation (> 500 %/yr for 3 months), political collapse (stability < 15 for 12 months), sovereign default (debt service > X % of revenue for 24 months, X adjustable, default 60 %), 2050 reached without the target. Score 0–1000 (speed, IPM, poverty, stability, equality, debt); a loss scores progress.
- UI: **Events** button (badge = open decisions) → Chronicle (open decisions, conditions now acting on the economy, disasters recovering, filterable history); decision dialog; **⚙ Settings** (Historical / Randomized — changeable only in the first year —, seed, lose toggles, default threshold, new game); end screen (score breakdown, key figures, GDP chart against the target and the approximate real history, decisions taken; keep playing as a sandbox or new game); toasts for new events; the Budget window now also lists *Industry projects* and *Disaster relief*.
- Heroku-ready: `Procfile`, `server.mjs` (dependency-free static server with gzip), `heroku-postbuild`.
- New tests (`tests/events.test.ts`, 11): timeline and decision dates, shocks and fading, seeded replay, Dutch decision outcomes and deadline default, Irian join dates, budget and autonomy effects, disaster effects and recovery with the budget identity, province weights and locked provinces, win / lose rules and toggles, scoring.

## Next
- M7: calibration with the headless harness (historical / passive / smart policies), balance, performance (< 50 ms tick, off-thread access recompute), tutorial, polish.

## Known issues / honest limitations
- **GHSL population and ETOPO elevation could not be downloaded** from this build environment. Population per kecamatan comes from census-1961 group shares + an area-power/city-decay heuristic; terrain from 19 hand-drawn ridges. Both are approximate. To upgrade: place the files from the URLs in DATA_NOTES.md into `data_raw/` and write the zonal-stats step (not written yet).
- Individual kecamatan numbers (population, GDP, literacy…) are synthetic but calibrated to national / provincial 1950 targets. Do not read them as history.
- Small white specks (tiny gaps in the polygon fill) are visible at overview zoom in parts of Kalimantan; cosmetic.
- Rail / road paths are topological stand-ins (Dijkstra over adjacency), not real track geometry.
- **M4 simplifications** (all cuts, none stubbed): construction progresses monthly (not daily); a road's class is a property of the *kecamatan* (edge class = min of its two ends), so a high class can create phantom shortcuts between two roaded kecamatan that are only adjacent; no air links, no severance penalty, no toll revenue; the coarse long-distance layer is recomputed every 5 years (and on completion) and double counts slightly with the local layer; the build-dialog preview uses local access only (≤10 h); cancelled projects lose what was already spent; upgrades are whole-line only; the 3 % deficit rule ignores construction outlay; `spanKmPerHour` (9) is not calibrated yet; access recompute costs ~0.2–0.3 s every January and ~1 s when a project completes (will be moved off the tick in M7).
- **M5 simplifications** (cuts, none stubbed): industry spill-over and power radii are counted in neighbour hops (`ceil(hours/2)`, max 3, weight 0.5^hop), not travel hours; the port requirement means a port within `portHops` neighbour hops; a split places an industry on the nearest piece by label point; `jobs` is informational (no labour market); repatriated profit is shown but has no balance-of-payments or exchange-rate effect; the 1957 Dutch nationalisation is a player action now and becomes a scripted event in M6; aid quotas make big projects unaffordable by aid alone in the early 1950s (e.g. Rp 417 B quota vs Rp 543 B sugar mill) — untuned until M7; industry costs, value added and quotas are first-pass numbers; heavy-industry sites are scarce early because of the schooling and electricity thresholds.
- **M6 simplifications** (cuts, none stubbed): shocks are national or whole-province output multipliers (no per-sector regional effects); a one-off devaluation raises the rupiah value of foreign debt but does not model an exchange rate or imports; the 1957 seizure is a single choice (no gradual process, no Dutch-owned banks); decisions have fixed effect lists (no cost-benefit preview beyond the text); disaster relief is automatic (no reserve fund, no player response lever); a geometry edit made during a shock re-baselines output at its depressed level for the pieces concerned; random event rates and depths, disaster sizes and the death-rate scale are first-pass numbers; the mode (Historical / Randomized) cannot change after the first year; in Randomized mode the seeded deposits are still found only by exploration.
- Starting road class per kecamatan and railway lines come from approximate seeds (DATA_NOTES.md §6), not surveyed data.
- Rule-check messages in the admin dialogs are inline English strings (not yet in `i18n.ts`).
- Persiapan currently has two effects: running cost and governance × 0.9. Stability effects of merges / grants are recorded in history; the explicit unrest / demand-for-new-units mechanic is not built yet.
- Population of split pieces is an estimate from synthetic sample points (no GHSL raster).
- Political pressure (demands for new regencies / provinces) is not built yet (planned for M6 events).
- **Calibration is preliminary (M3).** The passive run is ~50 % of target in 2026, revenue/GDP climbs to ~18–30 % late, surpluses repay all debt and then cash piles up (no sovereign fund yet), life expectancy lags history (~69 in 2026 passive), regency funding ratios are 200–700 %. Final calibration with the headless harness is M7.
- Tick cost: average ~26 ms, worst ~95 ms (target < 50 ms): `migrate` allocates per-kecamatan arrays; optimise in M7.
- A resumed save tracks the uninterrupted run within ~0.01 % but is not bit-exact (span-of-control is measured when a SimCore is built; last month's per-unit stats restart).
- Kecamatan in locked provinces (Irian Barat) simulate but are excluded from national aggregates and fiscal flows until 1963.
- `admin.json` annual overhead figures are only used for dialog previews; real running costs come from `budget.json`.
- Historical ghost line in Statistics is an approximate shape (visual guide), not an official series.
- Rule messages in the admin dialogs and simulation notices are inline English, not in `i18n.ts`.
## Please test manually (M1)
1. Load the page: the archipelago fits the screen; Irian Barat is hatched grey (locked until 1963).
2. Switch each map mode; legends should change and the map should recolour instantly.
3. Search "Bandung", pick a result; the inspector shows the kecamatan. Switch scope to Regency and Province.
4. Use Box and Lasso tools; hold Shift to add, Alt to subtract; Esc clears.
5. Zoom from national to street level; labels should move from provinces → regencies → kecamatan without overlapping.

## Please test manually (M2)
1. Select several adjacent kecamatan (box tool) → inspector → **Admin** tab → *Create regency from selection…*. Try fewer than 5, or a non-contiguous set: the dialog should list ✗ rules. A valid one shows cost, running cost and 12-month persiapan; the new regency appears hatched.
2. **Undo** (top bar or Ctrl+Z) restores the old map and refunds the cost.
3. *Move selection to another regency…*, and under the Regency scope: *Merge into adjacent regency…*, *Move to another province…*, *Create province…* (needs ≥ 5 contiguous regencies), *Merge provinces*.
4. **Split tool** (4th icon): click a few points across one kecamatan, from outside edge to outside edge; double-click or Enter. The dialog previews the pieces (coloured), their area and estimated population. Confirm, then check the new border and names.
5. Select exactly two neighbouring kecamatan of one regency → *Merge …*.
6. Irian Barat (hatched grey) refuses every edit.

## Please test manually (M3)
1. Load the game: the status bar shows Cash, Balance, Debt, progress bar to Rp 89 jt, Inflation, Stability. Date starts 17 August 1950, paused.
2. Press **Space** (pause/resume) and **1–4** (speed). The date chip advances month by month; at speed 4 several months per second.
3. **Budget**: change Education to 2.5 and press *Adopt for next year* — the line takes effect in January. *Apply revision now (APBN-P)* is enabled only June–September, once a year. Change a tax rate: effect is immediate. Tick the deficit-rule box and check lines are scaled down when the deficit would pass 3 % of GDP.
4. **Regions**: sort by any column, filter by text, click a row to select that regency on the map.
5. **Statistics**: switch between the nine charts; GDP per capita shows your line, the grey approximate-history line and the gold target line. Year ticks are whole years.
6. Select a few kecamatan → inspector **Budget** tab (taxes raised, public-service capital) and **History** tab. Map modes *Tax revenue*, *Funding ratio*, *Stability*.
7. **Save / Load**: save in a slot, change something (e.g. split a kecamatan), load the slot — the page reloads and the state matches the save. Export a slot and import it again. Autosaves appear every game month while running.
8. Split or merge something while the clock is running: no console errors, and the simulation continues from the edited map.
## Please test manually (M4)
1. Pick the **Build road** tool (tool rail). Click Kota Bandung, then Kabupaten Cirebon, press **Enter** (or double-click). The dialog shows km, cost, build time, an access-gain heat map and payback. A class marked "(from 1955)" cannot be started in 1950 (button disabled).
2. Start the project, run at speed 3–4: *Transport* window shows progress and money paid month by month; Budget shows *Construction* as a fixed spending row; cash drops accordingly. On completion the road appears in the infra layer.
3. Map mode **Market access**: Java is dark teal; compare before / after a long road.
4. **Build railway**: a route that already has rails warns that it would lay a second line; stations default to the ends and big cities. Narrow-gauge takes ~10 years for 280 km (by design).
5. **Build port** on a coastal kecamatan (and on a river port like Palembang to upgrade it). Inland kecamatan show no *Build port* button.
6. Budget → set *Maintenance* to 0 for two years: the Transport window shows coverage ~0 % and conditions fall; set it back above 100 % and they recover.
7. Split a kecamatan that a rail line crosses: the line remains continuous; stations stay on the right piece.
8. Save / load with a project under construction: it resumes where it was.

## Please test manually (M5)
1. Top bar → **Industry**: tabs *My industries* (seeded 1950 estates, mills and mines), *Catalog* (greyed rows show what is missing) and *Deposits* (only revealed ones).
2. Pick the **Industry** tool (tool rail), click Lengkong (Kota Bandung). Choose *Sugar mill*, financing **Budget (APBN)**: requirement ticks, cost, value added and payback appear. Start; it builds over 18 months, the marker turns solid, Budget shows an *Industry* spending row.
3. Same dialog with **Aid loan**: lenders depend on alignment; a project above the lender's yearly quota is refused with the exact shortfall. **Foreign investment** is offered only after you enact the law in Finance (from 1958).
4. **Finance** window: set alignment to −0.8 (West); US and World Bank quotas open, Eastern lenders show "none at this alignment". Draw budget support (cash rises, a loan appears under *External debt by creditor*); Repay 10 % / all lowers it.
5. Budget → *Resource exploration* (% of GDP): after a few years new deposits appear in *Deposits* and as map markers.
6. Industry → *Nationalise* a foreign-owned industry: compensation is paid, the climate bar *Nationalisations* drops and fades over years.
7. Split a kecamatan that holds an industry: it stays on one piece; save / load keeps industries and loans.

## Please test manually (M6)
1. Run at speed 4 until March 1952: the **Resettlement from Java** dialog opens and the clock pauses. Pick an option; the Budget window's *Transmigration* draft changes. Choose *Decide later* instead: the Events button keeps a red badge and the Chronicle lists it with a *Decide…* button.
2. **Events** window: conditions acting now (e.g. *Commodity prices fall back* from Aug 1952), disasters recovering (with the share of output loss still remaining), filterable history.
3. Wait for Dec 1957: **Dutch enterprises**. Compare the three options in Industry (ownership of the 1950 estates and mills) and in Finance (legacy debt up after *Nationalise with compensation*, climate bars after *Seize*).
4. **West New Guinea** (Jan 1962): pick *Negotiate*; the map shows Irian Barat as part of the republic after May 1963 (it was hatched and grey before) and the national population and GDP include it.
5. Any time: a disaster toast (e.g. "Flooding near …"). Budget shows *Disaster relief* for a year.
6. **⚙ Settings**: switch to Randomized within the first year, or start a new game with a seed; switch off *Reaching 2050* and play past 2050; change the default threshold.
7. Let hyperinflation happen on purpose (Budget: huge deficits with no bond capacity) or the 2050 limit: the **end screen** shows reason, score, chart, decisions. *Keep watching* turns the checks off.
