export const PALETTE = [
  '#FFF9B1', '#FFD02F', '#FF9D48', '#F5B6CF', '#C6A2D2',
  '#A6CCF5', '#93D275', '#D5F692', '#FFFFFF', '#1A1A1A',
];

/** Pick a readable text color for a given background. */
export function textOn(fill: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(fill);
  if (!m) return '#1a1a1a';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum < 0.5 ? '#ffffff' : '#1a1a1a';
}
