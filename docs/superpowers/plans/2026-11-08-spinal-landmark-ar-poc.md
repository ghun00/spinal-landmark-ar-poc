# Spinal Landmarking AR PoC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Static web app (Vercel) that detects 3 red circular stickers with OpenCV.js in the phone browser, classifies C7 / L-PSIS / R-PSIS, and overlays ratio-based spinal level positions; plus a Python + OpenCV reference implementation validated on synthetic images.

**Architecture:** No bundler. `index.html` + ES modules in `app/`, pinned `vendor/opencv-4.13.0.js`, shared `config/*.json` read by both web and Python. Pure logic (classification, ratio interpolation, contain transform, label layout) lives in dependency-free modules tested with `node --test`; OpenCV detection is mirrored in Python (`reference/`) and JS and checked for parity on the same fixtures.

**Tech Stack:** Vanilla JS (ES2022 modules), OpenCV.js 4.13.0, Canvas 2D, getUserMedia; Python 3 + opencv-python-headless + numpy + pytest; Node 22 built-in test runner.

**Spec:** `Spinal_Landmarking_AR_PoC_Spec.md` (requirements, wins on conflict) and `docs/superpowers/specs/2026-11-08-spinal-landmark-ar-poc-design.md` (design decisions). Read both.

## Global Constraints

- OpenCV is mandatory for marker detection; do not replace it with plain JS pixel loops.
- Runs from a phone URL only: no server-side processing, no user PC/Python dependency.
- No save/export of images, video, or coordinates; no login, DB, history, upload. In-memory frame for freeze only.
- Ratios exactly as spec §4 (T1 2.94, T2 6.49, T3 11.62, T4 16.01, T5 23.18, T6 31.16, T7 39.04, L1 73.13, L2 78.21, L3 83.90, L4 87.69, L5 92.82, S1 95.87), PSIS midpoint = 100%.
- `P = C + r(M − C)`, `M = (L+R)/2`, `r = ratio/100`, computed in source-video pixel coordinates, no y sign flip.
- Exactly 3 valid candidates or nothing is shown. Never keep the last positions on an invalid frame.
- Rear camera, no mirroring; screen-left PSIS = L-PSIS.
- UI text Korean; persistent footer "비율 기반 추정 위치 · 해부학적 정확도 미검증". Never claim anatomical accuracy.
- Default selected levels T1, T7, L1, S1.
- Repo `ghun00/spinal-landmark-ar-poc`, public. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Video dimensions change mid-session (rotation, camera renegotiation) → transform recomputed every frame from current `videoWidth/videoHeight`; canvas resized on `resize`. (Task 4 test: `containTransform` round-trips for portrait and landscape inputs; Task 6 browser check.)
2. Three candidates where C7 is not clearly above both PSIS (person bent, phone sideways) → hidden with "배치 확인" guidance, not a wrong assignment. (Task 2/3/4 test `bad_layout`.)
3. Freeze then toggle levels → redraw uses stored frame + stored markers, no new detection. (Task 6 browser check.)
4. Camera track ends / permission revoked / insecure origin → error state with cause-specific Korean message and retry. (Task 6: `classifyCameraError` unit test.)
5. Labels near canvas edges or many levels clustered (L1–S1 are 3–5% apart) → labels stay within canvas, never overlap, dots never move. (Task 4 test.)

---

### Task 1: Repo scaffold, configs, Python env

**Files:**
- Create: `.gitignore`, `.vercelignore`, `vercel.json`, `config/ratios.json`, `config/detection.json`, `reference/requirements.txt`, `vendor/opencv-4.13.0.js`, `package.json`

**Interfaces — Produces:**
- `config/ratios.json`: `{ "version": "spinevst-sample-c3d-v1", "source": "SpineVST (Sample C3D)", "sourceUrl": "https://app.notion.com/p/40a624e7163d8156a95cd1fad6b104e7", "denominator": "C7→S2 vertical distance; PoC assumption: S2 = midpoint of L/R PSIS markers (100%)", "note": "single-sample static average; not a validated multi-subject reference", "levels": [{"name":"T1","ratio":2.94}, … 13 entries in spec order] }`
- `config/detection.json`: `{ "processLongSide": 640, "hsvRanges": [[[0,100,70],[10,255,255]], [[170,100,70],[180,255,255]]], "morphKernel": 5, "minAreaFrac": 0.00005, "maxAreaFrac": 0.02, "minCircularity": 0.70, "minVerticalGapFrac": 0.10 }`
- `package.json`: `{"type":"module","private":true,"scripts":{"test":"node --test tests/"}}` (no dependencies)

- [ ] **Step 1:** `git init`, set repo-local `user.name ghun00`. `.gitignore`: `.venv/`, `__pycache__/`, `.DS_Store`, `.vercel`. `.vercelignore`: `reference/`, `tests/`, `docs/`, `*.md`, `package.json`.
- [ ] **Step 2:** `curl -fsSL https://docs.opencv.org/4.13.0/opencv.js -o vendor/opencv-4.13.0.js`; verify size ≈ 10.9 MB and file begins with JS (not HTML).
- [ ] **Step 3:** `vercel.json`: `{"headers":[{"source":"/vendor/(.*)","headers":[{"key":"Cache-Control","value":"public, max-age=31536000, immutable"}]}]}`.
- [ ] **Step 4:** `python3 -m venv .venv && .venv/bin/pip install -r reference/requirements.txt` (`opencv-python-headless`, `numpy`, `pytest`). Verify `.venv/bin/python -c "import cv2; print(cv2.__version__)"`.
- [ ] **Step 5:** Commit `chore: scaffold repo, configs, pinned OpenCV.js 4.13.0`.

### Task 2: Python geometry (classification + ratio points)

**Files:** Create `reference/geometry.py`, `reference/config.py`; Test `reference/tests/test_geometry.py`

**Interfaces — Produces:**
- `config.load_ratios() -> list[tuple[str, float]]`, `config.load_detection() -> dict` (read `../config/*.json` relative to repo root).
- `geometry.classify(centers: list[tuple[float,float]], frame_h: int, min_gap_frac: float) -> tuple[dict|None, str]` → `({"C7":(x,y),"L":(x,y),"R":(x,y)}, "ok")` or `(None, reason)` with reason ∈ `"too_few"`, `"too_many"`, `"bad_layout"`.
- `geometry.level_point(markers: dict, ratio_percent: float) -> tuple[float,float]`.

- [ ] **Step 1: Failing tests**
  - `test_spec_example`: C=(100,100), L=(60,500), R=(140,500), T7 → `(100, 256.16)` (`pytest.approx`, abs 1e-6).
  - `test_endpoints`: ratio 0 → C; ratio 100 → M.
  - `test_classify_order`: centers `[(140,500),(100,100),(60,500)]` → C7 (100,100), L (60,500), R (140,500).
  - `test_too_few` (2 pts) / `test_too_many` (4 pts) → reason.
  - `test_bad_layout`: `[(100,480),(60,500),(140,500)]`, frame_h 1000, gap 0.10 → `bad_layout`.
  - `test_ratios_config`: 13 levels, names in spec order, T7 = 39.04, S1 = 95.87.
- [ ] **Step 2:** `.venv/bin/pytest reference/tests/test_geometry.py -v` → FAIL (import error).
- [ ] **Step 3:** Implement. Classify: sort by y; top = C7; require `min(L.y, R.y) - C7.y >= min_gap_frac * frame_h`; lower two sorted by x.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(reference): marker classification and ratio interpolation`.

### Task 3: Python detector + synthetic fixtures

**Files:** Create `reference/detector.py`, `reference/synth.py`, `reference/fixtures/*`; Test `reference/tests/test_detector.py`

**Interfaces — Produces:**
- `detector.detect(bgr: np.ndarray, cfg: dict) -> dict` → `{"candidates": [{"x","y","area","circularity"}], "rejected": [{"x","y","area","circularity","why"}]}`; x,y in input-image pixels (scaled back from processing size), sorted by y.
- `synth.make_scene(spec: dict) -> tuple[np.ndarray(bgr), dict(expected)]`; `python reference/synth.py` writes per scene `reference/fixtures/<name>.png`, `reference/fixtures/<name>.rgba` (raw RGBA bytes, row-major), and one `reference/fixtures/expected.json`: `{name: {"w","h","centers":[[x,y],…], "status": "ok"|"too_few"|"too_many"|"bad_layout", "py_centers": [[x,y],…] (Python detector output, for JS parity)}}`.

Pipeline (must match JS exactly): resize so long side = `processLongSide` (INTER_AREA; skip if smaller) → BGR→HSV → `inRange` each range, OR → morph OPEN then CLOSE with ellipse kernel `morphKernel` → `findContours(RETR_EXTERNAL, CHAIN_APPROX_SIMPLE)` → area = `contourArea`, perimeter = `arcLength(closed)`, circularity = 4πA/P² → keep if area within `[minAreaFrac, maxAreaFrac] × processed area` and circularity ≥ `minCircularity` → center from `moments` (m10/m00, m01/m00) → divide by scale.

Scenes (720×1280 portrait unless noted; skin-tone vertical gradient background with mild Gaussian noise; red stickers BGR ≈ (40,40,210) radius 14–22 px, antialiased): `normal`, `small_far` (r=9), `dim` (V scaled 0.6), `rotated` (layout rotated 8° about center), `landscape` (1280×720), `occluded` (one PSIS removed → too_few), `extra_red` (4th red circle → too_many), `red_rect` (red 60×20 rectangle + 3 stickers → ok, rect rejected), `bad_layout` (C7 at same height as PSIS → bad_layout), `orange_tape` (orange BGR (0,140,255) circle + 3 stickers → ok).

- [ ] **Step 1: Failing tests** — parametrized over `expected.json`: detected centers match expected within 1.5 px (when 3 expected), `classify` status equals expected; `red_rect` has ≥1 rejected with `why == "circularity"`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `detector.py`, `synth.py`; generate fixtures (commit them; keep total < 15 MB — `.rgba` files are fine).
- [ ] **Step 4:** `.venv/bin/pytest reference -v` → all PASS. Tune `config/detection.json` only if needed and note why in commit.
- [ ] **Step 5:** Commit `feat(reference): OpenCV red sticker detector with synthetic fixtures`.

### Task 4: JS geometry + labels (pure)

**Files:** Create `app/geometry.js`, `app/labels.js`, `app/levels.js`; Test `tests/geometry.test.js`, `tests/labels.test.js`

**Interfaces — Produces:**
- `classifyMarkers(centers: {x,y}[], frameH: number, minGapFrac: number) -> {ok:true, markers:{c7,lpsis,rpsis}} | {ok:false, reason:'too_few'|'too_many'|'bad_layout'}` (same rules as Task 2).
- `levelPoint(markers, ratioPercent) -> {x,y}`.
- `containTransform(srcW, srcH, dstW, dstH) -> {scale, ox, oy}`; `toScreen(t, p) -> {x,y}`; `toSource(t, p) -> {x,y}`.
- `layoutLabels(items: {name,x,y}[], box: {w,h}, opts: {lineH, gap, labelW}) -> {name, x, y, lx, ly, side:'right'|'left', displaced:boolean}[]` — dots `x,y` unchanged; labels sorted by y, pushed down by ≥ `lineH`, clamped inside box (if bottom overflow, push the stack upward), side flips to left when `x + gap + labelW > box.w`; `displaced` true when `|ly - y| > 1`.
- `levels.js`: `loadRatios() -> Promise<{version, levels:{name,ratio}[]}>` (fetch `config/ratios.json`), `DEFAULT_SELECTED = ['T1','T7','L1','S1']`.

- [ ] **Step 1: Failing tests** — spec example T7 → (100, 256.16); classify order/too_few/too_many/bad_layout same cases as Task 2; `containTransform(720,1280, 390,600)` → scale = min(390/720, 600/1280), ox/oy center letterbox, `toSource(toScreen(p))` ≈ p, also for landscape src; `layoutLabels` with L2..S1 points at the spec ratios on a 600-px line → no two labels' vertical spans overlap, all within box, every output `x,y` equals input; point at `x = box.w - 5` → side `left`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat(web): pure geometry, classification and label layout`.

### Task 5: OpenCV.js detector + parity with Python

**Files:** Create `app/detector.js`, `tests/helpers/loadcv.js`; Test `tests/detector.parity.test.js`

**Interfaces:**
- Consumes: `config/detection.json`, fixtures from Task 3.
- Produces: `detectCandidates(cv, image: {data: Uint8ClampedArray, width, height}, cfg) -> {candidates:{x,y,area,circularity}[], rejected:{…, why}[], maskPreview?: ImageData-like}`; `opts.debug` true → also returns a downscaled mask (`{data,width,height}` RGBA). Same pipeline as Task 3 but from RGBA (`COLOR_RGBA2RGB` then `COLOR_RGB2HSV`). Every `cv.Mat`/`MatVector`/kernel deleted in `finally`.
- `loadcv.js`: `loadCv() -> Promise<cv>` in Node: `require` `vendor/opencv-4.13.0.js` via `createRequire`; if result is thenable, await it but strip `then` before resolving (the Module's own `then` causes an infinite await loop); else wait `onRuntimeInitialized`.

- [ ] **Step 1: Failing test** — for every fixture: candidate centers within 1.0 px of Python's (`py_centers` in `expected.json`), and `classifyMarkers` status equals expected. Plus `test_no_leak`: run `normal` 300 times; `cv` heap (`cv.HEAP8.length`) does not grow.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat(web): OpenCV.js detector matching Python reference`.

### Task 6: App shell — state machine, camera, rendering, UI

**Files:** Create `index.html`, `app/main.js`, `app/camera.js`, `app/render.js`, `app/style.css`; Test `tests/camera.test.js`

**Interfaces:**
- Consumes: Tasks 4–5.
- Produces:
  - `camera.js`: `startRearCamera() -> Promise<MediaStream>` (try `{facingMode:{exact:'environment'}, width:{ideal:1280}, height:{ideal:720}}`, on `OverconstrainedError` retry with `facingMode:'environment'`); `classifyCameraError(err, isSecureContext) -> 'insecure'|'denied'|'notfound'|'busy'|'unknown'` (NotAllowedError/SecurityError → denied, NotFoundError/OverconstrainedError → notfound, NotReadableError/AbortError → busy).
  - `render.js`: `drawFrame(ctx, source, t)`; `drawOverlay(ctx, t, markers, points, labels)`; `drawDebug(ctx, info)`.
  - `main.js` states: `idle → loading-cv / requesting → live-searching ⇄ live-tracking → frozen → live-*`, and `error`. OpenCV loads at page start via `<script async src="vendor/opencv-4.13.0.js">` and a ready promise with a failure path (`onerror` or 30 s timeout → "OpenCV 로딩 실패" + 다시 시도, which re-injects the script).

Behavior to implement (from design §6–8): single `<canvas>` fills the viewport above the controls; `<video playsinline muted>` hidden; each analysis tick draws the video frame into an offscreen canvas at source size, reads `ImageData`, runs `detectCandidates` + `classifyMarkers`, then draws the frame on the display canvas with `containTransform` and the overlay with the same `t`. Analysis loop via `video.requestVideoFrameCallback` (fallback rAF), skip while busy. Status banner texts: searching (too_few) "마커 3개가 모두 보이도록 촬영하세요", too_many "빨간 후보가 너무 많습니다 — 배경의 빨간 물체를 치워주세요", bad_layout "C7이 위, PSIS 2개가 아래에 오도록 똑바로 촬영하세요", tracking "인식 중", frozen "화면 정지됨" (visually distinct). Level chips (13, toggle) + 전체 선택 / 전체 해제; freeze button enabled only in `live-tracking`; freeze stores the offscreen frame canvas copy + markers; level changes while frozen redraw from stored data; resume discards them. `?test=1` shows a file input; selected image runs through the same pipeline as a single frozen-like frame (no camera). `?debug=1` shows mask preview, candidate count, per-candidate area/circularity, rejection reasons. Canvas sized with devicePixelRatio; on `resize`/`orientationchange` recompute.

- [ ] **Step 1: Failing test** `tests/camera.test.js`: each error name maps as above; `isSecureContext=false` → `insecure` regardless of error.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement all files.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Browser check** — `python3 -m http.server 8080` at repo root; in Chrome open `http://localhost:8080/?test=1&debug=1`, load each fixture PNG: `normal`/`rotated`/`landscape`/`red_rect`/`orange_tape` show 3 marker labels and T1/T7/L1/S1 dots on the C7→M line; `occluded`/`extra_red`/`bad_layout` show no dots and the matching banner; toggle all/none; confirm no console errors. Open `/` with webcam if available: permission prompt, live view, freeze/resume. Record what was and wasn't checked.
- [ ] **Step 6:** Commit `feat(web): camera app with live overlay, level selection, freeze`.

### Task 7: README, push to GitHub

**Files:** Create `README.md`

- [ ] **Step 1:** README (Korean): 개요·비주장 문구; 구조; 로컬 실행 (`python3 -m http.server`, `?test=1`, `?debug=1`); 테스트 (`npm test`, `.venv/bin/pytest reference`); Vercel 연동 (Import GitHub repo → Framework Preset "Other" → Build Command 비움 → Output Directory `.` → Deploy; HTTPS URL로 S25 Chrome 접속); 설정 변경 방법 (`config/*.json`, Ratio 출처·버전 기록); 기능 점검 결과 (자동 테스트 결과 수치, 브라우저 확인 내역, S25 미검증 표시); S25 점검표 = 명세 §9 체크리스트 원문; 스티커·촬영 조건과 알려진 한계 (합성 이미지 기준 HSV, 빨간 옷·배경, 조명·그림자, 기울임·회전, 2D 근사, 단일 샘플 Ratio, 스티커 크기 미정).
- [ ] **Step 2:** `npm test && .venv/bin/pytest reference` → all PASS.
- [ ] **Step 3:** Commit `docs: README with run, deploy, checklist, limitations`; `gh repo create ghun00/spinal-landmark-ar-poc --public --source=. --push`. Verify `gh repo view --web`-free: `gh repo view ghun00/spinal-landmark-ar-poc --json url`.
