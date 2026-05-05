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
    'Arm_peak':             { name: '상완 IR/ER 속도 peak', unit: 'deg/s', polarity: 'higher', cat: 'OUTPUT', hint: '★ 공 가속 핵심 출력 (humerus IR vel)' },
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
        'peak_xfactor', 'fc_xfactor',
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
  function getCategoryVars(catId) {
    return OTL_CATEGORIES[catId]?.variables || [];
  }
  function getVarMeta(varName) {
    return VAR_DEFS[varName] || null;
  }

  window.TheiaMeta = { OTL_CATEGORIES, VAR_DEFS, KINETIC_FAULTS, getCategoryVars, getVarMeta };
})();
