// All drawing goes through one canvas and one transform: the camera frame and
// the overlay share containTransform(), so dots cannot drift off the
// C7–PSIS line because of scaling, letterboxing or devicePixelRatio (spec §6).
import { containTransform, toScreen, levelPoint } from './geometry.js';
import { layoutLabels } from './labels.js';

const COLORS = {
  bg: '#0b0d10',
  marker: '#3ddc84',
  guide: 'rgba(255,255,255,0.45)',
  level: '#ffd23f',
  levelText: '#ffffff',
  textShadow: 'rgba(0,0,0,0.85)',
  rejected: 'rgba(160,160,160,0.9)',
};
const FONT = '600 13px system-ui, -apple-system, "Noto Sans KR", sans-serif';
const LABEL = { lineH: 18, gap: 12, labelW: 34 };

/** Size the canvas backing store to its CSS box × devicePixelRatio. Returns CSS size. */
export function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const { width, height } = canvas.getBoundingClientRect();
  const bw = Math.max(1, Math.round(width * dpr)), bh = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: width, h: height };
}

function text(ctx, s, x, y, color, align = 'left') {
  ctx.font = FONT;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = COLORS.textShadow;
  ctx.strokeText(s, x, y);
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

/**
 * @param {HTMLCanvasElement} canvas display canvas
 * @param {CanvasImageSource & {width:number,height:number}} frame source frame (source pixels)
 * @param {object|null} result {markers?, candidates, rejected}
 * @param {{name:string,ratio:number}[]} levels selected levels
 * @param {{debug?:boolean}} flags
 */
export function render(canvas, frame, result, levels, flags = {}) {
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, w, h);
  if (!frame || !frame.width) return;
  const t = containTransform(frame.width, frame.height, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(frame, t.ox, t.oy, frame.width * t.scale, frame.height * t.scale);

  if (flags.debug && result) drawDebug(ctx, t, result);
  if (result?.markers) drawOverlay(ctx, t, result.markers, levels, { w, h });
}

function drawOverlay(ctx, t, markers, levels, box) {
  const c = toScreen(t, markers.c7);
  const l = toScreen(t, markers.lpsis);
  const r = toScreen(t, markers.rpsis);
  const m = { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 };

  // Reference line C7 -> PSIS midpoint, and the PSIS baseline.
  ctx.strokeStyle = COLORS.guide;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(c.x, c.y); ctx.lineTo(m.x, m.y);
  ctx.moveTo(l.x, l.y); ctx.lineTo(r.x, r.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // Detected marker centers.
  for (const [p, name, align, dx] of [[c, 'C7', 'left', 14], [l, 'L-PSIS', 'right', -14], [r, 'R-PSIS', 'left', 14]]) {
    ctx.strokeStyle = COLORS.marker;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p.x - 4, p.y); ctx.lineTo(p.x + 4, p.y); ctx.moveTo(p.x, p.y - 4); ctx.lineTo(p.x, p.y + 4); ctx.stroke();
    text(ctx, name, p.x + dx, p.y - 12, COLORS.marker, align);
  }

  // Level points (computed in source pixels, then transformed).
  const pts = levels.map((lv) => ({ name: lv.name, ...toScreen(t, levelPoint(markers, lv.ratio)) }));
  const labels = layoutLabels(pts, box, LABEL);
  for (const o of labels) {
    const anchorX = o.side === 'right' ? o.lx : o.lx + LABEL.labelW;
    if (o.displaced) {
      ctx.strokeStyle = COLORS.level;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(anchorX - (o.side === 'right' ? 2 : -2), o.ly); ctx.stroke();
    }
    ctx.fillStyle = COLORS.level;
    ctx.strokeStyle = COLORS.textShadow;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(o.x, o.y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    text(ctx, o.name, anchorX, o.ly, COLORS.levelText, o.side === 'right' ? 'left' : 'right');
  }
}

function drawDebug(ctx, t, result) {
  for (const cnd of result.candidates ?? []) {
    const p = toScreen(t, cnd);
    text(ctx, `A${Math.round(cnd.area)} c${cnd.circularity.toFixed(2)}`, p.x + 12, p.y + 14, '#9ef', 'left');
  }
  for (const rj of result.rejected ?? []) {
    const p = toScreen(t, rj);
    ctx.strokeStyle = COLORS.rejected;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(p.x - 6, p.y - 6); ctx.lineTo(p.x + 6, p.y + 6); ctx.moveTo(p.x + 6, p.y - 6); ctx.lineTo(p.x - 6, p.y + 6); ctx.stroke();
    text(ctx, `${rj.why} A${Math.round(rj.area)} c${rj.circularity.toFixed(2)}`, p.x + 8, p.y + 12, COLORS.rejected, 'left');
  }
}
