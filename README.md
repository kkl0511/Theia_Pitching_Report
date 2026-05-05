# Theia Pitching Report v0.1

Theia + Qualisys 마커리스 + 지면반력 마운드 측정 데이터 기반 투수 메카닉·제구 분석 웹 앱.

## 분석 프레임 (Output / Transfer / Leak)

- **출력 (Output)** — 분절·관절이 만드는 절대 power
- **전달 (Transfer)** — 분절 간 에너지 흐름 효율 (lag·시퀀스·증폭)
- **누수 (Leak)** — 자세·정렬 불량으로 손실되는 에너지
- **제구 (Control)** — Trial-to-trial 일관성 (P1~P6)
- **부상 위험 (Injury)** — UCL·knee stress

## 듀얼 코호트

- **고교 모드** — 고교 1학년 상위 10% (n=41) 실측 percentile
- **프로 모드** — 문헌(Wood-Smith·Werner·ASMI) + Driveline elite Gaussian

## 사용법

1. https://kkl0511.github.io/Theia_Pitching_Report/ 접속
2. 평가 모드 선택 (고교/프로)
3. 선수 정보 입력 (체중·키·좌우투)
4. c3d.txt 업로드 (Visual3D pipeline export 형식)
5. 분석 실행

## 입력 c3d.txt 형식

Visual3D pipeline export 표준 — Tier 1 필수 컬럼만으로 시작 가능. 자세한 명세는 `Theia_Visual3D_export_template_v0.1.docx` 참조.
