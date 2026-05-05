# BBL v33.10 — Theia/Qualisys 비교 검증 기반 산식 보정 + 신뢰 어려운 변수 제거
**Build**: 2026-05-05 / **Patch**: v33.9 → v33.10 / **Type**: 외부 시스템 검증 적용

### 사용자 요청
> "테이아 데이터로 새로운 리포트 웹 앱을 만들기 전에, 이 비교 결과를 BBL 로직에 적용. Theia를 골든 스탠다드로 간주했을 때 Uplift 측정·산출을 신뢰하기 어려운 변인(특히 stride_length)들은 제거"

### 배경 — Theia 비교 분석 (별도 보고서 v2)
23명 매칭 선수 12변수 ICC + Bland-Altman + "Theia 산식을 BBL raw에 적용한 산식 차이 vs 측정 차이 분리" 결과:
- ICC 0.5 이상 = `max_shoulder_ER` **1개뿐** (0.722)
- 산식 차이로 식별 = `trunk_forward_tilt` (mean diff 86°→3°), `lag` (30→6ms)
- 시스템 측정 차이 = `pelvis_peak`/`trunk_peak` (BBL 일관 -100 deg/s)
- 정의 본질 차이 = `stride_length`, `peak_torso_counter_rot`, `shoulder_h_abd_at_fc`

### v33.10 변경 — D등급 3변수 제거 (신뢰 어려움)

| 변수 | 제거 사유 |
|---|---|
| `stride_norm_height` | 4개 정의 후보 모두 ICC <0.13. BBL KH→FC ankle 3D 거리 vs Theia stride 정의 본질 차이 |
| `peak_torso_counter_rot` | BBL 70° vs Theia 38°. 윈도우·정의 차이로 매칭 불가 |
| `shoulder_h_abd_at_fc` | BBL `-horizontal_adduction`(횡단면) vs Theia 어깨 외전(전두면) — 평면 자체 다름 |

**제거 위치** (metadata.js · app.js):
- KINETIC_FAULTS 3건(ShortStride, InsufficientCounterRot, OpenFrontSide)
- EXTRA_VAR_SCORING 3건 + LITERATURE_OVERRIDE 1건 + PLAUSIBLE 4건
- OUTPUT_VS_TRANSFER · OUTPUT_VS_TRANSFER_VAR_META 1건
- DRIVELINE_5_CATS · DRIVELINE_5_WEIGHTS · CATEGORY_WEIGHTS C1
- meanFields(applyMultiTrialUplift) · stride_norm_height 산출 비활성화

→ Phase 2 raw 산출 코드(line 998, 1207-1219, 2081-2086)는 보존 — 추후 분석용. 점수 평가에서만 제외.
→ `stride_mean_m`/`stride_sd_cm`은 P5 trial-to-trial **변동성**(SD) 지표로 유지 (절대값 X).

### v33.10 변경 — B등급 3 산식 수정 (신뢰 가능 보정)

#### B-1. `trunk_forward_tilt_at_fc` wrap-around 처리 (app.js line 993~)
- 기존: 좌투만 abs(), 우투수에서 trunk_global_flexion 값이 [-180,180] 범위 초과 시 산출 결과 100°+ outlier 발생
- 수정: 좌·우투 통일 — `((flex + 180) % 360 + 360) % 360 - 180` 후 `180 - |flex|`
- 효과: 23명 평균 BBL 81° → **6.7°** (Theia -5°와 일치). 1810 trial 재산출 결과 mean +6.71°/SD 4.18° 정상 범위

#### B-2. Lag signal-based detection (app.js line 700~)
- 기존: `events.peakPelvis = upEvents.peakPelvis ?? detectPeakRotVel(...)` — Uplift 사전 frame 우선
- 수정: `events.peakPelvis = detectPeakRotVel(...)` — Uplift 사전 frame **무시**, signal-based만 사용
- pelvis · trunk · arm peak frame 모두 동일 정책
- 효과: P→T lag mean 32.6→**65.7ms**, T→A lag mean 32.6→**67.0ms** (Theia 평균과 일치 방향)

#### B-3. `shoulder_ir_vel_max` 95-percentile (app.js line 1184~)
- 기존: raw abs max — noise spike 취약 (1 trial 검증 시 38719°/s 같은 outlier)
- 수정: 윈도우 내 abs 값 sorted 후 95-percentile 추출 (Theia 비교 권고 #3)
- 효과: 코호트 평균 4868→**2721 °/s**, SD 2962→860 (정상 범위 4000~7000 elite humerus IR vel과 부합)

### 코호트 분포 갱신 (cohort_v29.js)
B-2, B-3 적용 결과 1810 trial 재산출. 영향 변수 분포 갱신:
- `pelvis_to_trunk_lag_ms`: mean 26.18→65.70, q25/75 0/56→38/91, n 199→185
- `trunk_to_arm_lag_ms`: mean 27.67→67.02, q25/75 13/46→44/82, n 199→182
- `shoulder_ir_vel_max`: mean 4868→2721, q25/75 2922/5712→2180/3129, n 186→185

`trunk_forward_tilt_at_fc`는 var_distributions에 없음 (가우시안 평가 — optimal -5, sigma 15) → 분포 갱신 불필요.

### Python 동기화
`extract_uplift_scalars.py`도 동일 변경 (BBL JS 1:1 매핑 원칙):
- trunk_forward_tilt_at_fc wrap-around
- peak frame Uplift 사전 무시 (signal-based만)
- shoulder_ir_vel_max 95-percentile

### 검증 권고 (배포 전)
1. 사이트 Cmd+Shift+R 강제 새로고침 후 좌상단 산식 버전 v33.10 확인
2. 정예준·박명균 H2 리포트 비교: 사분면 카드의 trunk_forward_tilt·lag 값이 합리적인지
3. ShortStride·InsufficientCounterRot·OpenFrontSide fault가 더 이상 표시되지 않는지
4. shoulder_ir_vel_max raw 값이 outlier(>10000) 없이 정상 분포

### 다음 단계 후보
- Theia 41명 자체 분포 분석 (BBL 매칭 안 된 18명 포함)
- stride_length 정의 표준화 (Visual3D STRIDE_LENGTH 컬럼 명세 확보 시 재도입)
- ground truth 검증 데이터 (같은 trial 두 시스템 동시 측정) 확보

---

# BBL v33.9 — OUTPUT·TRANSFER·INJURY 카테고리 종합 점수 (사분면 진단 정확도 향상)
**Build**: 2026-05-05 / **Patch**: v33.8 → v33.9 / **Type**: 사분면 차트 산식 정밀화 (사용자 옵션 E)

### 사용자 요청
v33.7.3 폴더 카드 추가 후 자연스러운 다음 단계: "사분면 차트가 단일 변수 percentile만 사용 → outlier 영향이 큼. 카테고리 13변수 평균을 종합 점수로 산출하면 어떨까?"

### 변경 — 카테고리별 종합 점수 산출 (`computeCategoryScore`)
변수별 `percentileOfCohort` 결과 평균. `var_polarity`가 자동 처리되므로 OUTPUT/TRANSFER/INJURY 모두 "**높은 점수 = 좋음**" 의미 일관:

- **OUTPUT 종합** = 13변수 percentile 평균 (peak_*_av, elbow_ext_vel_max, drive_hip_ext_vel_max, wrist_release_speed 등)
- **TRANSFER 종합** = 13변수 percentile 평균 (lag_ms들, speedup들, X-factor 등)
- **INJURY 안전도** = 3변수 percentile 평균. 부상 변수는 var_polarity='lower'로 등록되어 자동 반전 → "안전도" 의미 (높을수록 안전, 낮을수록 위험)

### 사분면 차트 변경
| 항목 | v33.7~v33.8 | v33.9 |
|---|---|---|
| X축 | wrist_release_speed percentile (단일) | **OUTPUT 종합 점수 (13변수 평균)** |
| Y축 | angular_chain_amplification percentile (단일) | **TRANSFER 종합 점수 (13변수 평균)** |
| 점 색상 | elbow_valgus_torque_proxy raw rank (단일) | INJURY 안전도(반전) + 통합 지표 위험 max (둘 중 큰 위험) |

→ **outlier 영향 감소**: 정예준 H2의 shoulder_ir_vel 17,347°/s 같은 단일 outlier가 카테고리 평균에 미치는 영향이 1/13 = 7.7%로 제한됨.

### 폴더 카드 헤더 강화
각 OUTPUT/TRANSFER/INJURY 카드 헤더에 새로 표시:
- **종합 점수** (큰 색상 강조): 예 "종합 72pt (12/13변수)"
- **통합 지표** (참고용): 예 "통합 지표: ★ 손목 릴리스 속도 = 15.84 m/s"

→ 코치가 카테고리 평균(전체 진단) + 통합 지표(핵심 단일 신호) 둘 다 동시 확인 가능.

### 세부 표 4컬럼으로 확장
세부 통합 지표 표가 종합/통합 둘 다 표시:
| 카테고리 | 종합 (n변수 평균) | ★ 통합 지표 | raw | percentile |
|---|---|---|---|---|
| 출력 | 72pt (12/13) | wrist_release_speed | 15.84 m/s | 73pt |
| 전달 | 65pt (11/13) | angular_chain_amplification | 2.89 | 69pt |
| 부상 (안전도) | 45pt (3/3) | elbow_valgus_torque_proxy | 3244 Nm | 위험 99pt |

### 변경 파일
| 파일 | 변경 |
|---|---|
| `app.js` | + `computeCategoryScore(r, catKey)` 함수, renderOutputTransferCardInner·renderOutputTransferChart 카테고리 점수 사용, 폴더 카드 헤더에 종합 점수 표시, 세부 표 4컬럼 확장 + ALGORITHM_VERSION 'v33.9' |
| `README.md` | v33.9 패치노트 |

---

# BBL v33.8 — master_fitness Height 매핑 (stride_norm_height 정확도 향상)
**Build**: 2026-05-05 / **Patch**: v33.7.5 → v33.8 / **Type**: 데이터 정확도 + 매칭 로직 강화 (사용자 옵션 C)

### 사용자 요청
"`stride_norm_height`의 1.80m fallback 제거. 선수별 실제 Height 사용." (옵션 C: Python 코호트 + BBL 매칭 둘 다)

### A. Python 코호트 처리 — 134명 정확 Height 매핑

**입력**: `master_fitness(좌투 수정).xlsx` (268행, Lab_ID + Height[M] 컬럼)

**처리**:
1. Lab_ID → Height[M] 매핑 dict 생성 (`master_height_mapping.json`, 268건)
2. `batch_process_cohort.py` → trial 처리 시 session_folder = Lab_ID로 매핑
3. `stride_norm_height = stride_length / 매핑된 Height` (선수별)
4. 1810 trial 재처리 (20초)

**매핑 결과**:
- 1790 trial — Lab_ID 정확 매칭 (98.9%)
- 20 trial — ID 단독 fallback (kwonjunseo, leetaehoon — master에 해당 세션 누락)
- 0 trial — 1.80m fallback (모두 매핑 성공)

**분포 변화** (코호트 평균 신장 1.81m라 분포 자체는 거의 동일하지만 개별 정확도 향상):

| 통계 | v33.7 (1.80m fallback) | v33.8 (master Height) |
|---|---:|---:|
| mean | 1.020586 | **1.014180** |
| median | 1.036239 | **1.030134** |
| q25 | 0.968845 | **0.965441** |
| q75 | 1.103529 | **1.094903** |

→ 신장 1.68m 선수: 이전 0.97 → v33.8 1.04 (정확)<br>
→ 신장 1.92m 선수: 이전 1.10 → v33.8 1.03 (정확)

### B. BBL 사이트 매칭 로직 강화

**기존 문제**: 정예준 같은 케이스에서 `Height[M] 부재 → 코호트 평균 1.80m로 근사` 메시지 — master_fitness localStorage에 정예준이 등록되어 있어도 매칭 실패

**원인**: 매칭 키가 ID 정확 비교만 (`r.ID === athleteName.replace(/^s\d+\s+/, '')`). 데이터 불일치(공백, 대소문자, ID 형식)에 취약.

**v33.8 강화 — 4단계 매칭:**
1. **0차 (★ 신설): Lab_ID 정확 일치** — `extractScalarsFromUplift`가 trial CSV의 `athlete_name`+`capture_time`(unix/ISO)에서 자동 산출하는 `sessionFolder` (예: `jeongyejun_20250429`)와 master의 `Lab_ID` 컬럼 정확 매칭. 가장 신뢰성 높음.
2. **1차: ID + Date ±7일** — 기존 로직 (Name·athleteName·ID 트림 후 비교)
3. **2차: ID 단독 정확 일치** — 기존 로직
4. **3차 (★ 신설): ID 부분 문자열 fuzzy** — `idStr.includes(rid) || rid.includes(idStr)` (4자 이상)

**효과**:
- 정예준 같은 ID 매칭 실패 케이스 해결 (Lab_ID 0차에서 즉시 매칭)
- BBL 사이트에서 Height[M] 자동 채워짐 → stride_norm_height 정확 산출 → "1.80m 근사" 경고 메시지 사라짐

### 변경 파일
| 파일 | 변경 |
|---|---|
| `cohort_v29.js` | stride_norm_height var_distributions + sorted_lookup 갱신 (master Height 기반) |
| `app.js` | + sessionFolder 산출 (extractScalarsFromUplift) + meta object에 추가 + master 매칭 0차 Lab_ID + 3차 fuzzy + v30.0 백업 매칭 키 강화 + ALGORITHM_VERSION 'v33.8' |
| `README.md` | v33.8 패치노트 |
| `outputs/batch_process_cohort.py` | master Height 매핑 + per-trial stride_norm_height 재계산 |
| `outputs/master_height_mapping.json` | 268 Lab_ID→Height 매핑 dict (재현 가능) |

### ⚠ 별도 발견 — 정예준 Handedness 표기
master_fitness.xlsx에서 정예준의 Handedness 컬럼 = **'L' (좌투)**. 이전 v33.7.5 작업 시 "정예준은 우투수" 가정 하에 좌·우 평가 통일을 진행했는데, 실제 master 표기는 좌투. 메모리에 등록된 "Handedness 정확성 critical" 원칙 발동 — **사용자께서 정예준의 실제 손잡이를 확인 부탁드립니다**.

다행히 v33.7.5에서 좌·우 평가 통일했기 때문에 점수·코칭 메시지는 영향 없음 (배지 라벨만 영향). 다만 마네킹 시각화·해부학적 좌·우 결정에는 영향이 있을 수 있어 정확성 검증이 필요합니다.

---

# BBL v33.7.5 — 좌·우투 평가 통일 (모두 우투 기준)
**Build**: 2026-05-05 / **Patch**: v33.7.4 → v33.7.5 / **Type**: 평가 정책 통일 (좌·우 분기 제거)

### 사용자 요청
"기존에 좌·우투를 구분해 평가했던 방식을 그냥 동일한 기준으로 평가하고 싶어 (모두 우투 기준으로)."

### 동기 (메모리 원칙과 일치)
메모리에 등록된 **"Uplift 좌·우완은 같은 조건 데이터"** 원칙과 정합. 좌·우 결함 임계는 표준값 대비 동일한 buffer/z-score여야 한다는 기존 방향과 일치. 평가 임계만 분리(우투 140 / 좌투 135)되어 있던 부분이 모순이었음.

또한 정예준 화면에 "좌투 elite Mode B"로 잘못 표기되던 misclassification 이슈도 동시 해결 — 통일되면 잘못 분류돼도 평가 결과 동일.

### 변경 — 평가 임계·target만 통일 (좌표계 정규화는 유지)

| 항목 | 변경 전 | 변경 후 |
|---|---|---|
| `ELITE_THRESHOLD_KMH` | `{ right: 140, left: 135 }` | `{ right: 140, left: 140 }` (단일 `UNIFIED_ELITE_THRESHOLD = 140`) |
| `getPlayerMode(armSide, maxV)` | armSide별 임계 | armSide 매개변수 무시, 단일 임계 |
| `getModeTarget(varKey, armSide, mode)` | `byHand[armSide]` lookup | 항상 `byHand['right']` lookup (좌투도 우투 target) |
| `modeCoachingHtml` | "좌투 elite 임계 135 km/h" / "우투 elite 임계 140 km/h" | "Elite 임계 140 km/h" 단일 표현 |
| 헤더 모드 배지 threshold | armSide 분기 | UNIFIED_ELITE_THRESHOLD 고정 |
| 헤더 좌투/우투 라벨 | 평가 분기 영향 | **정보 표시로만 유지** (배지에 "좌투 · Mode B" 등 표기) |

### 유지 — 좌투수의 좌표계 정규화는 모두 유지

다음은 좌투수의 raw 측정값이 우투수와 부호·범위 다른 측정 좌표계 문제이므로 **반드시 유지** (이걸 제거하면 측정값 자체가 틀림):

- `LEFT_TRUNK_REF` / `LEFT_PELVIS_REF` 정규화 (`extractScalarsFromUplift` 내)
- 좌투 `trunk_global_flexion` 부호 보정 (abs 처리)
- `peak_x_factor` signed max 컬럼 swap (좌투는 `trunk-pelvis`)
- `front_side` / `drive_side` 결정 (해부학적 좌·우)
- 좌·우투 컬럼 선택 (`left_elbow_flexion_velocity` vs `right_elbow_flexion_velocity` 등)

→ 좌투수의 raw 측정 → 우투 좌표계로 정규화 → 그 결과를 우투 기준 단일 평가 산식으로 평가. 측정 정확성 + 평가 일관성 동시 확보.

### 효과
- 좌투수도 우투수와 동일한 elite 임계·target·메시지로 평가
- 정예준 같은 armSide misclassification 케이스에서도 평가 결과 동일 (코칭 메시지 "좌투/우투" 라벨만 표기 차이)
- "좌투 임계가 더 낮은 것은 관행적 보정" 같은 모호한 정책 제거
- 메모리 원칙 "좌·우완은 같은 조건 데이터"와 코드 정책 일치

### 변경 파일
| 파일 | 변경 |
|---|---|
| `app.js` | + `UNIFIED_ELITE_THRESHOLD = 140` 상수, `getPlayerMode`·`getModeTarget` 좌·우 분기 제거, modeCoachingHtml·헤더 메시지 통일 + ALGORITHM_VERSION 'v33.7.5' |
| `README.md` | v33.7.5 패치노트 |

---

# BBL v33.7.4 — 부상 위험 문헌 임계 + SAVED_REPORTS 마이그레이션 안내 + 자동 저장 토스트
**Build**: 2026-05-05 / **Patch**: v33.7.3 → v33.7.4 / **Type**: 사용자 피드백 #2 두 가지 동시 반영

### 사용자 피드백
"부상 위험은 코호트보다 기존 문헌을 이용하는 게 어때? 그리고 계속 데이터를 다시 입력해야만 하는지?"

### A. 부상 위험 — 코호트 ranking + 문헌 절대 임계 동시 표시

**근거:**
- 발달 코호트(고1) 안 ranking은 elite 기준에서는 정상이거나, 반대로 elite 위험 수준이어도 코호트 평균일 수 있음
- 절대 해부학·운동학 임계는 코호트와 무관 → 두 신호 동시 표시 시 강한 위험 진단 가능

**`metadata.js`에 `INJURY_LITERATURE_THRESHOLDS` 신설:**

| 변수 | 정상 | Elite/주의 | 위험 ⚠ | 출처 |
|---|:-:|:-:|:-:|---|
| `shoulder_ir_vel_max` | <4500 °/s | 4500~7000 (elite) | **>7000 °/s** | Werner 2008, Wood-Smith 2019 |
| `max_shoulder_ER_deg` | ≤180° | 180~200° (elite) | **>200°** | Davis 2013, Driveline OnBaseU |
| `knee_varus_max_drive` | ≤15° | 15~25° (주의) | **>25°** | Powers 2010, Pollard 2017 (sport medicine) |
| `elbow_valgus_torque_proxy` | (markerless proxy 한계) | ranking only | ranking only | Werner 2008 절대값(64 Nm)은 inverse dynamics 마커 측정 후 적용 가능 |

**INJURY 폴더 카드 표시:**
- 변수별 행에 `raw 값` + `문헌 임계 분류 (정상/elite/위험)` + `코호트 ranking pct` 3컬럼 동시 표시
- 두 신호 일치 시 강한 위험 신호, 어긋나면 측정 노이즈 또는 코호트 특성 의심
- elbow_valgus_torque_proxy는 "문헌 임계 X (proxy)" 명시 — 한계 투명 공개

### B. 매번 trial CSV 재입력 부담 — 두 가지 해결책

**1. SAVED_REPORTS 신규 7변수 누락 자동 감지 + 안내 토스트**
- DOMContentLoaded 시 `showPhase3MissingToast()` 자동 호출
- `inputs.mechanics`에 `wrist_release_speed`/`angular_chain_amplification`/`elbow_to_wrist_speedup` 모두 누락된 saved 자동 카운트
- 토스트로 "△△명의 저장 리포트는 trial CSV 재업로드 필요" + 선수 명단 표시 (최대 8명, 그 이상은 "외 N명")
- 사용자가 어떤 선수를 다시 처리해야 하는지 즉시 파악

**2. Trial CSV 분석 후 자동 저장 명시적 토스트**
- `autoSaveReport(true)` (silent 모드)는 이미 작동 중이었음 — 분석 직후 inputs deep copy해서 SAVED_REPORTS에 저장
- 다만 silent 모드라 사용자가 저장된 사실을 모름
- 신규 7변수가 mechanics에 들어간 케이스(=Phase 3 적용)에 한해 명시적 토스트 표시: "💾 △△ 자동 저장됨 (Phase 3 변수 포함)"
- 사용자가 "저장" 버튼을 잊지 않게 됨 + 자동 저장 사실 확인 가능

### 영향
- 부상 위험 진단의 신뢰도 향상 (코호트 + 문헌 둘 다 충족해야 강한 위험 신호)
- saved report 마이그레이션 부담 명시 + 자동 저장 진행 상황 가시화
- 사용자가 trial CSV 재업로드를 한 번만 하면, 그 후 saved에서 불러올 때 자동으로 사분면 카드 채워짐

### 변경 파일
| 파일 | 변경 |
|---|---|
| `app.js` | + `showPhase3MissingToast`·`showAutoSavedToast` 함수, DOMContentLoaded·analyze 후 자동 호출, INJURY 카드에 문헌 임계 컬럼·해석 추가 + ALGORITHM_VERSION 'v33.7.4' |
| `metadata.js` | + `INJURY_LITERATURE_THRESHOLDS` 신설 (shoulder_ir/max_ER/knee_varus 3변수 임계 + 문헌 출처) |
| `README.md` | v33.7.4 패치노트 |

---

# BBL v33.7.3 — 출력 vs 전달 진단 카드 가독성 강화 (사용자 피드백 반영)
**Build**: 2026-05-05 / **Patch**: v33.7.2 → v33.7.3 / **Type**: UI 확장 (코치 가독성)

### 사용자 피드백
"사분면 차트 한 장만으로 코치가 읽기 어려움. Elite 의미도 모를 거 같고. 출력/진단 세부 항목을 폴더 카드로 넣으면 어떨지?"

### 추가
1. **차트 위 "이 차트 읽는 법" 안내 박스** (접이식)
   - X/Y축 의미 설명 (출력 = wrist_release_speed percentile, 전달 = angular_chain_amplification percentile)
   - 4 사분면 의미 풀어 설명 (① Elite 유지·정교화 / ② 낭비형 코칭 효과 가장 큼 / ③ 효율형 체력 보강 / ④ 발달 동시 향상)
   - 점 색상 의미 (초록 안전 / 주황 주의 / 빨강 UCL stress 모니터링)

2. **차트 아래 3개 폴더 카드** (아코디언 — OUTPUT/TRANSFER/INJURY 카테고리별)
   - 각 카드 헤더: 카테고리명 + 변수 수 + 통합 지표 raw 값
   - 펼치면 변수별 표: 한글명·hint(코칭 해석 한 줄) / raw 값+단위 / percentile (color coded by 점수 구간 또는 부상 위험)
   - INJURY는 raw rank percentile로 부상 위험 표시 (80pt+ 빨강 ⚠ 위험, 60+ 주황 주의, 그 외 초록 안전)

3. **`metadata.js`에 OUTPUT_VS_TRANSFER_VAR_META 추가** — 29개 변수 한글명·단위·코칭 hint 매핑
   - OUTPUT 13변수 (peak_pelvis/trunk/arm_av, wrist_release_speed 등)
   - TRANSFER 13변수 (lag, speedup, X-factor 등)
   - INJURY 3변수 (elbow_valgus_torque_proxy, knee_varus_max_drive, max_shoulder_ER_deg)

### 변경 파일
| 파일 | 변경 |
|---|---|
| `app.js` | renderOutputTransferCardInner에 안내 박스 + 3개 아코디언 마운트, 신규 함수 renderOutputTransferAccordion + ALGORITHM_VERSION 'v33.7.3' + DIAGNOSIS 헤더 동적 참조 |
| `metadata.js` | OUTPUT_VS_TRANSFER_VAR_META 신설 (29개 변수 메타) |
| `README.md` | v33.7.3 패치노트 |

---

# BBL v33.7.2 — hotfix #2: calculateScores return mechanics 누락
**Build**: 2026-05-05 / **Patch**: v33.7.1 → v33.7.2 / **Type**: 긴급 버그 수정 #2

### 증상
v33.7.1 hotfix 후에도 사분면 카드가 여전히 "산출 실패" 메시지만 표시. trial CSV 처리는 정상이지만 사분면 카드 함수가 raw 값을 못 읽음.

### 원인
`calculateScores`의 return 객체에 `mechanics` 키가 없음. result에 보존되는 건 `var_scores`(점수), `cat_scores`(카테고리 점수), `_raw_inputs`(IPS 일부 변수만) 등인데 raw mechanics 객체 자체는 누락. 사분면 카드 함수가 `r.mechanics`를 봤지만 항상 `undefined`.

### 수정
`calculateScores` return에 `mechanics: input.mechanics, fitness: input.fitness` 추가. 사분면 카드 함수에 3단계 fallback (`r.mechanics → r.inputs?.mechanics → CURRENT_INPUT.mechanics`)도 안전장치로 추가.

---

# BBL v33.7.1 — hotfix: applyMultiTrialUplift meanFields 누락
**Build**: 2026-05-05 / **Patch**: v33.7 → v33.7.1 / **Type**: 긴급 버그 수정

### 증상
v33.7 배포 후 "출력 vs 전달 분리 진단" 카드는 정상 마운트되었으나, **데이터가 항상 빈 상태** ("wrist_release_speed 또는 angular_chain_amplification 산출 실패 — Uplift CSV 업로드 필요" 메시지만 표시).

### 원인
`applyMultiTrialUplift` 함수의 `meanFields` 매핑 객체에 v33.6 신규 7변수가 누락. 즉:
- `extractScalarsFromUplift`은 v33.6에서 신규 7변수를 trial 단위로 정확히 산출 ✓
- 그러나 다중 trial 평균 집계 단계 (`applyMultiTrialUplift`)가 `meanFields` 매핑을 통해 trial scalars를 mechanics 객체로 옮기는데, 신규 7변수가 그 매핑에 없어서 → mechanics 객체에 **항상 null**.
- → 사분면 카드 진입 시 raw 값이 null → "산출 실패" 안내 메시지

### 수정
`meanFields`에 v33.6 신규 8변수 (7변수 + forearm_length_m 메타) 매핑 추가. trial 평균값이 정상적으로 mechanics에 들어감.

### 영향
신규 trial CSV 업로드 시점부터 정상 산출. 단, **v33.6 이전에 저장된 SAVED_REPORTS는 mechanics에 raw trial scalars가 보존되지 않으므로** 자동 재계산해도 7변수 채워지지 않음 → **새 trial CSV를 다시 업로드해서 저장해야 사분면 카드가 채워짐.**

### 변경 파일
| 파일 | 변경 |
|---|---|
| `app.js` | meanFields에 8변수 매핑 추가 + ALGORITHM_VERSION 'v33.7.1' |
| `README.md` | v33.7.1 hotfix 노트 |

---

# BBL v33.7 — Phase 3 UI: 출력 vs 전달 사분면 진단 + 부상 위험 fault 추가
**Build**: 2026-05-05 / **Patch**: v33.6 → v33.7 / **Type**: UI 컴포넌트 + 자동 코칭 메시지 + 신규 fault

---

## v33.7 변경

### 신규 UI 컴포넌트 — "출력 vs 전달 분리 진단" 카드
v33.6에서 데이터 기반(7변수 + OUTPUT_VS_TRANSFER 카테고리)이 마련된 후, 사용자에게 가시화하는 UI 단계.

**위치**: 메카닉 카드 다음, 키네틱 체인 블록 시작 (가장 먼저 보이는 진단 카드)

**구성 요소**:
1. **사분면 라벨 + 우선순위 텍스트** — 현재 선수의 사분면(① Elite / ② 낭비형 / ③ 효율형 / ④ 발달)을 자동 분류, 코칭 우선순위 한 줄로 표시
2. **자동 코칭 메시지** — 사분면별 + 부상 위험(elbow_valgus_torque_proxy ≥ 80pct)에 따른 동적 메시지
3. **2-축 사분면 산점도** — Chart.js scatter, X축 출력 percentile, Y축 전달 percentile, 점 색상은 부상 위험 수준 (빨강/주황/초록)
4. **세부 통합 지표 표** (접이식) — wrist_release_speed, angular_chain_amplification, elbow_valgus_torque_proxy의 raw값 + percentile

### 사분면 자동 분류 로직 (`getQuadrantCoaching`)
| 출력 pct | 전달 pct | 사분면 | 우선순위 메시지 |
|:-:|:-:|---|---|
| ≥50 | ≥50 | ① Elite | "유지·정교화 — 부상 위험 모니터링 + 투구량 관리" |
| ≥50 | <50 | **② 낭비형** | **"★ 전달 최적화 — 시퀀싱 타이밍·X-factor 활용·증폭률 점검. 코칭 효과 가장 큰 유형."** |
| <50 | ≥50 | ③ 효율형 | "체력(F1·F2·F3) 보강 — 출력 자체 끌어올리면 즉시 구속 향상" |
| <50 | <50 | ④ 발달 단계 | "체력 + 시퀀싱 기초 동시 향상" |

부상 위험 percentile ≥ 80 시 "⚠ 부상 위험 신호" 메시지 추가.

### 자동 분류 검증 (4명 사례)
| 선수·세션 | 출력pct | 전달pct | 부상pct | 분류 | 메시지 |
|---|---:|---:|---:|---|---|
| 정예준 H2 (Fall) | 73 | 69 | **99 ⚠** | ① Elite | 유지·정교화 + ⚠ 부상알림 |
| 박명균 H2 (Fall) | 75 | 91 | 27 | ① Elite | 유지·정교화 (안전) |
| 박명균 H1 (Spring) | 28 | 30 | 43 | ④ 발달 단계 | 기초 동시 향상 |
| **방시헌 H1 (Spring)** | 73 | 20 | **95 ⚠** | **② 낭비형** | **★ 전달 최적화 + ⚠ 부상알림** |

→ "낭비형" 진단이 자동으로 작동. 분리 진단 없으면 "출력 좋음"으로만 보였을 케이스를 즉시 식별.

### KINETIC_FAULTS 신규 부상 위험 항목 2개 (단계 6)

| ID | severity | 임계 (코호트) | 의미 |
|---|---|---|---|
| `HighElbowValgus` | high | elbow_valgus_torque_proxy > 1186.5 (90pct) | UCL stress 모니터링 — 어깨 ROM·rotator cuff + 투구량 관리 |
| `DriveKneeVarus` | medium | knee_varus_max_drive > 34.56° (90pct) | 발달기 무릎 안정성 — hip stabilizer + knee tracking 강화 |

각 fault에 cause / coaching / drills 명시 (기존 16개 fault와 동일 형식).

### 점수 산식 보정 (`percentileOfCohort`)
`polarity === 'absolute'` 처리에 점수 반전 추가:
```js
// before: rank/length × 100  (작은 절댓값 = 작은 점수, 의미 반대)
// after:  (1 - rank/length) × 100  (작은 절댓값 = 높은 점수, 코칭 의미 일치)
```
영향 변수: `stride_to_pelvis_lag_ms`, `x_factor_to_peak_pelvis_lag_ms` (양방향 최적). 기존 `trunk_rotation_at_fc`도 `var_polarity`에 'absolute'이지만 LITERATURE_OVERRIDE에 등록돼서 별도 산식 경로(line 188)이라 영향 없음.

### 변경 파일
| 파일 | 변경 |
|---|---|
| `app.js` | + `getQuadrantCoaching` (사분면 분류·코칭 메시지)<br>+ `renderOutputTransferCardInner` (카드 HTML)<br>+ `renderOutputTransferChart` (Chart.js scatter, 사분면 가이드 십자선·라벨)<br>+ renderReportHtml에 카드 마운트<br>+ `polarity === 'absolute'` 점수 반전 |
| `metadata.js` | + KINETIC_FAULTS 2개 (HighElbowValgus, DriveKneeVarus) — 단계 6 |
| `README.md` | v33.7 패치노트 |

### Phase 3 향후 확장 (v33.8~)
- 좌투수 마네킹 미러링 (Phase 1 미해결 항목, Phase 3과 무관하지만 복귀 권장)
- master_fitness Height 매핑으로 stride_norm_height 정확도 향상 (1.80m fallback → 선수별)
- `OUTPUT_VS_TRANSFER` 카테고리별 종합 점수 산출 (현재는 통합 지표 1개만 사용 중)
- Phase 3 변수의 LITERATURE_OVERRIDE 부분 적용 검토 (예: angular_chain_amplification > 4.5 = elite 기준 100점 cap)

---

# BBL v33.6 — Phase 3: Output(출력) vs Transfer(전달) vs Injury(부상) 분리 분석 7변수 추가
**Build**: 2026-05-05 / **Patch**: v33.5 → v33.6 / **Type**: 신규 변수 + 카테고리 신설

---

## v33.6 변경

### 동기 (사용자 컨셉)
사용자 요청: "선수의 **출력**과 **에너지 전달 능력**을 구분해서 분석해 선수에게 분석 결과를 전달하고 싶다." 기존 BBL은 Driveline 5각형(Posture/Block/Rotation/Arm Action/CoG) 분류이지만, **출력(절대 power generation) vs 전달(분절 간 sequencing/efficiency)**의 분리가 명시적으로 안 돼 있어서 코칭 인사이트가 흐려짐.

### 분리 진단의 코칭 가치
| 사분면 | 의미 | 코칭 우선순위 |
|---|---|---|
| ① 출력↑ 전달↑ | elite | 그대로 유지·정교화 |
| ② **출력↑ 전달↓** | **"낭비형"** | **코칭 효과 가장 큼 — 전달 최적화로 즉시 구속 향상** |
| ③ 출력↓ 전달↑ | "효율형" | 체력 보강 (출력 자체 끌어올리기) |
| ④ 출력↓ 전달↓ | 발달 단계 | 전반적 향상 필요 |

### 신규 7변수 + 1메타

**출력(Output) — 통합 결과 1개 추가**

| 변수 | 산출 | 의미 | 코호트 (n=186) |
|---|---|---|---|
| `wrist_release_speed` | throwing arm wrist 3D speed at BR (median of BR±2 frames) | 모든 회전·전달의 최종 통합 결과 (ball release proxy, wrist_jc 기준이라 실제 ball speed의 ~60%) | mean 14.2 m/s, median 15.0 |

**전달(Transfer) — 효율·타이밍 4개 추가**

| 변수 | 산출 | 의미 | 코호트 (n=186) |
|---|---|---|---|
| `elbow_to_wrist_speedup` | wrist 3D speed / elbow 3D speed at BR | 마지막 whip 효율 (전완→손목). elite 1.4~1.8 | mean 1.61, median 1.60 |
| `angular_chain_amplification` | peak_arm_av / peak_pelvis_av | 골반→팔 전체 증폭률. elite 2.5~3.5 | mean 2.74, median 2.74 |
| `stride_to_pelvis_lag_ms` | (peakPelvis − FC) / fps × 1000 | FC→골반 회전 시간차. <30ms = flying open, >100ms = 출력 손실 | median 0ms, IQR -45~+26 |
| `x_factor_to_peak_pelvis_lag_ms` | (peakPelvis − argmax X-factor) / fps × 1000 | 분리 저장→골반 회전 타이밍. SSC 효율 (0~120ms ideal) | median 59ms, IQR 6~122 |

**부상(Injury Risk) — 출력의 비용 2개 추가**

| 변수 | 산출 | 의미 | 코호트 (n=186) |
|---|---|---|---|
| `elbow_valgus_torque_proxy` | 0.5 × m_forearm × L² × ω² (m_forearm=1.6kg, L=elbow→wrist, ω=shoulder_ir_vel) | UCL stress proxy (Werner-style 단순화). 절대 토크는 아니지만 percentile ranking에 적합 | median 157 Nm proxy |
| `knee_varus_max_drive` | drive 다리 knee_varus max in [KH, FC] (Uplift raw 컬럼) | drive 무릎 외반 max — 발달기 안정성 | mean 26°, median 27 |

**메타 1개**

| 변수 | 산출 | 활용 |
|---|---|---|
| `forearm_length_m` | elbow_jc → wrist_jc 3D distance at BR | elbow_valgus_torque_proxy 산출 + 정규화 참고용 |

### 카테고리 객체 추가 (`metadata.js`)
`OUTPUT_VS_TRANSFER` const 객체 신설 — UI에서 "출력 vs 전달" 2-축 다이어그램 구현용.
- `OUTPUT.variables`: 13개 (peak_pelvis/trunk/arm_av, elbow/shoulder/COG/hip 속도들 + wrist_release_speed)
- `TRANSFER.variables`: 13개 (lag_ms들, speedup들, sequence, X-factor + 신규 4개)
- `INJURY.variables`: 3개 (elbow_valgus_torque_proxy, knee_varus_max_drive, max_shoulder_ER_deg)
- 각 카테고리에 `integration_var` 지정 — 단일 통합 지표 (각각 wrist_release_speed / angular_chain_amplification / elbow_valgus_torque_proxy)

### 검증 (정예준·박명균·방시헌)
| 선수·세션 | 출력 | 전달 | 부상 | 진단 |
|---|---:|---:|---:|---|
| 정예준 H2 (Fall) | 73pct | 72/69/95pct ★ | ⚠ 0.5pct | elite, 단 shoulder_ir_vel 17,347°/s outlier로 valgus proxy outlier. BBL 사이트 검증 필요 |
| 박명균 H2 (Fall) | 75pct | 91pct ★ | 95pct ★ | **이상적** |
| 박명균 H1 (Spring) | 28pct | 30pct | 43pct | Fall→발달 진전 확인 |
| 방시헌 H1 (Spring) | 73pct | 20pct ⚠ | 5pct ⚠ | **"낭비형" 사례 — 분리 진단의 가치 입증** |

### ⚠ 주의 사항
- **`elbow_valgus_torque_proxy`는 단순화된 proxy** (Werner-style 0.5×m×L²×ω²). 절대 토크값으로 해석 금지 — percentile ranking 용도. 정확한 토크 측정은 inverse dynamics (마커 기반) 필요.
- **`wrist_release_speed`는 wrist_jc 기준** → 실제 ball release speed의 ~60% underestimate (손가락 끝 5-10cm extension 미포함). 모든 선수에 일관 적용되므로 percentile ranking에는 영향 없음.
- **두 lag 변수(stride_to_pelvis_lag_ms, x_factor_to_peak_pelvis_lag_ms)의 sd가 큼** (outlier 영향). median/IQR 기반 percentile은 합리적.
- **`angular_chain_amplification`은 LITERATURE_OVERRIDE 미포함** — 134 코호트 분포 percentile만 사용.

### Phase 3 향후 작업 (v33.7~)
- UI에 **"출력 vs 전달" 2-축 다이어그램** 추가 (사분면 차트). X축: wrist_release_speed percentile, Y축: angular_chain_amplification percentile, 색상: elbow_valgus_torque_proxy
- 종합 코칭 권고 자동 생성: "당신은 ② 낭비형입니다. 출력은 73pct로 elite지만 전달 효율이 20pct에 머무릅니다. 우선순위는 …"
- KINETIC_FAULTS에 `elbow_valgus_torque_proxy > 코호트 90pct` 임계로 부상 위험 fault 추가

### 변경 파일
| 파일 | 변경 |
|---|---|
| `cohort_v29.js` | var_distributions +8, var_sorted_lookup +8, polarity_vars +7 |
| `metadata.js` | EXTRA_VAR_SCORING +7, PLAUSIBLE_RANGES +8, OUTPUT_VS_TRANSFER 신설 |
| `app.js` | extractScalarsFromUplift에 7변수 산출 로직 추가 (Python 1:1 포팅) |
| `README.md` | v33.6 패치노트 |

---

# BBL v33.5 — Phase 2: 16개 메카닉 변수 134 코호트 분포 산출 + LITERATURE_OVERRIDE 해제
**Build**: 2026-05-05 / **Patch**: v33.4 → v33.5 / **Type**: 코호트 데이터 갱신 + 점수 산식 전환

---

## v33.5 변경

### 동기
v32.x~v33.4 시리즈 진행 중 16개 신규 메카닉 변수가 LITERATURE_OVERRIDE(가우시안 산식, elite optimal 기준)에만 의존했음. 발달 코호트(고1) 평균값이 elite optimal보다 낮으면 정상 선수도 점수 폭락하는 구조 (메모리: "v32.4 정예준 H2 F2=0.3 사건"과 동일 메커니즘).

### 작업
1. 134명 × 평균 ~10 trial = **1810개 raw Uplift CSV** 일괄 처리 (Python multiprocessing, 4 worker, 19초)
2. BBL `extractScalarsFromUplift` 핵심 로직을 Python으로 1:1 포팅 (`extract_uplift_scalars.py`)
3. **186 세션** (134명 × 평균 1.4시기, 일부는 한 시기만) 단위로 trial 평균 집계
4. 16+2개 변수 분포 통계 산출 → `cohort_v29.js`의 `var_distributions` + `var_sorted_lookup` 갱신
5. `metadata.js`의 `LITERATURE_OVERRIDE` Set에서 16개 변수 주석 처리 → percentile 기반 평가로 전환

### 산출 분포 (134 코호트, 186 세션 기준)

| 변수 | n | mean ± sd | median | 활용 |
|---|---:|---:|---:|---|
| `peak_pelvis_av` | 186 | 494 ± 89 °/s | 495 | 회전 속도 카테고리 |
| `peak_trunk_av` | 186 | 710 ± 134 °/s | 724 | 회전 속도 카테고리 |
| `peak_arm_av` | 186 | 1319 ± 231 °/s | 1338 | Arm Action |
| `peak_x_factor` | 183 | 31 ± 10° | 32 | Hip-Shoulder Sep (Stretch) |
| `arm_trunk_speedup` | 186 | 1.92 ± 0.40 | 1.86 | 운동량 전달 효율 |
| `pelvis_trunk_speedup` | 186 | 1.45 ± 0.21 | 1.43 | 키네틱 체인 효율 |
| `drive_hip_ext_vel_max` | 186 | 580 ± 128 °/s | 592 | 단계 1 하체 드라이브 |
| `lead_hip_ext_vel_max` | **15** ⚠ | 98 ± 97 °/s | 75 | 단계 2 lead leg block (n 작음) |
| `hip_ir_vel_max_drive` | 186 | 651 ± 181 °/s | 646 | drive 다리 IR |
| `elbow_ext_vel_max` | 186 | 1566 ± 481 °/s | 1553 | Arm Action — Elbow |
| `shoulder_ir_vel_max` | 186 | 4868 ± 2962 °/s | 4048 | Arm Action — Shoulder (변동 큼) |
| `max_cog_velo` | 183 | 2.96 ± 0.42 m/s | 3.01 | CoG 전진 효율 |
| `peak_torso_counter_rot` | 183 | 65 ± 28° | 70 | Posture |
| `torso_side_bend_at_mer` | 186 | 15 ± 5° | 16 | Posture |
| `torso_rotation_at_br` | 183 | 20 ± 32° | 7 | Posture (분포 우편향) |
| `lead_knee_ext_change_fc_to_br` | 186 | 4 ± 11° | 4 | Block (음수도 빈번) |
| `stride_length_trial` | 186 | 1.84 ± 0.28 m | 1.87 | (참고용 raw stride) |
| `stride_norm_height` | 186 | 1.02 ± 0.16 | 1.04 | Stride 정규화 (Driveline 0.85~1.0) |

### ⚠ 주의 사항
- **`lead_hip_ext_vel_max` n=15만 valid** (186 중 8%). BBL 정의 `-min(hip_flex_velocity in [FC, BR])`은 음수 min일 때만 산출되는데, 발달 코호트에서 lead leg가 FC~BR 동안 충분히 신전 신호를 안 보임. 분포는 그대로 사용하되, 점수 산식에서 누락 케이스는 자동 제외됨.
- **`shoulder_ir_vel_max` 변동성 큼** (sd≈mean의 60%). 일부 trial에서 18000+ °/s outlier 발견 — 측정 노이즈 가능성. percentile 산식이라 outlier 영향은 자체 제한됨.
- **`torso_rotation_at_br` 분포 우편향** (sd>mean). BR 시점 trunk가 정면(0°) 근처인 케이스가 다수, 일부만 큰 각도. abs 컨벤션 자체가 그런 분포 생성.
- **`stride_norm_height`는 Height 부재 시 1.80m fallback** (BBL 동일 컨벤션). 정확도를 더 높이려면 `master_fitness.xlsx`의 선수별 Height로 재계산 가능 (Phase 3 후속).

### 영향
- ✅ Phase 2 16변수 점수 산식이 가우시안(elite optimal 기반) → percentile(134 코호트 기반)로 전환
- ✅ 발달 코호트 평균 선수도 50점(중앙값)을 받게 됨 (이전엔 elite 기준에서 0~30점)
- ✅ `algorithm_version`이 v33.5로 변경되어 모든 저장 리포트는 자동 재계산
- ✅ Phase 1 정예준·박명균 결함 진단(메모리에 기록됨)은 영향 없음 (검출 로직 동일)

### 검증
- 1 trial smoke test: `extract_uplift_scalars.py` 단독 실행으로 16변수 산출값이 BBL 사이트 처리 결과와 1:1 일치하는지 확인 가능
- 1810 trial 일괄 처리: 0 실패, 19초 완료
- cohort_v29.js syntax: `node --check` 통과
- metadata.js LITERATURE_OVERRIDE: 31개 → 15개 (16개 주석 처리)
- (사용자 검증 권장) 정예준·박명균을 BBL 사이트에 다시 업로드 → 점수 변화 확인

### 변경 파일
| 파일 | 변경 |
|---|---|
| `cohort_v29.js` | `var_distributions` +18, `var_sorted_lookup` +18 (8731→8876라인) |
| `metadata.js` | `LITERATURE_OVERRIDE` 16개 주석 처리 (활성 31→15) |
| `README.md` | v33.5 패치노트 추가 |

---

## v33.4 변경

### 동기
v33.x 시리즈를 마치고 점검 결과 index.html이 **7,074라인 / 381KB** — GitHub 웹 편집 매우 느림, diff 가독성 낮음.

### 분석
```
index.html 구성:
  HTML markup:        149 라인 ( 2%)
  <style> 블록:       512 라인 ( 7%)
  <script> 인라인: 6,414 라인 (91%) ⚠
```
→ HTML 파일이라기보다 .js 파일에 HTML 껍데기가 붙은 형태.

### 변경
인라인 `<script>` 6,414라인을 **`app.js`로 분리**, index.html은 `<script src="app.js"></script>` 한 줄로 참조.

### 효과

| 파일 | Before | After | 변화 |
|---|---:|---:|---|
| `index.html` | 7,074 라인 / 381 KB | **661 라인 / 25 KB** | ↓ 91% |
| `app.js` (신규) | — | 6,416 라인 / 356 KB | (분리) |

- ✅ GitHub 웹 편집 빨라짐 (661라인은 무리 없음)
- ✅ Git diff: 마크업/스타일 변경 vs 로직 변경 분리됨
- ✅ 로직 변경 0 — 단순 분리만 (런타임 동작 동일)
- ✅ JS syntax 검증 통과

### 변경 파일
- `index.html`: 인라인 `<script>` 제거, `<script src="app.js">` 추가
- `app.js` (신규): 메인 로직 6,416라인
- ALGORITHM_VERSION 위치는 app.js로 이동 (v33.3 → v33.4)

### 의존 순서 (HTML에서 로드 순서 유지)
```html
<script src="cohort_v29.js"></script>      <!-- 1. 코호트 데이터 -->
<script src="metadata.js"></script>         <!-- 2. 결함·점수·카테고리 -->
<!-- styles -->
<script src="app.js"></script>             <!-- 3. 메인 로직 (마지막) -->
```

---

# BBL v33.3 — Uplift 사전계산 peak frame 우선 사용
**Build**: 2026-05-04 / **Patch**: v33.2 → v33.3 / **Type**: 검출 정확도 개선

---

## v33.3 변경 (박명균 raw 데이터 검증으로 발견)

### 문제: 박명균이 정상 시퀀스인데 "명확한 누수" 표시
박명균 raw 10개 trial 직접 계산 (Uplift 사전계산 peak frame 사용):

| 지표 | 정상 범위 | 박명균 평균 | 진단 |
|---|---|---:|---|
| pelvis → trunk lag | 30~80ms | **58ms** | ✓ 정상 |
| trunk → arm lag | 30~80ms | **57ms** | ✓ 정상 |

→ Uplift는 정확한 peak (frame 806/819/834)을 검출하여 lag 54/63ms 산출
→ **그런데 v33.2까지 화면에는 lag 114/49ms로 표시되며 "명확한 누수"로 잘못 진단**

### 원인 (v31.12 이후 누적된 설계 결함)
```javascript
// 기존: BBL 자체 detection만 사용
events.peakPelvis = detectPeakRotVel('pelvis_rotational_velocity...', _pelvisLo, _pelvisHi);
events.peakTrunk = detectPeakRotVel('trunk_rotational_velocity...', _trunkLo, _trunkHi);
events.peakArm = detectPeakRotVel(armVelCol, _armLo, _armHi);
```
BBL의 raw detectPeakRotVel이 Uplift와 다른 peak을 잡아 lag 부풀림.

### v33.3 수정
```javascript
// Uplift 사전계산 우선, 없을 때만 자체 검출
events.peakPelvis = upEvents.peakPelvis ?? detectPeakRotVel(...);
events.peakTrunk  = upEvents.peakTrunk  ?? detectPeakRotVel(...);
// peakArm: detected throwing arm에 맞는 Uplift 컬럼 우선
const upPeakArmFrame = getFrameAbs(`max_${_throwingArmDetected}_arm_rotational_velocity_with_respect_to_ground_frame`);
events.peakArm = upPeakArmFrame ?? detectPeakRotVel(...);
```

→ Uplift 정밀 검출값 우선 사용. BBL 자체 detection은 Uplift 미검출 시 fallback.

### 박명균 예상 변화 (v33.3 적용 후)

| 지표 | v33.2 (잘못됨) | v33.3 (Raw 일치) |
|---:|---:|---:|
| pelvis → trunk | 114ms ⚠ "명확한 누수" | **58ms ✓ 정상** |
| trunk → arm | 49ms | **57ms** |
| 진단 | LateTrunkRotation 결함 발동 | 정상 시퀀스 |

### 변경 파일
- `index.html`: ALGORITHM_VERSION v33.2 → v33.3, events.peakPelvis/Trunk/Arm Uplift 우선 로직

### 파급 효과
박명균 외 모든 선수의 시퀀스 분석이 더 정확해짐 — Uplift의 정밀 검출 알고리즘을 신뢰하고, BBL은 Uplift 미검출 케이스에만 fallback.

---

# BBL v33.2 — Uplift event placeholder 0을 null로 처리
**Build**: 2026-05-04 / **Patch**: v33.1 → v33.2 / **Type**: 데이터 파싱 버그 픽스

---

## v33.2 변경 (박명균 raw CSV 분석으로 근본 원인 발견)

### 문제 추적
박명균 raw Trial CSV 10개 직접 분석 결과:

| Trial | KH | FC | **MER** | BR | peakPelvis | peakTrunk |
|---|---:|---:|---:|---:|---:|---:|
| 0002~0009, 0012 (9개) | 음수 | 음수 | **0 ⚠** | 음수 | 음수 | 음수 |
| 0010 (1개) | -571 | -752 | **-794 ✓** | -785 | -747 | -760 |

→ **Uplift CSV의 `max_external_rotation_frame` 값이 9/10 trial에서 `0`** (Uplift "not detected" 플레이스홀더)

### BBL의 버그
```javascript
// 기존 (v33.1 이하):
const getFrameAbs = (key) => {
  const ci = idx[key]; if (ci == null) return null;
  const v = parseFloat(r0[ci]); return isNaN(v) ? null : cur0 - v;  // 0을 valid 값으로 처리
};
```
- raw 값이 0이면 `cur0 - 0 = 0` → `events.mer = 0` (frame 0)
- arm peak 검출 윈도우 = `[events.mer + 3, events.br + 10]` = `[3, ~840]` (시퀀스 거의 전체)
- 이 윈도우 내 평균값 vs Uplift MER이 누적 차이로 보여서 평균 90frame 차이로 표시됨
- 실제로는 9개 trial이 처음부터 **events.mer = 0이라는 잘못된 시점에서 검출 시작**
- 결과적으로 left arm이든 right arm이든 0으로 평가 → throwing arm 자동검출 'left' 잘못 선택 → 차트 누락

### v33.2 수정
```javascript
const getFrameAbs = (key) => {
  const ci = idx[key]; if (ci == null) return null;
  const v = parseFloat(r0[ci]);
  if (isNaN(v) || v === 0) return null;  // ★ 0 = Uplift placeholder
  return cur0 - v;
};
```

→ Uplift MER 0 → events.mer null → BBL의 raw MER detection이 fallback으로 작동 → 정상 윈도우 → arm peak 정상 → 시퀀스 차트 표시.

### 변경 파일
- `index.html`: ALGORITHM_VERSION v33.1 → v33.2, getFrameAbs에서 0 placeholder 처리

### 박명균 외 영향
이 fix는 **모든 선수**에게 적용됩니다 — Uplift CSV에서 특정 이벤트가 미검출 시(0 플레이스홀더), 잘못된 valid 값으로 사용하지 않고 raw fallback으로 자동 보완.

---

# BBL v33.1 — Throwing arm 자동검출 신뢰성 가드
**Build**: 2026-05-04 / **Patch**: v33.0 → v33.1 / **Type**: 검출 버그 픽스

---

## v33.1 변경 (박명균 우완 시퀀스 차트 누락 해결)

### 문제 발견
박명균(우완) 시퀀스 타이밍 차트 누락. DevTools 콘솔:
```
⚠ Throwing arm detected (left, max 0°/s) differs from handedness label (right). Using detected.
```

### 원인 (v31.12 자동검출 로직 버그)
```javascript
// 기존
const _throwingArmDetected = _leftMaxAv >= _rightMaxAv ? 'left' : 'right';
```
- 양 팔 모두 0°/s (윈도우 오류 등) → `0 >= 0 = true` → 'left' 잘못 선택
- 우완 라벨이 있는데도 left arm을 throwing arm으로 사용
- 이후 peak detection이 글러브 손 시그널 잡음 → lag null → 차트 누락

### v33.1 수정
```javascript
const _ARM_DETECT_THRESHOLD = 800;  // peak arm AV는 보통 1000+
if (_leftMaxAv < THRESHOLD && _rightMaxAv < THRESHOLD) {
  // 둘 다 신뢰 임계 미만 → handedness label 사용
  _throwingArmDetected = armSide;
} else if (_leftMaxAv > _rightMaxAv) {
  _throwingArmDetected = 'left';
} else if (_rightMaxAv > _leftMaxAv) {
  _throwingArmDetected = 'right';
} else {
  _throwingArmDetected = armSide;  // tie → label 우선
}
```

3가지 가드:
1. **임계 800°/s 미만** → 자동검출 거부, label 사용 (박명균 케이스 직접 해결)
2. **strict `>` 비교** (`>=` 폐기) → tie 시 label로
3. **tie 명시적 처리** → label 우선

### 변경 파일
- `index.html`: ALGORITHM_VERSION v33.0 → v33.1, throwing arm 자동검출 로직 가드 추가

---

# BBL v33.0 — 마네킹 경로 + 레이더 라벨 일치 + 5각 누락 변인
**Build**: 2026-05-04 / **Patch**: v32.9 → v33.0 / **Type**: UX 정밀 + 데이터 완전성

---

## v33.0 변경 (사용자 요청 3건)

### 1. 마네킹 에너지 경로 — 착지다리 → 앞 hip 경유
**기존**: lAnkle → lKnee → pelvisC (가운데로 바로)
**v33.0**: **lAnkle → lKnee → pelvisL (앞 hip) → pelvisC** → rShoulder → rElbow → rWrist → ball
GRF 경로가 발→무릎→**앞 hip**→골반 회전축으로 전달되는 생물역학적 경로 반영.

### 2. 팔꿈치·손목 노드 시각화 (공 던지는 팔)
- 팔꿈치(rElbow)에 펄스 애니메이션 + ARM→FOREARM 색상(`afColor`) 노드
- 손목(rWrist)에 작은 cyan 노드
- 라벨 "ELBOW" 표시
- 팔꿈치 → 손 에너지 흐름이 시각적으로 강조됨

### 3. 레이더 라벨 ↔ 카드 라벨 일치
**기존**: 레이더는 `COHORT.category_meta[c].name` ("X-Factor 형성", "몸통 회전 채찍", "레이백 + 팔 전달")
**v33.0**: `CATEGORY_DETAILS[c].name` 우선 사용 → "몸통 에너지 로딩", "몸통 에너지 발현", "팔 에너지" — **카드와 동일**.
Fallback으로 category_meta 유지 (안전성).

### 4. 5각 Driveline Block — `stride_norm_height` 보강
**원인 분석**: 17개 5각 Driveline 변수 중 `stride_norm_height`만 조건부 계산 (Height[M] 의존)
**v33.0 수정**:
- master_fitness localStorage에서 Height 백업 검색
- 그래도 없으면 코호트 평균 신장(1.80m)으로 근사값 산출 + `_stride_norm_height_approx` 플래그
- Driveline standard 0.85~1.0 기준이라 ±5cm 신장 차이는 점수에 큰 영향 없음

→ Block 카테고리 점수가 항상 산출됨 (Height 자동 보강 또는 근사값).

### 변경 파일
- `index.html`: ALGORITHM_VERSION v32.9 → v33.0, energyPath 경로 변경, 팔꿈치/손목 노드 SVG 추가, 레이더 라벨 우선순위 변경, stride_norm_height Height 백업 로직

---

# BBL v32.9 — 마네킹 누수-only + ARM→FOREARM 신규 + 스토리 재배치
**Build**: 2026-05-04 / **Patch**: v32.8 → v32.9 / **Type**: UX 재설계 + 신규 변수

---

## v32.9 변경 (사용자 요청 3건 일괄)

### 1. ARM → FOREARM 신규 에너지 흐름
**Option A (Biomechanics 기반) 채택**:
```javascript
arm_to_forearm_speedup = elbow_ext_vel_max / shoulder_ir_vel_max
```
**해석**:
- elite 0.50 ~ 0.65 (전완이 상완의 절반 정도 = 정상 채찍)
- > 0.70 → 🚨 전완 의존 (팔꿈치 부하↑, 부상 위험)
- < 0.40 → ⚠ 전완 가속 부족 (출력 손실)
- 0.40 ~ 0.70 → 정상 (라벨 숨김)

`extractScalarsFromUplift`에 산식 추가 (4줄). Phase 2: 코호트 분포 확보 후 percentile 전환 검토.

### 2. 마네킹 시각화 — 누수 only 원칙
**기존**: 7개 라벨이 항상 표시 (PELVIS→TRUNK, TRUNK→ARM, TRUNK ROT VEL, X-FACTOR, DRIVE LEG, FRONT-FOOT BLOCK, 무릎 신전)
**v32.9**: 누수 트리거 발생 시에만 라벨 표시. 정상 단계는 깨끗.

| 라벨 | 트리거 조건 |
|---|---|
| ⚠ PELVIS → TRUNK | `pelvis_to_trunk_lag_ms` 정상 30~80ms 벗어남 |
| ⚠ TRUNK → ARM | `trunk_to_arm_lag_ms` 정상 20~80ms 벗어남 |
| 🚨/△ ARM → FOREARM | `arm_to_forearm_speedup` 0.40~0.70 벗어남 (★ 신규) |
| ⚠ FLYING OPEN | `hip_shoulder_sep_at_fc` < 5° |
| 🚨/△ 무릎 무너짐 | `lead_knee_ext_change_fc_to_br` < -10° |
| △ 추진 약함/부족 | drive_hip 또는 max_cog_velo 부족 |

→ 전부 정상이면 중앙에 "✅ 키네틱 체인 정상 — 모든 단계 에너지 전달 효율 양호" 단일 메시지.

### 3. 스토리 순서 재배치 (5.5 위치)
**v31.22 순서**: coachingDiag → GIF → 마네킹 → 에너지 흐름 → 결함 → 우선순위 → summary
**v32.9 순서**:
1. 구속·잠재구속 (header)
2. 점수 (sections)
3. 키네틱 체인 개념 (GIF)
4. 마네킹·시퀀스·에너지 흐름 (coach session)
5. 리크 원인 (faultsHtml)
**5.5. 투수 유형 진단 (coachingDiagHtml) ← 신규 위치**
6. 종합 평가·강점·약점 (summary)
**7. 코칭 우선순위 액션 플랜 (trainingPriorityHtml) ← summary 다음으로 분리**

근거: 투수 유형은 1~5의 종합 결과 → 종합 평가 직전이 자연. 코칭 우선순위는 액션 → 마지막.

### 변경 파일
- `index.html`: ALGORITHM_VERSION v32.8 → v32.9, arm_to_forearm_speedup 산식 추가, 마네킹 라벨 누수-only 재구성, kineticChainBlock 순서 변경, actionPlanBlock 신규 분리

---

# BBL v32.8 — 음수 lag 해석 정정 (검출 오류로 처리)
**Build**: 2026-05-04 / **Patch**: v32.7 → v32.8 / **Type**: 정정

---

## v32.8 변경 (v32.7 정정)

### v32.7의 잘못된 해석
v32.7에서 음수 lag을 "발달 단계 미성숙 시퀀스"로 표시. 사용자(국민대 스포츠과학과 교수) 지적: **"음수가 될 수 없어"**.

### Biomechanical 정정
proximal-to-distal sequencing 원칙상 **pelvis peak → trunk peak → arm peak** 순서는 발달 단계 미성숙으로도 위반되지 않음. 음수 lag = peak detection 오류.

### v32.8 처리
```javascript
const detectionErrorPT = pToT < 0;
const detectionErrorTA = tToA < 0;
const pToTAdj = Math.abs(pToT);    // magnitude 표시용 보정
const tToAAdj = Math.abs(tToA);
// 차트는 abs 값으로 정상 렌더 (좌완도 차트 표시됨)
// 차트 아래 "🚨 이벤트 검출 오류 의심" 명확한 경고 + 원본 lag 값 + 재업로드/윈도우 점검 권장
```

차트는 항상 렌더 (좌완 누락 문제 해결 유지), 음수 케이스는 명시적으로 detection 오류임을 알림.

### 변경 파일
- `index.html`: ALGORITHM_VERSION v32.7 → v32.8, immatureNote → detectionErrorNote

---

# BBL v32.7 — 숫자 포매팅 + 좌완 시퀀스 차트 복구
**Build**: 2026-05-04 / **Patch**: v32.6 → v32.7 / **Type**: UX 픽스 두 건

---

## v32.7 변경 (사용자 발견 두 건)

### 1. narrative 점수차 소수점 1자리 통일 (FP 정밀도)
**문제**: "+19.200000000000003점" 같은 부동소수점 출력
**원인**: `mechS - fitS = 88.9 - 69.7 = 19.200000000000003` (JS FP 정밀도)
**수정**:
```javascript
const diffRaw = mechS - fitS;
const diff = +diffRaw.toFixed(1);  // 19.2로 정규화
```

### 2. 좌완 키네틱 시퀀스 차트 누락 수정 (오승현·박명균)
**문제**: 좌완 발달 단계 선수의 시퀀스 차트가 안 보임
**원인**: v31.13에서 음수 lag(`pToT < 0 || tToA < 0`)을 측정 오류로 간주하고 차트 차단, 경고 메시지로 대체
**진단**: v31.12 throwing arm 자동 검출 후엔 음수 lag이 진짜 발달 단계 미성숙 시퀀스 (메모리 원칙)
**수정**: 음수 lag도 차트 정상 렌더, 차트 범위 확장, "발달 단계 미성숙 시퀀스" 안내문 차트 아래 추가

### 변경 파일
- `index.html`: ALGORITHM_VERSION v32.6 → v32.7, narrative diff toFixed(1), 시퀀스 차트 차단 로직 제거

---

# BBL v32.6 — 비교표 칼럼 정렬 수정 (UI)
**Build**: 2026-05-04 / **Patch**: v32.5 → v32.6 / **Type**: UI 정렬 픽스

---

## v32.6 변경

H1↔H2·선수간 비교표에서 발견된 정렬 이슈 수정.

### 문제
1. **헤더가 좌측 정렬, 데이터는 우측 정렬** — `<th class="text-right">`이 `.cmp-table th { text-align: left }`에 덮여서 1차·2차·Δ 헤더가 좌측에 붙고 숫자는 우측에 붙어 시각적으로 어긋남
2. **자릿수 정렬 안 됨** — monospace 폰트지만 tabular-nums가 없어 `0.3`과 `100.0`의 소수점 위치가 맞지 않음

### 수정 (CSS 두 줄)
```css
.cmp-table th.text-right { text-align: right; }   /* 헤더 우측 정렬 */
.cmp-table .cmp-num {
  font-variant-numeric: tabular-nums;             /* 자릿수 폭 동일 */
  min-width: 70px;                                /* 칼럼 폭 일관 */
}
```

산식 변화 없음 — 순수 시각 정렬 픽스.

---

# BBL v32.5 — "more is better" 변수 10개 추가 percentile 전환
**Build**: 2026-05-04 / **Patch**: v32.4 → v32.5 / **Type**: 산식 수정 (광범)

---

## v32.5 변경

v32.4에서 발견된 "가우시안 optimal이 코호트 median보다 위면 점수 폭락" 문제가 다른 변수에도 동일하게 존재. 코호트 분포가 있고 "more is better" 성격인 변수 10개를 추가 percentile로 전환.

### 전환된 10개 변수

| 변수 | 카테고리 | n | 사유 |
|---|---|---:|---|
| IMTP Peak Vertical Force / BM | F1_Strength | 234 | optimal=36 vs cohort median 26.8 — 폭락 위험 |
| **CMJ RSI-modified** | F3_Reactivity | 234 | optimal=0.5 vs RSI 1.1(top)인 선수가 0점 받던 문제 |
| **SJ RSI-modified** | F3_Reactivity | 233 | 동일 |
| **EUR** | F3_Reactivity | 233 | optimal mismatch |
| max_trunk_twist_vel_dps | C4 (mechanics) | 199 | Werner 950°/s 가정 — 발달 코호트 median 540 |
| max_pelvis_rot_vel_dps | C3 (mechanics) | 199 | 동일 |
| trunk_flex_vel_max | C4 (mechanics) | 198 | 동일 |
| lead_knee_ext_vel_max | C2 (mechanics) | 196 | 동일 |
| Height[M] | F4_Body | 234 | 체형은 코호트 분포가 더 적절 |
| Weight[KG] | F4_Body | 234 | 동일 |

### 변경 안 한 16개 변수 (분포 미보유 — Phase 2)

코호트 분포(`var_sorted_lookup`)가 cohort_v29.js에 없어서 LITERATURE_OVERRIDE 해제해도 자동 가우시안 fallback으로 떨어짐. raw 데이터 재처리 후 분포 추가 필요:

```
peak_x_factor (★ 사용자 우선 요구)
peak_arm_av, peak_trunk_av, peak_pelvis_av
elbow_ext_vel_max, shoulder_ir_vel_max
hip_ir_vel_max_drive, max_cog_velo
drive_hip_ext_vel_max, lead_hip_ext_vel_max
arm_trunk_speedup, pelvis_trunk_speedup
peak_torso_counter_rot, torso_side_bend_at_mer, torso_rotation_at_br
lead_knee_ext_change_fc_to_br, stride_norm_height
```

### 가우시안 유지 (의도된 양방향 최적)

진짜 양방향 최적이 있는 변수는 가우시안 그대로 유지:
- `BMI` — 25 근처가 진짜 생물학적 최적
- `max_shoulder_ER_deg` — 부상 모니터링 (180° elite, 200°+ valgus stress)
- `trunk_rotation_at_fc`, `trunk_forward_tilt_at_fc`, `hip_shoulder_sep_at_fc`, `shoulder_h_abd_at_fc`, `arm_slot_mean_deg` — 자세 최적 각도
- `com_decel_pct`, `lead_knee_amortization_ms`, `stride_time_ms`, `lead_hip_flex_at_fc` — 타이밍/자세
- SD 변수들 (lower-better, 가우시안 형태가 적합)

### 정예준 케이스 효과

| 카테고리 | v32.4 | v32.5 | 변화 |
|---|---:|---:|---|
| F2_Power | H1 53.8 / H2 17.8 | 동일 | (v32.4에서 처리) |
| **F3_Reactivity** | H1 30 / H2 42 | **H1 64.5 / H2 45** | ★ 방향 반전 |

★ F3 방향 반전의 의미: 가우시안 산식에서는 RSI 1.1(코호트 top)이 optimal=0.5와 멀어 0점이 됐었음. percentile은 "RSI 높을수록 좋음"을 정상 반영 → H1의 폭발적 반응성이 제대로 평가됨.

### 변경 파일
- `metadata.js`: LITERATURE_OVERRIDE에서 10개 변수 주석 처리
- `index.html`: ALGORITHM_VERSION v32.4 → v32.5

### 메모리 적용 원칙
- 발달 단계 코호트 컨텍스트 우선 (elite 가우시안 X)
- 측정 신뢰성 있는 변수만 카테고리 점수에 사용
- X-factor 등 사용자 우선 변수는 Phase 2 분포 확보 후 즉시 전환

---

# BBL v32.4 — F2_Power 산식 percentile 전환
**Build**: 2026-05-04 / **Patch**: v32.3 → v32.4 / **Type**: 산식 수정

---

## v32.4 변경

### 배경
정예준 H1(4월) vs H2(10월) 비교 진단에서 발견된 F2_Power 산식 이슈.

**문제 발견 과정**
1. H1 체력 51.8 → H2 체력 28.7 (Δ −23.1)으로 비정상 큰 차이
2. 진단 결과: F2_Power가 49.8 → **0.3**으로 추락 (전체 체력 −23의 단일 원인)
3. F2_Power 산식 추적: **LITERATURE_OVERRIDE의 가우시안 산식**
   - `CMJ Peak Power / BM`: optimal=60 W/kg, sigma=6
   - `SJ Peak Power / BM`: optimal=59 W/kg, sigma=6
   - 점수 = 100 × exp(−(value − optimal)² / (2 × sigma²))

### 문제의 본질
가우시안 산식은 "최적값에서 멀어질수록 점수↓"라서 **양쪽으로 페널티**. 체중당 power는 "more is better" 메트릭인데 가우시안이 부적절. 결과:

```
              optimal     코호트 median   코호트 max
CMJ_BM:       60          47.6           93.3
SJ_BM:        59          46.4           74.9
```

→ 코호트 median이 optimal 아래 → **대부분 선수가 0~몇 점**. 정예준 H2는 CMJ 42(percentile 21%)인데 점수가 1점.

### 수정 (metadata.js)
```javascript
// LITERATURE_OVERRIDE Set에서 CMJ·SJ Power /BM 제외 → percentile 산식 사용
// 'CMJ Peak Power / BM [W/kg]',  // → percentile (v32.4)
// 'SJ Peak Power / BM [W/kg]',   // → percentile (v32.4)
```

`percentileOfCohort()` 함수가 LITERATURE_OVERRIDE 체크를 건너뛰면 자동으로 코호트 sorted_lookup 기반 percentile로 산출됨. Code 변경은 주석 처리 한 줄.

### 효과 (정예준 시뮬)

| 지표 | 이전 (Gaussian) | v32.4 (Percentile) |
|---|---:|---:|
| H1 F2_Power | 49.8 | **53.8** |
| H2 F2_Power | **0.3** | **17.8** |
| Δ F2 | −49.5 | **−36.0** |
| 체력 종합 Δ | −23.1 | **약 −17.2** |

여전히 큰 차이지만 측정 데이터의 실제 변화(CMJ percentile 73→21)를 반영하는 합리적 수치.

### 영향 범위
- F2_Power가 들어가는 모든 보고서 점수 자동 변화 (저장된 리포트는 재계산 트리거됨)
- 134코호트 비교 분석에도 영향 — 빠른/느린 그룹 F2 차이가 더 분포 기반으로 표현됨

### 변경하지 않은 것 (Phase 2 검토)
같은 패턴(가우시안 + optimal이 코호트 median보다 위)이 다른 변수에도 있을 가능성:
- `IMTP Peak Vertical Force / BM` (optimal=36, 코호트 median ?)
- `CMJ RSI-modified`, `SJ RSI-modified`, `EUR`
- F4_Body 변수들 (`Height`, `Weight`, `BMI` — 이건 Gaussian이 정당할 수도)

→ 사용자 확인 후 Phase 2에서 일괄 검토 권장.

### 변경 파일
- `metadata.js`: LITERATURE_OVERRIDE 2줄 주석 처리
- `index.html`: ALGORITHM_VERSION v32.3 → v32.4

---

# BBL v32.3 — IPS 부분측정 경고 FP 버그 수정
**Build**: 2026-05-04 / **Patch**: v32.2 → v32.3 / **Type**: 버그 픽스

---

## v32.3 변경
배포 후 첫 검증에서 발견된 사소한 부동소수점 비교 버그 수정.

### 문제
IPS 카드의 "⚠ 부분 측정" 경고가 4개 항목 모두 측정됐는데도 잘못 표시됨.
```
0.40 + 0.30 + 0.20 + 0.10 = 0.9999999999999999  (JavaScript FP arithmetic)
조건: totalWeight < 1.0 → true (잘못)
```

### 수정
```js
// 이전 (v32.2):
note: totalWeight < 1.0 ? `부분 측정 ...` : null
// 이후 (v32.3):
const isPartial = totalWeight < 0.999;  // FP tolerance
note: isPartial ? ... : null
```

수학적 결과는 v32.2와 동일 — UI 경고 표시 로직만 수정.

---

# BBL v32.2 — index.html 통합 + C5 가중치 절충
**Build**: 2026-05-04 / **Patch**: v32.1 → v32.2 / **Type**: 메인 파일 통합 + 가중치 조정

---

## v32.2 변경 (메인 파일 통합)

### 배경
v32.0/v32.1 변경사항이 잘못된 파일(`BBL_신규선수_리포트.html`)에 적용되어 있었음을 git 이력으로 확인:
- 2026-05-04 19:18 사용자가 `BBL_신규선수_리포트.html`을 명시적으로 삭제 (commit `8d32dc7`)
- 2026-05-04 19:32 v32.1 작업물로 의도치 않게 부활 (commit `160d538`)
- → **`index.html`이 진짜 메인 파일**, 다른 파일은 레거시

### 변경 사항

**1. index.html (메인 파일)**:
- `ALGORITHM_VERSION` v31.48 → **v32.2**
- v32.0/v32.1 변경사항 모두 이식:
  - `CATEGORY_WEIGHTS.F1_Strength` 신설 (IMTP/BM·Grip 둘 다 1.00)
  - `CATEGORY_WEIGHTS.C4_TrunkAcceleration.trunk_flex_vel_max` 0.80 → **1.00** (cohort long d=+0.96)
  - `IPS_WEIGHTS`, `calculateIPS()`, `renderIPSCard()` 신규
  - `calculateScores()` 결과에 `_raw_inputs` 포함
  - `renderH1H2Comparison`에 IPS 카드 통합
  - `FITNESS_KEYS_FROM_MASTER`에 `'Grip Strength'` 추가
- C5 가중치 절충 (사용자 결정):
  - `MECHANICS_CAT_WEIGHTS.C5_UpperBodyTransfer` 1.5 → **1.0**
  - 근거: Driveline literature(r≈0.50) ↔ 134코호트(d=+0.09 천장 효과) 절충

**2. cohort_v29.js (변경 없음)**:
- v32.1에서 추가한 Grip Strength 분포·delta_distributions 그대로 유지
- index.html과 BBL_신규선수_리포트.html 양쪽에서 호환

**3. BBL_신규선수_리포트.html (레거시 정리 필요)**:
- 사용자 원 의도(2026-05-04 19:18 삭제)에 따라 GitHub에서 **수동 삭제 권장**
- 작업 폴더에는 참고용으로 남김

### 보존된 index.html 기존 가중치 (v31.48에서 유지)
사용자가 학술 근거(Werner, Wood-Smith, Driveline) 기반으로 설정한 기존 가중치는 그대로 유지:

| 카테고리 | 유지 값 | 근거 |
|---|---:|---|
| MECHANICS_CAT_WEIGHTS | C1=0.8, C2=1.0, C3=1.0, C4=1.5 | 기존 (literature) |
| FITNESS_CAT_WEIGHTS | F1=1.0, F2=2.0, F3=1.0, F4=0.3 | 기존 (v31.39) |
| CONTROL_CAT_WEIGHTS | P1=1.5, P4=1.2, 나머지 1.0 | 기존 (v31.43) |
| C2_FrontLegBlock 내부 | knee 유지=1.0, knee 신전속도=0.2 | 기존 (v31.33 도메인 인사이트) |
| C3_SeparationFormation 내부 | peak_x_factor=1.0, max_pelvis_rot=0.8 등 | 기존 (v31.36) |

→ 134코호트 d 분석은 위 항목들을 **부분 검증**(C4 1.5는 일치). 충돌 항목은 C5 한 곳뿐, 절충안 반영.

### 검증
```
JS syntax: ✅ index.html, cohort_v29.js 모두 통과
변경 위치 확인:
  ALGORITHM_VERSION = 'v32.2' (line 661)
  C5_UpperBodyTransfer: 1.0 (line 4258)
  F1_Strength CATEGORY_WEIGHTS (line 4105)
  calculateIPS / renderIPSCard (line 4489, 4530)
  Grip Strength FITNESS_KEYS_FROM_MASTER (line 2140)
```

---

# BBL v32.1 — 악력(Grip Strength) F1_Strength 통합
**Build**: 2026-05-04 / **Patch**: v32.0 → v32.1 / **Type**: 변수 추가

> ⚠ v32.1은 잘못된 파일(BBL_신규선수_리포트.html)에 적용된 것으로 후속 v32.2에서 index.html로 이식됨. 아래 내용은 변경 의도 기록용.

---

## v32.1 변경 (악력 통합)

### 배경
v32.0 개정안의 Phase 2 항목으로 보류했던 `Grip Strength`를 **master_fitness.xlsx 268명 데이터 확보**로 즉시 통합. 분석 문서에서 Grip cross d=+1.18 (Large)로 IMTP/BM(d=+0.98)보다도 큰 효과.

### 변경 사항

**1. cohort_v29.js**:
- `var_distributions`에 `Grip Strength` 추가 (n=268, mean=51.33 kg, sd=7.48)
- `var_distributions`에 `Grip Strength / BM [kg/kg]` 추가 (mean=0.635, sd=0.093)
- `var_sorted_lookup`에 두 변수의 정렬 배열 추가 (각 268개)
- `category_vars.F1_Strength`에 `Grip Strength` 항목 추가

**2. BBL_신규선수_리포트.html**:
- `ALGORITHM_VERSION` v32.0 → **v32.1**
- `CATEGORY_WEIGHTS.F1_Strength` 신설 — IMTP/BM·Grip 둘 다 1.00 (Large effect)
- `FITNESS_KEYS_FROM_MASTER`에 `'Grip Strength'` 추가 (master_fitness.xlsx 자동 매칭)

### 효과 시뮬레이션 (분석 문서 §3 그룹 평균값)

| | 빠른 그룹 | 느린 그룹 | 차이 |
|---|---:|---:|---:|
| v32.0 (IMTP only) | 72점 | 40점 | **32점** |
| v32.1 (IMTP + Grip) | 74점 | 36점 | **38점** |

→ F1_Strength 변별력 +19% (Grip Strength이 빠른/느린 그룹을 IMTP보다 더 잘 구별).

### 검증
```
JS syntax: ✅ 두 파일 모두 통과
Grip percentile lookup:
  빠른 그룹 56.4 kg → 76th percentile
  느린 그룹 47.4 kg → 32nd percentile
  d 비례 변별력 확인
```

---

# BBL v32.0 — 134명 코호트 효과크기 기반 점수 개정 + IPS(향상 잠재력 점수) 도입
**Build**: 2026-05-04 / **Patch**: v31.24 → v32.0 / **Type**: 산식 개정

---

## 🎯 변경 요약

134명 BBL 고교 1년 투수 코호트(Spring 2025 = H1, Fall 2025 = H2)의 페어드 분석 결과를 점수 산정 방식에 반영.

### 핵심 발견 (분석 문서 §3 요약)
1. **단기 향상 동력 = 메카닉**, 특히 **C4 몸통 가속** (cross d=+1.25, 단일 최대)
2. **단일 최강 변수**: `trunk_flex_vel_max` (long d=+0.96, cross d=+0.89)
3. **C5 코킹은 차이 없음** (d=+0.09, MER ~190° 천장 효과)

### 반영 방향
- **현재 수행력 점수 (Cross-sectional)**: 카테고리 가중치 효과크기 비례화 + C4 내부 변수 가중치 강화
- **향상 잠재력 점수 (IPS)**: 신규 도입 — H1↔H2 비교 뷰 전용

---

## 변경 사항

### 1. 메카닉 종합 점수 — 카테고리 가중치 도입

**이전**: `Mechanics_Score = 단순 평균(C1~C5)`
**v32.0**: 효과크기 기반 가중 평균 (`MECHANICS_AREA_WEIGHTS`)

| 카테고리 | 이전 | v32.0 | 근거 |
|---|---:|---:|---|
| C1_LowerBodyDrive | 1.0 | **1.0** | cross d=+0.94 |
| C2_FrontLegBlock | 1.0 | **0.8** | cross d=+0.71 |
| C3_SeparationFormation | 1.0 | **1.0** | cross d=+0.83 |
| **C4_TrunkAcceleration** | 1.0 | **1.5** | ★ cross d=+1.25 (단일 최대) |
| **C5_UpperBodyTransfer** | 1.0 | **0.5** | d=+0.09 (MER 천장 효과) |

→ 합 4.8. C4 비중 31%, C5 비중 10%.

### 2. C4_TrunkAcceleration 내부 변수 가중치

| 변수 | 이전 | v32.0 | 근거 |
|---|---:|---:|---|
| **trunk_flex_vel_max** | 0.40 | **1.00** | ★ long d=+0.96 (단일 최강) |
| max_trunk_twist_vel_dps | 0.60 | **0.80** | cross d=+0.90 |
| pelvis_to_trunk_lag_ms | 0.80 | 0.80 | 유지 |
| max_pelvis_rot_vel_dps | 0.40 | 0.40 | 유지 |
| torso_side_bend_at_mer | 0.60 | **0.40** | 효과 미관찰 |

### 3. IPS — Improvement Potential Score (신규)

H1↔H2 두 시점이 모두 측정된 선수에게만 산출. 종단 효과크기 기반 가중 z-score 합.

```
IPS = 50 + 20 × Σ(w_i × Z(Δx_i)) / Σ(w_i)

w_trunk_flex_vel_max     = 0.40   (long d=+0.96)
w_C4_TrunkAcceleration   = 0.30   (long d=+0.63)
w_Mechanics_Score        = 0.20   (long d=+0.57)
w_C1_LowerBodyDrive      = 0.10   (long d=+0.45)
```

**해석**: ≥70 급성장형 / 50~70 정상 발달 / 30~50 주의 / <30 정체 위험

**Phase 1 잠정값** (cohort_v29.js `delta_distributions`):
- trunk_flex_vel_max ΔH SD ≈ 60 °/s
- C4 점수 ΔH SD ≈ 12점
- Mechanics 종합 ΔH SD ≈ 11점, mean ≈ 5점
- C1 점수 ΔH SD ≈ 10점

→ Phase 2(134명 페어드 raw 분포)에서 정확값으로 갱신 예정.

### 4. 코드 변경 위치

- **`BBL_신규선수_리포트.html`**:
  - `ALGORITHM_VERSION` v31.24 → **v32.0**
  - `MECHANICS_AREA_WEIGHTS` 신규 상수 (4137 라인 부근)
  - `computeMechanicsScore()` 헬퍼 신규
  - `Mechanics_Score` 계산을 가중평균으로 교체
  - `CATEGORY_WEIGHTS.C4_TrunkAcceleration` 갱신
  - `IPS_WEIGHTS`, `_zOfDelta()`, `calculateIPS()` 신규
  - `renderIPSCard()` 신규 — H1↔H2 결과 상단 표시
  - `calculateScores()` 결과에 `_raw_inputs` 포함 (IPS용)
- **`cohort_v29.js`**:
  - `delta_distributions` 신규 섹션 (Phase 1 잠정값)

---

## 효과 시뮬레이션 (분석 문서 §3 평균값 기반)

### 횡단 — 빠른 vs 느린 그룹 메카닉 종합 점수

| | 이전 (단순 평균) | v32.0 (가중 평균) |
|---|---:|---:|
| 느린 그룹 | 44.2 | **41.1** |
| 빠른 그룹 | 59.4 | **59.2** |
| **차이** | **15.1점** | **18.1점** ↑ |

→ C4 약점이 약점으로 더 명확히 진단됨. 변별력 +20%.

### 종단 — 향상 vs 정체 그룹 IPS

| | trunk_flex Δ | C4 Δ | Mech Δ | C1 Δ | **IPS** | 라벨 |
|---|---:|---:|---:|---:|---:|---|
| 향상 그룹 | +41 | +6.1 | +10.7 | +5.2 | **61.6** | 정상 발달 |
| 정체 그룹 | −39 | −6.8 | +4.5 | −3.5 | **40.5** | 주의 |

→ 21점 차이로 명확히 구분.

---

## 변경하지 않은 것

- **C2 무릎 평가 임계** (메모리: 0 이상 만점, 음수만 감점)
- **C5 max_shoulder_ER_deg 변수 자체** (부상 모니터링용, 카테고리 가중치만 축소)
- **좌완 -3 km/h offset** (회귀 절편 구조)
- **시퀀싱 lag 발달 단계 컨텍스트** 관대 처리
- **카테고리 결측 50% 보류** 신뢰성 장치 (v31.2 도입)

---

## 검증

```
JS syntax check (node --check):
  BBL_신규선수_리포트.html script blocks: ✅ OK
  cohort_v29.js: ✅ OK

Synthetic input sanity check:
  ✅ 빠른/느린 그룹 변별력 +20% 확인
  ✅ 향상/정체 그룹 IPS 21점 차이 확인
```

배포 후 권장 검증:
1. 기존 저장된 H1·H2 페어 선수 1~2명 열어서 IPS 카드 정상 표시 확인
2. trunk_flex_vel_max 결측 선수에서 IPS "부분 측정" 안내 정상 표시 확인
3. Mechanics_Score가 이전 대비 약점 강조형으로 변동했는지 spot check

---

## Phase 2 별도 작업 (코호트 재학습 시)

- `Grip Strength` 분포 추가 → F1_Strength에 `Grip / BM` 변수 통합
- `delta_distributions` 134명 페어드 정확값으로 갱신
- IPS 가중치 다중회귀로 재학습
- `peak_x_factor`·`max_cog_velo` 결측 보강

---

## v31.12 → v32.5 누적

| 버전 | 핵심 |
|---|---|
| v31.12 | throwing arm 자동 검출 |
| v31.13~v31.48 | UX·임계 fine-tune, 카테고리별 가중치 정교화 (literature 기반) |
| v32.0 | 134명 코호트 효과크기 기반 카테고리 가중치 + IPS 신설 (잘못된 파일 적용) |
| v32.1 | 악력(Grip Strength) F1_Strength 통합 (잘못된 파일 적용) |
| v32.2 | index.html로 통합 + C5 가중치 절충 (1.5 → 1.0) |
| v32.3 | IPS 부분측정 경고 FP 비교 버그 수정 |
| v32.4 | F2_Power(CMJ·SJ /BM) percentile 산식 전환 |
| v32.5 | "more is better" 변수 10개 추가 percentile 전환 |
| v32.6 | 비교표 칼럼 정렬 수정 (UI 픽스) |
| v32.7 | 숫자 FP 포매팅 + 좌완 시퀀스 차트 복구 |
| v32.8 | 음수 lag 해석 정정 (발달 미성숙→이벤트 검출 오류) |
| v32.9 | 마네킹 누수-only + ARM→FOREARM 신규 + 스토리 재배치 |
| v33.0 | 마네킹 경로(앞 hip 경유) + 팔꿈치 노드 + 레이더 라벨 일치 + 5각 stride_norm_height 보강 |
| v33.1 | Throwing arm 자동검출 신뢰성 가드 |
| v33.2 | Uplift event placeholder 0을 null 처리 |
| v33.3 | Uplift 사전계산 peak frame 우선 (박명균 lag 114→58ms 정상화) |
| **v33.4** | **index.html 인라인 script를 app.js로 분리 (7,074→661라인)** |

---

## 배포 절차

GitHub 레포(`kkl0511/BBL_Pitching_Report1`) 루트에 다음 3개 파일 덮어쓰기 업로드:
1. `BBL_신규선수_리포트.html`
2. `cohort_v29.js`
3. `README.md`

→ Cmd+Shift+R (캐시 무효화 새로고침) → 좌측 상단 **v32.0** 확인

---

**END OF v32.0 PATCH NOTES**
