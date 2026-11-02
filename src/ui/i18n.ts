// All user-facing strings live here so a Bahasa Indonesia dictionary can be added later. Indonesian official terms are kept in English UI.
type Dict = Record<string, string>;
const en: Dict = {
  'app.title': 'NUSANTARA 1950',
  'app.date': '17 August 1950',
  'btn.budget': 'Budget', 'btn.regions': 'Regions', 'btn.stats': 'Stats', 'btn.save': 'Save',
  'tool.road': 'Build road', 'tool.rail': 'Build railway', 'tool.port': 'Build / upgrade port', 'tool.road.tip': 'Click a start kecamatan, optional waypoints, then the end; press Enter (or double-click) to price the route.', 'tool.rail.tip': 'Click a start kecamatan, optional waypoints, then the end; press Enter (or double-click) to price the line and choose stations.', 'tool.port.tip': 'Click a coastal kecamatan to build or upgrade its port.', 'tool.industry': 'Build industry', 'tool.industry.tip': 'Click a kecamatan to see which industries it can host and how to finance one (budget, foreign investment or aid loan).',
  'btn.transport': 'Transport', 'btn.industry': 'Industry', 'btn.finance': 'Finance', 'mode.ma': 'Market access',
  'tool.select': 'Select', 'tool.box': 'Box select', 'tool.lasso': 'Lasso select', 'tool.split': 'Split kecamatan',
  'tool.select.tip': 'Click a kecamatan to inspect. Shift+click adds, Alt+click removes.',
  'tool.box.tip': 'Drag a rectangle. Hold Shift to add, Alt to subtract.',
  'tool.lasso.tip': 'Draw a freehand loop around kecamatan (by label point). Shift adds, Alt subtracts.',
  'tool.split.tip': 'Draw a line across one kecamatan to split it in two (costs money).',
  'mode.political': 'Political', 'mode.density': 'Population density', 'mode.gdppc': 'GRDP per capita', 'mode.ipm': 'IPM',
  'mode.specialty': 'Economic specialty', 'mode.electrification': 'Electrification', 'mode.terrain': 'Terrain', 'mode.infrastructure': 'Infrastructure',
  'mode.taxrev': 'Tax revenue', 'mode.funding': 'Funding ratio', 'mode.stability': 'Stability',
  'inspector.empty.title': 'Nothing selected', 'inspector.empty.body': 'Click a kecamatan on the map, or use the box / lasso tools to select several. Use the search box to jump to a place.',
  'inspector.locked': 'Irian Barat is under Dutch administration until the 1963 transfer — you cannot administer or fund it yet.',
  'tab.overview': 'Info', 'tab.demography': 'People', 'tab.economy': 'Econ.', 'tab.budget': 'Budget', 'tab.infrastructure': 'Infra', 'tab.admin': 'Admin', 'tab.history': 'History',
  'scope.kecamatan': 'Kecamatan', 'scope.regency': 'Regency', 'scope.province': 'Province',
  'btn.selectRegency': 'Select whole regency', 'btn.selectProvince': 'Select whole province', 'btn.clear': 'Clear selection',
  'legend.locked': 'Not under your control',
  'search.placeholder': 'Search kecamatan, regency, province…',
  'terrain.0': 'Coastal lowland', 'terrain.1': 'Lowland', 'terrain.2': 'Hills', 'terrain.3': 'Mountains', 'terrain.swamp': 'Swamp / peat',
  'road.0': 'Track / none', 'road.1': 'Local road', 'road.2': 'Provincial trunk road', 'road.3': 'National road', 'road.4': 'Toll motorway', 'road.5': 'High-capacity toll',
  'school.0': 'None', 'school.1': 'Primary (SR)', 'school.2': 'Primary + junior (SMP)', 'school.3': 'Up to senior (SMA)', 'school.4': 'University city',
  'health.0': 'None', 'health.1': 'Clinic', 'health.2': 'Small hospital', 'health.3': 'Regional hospital', 'health.4': 'Teaching hospital'
};
let dict: Dict = en;
export const t = (k: string): string => dict[k] ?? k;
export function setDict(d: Dict): void { dict = { ...en, ...d }; }
