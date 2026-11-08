// Ratio config (single source: config/ratios.json) and default selection.
export const DEFAULT_SELECTED = ['T1', 'T7', 'L1', 'S1'];

export async function loadRatios(url = 'config/ratios.json') {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`ratios.json ${res.status}`);
  const data = await res.json();
  return { version: data.version, levels: data.levels.map((l) => ({ name: l.name, ratio: Number(l.ratio) })) };
}
