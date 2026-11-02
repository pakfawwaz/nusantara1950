export const hsl = (h: number, s: number, l: number): string => {
  s /= 100; l /= 100; const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x: number) => Math.round(255 * x).toString(16).padStart(2, '0'); return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
};
export function hashUnit(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; }

// Sequential ramps (light → dark), 7 classes. Perceptually ordered, readable on the pale ocean background.
export const RAMPS = {
  green: ['#edf6e4', '#cde8b5', '#a3d38a', '#6fb85f', '#3f9446', '#237033', '#0f4a22'],
  amber: ['#fdf1d2', '#f9dc9b', '#f2bf63', '#e39b3a', '#c8742a', '#9a501f', '#6a3416'],
  blue: ['#e9f1fb', '#c4daf3', '#97bfe8', '#689fd8', '#3f7cc0', '#285a98', '#173b69'],
  magma: ['#f9f0dc', '#f4d5a4', '#ecaa7b', '#d97a6c', '#b34d6f', '#7c2e6c', '#43195c'],
  teal: ['#e6f5f1', '#bde6dc', '#8ed1c3', '#5db5a8', '#3a928a', '#237068', '#134c47']
};
export const SECTOR_COLORS = ['#8dbd5b', '#3f8f4e', '#4a9bd0', '#7c6a3e', '#8a8f98', '#2f2f35', '#c9663a', '#a8793f', '#d9a441', '#d86a9a'];
export const TERRAIN_COLORS = ['#b8d9e8', '#d8e8b0', '#c4a77a', '#8c7a6b', '#7fb5a0'];
export const PROVINCE_HUES: Record<string, number> = { SUMUT: 12, SUMTENG: 32, SUMSEL: 52, JABAR: 95, JATENG: 150, DIY: 175, JATIM: 205, KALIMANTAN: 238, SULAWESI: 270, MALUKU: 305, SUNDAKECIL: 335, IRIANBARAT: 0 };
export const LOCKED_COLOR = '#b4b8bd';
export const NO_DATA = '#e4e0d6';
