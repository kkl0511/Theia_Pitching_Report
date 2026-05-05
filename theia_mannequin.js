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
    const ptTextColor = !ptLeak ? '#94a3b8' : (ptSevere ? '#ef4444' : '#fcd34d');
    const taTextColor = !taLeak ? '#94a3b8' : (taSevere ? '#fca5a5' : '#fcd34d');

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
      na:     { stop1: '#475569', stop2: '#475569', label: '#64748b', text: '데이터 없음' },
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

    // ── 에너지 흐름 판정 (Power Transfer Ratio 기반) ──
    // 단계별 transfer ratio = downstream / upstream. 1.0 미만 시 손실, 1.0 이상 시 증폭.
    // 측정 가능한 인접 단계만 비교 (kinematic ω 또는 kinetic Power)
    const flowEvidences = [];
    function tr(label, up_label, up_val, dn_label, dn_val, idealMin, idealMax, unit) {
      if (up_val == null || dn_val == null) return;
      const ratio = dn_val / up_val;
      const ok = ratio >= idealMin && ratio <= idealMax;
      flowEvidences.push({
        label, up_label, up_val, dn_label, dn_val, ratio,
        idealMin, idealMax, ok, unit,
        loss: ratio < idealMin, surplus: ratio > idealMax,
      });
    }
    // Trail Hip P → Pelvis ω: 보통 power → angular velocity 변환이라 직접 ratio 의미 없음
    //   대신 Trail vGRF → Trail Hip P transfer (GRF가 hip power 만들어냄)
    const pelvisPk = v('Pelvis_peak'), trunkPk = v('Trunk_peak'), armPk = v('Arm_peak');
    const wristV = v('wrist_release_speed');
    if (trailVGRF != null && trailHipP != null) tr('① 발→고관절 power', 'Trail vGRF', trailVGRF, 'Trail Hip P', trailHipP/100, 4, 12, 'BW→W/100');
    if (pelvisPk != null && trunkPk != null) tr('② 골반→몸통 ω', 'Pelvis ω', pelvisPk, 'Trunk ω', trunkPk, 1.15, 1.45, '°/s');
    if (trunkPk != null && armPk != null) tr('③ 몸통→상완 ω (sequencing)', 'Trunk ω', trunkPk, 'Arm ω', armPk, 4.5, 7.0, '°/s');
    if (shoulderP != null && elbowP != null) tr('④ 어깨→팔꿈치 power', 'Shoulder P', shoulderP, 'Elbow P', elbowP, 0.15, 0.40, 'W');
    if (armPk != null && wristV != null) tr('⑤ 상완→손목 (release)', 'Arm ω', armPk, 'Wrist V × 1000', wristV * 1000, 2.0, 3.5, '°/s→m/s');

    // 종합 판정
    const lossCnt = flowEvidences.filter(e => e.loss).length;
    const surplusCnt = flowEvidences.filter(e => e.surplus).length;
    const okCnt = flowEvidences.filter(e => e.ok).length;
    const totalEv = flowEvidences.length;
    let overall, overallColor;
    if (totalEv === 0) { overall = '데이터 부족 — 평가 불가'; overallColor = '#64748b'; }
    else if (lossCnt === 0 && surplusCnt === 0) { overall = '✅ 키네틱 체인 정상 — 모든 단계 효율 양호'; overallColor = '#16a34a'; }
    else if (lossCnt > 0) { overall = `⚠ ${lossCnt}개 단계에서 power 손실 — 전달 효율 부족`; overallColor = '#dc2626'; }
    else { overall = `△ ${surplusCnt}개 단계 ratio 과다 — UCL/joint stress 위험 패턴`; overallColor = '#fb923c'; }

    const evidenceHtml = flowEvidences.map(e => {
      const c = e.loss ? '#dc2626' : e.surplus ? '#fb923c' : '#16a34a';
      const icon = e.loss ? '⚠' : e.surplus ? '△' : '✓';
      return `<div style="background: var(--bg-elevated, #1c1d21); padding: 8px 10px; margin-bottom: 4px; border-radius: 4px; border-left: 3px solid ${c}; font-size: 11px;">
        <div class="flex justify-between items-baseline">
          <strong style="color: ${c};">${icon} ${e.label}</strong>
          <span class="mono" style="color: ${c}; font-weight: 700;">ratio ${e.ratio.toFixed(2)}</span>
        </div>
        <div class="mono text-[10px] mt-1" style="color: var(--text-muted, #64748b);">
          ${e.up_label} ${typeof e.up_val === 'number' ? e.up_val.toFixed(2) : e.up_val} → ${e.dn_label} ${typeof e.dn_val === 'number' ? e.dn_val.toFixed(2) : e.dn_val} · 이상 ${e.idealMin.toFixed(2)}~${e.idealMax.toFixed(2)} (${e.unit})
        </div>
      </div>`;
    }).join('');

    return `
    <div class="cat-card mb-6" style="padding: 16px; background: #0b1220; border: 1px solid #1e293b;">
      <div class="display text-xl mb-1" style="color: #fb923c;">⚡ 키네틱 체인 — 에너지 흐름 (파워 기반)</div>
      <div class="text-xs mb-2" style="color: #64748b;">
        Trail GRF → Trail Hip P → Pelvis ω → Trunk ω → Shoulder P → Elbow P → 공
        — 색상은 분절별 코호트 percentile 점수, 라벨은 절대값 (W·BW·°/s).
      </div>

      <!-- 에너지 흐름 판정 + 근거 -->
      <div class="mb-3 p-3 rounded" style="background: ${overallColor}15; border: 1px solid ${overallColor}; border-left: 3px solid ${overallColor};">
        <div class="display text-base mb-1" style="color: ${overallColor};">📊 에너지 흐름 판정 — ${overall}</div>
        <div class="text-xs mb-2" style="color: var(--text-secondary, #94a3b8);">
          단계별 power transfer ratio = downstream / upstream. <span style="color: #16a34a;">정상</span> = ratio가 elite 범위 (1.15~1.45 골반→몸통, 4.5~7.0 몸통→상완 등). 이 범위 밖이면 손실 또는 과다.
        </div>
        ${evidenceHtml || '<div class="text-xs" style="color: var(--text-muted);">단계별 데이터 부족 — Joint Power가 측정되어야 정확한 판정 가능</div>'}
        <div class="text-[10px] mt-2 mono" style="color: var(--text-muted);">측정 ${totalEv}/5 단계 · 정상 ${okCnt} · 손실 ${lossCnt} · 과다 ${surplusCnt}</div>
      </div>

      <details class="mb-2 text-xs" style="background: #0b1f3a; padding: 6px 10px; border-radius: 4px; border-left: 2px solid #60a5fa;">
        <summary class="cursor-pointer" style="color: #93c5fd; font-weight: 600;">📖 어떻게 읽나요? (코치용 가이드)</summary>
        <div class="mt-2 leading-relaxed" style="color: #cbd5e1;">
          <strong style="color: #22d3ee;">에너지 흐름 — 키네틱 기반</strong>: 발에서 시작한 추진력이 무릎·골반·몸통·어깨·팔꿈치를 거쳐 손목으로 전달되는 power 사슬. 각 분절은 <strong>Joint Power(W)</strong>로 평가되며, 어디서 power 손실이 발생하는지 시각화합니다.<br><br>
          <strong style="color: #fb923c;">Power Transfer Ratio</strong>: 단계별 effective transfer = downstream/upstream. ① GRF→Hip 4~12 (W가 BW의 4~12배 normalized), ② Pelvis→Trunk 1.15~1.45 (속도 1.3배 증폭), ③ Trunk→Arm 4.5~7.0 (5~6배), ④ Shoulder→Elbow 0.15~0.40 (효율적 분배), ⑤ Arm→Wrist 2~3.5.<br><br>
          <strong style="color: #f87171;">손실</strong>: ratio < min → 단절·전달 비효율. <strong style="color: #fb923c;">과다</strong>: ratio > max → 단계 출력이 균형 깨짐 (joint stress↑). <strong style="color: #16a34a;">정상</strong>: ratio가 elite 범위.<br><br>
          <strong style="color: #fb923c;">GRF (양 발 라벨)</strong>: Trail vGRF (뒷다리 push) → 추진 시작. Lead vGRF (앞다리 block) → 회전 전환. <em>Elite ≥1.5 / 2.0 BW</em>.<br>
          <strong style="color: #f87171;">팔꿈치 토크/파워</strong>: <code>Pitching_Elbow_Power</code>가 비정상적으로 높으면 UCL stress 위험. <em>elite 200~500 W</em>.<br>
          <strong style="color: #fbbf24;">결함 라벨</strong>: 빨강 = 명확한 누수, 주황 = 미세 누수, 색 없음 = 정상. lag/X-factor/knee collapse 진단 자동.
        </div>
      </details>
      <svg viewBox="0 0 800 540" width="100%" preserveAspectRatio="xMidYMid meet" style="max-height: 540px;">
        <defs>
          <linearGradient id="bg-${uid}" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stop-color="#0b1220" stop-opacity="0"/>
            <stop offset="1" stop-color="#0b1220" stop-opacity="0.35"/>
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
            <stop offset="0%" stop-color="#f1f5f9"/><stop offset="45%" stop-color="#cbd5e1"/>
            <stop offset="85%" stop-color="#64748b"/><stop offset="100%" stop-color="#334155"/>
          </radialGradient>
          <linearGradient id="mLimb-${uid}" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stop-color="#e2e8f0"/><stop offset="50%" stop-color="#94a3b8"/><stop offset="100%" stop-color="#475569"/>
          </linearGradient>
          <linearGradient id="mLimbD-${uid}" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stop-color="#94a3b8"/><stop offset="55%" stop-color="#64748b"/><stop offset="100%" stop-color="#1e293b"/>
          </linearGradient>
          <linearGradient id="mTorso-${uid}" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stop-color="#e2e8f0"/><stop offset="40%" stop-color="#94a3b8"/><stop offset="100%" stop-color="#334155"/>
          </linearGradient>
          <radialGradient id="mJoint-${uid}" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stop-color="#f8fafc"/><stop offset="60%" stop-color="#94a3b8"/><stop offset="100%" stop-color="#334155"/>
          </radialGradient>
          <radialGradient id="aoShadow-${uid}" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#000" stop-opacity="0.45"/>
            <stop offset="100%" stop-color="#000" stop-opacity="0"/>
          </radialGradient>
        </defs>

        <line x1="40" y1="485" x2="760" y2="485" stroke="#2a3a5a" stroke-width="1.5" stroke-dasharray="3 6"/>
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
        <path d="M ${K.lShoulder[0]+4} ${K.lShoulder[1]+8} C ${K.lShoulder[0]-2} ${K.lShoulder[1]+50}, ${K.pelvisL[0]+2} ${K.pelvisL[1]-68}, ${K.pelvisL[0]+6} ${K.pelvisL[1]-20} L ${K.pelvisR[0]-6} ${K.pelvisR[1]-20} C ${K.pelvisR[0]-2} ${K.pelvisR[1]-68}, ${K.rShoulder[0]+2} ${K.rShoulder[1]+50}, ${K.rShoulder[0]-4} ${K.rShoulder[1]+8} Z" fill="url(#mTorso-${uid})" stroke="#1e293b" stroke-width="1.2"/>
        <path d="M ${K.pelvisL[0]+6} ${K.pelvisL[1]-22} C ${K.pelvisL[0]+2} ${K.pelvisL[1]-12}, ${K.pelvisL[0]-2} ${K.pelvisL[1]-2}, ${K.pelvisL[0]-6} ${K.pelvisL[1]+10} L ${K.pelvisR[0]+6} ${K.pelvisR[1]+10} C ${K.pelvisR[0]+2} ${K.pelvisR[1]-2}, ${K.pelvisR[0]-2} ${K.pelvisR[1]-12}, ${K.pelvisR[0]-6} ${K.pelvisR[1]-22} Z" fill="url(#mTorso-${uid})" stroke="#1e293b" stroke-width="1"/>
        <circle cx="${K.lShoulder[0]}" cy="${K.lShoulder[1]}" r="15" fill="url(#mJoint-${uid})"/>
        <circle cx="${K.rShoulder[0]}" cy="${K.rShoulder[1]}" r="16" fill="url(#mJoint-${uid})"/>

        <!-- Neck + head -->
        <line x1="${K.neck[0]-2}" y1="${K.neck[1]-6}" x2="${K.neck[0]+2}" y2="${K.neck[1]+8}" stroke="url(#mLimb-${uid})" stroke-width="16" stroke-linecap="round"/>
        <circle cx="${K.head[0]}" cy="${K.head[1]}" r="28" fill="url(#mSphere-${uid})" stroke="#1e293b" stroke-width="1"/>

        <!-- Throwing arm -->
        <g>
          <line x1="${K.rShoulder[0]}" y1="${K.rShoulder[1]}" x2="${K.rElbow[0]}" y2="${K.rElbow[1]}" stroke="url(#mLimb-${uid})" stroke-width="26" stroke-linecap="round"/>
          <circle cx="${K.rElbow[0]}" cy="${K.rElbow[1]}" r="13" fill="url(#mJoint-${uid})"/>
          <line x1="${K.rElbow[0]}" y1="${K.rElbow[1]}" x2="${K.rWrist[0]}" y2="${K.rWrist[1]}" stroke="url(#mLimb-${uid})" stroke-width="20" stroke-linecap="round"/>
          <circle cx="${K.rWrist[0]}" cy="${K.rWrist[1]}" r="11" fill="url(#mJoint-${uid})"/>
        </g>

        <!-- Ball -->
        <circle cx="${K.ball[0]}" cy="${K.ball[1]}" r="9" fill="#f8fafc" stroke="#1e293b" stroke-width="1.2"/>
        <path d="M ${K.ball[0]-6} ${K.ball[1]-3} Q ${K.ball[0]} ${K.ball[1]-8} ${K.ball[0]+6} ${K.ball[1]-3}" stroke="#ef4444" stroke-width="1.2" fill="none"/>
        <path d="M ${K.ball[0]-6} ${K.ball[1]+3} Q ${K.ball[0]} ${K.ball[1]+8} ${K.ball[0]+6} ${K.ball[1]+3}" stroke="#ef4444" stroke-width="1.2" fill="none"/>

        <!-- Drive leg energy pipe -->
        ${driveStatus !== 'na' ? `
        <path d="${driveLegPath}" stroke="#0f1a30" stroke-opacity="0.55" stroke-width="18" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="${driveLegPath}" stroke="url(#drive-${uid})" stroke-width="11" fill="none" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow-${uid})" stroke-dasharray="20 12" opacity="0.92">
          <animate attributeName="stroke-dashoffset" from="0" to="-64" dur="1.8s" repeatCount="indefinite"/>
        </path>` : ''}

        <!-- Energy pipe (메인 흐름) -->
        <path d="${energyPath}" stroke="#0f1a30" stroke-opacity="0.6" stroke-width="22" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
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
          <circle cx="${K.rElbow[0]}" cy="${K.rElbow[1]}" r="6" fill="${elbowColor}" stroke="#08080c" stroke-width="1.5" filter="url(#glow-${uid})"/>
          <text x="${K.rElbow[0]}" y="${K.rElbow[1]+22}" font-size="9" fill="${elbowColor}" text-anchor="middle" font-weight="700" letter-spacing="1">ELBOW</text>
        </g>
        <circle cx="${K.rWrist[0]}" cy="${K.rWrist[1]}" r="5" fill="#22d3ee" stroke="#08080c" stroke-width="1.5" filter="url(#glow-${uid})"/>

        <!-- ★ GRF on each foot — Trail vGRF + Lead vGRF -->
        ${trailVGRF != null ? `
        <g>
          <rect x="${K.rAnkle[0]-32}" y="${K.rAnkle[1]+18}" width="${trailVGRF >= 1.5 ? 86 : 90}" height="40" rx="5" fill="#0b1220" stroke="${driveColors.label}" stroke-width="1.6"/>
          <text x="${K.rAnkle[0]+11}" y="${K.rAnkle[1]+32}" text-anchor="middle" font-size="9" fill="${driveColors.label}" font-weight="700" letter-spacing="1">TRAIL vGRF</text>
          <text x="${K.rAnkle[0]+11}" y="${K.rAnkle[1]+50}" text-anchor="middle" font-size="14" fill="#e2e8f0" font-weight="700" font-family="JetBrains Mono">${trailVGRF.toFixed(2)}<tspan font-size="9" fill="#94a3b8" font-family="Inter"> BW</tspan></text>
        </g>` : ''}
        ${leadVGRF != null ? `
        <g>
          <rect x="${K.lAnkle[0]-58}" y="${K.lAnkle[1]+10}" width="92" height="40" rx="5" fill="#0b1220" stroke="${leadVGRF >= 2.0 ? '#4ade80' : '#f59e0b'}" stroke-width="1.6"/>
          <text x="${K.lAnkle[0]-12}" y="${K.lAnkle[1]+24}" text-anchor="middle" font-size="9" fill="${leadVGRF >= 2.0 ? '#4ade80' : '#f59e0b'}" font-weight="700" letter-spacing="1">LEAD vGRF</text>
          <text x="${K.lAnkle[0]-12}" y="${K.lAnkle[1]+42}" text-anchor="middle" font-size="14" fill="#e2e8f0" font-weight="700" font-family="JetBrains Mono">${leadVGRF.toFixed(2)}<tspan font-size="9" fill="#94a3b8" font-family="Inter"> BW</tspan></text>
        </g>` : ''}

        <!-- ★ 팔꿈치 토크/파워 라벨 -->
        ${elbowP != null ? `
        <g>
          <line x1="${K.rElbow[0]+8}" y1="${K.rElbow[1]-4}" x2="700" y2="80" stroke="${elbowColor}" stroke-width="1.4" stroke-dasharray="2 3"/>
          <rect x="592" y="48" width="190" height="62" rx="6" fill="#0b1220" stroke="${elbowColor}" stroke-opacity="0.85" stroke-width="2"/>
          <text x="687" y="64" fill="${elbowColor}" font-size="10" font-family="Inter" font-weight="800" text-anchor="middle" letter-spacing="1">${elbowStatus === 'high' ? '🚨 ELBOW POWER' : elbowStatus === 'low' ? '△ ELBOW POWER' : '✓ ELBOW POWER'}</text>
          <text x="687" y="84" fill="#e2e8f0" font-size="14" font-family="JetBrains Mono" font-weight="800" text-anchor="middle">${elbowP >= 1000 ? (elbowP/1000).toFixed(2)+'k' : elbowP.toFixed(0)}<tspan font-size="10" fill="#94a3b8" font-family="Inter"> W (peak)</tspan></text>
          <text x="687" y="100" fill="${elbowColor}" font-size="9" font-family="Inter" text-anchor="middle">${elbowStatus === 'high' ? 'UCL stress 위험 (정상 200~500W)' : elbowStatus === 'low' ? '팔꿈치 power 부족' : '정상 (200~500W)'}</text>
        </g>` : ''}

        <!-- 어깨 power 라벨 (왼쪽 머리 위) -->
        ${shoulderP != null ? `
        <g>
          <rect x="42" y="48" width="170" height="50" rx="6" fill="#0b1220" stroke="${shoulderP >= 1200 ? '#4ade80' : '#fbbf24'}" stroke-width="1.6"/>
          <text x="127" y="64" fill="${shoulderP >= 1200 ? '#4ade80' : '#fbbf24'}" font-size="10" font-family="Inter" font-weight="800" text-anchor="middle">★ SHOULDER POWER</text>
          <text x="127" y="84" fill="#e2e8f0" font-size="14" font-family="JetBrains Mono" font-weight="800" text-anchor="middle">${shoulderP >= 1000 ? (shoulderP/1000).toFixed(2)+'k' : shoulderP.toFixed(0)}<tspan font-size="9" fill="#94a3b8" font-family="Inter"> W</tspan></text>
        </g>` : ''}

        <!-- PELVIS → TRUNK 누수 -->
        ${ptLeak ? `
        <g>
          <line x1="${K.pelvisC[0]-20}" y1="${K.pelvisC[1]-10}" x2="150" y2="280" stroke="${ptColor}" stroke-width="1.2" stroke-dasharray="2 3"/>
          <rect x="42" y="252" width="176" height="60" rx="6" fill="#0b1220" stroke="${ptColor}" stroke-opacity="0.85" stroke-width="2"/>
          <text x="130" y="268" fill="${ptColor}" font-size="10" font-family="Inter" font-weight="800" text-anchor="middle" letter-spacing="1">⚠ PELVIS → TRUNK</text>
          <text x="130" y="286" fill="#e2e8f0" font-size="14" font-family="JetBrains Mono" font-weight="800" text-anchor="middle">lag ${ptLag != null ? ptLag.toFixed(0) : '—'}ms</text>
          <text x="130" y="302" fill="${ptTextColor}" font-size="9" font-family="Inter" text-anchor="middle">${ptSevere && ptLag < 0 ? '시퀀스 역순' : (ptSevere ? '명확한 누수 (정상 30~80ms)' : '미세 누수 — 트렁크 활성화 늦음')}</text>
        </g>` : ''}

        <!-- TRUNK → ARM 누수 -->
        ${taLeak ? `
        <g>
          <line x1="${K.rShoulder[0]+12}" y1="${K.rShoulder[1]-4}" x2="700" y2="180" stroke="${taColor}" stroke-width="1.2" stroke-dasharray="2 3"/>
          <rect x="592" y="148" width="180" height="60" rx="6" fill="#0b1220" stroke="${taColor}" stroke-opacity="0.85" stroke-width="2"/>
          <text x="682" y="164" fill="${taColor}" font-size="10" font-family="Inter" font-weight="800" text-anchor="middle" letter-spacing="1">⚠ TRUNK → ARM</text>
          <text x="682" y="182" fill="#e2e8f0" font-size="15" font-family="JetBrains Mono" font-weight="800" text-anchor="middle">lag ${taLag != null ? taLag.toFixed(0) : '—'}ms</text>
          <text x="682" y="198" fill="${taTextColor}" font-size="9" font-family="Inter" text-anchor="middle">${taSevere && taLag < 0 ? '시퀀스 역순' : (taSevere ? '명확한 누수 — 어깨 부하↑' : '미세 누수 (정상 30~80ms)')}</text>
        </g>` : ''}

        <!-- Flying Open -->
        ${flyingOpen ? `
        <g>
          <line x1="${K.pelvisR[0]+10}" y1="${K.pelvisR[1]-10}" x2="700" y2="370" stroke="#ef4444" stroke-width="1.5" stroke-dasharray="2 3"/>
          <rect x="592" y="346" width="190" height="58" rx="6" fill="#0b1220" stroke="#ef4444" stroke-opacity="0.85" stroke-width="2"/>
          <text x="687" y="362" fill="#f59e0b" font-size="10" font-family="Inter" font-weight="800" text-anchor="middle" letter-spacing="1">⚠ FLYING OPEN</text>
          <text x="687" y="382" fill="#e2e8f0" font-size="14" font-family="JetBrains Mono" font-weight="800" text-anchor="middle">${Math.round(xFactor)}<tspan font-size="10" fill="#94a3b8" font-family="Inter">° (정상 ≥ 5°)</tspan></text>
          <text x="687" y="396" fill="#fcd34d" font-size="9" font-family="Inter" text-anchor="middle">FC 시 몸통 분리 부족 — 일찍 열림</text>
        </g>` : ''}

        <!-- Knee Collapse -->
        ${kneeCollapse ? `
        <g>
          <line x1="${K.lKnee[0]-12}" y1="${K.lKnee[1]+4}" x2="180" y2="370" stroke="${kneeCollapseSevere ? '#ef4444' : '#f59e0b'}" stroke-width="1.5" stroke-dasharray="2 3"/>
          <rect x="42" y="346" width="176" height="58" rx="6" fill="#0b1220" stroke="${kneeCollapseSevere ? '#ef4444' : '#f59e0b'}" stroke-opacity="0.85" stroke-width="2"/>
          <text x="130" y="362" fill="${kneeCollapseSevere ? '#ef4444' : '#f59e0b'}" font-size="10" font-family="Inter" font-weight="800" text-anchor="middle" letter-spacing="1">${kneeCollapseSevere ? '🚨 무릎 무너짐' : '△ 무릎 굽힘 경향'}</text>
          <text x="130" y="381" fill="#e2e8f0" font-size="14" font-family="JetBrains Mono" font-weight="800" text-anchor="middle">Δ ${kneeChange.toFixed(1)}<tspan font-size="10" fill="#94a3b8" font-family="Inter">° (정상 ≥ -10°)</tspan></text>
          <text x="130" y="396" fill="${kneeCollapseSevere ? '#fca5a5' : '#fcd34d'}" font-size="9" font-family="Inter" text-anchor="middle">앞다리 블록 약화 — 에너지 손실</text>
        </g>` : ''}

        <!-- Drive 추진 약함 -->
        ${driveStatus === 'leak' || driveStatus === 'weak' ? `
        <g>
          <line x1="${K.rKnee[0]+8}" y1="${K.rKnee[1]+8}" x2="700" y2="438" stroke="${driveColors.label}" stroke-width="1.5" stroke-dasharray="2 3"/>
          <rect x="582" y="412" width="200" height="58" rx="6" fill="#0b1220" stroke="${driveColors.label}" stroke-opacity="0.85" stroke-width="2"/>
          <text x="682" y="428" fill="${driveColors.label}" font-size="10" font-family="Inter" font-weight="800" text-anchor="middle" letter-spacing="1">${driveColors.text}</text>
          <text x="682" y="446" fill="#e2e8f0" font-size="12" font-family="JetBrains Mono" font-weight="700" text-anchor="middle">vGRF ${trailVGRF != null ? trailVGRF.toFixed(2)+' BW' : '—'} · Hip P ${trailHipP != null ? trailHipP.toFixed(0)+'W' : '—'}</text>
          <text x="682" y="462" fill="#94a3b8" font-size="9" font-family="Inter" text-anchor="middle">Trail vGRF<1.5 BW or Trail Hip<800W</text>
        </g>` : ''}

        <!-- 누수 0개 시 ✅ -->
        ${(!ptLeak && !taLeak && !flyingOpen && !kneeCollapse && (driveStatus === 'normal' || driveStatus === 'na')) ? `
        <g>
          <rect x="280" y="495" width="400" height="38" rx="8" fill="#0b1f12" stroke="#4ade80" stroke-opacity="0.8" stroke-width="2"/>
          <text x="480" y="514" fill="#4ade80" font-size="13" font-family="Inter" font-weight="800" text-anchor="middle" letter-spacing="1">✅ 키네틱 체인 정상</text>
          <text x="480" y="528" fill="#86efac" font-size="10" font-family="Inter" text-anchor="middle">모든 단계 에너지 전달 효율 양호 — 누수 미감지</text>
        </g>` : ''}
      </svg>

      <div class="text-xs mt-2 px-2" style="color: #64748b;">
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
          <circle cx="${peakX}" cy="${peakY}" r="6.5" fill="${s.color}" stroke="#08080c" stroke-width="2" style="filter: url(#peakGlow-${uid})"/>
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
          <rect x="${xmid - 70}" y="${b.y - 22}" width="140" height="18" rx="3" fill="#0b1220" stroke="${clr}" stroke-opacity="0.75"/>
          <text x="${xmid}" y="${b.y - 9}" text-anchor="middle" font-size="11" fill="${clr}" font-weight="700" font-family="JetBrains Mono">Δt ${b.label} ${b.val} ms</text>
        </g>`;
    }).join('');

    const ticks = [-180, -150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150, 180]
      .filter(t => t >= tMin && t <= tMax)
      .map(t => `<line x1="${toX(t)}" x2="${toX(t)}" y1="${padT}" y2="${padT + plotH}" stroke="#1e293b" stroke-width="1" stroke-dasharray="2 4"/>`)
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
      <div class="display text-xl mb-1">📊 키네매틱 시퀀스 — 피크 속도 타이밍</div>
      <div class="text-sm mb-3" style="color: var(--text-secondary);">
        골반 → 몸통 → 팔 순서로 회전 속도가 정점을 찍어야 합니다. 각 단계 사이 lag은 <strong>40~50 ms</strong>가 이상적.
      </div>
      <div class="card p-3" style="background: #0a1322;">
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
              <stop offset="0" stop-color="#0a1322"/><stop offset="1" stop-color="#0d182b"/>
            </linearGradient>
            ${curveDefs}
          </defs>
          <rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="url(#plotBg-${uid})" rx="4"/>
          <rect x="${toX(30)}" y="${padT}" width="${toX(60) - toX(30)}" height="${plotH}" fill="rgba(74,222,128,0.05)"/>
          <rect x="${toX(60)}" y="${padT}" width="${toX(120) - toX(60)}" height="${plotH}" fill="rgba(74,222,128,0.04)"/>
          ${ticks}
          <line x1="${toX(0)}" x2="${toX(0)}" y1="${padT}" y2="${padT + plotH}" stroke="#475569" stroke-width="1.5" stroke-opacity="0.6"/>
          ${curveGroups}
          ${dtBars}
          <text x="${padL + 6}" y="${padT + 14}" fill="#64748b" font-size="9" font-family="Inter">↑ 정규화 회전 속도 (이상 lag 30~60 ms 영역 음영)</text>
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
