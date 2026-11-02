// Repair geometry + build shared topology with mapshaper (no GDAL). Output: data_raw/work/kec_clean.json (TopoJSON)
import mapshaper from 'mapshaper';
const t0 = Date.now();
const cmd = [
  '-i data_raw/work/kec_raw.geojson name=kec snap',
  '-clean gap-fill-area=2km2',
  '-o data_raw/work/kec_clean.json format=topojson precision=0.0001 force'
].join(' ');
await mapshaper.runCommands(cmd);
console.log('mapshaper clean done in', ((Date.now() - t0) / 1000).toFixed(1), 's');
