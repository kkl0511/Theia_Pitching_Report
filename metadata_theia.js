/**
 * metadata_theia.js — Theia Pitching Report 변수·카테고리·임계
 *
 * 분석 프레임 ★:
 *   ① Output (출력)   — 각 분절·관절이 만드는 절대 power
 *   ② Transfer (전달) — 분절 간 에너지 흐름 효율 (lag, speedup, sequencing)
 *   ③ Leak (누수)     — 자세·정렬 불량으로 손실되는 에너지
 *
 * Exposes: window.TheiaMeta = { OTL_CATEGORIES, VAR_DEFS, KINETIC_FAULTS, getCategoryVars, getVarMeta }
 */
(function () {
  'use strict';

  // ════════════════════════════════════════════════════════════
  // 변수 정의 — 각 변수의 한글명·단위·polarity·분류·hint
  // ════════════════════════════════════════════════════════════
  const VAR_DEFS = {
    // ── ① Output 출력 ──
    'Pelvis_peak':          { name: '골반 회전 속도 peak', unit: 'deg/s', polarity: 'higher', cat: 'OUTPUT', hint: '단계 1 — 하체 회전 출력' },
    'Trunk_peak':           { name: '몸통 회전 속도 peak', unit: 'deg/s', polarity: 'higher', cat: 'OUTPUT', hint: '단계 4 — 몸통(코어) 회전 출력' },
    'Arm_peak':             { name: '어깨 내회전 속도 max (Shoulder IR vel)', unit: 'deg/s', polarity: 'higher', cat: 'OUTPUT', hint: '★ 공 가속 핵심 출력 — Pitching_Shoulder_Ang_Vel.Z (GH joint IR/ER vel)' },
    'shoulder_ir_vel_max':  { name: '어깨 내회전 속도 max (alias)', unit: 'deg/s', polarity: 'higher', cat: 'OUTPUT', hint: 'Arm_peak 동의어 — BBL Uplift 호환' },
    'humerus_segment_peak': { name: '상완 segment 회전 속도 max', unit: 'deg/s', polarity: 'higher', cat: 'OUTPUT', hint: 'Pitching_Humerus_Ang_Vel.Z (humerus 절대 각속도, GCS 기준)' },
    'trunk_forward_flexion_vel_peak': { name: '몸통 굴곡 속도 peak', unit: 'deg/s', polarity: 'higher', cat: 'OUTPUT', hint: 'Thorax_Ang_Vel.X (forward flexion 각속도) — 트렁크 자체 출력' },
    'trunk_rotation_at_fc': { name: 'FC 시 몸통 회전 (Flying Open)', unit: 'deg', polarity: 'higher', cat: 'TRANSFER', hint: 'Trunk_Angle.Z at FC — 양수 닫힘(좋음) / 음수 일찍 열림' },
    'Max_CoG_Velo':         { name: '무게중심 전진 속도 max', unit: 'm/s', polarity: 'higher', cat: 'OUTPUT', hint: '하체 추진의 선형 출력' },
    'Trail_leg_peak_vertical_GRF':   { name: 'Trail vGRF peak', unit: 'BW', polarity: 'higher', cat: 'OUTPUT', hint: '★ 단계 1 — 뒷다리 vertical push' },
    'Trail_leg_peak_AP_GRF': { name: 'Trail AP GRF peak', unit: 'BW', polarity: 'higher', cat: 'OUTPUT', hint: '뒷다리 forward push' },
    'Lead_leg_peak_vertical_GRF':    { name: 'Lead vGRF peak', unit: 'BW', polarity: 'higher', cat: 'OUTPUT', hint: '★ 단계 2 — 앞다리 block power' },
    'Lead_leg_peak_AP_GRF':  { name: 'Lead AP GRF peak', unit: 'BW', polarity: 'higher', cat: 'OUTPUT', hint: '앞다리 braking force' },
    'trail_impulse_stride': { name: 'Trail leg impulse', unit: 'BW·s', polarity: 'higher', cat: 'OUTPUT', hint: '뒷다리 stride 동안 운동량' },
    'Pitching_Shoulder_Power_peak': { name: '★ 어깨 power peak', unit: 'W', polarity: 'higher', cat: 'OUTPUT', hint: '어깨 관절 power 출력 (Tier 2)' },
    'Pitching_Elbow_Power_peak':    { name: '★ 팔꿈치 power peak', unit: 'W', polarity: 'higher', cat: 'OUTPUT', hint: '팔꿈치 power 출력' },
    'Lead_Hip_Power_peak':  { name: '★ Lead hip power peak', unit: 'W', polarity: 'higher', cat: 'OUTPUT', hint: '단계 1 lead hip 출력' },
    'Trail_Hip_Power_peak': { name: '★ Trail hip power peak', unit: 'W', polarity: 'higher', cat: 'OUTPUT', hint: '단계 1 trail hip 출력' },
    'Lead_Knee_Power_peak': { name: '★ Lead knee power peak', unit: 'W', polarity: 'higher', cat: 'OUTPUT', hint: '단계 2 block power' },
    'wrist_release_speed':  { name: '손목 릴리스 속도', unit: 'm/s', polarity: 'higher', cat: 'OUTPUT', hint: '★ 출력 통합 결과 (ball release proxy)' },

    // ── ② Transfer 전달 ──
    'pelvis_to_trunk':      { name: '골반→몸통 lag', unit: 'ms', polarity: 'absolute', cat: 'TRANSFER', hint: '★ 시퀀스 timing (optimal 45ms)' },
    'trunk_to_arm':         { name: '몸통→팔 lag', unit: 'ms', polarity: 'absolute', cat: 'TRANSFER', hint: '★ 시퀀스 timing (optimal 45ms)' },
    'pelvis_trunk_speedup': { name: '골반→몸통 speedup', unit: 'ratio', polarity: 'higher', cat: 'TRANSFER', hint: 'Trunk_peak / Pelvis_peak' },
    'arm_trunk_speedup':    { name: '몸통→팔 speedup', unit: 'ratio', polarity: 'higher', cat: 'TRANSFER', hint: '★ Arm_peak / Trunk_peak (elite 1.8~2.2)' },
    'angular_chain_amplification': { name: '★ 운동사슬 증폭률', unit: 'ratio', polarity: 'higher', cat: 'TRANSFER', hint: 'Arm_peak / Pelvis_peak (elite 2.5~3.5)' },
    'peak_xfactor':         { name: 'Peak X-factor', unit: 'deg', polarity: 'higher', cat: 'TRANSFER', hint: '분리 저장 (KH→FC stretch)' },
    'fc_xfactor':           { name: 'X-factor at FC', unit: 'deg', polarity: 'higher', cat: 'TRANSFER', hint: 'FC 시점 분리 자세' },
    'proper_sequence_binary': { name: '시퀀스 정상 (P-T-A)', unit: 'binary', polarity: 'higher', cat: 'TRANSFER', hint: 'Pelvis-Trunk-Arm 순서 = 1' },
    'trail_to_lead_vgrf_peak_s': { name: 'Trail→Lead 전환 시간', unit: 's', polarity: 'lower', cat: 'TRANSFER', hint: 'GRF 전환 timing' },
    'stride_to_pelvis_lag_ms': { name: 'FC→Pelvis peak lag', unit: 'ms', polarity: 'absolute', cat: 'TRANSFER', hint: 'block→회전 timing' },

    // ── ③ Leak 누수 ──
    'fc_trunk_forward_tilt': { name: 'FC 시점 몸통 앞기울기', unit: 'deg', polarity: 'absolute', cat: 'LEAK', hint: 'optimal -5° (직립~약간 뒤). 너무 굽으면 leak' },
    'br_lead_leg_knee_flexion': { name: 'BR 시점 앞무릎 굴곡', unit: 'deg', polarity: 'lower', cat: 'LEAK', hint: '★ 무릎 무너짐 = block 실패 = leak' },
    'lead_knee_ext_change_fc_to_br': { name: '앞무릎 신전 변화', unit: 'deg', polarity: 'higher', cat: 'LEAK', hint: 'FC→BR 신전(양수) 또는 무너짐(음수)' },
    'CoG_Decel':            { name: 'CoG 감속률', unit: 'm/s²', polarity: 'higher', cat: 'LEAK', hint: '★ 단계 2 block 강도 — 추진→회전 전환' },
    'peak_trunk_CounterRotation': { name: '와인드업 counter-rotation', unit: 'deg', polarity: 'higher', cat: 'LEAK', hint: '저장 자세 — 작으면 loading leak' },
    'mer_shoulder_abd':     { name: 'MER 시점 어깨 외전', unit: 'deg', polarity: 'absolute', cat: 'LEAK', hint: 'optimal 90~95° (★ 90° 벗어나면 부상·leak)' },
    'br_shoulder_abd':      { name: 'BR 시점 어깨 외전', unit: 'deg', polarity: 'absolute', cat: 'LEAK', hint: 'optimal 95° 유지' },
    'fc_shoulder_abd':      { name: 'FC 시점 어깨 외전', unit: 'deg', polarity: 'absolute', cat: 'LEAK', hint: 'optimal 90° (cocking 자세)' },
    'clawback_time':        { name: 'Clawback time', unit: 's', polarity: 'absolute', cat: 'LEAK', hint: '앞다리 추진 정체 시간' },

    // ── 메타 (참고용) ──
    'max_shoulder_ER':      { name: 'Max shoulder ER', unit: 'deg', polarity: 'higher', cat: 'INJURY', hint: '★ ROM (180~195° elite, 200°+ valgus 위험)' },
    'stride_length':        { name: 'Stride length', unit: 'cm', polarity: 'higher', cat: 'OUTPUT', hint: 'foot stride 길이' },
    'stride_length_pct':    { name: 'Stride length (% height)', unit: '%', polarity: 'higher', cat: 'OUTPUT', hint: '신장 대비 stride (Pro 85~95%)' },
    'fc_lead_leg_knee_flexion': { name: 'FC 시점 앞무릎 굴곡', unit: 'deg', polarity: 'absolute', cat: 'LEAK', hint: 'FC 시점 자세 (optimal 50°)' },
    'ball_speed':           { name: 'Ball speed', unit: 'km/h', polarity: 'higher', cat: 'OUTPUT', hint: '★ 출력 최종 결과 (radar gun)' },

    // ── P 카테고리 (제구 일관성, trial-to-trial SD) ──
    'P1_wrist_3D_SD':       { name: 'P1 손목 3D 위치 SD', unit: 'cm', polarity: 'lower', cat: 'CONTROL', hint: '★ 제구 일관성 핵심 (wrist X·Y·Z 결합 SD)' },
    'P2_arm_slot_SD':       { name: 'P2 Arm slot SD', unit: 'deg', polarity: 'lower', cat: 'CONTROL', hint: '슬롯 일관성' },
    'P3_release_height_SD': { name: 'P3 릴리스 높이 SD', unit: 'cm', polarity: 'lower', cat: 'CONTROL', hint: 'wrist Y SD' },
    'P4_mer_to_br_SD':      { name: 'P4 MER→BR 시간 SD', unit: 'ms', polarity: 'lower', cat: 'CONTROL', hint: '타이밍 일관성' },
    'P5_stride_SD':         { name: 'P5 Stride SD', unit: 'cm', polarity: 'lower', cat: 'CONTROL', hint: '발 위치 일관성' },
    'P6_trunk_tilt_SD':     { name: 'P6 몸통 기울기 SD', unit: 'deg', polarity: 'lower', cat: 'CONTROL', hint: '몸통 자세 일관성' },
  };

  // ════════════════════════════════════════════════════════════
  // 분석 프레임 카테고리 — Output / Transfer / Leak + Control + Injury
  // ════════════════════════════════════════════════════════════
  const OTL_CATEGORIES = {
    OUTPUT: {
      id: 'OUTPUT',
      name: '출력 (Output)',
      desc: '각 분절·관절이 만들어내는 절대 power',
      color: '#C00000',
      variables: [
        'Pelvis_peak', 'Trunk_peak', 'Arm_peak',
        'humerus_segment_peak', 'trunk_forward_flexion_vel_peak',
        'Max_CoG_Velo', 'wrist_release_speed',
        'Trail_leg_peak_vertical_GRF', 'Trail_leg_peak_AP_GRF', 'trail_impulse_stride',
        'Lead_leg_peak_vertical_GRF', 'Lead_leg_peak_AP_GRF',
        'Pitching_Shoulder_Power_peak', 'Pitching_Elbow_Power_peak',
        'Lead_Hip_Power_peak', 'Trail_Hip_Power_peak', 'Lead_Knee_Power_peak',
        'ball_speed',
      ],
      integration_var: 'ball_speed',
    },
    TRANSFER: {
      id: 'TRANSFER',
      name: '전달 (Transfer)',
      desc: '분절 간 에너지 흐름 효율 — 시퀀스·증폭·timing',
      color: '#0070C0',
      variables: [
        'pelvis_to_trunk', 'trunk_to_arm',
        'pelvis_trunk_speedup', 'arm_trunk_speedup', 'angular_chain_amplification',
        'peak_xfactor', 'fc_xfactor', 'trunk_rotation_at_fc',
        'proper_sequence_binary',
        'trail_to_lead_vgrf_peak_s', 'stride_to_pelvis_lag_ms',
      ],
      integration_var: 'angular_chain_amplification',
    },
    LEAK: {
      id: 'LEAK',
      name: '누수 (Leak)',
      desc: '자세·정렬 불량으로 손실되는 에너지',
      color: '#7030A0',
      variables: [
        'fc_trunk_forward_tilt',
        'br_lead_leg_knee_flexion', 'lead_knee_ext_change_fc_to_br',
        'CoG_Decel',
        'peak_trunk_CounterRotation',
        'mer_shoulder_abd', 'br_shoulder_abd', 'fc_shoulder_abd',
        'clawback_time',
        'fc_lead_leg_knee_flexion',
      ],
      integration_var: 'CoG_Decel',
    },
    CONTROL: {
      id: 'CONTROL',
      name: '제구 (Control)',
      desc: 'Trial-to-trial 일관성 (SD 지표)',
      color: '#2E7D32',
      variables: [
        'P1_wrist_3D_SD', 'P2_arm_slot_SD', 'P3_release_height_SD',
        'P4_mer_to_br_SD', 'P5_stride_SD', 'P6_trunk_tilt_SD',
      ],
      integration_var: 'P1_wrist_3D_SD',
    },
    INJURY: {
      id: 'INJURY',
      name: '부상 위험 (Injury)',
      desc: '출력의 비용 — UCL·knee stress',
      color: '#FF8C00',
      variables: [
        'max_shoulder_ER', 'mer_shoulder_abd', 'br_lead_leg_knee_flexion',
      ],
      integration_var: 'max_shoulder_ER',
    },
  };

  // ════════════════════════════════════════════════════════════
  // 키네틱 결함 검출 (Output/Transfer/Leak fault diagnostics)
  // ════════════════════════════════════════════════════════════
  const KINETIC_FAULTS = [
    {
      id: 'WeakTrailDrive',
      label: '뒷다리 추진 약함 (Output Leak)',
      severity: 'medium',
      detect: m => m.Trail_leg_peak_vertical_GRF != null && m.Trail_leg_peak_vertical_GRF < 1.4,
      cause: '단계 1 출력 부족 — 뒷다리 push power 부족',
      coaching: '뒷다리 신전 폭발력 강화. 단일 다리 점프, sled push',
    },
    {
      id: 'WeakLeadBlock',
      label: '앞다리 블록 약함 (Output Leak)',
      severity: 'high',
      detect: m => m.Lead_leg_peak_vertical_GRF != null && m.Lead_leg_peak_vertical_GRF < 1.8,
      cause: '단계 2 block 부족 — 앞다리 stiffness 약함',
      coaching: 'eccentric step-down, drop landing, single-leg ecc box jump',
    },
    {
      id: 'PoorSpeedupChain',
      label: '운동사슬 증폭 부족 (Transfer)',
      severity: 'high',
      detect: m => m.angular_chain_amplification != null && m.angular_chain_amplification < 1.8,
      cause: '골반→팔 에너지 증폭률 부족 — 분절별 출력 약함 또는 timing 불량',
      coaching: 'connected throw drill, plyo ball, 시퀀스 재학습',
    },
    {
      id: 'LateTrunkRotation',
      label: '몸통 회전 늦음 (Transfer)',
      severity: 'medium',
      detect: m => m.pelvis_to_trunk != null && Math.abs(m.pelvis_to_trunk * 1000) > 90,
      cause: '골반→몸통 lag 너무 김 — 시퀀스 불연결',
      coaching: '회전 메디신볼 throw, slow-fast contrast',
    },
    {
      id: 'FlyingOpen',
      label: '몸통 일찍 열림 (Leak)',
      severity: 'high',
      detect: m => m.fc_xfactor != null && m.fc_xfactor < 15,
      cause: 'FC 시점 분리 부재 — closed posture 못 유지',
      coaching: 'FC 거울 hold drill, hip dissociation',
    },
    {
      id: 'LeadKneeCollapse',
      label: '앞무릎 무너짐 (Leak)',
      severity: 'high',
      detect: m => m.lead_knee_ext_change_fc_to_br != null && m.lead_knee_ext_change_fc_to_br < -15,
      cause: 'block 다리 ecc 약함 — 회전 전환 실패',
      coaching: 'eccentric step-down 5초 hold, single-leg RDL',
    },
    {
      id: 'ExcessForwardTilt',
      label: '몸통 과도 앞기울기 (Leak)',
      severity: 'medium',
      detect: m => m.fc_trunk_forward_tilt != null && m.fc_trunk_forward_tilt > 15,
      cause: 'FC 시점 몸통 너무 굽음 — 회전 모멘트 손실',
      coaching: 'closed-posture cue, anti-flex 코어 보강',
    },
    {
      id: 'PoorBlock',
      label: 'COG 감속 부족 (Leak)',
      severity: 'medium',
      detect: m => m.CoG_Decel != null && m.CoG_Decel < 1.0,
      cause: '단계 2 block 약함 — 추진→회전 전환 비효율',
      coaching: 'stop-and-rotate drill, heavy ecc box jump',
    },
    {
      id: 'MERShoulderRisk',
      label: 'MER 시점 어깨 위험 자세 (Injury)',
      severity: 'high',
      detect: m => m.mer_shoulder_abd != null && (m.mer_shoulder_abd < 80 || m.mer_shoulder_abd > 110),
      cause: 'MER 시점 어깨 외전 90°에서 벗어남 — UCL stress 위험',
      coaching: 'MLB Pitch Smart 90° 유지 cue, scap stability',
    },
    {
      id: 'PoorReleaseConsistency',
      label: '릴리스 일관성 부족 (Control)',
      severity: 'medium',
      detect: m => m.P1_wrist_3D_SD != null && m.P1_wrist_3D_SD > 8,
      cause: 'Trial 간 손목 위치 변동 — 제구 불안정',
      coaching: '반복 폼 연습, 비디오 피드백',
    },
  ];

  // ════════════════════════════════════════════════════════════
  // Helpers
  // ════════════════════════════════════════════════════════════
  // ════════════════════════════════════════════════════════════
  // 제구 P 카테고리 fallback 점수표 (cohort에 분포 없을 때)
  //   임계: Driveline R&D · Werner & Fleisig 2009 · Murray 2001 기반
  //   polarity = 'lower' (모두 SD 변수 — 낮을수록 좋음)
  //   점수 = 100 (≤elite) → 75 (avg) → 50 (poor) → 0
  // ════════════════════════════════════════════════════════════
  const P_THRESHOLDS = {
    P1_wrist_3D_SD:       { elite: 5,  avg: 8,  poor: 12, unit: 'cm',  ref: 'Werner & Fleisig 2009 — elite ≤5 cm' },
    P2_arm_slot_SD:       { elite: 2,  avg: 5,  poor: 10, unit: 'deg', ref: 'Driveline R&D — slot variation 5° = avg' },
    P3_release_height_SD: { elite: 3,  avg: 5,  poor: 8,  unit: 'cm',  ref: 'Driveline — release height SD 3cm = elite' },
    P4_mer_to_br_SD:      { elite: 5,  avg: 10, poor: 20, unit: 'ms',  ref: 'Theia 측정 — timing SD 10ms = 발달 평균' },
    P5_stride_SD:         { elite: 3,  avg: 6,  poor: 10, unit: 'cm',  ref: 'Davis 2009 — foot position SD 6cm = avg HS' },
    P6_trunk_tilt_SD:     { elite: 2,  avg: 5,  poor: 10, unit: 'deg', ref: 'Murray 2001 — trunk tilt SD 5° = avg' },
  };

  // ────────────────────────────────────────────────────
  // 신규 변수 (v0.10) — 코호트 분포 없을 때 점수 산출용 임계
  // polarity = 'higher' (높을수록 좋음)
  // 점수 = 100 (≥elite) → 75 (avg) → 50 (poor) → 0
  // ────────────────────────────────────────────────────
  const HIGHER_THRESHOLDS = {
    humerus_segment_peak:           { elite: 7000, avg: 5400, poor: 4000, unit: 'deg/s', ref: 'Driveline R&D — humerus segment 7000°/s elite' },
    trunk_forward_flexion_vel_peak: { elite: 600,  avg: 400,  poor: 250,  unit: 'deg/s', ref: 'Stodden 2001 — trunk forward flexion 600°/s elite' },
    shoulder_ir_vel_max:            { elite: 7000, avg: 5500, poor: 3500, unit: 'deg/s', ref: 'Fleisig 2018 — shoulder IR vel 7240°/s elite (= Arm_peak 동의어)' },
  };

  // FC 시 몸통 회전: 양수=닫힘 좋음. -30~50 범위. 단순 polarity로 처리하면 좋음 'higher'
  // 임계: ≥10° = 닫힘 (정상) / 0~10 = 평균 / -20~0 = 미세 열림 / ≤-30 = Flying Open
  const SIGNED_THRESHOLDS = {
    trunk_rotation_at_fc: { elite: 10, avg: 0, poor: -20, unit: 'deg', ref: 'Aguinaldo 2007 — Flying Open <-30°' },
  };

  function pFallbackScore(varName, value) {
    const thr = P_THRESHOLDS[varName];
    if (!thr || value == null || isNaN(value)) return null;
    if (value <= thr.elite) return Math.min(100, 90 + (thr.elite - value) / thr.elite * 10);
    if (value <= thr.avg)   return Math.round(75 - (value - thr.elite) / (thr.avg - thr.elite) * 25);
    if (value <= thr.poor)  return Math.round(50 - (value - thr.avg)  / (thr.poor - thr.avg)  * 25);
    return Math.max(0, Math.round(25 - (value - thr.poor) / thr.poor * 25));
  }

  // higher-better 임계 fallback (값이 높을수록 좋음)
  function higherFallbackScore(varName, value) {
    const thr = HIGHER_THRESHOLDS[varName];
    if (!thr || value == null || isNaN(value)) return null;
    if (value >= thr.elite) return Math.min(100, 90 + Math.min(10, (value - thr.elite) / thr.elite * 10));
    if (value >= thr.avg)   return Math.round(75 - (thr.elite - value) / (thr.elite - thr.avg) * 25);
    if (value >= thr.poor)  return Math.round(50 - (thr.avg - value)   / (thr.avg - thr.poor)  * 25);
    return Math.max(0, Math.round(25 - (thr.poor - value) / thr.poor * 25));
  }

  // signed 임계 fallback (양수일수록 좋음, Flying Open 같은 변수)
  function signedFallbackScore(varName, value) {
    const thr = SIGNED_THRESHOLDS[varName];
    if (!thr || value == null || isNaN(value)) return null;
    if (value >= thr.elite) return Math.min(100, 90 + (value - thr.elite) / 20 * 10);
    if (value >= thr.avg)   return Math.round(75 - (thr.elite - value) / (thr.elite - thr.avg) * 25);
    if (value >= thr.poor)  return Math.round(50 - (thr.avg - value)   / (thr.avg - thr.poor)  * 25);
    return Math.max(0, Math.round(25 - (thr.poor - value) / 30 * 25));
  }

  // 통합 fallback — varName으로 어떤 임계표를 쓸지 자동 판단
  function getFallbackScore(varName, value) {
    if (P_THRESHOLDS[varName])      return pFallbackScore(varName, value);
    if (HIGHER_THRESHOLDS[varName]) return higherFallbackScore(varName, value);
    if (SIGNED_THRESHOLDS[varName]) return signedFallbackScore(varName, value);
    return null;
  }

  // ════════════════════════════════════════════════════════════
  // 변수별 세부 설명 (expand 카드용)
  // ════════════════════════════════════════════════════════════
  const VAR_DETAILS = {
    Pelvis_peak: {
      formula: 'Pelvis_Ang_Vel.Z 시계열 KH→BR 구간 max |abs|',
      threshold: 'Elite ≥800°/s · HS Top 10% mean ~640°/s · 발달 ~500°/s',
      mlb_avg: '720°/s (MLB Combine)',
      coaching: '뒷다리 push + hip rotation의 폭발력. 골반 회전 속도 부족 시 trunk·arm 출력 baseline 부족.',
      drill: 'Med ball rotational throws 3×8, Hip rotation 90/90 holds, Single-leg cable rotation',
    },
    Trunk_peak: {
      formula: 'Thorax_Ang_Vel.Z 시계열 max |abs|',
      threshold: 'Elite ≥1100°/s · HS Top 10% ~825°/s · 발달 ~700°/s',
      mlb_avg: '1100°/s (Werner 2008)',
      coaching: '몸통 회전 출력 — pelvis 에너지를 증폭해서 arm으로 전달하는 핵심.',
      drill: 'Anti-rotation core (Pallof press), 메디신볼 rotational throw, Connected throw',
    },
    Arm_peak: {
      formula: 'Pitching_Shoulder_Ang_Vel.Z 시계열 max |abs| (★ 어깨 IR/ER 각속도, GH joint, ≠ humerus segment)',
      threshold: 'Elite ≥7000°/s · HS Top 10% ~4716°/s · 발달 ~3500°/s',
      mlb_avg: '7240°/s (Fleisig 2018) — same as shoulder_ir_vel_max',
      coaching: '★ Shoulder IR vel max 동일 변수. release 직전 humerus internal rotation 가속 = 구속 결정 핵심.',
      drill: 'Plyo ball reverse throws, Sleeper stretch, Layback drill',
    },
    shoulder_ir_vel_max: {
      formula: 'Arm_peak alias — Pitching_Shoulder_Ang_Vel.Z 시계열 max',
      threshold: 'Elite ≥7000°/s · 평균 5500°/s',
      mlb_avg: '7240°/s (Fleisig 2018)',
      coaching: 'BBL Uplift 호환 변수명. 실체는 Arm_peak와 동일.',
      drill: 'Arm_peak 참고',
    },
    humerus_segment_peak: {
      formula: 'Pitching_Humerus_Ang_Vel.Z 시계열 max |abs| (★ humerus segment GCS 절대 각속도)',
      threshold: 'Elite ≥7000°/s · 평균 5500°/s · 부족 <4000°/s',
      mlb_avg: '6800°/s (Driveline)',
      coaching: 'Arm_peak (= shoulder IR vel)와 다른 변수. humerus segment 자체의 GCS 회전 — release 동시 trunk-relative + global motion 합산.',
      drill: 'Plyo ball positional throws, 회전 반발 drill',
    },
    trunk_forward_flexion_vel_peak: {
      formula: 'Thorax_Ang_Vel.X 시계열 max |abs| (frontal axis = forward flexion 각속도)',
      threshold: 'Elite ≥600°/s · 평균 400°/s · 부족 <250°/s',
      mlb_avg: '~620°/s (Stodden 2001)',
      coaching: '몸통 굴곡 출력 — 회전(Z축)뿐 아니라 굴곡(X축) 속도가 release momentum에 기여. Trunk flexion power.',
      drill: 'Anti-extension core (deadbug, hollow body), 메디신볼 overhead slam',
    },
    trunk_rotation_at_fc: {
      formula: 'Trunk_Angle.Z at FC (foot contact) — 양수 = 닫힘, 음수 = 일찍 열림',
      threshold: '닫힘 ≥+10° elite · 0~+10 평균 · -20~0 미세 열림 · ≤-30 Flying Open',
      mlb_avg: '+15° (Aguinaldo 2007)',
      coaching: 'FC 시점 몸통 절대 회전 각도. 일찍 열리면 X-factor 분리·trunk 가속 launchpad 모두 손실.',
      drill: 'KH→FC 닫힘 hold (3초), Hip-shoulder dissociation 3×8, Mirror feedback',
    },
    pelvis_to_trunk: {
      formula: 'Trunk peak time − Pelvis peak time (s)',
      threshold: 'Optimal 30~60ms · <20=동시 회전 (출력 손실) · >90=시퀀스 단절',
      mlb_avg: '45ms (Aguinaldo 2007)',
      coaching: 'Proximal-to-distal 시퀀싱의 첫 lag. 키네틱 체인 효율 ratio 결정.',
      drill: 'Connected throw (느린→빠른), 메디신볼 rotational + delay, Hip-shoulder dissociation',
    },
    trunk_to_arm: {
      formula: 'Arm peak time − Trunk peak time (s)',
      threshold: 'Optimal 30~60ms · <20=팔 동기 회전 · >90=시퀀스 끊김',
      mlb_avg: '40ms (Stodden 2001)',
      coaching: 'Trunk acceleration이 arm 가속 launch pad. lag 짧으면 arm 단독 출력.',
      drill: 'Connected throw with delay, Plyo ball positional throws',
    },
    angular_chain_amplification: {
      formula: 'Arm_peak / Pelvis_peak (ratio)',
      threshold: 'Elite 2.5~3.5 · HS 2.0=평균 · <1.5=증폭 부족',
      mlb_avg: '3.0 (Werner 2008)',
      coaching: '전체 사슬 증폭률 — 골반→손목 에너지 증폭도.',
      drill: 'Sequential throwing drill, Plyo ball med→light progression',
    },
    fc_xfactor: {
      formula: 'Trunk_wrt_Pelvis_Angle.Z at FC',
      threshold: 'Elite ≥30° · 평균 20° · <5° = Flying Open',
      mlb_avg: '38° (Fleisig 2018)',
      coaching: 'FC 시점 분리 자세 = X-factor stretch. 분리 클수록 회전 저장 에너지 큼.',
      drill: 'KH pause drill (3초 hold), Hip-shoulder dissociation',
    },
    peak_xfactor: {
      formula: 'Trunk_wrt_Pelvis_Angle.Z 시계열 KH→FC 구간 max',
      threshold: 'Elite ≥45° · 평균 35°',
      mlb_avg: '52° (Werner 2008)',
      coaching: '분리 자세 최대치 — 코킹 단계 stretch reflex 활용도.',
      drill: 'Counter-rotation hold drill, Plyo wall throw with twist',
    },
    Trail_leg_peak_vertical_GRF: {
      formula: 'Trail_Leg_GRF.Z peak / (mass × 9.81), KH→FC',
      threshold: 'Elite ≥1.8 BW · 평균 1.5 · <1.2 = 추진 부족',
      mlb_avg: '1.7 BW (Driveline)',
      coaching: '뒷다리 vertical push — 키네틱 체인 시작점.',
      drill: 'Single-leg vertical jump 3×6, Sled push 5×20m, Trap bar deadlift 3×5',
    },
    Lead_leg_peak_vertical_GRF: {
      formula: 'Lead_Leg_GRF.Z peak / (mass × 9.81), FC→BR',
      threshold: 'Elite ≥2.5 BW · 평균 2.0 · <1.5 = block 약함',
      mlb_avg: '2.3 BW (MacWilliams 1998)',
      coaching: '앞다리 block — 추진 → 회전 전환 효율. block 강할수록 trunk 가속 큼.',
      drill: 'Eccentric step-down 3×8 (5초 hold), Drop landing 3×6, Single-leg ecc box jump',
    },
    fc_trunk_forward_tilt: {
      formula: 'Trunk_Angle.X at FC',
      threshold: 'Optimal 0~10° · >15° = 과도 굽힘 · <-5° = 뒤로 젖힘',
      mlb_avg: '5° (Stodden 2001)',
      coaching: 'FC 자세 = 회전축. 과도 굽힘 시 axis 흔들려 회전 효율 저하.',
      drill: 'Anti-flexion plank 3×60s, Closed-posture cue, Mirror feedback',
    },
    br_lead_leg_knee_flexion: {
      formula: 'Pitching_Knee_Angle.X at BR',
      threshold: 'Optimal ≤25° · 30~50°=평균 · >50°=무릎 무너짐',
      mlb_avg: '20° (Werner 2008)',
      coaching: 'BR 시점 앞무릎 = 회전 안정성. 무너지면 efficient 손실.',
      drill: 'Single-leg eccentric squat, Drop landing hold, Single-leg RDL',
    },
    lead_knee_ext_change_fc_to_br: {
      formula: '(BR knee ext) − (FC knee ext) °',
      threshold: 'Elite +5° (펴짐) · 0°=유지 · -10°=무너짐 · -22°=심각',
      mlb_avg: '+3° (Driveline)',
      coaching: '앞다리 ecc → con 전환 — 무너지지 않고 펴면 block 성공.',
      drill: 'Eccentric step-down (5초 hold), Heavy ecc box jump, Stop-and-rotate',
    },
    max_shoulder_ER: {
      formula: '|min(Pitching_Shoulder_Angle.Z)| FC→BR',
      threshold: 'Elite 175~190° · <160°=가동 부족 · >195°=부상 위험',
      mlb_avg: '183° (Fleisig 2018)',
      coaching: '어깨 외회전 max = layback. 부족 시 출력 감소, 과다 시 UCL stress.',
      drill: 'Sleeper stretch 3×30s, PNF rotator cuff, Layback drill (gentle)',
    },
    mer_shoulder_abd: {
      formula: 'Pitching_Shoulder_Angle.X at MER',
      threshold: 'Optimal 90~100° (MLB Pitch Smart) · <80·>110 = 부상 위험',
      mlb_avg: '95° (MLB Pitch Smart)',
      coaching: 'MER 시점 어깨 외전 90° = 안전 자세. 벗어나면 GH joint stress.',
      drill: '90/90 hold drill, Mirror feedback, Pitch Smart cueing',
    },
    Pitching_Shoulder_Power_peak: {
      formula: 'Joint Power = Torque × Angular velocity (W)',
      threshold: 'Elite ≥1500W · 평균 1000W · <500W=출력 부족',
      mlb_avg: '1500W (Driveline R&D)',
      coaching: '어깨 power = 진짜 출력 (토크 결합).',
      drill: 'Plyo ball reverse, Sleeper + ER strengthening, Med ball overhead',
    },
    Pitching_Elbow_Power_peak: {
      formula: 'Joint Power = Torque × Angular velocity (W)',
      threshold: '정상 200~500W · >500W = UCL stress · <200W = 전달 부족',
      mlb_avg: '350W (Driveline)',
      coaching: '팔꿈치 power 과다 = trunk 출력 부족 + arm 의존 (UCL stress 신호).',
      drill: 'Trunk power 강화 (medball rotational), Sleeper stretch, Volume monitor',
    },
    P1_wrist_3D_SD: {
      formula: '√(SD_X² + SD_Y² + SD_Z²) × 100 cm',
      threshold: 'Elite ≤5cm · 평균 8cm · >12cm = 일관성 부족',
      mlb_avg: '4.5 cm (Werner 2009)',
      coaching: 'Trial 간 손목 3D 위치 변동 = 제구 일관성 가장 직접 지표.',
      drill: '반복 폼 (mirror), Target throw 5×10, 비디오 frame-by-frame 분석',
    },
    P3_release_height_SD: {
      formula: 'SD(wrist Y at BR) × 100 cm',
      threshold: 'Elite ≤3cm · 평균 5cm · >8cm = 높이 변동',
      mlb_avg: '2.8 cm (Driveline)',
      coaching: 'release 높이 SD 크면 공 궤적 일관성 저하.',
      drill: 'Mirror drill, Target throw with height feedback',
    },
    P4_mer_to_br_SD: {
      formula: 'SD(BR_time − MER_time) × 1000 ms',
      threshold: 'Elite ≤5ms · 평균 10ms · >20ms = 타이밍 변동',
      mlb_avg: '6 ms (Theia 측정)',
      coaching: 'MER→BR 시간 SD = 운동사슬 타이밍 안정성.',
      drill: 'Tempo throw drill (1-2-3 count), Connected throw with metronome',
    },
    P5_stride_SD: {
      formula: 'SD(stride_length) cm',
      threshold: 'Elite ≤3cm · 평균 6cm · >10cm = 발 위치 변동',
      mlb_avg: '3.2 cm (Davis 2009)',
      coaching: '발 위치 SD = 시동 자세 일관성.',
      drill: 'Stride mat drill, Mound work 반복, Foot placement feedback',
    },
    P6_trunk_tilt_SD: {
      formula: 'SD(fc_trunk_forward_tilt) °',
      threshold: 'Elite ≤2° · 평균 5° · >10° = 자세 변동',
      mlb_avg: '2.5° (Murray 2001)',
      coaching: 'FC 시점 몸통 기울기 SD = 자세 일관성.',
      drill: 'Mirror drill, FC 자세 hold (3초), 비디오 angle 분석',
    },
  };

  function getVarDetail(varName) { return VAR_DETAILS[varName] || null; }

  // ════════════════════════════════════════════════════════════
  // Integrated Energy Leak Index (ELI) — PDF 프레임워크 v0.12
  //   Aguinaldo & Escamilla 2019, Pryhoda & Sabick 2022,
  //   Naito 2021, Putnam 1993, Fleisig 2012 기반
  //
  //   ELI 효율 점수 = Σ wₖ × LeakScoreₖ (100점 만점, 높을수록 효율적)
  //   영역별 LeakScore = 메카닉 6축 점수 + INJURY 안전도
  // ════════════════════════════════════════════════════════════
  const ELI_AREAS = [
    { id: 'lower_drive',  name: '하체 추진',          weight: 15,
      mech_idx: 0,  // 메카닉 6축 #1
      desc: 'drive-leg impulse, COM velocity, stride momentum',
      leak_when_low: '전방 이동 에너지 생성 부족' },
    { id: 'lead_block',   name: '앞다리 블로킹',      weight: 20,  // ★ 가중치 최대
      mech_idx: 1,
      desc: 'braking impulse, vertical GRF, lead knee flexion change',
      leak_when_low: '전방 이동을 회전으로 전환 못함' },
    { id: 'pelvis_trunk', name: '골반-몸통 연결',    weight: 20,  // ★ 가중치 최대
      mech_idx: 2,
      desc: 'hip-shoulder separation, pelvis-trunk delay, FC trunk rotation',
      leak_when_low: '상체 조기 회전 또는 분리 부족' },
    { id: 'trunk_power',  name: '몸통 파워',          weight: 15,
      mech_idx: 3,
      desc: 'trunk angular velocity, trunk forward flexion, deceleration',
      leak_when_low: '몸통이 에너지원·전달원 역할 못함' },
    { id: 'arm_transfer', name: '팔 전달',            weight: 15,
      mech_idx: 4,
      desc: 'upper arm-forearm peak sequence, MER timing, ER',
      leak_when_low: '팔 속도 피크 순서 오류' },
    { id: 'load_eff',     name: '부하 대비 효율',     weight: 15,
      from_injury: true,  // INJURY 카테고리 안전도 사용
      desc: 'elbow valgus torque / ball speed, shoulder torque / ball speed',
      leak_when_low: '팔 보상형 투구 가능성 (UCL stress↑)' },
  ];

  const ELI_GRADES = [
    { min: 85, label: '에너지 전달 우수',   feedback: '현재 패턴 유지, 세부 타이밍 조정',                         color: '#16a34a' },
    { min: 70, label: '경미한 리크',         feedback: '한두 구간의 세부 보완',                                    color: '#22d3ee' },
    { min: 55, label: '특정 구간 리크 존재', feedback: '하체-몸통 또는 몸통-팔 연결 훈련 필요',                     color: '#fb923c' },
    { min: 40, label: '전달 효율 저하',      feedback: '블로킹·회전 타이밍·팔 보상 동시 점검',                      color: '#f87171' },
    { min: 0,  label: '팔 보상 가능성 큼',   feedback: '구속 증가보다 효율과 부하 관리 우선 (volume cap, arm care)', color: '#dc2626' },
  ];

  function getELIGrade(score) {
    // ★ v0.18.1 — score null이어도 fallback 객체 반환 (.color 접근 시 에러 방지)
    if (score == null) return { min: 0, label: '미평가', feedback: '데이터 부족', color: '#94a3b8' };
    return ELI_GRADES.find(g => score >= g.min) || ELI_GRADES[ELI_GRADES.length - 1];
  }

  // 리크 위치별 선수 피드백 문장 (PDF 표 10 기반)
  const ELI_FEEDBACK_TEMPLATES = {
    lead_block: {
      diagnosis: '착지 후 앞무릎이 계속 굴곡되면서 몸이 홈플레이트 방향으로 흘러갑니다. 전방 이동 에너지가 회전 에너지로 바뀌지 못하고, 골반·몸통 회전이 늦어지는 패턴이 나타납니다.',
      training: 'lead-leg block drill, stride stabilization, deceleration control',
    },
    pelvis_trunk: {
      diagnosis: '앞발 착지 전에 상체가 먼저 열리면서 골반-몸통 분리가 충분히 만들어지지 않습니다. 하체에서 만든 에너지를 몸통에 저장하기 전에 팔이 먼저 나가는 경향이 있습니다.',
      training: 'delayed trunk rotation drill, separation awareness, med-ball sequencing',
    },
    arm_transfer: {
      diagnosis: '몸통 회전속도 피크 이후 팔 속도가 순차적으로 증가해야 하지만, 몸통 감속과 팔 가속의 연결이 약해 팔이 독립적으로 공을 끌고 가는 보상 패턴이 나타납니다.',
      training: 'trunk deceleration drill, scap·arm timing, connection drill',
    },
    load_eff: {
      diagnosis: '구속에 비해 팔꿈치 또는 어깨 부하 지표가 높습니다. 하체와 몸통에서 충분히 전달되지 않은 에너지를 팔이 보상하고 있을 가능성이 있습니다.',
      training: 'velocity cap, arm-care, lower-body·trunk efficiency before max effort',
    },
    lower_drive: {
      diagnosis: '뒷다리에서 만들어지는 추진 에너지(drive-leg impulse, COM 전진 속도)가 부족합니다. 이후 단계의 회전 체인이 약해질 수 있는 시작점입니다.',
      training: 'sled push, single-leg vertical jump, trap bar deadlift',
    },
    trunk_power: {
      diagnosis: '몸통 회전속도와 굴곡 출력이 부족하여 trunk가 에너지원·전달원 역할을 충분히 못하고 있습니다.',
      training: 'med-ball rotational throw, anti-rotation core, connected throw',
    },
  };

  // 참고문헌 (PDF 12 페이지)
  const ELI_REFERENCES = [
    { id: 1, authors: 'Aguinaldo, A., & Escamilla, R.', year: 2019,
      title: 'Segmental Power Analysis of Sequential Body Motion and Elbow Valgus Loading During Baseball Pitching: Comparison Between Professional and High School Baseball Players',
      journal: 'Orthopaedic Journal of Sports Medicine, 7(2)',
      doi: '10.1177/2325967119827924' },
    { id: 2, authors: 'Pryhoda, M. K., & Sabick, M. B.', year: 2022,
      title: 'Lower body energy generation, absorption, and transfer in youth baseball pitchers',
      journal: 'Frontiers in Sports and Active Living, 4, 975107',
      doi: '10.3389/fspor.2022.975107' },
    { id: 3, authors: 'Naito, K., Takagi, T., Kubota, H., & Maruyama, T.', year: 2021,
      title: 'Time-varying motor control strategy for proximal-to-distal sequential energy distribution: insights from baseball pitching',
      journal: 'Journal of Experimental Biology, 224(20), jeb227207',
      doi: '10.1242/jeb.227207' },
    { id: 4, authors: 'Putnam, C. A.', year: 1993,
      title: 'Sequential motions of body segments in striking and throwing skills: descriptions and explanations',
      journal: 'Journal of Biomechanics, 26(Suppl. 1), 125-135',
      doi: null },
    { id: 5, authors: 'Fleisig, G. S., & Andrews, J. R.', year: 2012,
      title: 'Prevention of elbow injuries in youth baseball pitchers',
      journal: 'Sports Health, 4(5), 419-424',
      doi: null },
  ];

  function getCategoryVars(catId) {
    return OTL_CATEGORIES[catId]?.variables || [];
  }
  function getVarMeta(varName) {
    return VAR_DEFS[varName] || null;
  }

  window.TheiaMeta = { OTL_CATEGORIES, VAR_DEFS, KINETIC_FAULTS,
                       P_THRESHOLDS, HIGHER_THRESHOLDS, SIGNED_THRESHOLDS, VAR_DETAILS,
                       ELI_AREAS, ELI_GRADES, ELI_FEEDBACK_TEMPLATES, ELI_REFERENCES,
                       getCategoryVars, getVarMeta, getVarDetail, getELIGrade,
                       pFallbackScore, higherFallbackScore, signedFallbackScore, getFallbackScore };
})();
