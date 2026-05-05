# Theia Pitching Report v0.41

Theia 마커리스 + Qualisys 포스플레이트 측정 데이터로 야구 투수의 메카닉·제구·하체 효율을 분석하는 웹 앱.
**선수·코치가 바로 이해할 수 있는 야구 현장 용어로 작성된 리포트**.

---

## 무엇을 분석하나

### 1. 출력·전달·손실 (Output / Transfer / Leak)
- **출력** — 골반·몸통·팔이 만드는 회전 power, 어깨·팔꿈치 power
- **전달** — 골반→몸통→팔로 힘이 얼마나 잘 넘어가는가 (전달율 ETE)
- **손실** — 자세·정렬 불량으로 새는 에너지

### 2. 지면반력 (NewtForce 분석)
- **축발(뒷발)** 차고 나가기 + 누적 힘
- **디딤발(앞발)** 받쳐주기 + 누적 힘
- **하체 종합 효율 점수 (LHEI)** — 8개 지표 가중 평균
- **투수 유형 자동 진단**: 뒤에 처지는 / 앞으로 쏟아지는 / 잠깐만 미는 / 팔로 던지는 / 좌우로 새는

### 3. 동작 → 힘 전달 인과 분석
6개 인과 사슬로 "어떤 자세 결함이 어떤 힘 손실을 만들었는가" 시각화:
- 골반·몸통·팔 순서대로 이어가기
- 골반-상체 분리 (X-팩터)
- 앞발 받쳐주기 (블로킹)
- 앞발 착지 시점 몸통 자세
- 어깨 정렬 (외전·외회전)
- 골반 감속 (브레이크 걸기)

### 4. 제구 안정성
손목 위치·릴리스 높이·몸통 기울기 trial-to-trial SD

### 5. 부상 위험
팔꿈치·어깨 부담 (구속 대비 부하)

---

## 듀얼 평가 모드

- **고교 모드**: 고교 1학년 상위 10% (n=41) 실측 percentile 비교
- **프로 모드**: 문헌 + KBO 프로 측정 보정 (Theia markerless calibration)

---

## 데이터 형식 (c3d.txt)

Visual3D pipeline export. 두 형식 모두 지원:
- **46 컬럼 short 형식** (force-only sub-frame 포함, 1200Hz 포스플레이트)
- **87 컬럼 full 형식** (LANDMARK 손목 좌표 포함)

### 핵심 변수 (자동 추출)
- 골반·몸통·팔 회전속도 (Pelvis_Ang_Vel, Thorax_Ang_Vel, Pitching_Shoulder_Ang_Vel)
- X-factor (Trunk_wrt_Pelvis_Angle)
- Lead_Knee_Angle, Pitching_Shoulder_Angle, FP1/FP2 force plate
- Joint Power Scalar (R/L × Shoulder/Elbow/Hip/Knee 8개)
- Mechanical Energy (Pelvis, Trunk, R_Humerus)
- LANDMARK 손목 좌표 (R_WRIST/L_WRIST)
- 이벤트 라벨 (MaxKneeHeight, Footstrike, Max_Shoulder_Int_Rot, Release)

### 국민대 lab convention
- **FP2 = 축발 (뒷발)** — 시작부터 정적 weight
- **FP1 = 디딤발 (앞발)** — 앞발 착지 후 spike
- fps_force = 1200 Hz, T0 = lastKinTime − N_force/1200

---

## 사용법

1. https://kkl0511.github.io/Theia_Pitching_Report/ 접속
2. 평가 모드 선택 (고교 / 프로)
3. 선수 정보 입력 (체중·키·좌우투)
4. c3d.txt 업로드 (1개 trial 또는 여러 trial 일괄)
5. 분석 실행 → 리포트 자동 생성

---

## 리포트 구성 (12개 섹션)

1. 헤더 — 측정 구속 + 잠재 구속 4 카드
2. 라디아 차트 (체력·메카닉·제구)
3. 출력 vs 효율 4사분면 진단
4. 키네틱 체인 교육
5. 키네매틱 시퀀스 종형 곡선
6. 마네킹 + 6영역 통합 진단
7. 에너지 손실 종합 점수 (ELI)
8. **🔗 동작 결함 → 힘 전달 인과 분석** (6개 사슬)
9. **⚡ 골반→몸통→팔 전달율** (ETE)
10. **🦵 지면반력 (NewtForce 통합 분석)**
11. 결함 + 훈련 드릴
12. 종합 평가 + 추천 훈련

---

## 파일 목록

| 파일 | 역할 |
|---|---|
| `index.html` | 메인 UI (Step 1·2·3 흐름) |
| `theia_app.js` | c3d.txt 파서, 변수 산출, 점수 계산 (v0.36) |
| `theia_render.js` | 리포트 렌더링 (12개 섹션) |
| `theia_mannequin.js` | 마네킹 SVG + 종형 곡선 |
| `metadata_theia.js` | 변수 정의, 결함 임계, ELI 6영역, 피드백 템플릿 |
| `cohort_theia.js` | 듀얼 코호트 wrapper (HS percentile / Pro Gaussian) |
| `cohort_theia_hs_top10_v0.json` | 고교 1학년 상위 10% 실측 분포 |
| `cohort_theia_pro_v0.json` | KBO 프로 reference (Theia markerless 보정) |
| `kinetic_chain.gif` | 키네틱 체인 교육 애니메이션 |

---

## 변경 이력 (v0.22 ~ v0.36 핵심)

- **v0.22**: 자동 디지털 필터링 default OFF (이중 필터 회피)
- **v0.23**: Theia markerless 코호트 보정 + capped_higher / higher_abs polarity
- **v0.24**: FP1/FP2 GRF 파서 수정
- **v0.25**: LANDMARK 손목 좌표 추출
- **v0.27**: 사용자 피드백 7건 (마네킹 박스 위치, 잠재 구속 산식, 발달→발전 등)
- **v0.28**: 분절 에너지·관절 W⁺/W⁻·ETE 산출 (분절 간 전달율)
- **v0.29~v0.31**: GRF lab convention 고정 + force-only sub-frame 시간 매핑 (1200Hz)
- **v0.32**: 동작 결함 → 에너지 전달 인과 분석 섹션 추가
- **v0.33~v0.34**: GRF 섹션에 NewtForce 통합 분석 + LHEI + 자동 진단
- **v0.35**: GRF 섹션 야구 현장 용어 변환
- **v0.36**: 전체 리포트 야구 현장 용어 통일 (학술 인용 펼침 카드로 이동)
- **v0.37**: GRF 결측 fix (force-aware 시간 보간)
- **v0.38**: 결측 점검 + 11개 distribution 추가 + valAtTime 시간 보간 강화
- **v0.39**: jointPowerWork도 force-aware 통합 시계열 적용
- **v0.40**: 인과 분석 변수에 야구 의미 표시 (각 row 아래 "→ 야구 코칭 톤 설명")
- **v0.41**: 인과 카드 위치 교체 — 결과(좌) ← 원인(우)

---

## 분석 시스템

- **모션캡처**: Theia3D markerless + Qualisys
- **포스플레이트**: 1200 Hz
- **샘플 rate**: kinematic 300 Hz
- **시간 매핑**: T0 자동 추정 (force plate trigger 시점)

## 라이선스 / 출처

국민대학교 야구 바이오메카닉스 연구실 (KMU Biomechanics Lab) 자료용. 산식·해석은 NewtForce 공개 자료 + 학술 문헌 (Aguinaldo, Pryhoda, Slowik, Kageyama, Howenstein, MacWilliams 등)에 근거.
