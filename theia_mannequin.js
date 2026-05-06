/**
 * theia_mannequin.js — 마네킹 + 종형 곡선 동적 SVG (Theia v0.7+)
 *
 * 의존: window.TheiaApp (ALGORITHM_VERSION만 사용 — 마네킹 라벨용)
 * 입력: result 객체 (varScores·catScores 포함)
 * 노출: window.TheiaMannequin = { renderMannequinUplift, renderKinematicBellUplift }
 *
 * BBL Uplift_Pitching_Report와 동일한 dynamic SVG (gradient pipe + animated dashes
 *   + glow filter + leak burst + animateMotion 입자 + glowing peak markers)
 */
(function () {
  'use strict';

  // v0.6 — BBL Uplift 동일 동적 마네킹 + 종형 곡선
  // ════════════════════════════════════════════════════════════

  // ── 마네킹 (BBL Uplift dynamic SVG, Theia 변수 매핑) ──
  // 통합 표시: 키네틱 체인 흐름 + GRF (양 발) + 팔꿈치 토크/파워 + lag·결함 라벨
  // 에너지 흐름은 Joint Power 흐름 기반 (Trail GRF → Trail Hip P → Pelvis P → Trunk P → Shoulder P → Elbow P → Wrist V)
  function _renderMannequinUplift(result) {
    const m = result.varScores || {};
    const v = (k) => m[k]?.value;
    const sc = (k) => m[k]?.score;

    // ── 1. lag → ETI 변환 (BBL Uplift 동일) ──
    function lagToETI(lag) {
      if (lag == null) return null;
      if (lag < 0) return 0;
      if (lag >= 20 && lag <= 80) return 1.0;
      if (lag < 20) return Math.max(0.4, lag / 20 * 0.85);
      if (lag <= 120) return Math.max(0.5, 1.0 - (lag - 80) / 40 * 0.5);
      return 0.4;
    }
    // Theia: pelvis_to_trunk·trunk_to_arm는 초 단위 → ms 변환
    const ptLagSec = v('pelvis_to_trunk');
    const taLagSec = v('trunk_to_arm');
    const ptLag = ptLagSec != null ? Math.round(ptLagSec * 1000) : null;
    const taLag = taLagSec != null ? Math.round(taLagSec * 1000) : null;
    const etiPT = lagToETI(ptLag);
    const etiTA = lagToETI(taLag);
    const ptLeak = etiPT != null && etiPT < 0.85;
    const taLeak = etiTA != null && etiTA < 0.85;
    const ptSevere = ptLag != null && (ptLag < -30 || ptLag > 90);
    const taSevere = taLag != null && (taLag < -30 || taLag > 90);
    const ptColor = !ptLeak ? '#60a5fa' : (ptSevere ? '#ef4444' : '#f59e0b');
    const taColor = !taLeak ? '#2563EB' : (taSevere ? '#ef4444' : '#f59e0b');
    const ptTextColor = !ptLeak ? '#6B6357' : (ptSevere ? '#ef4444' : '#fcd34d');
    const taTextColor = !taLeak ? '#6B6357' : (taSevere ? '#fca5a5' : '#fcd34d');

    // ── 2. Drive leg (Trail) status — Theia: vGRF + Trail Hip Power ──
    const trailVGRF = v('Trail_leg_peak_vertical_GRF');
    const trailHipP = v('Trail_Hip_Power_peak');
    let driveStatus = 'na';
    if (trailVGRF != null) {
      driveStatus = trailVGRF >= 1.5 ? 'normal' : (trailVGRF >= 1.2 ? 'weak' : 'leak');
    } else if (trailHipP != null) {
      driveStatus = trailHipP >= 800 ? 'normal' : (trailHipP >= 500 ? 'weak' : 'leak');
    }
    const driveColors = {
      normal: { stop1: '#22d3ee', stop2: '#3b82f6', label: '#3b82f6', text: '✓ 추진 양호' },
      weak:   { stop1: '#fde68a', stop2: '#f59e0b', label: '#f59e0b', text: '△ 추진 약함' },
      leak:   { stop1: '#fca5a5', stop2: '#ef4444', label: '#ef4444', text: '⚠ 추진 부족' },
      na:     { stop1: '#3F3F46', stop2: '#3F3F46', label: '#3F3F46', text: '데이터 없음' },
    }[driveStatus];

    // ── 3. Lead leg block — vGRF + knee collapse ──
    const leadVGRF = v('Lead_leg_peak_vertical_GRF');
    const kneeChange = v('lead_knee_ext_change_fc_to_br');
    const kneeCollapse = kneeChange != null && kneeChange < -10;
    const kneeCollapseSevere = kneeChange != null && kneeChange < -22;

    // ── 4. Flying open (X-factor at FC) ──
    const xFactor = v('fc_xfactor');
    const flyingOpen = xFactor != null && xFactor < 5;

    // ── 5. ★ 던지는 팔 토크/파워 (Pitching_Elbow_Power_peak) ──
    const elbowP = v('Pitching_Elbow_Power_peak');
    const shoulderP = v('Pitching_Shoulder_Power_peak');
    // 팔꿈치 power가 너무 높으면 UCL stress 위험 (>500W high)
    let elbowStatus = 'na';
    if (elbowP != null) {
      if (elbowP > 500) elbowStatus = 'high';   // UCL stress 위험
      else if (elbowP > 200) elbowStatus = 'normal';
      else elbowStatus = 'low';
    }
    const elbowColor = elbowStatus === 'high' ? '#ef4444' : elbowStatus === 'low' ? '#f59e0b' : '#4ade80';

    // ── 6. Mannequin keypoints + paths (BBL Uplift 동일) ──
    const uid = 'eg' + Math.random().toString(36).slice(2, 8);
    const K = {
      head: [470, 100], neck: [478, 138],
      rShoulder: [520, 162], lShoulder: [438, 158],
      rElbow: [572, 108], rWrist: [612, 72], ball: [634, 60],
      lElbow: [376, 176], lWrist: [424, 220],
      pelvisR: [506, 280], pelvisL: [446, 280], pelvisC: [476, 280],
      rKnee: [556, 358], rAnkle: [620, 412], rToe: [658, 420],
      lKnee: [370, 384], lAnkle: [332, 472], lToe: [290, 474],
    };
    const energyPath = `M ${K.lAnkle[0]} ${K.lAnkle[1]} L ${K.lKnee[0]} ${K.lKnee[1]} L ${K.pelvisL[0]} ${K.pelvisL[1]} L ${K.pelvisC[0]} ${K.pelvisC[1]} L ${K.rShoulder[0]} ${K.rShoulder[1]} L ${K.rElbow[0]} ${K.rElbow[1]} L ${K.rWrist[0]} ${K.rWrist[1]} L ${K.ball[0]} ${K.ball[1]}`;
    const driveLegPath = `M ${K.rAnkle[0]-12} ${K.rAnkle[1]-2} L ${K.rKnee[0]} ${K.rKnee[1]} L ${K.pelvisR[0]+2} ${K.pelvisR[1]+2}`;

    const leakBurst = taLeak ? `
      <g>
        <circle cx="${(K.rShoulder[0]+K.rElbow[0])/2}" cy="${(K.rShoulder[1]+K.rElbow[1])/2}" r="38" fill="url(#leak-${uid})">
          <animate attributeName="r" values="28;44;28" dur="1.2s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="0.9;0.4;0.9" dur="1.2s" repeatCount="indefinite"/>
        </circle>
      </g>` : '';

    // ── 파워 흐름 — kinetic 기반 (Joint Power normalized) ──
    const powerFlowItems = [
      { stage: 'Trail Hip', val: trailHipP, unit: 'W', x: 590, y: 320 },
      { stage: 'Lead Hip',  val: v('Lead_Hip_Power_peak'), unit: 'W', x: 360, y: 320 },
      { stage: 'Lead Knee', val: v('Lead_Knee_Power_peak'), unit: 'W', x: 330, y: 396 },
      { stage: 'Shoulder',  val: shoulderP, unit: 'W', x: 540, y: 142 },
      { stage: 'Elbow',     val: elbowP, unit: 'W', x: 596, y: 128 },
    ];

    // ── ★ v0.11 — Kinetic Energy 기반 에너지 흐름 직접 계산 ──
    // 각 segment의 KE = 0.5 × I × ω²
    //   I = 관성모멘트 (Body Segment Parameter, Winter 4th ed. Anthropometry)
    //   I_pelvis  ≈ 0.0148 × m × h²  (vertical axis)
    //   I_trunk   ≈ 0.0150 × m × h²
    //   I_humerus ≈ 0.0019 × m × h²
    // 단계별 KE 값을 직접 비교하면 진짜 에너지 손실량(Joule) 산출 가능 — 단순 ratio 대신 절대값.
    const mass_kg = result._meta?.mass_kg || 75;
    const height_m = (result._meta?.height_cm || 175) / 100;
    const I_pelvis  = 0.0148 * mass_kg * height_m * height_m;
    const I_trunk   = 0.0150 * mass_kg * height_m * height_m;
    const I_humerus = 0.0019 * mass_kg * height_m * height_m;
    const D2R = Math.PI / 180;
    const KE = (I, omega_dps) => omega_dps != null ? 0.5 * I * (omega_dps * D2R) ** 2 : null;

    const pelvisPk = v('Pelvis_peak'), trunkPk = v('Trunk_peak'), armPk = v('Arm_peak');
    const wristV = v('wrist_release_speed');
    const KE_pelvis  = KE(I_pelvis,  pelvisPk);
    const KE_trunk   = KE(I_trunk,   trunkPk);
    const KE_arm     = KE(I_humerus, armPk);

    // ── 단계별 KE 흐름 분석 (J 단위) ──
    // 정상 ratio 범위 (Joule transfer):
    //   Pelvis → Trunk:  1.4~2.2 (trunk가 pelvis의 ~1.7배 KE 흡수·증폭)
    //   Trunk → Arm:     3.0~5.5 (humerus가 trunk보다 ~4배 KE)
    // 손실(loss)이 있을 때: ratio < min → 운동 사슬 단절·전달 비효율
    const flowEvidences = [];
    function trKE(label, up_label, up_J, dn_label, dn_J, idealMin, idealMax) {
      if (up_J == null || dn_J == null) return;
      const ratio = dn_J / up_J;
      const ok = ratio >= idealMin && ratio <= idealMax;
      const lossJ = up_J - dn_J;  // 음수 = 증폭, 양수 = 손실
      flowEvidences.push({
        label, up_label, up_val: up_J.toFixed(1) + ' J', dn_label, dn_val: dn_J.toFixed(1) + ' J',
        ratio, idealMin, idealMax, ok, unit: 'J',
        loss: ratio < idealMin, surplus: ratio > idealMax,
        // 추가 KE 정보
        ke_loss_J: lossJ, ke_loss_label: lossJ > 0 ? `손실 ${lossJ.toFixed(1)} J` : `증폭 +${(-lossJ).toFixed(1)} J`,
      });
    }

    // Trail GRF → Pelvis KE (GRF에서 발생한 push가 pelvis 운동에너지로 변환되는 효율)
    if (trailVGRF != null && KE_pelvis != null) {
      const grfJ = trailVGRF * mass_kg * 9.81 * 0.05;  // Approx. impulse-energy proxy (BW × 0.05s)
      trKE('① 발 GRF → 골반 KE', 'GRF impulse', grfJ, 'Pelvis KE', KE_pelvis, 0.6, 1.8);
    }
    // Pelvis KE → Trunk KE (직접 KE 비율)
    if (KE_pelvis != null && KE_trunk != null) {
      trKE('② 골반 KE → 몸통 KE', 'Pelvis KE', KE_pelvis, 'Trunk KE', KE_trunk, 1.3, 2.4);
    }
    // Trunk KE → Arm KE (humerus segment KE)
    if (KE_trunk != null && KE_arm != null) {
      trKE('③ 몸통 KE → 상완 KE', 'Trunk KE', KE_trunk, 'Arm KE', KE_arm, 2.5, 5.5);
    }
    // Shoulder Power → Elbow Power (joint power 직접 비교, 측정된 경우)
    if (shoulderP != null && elbowP != null) {
      // power ratio (W/W) — 서브 흐름 (joint torque 흐름)
      const pratio = elbowP / shoulderP;
      flowEvidences.push({
        label: '④ 어깨 P → 팔꿈치 P', up_label: 'Shoulder P', up_val: shoulderP.toFixed(0) + ' W',
        dn_label: 'Elbow P', dn_val: elbowP.toFixed(0) + ' W',
        ratio: pratio, idealMin: 0.15, idealMax: 0.40, unit: 'W',
        ok: pratio >= 0.15 && pratio <= 0.40,
        loss: pratio < 0.15, surplus: pratio > 0.40,
        ke_loss_J: shoulderP - elbowP, ke_loss_label: pratio > 0.4 ? '⚠ 팔꿈치 의존 (UCL 위험)' : pratio < 0.15 ? '전달 부족' : '정상 분배',
      });
    }
    // Arm KE → Wrist KE (release momentum)
    if (KE_arm != null && wristV != null) {
      // wrist KE proxy: 0.5 × m_hand × v² (m_hand ≈ 0.006 × mass)
      const m_hand = 0.006 * mass_kg;
      const KE_wrist = 0.5 * m_hand * wristV * wristV;
      trKE('⑤ 상완 KE → 손목 KE (release)', 'Arm KE', KE_arm, 'Wrist KE', KE_wrist, 0.05, 0.30);
    }

    // 종합 판정
    const lossCnt = flowEvidences.filter(e => e.loss).length;
    const surplusCnt = flowEvidences.filter(e => e.surplus).length;
    const okCnt = flowEvidences.filter(e => e.ok).length;
    const totalEv = flowEvidences.length;
    let overall, overallColor;
    if (totalEv === 0) { overall = '데이터 부족 — 평가 불가'; overallColor = '#3F3F46'; }
    else if (lossCnt === 0 && surplusCnt === 0) { overall = '✅ 키네틱 체인 정상 — 모든 단계 효율 양호'; overallColor = '#16a34a'; }
    else if (lossCnt > 0) { overall = `⚠ ${lossCnt}개 단계에서 power 손실 — 전달 효율 부족`; overallColor = '#dc2626'; }
    else { overall = `△ ${surplusCnt}개 단계 ratio 과다 — UCL/joint stress 위험 패턴`; overallColor = '#fb923c'; }

    const evidenceHtml = flowEvidences.map(e => {
      const c = e.loss ? '#dc2626' : e.surplus ? '#fb923c' : '#16a34a';
      const icon = e.loss ? '⚠' : e.surplus ? '△' : '✓';
      return `<div style="background: var(--bg-elevated, #1A1A1A); padding: 8px 10px; margin-bottom: 4px; border-radius: 4px; border-left: 3px solid ${c}; font-size: 11px;">
        <div class="flex justify-between items-baseline flex-wrap">
          <strong style="color: ${c};">${icon} ${e.label}</strong>
          <span class="mono" style="color: ${c}; font-weight: 700;">ratio ${e.ratio.toFixed(2)}</span>
        </div>
        <div class="mono text-[10px] mt-1" style="color: var(--text-muted, #3F3F46);">
          ${e.up_label} ${e.up_val} → ${e.dn_label} ${e.dn_val} · 이상 ${e.idealMin.toFixed(2)}~${e.idealMax.toFixed(2)} (${e.unit})
        </div>
        ${e.ke_loss_label ? `<div class="text-[10px] mt-1" style="color: ${c};">⚡ ${e.ke_loss_label}</div>` : ''}
      </div>`;
    }).join('');

    // ── ★ v0.13 — ELI 통합 표시 ──
    // 마네킹에 6영역 ELI 라벨 박스 + 우상단 큰 ELI 점수 패널
    const TM = window.TheiaMeta;
    let eliPanel = '';
    let eliAreaLabels = '';   // 마네킹 안 SVG 추가 라벨
    let eliAreas = null;
    let eliVal = null;
    let eliGrade = null;
    if (TM?.ELI_AREAS) {
      // 6영역 점수 계산 (theia_render.js와 동일 로직)
      const _avg = (keys) => {
        const vals = keys.map(k => m[k]?.score).filter(x => x != null);
        return vals.length ? Math.round(vals.reduce((a,b)=>a+b,0) / vals.length) : null;
      };
      const dimsRaw = [
        _avg(['Trail_leg_peak_vertical_GRF', 'Trail_leg_peak_AP_GRF', 'Trail_Hip_Power_peak', 'Pelvis_peak']),
        _avg(['Lead_leg_peak_vertical_GRF', 'CoG_Decel', 'Lead_Knee_Power_peak', 'br_lead_leg_knee_flexion', 'lead_knee_ext_change_fc_to_br']),
        _avg(['fc_xfactor', 'peak_xfactor', 'peak_trunk_CounterRotation', 'trunk_rotation_at_fc']),
        _avg(['Pelvis_peak', 'Trunk_peak', 'trunk_forward_flexion_vel_peak', 'pelvis_to_trunk', 'pelvis_trunk_speedup']),
        _avg(['Arm_peak', 'humerus_segment_peak', 'trunk_to_arm', 'arm_trunk_speedup', 'mer_shoulder_abd', 'max_shoulder_ER', 'Pitching_Shoulder_Power_peak']),
      ];
      // ★ v0.14 — 결함 패널티 적용 (theia_render.js _compute6axisMech와 동일 로직)
      const faultIdsByDim = [
        ['WeakTrailDrive'],
        ['WeakLeadBlock', 'LeadKneeCollapse', 'PoorBlock'],
        ['FlyingOpen'],
        ['LateTrunkRotation', 'PoorSpeedupChain', 'ExcessForwardTilt'],
        ['MERShoulderRisk'],
      ];
      const sevPenalty = { high: 35, medium: 18, low: 8 };
      const sevCap     = { high: 50, medium: 65, low: 80 };
      const flts = result.faults || [];
      const dims = dimsRaw.map((rawScore, i) => {
        if (rawScore == null) return null;
        const matched = flts.filter(f => faultIdsByDim[i].includes(f.id));
        if (matched.length === 0) return rawScore;
        const order = { high: 3, medium: 2, low: 1 };
        const worstSev = matched.reduce((w, f) => order[f.severity] > order[w] ? f.severity : w, 'low');
        const penalty = matched.reduce((s, f) => s + (sevPenalty[f.severity] || 0), 0);
        return Math.min(sevCap[worstSev] || 100, Math.max(0, rawScore - penalty));
      });
      const inj = result.catScores?.INJURY?.score;
      eliAreas = TM.ELI_AREAS.map(a => ({
        ...a, score: a.from_injury ? inj : dims[a.mech_idx],
      }));
      const measured = eliAreas.filter(a => a.score != null);
      const totalW = measured.reduce((s, a) => s + a.weight, 0);
      eliVal = totalW ? Math.round(measured.reduce((s, a) => s + a.score * a.weight, 0) / totalW) : null;
      eliGrade = eliVal != null ? TM.getELIGrade(eliVal) : { color: '#6B6357', label: '미평가', feedback: '' };

      // 우상단 큰 ELI 점수 패널 (HTML)
      eliPanel = `
        <div style="background: #FAFAF7; border: 2px solid ${eliGrade.color}; border-radius: 8px; padding: 12px 16px; min-width: 220px;">
          <div class="text-[10px] mono uppercase" style="color: var(--text-muted, #3F3F46); letter-spacing: 0.1em;">INTEGRATED ELI</div>
          <div class="display" style="font-size: 42px; color: ${eliGrade.color}; font-weight: 700; line-height: 1;">${eliVal != null ? eliVal : '—'}<span class="text-sm" style="color: var(--text-muted, #3F3F46);">/100</span></div>
          <div class="text-xs" style="color: ${eliGrade.color}; font-weight: 600; margin-top: 2px;">${eliGrade.label}</div>
          <!-- 5단계 색상 띠 + 본 선수 위치 -->
          <div style="position: relative; height: 8px; margin-top: 6px; border-radius: 2px; overflow: hidden; background: linear-gradient(90deg, #dc2626 0%, #dc2626 40%, #f87171 40%, #f87171 54%, #fb923c 54%, #fb923c 68%, #22d3ee 68%, #22d3ee 84%, #16a34a 84%, #16a34a 100%);">
            ${eliVal != null ? `<div style="position: absolute; left: ${Math.min(100, eliVal)}%; top: -2px; width: 2px; height: 12px; background: white; box-shadow: 0 0 4px white;"></div>` : ''}
          </div>
          <div class="text-[9px] mono mt-1" style="color: var(--text-muted, #3F3F46); display: flex; justify-content: space-between;">
            <span>0</span><span>40</span><span>55</span><span>70</span><span>85</span><span>100</span>
          </div>
        </div>`;

      // 마네킹 SVG 안 6영역 라벨 박스 (분절 위치별)
      // 위치: 좌상단·우상단·좌중·우중·좌하·우하 (마네킹 분절 위치에 매칭)
      // ★ v0.18 — 박스를 분절 keypoint 가까이 배치 + 화살표 line 추가
      // 박스 좌표 = 분절 옆 빈 공간. anchorPoint = 분절 keypoint (화살표 끝점).
      // 박스 크기 150×46, 폰트 12px(name)/20px(score)로 확대
      // Mannequin keypoints (참고): rAnkle [620,412] / lAnkle [332,472] / rKnee [556,358] / lKnee [370,384]
      //   pelvisR/L/C [506/446/476, 280] / lShoulder [438,158] / rShoulder [520,162]
      //   rElbow [572,108] / rWrist [612,72]
      const labelPositions = [
        // ★ v0.27 — 박스를 분절에서 더 멀리 (겹침 방지)
        // [boxX, boxY] = 박스 위치, [anchorX, anchorY] = 분절 keypoint (화살표 끝)
        // ★ v0.54 — GRF 라벨(발 옆)과 겹침 해소 — 더 위·바깥쪽으로 이동
        { id: 'lower_drive',  boxX: 645, boxY: 400, anchorX: 620, anchorY: 410 },  // Trail 무릎 옆 (오른쪽 위)
        { id: 'lead_block',   boxX:  60, boxY: 400, anchorX: 332, anchorY: 472 },  // Lead 무릎 옆 (왼쪽 위)
        { id: 'pelvis_trunk', boxX: 220, boxY: 285, anchorX: 446, anchorY: 280 },  // 골반 (-70 좌)
        { id: 'trunk_power',  boxX: 220, boxY: 195, anchorX: 446, anchorY: 220 },  // 몸통 (-70 좌)
        { id: 'arm_transfer', boxX: 615, boxY: 25,  anchorX: 572, anchorY: 108 },  // 팔꿈치 위 (-25 위)
        { id: 'load_eff',     boxX: 700, boxY: 190, anchorX: 612, anchorY: 72 },   // 손목/팔꿈치 (+55 우)
      ];
      eliAreaLabels = eliAreas.map((a, i) => {
        const pos = labelPositions[i];
        if (!pos) return '';
        const sc = a.score;
        const c = sc == null ? '#3F3F46' : sc >= 80 ? '#16a34a' : sc >= 60 ? '#22d3ee' : sc >= 40 ? '#fb923c' : '#dc2626';
        const isStarred = a.weight >= 20 ? ' ★' : '';
        const W = 150, H = 46;
        // 화살표 line — 박스 중앙에서 분절 keypoint로
        const lineX1 = pos.boxX + W / 2;
        const lineY1 = pos.boxY + H / 2;
        return `<g>
          <!-- 화살표 line: 박스 중앙 → 분절 -->
          <line x1="${lineX1}" y1="${lineY1}" x2="${pos.anchorX}" y2="${pos.anchorY}"
                stroke="${c}" stroke-width="1" stroke-dasharray="2 3" opacity="0.55"/>
          <!-- 분절 끝 점 -->
          <circle cx="${pos.anchorX}" cy="${pos.anchorY}" r="4" fill="${c}" opacity="0.7"/>
          <!-- 박스 -->
          <rect x="${pos.boxX}" y="${pos.boxY}" width="${W}" height="${H}" rx="5"
                fill="#FAFAF7" stroke="${c}" stroke-width="1.8" opacity="0.95"/>
          <!-- 영역 이름 -->
          <text x="${pos.boxX + 8}" y="${pos.boxY + 16}" font-size="12" fill="${c}"
                font-weight="700" letter-spacing="0.3">${a.name}${isStarred}</text>
          <!-- 점수 (큰 폰트) -->
          <text x="${pos.boxX + 8}" y="${pos.boxY + 38}" font-size="20" fill="#DCD7CF"
                font-weight="700" font-family="JetBrains Mono">${sc != null ? sc + '점' : '—'}<tspan font-size="11" fill="var(--text-muted, #3F3F46)" font-family="Inter" font-weight="500"> w=${a.weight}</tspan></text>
        </g>`;
      }).join('');
    }

    return `
    <div class="cat-card mb-6" style="padding: 16px; background: #FAFAF7; border: 1px solid #F3F1EC;">
      <div class="flex justify-between items-start flex-wrap gap-3 mb-2">
        <div>
          <div class="display text-xl mb-1" style="color: #fb923c;">🤸 코칭 세션 — 마네킹 + ELI 통합</div>
          <div class="text-xs mb-2" style="color: #3F3F46;">
            ★ <strong>직관적 진단 hub</strong> — 6영역 Energy Leak Index + KE 기반 흐름 + GRF + 팔꿈치 토크 + lag 누수를 한 그림에 통합.
            마네킹 분절 옆 라벨 = 해당 영역 점수(가중치 ★=20). 우상단 점수 = 통합 ELI.
          </div>
        </div>
        ${eliPanel}
      </div>

      <!-- ★ v0.14 — ELI 등급 기반 통합 판정 (모순 해결: KE 흐름·결함·ELI 일관성) -->
      <div class="mb-3 p-3 rounded" style="background: ${eliGrade?.color || '#3F3F46'}15; border: 1px solid ${eliGrade?.color || '#3F3F46'}; border-left: 3px solid ${eliGrade?.color || '#3F3F46'};">
        <div class="display text-base mb-1" style="color: ${eliGrade?.color || '#3F3F46'};">
          📊 종합 진단 — <strong>ELI ${eliVal != null ? eliVal + '/100' : '—'}</strong> · ${eliGrade?.label || '미평가'}
        </div>
        <div class="text-xs mb-2" style="color: var(--text-secondary, #6B6357);">
          ${eliGrade?.feedback || ''}
          ${result.faults?.length > 0 ? `<span style="color: #fb923c;"> · ⚠ 결함 ${result.faults.length}건 (영역 점수에 패널티 자동 적용)</span>` : ''}
        </div>
        <details>
          <summary class="cursor-pointer text-[11px]" style="color: var(--text-muted, #3F3F46);">🔬 KE 기반 단계별 흐름 보조 분석 (펼치기)</summary>
          <div class="mt-2 text-[11px]" style="color: var(--text-secondary, #6B6357);">
            <strong>각 segment KE = 0.5·I·ω²</strong>(Joule), 단계별 ratio = downstream KE / upstream KE.
            <span style="color: #16a34a;">정상</span> elite 범위 (① 발 GRF→골반 KE 0.6~1.8, ② 골반→몸통 1.3~2.4, ③ 몸통→상완 2.5~5.5).
            ⚡ 손실량 = upstream − downstream (J).
          </div>
          <div class="mt-2">${evidenceHtml || '<div class="text-xs" style="color: var(--text-muted);">단계별 데이터 부족</div>'}</div>
          <div class="text-[10px] mt-2 mono" style="color: var(--text-muted);">측정 ${totalEv}/5 단계 · 정상 ${okCnt} · 손실 ${lossCnt} · 과다 ${surplusCnt} · I_pelvis=${I_pelvis.toFixed(2)} I_trunk=${I_trunk.toFixed(2)} I_humerus=${I_humerus.toFixed(3)} kg·m² (BSP)</div>
          <div class="text-[10px] mt-1" style="color: var(--text-muted); font-style: italic;">
            ※ KE 흐름 ratio가 elite 범위여도 절대 출력(영역별 ELI 점수)이 부족하면 통합 진단은 리크로 평가 — 두 지표 모두 충족되어야 elite.
          </div>
        </details>
      </div>

      <details class="mb-2 text-xs" style="background: #0F2A4A; padding: 6px 10px; border-radius: 4px; border-left: 2px solid #60a5fa;">
        <summary class="cursor-pointer" style="color: #93c5fd; font-weight: 600;">📖 어떻게 읽나요? (코치용 가이드)</summary>
        <div class="mt-2 leading-relaxed" style="color: #E8E4DD;">
          <strong style="color: #22d3ee;">에너지 흐름 — 키네틱 기반</strong>: 발에서 시작한 추진력이 무릎·골반·몸통·어깨·팔꿈치를 거쳐 손목으로 전달되는 power 사슬. 각 분절은 <strong>Joint Power(W)</strong>로 평가되며, 어디서 power 손실이 발생하는지 시각화합니다.<br><br>
          <strong style="color: #fb923c;">Power Transfer Ratio</strong>: 단계별 effective transfer = downstream/upstream. ① GRF→Hip 4~12 (W가 BW의 4~12배 normalized), ② Pelvis→Trunk 1.15~1.45 (속도 1.3배 증폭), ③ Trunk→Arm 4.5~7.0 (5~6배), ④ Shoulder→Elbow 0.15~0.40 (효율적 분배), ⑤ Arm→Wrist 2~3.5.<br><br>
          <strong style="color: #f87171;">손실</strong>: ratio < min → 단절·전달 비효율. <strong style="color: #fb923c;">과다</strong>: ratio > max → 단계 출력이 균형 깨짐 (joint stress↑). <strong style="color: #16a34a;">정상</strong>: ratio가 elite 범위.<br><br>
          <strong style="color: #fb923c;">GRF (양 발 라벨)</strong>: Trail vGRF (뒷다리 push) → 추진 시작. Lead vGRF (앞다리 block) → 회전 전환. <em>Elite ≥1.5 / 2.0 BW</em>.<br>
          <strong style="color: #f87171;">팔꿈치 토크/파워</strong>: <code>Pitching_Elbow_Power</code>가 비정상적으로 높으면 UCL stress 위험. <em>elite 200~500 W</em>.<br>
          <strong style="color: #fbbf24;">결함 라벨</strong>: 빨강 = 명확한 누수, 주황 = 미세 누수, 색 없음 = 정상. lag/X-factor/knee collapse 진단 자동.
        </div>
      </details>
      <svg viewBox="0 0 800 540" width="100%" preserveAspectRatio="xMidYMid meet" style="max-height: 540px;">
        <!-- ★ v0.13 — ELI 6영역 라벨 박스 (마네킹 분절 위치별) -->
        ${eliAreaLabels}
        <defs>
          <linearGradient id="bg-${uid}" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stop-color="#FAFAF7" stop-opacity="0"/>
            <stop offset="1" stop-color="#FAFAF7" stop-opacity="0.35"/>
          </linearGradient>
          <linearGradient id="energy-${uid}" gradientUnits="userSpaceOnUse" x1="${K.lAnkle[0]}" y1="${K.lAnkle[1]}" x2="${K.ball[0]}" y2="${K.ball[1]}">
            <stop offset="0%"  stop-color="${kneeCollapse ? '#fde68a' : '#22d3ee'}"/>
            <stop offset="17%" stop-color="${kneeCollapse ? '#fbbf24' : '#60a5fa'}"/>
            <stop offset="30%" stop-color="${kneeCollapse ? '#f59e0b' : '#60a5fa'}"/>
            <stop offset="50%" stop-color="${ptLeak ? (ptSevere ? '#ef4444' : '#f59e0b') : '#3b82f6'}"/>
            <stop offset="72%" stop-color="${taLeak ? (taSevere ? '#ef4444' : '#f59e0b') : '#2563EB'}"/>
            <stop offset="86%" stop-color="${taLeak ? (taSevere ? '#7f1d1d' : '#d97706') : '#1d4ed8'}"/>
            <stop offset="100%" stop-color="${taLeak ? (taSevere ? '#7f1d1d' : '#d97706') : '#1e3a8a'}"/>
          </linearGradient>
          <linearGradient id="drive-${uid}" gradientUnits="userSpaceOnUse" x1="${K.rAnkle[0]}" y1="${K.rAnkle[1]}" x2="${K.pelvisR[0]}" y2="${K.pelvisR[1]}">
            <stop offset="0%"  stop-color="${driveColors.stop1}"/>
            <stop offset="100%" stop-color="${driveColors.stop2}"/>
          </linearGradient>
          <filter id="glow-${uid}" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <radialGradient id="leak-${uid}">
            <stop offset="0%" stop-color="#fee2e2" stop-opacity="0.95"/>
            <stop offset="40%" stop-color="#ef4444" stop-opacity="0.7"/>
            <stop offset="100%" stop-color="#7f1d1d" stop-opacity="0"/>
          </radialGradient>
          <radialGradient id="mSphere-${uid}" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stop-color="#f1f5f9"/><stop offset="45%" stop-color="#E8E4DD"/>
            <stop offset="85%" stop-color="#3F3F46"/><stop offset="100%" stop-color="#3F3F46"/>
          </radialGradient>
          <linearGradient id="mLimb-${uid}" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stop-color="#DCD7CF"/><stop offset="50%" stop-color="#6B6357"/><stop offset="100%" stop-color="#3F3F46"/>
          </linearGradient>
          <linearGradient id="mLimbD-${uid}" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stop-color="#6B6357"/><stop offset="55%" stop-color="#3F3F46"/><stop offset="100%" stop-color="#F3F1EC"/>
          </linearGradient>
          <linearGradient id="mTorso-${uid}" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stop-color="#DCD7CF"/><stop offset="40%" stop-color="#6B6357"/><stop offset="100%" stop-color="#3F3F46"/>
          </linearGradient>
          <radialGradient id="mJoint-${uid}" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stop-color="#f8fafc"/><stop offset="60%" stop-color="#6B6357"/><stop offset="100%" stop-color="#3F3F46"/>
          </radialGradient>
          <radialGradient id="aoShadow-${uid}" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#1A1A1A" stop-opacity="0.45"/>
            <stop offset="100%" stop-color="#1A1A1A" stop-opacity="0"/>
          </radialGradient>
        </defs>

        <line x1="40" y1="485" x2="760" y2="485" stroke="#DCD7CF" stroke-width="1.5" stroke-dasharray="3 6"/>
        <rect x="0" y="0" width="800" height="540" fill="url(#bg-${uid})"/>
        <ellipse cx="${(K.lAnkle[0]+K.rAnkle[0])/2}" cy="488" rx="180" ry="12" fill="url(#aoShadow-${uid})"/>

        <!-- Glove arm -->
        <g>
          <line x1="${K.lShoulder[0]}" y1="${K.lShoulder[1]}" x2="${K.lElbow[0]}" y2="${K.lElbow[1]}" stroke="url(#mLimbD-${uid})" stroke-width="22" stroke-linecap="round"/>
          <circle cx="${K.lElbow[0]}" cy="${K.lElbow[1]}" r="12" fill="url(#mJoint-${uid})"/>
          <line x1="${K.lElbow[0]}" y1="${K.lElbow[1]}" x2="${K.lWrist[0]}" y2="${K.lWrist[1]}" stroke="url(#mLimbD-${uid})" stroke-width="19" stroke-linecap="round"/>
          <circle cx="${K.lWrist[0]}" cy="${K.lWrist[1]}" r="13" fill="url(#mSphere-${uid})"/>
        </g>

        <!-- Back leg (Trail/drive) -->
        <g>
          <line x1="${K.pelvisR[0]-2}" y1="${K.pelvisR[1]}" x2="${K.rKnee[0]}" y2="${K.rKnee[1]}" stroke="url(#mLimb-${uid})" stroke-width="32" stroke-linecap="round"/>
          <circle cx="${K.rKnee[0]}" cy="${K.rKnee[1]}" r="15" fill="url(#mJoint-${uid})"/>
          <line x1="${K.rKnee[0]}" y1="${K.rKnee[1]}" x2="${K.rAnkle[0]}" y2="${K.rAnkle[1]}" stroke="url(#mLimb-${uid})" stroke-width="24" stroke-linecap="round"/>
          <circle cx="${K.rAnkle[0]}" cy="${K.rAnkle[1]}" r="11" fill="url(#mJoint-${uid})"/>
          <path d="M ${K.rAnkle[0]-8} ${K.rAnkle[1]+4} Q ${K.rAnkle[0]-4} ${K.rAnkle[1]+18} ${K.rToe[0]-6} ${K.rToe[1]+10} L ${K.rToe[0]+4} ${K.rToe[1]+2} Q ${K.rToe[0]-2} ${K.rAnkle[1]-2} ${K.rAnkle[0]+6} ${K.rAnkle[1]-4} Z" fill="url(#mLimb-${uid})"/>
        </g>

        <!-- Front leg (Lead/braced) -->
        <g>
          <line x1="${K.pelvisL[0]+2}" y1="${K.pelvisL[1]}" x2="${K.lKnee[0]}" y2="${K.lKnee[1]}" stroke="${kneeCollapse ? (kneeCollapseSevere ? '#ef4444' : '#f59e0b') : 'url(#mLimb-' + uid + ')'}" stroke-width="34" stroke-linecap="round" ${kneeCollapse ? 'opacity="0.85"' : ''}/>
          <circle cx="${K.lKnee[0]}" cy="${K.lKnee[1]}" r="17" fill="${kneeCollapse ? (kneeCollapseSevere ? '#ef4444' : '#f59e0b') : 'url(#mJoint-' + uid + ')'}"/>
          <line x1="${K.lKnee[0]}" y1="${K.lKnee[1]}" x2="${K.lAnkle[0]}" y2="${K.lAnkle[1]}" stroke="${kneeCollapse ? (kneeCollapseSevere ? '#f97316' : '#fbbf24') : 'url(#mLimb-' + uid + ')'}" stroke-width="26" stroke-linecap="round" ${kneeCollapse ? 'opacity="0.85"' : ''}/>
          <circle cx="${K.lAnkle[0]}" cy="${K.lAnkle[1]}" r="12" fill="${kneeCollapse ? '#fbbf24' : 'url(#mJoint-' + uid + ')'}"/>
          <path d="M ${K.lAnkle[0]-12} ${K.lAnkle[1]+2} Q ${K.lToe[0]-4} ${K.lToe[1]-8} ${K.lToe[0]-12} ${K.lToe[1]+8} L ${K.lAnkle[0]-4} ${K.lAnkle[1]+14} Z" fill="${kneeCollapse ? '#fbbf24' : 'url(#mLimb-' + uid + ')'}"/>
          ${kneeCollapse ? `<g>
            <circle cx="${K.lKnee[0]}" cy="${K.lKnee[1]}" r="22" fill="none" stroke="${kneeCollapseSevere ? '#ef4444' : '#f59e0b'}" stroke-width="2" opacity="0.6">
              <animate attributeName="r" values="20;30;20" dur="1.4s" repeatCount="indefinite"/>
              <animate attributeName="opacity" values="0.7;0.2;0.7" dur="1.4s" repeatCount="indefinite"/>
            </circle>
          </g>` : ''}
        </g>

        <!-- Torso -->
        <line x1="${K.lShoulder[0]+2}" y1="${K.lShoulder[1]+4}" x2="${K.rShoulder[0]-2}" y2="${K.rShoulder[1]+4}" stroke="url(#mLimb-${uid})" stroke-width="34" stroke-linecap="round"/>
        <path d="M ${K.lShoulder[0]+4} ${K.lShoulder[1]+8} C ${K.lShoulder[0]-2} ${K.lShoulder[1]+50}, ${K.pelvisL[0]+2} ${K.pelvisL[1]-68}, ${K.pelvisL[0]+6} ${K.pelvisL[1]-20} L ${K.pelvisR[0]-6} ${K.pelvisR[1]-20} C ${K.pelvisR[0]-2} ${K.pelvisR[1]-68}, ${K.rShoulder[0]+2} ${K.rShoulder[1]+50}, ${K.rShoulder[0]-4} ${K.rShoulder[1]+8} Z" fill="url(#mTorso-${uid})" stroke="#F3F1EC" stroke-width="1.2"/>
        <path d="M ${K.pelvisL[0]+6} ${K.pelvisL[1]-22} C ${K.pelvisL[0]+2} ${K.pelvisL[1]-12}, ${K.pelvisL[0]-2} ${K.pelvisL[1]-2}, ${K.pelvisL[0]-6} ${K.pelvisL[1]+10} L ${K.pelvisR[0]+6} ${K.pelvisR[1]+10} C ${K.pelvisR[0]+2} ${K.pelvisR[1]-2}, ${K.pelvisR[0]-2} ${K.pelvisR[1]-12}, ${K.pelvisR[0]-6} ${K.pelvisR[1]-22} Z" fill="url(#mTorso-${uid})" stroke="#F3F1EC" stroke-width="1"/>
        <circle cx="${K.lShoulder[0]}" cy="${K.lShoulder[1]}" r="15" fill="url(#mJoint-${uid})"/>
        <circle cx="${K.rShoulder[0]}" cy="${K.rShoulder[1]}" r="16" fill="url(#mJoint-${uid})"/>

        <!-- Neck + head -->
        <line x1="${K.neck[0]-2}" y1="${K.neck[1]-6}" x2="${K.neck[0]+2}" y2="${K.neck[1]+8}" stroke="url(#mLimb-${uid})" stroke-width="16" stroke-linecap="round"/>
        <circle cx="${K.head[0]}" cy="${K.head[1]}" r="28" fill="url(#mSphere-${uid})" stroke="#F3F1EC" stroke-width="1"/>

        <!-- Throwing arm -->
        <g>
          <line x1="${K.rShoulder[0]}" y1="${K.rShoulder[1]}" x2="${K.rElbow[0]}" y2="${K.rElbow[1]}" stroke="url(#mLimb-${uid})" stroke-width="26" stroke-linecap="round"/>
          <circle cx="${K.rElbow[0]}" cy="${K.rElbow[1]}" r="13" fill="url(#mJoint-${uid})"/>
          <line x1="${K.rElbow[0]}" y1="${K.rElbow[1]}" x2="${K.rWrist[0]}" y2="${K.rWrist[1]}" stroke="url(#mLimb-${uid})" stroke-width="20" stroke-linecap="round"/>
          <circle cx="${K.rWrist[0]}" cy="${K.rWrist[1]}" r="11" fill="url(#mJoint-${uid})"/>
        </g>

        <!-- Ball -->
        <circle cx="${K.ball[0]}" cy="${K.ball[1]}" r="9" fill="#f8fafc" stroke="#F3F1EC" stroke-width="1.2"/>
        <path d="M ${K.ball[0]-6} ${K.ball[1]-3} Q ${K.ball[0]} ${K.ball[1]-8} ${K.ball[0]+6} ${K.ball[1]-3}" stroke="#ef4444" stroke-width="1.2" fill="none"/>
        <path d="M ${K.ball[0]-6} ${K.ball[1]+3} Q ${K.ball[0]} ${K.ball[1]+8} ${K.ball[0]+6} ${K.ball[1]+3}" stroke="#ef4444" stroke-width="1.2" fill="none"/>

        <!-- Drive leg energy pipe -->
        ${driveStatus !== 'na' ? `
        <path d="${driveLegPath}" stroke="#FAFAF7" stroke-opacity="0.55" stroke-width="18" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="${driveLegPath}" stroke="url(#drive-${uid})" stroke-width="11" fill="none" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow-${uid})" stroke-dasharray="20 12" opacity="0.92">
          <animate attributeName="stroke-dashoffset" from="0" to="-64" dur="1.8s" repeatCount="indefinite"/>
        </path>` : ''}

        <!-- Energy pipe (메인 흐름) -->
        <path d="${energyPath}" stroke="#FAFAF7" stroke-opacity="0.6" stroke-width="22" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="${energyPath}" stroke="url(#energy-${uid})" stroke-width="14" fill="none" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow-${uid})" stroke-dasharray="24 14">
          <animate attributeName="stroke-dashoffset" from="0" to="-76" dur="1.6s" repeatCount="indefinite"/>
        </path>
        ${leakBurst}

        <!-- ★ 던지는 팔 — Elbow 노드 (Pitching_Elbow_Power = 토크) -->
        <g>
          <circle cx="${K.rElbow[0]}" cy="${K.rElbow[1]}" r="11" fill="none" stroke="${elbowColor}" stroke-opacity="0.5" stroke-width="2">
            <animate attributeName="r" values="9;14;9" dur="1.8s" repeatCount="indefinite"/>
            <animate attributeName="stroke-opacity" values="0.6;0.15;0.6" dur="1.8s" repeatCount="indefinite"/>
          </circle>
          <circle cx="${K.rElbow[0]}" cy="${K.rElbow[1]}" r="6" fill="${elbowColor}" stroke="#FFFFFF" stroke-width="1.5" filter="url(#glow-${uid})"/>
          <text x="${K.rElbow[0]}" y="${K.rElbow[1]+22}" font-size="9" fill="${elbowColor}" text-anchor="middle" font-weight="700" letter-spacing="1">ELBOW</text>
        </g>
        <circle cx="${K.rWrist[0]}" cy="${K.rWrist[1]}" r="5" fill="#22d3ee" stroke="#FFFFFF" stroke-width="1.5" filter="url(#glow-${uid})"/>

        <!-- ★ GRF on each foot — Trail vGRF + Lead vGRF -->
        ${trailVGRF != null ? `
        <g>
          <rect x="${K.rAnkle[0]-32}" y="${K.rAnkle[1]+18}" width="${trailVGRF >= 1.5 ? 86 : 90}" height="40" rx="5" fill="#FAFAF7" stroke="${driveColors.label}" stroke-width="1.6"/>
          <text x="${K.rAnkle[0]+11}" y="${K.rAnkle[1]+32}" text-anchor="middle" font-size="9" fill="${driveColors.label}" font-weight="700" letter-spacing="1">TRAIL vGRF</text>
          <text x="${K.rAnkle[0]+11}" y="${K.rAnkle[1]+50}" text-anchor="middle" font-size="14" fill="#DCD7CF" font-weight="700" font-family="JetBrains Mono">${trailVGRF.toFixed(2)}<tspan font-size="9" fill="#6B6357" font-family="Inter"> BW</tspan></text>
        </g>` : ''}
        ${leadVGRF != null ? `
        <g>
          <rect x="${K.lAnkle[0]-58}" y="${K.lAnkle[1]+10}" width="92" height="40" rx="5" fill="#FAFAF7" stroke="${leadVGRF >= 2.0 ? '#4ade80' : '#f59e0b'}" stroke-width="1.6"/>
          <text x="${K.lAnkle[0]-12}" y="${K.lAnkle[1]+24}" text-anchor="middle" font-size="9" fill="${leadVGRF >= 2.0 ? '#4ade80' : '#f59e0b'}" font-weight="700" letter-spacing="1">LEAD vGRF</text>
          <text x="${K.lAnkle[0]-12}" y="${K.lAnkle[1]+42}" text-anchor="middle" font-size="14" fill="#DCD7CF" font-weight="700" font-family="JetBrains Mono">${leadVGRF.toFixed(2)}<tspan font-size="9" fill="#6B6357" font-family="Inter"> BW</tspan></text>
        </g>` : ''}

        <!-- 어깨 power 라벨 (왼쪽 머리 위) — v0.47 둘 다 왼쪽 정렬 -->
        ${shoulderP != null ? `
        <g>
          <rect x="42" y="48" width="170" height="50" rx="6" fill="#FAFAF7" stroke="${shoulderP >= 1200 ? '#4ade80' : '#fbbf24'}" stroke-width="1.6"/>
          <text x="127" y="64" fill="${shoulderP >= 1200 ? '#4ade80' : '#fbbf24'}" font-size="10" font-family="Inter" font-weight="800" text-anchor="middle">★ SHOULDER POWER</text>
          <text x="127" y="84" fill="#DCD7CF" font-size="14" font-family="JetBrains Mono" font-weight="800" text-anchor="middle">${shoulderP >= 1000 ? (shoulderP/1000).toFixed(2)+'k' : shoulderP.toFixed(0)}<tspan font-size="9" fill="#6B6357" font-family="Inter"> W</tspan></text>
        </g>` : ''}

        <!-- ★ 팔꿈치 토크/파워 라벨 — v0.47 왼쪽 어깨 박스 아래로 이동 (마네킹 머리·공 겹침 해소) -->
        ${elbowP != null ? `
        <g>
          <line x1="${K.rElbow[0]}" y1="${K.rElbow[1]}" x2="212" y2="141" stroke="${elbowColor}" stroke-width="1.4" stroke-dasharray="2 3"/>
          <rect x="42" y="110" width="170" height="62" rx="6" fill="#FAFAF7" stroke="${elbowColor}" stroke-opacity="0.85" stroke-width="2"/>
          <text x="127" y="126" fill="${elbowColor}" font-size="10" font-family="Inter" font-weight="800" text-anchor="middle" letter-spacing="1">${elbowStatus === 'high' ? '🚨 ELBOW POWER' : elbowStatus === 'low' ? '△ ELBOW POWER' : '✓ ELBOW POWER'}</text>
          <text x="127" y="146" fill="#DCD7CF" font-size="14" font-family="JetBrains Mono" font-weight="800" text-anchor="middle">${elbowP >= 1000 ? (elbowP/1000).toFixed(2)+'k' : elbowP.toFixed(0)}<tspan font-size="10" fill="#6B6357" font-family="Inter"> W (peak)</tspan></text>
          <text x="127" y="162" fill="${elbowColor}" font-size="9" font-family="Inter" text-anchor="middle">${elbowStatus === 'high' ? 'UCL stress 위험 (정상 200~500W)' : elbowStatus === 'low' ? '팔꿈치 power 부족' : '정상 (200~500W)'}</text>
        </g>` : ''}

        <!-- ★ v0.14 — lag·flying open·knee collapse·drive 라벨 박스 모두 제거.
             결함 정보는 ELI 영역 라벨 박스(${eliAreaLabels})에 점수로 통합 표시되며,
             결함 검출 시 영역 점수에 패널티가 적용되어 일관성 보장.
             상세 결함 원인은 아래 "결함 진단 + 코칭 처방" 카드에서 확인. -->
      </svg>

      <div class="text-xs mt-2 px-2" style="color: #3F3F46;">
        <span style="color:#4ade80">●</span> 정상 ·
        <span style="color:#f59e0b">●</span> 미세 누수 ·
        <span style="color:#ef4444">●</span> 명확한 누수 — KINETIC_FAULTS 진단. GRF 라벨은 발에 직접 표시.
        팔꿈치 power(=관절 토크 × 각속도)는 UCL stress 신호.
      </div>
    </div>`;
  }

  // ── BBL Uplift 동일 동적 종형 곡선 (lag 기반) ──
  function _renderKinematicBellUplift(result) {
    const m = result.varScores || {};
    const ptLagSec = m.pelvis_to_trunk?.value;
    const taLagSec = m.trunk_to_arm?.value;
    if (ptLagSec == null || taLagSec == null) {
      return `
      <div class="cat-card mb-6" style="padding: 18px;">
        <div class="display text-xl mb-2">📊 키네매틱 시퀀스 — 피크 속도 타이밍</div>
        <div class="text-sm" style="color: var(--text-muted);">시퀀스 lag 데이터 없음 — pelvis_to_trunk·trunk_to_arm 미산출</div>
      </div>`;
    }
    const pToT = ptLagSec * 1000, tToA = taLagSec * 1000;
    const detectionErrorPT = pToT < 0;
    const detectionErrorTA = tToA < 0;
    const pToTAdj = Math.abs(pToT);
    const tToAAdj = Math.abs(tToA);
    const pelvisMs = 0;
    const trunkMs = pelvisMs + Math.round(pToTAdj);
    const armMs = trunkMs + Math.round(tToAAdj);
    const g1 = Math.round(pToTAdj), g2 = Math.round(tToAAdj);
    const hasDetectionError = detectionErrorPT || detectionErrorTA;

    const uid = 'seq' + Math.random().toString(36).slice(2, 8);
    const allMs = [pelvisMs, trunkMs, armMs];
    const tMin = Math.min(-30, ...allMs.map(m => m - 30));
    const tMax = Math.max(150, ...allMs.map(m => m + 30));
    const w = 800, h = 320;
    const padL = 24, padR = 24, padT = 30, padB = 90;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const toX = (ms) => padL + ((ms - tMin) / (tMax - tMin)) * plotW;
    const toY = (val) => padT + plotH - val * plotH;

    const segs = [
      { ko: '골반', peakMs: pelvisMs, amp: 0.42, color: '#4a90c2', sigma: 26 },
      { ko: '몸통', peakMs: trunkMs, amp: 0.66, color: '#5db885', sigma: 24 },
      { ko: '상완', peakMs: armMs, amp: 0.95, color: '#e8965a', sigma: 20 },
    ];
    const sample = (peak, amp, sigma, t) => amp * Math.exp(-((t - peak) * (t - peak)) / (2 * sigma * sigma));
    const curvePath = (peak, amp, sigma) => {
      let d = '';
      for (let t = tMin; t <= tMax; t += 2) {
        d += (d === '' ? `M ${toX(t).toFixed(1)} ${toY(sample(peak, amp, sigma, t)).toFixed(1)}`
                       : ` L ${toX(t).toFixed(1)} ${toY(sample(peak, amp, sigma, t)).toFixed(1)}`);
      }
      return d;
    };

    const okG1 = g1 >= 30 && g1 <= 60;
    const okG2 = g2 >= 30 && g2 <= 60;
    const dtRow1Y = padT + plotH + 26;
    const dtRow2Y = padT + plotH + 58;

    const curveDefs = segs.map((s, i) =>
      `<path id="seqCurve-${i}-${uid}" d="${curvePath(s.peakMs, s.amp, s.sigma)}" fill="none"/>`
    ).join('');

    const curveGroups = segs.map((s, i) => {
      const d = curvePath(s.peakMs, s.amp, s.sigma);
      const peakX = toX(s.peakMs);
      const peakY = toY(s.amp);
      const partDur = 2.0;
      const partDelay = -((segs.length - 1 - i) * 0.35);
      const particles = [0, 0.5].map((offset) => `
        <circle r="3.2" fill="${s.color}" opacity="0.95" style="filter: url(#curveGlow-${uid})">
          <animateMotion dur="${partDur}s" repeatCount="indefinite" begin="${(partDelay - offset * partDur).toFixed(2)}s">
            <mpath href="#seqCurve-${i}-${uid}"/>
          </animateMotion>
        </circle>`).join('');
      return `
        <g>
          <path d="${d} L ${toX(tMax)} ${toY(0)} L ${toX(tMin)} ${toY(0)} Z" fill="${s.color}" opacity="0.10"/>
          <path d="${d}" stroke="${s.color}" stroke-width="2.6" fill="none" stroke-linecap="round" style="filter: url(#curveGlow-${uid})"/>
          <path d="${d}" stroke="#ffffff" stroke-opacity="0.5" stroke-width="1.2" fill="none" stroke-dasharray="10 22">
            <animate attributeName="stroke-dashoffset" values="32;0" dur="1.6s" repeatCount="indefinite"/>
          </path>
          ${particles}
          <circle cx="${peakX}" cy="${peakY}" r="10" fill="none" stroke="${s.color}" stroke-opacity="0.65" stroke-width="2">
            <animate attributeName="r" values="8;20;8" dur="1.6s" repeatCount="indefinite" begin="${i * 0.4}s"/>
            <animate attributeName="stroke-opacity" values="0.7;0;0.7" dur="1.6s" repeatCount="indefinite" begin="${i * 0.4}s"/>
          </circle>
          <circle cx="${peakX}" cy="${peakY}" r="6.5" fill="${s.color}" stroke="#FFFFFF" stroke-width="2" style="filter: url(#peakGlow-${uid})"/>
          <text x="${peakX}" y="${peakY - 18}" text-anchor="middle" fill="${s.color}" font-size="11" font-family="JetBrains Mono" font-weight="700">${s.ko} ${s.peakMs}ms</text>
        </g>`;
    }).join('');

    const dtBars = [
      { x1: toX(pelvisMs), x2: toX(trunkMs), val: g1, ok: okG1, label: '골반→몸통', y: dtRow1Y },
      { x1: toX(trunkMs), x2: toX(armMs), val: g2, ok: okG2, label: '몸통→상완', y: dtRow2Y },
    ].map(b => {
      const xmid = (b.x1 + b.x2) / 2;
      const clr = b.ok ? '#4ade80' : '#f87171';
      return `
        <g>
          <line x1="${b.x1}" x2="${b.x1}" y1="${b.y - 6}" y2="${b.y + 6}" stroke="${clr}" stroke-width="2"/>
          <line x1="${b.x2}" x2="${b.x2}" y1="${b.y - 6}" y2="${b.y + 6}" stroke="${clr}" stroke-width="2"/>
          <line x1="${b.x1 + 2}" x2="${b.x2 - 2}" y1="${b.y}" y2="${b.y}" stroke="${clr}" stroke-width="1.8"/>
          <polygon points="${b.x1 + 8},${b.y - 4} ${b.x1 + 2},${b.y} ${b.x1 + 8},${b.y + 4}" fill="${clr}"/>
          <polygon points="${b.x2 - 8},${b.y - 4} ${b.x2 - 2},${b.y} ${b.x2 - 8},${b.y + 4}" fill="${clr}"/>
          <rect x="${xmid - 70}" y="${b.y - 22}" width="140" height="18" rx="3" fill="#FAFAF7" stroke="${clr}" stroke-opacity="0.75"/>
          <text x="${xmid}" y="${b.y - 9}" text-anchor="middle" font-size="11" fill="${clr}" font-weight="700" font-family="JetBrains Mono">Δt ${b.label} ${b.val} ms</text>
        </g>`;
    }).join('');

    const ticks = [-180, -150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150, 180]
      .filter(t => t >= tMin && t <= tMax)
      .map(t => `<line x1="${toX(t)}" x2="${toX(t)}" y1="${padT}" y2="${padT + plotH}" stroke="#F3F1EC" stroke-width="1" stroke-dasharray="2 4"/>`)
      .join('');

    const detectionParts = [];
    if (detectionErrorPT) detectionParts.push(`pelvis→trunk 원본 ${pToT.toFixed(0)}ms`);
    if (detectionErrorTA) detectionParts.push(`trunk→arm 원본 ${tToA.toFixed(0)}ms`);
    const errNote = hasDetectionError
      ? `<div class="text-[11px]" style="color:#f87171; margin-top:6px; line-height:1.5;">
           🚨 <strong>이벤트 검출 오류 의심</strong> — ${detectionParts.join(', ')} (음수 lag 운동학적 불가능). 절댓값으로 보정 표시.
         </div>` : '';

    return `
    <div class="cat-card mb-6" style="padding: 18px;">
      <div class="display text-xl mb-1">📊 키네매틱 시퀀스 — 회전 타이밍 (간접 추정)</div>
      <div class="text-sm mb-2" style="color: var(--text-secondary);">
        키네틱 체인의 <strong>회전 타이밍</strong>을 통한 <strong>간접적 에너지 전달 추정</strong> — 골반 → 몸통 → 팔 순서로 피크 속도가 시간차를 두고 발생해야 합니다.
        각 단계 사이 lag은 <strong>40~50 ms</strong>가 이상적 (Aguinaldo 2007).
      </div>
      <div class="text-xs mb-3 p-2 rounded" style="background: rgba(96,165,250,0.08); border-left: 2px solid var(--accent-soft, #60a5fa); color: var(--text-secondary);">
        💡 <strong>다음 카드 (마네킹 + ELI)</strong>는 같은 키네틱 체인을 <strong>분절별 ELI 점수</strong>로 직접 진단합니다 — 시퀀스 그래프의 정량적 해석.
      </div>
      <div class="card p-3" style="background: #FAFAF7;">
        <svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="xMidYMid meet">
          <defs>
            <filter id="curveGlow-${uid}" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="b"/>
              <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <filter id="peakGlow-${uid}" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="b"/>
              <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <linearGradient id="plotBg-${uid}" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stop-color="#FAFAF7"/><stop offset="1" stop-color="#FAFAF7"/>
            </linearGradient>
            ${curveDefs}
          </defs>
          <rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="url(#plotBg-${uid})" rx="4"/>
          <rect x="${toX(30)}" y="${padT}" width="${toX(60) - toX(30)}" height="${plotH}" fill="rgba(74,222,128,0.05)"/>
          <rect x="${toX(60)}" y="${padT}" width="${toX(120) - toX(60)}" height="${plotH}" fill="rgba(74,222,128,0.04)"/>
          ${ticks}
          <line x1="${toX(0)}" x2="${toX(0)}" y1="${padT}" y2="${padT + plotH}" stroke="#3F3F46" stroke-width="1.5" stroke-opacity="0.6"/>
          ${curveGroups}
          ${dtBars}
          <text x="${padL + 6}" y="${padT + 14}" fill="#3F3F46" font-size="9" font-family="Inter">↑ 정규화 회전 속도 (이상 lag 30~60 ms 영역 음영)</text>
        </svg>
        ${errNote}
      </div>
    </div>`;
  }


  // 전역 등록
  window.TheiaMannequin = {
    renderMannequinUplift: _renderMannequinUplift,
    renderKinematicBellUplift: _renderKinematicBellUplift,
  };
})();
