// Runs the whole data pipeline in order (Windows-safe: no bash). Raw inputs expected in data_raw/ (see DATA_NOTES.md).
import { spawnSync } from 'node:child_process';
const steps = ['01a_parse', '01b_clean', '01c_derive', '02_admin1950', '03a_seeds', '03b_attributes', '04_report'];
for (const s of steps) {
  console.log(`\n=== ${s} ===`);
  const r = spawnSync(process.execPath, [`tools/${s}.mjs`], { stdio: 'inherit' });
  if (r.status !== 0) { console.error(`step ${s} failed`); process.exit(r.status ?? 1); }
}
