// Text and tone for the top-left "markers found" tag.

/**
 * @param {{candidates:any[], reason:string}|null} result latest analysis
 * @returns {{text:string, tone:'idle'|'ok'|'warn'|'error'}}
 */
export function markerTag(result) {
  if (!result) return { text: '마커 0/3', tone: 'idle' };
  const n = result.candidates.length;
  const base = `마커 ${n}/3`;
  switch (result.reason) {
    case 'ok': return { text: base, tone: 'ok' };
    case 'bad_layout': return { text: `${base} · 배치 확인`, tone: 'warn' };
    case 'too_many': return { text: `${base} · 후보 과다`, tone: 'error' };
    default: return { text: base, tone: 'warn' };
  }
}
