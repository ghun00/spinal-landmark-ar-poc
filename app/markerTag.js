// Text and tone for the top-left "markers found" tag.

/**
 * @param {{candidates:any[], reason:string}|null} result latest analysis
 * @param {'searching'|'stabilizing'|'locked'} [lockState]
 * @returns {{text:string, tone:'idle'|'ok'|'warn'|'error'}}
 */
export function markerTag(result, lockState = 'searching') {
  if (lockState === 'locked') return { text: '마커 3/3 · 고정됨', tone: 'ok' };
  if (!result) return { text: '마커 0/3', tone: 'idle' };
  if (lockState === 'stabilizing' && result.reason === 'ok') return { text: '마커 3/3 · 확인 중', tone: 'warn' };
  const n = result.candidates.length;
  const base = `마커 ${n}/3`;
  switch (result.reason) {
    case 'ok': return { text: base, tone: 'ok' };
    case 'bad_layout': return { text: `${base} · 배치 확인`, tone: 'warn' };
    case 'too_many': return { text: `${base} · 후보 과다`, tone: 'error' };
    default: return { text: base, tone: 'warn' };
  }
}
