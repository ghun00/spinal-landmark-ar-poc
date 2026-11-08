// Level-name placement: dots never move; labels are stacked so they do not
// overlap, kept inside the box, and flagged as displaced when a leader line
// is needed (spec §6 overlay).

/**
 * @param {{name:string,x:number,y:number}[]} items dot positions (screen px)
 * @param {{w:number,h:number}} box
 * @param {{lineH:number,gap:number,labelW:number}} opts
 * @returns {{name,x,y,lx,ly,side:'right'|'left',displaced:boolean}[]}
 *   lx = label left edge, ly = label vertical center.
 */
export function layoutLabels(items, box, { lineH, gap, labelW }) {
  const out = items
    .map((it) => {
      const right = it.x + gap + labelW <= box.w;
      return {
        name: it.name, x: it.x, y: it.y,
        side: right ? 'right' : 'left',
        lx: right ? it.x + gap : Math.max(0, it.x - gap - labelW),
        ly: it.y,
      };
    })
    .sort((a, b) => a.y - b.y);

  const half = lineH / 2;
  // Downward pass: no overlap, nothing above the top edge.
  let prev = -Infinity;
  for (const o of out) {
    o.ly = Math.max(o.ly, half, prev + lineH);
    prev = o.ly;
  }
  // Upward pass: pull the stack back inside the bottom edge.
  let next = Infinity;
  for (let i = out.length - 1; i >= 0; i--) {
    const o = out[i];
    o.ly = Math.min(o.ly, box.h - half, next - lineH);
    next = o.ly;
  }
  for (const o of out) o.displaced = Math.abs(o.ly - o.y) > 1;
  return out;
}
