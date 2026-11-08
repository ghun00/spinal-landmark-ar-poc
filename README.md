# Spinal Landmarking AR PoC

스마트폰 후면 카메라 영상에서 빨간 원형 스티커 3개(C7, 좌·우 PSIS)를 OpenCV.js로 인식하고, Reference Ratio에 따른 척추 레벨의 **비율 기반 추정 위치**를 실시간으로 표시하는 정적 웹앱입니다.

> 이 PoC는 기능 동작 확인용입니다. 화면의 점은 비율 기반 추정 위치이며, 해부학적 위치 정확도·센서 부착 정확도·임상적 유효성은 검증되지 않았습니다.

- 요구사항: [`Spinal_Landmarking_AR_PoC_Spec.md`](Spinal_Landmarking_AR_PoC_Spec.md)
- 설계: [`docs/superpowers/specs/2026-11-08-spinal-landmark-ar-poc-design.md`](docs/superpowers/specs/2026-11-08-spinal-landmark-ar-poc-design.md)

## 구조

| 경로 | 내용 |
| --- | --- |
| `index.html`, `app/` | 웹앱 (번들러 없음, ES 모듈) |
| `app/detector.js` | OpenCV.js 빨간 원형 마커 검출 |
| `app/geometry.js` | C7/L-PSIS/R-PSIS 구분, `P = C + r(M − C)`, 화면 좌표 변환 |
| `app/labels.js` | 레벨 이름 겹침 회피 (점은 이동하지 않음) |
| `config/ratios.json` | Ratio 값 + 출처·분모·버전 (단일 설정 파일) |
| `config/detection.json` | HSV 색상 범위·면적·원형도 등 검출 파라미터 |
| `vendor/opencv-4.13.0.js` | 버전 고정 OpenCV.js (WASM 내장 단일 파일) |
| `reference/` | Python + OpenCV 기준 구현, 합성 이미지 생성기, pytest (배포 제외) |
| `tests/` | Node 테스트: 계산 로직, Python ↔ OpenCV.js 동등성 (배포 제외) |

## 로컬 실행

```bash
python3 -m http.server 8080
# 브라우저: http://localhost:8080/
```

`localhost`는 HTTPS가 아니어도 카메라 권한을 요청할 수 있습니다. 스마트폰에서 확인하려면 HTTPS 배포 URL(아래 Vercel)을 사용하세요.

개발용 숨은 옵션 (일반 화면에는 노출되지 않음):

- `?test=1` — 카메라 대신 이미지 파일을 넣어 같은 검출·표시 경로를 확인
- `?debug=1` — 빨강 마스크 미리보기, 후보 수, 후보별 면적·원형도·평균 HSV, 제외 사유 표시. 실기기 문제 보고 시 이 화면을 캡처해 주세요. 스티커와 오검출(피부·배경)의 HSV·면적 차이를 보고 `config/detection.json`을 조정합니다.

## 테스트

```bash
# Node (계산 로직 + OpenCV.js 검출이 Python 결과와 일치하는지)
npm test

# Python 기준 구현
python3 -m venv .venv
.venv/bin/pip install -r reference/requirements.txt
.venv/bin/pytest reference

# 합성 이미지 재생성 (PNG는 git에 포함하지 않음; ?test=1 확인용)
.venv/bin/python reference/synth.py
```

## Vercel 배포

1. Vercel → **Add New… → Project** → 이 GitHub 저장소 Import
2. Deploy → 발급된 `https://…vercel.app` 주소를 Galaxy S25 Chrome에서 열기

빌드 설정은 `vercel.json`에 고정되어 있어 대시보드 설정보다 우선합니다: `framework: null`(Other), install·build 명령 없음, 저장소 루트를 그대로 정적 배포. Vercel이 `reference/requirements.txt`를 보고 프레임워크를 Python으로 자동 선택해도 Python 빌드가 실행되지 않습니다. `.vercelignore`로 `reference/`, `tests/`, `docs/`, 마크다운은 배포에서 제외되며, `vendor/` 파일에는 장기 캐시 헤더를 지정합니다. 배포 후 개발자 도구 Network에서 `vendor/opencv-4.13.0.js`가 200, `text/javascript`, 약 10.9MB로 응답하는지 확인하세요.

## 설정 변경

- **Ratio 교체**: `config/ratios.json`의 `levels`를 바꾸고 `version`, `source`, `denominator`를 함께 갱신합니다. 화면 하단에 버전이 표시됩니다.
- **스티커 색상·크기 조정**: `config/detection.json`
  - `hsvRanges`: OpenCV HSV(H 0–180) 범위. 빨강은 0 부근과 180 부근 두 범위를 합칩니다.
  - `minAreaFrac` / `maxAreaFrac`: 처리 프레임(긴 변 640px) 면적 대비 후보 면적 비율
  - `minCircularity`: 원형도 4πA/P² 하한
  - `minVerticalGapFrac`: C7이 두 PSIS보다 최소 얼마나(프레임 높이 비율) 위에 있어야 하는지
- 값을 바꾼 뒤 `.venv/bin/python reference/synth.py && .venv/bin/pytest reference && npm test`로 회귀를 확인하세요.

## 기능 점검 결과 (2026-11-08, 개발 환경)

| 항목 | 결과 |
| --- | --- |
| Python 기준 구현 (pytest) | 22 passed — 합성 장면 12종(따뜻한 피부톤, 가장자리 잘린 빨간 물체 포함)의 중심 오차 ≤ 1.5px, 상태 판정 일치 |
| Node 테스트 | 34 pass — 마커 개수 태그, 명세 예시 T7 → (100, 256.16), 구분 규칙, 좌표 변환 왕복, 라벨 비겹침, 카메라 오류 분류 |
| Python ↔ OpenCV.js 동등성 | 10개 장면에서 중심 좌표 차이 0px, 300회 반복 시 메모리 증가 없음 |
| 데스크톱 Chrome `?test=1` | 정상·작게·어둡게·8° 회전·가로·빨간 사각형·주황 원 → 인식 / 가림·빨간 원 4개·잘못된 배치 → 숨김 + 안내 |
| 데스크톱 Chrome 가짜 카메라 스트림 | 실시간 인식 → 마커 가림 시 숨김 → 자동 재개. 좌측 상단 태그: 2/3(주황) · 4/3 후보 과다(빨강) · 3/3 배치 확인(주황) · 3/3(초록). 권한 거부 안내 확인 |
| **Galaxy S25 Chrome 실기기** | **미검증** — 아래 점검표로 확인 필요 |
| 실제 웹캠·실제 스티커 | 미검증 |

합성 장면: 피부톤 그라데이션 배경, 빨간 원(BGR 40,40,210) 반지름 9–22px, 720×1280 세로 및 1280×720 가로.

FPS·지연·mm 정확도 목표는 합의되지 않았으므로 측정·보고하지 않습니다.

## Galaxy S25 Chrome 점검표 (명세 §9)

- [ ] Vercel HTTPS URL에 접속해 별도 PC 실행 없이 카메라를 시작할 수 있음.
- [ ] 배포 환경에서 OpenCV.js와 필요한 WebAssembly 자산이 정상 로딩되고 스마트폰 브라우저에서 마커 검출이 실행됨.
- [ ] 후면 카메라 영상이 표시되고 권한 거부 시 안내가 제공됨.
- [ ] 지정 색상의 원형 스티커 3개를 검출하고 C7·좌우 PSIS를 자동 구분함.
- [ ] 선택한 레벨만 올바른 Ratio 설정에 따라 표시함.
- [ ] 13개 중 여러 레벨을 동시에 선택·해제할 수 있음.
- [ ] 영상에서 마커 위치가 바뀌면 예상 위치가 함께 갱신됨.
- [ ] 마커 하나를 가리면 예상 위치가 사라지고 안내가 표시됨.
- [ ] 가린 마커가 다시 보이면 자동 표시를 재개함.
- [ ] 후보가 모호한 상황에서는 잘못된 세 점을 임의 선택해 결과를 표시하지 않음.
- [ ] 좌측 상단 태그에 현재 확보된 마커 개수(n/3)가 표시됨.
- [ ] 화면 배율과 영상 비율 때문에 점이 마커 기준선에서 어긋나는 UI 오류가 없음.
- [ ] 이미지·영상 저장 또는 좌표 내보내기 기능이 없음.

실기기 확인 시 사용한 스티커 크기, 촬영 거리, 조명, 실패한 조건을 함께 기록해 주세요.

## 명세 대비 변경 (사용자 결정, 2026-11-08)

- **화면 정지/재개 기능 제거**: 휴대폰을 거치해 사용하므로 불필요. 명세 §3·§9의 정지·재개 항목은 적용하지 않음.
- **마커 개수 태그 추가**: 카메라 화면 좌측 상단에 반투명(glass) 태그로 `마커 n/3` 표시. 3개가 올바른 배치로 인식되면 초록, 부족하거나 배치가 맞지 않으면 주황(`배치 확인`), 4개 이상이면 빨강(`후보 과다`).
- **하단 "비율 기반 추정 위치 · 해부학적 정확도 미검증" 문구 제거**. 같은 안내는 시작 화면에 남아 있음.

## 사용 조건 (가정)

- 대상자는 정적 기립 자세로 등을 카메라에 향함. 촬영자는 휴대폰을 세워 등 뒤에서 똑바로, 세 마커가 모두 화면에 들어오게 촬영.
- 후면 카메라, 좌우 반전 없음. 화면 왼쪽 PSIS = 대상자 좌측 PSIS.
- 화면은 영상 전체를 보여 주고(여백 허용), 영상과 오버레이는 같은 캔버스·같은 좌표 변환으로 그림.
- 평활화 없음: 마커가 하나라도 유효하지 않은 프레임에서는 즉시 숨김.

## 알려진 한계

- **색상 범위**: H 0–10 ∪ 160–180, **S ≥ 140**, V ≥ 80. 2026-11-08 S25 Chrome 실측(모니터에 띄운 등 사진 촬영)에서 스티커는 H 177–178 / S 161–162, 피부는 H 7–9 / S 102–118이었음. 기존 S ≥ 100에서는 피부가 빨강으로 잡혀 "후보 과다"가 발생해 상향함. 실제 스티커·조명에서 스티커 S가 140 근처로 떨어지면 `?debug=1`의 HSV 값을 보고 조정하세요.
- 화면 가장자리에 걸려 잘린 빨간 물체(귀·옷 등)는 스티커로 보지 않음(`edge`로 제외). 스티커 3개는 화면 안쪽에 완전히 보여야 합니다.
- 빨간 옷, 빨간 배경, 피부의 붉은 부분, 빨간 기구가 화면에 있으면 후보가 4개 이상이 되어 표시가 숨겨집니다(의도된 동작).
- 강한 그림자·반사로 스티커가 원형으로 보이지 않으면 원형도 필터에서 제외될 수 있습니다.
- 스티커 크기는 미정입니다. 너무 멀리서 찍어 스티커가 매우 작으면(처리 해상도 기준 면적 ≈ 12px² 미만) 인식되지 않습니다.
- 큰 기울임·회전(대상자가 숙이거나 휴대폰을 옆으로 뉘움)에서는 C7/PSIS 배치 조건이 깨져 표시가 숨겨집니다. 촬영 각도 보정은 범위 밖입니다.
- 2D 직선 보간입니다. 척추의 좌우 곡선·깊이·3D 위치를 반영하지 않습니다.
- Ratio는 단일 샘플(SpineVST Sample C3D)의 정적 구간 평균이며, PSIS 중간점을 S2(100%)로 둔 것은 PoC 가정입니다.
- 검증 대상은 Galaxy S25 / Chrome뿐이며, 다른 기기·브라우저는 미검증입니다.
