// Neighbouring countries (Natural Earth 10m admin-0, public domain) → public/data/neighbors.json, simplified. Run: node tools/05_neighbors.mjs <path to ne_10m_admin_0_countries.geojson>
import fs from 'node:fs'; import * as turf from '@turf/turf';
const src = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const keep = new Set(['MYS', 'SGP', 'BRN', 'TLS', 'PNG', 'PHL', 'THA', 'AUS', 'VNM', 'KHM', 'MMR', 'LAO', 'CHN', 'IND', 'BGD', 'TWN', 'SLB', 'PLW', 'FSM', 'MHL', 'VUT', 'NCL']);
const feats = src.features.filter(f => keep.has(f.properties.ADM0_A3)).map(f => { const g = turf.simplify(turf.truncate(f, { precision: 3 }), { tolerance: 0.02, highQuality: false }); g.properties = { name: f.properties.NAME, a3: f.properties.ADM0_A3 }; return g; });
fs.writeFileSync('public/data/neighbors.json', JSON.stringify({ type: 'FeatureCollection', features: feats }));
console.log(feats.length, 'countries', (fs.statSync('public/data/neighbors.json').size / 1024).toFixed(0), 'KB');
