// Design trial v2: bottom-sheet level picker + summary pill.
// main.js owns state and builds the chips (one .chip per level inside
// #levels, toggling aria-pressed). This module only regroups the chips by
// spine region, keeps the summary pill in sync, and opens/closes the sheet.

const GROUPS = [
  { title: '흉추', sub: 'Thoracic', test: (n) => n.startsWith('T') },
  { title: '요추', sub: 'Lumbar', test: (n) => n.startsWith('L') },
  { title: '천추', sub: 'Sacral', test: (n) => n.startsWith('S') },
];
const SUMMARY_MAX = 5;

const levels = document.getElementById('levels');
const pill = document.getElementById('levelPill');
const summary = document.getElementById('levelSummary');
const sheet = document.getElementById('levelSheet');
const backdrop = document.getElementById('sheetBackdrop');
const done = document.getElementById('sheetDone');

// ---------- grouping ----------
function regroup() {
  const chips = [...levels.querySelectorAll(':scope > .chip')];
  if (!chips.length) return;
  const sections = GROUPS.map((g) => {
    const items = chips.filter((c) => g.test(c.textContent.trim()));
    if (!items.length) return null;
    const sec = document.createElement('section');
    sec.className = 'level-group';
    const h = document.createElement('h3');
    h.innerHTML = `${g.title}<small>${g.sub}</small>`;
    const wrap = document.createElement('div');
    wrap.className = 'level-chips';
    wrap.append(...items);
    sec.append(h, wrap);
    return sec;
  }).filter(Boolean);
  const rest = chips.filter((c) => !GROUPS.some((g) => g.test(c.textContent.trim())));
  levels.replaceChildren(...sections, ...rest);
}

// ---------- summary pill ----------
function updateSummary() {
  const on = [...levels.querySelectorAll('.chip[aria-pressed="true"]')].map((c) => c.textContent.trim());
  if (!on.length) {
    summary.textContent = '선택 안 함';
    summary.classList.add('empty');
    return;
  }
  summary.classList.remove('empty');
  summary.textContent = on.length > SUMMARY_MAX
    ? `${on.slice(0, SUMMARY_MAX - 1).join(' · ')} +${on.length - (SUMMARY_MAX - 1)}`
    : on.join(' · ');
}

// main.js builds chips once (childList) and toggles aria-pressed on click.
new MutationObserver((records) => {
  if (records.some((r) => r.type === 'childList' && [...r.addedNodes].some((n) => n.classList?.contains('chip')))) regroup();
  updateSummary();
}).observe(levels, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });

// ---------- sheet open / close ----------
let lastFocus = null;

function openSheet() {
  lastFocus = document.activeElement;
  backdrop.hidden = false;
  sheet.hidden = false;
  requestAnimationFrame(() => { backdrop.classList.add('open'); sheet.classList.add('open'); });
  pill.setAttribute('aria-expanded', 'true');
  (sheet.querySelector('.chip') ?? done).focus({ preventScroll: true });
}

function closeSheet() {
  backdrop.classList.remove('open');
  sheet.classList.remove('open');
  pill.setAttribute('aria-expanded', 'false');
  const finish = () => { backdrop.hidden = true; sheet.hidden = true; };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
  else sheet.addEventListener('transitionend', finish, { once: true });
  lastFocus?.focus?.({ preventScroll: true });
}

pill.addEventListener('click', openSheet);
done.addEventListener('click', closeSheet);
backdrop.addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });

// Swipe down on the sheet to close.
let startY = null;
sheet.addEventListener('touchstart', (e) => { startY = e.touches[0].clientY; }, { passive: true });
sheet.addEventListener('touchend', (e) => {
  if (startY !== null && e.changedTouches[0].clientY - startY > 60) closeSheet();
  startY = null;
});

regroup();
updateSummary();
