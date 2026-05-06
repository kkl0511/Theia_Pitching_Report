/**
 * theia_render.js — 메인 리포트 렌더 (Theia v0.7+)
 *
 * 의존:
 *   window.TheiaApp.ALGORITHM_VERSION
 *   window.TheiaApp.getFitnessData() / getFitnessMeta()
 *   window.TheiaCohort.getMode(modeId)
 *   window.TheiaMeta.OTL_CATEGORIES, getVarMeta()
 *   window.TheiaMannequin.renderMannequinUplift / renderKinematicBellUplift
 *   Chart.js (radar 차트)
 *
 * 노출: window.TheiaApp.renderReport (위임)
 */
(function () {
  'use strict';
  // 외부 의존 alias
  const _appVer = () => (window.TheiaApp && window.TheiaApp.ALGORITHM_VERSION) || 'v0.7';
  const _getFit = () => (window.TheiaApp && window.TheiaApp.getFitnessData ? window.TheiaApp.getFitnessData() : null);
  const _getFitMeta = () => (window.TheiaApp && window.TheiaApp.getFitnessMeta ? window.TheiaApp.getFitnessMeta() : null);
  const ALGORITHM_VERSION = 'v0.7';  // legacy 참조 호환 (실제로는 _appVer() 사용)

  // ════════════════════════════════════════════════════════════
  // ★ v0.62 — KBO 디자인 핸드오프 v0.8 (Navy/White) 8 컴포넌트 vanilla JS 헬퍼
  // 사용 위치: .kbo-scope 래퍼 안에서만 (index.html에 CSS 정의)
  // ════════════════════════════════════════════════════════════
  const KBO_T = {
    navy: '#0F2A4A', navySoft: '#2E75B6',
    text: '#1A1A1A', text2: '#3F3F46', textMuted: '#6B6357',
    bgCard: '#FFFFFF', bgElev: '#F3F1EC', border: '#DCD7CF', borderSoft: '#E8E4DD',
    good: '#16A34A', caution: '#B45309', leak: '#B91C1C', risk: '#7030A0',
    output: '#C00000', transfer: '#0070C0',
    fitness: '#0070C0', mechanics: '#C00000', injury: '#D97706',
  };

  // 1. MetricCard
  function _kboMetricCard({ label, value, unit, delta, deltaLabel, color = KBO_T.navy, hint, size = 'md' }) {
    const sizes = { sm: 32, md: 44, lg: 64, xl: 88 };
    const fontSize = sizes[size] || 44;
    return `<div style="min-width: 0;">
      <div class="kbo-eyebrow" style="margin-bottom: 6px;">${label}</div>
      <div style="display: flex; align-items: baseline; gap: 4px;">
        <span class="kbo-metric-num" style="font-size: ${fontSize}px; color: ${color};">${value}</span>
        ${unit ? `<span class="kbo-metric-unit" style="font-size: ${fontSize}px;">${unit}</span>` : ''}
      </div>
      ${delta ? `<div class="kbo-mono" style="font-size: 13px; color: ${KBO_T.good}; font-weight: 700; margin-top: 4px;">${delta}${deltaLabel ? `<span style="color: ${KBO_T.textMuted}; font-weight: 400; margin-left: 6px;">${deltaLabel}</span>` : ''}</div>` : ''}
      ${hint ? `<div style="font-size: 12px; color: ${KBO_T.textMuted}; margin-top: 4px;">${hint}</div>` : ''}
    </div>`;
  }

  // 2. ConfidenceBadge
  function _kboConfidenceBadge({ level = 'm', n, total, label } = {}) {
    const map = { h: { cls: 'kbo-conf-h', txt: 'High' }, m: { cls: 'kbo-conf-m', txt: 'Medium' }, l: { cls: 'kbo-conf-l', txt: 'Low' } };
    const m = map[level] || map.m;
    return `<span class="kbo-conf ${m.cls}">
      <span style="font-weight: 700;">● ${m.txt}</span>
      ${n != null ? `<span style="opacity: 0.7;">${n}/${total}</span>` : ''}
      ${label ? `<span style="opacity: 0.7;">${label}</span>` : ''}
    </span>`;
  }

  // 3. StatusPill
  function _kboStatusPill({ kind = 'good', text = '' }) {
    const map = { good: 'kbo-pill-good', caution: 'kbo-pill-caution', leak: 'kbo-pill-leak', risk: 'kbo-pill-risk' };
    return `<span class="kbo-pill ${map[kind] || map.good}">${text}</span>`;
  }

  // 4. SectionTitle
  function _kboSectionTitle({ kicker, title, sub, right = '' } = {}) {
    return `<div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 14px; gap: 12px; flex-wrap: wrap;">
      <div>
        ${kicker ? `<div class="kbo-eyebrow" style="margin-bottom: 4px;">${kicker}</div>` : ''}
        <div class="kbo-display" style="font-size: 18px; color: ${KBO_T.navy}; font-weight: 700;">${title}</div>
        ${sub ? `<div style="font-size: 13px; color: ${KBO_T.textMuted}; margin-top: 2px;">${sub}</div>` : ''}
      </div>
      ${right}
    </div>`;
  }

  // 5. PageHeader
  function _kboPageHeader({ num, en, kr, q }) {
    return `<div class="kbo-page-head">
      <span class="kbo-page-num">P${num}</span>
      <span class="kbo-page-title-en">${en}</span>
      <span class="kbo-page-title-kr">— ${kr}</span>
      ${q ? `<span class="kbo-page-q">${q}</span>` : ''}
    </div>`;
  }

  // 6. FaultCard
  function _kboFaultCard({ stage, title, severity = 'high', evidence, result, drill, accent = KBO_T.leak }) {
    return `<div class="kbo-card" style="padding: 22px; border-top: 3px solid ${accent}; display: flex; flex-direction: column; gap: 12px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
        <div>
          <div class="kbo-eyebrow" style="color: ${accent}; margin-bottom: 4px;">${stage}</div>
          <div class="kbo-display" style="font-size: 22px; color: ${KBO_T.text}; line-height: 1.2;">${title}</div>
        </div>
        ${_kboStatusPill({ kind: severity === 'high' ? 'leak' : 'caution', text: severity === 'high' ? '★★★ 매우 높음' : '★★ 중간' })}
      </div>
      <div style="display: grid; grid-template-columns: 88px 1fr; gap: 10px; font-size: 13px; line-height: 1.55;">
        <div class="kbo-eyebrow" style="padding-top: 2px;">근거</div><div style="color: ${KBO_T.text2};">${evidence}</div>
        <div class="kbo-eyebrow" style="padding-top: 2px;">결과</div><div style="color: ${KBO_T.text2};">${result}</div>
        <div class="kbo-eyebrow" style="padding-top: 2px;">처방</div><div style="color: ${KBO_T.text2};">${drill}</div>
      </div>
    </div>`;
  }

  // 7. EvidenceModule
  function _kboEvidenceModule({ proves, title, conf, footnote, body = '' } = {}) {
    return `<div class="kbo-card" style="padding: 20px;">
      <div class="kbo-eyebrow" style="color: ${KBO_T.navySoft}; margin-bottom: 4px;">이것이 증명하는 것</div>
      <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 12px;">
        <div class="kbo-display" style="font-size: 16px; color: ${KBO_T.text};">${proves}</div>
        ${conf ? _kboConfidenceBadge({ level: conf }) : ''}
      </div>
      ${title ? `<div style="font-size: 12px; color: ${KBO_T.textMuted}; margin-bottom: 12px;">${title}</div>` : ''}
      ${body}
      ${footnote ? `<div style="font-size: 11px; color: ${KBO_T.textMuted}; margin-top: 12px; padding-top: 10px; border-top: 1px dashed ${KBO_T.borderSoft};">${footnote}</div>` : ''}
    </div>`;
  }

  // 8. PilotRoadmap
  function _kboPilotRoadmap({ weeks }) {
    const items = (weeks || []).map(w => `<div style="text-align: center;">
      <div style="width: 56px; height: 56px; margin: 0 auto; border-radius: 50%; background: ${w.milestone ? KBO_T.navy : KBO_T.bgCard}; border: 2px solid ${w.milestone ? KBO_T.navy : KBO_T.border}; display: flex; align-items: center; justify-content: center; color: ${w.milestone ? '#fff' : KBO_T.navy};">
        <div class="kbo-display" style="font-size: 13px; line-height: 1; text-align: center;">${w.range}</div>
      </div>
      <div class="kbo-display" style="font-size: 14px; margin-top: 12px; color: ${KBO_T.text};">${w.title}</div>
      <div style="font-size: 12px; color: ${KBO_T.textMuted}; margin-top: 4px; line-height: 1.5;">${w.detail || ''}</div>
    </div>`).join('');
    return `<div style="position: relative;">
      <div style="position: absolute; left: 28px; right: 28px; top: 28px; height: 2px; background: ${KBO_T.border}; z-index: 0;"></div>
      <div style="display: grid; grid-template-columns: repeat(${(weeks||[]).length || 4}, 1fr); gap: 12px; position: relative; z-index: 1;">${items}</div>
    </div>`;
  }

  // ★ v0.57 — 6페이지 재구조화 (wireframe pack 기반)
  //   P1 한눈에 보는 결론 → P2 Force Generation → P3 Force Transmission
  //   → P4 Root-Cause Timeline → P5 Evidence Dashboard → P6 Action Plan & Retest
  //
  //   설계 원칙:
  //   1) Mechanics 점수(P2)와 ELI 점수(P3)는 절대 같은 화면에 동시 표시 금지
  //   2) 각 페이지는 하나의 질문에 답함 (요약·상세 혼재 금지)
  //   3) Timing: Stability(반복성) vs Quality(최적성) 분리
  //   4) Risk: Cost efficiency vs 절대부하 모니터링 분리
  //   5) GRF: vGRF(수직 지지) vs AP impulse(전진 추진) 명시 분리
  //   6) Confidence Badge: 미측정 변수 의존 산출에 항상 표시
  function renderReport(result) {
    const html = [
      _renderPageNav(result),       // 0. 페이지 navigation (sticky)
      _renderP1Summary(result),     // P1. Executive Summary — 한눈에 보는 결론
      _renderP2Generation(result),  // P2. Force Generation Profile — 힘을 얼마나 만들었나
      _renderP3Transmission(result),// P3. Force Transmission Map — 힘이 어디서 새는가
      _renderP4RootCause(result),   // P4. Root-Cause Timeline — 어떤 동작이 막는가
      _renderP5Evidence(result),    // P5. Evidence Dashboard — 진단 근거
      _renderP6Action(result),      // P6. Action Plan & Retest — 무엇을 어떻게 고칠 것인가
      _renderELIReferences(result), // 부록 — 참고문헌 (접기)
      _renderActionButtons(result), // [저장 / 다운로드 / 인쇄]
    ].join('\n');
    setTimeout(() => _initRadarCharts(result), 100);
    return html;
  }

  // ════════════════════════════════════════════════════════════
  // v0.57 — 페이지 navigation + 6 페이지 placeholder
  //   현재는 기존 섹션을 그룹핑해서 스토리 라인을 만들고,
  //   각 페이지마다 점진적으로 신규 시각화·라벨 정리 적용
  // ════════════════════════════════════════════════════════════
  function _renderPageNav(result) {
    const pages = [
      { id: 'p1', n: '1', label: '한눈에 보는 결론',     desc: 'Executive Summary' },
      { id: 'p2', n: '2', label: '힘을 얼마나 만들었나', desc: 'Force Generation' },
      { id: 'p3', n: '3', label: '힘이 어디서 새는가',   desc: 'Force Transmission' },
      { id: 'p4', n: '4', label: '어떤 동작이 막는가',   desc: 'Root-Cause Timeline' },
      { id: 'p5', n: '5', label: '진단 근거',           desc: 'Evidence Dashboard' },
      { id: 'p6', n: '6', label: '훈련 처방',           desc: 'Action & Retest' },
    ];
    const tab = (p) => `
      <a href="#${p.id}" class="p-nav-tab" data-page="${p.id}">
        <span class="p-nav-num">${p.n}</span>
        <span class="p-nav-text">
          <span class="p-nav-label">${p.label}</span>
          <span class="p-nav-desc">${p.desc}</span>
        </span>
      </a>`;
    return `
    <style>
      .p-nav { position: sticky; top: 0; z-index: 50; background: var(--bg-primary); border-bottom: 1px solid var(--border); padding: 12px 0; margin-bottom: 24px; }
      .p-nav-inner { display: flex; gap: 8px; overflow-x: auto; padding: 0 8px; scrollbar-width: thin; }
      .p-nav-tab { flex: 1; min-width: 130px; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-card); text-decoration: none; transition: all 0.15s; }
      .p-nav-tab:hover { border-color: var(--accent); background: var(--bg-elevated); }
      .p-nav-num { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; background: var(--accent); color: white; font-weight: 700; font-size: 14px; flex-shrink: 0; }
      .p-nav-text { display: flex; flex-direction: column; line-height: 1.2; min-width: 0; }
      .p-nav-label { font-size: 13px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .p-nav-desc { font-size: 10px; color: var(--text-muted); letter-spacing: 0.04em; text-transform: uppercase; }
      .report-page { scroll-margin-top: 90px; padding: 8px 0 32px; border-bottom: 1px dashed var(--border); margin-bottom: 16px; }
      .report-page:last-of-type { border-bottom: none; }
      .page-banner { display: flex; align-items: baseline; gap: 14px; margin-bottom: 6px; padding-bottom: 8px; border-bottom: 2px solid var(--accent); }
      .page-banner-num { font-size: 32px; font-weight: 800; color: var(--accent); line-height: 1; }
      .page-banner-title { font-size: 22px; font-weight: 700; color: var(--text-primary); }
      .page-banner-q { font-size: 13px; color: var(--text-muted); margin-left: auto; font-style: italic; }
      .page-intro { font-size: 13px; color: var(--text-secondary); margin: 8px 0 18px; }
      .scope-chip { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
      .scope-gen   { background: rgba(192,0,0,0.12);   color: var(--output); }
      .scope-trans { background: rgba(0,112,192,0.12); color: var(--transfer); }
      .scope-fault { background: rgba(112,48,160,0.12); color: var(--leak); }
      .scope-evid  { background: rgba(46,125,50,0.12); color: var(--control); }
      .scope-act   { background: rgba(217,119,6,0.12); color: var(--injury); }
      .scope-risk  { background: rgba(220,38,38,0.12); color: var(--bad); }
      .scope-cons  { background: rgba(75,85,99,0.18);  color: var(--text-secondary); }
      .conf-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; }
      .conf-high { background: rgba(74,222,128,0.15); color: var(--good); border: 1px solid rgba(74,222,128,0.3); }
      .conf-med  { background: rgba(251,191,36,0.15); color: var(--warn); border: 1px solid rgba(251,191,36,0.3); }
      .conf-low  { background: rgba(248,113,113,0.15); color: var(--bad);  border: 1px solid rgba(248,113,113,0.3); }
    </style>
    <div class="p-nav">
      <div class="p-nav-inner">
        ${pages.map(tab).join('')}
      </div>
    </div>`;
  }

  // 페이지 배너 helper
  function _pageBanner(num, title, en, q) {
    return `
    <div class="page-banner">
      <div class="page-banner-num">P${num}</div>
      <div class="page-banner-title">${title} <span style="font-size: 14px; color: var(--text-muted); font-weight: 500;">— ${en}</span></div>
      <div class="page-banner-q">Q. ${q}</div>
    </div>`;
  }

  // 신뢰도 평가 helper (★ v0.57)
  // 측정 변수 개수와 미측정 체력 변수에 따라 high/medium/low 반환
  function _assessConfidence(result) {
    const m = result.varScores || {};
    const measuredCount = Object.keys(m).filter(k => m[k]?.value != null).length;
    const fit = _getFit() || {};
    const fitKeys = ['CMJ_height','SJ_height','IMTP_peak_force','SquatJump_RSI'];
    const fitMeasured = fitKeys.filter(k => fit[k] != null).length;
    if (measuredCount >= 40 && fitMeasured >= 3) return { level: 'high', label: '신뢰도 높음', cls: 'conf-high', icon: '●' };
    if (measuredCount >= 25 && fitMeasured >= 1) return { level: 'med',  label: '신뢰도 중간', cls: 'conf-med',  icon: '◐' };
    return { level: 'low', label: '신뢰도 낮음', cls: 'conf-low', icon: '○' };
  }

  // ★ v0.65 — PDF §5 신규 시각화 #3: Energy Transfer Bar
  // 골반 work → 몸통 받은 에너지 → 팔 받은 에너지 — 단계별 절대값 + ETE 비율
  function _renderEnergyTransferBar(result) {
    const m = result.varScores || {};
    const v = (k) => m[k]?.value;
    const W_hip = v('W_hip_pos_KH_FC');                    // 골반이 만든 힘 (J)
    const dE_trunk = v('dE_trunk_KH_FC');                  // 몸통이 받은 힘 (J)
    const dE_arm = v('dE_arm_FC_BR');                      // 팔이 받은 힘 (J)
    const ete_p2t = v('ETE_pelvis_to_trunk');              // 비율
    const ete_t2a = v('ETE_trunk_to_arm');                 // 비율
    if (W_hip == null && dE_trunk == null && dE_arm == null) return '';

    const items = [
      { label: '골반 출력', sub: 'Generation · 하체 추진', val: W_hip, color: KBO_T.output, badge: '출력 source' },
      { label: '몸통 받음', sub: 'Transfer 1 · 하체 → 몸통', val: dE_trunk, color: KBO_T.transfer, badge: ete_p2t != null ? `전달율 ${(ete_p2t*100).toFixed(0)}%` : '' },
      { label: '팔 받음',   sub: 'Transfer 2 · 몸통 → 팔',   val: dE_arm, color: KBO_T.injury, badge: ete_t2a != null ? `전달율 ${(ete_t2a*100).toFixed(0)}%` : '' },
    ];
    const measured = items.filter(x => x.val != null);
    if (measured.length === 0) return '';
    const maxV = Math.max(...measured.map(x => x.val));

    const rows = items.map((x, i) => {
      const w = x.val != null ? Math.max(8, Math.min(100, x.val / maxV * 100)) : 0;
      const arrow = i < items.length - 1 && x.val != null && items[i+1].val != null
        ? `<div style="text-align: center; padding: 6px 0; color: ${KBO_T.textMuted}; font-size: 18px;">↓</div>` : '';
      return `<div style="display: grid; grid-template-columns: 160px 1fr 100px 110px; gap: 14px; align-items: center; padding: 8px 0;">
        <div>
          <div style="font-size: 13px; color: ${KBO_T.text}; font-weight: 700;">${x.label}</div>
          <div style="font-size: 10px; color: ${KBO_T.textMuted};">${x.sub}</div>
        </div>
        <div style="background: ${KBO_T.bgElev}; height: 28px; border-radius: 5px; position: relative; overflow: hidden;">
          ${x.val != null ? `<div style="position: absolute; inset: 0 ${100-w}% 0 0; background: ${x.color}; opacity: 0.85; border-radius: 5px;"></div>` : ''}
          <div style="position: absolute; inset: 0; display: flex; align-items: center; padding: 0 12px; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: ${x.val != null ? '#fff' : KBO_T.textMuted}; font-weight: 700; text-shadow: ${x.val != null ? '0 1px 2px rgba(0,0,0,0.3)' : 'none'};">
            ${x.val != null ? `${x.val.toFixed(1)} J` : '미측정'}
          </div>
        </div>
        <div class="kbo-mono" style="font-size: 11px; color: ${KBO_T.navySoft}; font-weight: 600; text-align: right;">${x.badge}</div>
        <div style="font-size: 10px; color: ${KBO_T.textMuted};">${i === 0 ? '하체에서 만든 힘' : i === 1 ? '몸통이 흡수한 힘' : '팔에 도달한 힘'}</div>
      </div>${arrow}`;
    }).join('');

    const leak1 = (W_hip != null && dE_trunk != null) ? (1 - dE_trunk / W_hip) * 100 : null;
    const leak2 = (dE_trunk != null && dE_arm != null) ? (1 - dE_arm / dE_trunk) * 100 : null;
    const leakNote = (leak1 != null || leak2 != null) ? `
      <div style="margin-top: 12px; padding: 10px 14px; border-left: 3px solid ${KBO_T.leak}; background: rgba(185,28,28,0.05); border-radius: 4px; font-size: 12px; color: ${KBO_T.text2};">
        ⚠ <strong>누수 진단</strong>:
        ${leak1 != null ? `골반→몸통 누수 <strong>${leak1.toFixed(0)}%</strong>` : ''}
        ${leak1 != null && leak2 != null ? ' · ' : ''}
        ${leak2 != null ? `몸통→팔 누수 <strong>${leak2.toFixed(0)}%</strong>` : ''}
        — 누수가 큰 단계가 메카닉 코칭 1순위
      </div>` : '';

    return `<div class="kbo-card" style="padding: 22px 24px; margin: 18px 0;">
      ${_kboSectionTitle({
        kicker: 'Energy Transfer · 흐름 시각화',
        title: '하체에서 만든 힘이 몸통·팔로 얼마나 넘어가는가',
        sub: '단계별 절대 에너지(J) + 전달율 % — Generation과 Transmission을 한 흐름으로 연결',
      })}
      ${rows}
      ${leakNote}
    </div>`;
  }

  // ★ v0.65 — PDF §5 신규 시각화 #4: Fault-to-Loss Causal Chain
  // 결함 → 누수1 → 누수2 → 결과 한 줄 horizontal flow (P4 인과 카드 강화)
  function _renderFaultLossCausalChain(result) {
    const m = result.varScores || {};
    const v = (k) => m[k]?.value;
    const s = (k) => m[k]?.score;

    // 가장 큰 누수 chain 자동 선택 — 점수 낮은 것 우선
    const chain = [
      { node: '앞무릎 무너짐', metric: v('knee_flexion_change_MER_to_BR'), unit: '°', score: s('knee_flexion_change_MER_to_BR'), color: KBO_T.leak, kind: 'fault' },
      { node: 'Lead 브레이킹 부족', metric: v('lead_leg_braking_impulse'), unit: 'BW·s', score: s('lead_leg_braking_impulse'), color: KBO_T.caution, kind: 'leak' },
      { node: 'Pelvis 감속 지연', metric: v('pelvis_deceleration'), unit: '°/s²', score: s('pelvis_deceleration'), color: KBO_T.caution, kind: 'leak' },
      { node: 'Trunk 전달 저하', metric: v('ETE_pelvis_to_trunk'), unit: 'ratio', score: s('ETE_pelvis_to_trunk'), color: KBO_T.transfer, kind: 'transfer' },
      { node: '팔 보상 ↑', metric: v('Arm_peak'), unit: '°/s', score: s('Arm_peak'), color: KBO_T.injury, kind: 'result' },
    ];
    const measured = chain.filter(x => x.metric != null);
    if (measured.length < 3) return '';

    const nodeBox = (x, idx) => {
      const sc = x.score;
      const sColor = sc == null ? KBO_T.textMuted : sc >= 60 ? KBO_T.good : sc >= 40 ? KBO_T.caution : KBO_T.leak;
      const kindLabel = { fault: '결함', leak: '누수', transfer: '전달 저하', result: '결과' }[x.kind];
      return `<div style="flex: 1; min-width: 130px; padding: 12px 10px; background: ${KBO_T.bgCard}; border-top: 3px solid ${x.color}; border-radius: 6px; box-shadow: ${KBO_T.shadow}; text-align: center;">
        <div class="kbo-eyebrow" style="color: ${x.color}; margin-bottom: 4px; font-size: 9px;">${idx === 0 ? '★ ' : ''}${kindLabel}</div>
        <div style="font-size: 12px; color: ${KBO_T.text}; font-weight: 700; line-height: 1.3; margin-bottom: 6px;">${x.node}</div>
        ${x.metric != null ? `<div class="kbo-mono" style="font-size: 11px; color: ${KBO_T.text2};">${x.metric.toFixed(2)} ${x.unit}</div>` : ''}
        ${sc != null ? `<div class="kbo-mono" style="font-size: 11px; color: ${sColor}; font-weight: 700; margin-top: 4px;">${sc}점</div>` : ''}
      </div>`;
    };

    const arrow = `<div style="display: flex; align-items: center; padding: 0 4px; color: ${KBO_T.textMuted}; font-size: 22px; font-weight: 700;">→</div>`;
    const flow = chain.map((x, i) => i === 0 ? nodeBox(x, i) : arrow + nodeBox(x, i)).join('');

    return `<div class="kbo-card" style="padding: 22px 24px; margin: 18px 0;">
      ${_kboSectionTitle({
        kicker: 'Fault-to-Loss Causal Chain · 결함 → 누수 → 결과',
        title: '하나의 결함이 어떻게 팔까지 영향을 주는가',
        sub: '왼쪽이 원인(결함), 오른쪽이 결과(팔 보상). 각 박스의 색상 border가 손실 단계를 구분.',
      })}
      <div style="display: flex; align-items: stretch; gap: 4px; overflow-x: auto; padding: 4px 0;">
        ${flow}
      </div>
      <div style="margin-top: 12px; padding: 10px 14px; background: ${KBO_T.bgElev}; border-radius: 4px; font-size: 12px; color: ${KBO_T.text2}; line-height: 1.6;">
        💡 <strong>해석</strong>: 첫 박스(<span style="color: ${KBO_T.leak}; font-weight: 700;">결함</span>)가 가장 빠르게 고칠 수 있는 지점. 마지막 박스(<span style="color: ${KBO_T.injury}; font-weight: 700;">팔 보상</span>)는 부상 위험 신호 — 결함을 고치면 팔 보상이 자동 감소합니다.
      </div>
    </div>`;
  }

  // ★ v0.65 — PDF §5 신규 시각화 #5: Before/After Re-test Slots
  // 6주 재측정 후 채울 ghost 카드 — 영업 클로징 (도입 → 6주 → 검증 흐름)
  function _renderBeforeAfterRetestSlots(result) {
    const m = result.varScores || {};
    const cs = result.catScores || {};
    const v = (k) => m[k]?.value;
    const ballSp = v('ball_speed');
    const slots = [
      { label: '측정 구속',     before: ballSp,                  unit: 'km/h', target: '+3~5 km/h', color: KBO_T.text2 },
      { label: '메카닉 종합',   before: cs.OUTPUT?.score,        unit: '/100', target: '+10~15점',  color: KBO_T.output },
      { label: '에너지 전달',   before: cs.TRANSFER?.score,      unit: '/100', target: '+15~20점',  color: KBO_T.transfer },
      { label: '제구 일관성',   before: cs.CONTROL?.score,       unit: '/100', target: '안정 유지', color: KBO_T.good },
    ];
    const slotCard = (s) => `<div class="kbo-card" style="padding: 16px;">
      <div class="kbo-eyebrow" style="color: ${s.color}; margin-bottom: 8px;">${s.label}</div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
        <div>
          <div style="font-size: 9px; color: ${KBO_T.textMuted}; letter-spacing: 0.1em; margin-bottom: 4px;">BEFORE · 도입 측정</div>
          <div style="display: flex; align-items: baseline; gap: 4px;">
            <span class="kbo-metric-num" style="font-size: 28px; color: ${s.color};">${s.before != null ? (typeof s.before === 'number' ? s.before.toFixed(s.unit === 'km/h' ? 1 : 0) : s.before) : '—'}</span>
            <span style="font-size: 10px; color: ${KBO_T.textMuted};">${s.unit}</span>
          </div>
        </div>
        <div style="border-left: 2px dashed ${KBO_T.border}; padding-left: 14px;">
          <div style="font-size: 9px; color: ${KBO_T.navy}; letter-spacing: 0.1em; margin-bottom: 4px;">AFTER · 6주 retest 목표</div>
          <div style="display: flex; align-items: baseline; gap: 4px;">
            <span class="kbo-metric-num" style="font-size: 28px; color: ${KBO_T.borderSoft};">__.__</span>
            <span style="font-size: 10px; color: ${KBO_T.textMuted};">${s.unit}</span>
          </div>
          <div class="kbo-mono" style="font-size: 10px; color: ${KBO_T.good}; font-weight: 700; margin-top: 4px;">▲ ${s.target}</div>
        </div>
      </div>
    </div>`;

    return `<div class="kbo-card" style="padding: 22px 24px; margin: 18px 0; background: linear-gradient(135deg, rgba(15,42,74,0.03), transparent);">
      ${_kboSectionTitle({
        kicker: 'Pilot Retest · Before/After',
        title: '6주 후 같은 리포트로 검증',
        sub: '각 카드의 오른쪽 칸은 6주 retest에서 채워질 자리입니다 — 도입 효과를 같은 지표로 직접 비교',
      })}
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
        ${slots.map(slotCard).join('')}
      </div>
      <div style="margin-top: 14px; padding: 10px 14px; border-left: 3px solid ${KBO_T.navy}; background: rgba(15,42,74,0.04); border-radius: 4px; font-size: 12px; color: ${KBO_T.text2};">
        🎯 <strong>서비스 클로징</strong>: 6주 코칭 + retest = 1 사이클. 개선이 수치로 증명되지 않으면 다음 사이클 비용 X. 검증 가능한 결과 기반 도입.
      </div>
    </div>`;
  }

  // ★ v0.64 — PDF §3 5축 계층화: Generation/Transmission/Leak/Load/Consistency 한눈 보드
  // ELI는 Transmission 하위 진단 도구로 명시 (별도 종합점수 X)
  function _render5AxisBoard(result) {
    const cs = result.catScores || {};
    const axes = [
      { id: 'OUTPUT',   label: '출력',           sub: 'Power Generation',     color: KBO_T.output,     dir: '높을수록 좋음', icon: '⚡' },
      { id: 'TRANSFER', label: '에너지 전달',    sub: 'Transfer Efficiency',  color: KBO_T.transfer,   dir: '높을수록 좋음', icon: '🔋', note: 'ELI는 이 축의 하위 진단' },
      { id: 'LEAK',     label: '누수',           sub: 'Leak / Fault',         color: KBO_T.leak,       dir: '높을수록 좋음 (누수 적음)', icon: '⚠' },
      { id: 'INJURY',   label: '부하 안전도',    sub: 'Load Safety',          color: KBO_T.injury,     dir: '높을수록 안전', icon: '🛡' },
      { id: 'CONTROL',  label: '제구·일관성',    sub: 'Consistency',          color: KBO_T.good,       dir: '높을수록 좋음', icon: '🎯' },
    ];
    const axisCard = a => {
      const c = cs[a.id] || {};
      const sc = c.score;
      const measured = c.measured || 0;
      const total = c.total || 0;
      const scColor = sc == null ? KBO_T.textMuted : sc >= 75 ? KBO_T.good : sc >= 50 ? a.color : sc >= 30 ? KBO_T.caution : KBO_T.leak;
      return `<div class="kbo-card" style="padding: 16px 18px; border-left: 3px solid ${a.color};">
        <div class="kbo-eyebrow" style="color: ${a.color}; margin-bottom: 4px;">${a.icon} ${a.label}</div>
        <div style="font-size: 11px; color: ${KBO_T.textMuted}; margin-bottom: 10px; font-style: italic;">${a.sub}</div>
        <div style="display: flex; align-items: baseline; gap: 4px;">
          <span class="kbo-metric-num" style="font-size: 36px; color: ${scColor};">${sc != null ? sc : '—'}</span>
          <span style="font-size: 11px; color: ${KBO_T.textMuted}; margin-left: 4px;">/100</span>
        </div>
        <div style="font-size: 10px; color: ${KBO_T.textMuted}; margin-top: 6px; line-height: 1.4;">
          ↑ ${a.dir}<br>
          <span class="kbo-mono">측정 ${measured}/${total}</span>
          ${a.note ? `<br><span style="color: ${KBO_T.navySoft};">· ${a.note}</span>` : ''}
        </div>
      </div>`;
    };
    return `
    <div style="margin-top: 18px; margin-bottom: 18px;">
      ${_kboSectionTitle({
        kicker: '5-Axis Diagnosis · Power → Transfer → Leak → Load → Control',
        title: '다섯 축으로 본 종합 점수',
        sub: '“구속/구위 결과”가 아니라 “왜 그런 결과가 나왔는가”를 다섯 축으로 분리. ELI는 에너지 전달 축의 하위 진단.',
      })}
      <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px;">
        ${axes.map(axisCard).join('')}
      </div>
    </div>`;
  }

  // ── P1 Executive Summary (★ v0.62 KBO Navy/White 디자인 핸드오프 v0.8 적용) ──
  function _renderP1Summary(result) {
    const m = result.varScores || {};
    const meta = result._meta || {};
    const pred = _predictPotentialVelo(result);
    const fit = _getFit() || {};
    const fitN = ['imtp_peak_force_bm','cmj_peak_power_bm','cmj_rsi_modified','bmi'].filter(k => fit[k] != null).length;

    const cur     = pred?.current ?? null;
    const fitOnly = pred?.fitOnly ?? null;
    const mechOnly= pred?.mechOnly ?? null;
    const both    = pred?.both ?? null;
    const dFit  = (cur != null && fitOnly != null) ? +(fitOnly - cur).toFixed(1) : null;
    const dMech = (cur != null && mechOnly != null) ? +(mechOnly - cur).toFixed(1) : null;
    const dBoth = (cur != null && both != null) ? +(both - cur).toFixed(1) : null;

    const hand = meta.handedness || 'right';
    const handLabel = hand === 'left' ? '좌투' : '우투';
    const level = meta.level || '프로';
    const athlete = meta.athlete || '신규 선수';
    const playerMode = _getPlayerMode(hand, cur);
    const typeColor = playerMode?.color || KBO_T.injury;

    // Waterfall 4-row
    const wfRow = (lab, val, w, col, delta, note) => `
      <div style="display: grid; grid-template-columns: 140px 1fr 80px 1fr; gap: 16px; align-items: center; padding: 10px 0;">
        <div style="font-size: 14px; color: ${KBO_T.text}; font-weight: 600;">${lab}</div>
        <div style="background: ${KBO_T.bgElev}; height: 32px; border-radius: 6px; position: relative; overflow: hidden;">
          <div style="position: absolute; inset: 0 ${100-w}% 0 0; background: ${col}; opacity: 0.92; border-radius: 6px;"></div>
          <div style="position: absolute; inset: 0; display: flex; align-items: center; padding: 0 14px; font-family: 'Space Grotesk', sans-serif; font-size: 16px; color: #fff; font-weight: 700; text-shadow: 0 1px 2px rgba(0,0,0,0.25);">
            ${val != null ? val.toFixed(1) : '—'} <span style="font-size: 11px; margin-left: 4px; opacity: 0.85;">km/h</span>
          </div>
        </div>
        <div class="kbo-mono" style="font-size: 14px; color: ${delta != null && delta > 0 ? KBO_T.good : KBO_T.textMuted}; font-weight: 700; text-align: right;">${delta != null && delta > 0 ? '+'+delta.toFixed(1) : '—'}</div>
        <div style="font-size: 12px; color: ${KBO_T.textMuted};">${note}</div>
      </div>`;
    const maxBoth = Math.max(140, both || 140);
    const wfRows = [
      [ '측정 구속',          cur,      cur     ? Math.round(cur     /maxBoth*100) : 65, KBO_T.text2,     null,  `Trial 평균 (n=${result._n_trials || '?'})` ],
      [ '체력만 발전',        fitOnly,  fitOnly ? Math.round(fitOnly /maxBoth*100) : 67, KBO_T.fitness,   dFit,  '체력 카테고리 점수 부족분 100% 채움' ],
      [ '메카닉만 발전',      mechOnly, mechOnly? Math.round(mechOnly/maxBoth*100) : 80, KBO_T.mechanics, dMech, 'Output + Transfer 부족분 100% 채움 — 가장 큰 수익' ],
      [ '동시 발전 (상한)',   both,     both    ? Math.round(both    /maxBoth*100) : 92, KBO_T.injury,    dBoth, '체력·메카닉 동시 향상 시 6주 retest 도달 가능' ],
    ].map(([l,v,w,c,d,n]) => wfRow(l,v,w,c,d,n)).join('');

    const confLevel = fitN >= 3 ? 'h' : fitN >= 1 ? 'm' : 'l';
    const confLabel = fitN === 0 ? '체력 미측정' : `체력 ${fitN}/4`;

    // Headline
    const headline = `
      <div style="margin-bottom: 32px;">
        <div class="kbo-eyebrow" style="margin-bottom: 10px;">The Theia Take · ${athlete} · ${level} ${handLabel}</div>
        <div class="kbo-headline">
          현재 <em>${cur != null ? cur.toFixed(1) : '—'} km/h</em> · 메카닉 정돈만으로 <em>${dMech != null && dMech > 0 ? '+'+dMech.toFixed(1) : '—'} km/h</em>,<br/>
          체력 동반 발전 시 상한 <em>${both != null ? both.toFixed(1) : '—'} km/h</em>.
        </div>
        <div style="font-size: 14px; color: ${KBO_T.textMuted}; margin-top: 12px; max-width: 720px;">
          유형 — <span style="color: ${typeColor}; font-weight: 700;">${playerMode?.label || '평가'}</span> ·
          ${playerMode?.desc || '출력·전달·반복성 종합 — 자세한 진단은 P2~P4 참조'}
        </div>
      </div>`;

    // Waterfall card
    const waterfall = `
      <div class="kbo-card" style="padding: 24px; margin-bottom: 18px;">
        ${_kboSectionTitle({
          kicker: 'Velocity Upside · Waterfall',
          title: '어디를 고치면 어디까지 오르는가',
          sub: '측정값 대비 체력·메카닉 향상이 가져올 잠재 구속 단계 비교',
          right: _kboConfidenceBadge({ level: confLevel, label: confLabel }),
        })}
        ${wfRows}
        ${fitN < 3 ? `<div style="margin-top: 14px; padding: 10px 14px; border-left: 3px solid ${KBO_T.caution}; background: rgba(180,83,9,0.05); border-radius: 4px; font-size: 12px; color: ${KBO_T.text2};">
          체력 측정 변수 ${fitN}/4 — "체력만 발전" 추정치는 placeholder. VALD(SJ/CMJ/IMTP) 입력 후 신뢰도 High로 전환됩니다.
        </div>` : ''}
      </div>`;

    // 3 KPI cards
    const kpis = `
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px;">
        <div class="kbo-card" style="padding: 20px; border-left: 3px solid ${KBO_T.fitness};">
          ${_kboMetricCard({ label: '체력 (Fitness)', value: fitOnly != null ? fitOnly.toFixed(1) : '—', unit: ' km/h',
            delta: dFit != null && dFit > 0 ? '+'+dFit.toFixed(1) : null, deltaLabel: 'km/h',
            color: KBO_T.fitness, size: 'lg', hint: 'VALD 보강 시 신뢰도 향상' })}
        </div>
        <div class="kbo-card" style="padding: 20px; border-left: 3px solid ${KBO_T.mechanics};">
          ${_kboMetricCard({ label: '메카닉 (Mechanics)', value: mechOnly != null ? mechOnly.toFixed(1) : '—', unit: ' km/h',
            delta: dMech != null && dMech > 0 ? '+'+dMech.toFixed(1) : null, deltaLabel: 'km/h · ★ 가장 큰 수익',
            color: KBO_T.mechanics, size: 'lg', hint: 'Output + Transfer 회복' })}
        </div>
        <div class="kbo-card" style="padding: 20px; border-left: 3px solid ${KBO_T.injury};">
          ${_kboMetricCard({ label: '동시 발전 상한', value: both != null ? both.toFixed(1) : '—', unit: ' km/h',
            delta: dBoth != null && dBoth > 0 ? '+'+dBoth.toFixed(1) : null, deltaLabel: 'km/h · 6주 ceiling',
            color: KBO_T.injury, size: 'lg', hint: '둘 다 향상 시 retest 목표' })}
        </div>
      </div>`;

    return `
    <section id="p1" class="report-page kbo-scope">
      <div class="kbo-pad">
        ${_kboPageHeader({ num: '1', en: 'Executive Demo Summary', kr: '한눈에 보는 결론', q: '이 선수는 어떤 유형이고 어디를 먼저 고치면 속도가 오르는가' })}
        ${headline}
        ${waterfall}
        ${kpis}
        ${_render5AxisBoard(result)}
      </div>
    </section>`;
  }

  // ★ v0.61 — PDF §5 추가 시각화: Confidence Coverage Strip
  // 카테고리별 측정 커버리지(체력 N/4, 메카닉 N/M, 제구 N/M) 가로 띠로 표시 → 과학적 정직성 강화
  function _renderConfidenceCoverageStrip(result) {
    const TM = window.TheiaMeta;
    const m = result.varScores || {};
    const fit = (typeof _getFit === 'function' ? _getFit() : null) || {};

    // 체력 4 dim (P2 radar 기준)
    const fitKeys = ['imtp_peak_force_bm','cmj_peak_power_bm','cmj_rsi_modified','bmi'];
    const fitN = fitKeys.filter(k => fit[k] != null).length;
    const fitTot = fitKeys.length;

    // 메카닉 = OUTPUT + TRANSFER + LEAK + INJURY 합산
    let mechN = 0, mechTot = 0;
    for (const cat of ['OUTPUT','TRANSFER','LEAK','INJURY']) {
      const vars = TM.OTL_CATEGORIES?.[cat]?.variables || [];
      mechTot += vars.length;
      mechN += vars.filter(v => m[v]?.value != null).length;
    }
    // 제구 = CONTROL
    const ctrlVars = TM.OTL_CATEGORIES?.CONTROL?.variables || [];
    const ctrlTot = ctrlVars.length;
    const ctrlN = ctrlVars.filter(v => m[v]?.value != null).length;

    const seg = (label, n, tot, color) => {
      const pct = tot > 0 ? Math.round(n / tot * 100) : 0;
      const dim = pct < 50 ? 'opacity: 0.55;' : '';
      const icon = n === tot && tot > 0 ? '✓' : (n === 0 ? '○' : '~');
      return `<div style="flex: 1; min-width: 140px;">
        <div style="display: flex; justify-content: space-between; align-items: baseline; font-size: 11px; margin-bottom: 4px;">
          <span style="color: var(--text-secondary); font-weight: 600;">${icon} ${label}</span>
          <span class="mono" style="color: ${color}; font-weight: 700;">${n}/${tot}</span>
        </div>
        <div style="background: var(--bg-elevated); border-radius: 3px; height: 6px; overflow: hidden;">
          <div style="width: ${pct}%; height: 100%; background: ${color}; ${dim} transition: width 0.4s;"></div>
        </div>
      </div>`;
    };

    return `
    <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 14px 18px; margin: 12px 0; ">
      <div style="display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 10px;">
        <div style="font-size: 13px; font-weight: 700; color: var(--text-primary);">📊 측정 커버리지 — 어떤 영역이 측정 기반인지</div>
        <div style="font-size: 10px; color: var(--text-muted); font-style: italic;">측정 변수 / 전체 정의 변수</div>
      </div>
      <div style="display: flex; gap: 24px; flex-wrap: wrap;">
        ${seg('체력', fitN, fitTot, 'var(--fitness)')}
        ${seg('메카닉', mechN, mechTot, 'var(--mechanics)')}
        ${seg('제구', ctrlN, ctrlTot, 'var(--control)')}
      </div>
      ${fitN === 0 ? `<div style="margin-top: 8px; font-size: 10px; color: var(--text-muted); font-style: italic;">⚠ 체력 0/${fitTot} — Step 2 metadata 미입력 시 잠재 구속·체력 카테고리 점수는 추정·placeholder</div>` : ''}
    </div>`;
  }

  // ── P2 Force Generation Profile ──
  function _renderP2Generation(result) {
    return `
    <section id="p2" class="report-page">
      ${_pageBanner('2', '힘을 얼마나 만들었나', 'Force Generation Profile', '각 분절과 지면에서 절대 출력/파워를 충분히 만들고 있나?')}
      <div class="page-intro">
        <span class="scope-chip scope-gen">Generation</span>
        이 페이지는 <strong>절대 출력/파워의 양</strong>만 봅니다.
        전달 효율(어디서 새는가)은 <a href="#p3">P3</a>에서 다룹니다.
      </div>
      ${_render3ColumnRadars(result)}
      ${_renderSegmentGenerationStack(result)}
    </section>`;
  }

  // ── P3 Force Transmission Map ──
  function _renderP3Transmission(result) {
    return `
    <section id="p3" class="report-page">
      ${_pageBanner('3', '힘이 어디서 새는가', 'Force Transmission Map', '생성된 힘이 발→골반→몸통→팔→공으로 얼마나 잘 전달되는가?')}
      <div class="page-intro">
        <span class="scope-chip scope-trans">Transmission</span>
        ★ <strong>5축 중 Transmission(에너지 전달) 축</strong>의 하위 진단 페이지입니다. ELI는 별도 종합점수가 아니라 <strong>이 축을 분해하는 도구</strong>로 사용됩니다.
        절대 출력은 <a href="#p2">P2 Generation</a>, 5축 종합 점수는 <a href="#p1">P1</a> 하단 보드에서 확인하세요.
      </div>
      <div class="kbo-scope" style="margin: 16px 0;">${_renderEnergyTransferBar(result)}</div>
      ${_renderMannequinUplift(result)}
      ${_renderELISection(result)}
      ${_renderETESection(result)}
    </section>`;
  }

  // ── P4 Root-Cause Timeline ──
  function _renderP4RootCause(result) {
    return `
    <section id="p4" class="report-page">
      ${_pageBanner('4', '어떤 동작이 막는가', 'Root-Cause Timeline', '결함 동작(원인)이 어느 이벤트에서 발생하고, 어떤 전달 손실(결과)을 만들었나?')}
      <div class="page-intro">
        <span class="scope-chip scope-fault">Fault</span>
        결함마다 phase(KH→FC→MER→BR)와 결과 metric을 함께 표기합니다. drill 처방은 <a href="#p6">P6</a>에서.
      </div>
      ${_renderEventTimeline(result)}
      <div class="kbo-scope" style="margin: 16px 0;">${_renderFaultLossCausalChain(result)}</div>
      ${_renderCausalAnalysis(result)}
    </section>`;
  }

  // ── P5 Evidence Dashboard ──
  function _renderP5Evidence(result) {
    return `
    <section id="p5" class="report-page">
      ${_pageBanner('5', '진단 근거', 'Evidence Dashboard', '위 진단을 만드는 핵심 데이터는 무엇이며, 서로 모순 없이 어떻게 읽히나?')}
      <div class="page-intro">
        <span class="scope-chip scope-evid">Evidence</span>
        반복성(Stability)과 최적성(Quality)은 다른 개념입니다. 두 축으로 분리해서 봅니다.
      </div>
      ${_renderKinematicBellUplift(result)}
      ${_renderGRFSection(result)}
      ${_renderConsistencyQualityMatrix(result)}
    </section>`;
  }

  // ── P6 Action Plan & Retest ──
  function _renderP6Action(result) {
    return `
    <section id="p6" class="report-page">
      ${_pageBanner('6', '훈련 처방', 'Action Plan & Retest', '6주 동안 무엇을 우선 훈련하고, 어떤 지표로 좋아졌는지 판단할 것인가?')}
      <div class="page-intro">
        <span class="scope-chip scope-act">Action</span>
        각 drill은 측정 가능한 KPI 한 개에 묶입니다. 6주 후 retest로 효과 검증.
      </div>
      ${_renderFaultsWithDrills(result)}
      ${_renderSummaryWithTraining(result)}
      ${_renderRetestKPITable(result)}
      <div class="kbo-scope" style="margin: 16px 0;">${_renderBeforeAfterRetestSlots(result)}</div>
    </section>`;
  }

  // ── Placeholder (P2~P6에서 단계적 구현 예정) ──
  // 신규 시각화 5종 — 일단 placeholder로 등록, 페이지별 작업 시 채움
  function _renderVeloWaterfall(result) {
    // P1 — 측정 → 체력만 → 메카닉만 → 동시 발전 시 잠재 구속 단계 그래프
    const pred = _predictPotentialVelo(result);
    if (!pred) return '';
    const conf = _assessConfidence(result);
    const steps = [
      { label: '측정 구속',           v: pred.current, color: 'var(--text-secondary)', delta: null,                    note: 'Trial 평균' },
      { label: '체력만 발전',         v: pred.fitOnly, color: '#60a5fa',                delta: pred.fitOnly - pred.current,  note: '체력 카테고리 점수 부족분 100% 채움' },
      { label: '메카닉만 발전',       v: pred.mechOnly,color: '#fb923c',                delta: pred.mechOnly - pred.current, note: 'Output + Transfer 부족분 100% 채움' },
      { label: '동시 발전 (상한)',    v: pred.both,    color: '#fbbf24',                delta: pred.both - pred.current,     note: '체력·메카닉 둘 다 동시 향상 시' },
    ];
    const max = Math.max(...steps.map(s => s.v));
    const min = Math.min(...steps.map(s => s.v));
    const range = Math.max(max - min, 1);
    const barW = (v) => Math.max(40, ((v - min + 2) / (range + 4)) * 100);
    const bars = steps.map((s, i) => `
      <div style="display: grid; grid-template-columns: 140px 1fr 90px 1fr; gap: 12px; align-items: center; padding: 8px 0;">
        <div style="font-size: 13px; color: var(--text-secondary); font-weight: 600;">${s.label}</div>
        <div style="background: var(--bg-elevated); height: 26px; border-radius: 6px; position: relative; overflow: hidden;">
          <div style="position: absolute; inset: 0 ${100 - barW(s.v)}% 0 0; background: ${s.color}; opacity: 0.85; border-radius: 6px;"></div>
          <div style="position: absolute; inset: 0; display: flex; align-items: center; padding: 0 10px; font-size: 13px; color: var(--text-primary); font-weight: 700; text-shadow: 0 1px 2px rgba(0,0,0,0.4);">
            ${s.v.toFixed(1)} <span style="font-size: 10px; margin-left: 3px; opacity: 0.85;">km/h</span>
          </div>
        </div>
        <div style="font-size: 12px; color: ${s.delta != null && s.delta > 0 ? 'var(--good)' : 'var(--text-muted)'}; font-weight: 700; text-align: right;">
          ${s.delta != null && s.delta > 0 ? '+' + s.delta.toFixed(1) : '—'}
        </div>
        <div style="font-size: 11px; color: var(--text-muted);">${s.note}</div>
      </div>`).join('');
    // ★ v0.60 — PDF §4 #5 fix: Mechanics confidence와 Physical confidence 분리 배지
    const fit = (typeof _getFit === 'function' ? _getFit() : null) || {};
    const physN = ['imtp_peak_force_bm','cmj_peak_power_bm','cmj_rsi_modified','bmi'].filter(k => fit[k] != null).length;
    const physCov = `${physN}/4`;
    const physBadge = physN >= 3 ? { icon:'✓', label:'Physical: 측정 기반', color:'var(--good)' }
                    : physN >= 1 ? { icon:'~', label:`Physical: 일부 측정 (${physCov})`, color:'var(--warn)' }
                                 : { icon:'!', label:`Physical: 측정 없음 (${physCov}) — 추정`, color:'var(--bad)' };
    const mechBadge = { icon:'✓', label:'Mechanics: 측정 기반', color:'var(--good)' };
    const confNote = `
      <div style="margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap; font-size: 11px;">
        <span style="padding: 4px 10px; border-radius: 12px; background: rgba(74,222,128,0.10); color: ${mechBadge.color}; font-weight: 600;">${mechBadge.icon} ${mechBadge.label}</span>
        <span style="padding: 4px 10px; border-radius: 12px; background: rgba(251,191,36,0.10); color: ${physBadge.color}; font-weight: 600;">${physBadge.icon} ${physBadge.label}</span>
      </div>
      ${physN < 3 ? `<div style="margin-top: 8px; padding: 10px 12px; border-left: 3px solid var(--warn); background: rgba(251,191,36,0.06); border-radius: 4px; font-size: 12px; color: var(--text-secondary);">
        ⚠ 체력 ${physCov} 측정 — "체력만 발전" 잠재 구속은 부분 추정. VALD(SJ/CMJ/IMTP) 입력 후 신뢰도 향상
      </div>` : ''}`;
    return `
    <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 18px 20px; margin: 16px 0;">
      <div style="display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 4px;">
        <div style="font-size: 15px; font-weight: 700; color: var(--text-primary);">⚡ Velocity Gap Waterfall — 어디를 고쳐야 가장 많이 오르는가</div>
        <span class="conf-badge ${conf.cls}">${conf.icon} ${conf.label}</span>
      </div>
      <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 10px;">측정값 대비 체력·메카닉 향상이 가져올 잠재 구속 단계 비교</div>
      ${bars}
      ${confNote}
    </div>`;
  }

  function _renderSegmentGenerationStack(result) {
    // P2 — Drive Leg / Lead Leg / Trunk / Arm-Release 절대 출력 stack
    const m = result.varScores || {};
    const v = (k) => m[k]?.value;
    const s = (k) => m[k]?.score;
    const fmt = (val, dec=2, unit='') => val == null ? '—' : (typeof val === 'number' ? val.toFixed(dec) + unit : val);
    const segs = [
      { name: 'Drive Leg', metrics: [
          ['Trail vGRF',     fmt(v('Trail_leg_peak_vertical_GRF'), 2, ' BW')],
          ['Trail AP impulse', fmt(v('drive_leg_propulsive_impulse'), 4, ' BW·s')],
        ], score: s('Trail_leg_peak_vertical_GRF'), color: 'var(--output)' },
      { name: 'Lead Leg',  metrics: [
          ['Lead vGRF',     fmt(v('Lead_leg_peak_vertical_GRF'), 2, ' BW')],
          ['Lead braking',  fmt(v('lead_leg_braking_impulse'), 4, ' BW·s')],
        ], score: s('Lead_leg_peak_vertical_GRF'), color: 'var(--output)' },
      { name: 'Trunk',     metrics: [
          ['Rot vel',     fmt(v('Trunk_peak'), 0, ' °/s')],
          ['Flex vel',    fmt(v('trunk_forward_flexion_vel_peak'), 0, ' °/s')],
        ], score: s('Trunk_peak'), color: 'var(--output)' },
      { name: 'Arm·Release', metrics: [
          ['Release',     fmt(v('ball_speed'), 1, ' km/h')],
          ['Arm peak',    fmt(v('Arm_peak'), 0, ' °/s')],
        ], score: s('ball_speed'), color: 'var(--output)' },
    ];
    const row = (seg) => {
      const pct = seg.score != null ? Math.max(0, Math.min(100, seg.score)) : 0;
      const scoreColor = seg.score == null ? 'var(--text-muted)' : (seg.score >= 70 ? 'var(--good)' : seg.score >= 50 ? 'var(--warn)' : 'var(--bad)');
      return `
      <div style="display: grid; grid-template-columns: 110px 1fr 60px; gap: 14px; align-items: center; padding: 14px 16px; background: var(--bg-elevated); border-radius: 8px; margin-bottom: 8px;">
        <div style="font-size: 14px; font-weight: 700; color: var(--text-primary);">${seg.name}</div>
        <div>
          <div style="display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 6px;">
            ${seg.metrics.map(([k, val]) => `<div style="font-size: 11px; color: var(--text-muted);">${k} <span style="color: var(--text-secondary); font-weight: 600;">${val}</span></div>`).join('')}
          </div>
          <div style="height: 6px; background: var(--border); border-radius: 3px; overflow: hidden;">
            <div style="height: 100%; width: ${pct}%; background: ${scoreColor}; border-radius: 3px;"></div>
          </div>
        </div>
        <div style="text-align: right;">
          <span style="font-size: 18px; font-weight: 700; color: ${scoreColor};">${seg.score != null ? Math.round(seg.score) : '—'}</span>
          <span style="font-size: 11px; color: var(--text-muted);">점</span>
        </div>
      </div>`;
    };
    return `
    <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 18px 20px; margin: 16px 0;">
      <div style="font-size: 15px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">📊 Segment Generation Stack — 분절별 출력</div>
      <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 14px;">절대 출력/파워 (전달 효율은 P3에서)</div>
      ${segs.map(row).join('')}
    </div>`;
  }

  function _renderEventTimeline(result) {
    // P4 — KH → FC → MER → BR 이벤트 타임라인 + 결함 배지 위치
    const m = result.varScores || {};
    const events = [
      { id: 'KH',  label: 'Knee Height',   t: m['t_max_knee_height']?.value,   ko: '무릎 정점' },
      { id: 'FC',  label: 'Foot Contact',  t: m['t_foot_strike']?.value,        ko: '디딤발 접지' },
      { id: 'MER', label: 'Max ER',        t: m['t_max_shoulder_ext_rot']?.value,ko: '최대 외전' },
      { id: 'BR',  label: 'Ball Release',  t: m['t_ball_release']?.value,       ko: '릴리스' },
    ];
    const valid = events.filter(e => e.t != null);
    const missing = events.filter(e => e.t == null).map(e => `<span style="color: #dc2626; font-weight: 600;">${e.id}</span><span style="color: var(--text-muted); font-size: 10px;">(${e.ko})</span>`);
    const present = valid.map(e => `<span style="color: #16a34a; font-weight: 600;">${e.id}</span>`);
    if (valid.length < 2) {
      // ★ v0.58 — fallback에 어떤 이벤트가 측정/결측인지 명시 + 1개라도 있으면 단일 점이라도 표시
      const presentList = present.length > 0 ? present.join(' · ') : '<span style="color: var(--text-muted);">없음</span>';
      const missingList = missing.length > 0 ? missing.join(' · ') : '<span style="color: var(--text-muted);">없음</span>';
      const singleDot = valid.length === 1 ? `
        <div style="position: relative; height: 4px; background: var(--border); border-radius: 2px; margin: 18px 8px 32px;">
          <div style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);">
            <div style="width: 16px; height: 16px; border-radius: 50%; background: var(--accent); border: 3px solid var(--bg-card); box-shadow: 0 0 0 2px var(--accent);"></div>
            <div style="position: absolute; top: 24px; left: 50%; transform: translateX(-50%); white-space: nowrap; text-align: center;">
              <div style="font-size: 11px; font-weight: 700; color: var(--text-primary);">${valid[0].id}</div>
              <div style="font-size: 9px; color: var(--text-muted);">${valid[0].ko} (단일 — 시계열 그릴 수 없음)</div>
            </div>
          </div>
        </div>` : '';
      return `<div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 16px 20px; margin: 16px 0;">
        <div style="font-size: 13px; font-weight: 700; color: var(--text-primary); margin-bottom: 8px;">⏱️ Event Timeline — 부분 결측</div>
        <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.7;">
          측정됨: ${presentList}<br>
          결측: ${missingList}
        </div>
        <div style="font-size: 11px; color: var(--text-muted); margin-top: 8px;">trial별 자동 검출 실패. 평균에서 KH·FC·MER·BR 중 <strong>2개 이상</strong> 있어야 시계열 표시 가능. trial별 결측 분포는 콘솔 result._meta·varScores._n에서 확인.</div>
        ${singleDot}
      </div>`;
    }
    const t0 = valid[0].t;
    const t1 = valid[valid.length - 1].t;
    const dur = Math.max(t1 - t0, 0.001);
    const dot = (e) => {
      const pct = ((e.t - t0) / dur) * 100;
      return `
      <div style="position: absolute; left: ${pct}%; top: 50%; transform: translate(-50%, -50%);">
        <div style="width: 16px; height: 16px; border-radius: 50%; background: var(--accent); border: 3px solid var(--bg-card); box-shadow: 0 0 0 2px var(--accent);"></div>
        <div style="position: absolute; top: 24px; left: 50%; transform: translateX(-50%); white-space: nowrap; text-align: center;">
          <div style="font-size: 11px; font-weight: 700; color: var(--text-primary);">${e.id}</div>
          <div style="font-size: 9px; color: var(--text-muted);">${e.ko}</div>
        </div>
      </div>`;
    };
    return `
    <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 22px 28px 60px; margin: 16px 0;">
      <div style="font-size: 15px; font-weight: 700; color: var(--text-primary); margin-bottom: 18px;">⏱️ Pitching Event Timeline</div>
      <div style="position: relative; height: 4px; background: var(--border); border-radius: 2px; margin: 0 8px;">
        ${valid.map(dot).join('')}
      </div>
    </div>`;
  }

  function _renderConsistencyQualityMatrix(result) {
    // P5 — 반복성 vs 최적성 2x2 매트릭스 (모순 #2 해결)
    const m = result.varScores || {};
    // 반복성 proxy: release_point_consistency, arm_slot_consistency 등 SD 기반
    // 최적성 proxy: timing chain quality (P→T lag, T→Arm lag)
    const stab = m['release_point_consistency']?.score ?? m['x_force_instability']?.score ?? 50;
    const qual = m['pelvis_to_trunk']?.score ?? m['trunk_to_arm']?.score ?? 50;
    const x = Math.max(0, Math.min(100, qual));
    const y = Math.max(0, Math.min(100, stab));
    let zone = '';
    if (x >= 50 && y >= 50)      zone = '🎯 Stable & Optimal — 유지';
    else if (x < 50 && y >= 50)  zone = '🔁 Stable but Suboptimal — 메카닉 재학습';
    else if (x >= 50 && y < 50)  zone = '⚡ Optimal but Unstable — 반복 훈련';
    else                          zone = '🚧 Unstable & Suboptimal — 기초 재정립';
    return `
    <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 18px 20px; margin: 16px 0;">
      <div style="font-size: 15px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">🎯 Consistency × Quality — 반복성과 최적성 분리</div>
      <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 14px;">두 축이 다르다 — 반복성 95점이라도 lag quality는 낮을 수 있다</div>
      <div style="display: grid; grid-template-columns: 1fr 280px; gap: 24px; align-items: center;">
        <div style="position: relative; aspect-ratio: 1; background: var(--bg-elevated); border-radius: 8px; padding: 24px;">
          <div style="position: absolute; left: 24px; right: 24px; top: 24px; bottom: 24px; border-left: 1px solid var(--border); border-bottom: 1px solid var(--border);"></div>
          <div style="position: absolute; left: 50%; top: 24px; bottom: 24px; border-left: 1px dashed var(--border);"></div>
          <div style="position: absolute; left: 24px; right: 24px; top: 50%; border-top: 1px dashed var(--border);"></div>
          ${(() => {
            // ★ v0.58 — 4사분면 라벨 (현재 위치 사분면은 강조)
            const inQ = (qx, qy) => (qx === (x>=50)) && (qy === (y>=50));
            const qLabel = (qx, qy, label, sub) => {
              const active = inQ(qx, qy);
              const left = qx ? '74%' : '26%';
              const top = qy ? '26%' : '74%';
              const color = active ? 'var(--accent)' : 'var(--text-muted)';
              const opacity = active ? 1 : 0.55;
              const weight = active ? 700 : 500;
              return `<div style="position: absolute; left: ${left}; top: ${top}; transform: translate(-50%, -50%); font-size: 9px; color: ${color}; opacity: ${opacity}; font-weight: ${weight}; text-align: center; line-height: 1.25; pointer-events: none; letter-spacing: 0.02em;">${label}<br><span style="font-size: 8px; opacity: 0.85;">${sub}</span></div>`;
            };
            return qLabel(false, true,  '🔁 Stable<br>but Sub',     '메카닉 재학습')
                 + qLabel(true,  true,  '🎯 Stable<br>& Optimal',  '유지')
                 + qLabel(false, false, '🚧 Unstable<br>& Sub',     '기초 재정립')
                 + qLabel(true,  false, '⚡ Optimal<br>but Unstable','반복 훈련');
          })()}
          <div style="position: absolute; left: ${24 + (x/100) * 80}%; top: ${24 + (1 - y/100) * 80}%; transform: translate(-50%, -50%); z-index: 2;">
            <div style="width: 14px; height: 14px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 4px rgba(255,107,53,0.25);"></div>
          </div>
          <div style="position: absolute; left: 8px; top: 8px; font-size: 10px; color: var(--text-muted);">반복성↑</div>
          <div style="position: absolute; right: 8px; bottom: 4px; font-size: 10px; color: var(--text-muted);">최적성→</div>
        </div>
        <div>
          <div style="font-size: 13px; font-weight: 700; color: var(--accent); margin-bottom: 8px;">${zone}</div>
          <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.6;">
            <div>반복성 (Stability): <strong>${Math.round(y)}</strong>/100</div>
            <div>최적성 (Quality):  <strong>${Math.round(x)}</strong>/100</div>
          </div>
        </div>
      </div>
    </div>`;
  }

  function _renderRetestKPITable(result) {
    // P6 — 6주 재평가 KPI 표
    const rows = [
      { group: '전달 효율',   kpi: 'P→T ETE, T→Arm ETE',                    target: '0.50+ 또는 개인 기준값 대비 상승', viz: 'Before/After slope line' },
      { group: '리드블록',     kpi: 'Lead braking impulse, Lead force at BR', target: '증가',                              viz: 'GRF impulse bar' },
      { group: '몸통',         kpi: 'FC trunk tilt, Trunk flexion speed',     target: '개인 기준범위 내 안정',             viz: 'Event timeline overlay' },
      { group: '제구 (반복성)', kpi: 'Release point SD, Trunk tilt SD',      target: '감소',                              viz: 'Consistency control chart' },
    ];
    const tr = rows.map(r => `
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid var(--border); font-weight: 600; font-size: 12px;">${r.group}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid var(--border); font-size: 12px; color: var(--text-secondary);">${r.kpi}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid var(--border); font-size: 12px; color: var(--text-secondary);">${r.target}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid var(--border); font-size: 11px; color: var(--text-muted);">${r.viz}</td>
      </tr>`).join('');
    return `
    <div style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 18px 20px; margin: 16px 0;">
      <div style="font-size: 15px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">📋 6주 재평가 설계 — Before/After KPI</div>
      <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 14px;">"속도"만 보지 말고 Generation / Transmission / Fault / Cost 지표를 같은 순서로 비교</div>
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="background: var(--bg-elevated);">
            <th style="padding: 10px 12px; text-align: left; font-size: 11px; color: var(--text-muted); letter-spacing: 0.06em; text-transform: uppercase;">Metric Group</th>
            <th style="padding: 10px 12px; text-align: left; font-size: 11px; color: var(--text-muted); letter-spacing: 0.06em; text-transform: uppercase;">Primary KPI</th>
            <th style="padding: 10px 12px; text-align: left; font-size: 11px; color: var(--text-muted); letter-spacing: 0.06em; text-transform: uppercase;">Target Direction</th>
            <th style="padding: 10px 12px; text-align: left; font-size: 11px; color: var(--text-muted); letter-spacing: 0.06em; text-transform: uppercase;">Visualization</th>
          </tr>
        </thead>
        <tbody>${tr}</tbody>
      </table>
    </div>`;
  }

  // ════════════════════════════════════════════════════════════
  // v0.12 — Integrated Energy Leak Index (ELI)
  //   PDF baseball_pitching_energy_leak_index.pdf 프레임워크
  //   Σ wₖ × LeakScoreₖ (100점, 높을수록 효율적)
  // ════════════════════════════════════════════════════════════
  // ★ v0.16 — _calculateELI 확장: 변수별 산정 근거 정보까지 반환
  // 영역별 변수 매핑 (산정 근거 expand에 사용)
  // ★ v0.28 — PDF §4·5·7 적용: GRF impulse + Joint W⁺/W⁻ + ETE 변수 추가
  //   GRF는 markerless보다 신뢰도 높아 lead_block·lower_drive에 비중 ↑
  //   ETE는 Phase C 핵심 산식 (PDF §5)
  const ELI_AREA_VARS = {
    lower_drive:  { vars: ['drive_leg_propulsive_impulse','trail_vGRF_impulse','Trail_leg_peak_vertical_GRF','Trail_leg_peak_AP_GRF','trail_hip_W_pos','Trail_Hip_Power_peak'],
                    faultIds: ['WeakTrailDrive'] },
    lead_block:   { vars: ['lead_leg_braking_impulse','lead_vGRF_impulse','Lead_leg_peak_vertical_GRF','lead_knee_W_pos','lead_hip_W_pos','knee_flexion_change_FC_to_MER','br_lead_leg_knee_flexion','lead_knee_ext_change_fc_to_br'],
                    faultIds: ['WeakLeadBlock','LeadKneeCollapse','PoorBlock'] },
    pelvis_trunk: { vars: ['ETE_pelvis_to_trunk','pelvis_deceleration','fc_xfactor','peak_xfactor','peak_trunk_CounterRotation'],   // ★ v0.50 — counter rotation 추가 (와인드업 로딩 평가)
                    faultIds: ['FlyingOpen'] },
    trunk_power:  { vars: ['Trunk_peak','trunk_forward_flexion_vel_peak','pelvis_to_trunk','pelvis_trunk_speedup'],
                    faultIds: ['LateTrunkRotation','PoorSpeedupChain','ExcessForwardTilt'] },
    arm_transfer: { vars: ['ETE_trunk_to_arm','Arm_peak','humerus_segment_peak','trunk_to_arm','arm_trunk_speedup','shoulder_W_pos','elbow_W_pos','mer_shoulder_abd','max_shoulder_ER','Pitching_Shoulder_Power_peak'],
                    faultIds: ['MERShoulderRisk'] },
    load_eff:     { from_injury: true, vars: ['shoulder_absorption_ratio','elbow_absorption_ratio'], faultIds: ['HighElbowValgus','PoorReleaseConsistency'] },
  };

  function _calculateELI(result) {
    const TM = window.TheiaMeta;
    if (!TM?.ELI_AREAS) return null;
    const sevPenalty = { high: 35, medium: 18, low: 8 };
    const sevCap     = { high: 50, medium: 65, low: 80 };
    const m = result.varScores || {};
    const flts = result.faults || [];
    const inj = result.catScores?.INJURY?.score;

    const areas = TM.ELI_AREAS.map(a => {
      const meta = ELI_AREA_VARS[a.id] || {};
      const varList = (meta.vars || []).map(k => ({
        key: k,
        name: TM.getVarMeta(k)?.name || k,
        unit: TM.getVarMeta(k)?.unit || '',
        value: m[k]?.value ?? null,
        score: m[k]?.score ?? null,
        measured: m[k]?.score != null,
      }));
      const measuredVars = varList.filter(v => v.measured);
      let rawScore;
      if (a.from_injury) {
        rawScore = inj;
      } else if (measuredVars.length > 0) {
        rawScore = Math.round(measuredVars.reduce((s, v) => s + v.score, 0) / measuredVars.length);
      } else {
        rawScore = null;
      }
      const matchedFaults = flts.filter(f => (meta.faultIds || []).includes(f.id));
      let penalty = 0, worstSev = 'low', cap = 100;
      if (matchedFaults.length > 0) {
        matchedFaults.forEach(f => {
          penalty += sevPenalty[f.severity] || 0;
          if ({high:3,medium:2,low:1}[f.severity] > {high:3,medium:2,low:1}[worstSev]) worstSev = f.severity;
        });
        cap = sevCap[worstSev] || 100;
      }
      const finalScore = rawScore != null && matchedFaults.length > 0
        ? Math.min(cap, Math.max(0, rawScore - penalty))
        : rawScore;
      return {
        ...a, score: finalScore,
        rawScore, penalty, worstSev, cap, hasFaults: matchedFaults.length > 0,
        vars: varList, measuredCount: measuredVars.length,
        matchedFaults: matchedFaults.map(f => ({ id: f.id, label: f.label, severity: f.severity, penalty: sevPenalty[f.severity] || 0 })),
      };
    });
    const measured = areas.filter(a => a.score != null);
    const totalW = measured.reduce((s, a) => s + a.weight, 0);
    if (totalW === 0) return { eli: null, areas, measured: 0, totalW: 0 };
    const eli = measured.reduce((s, a) => s + a.score * a.weight, 0) / totalW;
    return { eli: Math.round(eli), areas, measured: measured.length, totalW };
  }

  function _renderELISection(result) {
    const TM = window.TheiaMeta;
    const eliResult = _calculateELI(result);
    if (!eliResult) return '';
    const { eli, areas, measured, totalW } = eliResult;
    // ★ v0.18.1 — grade null fallback (eli == null 시 getELIGrade 가 null 반환)
    const grade = TM.getELIGrade(eli) || { color: '#94a3b8', label: '미평가', feedback: '데이터 부족 — c3d.txt 측정 변수 확인 필요' };

    // 가장 약한 영역 식별 (점수 기준 오름차순) → 핵심 결론 문장 생성
    const weakAreas = areas.filter(a => a.score != null && a.score < 60).sort((a, b) => a.score - b.score);
    const topWeak = weakAreas[0];
    const feedbackTpl = topWeak ? TM.ELI_FEEDBACK_TEMPLATES[topWeak.id] : null;

    // ★ v0.16 — 영역별 막대 + ▸ 산정 근거 expand
    const areaBars = areas.map(a => {
      const sc = a.score;
      const c = sc == null ? '#94a3b8' : sc >= 80 ? '#16a34a' : sc >= 60 ? '#22d3ee' : sc >= 40 ? '#fb923c' : '#dc2626';
      const barWidth = sc == null ? 0 : Math.min(100, sc);

      // ── 산정 근거 expand 콘텐츠 ──
      let breakdownHtml = '';
      if (a.from_injury) {
        // load_eff: INJURY 카테고리 점수 그대로
        breakdownHtml = `
          <div class="text-xs" style="color: var(--text-secondary); line-height: 1.6;">
            <strong>산식</strong>: 부하 대비 효율 = INJURY 카테고리 안전도 점수 (UCL stress·knee stress 변수 평균)
            <br>
            <strong>점수</strong>: <span class="mono" style="color: ${c};">${sc != null ? sc + '점' : '미측정'}</span> (높을수록 안전)
            ${a.matchedFaults?.length > 0 ? `<br><strong style="color: #dc2626;">검출 결함</strong>: ${a.matchedFaults.map(f => `[${f.severity}] ${f.label}`).join(', ')}` : ''}
          </div>`;
      } else {
        // 일반 영역: 변수별 점수 + 평균 + 패널티
        const varRows = a.vars.map(v => {
          const vc = v.score == null ? '#94a3b8' : v.score >= 75 ? '#16a34a' : v.score >= 50 ? '#22d3ee' : v.score >= 35 ? '#fb923c' : '#dc2626';
          return `<tr style="border-bottom: 1px dashed var(--border);">
            <td style="padding: 4px 6px; color: ${v.measured ? 'var(--text-primary)' : 'var(--text-muted)'};">${v.measured ? '✓' : '○'} ${v.name}</td>
            <td class="mono text-[10px]" style="padding: 4px 6px; color: var(--text-muted); text-align: right;">${v.measured ? v.value.toFixed(2) + (v.unit ? ' ' + v.unit : '') : '미측정'}</td>
            <td class="mono" style="padding: 4px 6px; color: ${vc}; text-align: right; font-weight: 600;">${v.measured ? v.score + '점' : '—'}</td>
          </tr>`;
        }).join('');

        const faultsHtml = a.matchedFaults?.length > 0
          ? `<div class="mt-2 p-2 rounded" style="background: rgba(220,38,38,0.1); border-left: 2px solid #dc2626;">
              <div class="text-[11px] mb-1" style="color: #dc2626; font-weight: 600;">⚠ 검출된 결함 → 영역 점수 패널티</div>
              ${a.matchedFaults.map(f => `<div class="text-[10px] mono" style="color: var(--text-secondary);">
                [${f.severity}] ${f.label} <span style="color: #dc2626;">−${f.penalty}점</span>
              </div>`).join('')}
              <div class="text-[10px] mono mt-1" style="color: var(--text-muted);">총 패널티: <strong style="color: #dc2626;">−${a.penalty}점</strong> · ${a.worstSev} 등급 cap = ${a.cap}점</div>
            </div>` : '';

        breakdownHtml = `
          <div class="text-xs" style="color: var(--text-secondary); line-height: 1.5;">
            <strong>산식 1단계 — 변수 평균</strong> (${a.measuredCount}/${a.vars.length} 측정):
            <table class="mt-1" style="width: 100%; font-size: 11px; border-collapse: collapse;">
              <thead><tr style="background: var(--bg-elevated); border-bottom: 1px solid var(--border);">
                <th style="text-align: left; padding: 4px 6px;">변수</th>
                <th style="text-align: right; padding: 4px 6px;">측정값</th>
                <th style="text-align: right; padding: 4px 6px;">점수</th>
              </tr></thead>
              <tbody>${varRows}</tbody>
            </table>
            <div class="mt-2 mono text-[11px]" style="color: var(--text-secondary);">
              raw 평균 = (측정 변수 점수 합) / ${a.measuredCount} = <strong style="color: var(--text-primary);">${a.rawScore != null ? a.rawScore + '점' : '—'}</strong>
            </div>
            ${faultsHtml}
            <div class="mt-2 p-2 rounded" style="background: rgba(34,211,238,0.08);">
              <div class="text-[11px] mono" style="color: var(--text-secondary);">
                <strong>산식 2단계 — 최종 점수</strong>:
                ${a.hasFaults
                  ? `min(cap=${a.cap}, max(0, raw ${a.rawScore} − 패널티 ${a.penalty})) = <strong style="color: ${c}; font-size: 13px;">${sc}점</strong>`
                  : `결함 없음 → raw 평균 그대로 = <strong style="color: ${c}; font-size: 13px;">${sc != null ? sc : '—'}점</strong>`}
              </div>
            </div>
          </div>`;
      }

      return `<details style="margin-bottom: 8px; background: rgba(255,255,255,0.02); padding: 8px 12px; border-radius: 4px; border-left: 3px solid ${c};">
        <summary class="cursor-pointer" style="list-style: none;">
          <div class="flex justify-between items-baseline mb-1 flex-wrap gap-2">
            <div style="font-size: 13px;">
              <strong>▸ ${a.name}</strong>
              <span class="mono text-xs" style="color: var(--text-muted); margin-left: 6px;">w=${a.weight}${a.weight >= 20 ? ' ★' : ''}</span>
            </div>
            <span class="mono" style="color: ${c}; font-weight: 700; font-size: 14px;">${sc != null ? sc + '점' : '미측정'}</span>
          </div>
          <div style="background: var(--bg-elevated); border-radius: 3px; height: 8px; overflow: hidden;">
            <div style="width: ${barWidth}%; height: 100%; background: ${c}; transition: width 0.4s;"></div>
          </div>
          <div class="text-[10px] mt-1" style="color: var(--text-muted); line-height: 1.4;">
            ${a.desc}${(sc == null || sc < 50) ? ` · <em style="color: ${sc != null ? '#dc2626' : 'var(--text-muted)'};">${a.leak_when_low}</em>` : ` · <em style="color: var(--good);">정상 — 보통 이상</em>`}
            ${a.hasFaults ? ` <span style="color: #dc2626; font-weight: 600;">· ⚠ ${a.matchedFaults.length}건 패널티</span>` : ''}
          </div>
        </summary>
        <div class="mt-3 pt-3" style="border-top: 1px dashed var(--border);">
          ${breakdownHtml}
        </div>
      </details>`;
    }).join('');

    // 핵심 결론 — 코칭 톤
    const conclusionHtml = topWeak && feedbackTpl ? `
      <div class="mt-3 p-3 rounded" style="background: ${grade.color}15; border-left: 3px solid ${grade.color};">
        <div class="text-sm font-semibold mb-1" style="color: ${grade.color};">📝 핵심 진단</div>
        <div class="text-sm leading-relaxed" style="color: var(--text-primary);">
          이 선수의 가장 큰 약점은 <strong>'${topWeak.name}'</strong> 구간에서 힘이 새고 있다는 점입니다.
          ${feedbackTpl.diagnosis}
        </div>
        <div class="text-xs mt-2" style="color: var(--text-secondary);">
          <strong style="color: #16a34a;">💪 추천 훈련 방향:</strong> ${feedbackTpl.training}
        </div>
      </div>` : (eli >= 70 ? `
      <div class="mt-3 p-3 rounded" style="background: rgba(22,163,74,0.1); border-left: 3px solid #16a34a;">
        <div class="text-sm" style="color: #16a34a; font-weight: 600;">✓ 영역별 점수 모두 60점 이상 — 명확한 리크 위치 없음. 세부 타이밍 조정 단계.</div>
      </div>` : '');

    // 산식 펼침 카드 (관심 있는 사용자만 보도록 숨김)
    const eteHtml = `
      <details class="mt-3 text-xs" style="background: var(--bg-elevated); padding: 8px 12px; border-radius: 4px; border-left: 2px solid var(--accent-soft);">
        <summary class="cursor-pointer" style="color: var(--accent-soft); font-weight: 600;">🔬 산식·계산 방법 (관심 있을 때만)</summary>
        <div class="mt-2 leading-relaxed" style="color: var(--text-secondary);">
          <div class="mb-2"><strong>분절 에너지</strong>: 골반·몸통·팔 각각이 가진 운동 + 회전 에너지의 시간 변화</div>
          <div class="mb-2"><strong>관절 일</strong>: 양의 일(W⁺ = 만든 힘) + 음의 일(W⁻ = 흡수한 힘)</div>
          <div class="mb-2"><strong>전달율</strong>: 다음 분절로 넘어간 에너지 / 앞 분절이 만든 일</div>
          <div class="mb-2"><strong>손실율</strong> = 1 − 전달율 (값 클수록 손실 많음)</div>
          <div><strong>종합 점수</strong> = 6개 영역 점수 × 가중치 합 (총 100점)</div>
        </div>
      </details>`;

    return `
    <div class="cat-card mb-6" style="padding: 22px; border: 2px solid ${grade.color}; background: linear-gradient(135deg, ${grade.color}10, transparent);">
      <div class="flex justify-between items-start flex-wrap gap-3 mb-3">
        <div>
          <div class="mono text-xs uppercase tracking-widest" style="color: var(--text-muted);">Transmission Health · 전달 효율 종합 (높을수록 좋음)</div>
          <div class="display text-2xl mt-1" style="color: ${grade.color};">🔋 발에서 공까지 — 힘이 얼마나 잘 전달됐는가</div>
          <div class="text-xs mt-1" style="color: var(--text-muted);">
            발·골반·몸통·팔 6개 단계의 힘 전달 효율을 종합한 점수 (★ v0.60 — 'ELI'는 이 점수를 설명하는 하위 진단 도구)
          </div>
        </div>
        <div class="text-right">
          <div class="display" style="font-size: 56px; color: ${grade.color}; font-weight: 700; line-height: 1;">${eli != null ? eli : '—'}<span class="text-lg" style="color: var(--text-muted);">/100</span></div>
          <div class="text-sm mt-1" style="color: ${grade.color}; font-weight: 600;">${grade.label}</div>
          <div class="text-xs mt-1" style="color: var(--text-muted);">${grade.feedback}</div>
        </div>
      </div>

      <!-- 5단계 등급 색상 막대 -->
      <div class="flex mb-3 mono text-[10px]" style="border-radius: 3px; overflow: hidden; height: 20px;">
        <div style="flex: 0 0 40%; background: #dc262633; color: #dc2626; text-align: center; line-height: 20px;">&lt;40 팔 보상</div>
        <div style="flex: 0 0 14%; background: #f8717133; color: #f87171; text-align: center; line-height: 20px;">40-54 저하</div>
        <div style="flex: 0 0 14%; background: #fb923c33; color: #fb923c; text-align: center; line-height: 20px;">55-69 특정</div>
        <div style="flex: 0 0 14%; background: #22d3ee33; color: #22d3ee; text-align: center; line-height: 20px;">70-84 경미</div>
        <div style="flex: 0 0 18%; background: #16a34a33; color: #16a34a; text-align: center; line-height: 20px;">85-100 우수</div>
      </div>

      <div class="text-xs mb-3" style="color: var(--text-muted);">
        측정 영역: <strong style="color: ${grade.color};">${measured}/${areas.length}</strong> · 가중치 합 ${totalW}/100
      </div>

      <!-- 6 영역 가중치 막대 -->
      <div>${areaBars}</div>

      ${conclusionHtml}
      ${eteHtml}
    </div>`;
  }

  // ── ⚡ ETE (Energy Transfer Efficiency) 별도 섹션 — PDF §4·5 ★ v0.28+ ──
  // ════════════════════════════════════════════════════════════
  // ★ v0.32 — 동작 비효율 (B) → 에너지 전달 손실 (A) 인과 분석
  //   PDF §1·§7·§11 — 각 운동학적 결함이 어떤 에너지 전달 실패로 이어지는지 명시
  //   "B 동작 결함이 원인, A 에너지 손실이 결과"
  // ════════════════════════════════════════════════════════════
  function _renderCausalAnalysis(result) {
    const m = result.varScores || {};
    const v = (k) => m[k]?.value;
    const sc = (k) => m[k]?.score;

    // ── 6개 인과 사슬 정의 (B 원인 → A 결과) ──
    const chains = [
      {
        id: 'sequencing',
        title: '골반·몸통·팔 순서대로 이어가기',
        causes: [
          { key: 'pelvis_to_trunk', name: '골반→몸통 시간차', target_ms: 45, unit: 'ms' },
          { key: 'trunk_to_arm', name: '몸통→팔 시간차', target_ms: 45, unit: 'ms' },
        ],
        effects: ['ETE_pelvis_to_trunk', 'ETE_trunk_to_arm'],
        narrative_low: '분절 사이 시간차가 너무 짧아 한 번에 다 열림 → 힘이 모이지 않고 흩어짐',
        narrative_high: '골반 → 몸통 → 팔 순서 잘 지켜짐 — 채찍처럼 이어짐',
      },
      {
        id: 'separation',
        title: '골반-상체 분리각 (스트레치 효과)',
        causes: [
          { key: 'peak_trunk_CounterRotation', name: '와인드업 골반 역회전', target: 30, unit: '°' },
          { key: 'peak_xfactor', name: '골반-상체 최대 분리각', target: 40, unit: '°' },
          { key: 'fc_xfactor', name: '착지 시점 골반-상체 분리각', target: 25, unit: '°' },
        ],
        effects: ['ETE_pelvis_to_trunk', 'dE_trunk_KH_FC'],
        narrative_low: '골반과 상체 분리 부족 → 고무줄처럼 당겨놓고 놓는 효과 약함',
        narrative_high: '골반과 상체 충분히 분리 → 회전 stretch 효과로 몸통 가속 강력',
      },
      {
        id: 'lead_block',
        title: '앞발 받쳐주기 (블로킹) — 두 단계 분리',
        // ★ v0.63 PDF §4 #6 fix — FC→MER (전반: 무릎 신전 양호) vs MER→BR (후반: 지지·브레이킹 유지) 분리
        phaseLabel: '🦵 phase 1 (착지~외회전): 무릎 신전이 잘 들어왔는가  |  phase 2 (외회전~릴리스): 끝까지 지지가 유지되는가',
        causes: [
          { key: 'knee_flexion_change_FC_to_MER', name: 'phase 1 — 착지~외회전 무릎 변화', target: -10, unit: '°', polarity: 'lower', hint: '음수=신전 양호 (앞발 펴면서 받침)' },
          { key: 'knee_flexion_change_MER_to_BR', name: 'phase 2 — 외회전~릴리스 무릎 변화', target: -3, unit: '°', polarity: 'lower', hint: '0 근처=지지 유지 (무릎 무너짐 없음)' },
        ],
        effects: ['lead_vGRF_impulse', 'lead_leg_braking_impulse', 'lead_knee_W_pos', 'lead_hip_W_pos'],
        narrative_low: '앞발이 무너짐 → 앞으로 가던 힘이 회전으로 안 바뀌고 흘러감 (특히 phase 2 약점이면 릴리스 직전 power 누수)',
        narrative_high: '앞발 단단히 받쳐줌 → 회전축 형성, block power 정상',
      },
      {
        id: 'trunk_posture',
        title: '앞발 착지 시점 몸통 자세',
        causes: [
          { key: 'fc_trunk_forward_tilt', name: '착지 시점 몸통 기울기', target: -5, unit: '°', polarity: 'asymmetric' },
        ],
        effects: ['dE_trunk_FC_BR', 'ETE_trunk_to_arm'],
        narrative_low: '착지 시점에 몸통이 앞으로 숙이면 — 몸통이 미리 빠져버려 팔로 전달 못 함',
        narrative_high: '몸통이 약간 뒤로 굴곡된 자세 — 채찍 휘두를 준비 완료',
      },
      {
        id: 'shoulder_align',
        title: '어깨 정렬 (외전·외회전)',
        causes: [
          { key: 'mer_shoulder_abd', name: '외회전 시점 어깨 외전 (90° 적정)', target: 95, unit: '°', polarity: 'absolute' },
          { key: 'max_shoulder_ER', name: '최대 어깨 외회전 (170° 이상 만점)', target: 170, unit: '°' },
        ],
        effects: ['shoulder_W_pos', 'elbow_absorption_ratio'],
        narrative_low: '어깨 외전 각도 부적정 또는 외회전 부족 → 팔꿈치 부담 ↑',
        narrative_high: '어깨 정렬 적정 — 팔이 효율적으로 코킹됨',
      },
      {
        id: 'pelvis_decel',
        title: '골반 감속 (브레이크 걸기)',
        causes: [
          { key: 'pelvis_deceleration', name: '골반 회전 감속 (peak − 외회전 시점)', target: 600, unit: '°/s' },
        ],
        effects: ['ETE_pelvis_to_trunk', 'dE_trunk_KH_FC'],
        narrative_low: '골반이 충분히 멈춰주지 못함 → 몸통으로 힘 넘기는 타이밍 늦음',
        narrative_high: '골반 잘 멈춰줌 → 몸통이 채찍처럼 가속',
      },
    ];

    // 각 chain 카드 생성
    const chainCards = chains.map(ch => {
      // ★ v0.38 — 결측도 표시 (filter 제거, 미측정 행으로)
      const causesData = ch.causes.map(c => ({
        ...c,
        hint: window.TheiaMeta?.getVarMeta(c.key)?.hint || '',
        value: v(c.key),
        score: sc(c.key),
        measured: v(c.key) != null,
      }));

      const effectsData = ch.effects.map(k => ({
        key: k,
        name: window.TheiaMeta?.getVarMeta(k)?.name || k,
        unit: window.TheiaMeta?.getVarMeta(k)?.unit || '',
        hint: window.TheiaMeta?.getVarMeta(k)?.hint || '',
        value: v(k),
        score: sc(k),
        measured: v(k) != null,
      }));

      const measuredCauses = causesData.filter(c => c.measured);
      const measuredEffects = effectsData.filter(e => e.measured);
      if (measuredCauses.length === 0 && measuredEffects.length === 0) return ''; // 진짜 모두 결측

      const causeScore = measuredCauses.length > 0 ?
        measuredCauses.reduce((s, c) => s + (c.score ?? 50), 0) / measuredCauses.length : null;
      const effectScore = measuredEffects.length > 0 ?
        measuredEffects.reduce((s, e) => s + (e.score ?? 50), 0) / measuredEffects.length : null;

      // chain 종합 등급
      const chainScore = causeScore != null && effectScore != null ?
        (causeScore + effectScore) / 2 : (causeScore ?? effectScore);
      const chainColor = chainScore == null ? '#94a3b8' :
        chainScore >= 75 ? '#16a34a' : chainScore >= 50 ? '#22d3ee' : chainScore >= 30 ? '#fb923c' : '#dc2626';
      const narrative = chainScore != null && chainScore >= 60 ? ch.narrative_high : ch.narrative_low;

      // ★ v0.60 — PDF 사양 §4 모순 #2 fix: sec 단위 lag을 ms 라벨에 그대로 표시하던 버그 수정
      const _displayLagVal = (val, unit) => {
        // unit이 'ms'고 raw 값이 |x|<1이면 sec → ms 변환 (×1000)
        if (unit === 'ms' && val != null && Math.abs(val) < 1) return val * 1000;
        return val;
      };
      // 인과 화살표 시각
      const causeRows = causesData.map(c => {
        const cc = c.score == null ? '#94a3b8' : c.score >= 75 ? '#16a34a' : c.score >= 50 ? '#22d3ee' : c.score >= 30 ? '#fb923c' : '#dc2626';
        const _v = _displayLagVal(c.value, c.unit);
        const valStr = c.measured ? `${_v.toFixed(2)} ${c.unit}` : '미측정';
        const scoreStr = c.measured && c.score != null ? `${c.score}점` : '—';
        const opacity = c.measured ? '' : 'opacity: 0.5;';
        return `<div class="py-1" style="border-bottom: 1px dashed var(--border); ${opacity}">
          <div class="flex items-center justify-between text-xs">
            <span style="color: var(--text-secondary);">${c.name}</span>
            <span class="mono" style="color: var(--text-muted);">${valStr}</span>
            <span class="mono" style="color: ${cc}; font-weight: 600; min-width: 36px; text-align: right;">${scoreStr}</span>
          </div>
          ${c.hint ? `<div class="text-[10px] mt-0.5" style="color: var(--text-muted); font-style: italic;">→ ${c.hint}</div>` : ''}
        </div>`;
      }).join('');

      const effectRows = effectsData.map(e => {
        const ec = e.score == null ? '#94a3b8' : e.score >= 75 ? '#16a34a' : e.score >= 50 ? '#22d3ee' : e.score >= 30 ? '#fb923c' : '#dc2626';
        // ★ v0.60 — PDF §4 #2: sec 값에 ms 라벨 붙던 표시 버그 fix
        const _ev = typeof e.value === 'number' ? _displayLagVal(e.value, e.unit) : e.value;
        const valStr = e.measured ? `${typeof _ev === 'number' ? _ev.toFixed(2) : _ev} ${e.unit}` : '미측정';
        const scoreStr = e.measured && e.score != null ? `${e.score}점` : '—';
        const opacity = e.measured ? '' : 'opacity: 0.5;';
        return `<div class="py-1" style="border-bottom: 1px dashed var(--border); ${opacity}">
          <div class="flex items-center justify-between text-xs">
            <span style="color: var(--text-secondary);">${e.name}</span>
            <span class="mono" style="color: var(--text-muted);">${valStr}</span>
            <span class="mono" style="color: ${ec}; font-weight: 600; min-width: 36px; text-align: right;">${scoreStr}</span>
          </div>
          ${e.hint ? `<div class="text-[10px] mt-0.5" style="color: var(--text-muted); font-style: italic;">→ ${e.hint}</div>` : ''}
        </div>`;
      }).join('');

      return `<div class="card-elev p-4 mb-3" style="background: rgba(15,23,42,0.4); border-left: 3px solid ${chainColor};">
        <div class="flex items-baseline justify-between mb-3 flex-wrap" style="gap: 8px;">
          <div class="display" style="font-size: 16px; font-weight: 700; color: var(--text-primary);">🔗 ${ch.title}</div>
          <div class="text-xs" style="color: ${chainColor}; font-weight: 600;">종합 ${chainScore != null ? Math.round(chainScore) + '점' : '—'}</div>
        </div>
        ${ch.phaseLabel ? `<div class="text-[10px] mb-2 mono" style="color: var(--text-muted); padding: 6px 10px; border-left: 2px solid var(--accent-soft); background: rgba(96,165,250,0.05); border-radius: 0 4px 4px 0;">${ch.phaseLabel}</div>` : ''}
        <div class="text-xs mb-3" style="color: ${chainColor}; font-style: italic;">${narrative}</div>
        <div class="grid" style="grid-template-columns: 1fr auto 1fr; gap: 12px; align-items: stretch;">
          <div class="p-3" style="background: rgba(96,165,250,0.05); border-radius: 6px; border: 1px solid rgba(96,165,250,0.15);">
            <div class="text-[10px] mb-2" style="color: #60a5fa; font-weight: 700; letter-spacing: 0.05em;">🎯 원인 — 자세·동작</div>
            ${causeRows || '<div class="text-xs" style="color: var(--text-muted);">측정 변수 없음</div>'}
          </div>
          <div class="flex items-center justify-center" style="font-size: 28px; color: ${chainColor};">→</div>
          <div class="p-3" style="background: rgba(251,146,60,0.05); border-radius: 6px; border: 1px solid rgba(251,146,60,0.15);">
            <div class="text-[10px] mb-2" style="color: #fb923c; font-weight: 700; letter-spacing: 0.05em;">⚡ 결과 — 힘 전달 손실</div>
            ${effectRows || '<div class="text-xs" style="color: var(--text-muted);">측정 변수 없음</div>'}
          </div>
        </div>
      </div>`;
    }).filter(c => c).join('');

    if (!chainCards) return '';

    return `<div class="card-elev p-5 mt-6" style="background: linear-gradient(135deg, rgba(96,165,250,0.04), rgba(251,146,60,0.04)); border: 1px solid rgba(96,165,250,0.3);">
      <div class="flex items-baseline justify-between mb-3 flex-wrap" style="gap: 8px;">
        <div>
          <div class="display" style="font-size: 22px; font-weight: 700; color: var(--text-primary);">🔗 동작이 어디서 막혀 힘이 새고 있는가</div>
          <div class="text-xs mt-1" style="color: var(--text-secondary);">자세·동작의 문제(원인) → 발에서 공까지 힘 전달의 손실(결과)</div>
        </div>
        <div class="text-xs" style="color: var(--text-muted);">★ "어떤 동작이 어디서 힘을 새게 만들었나"</div>
      </div>
      <div class="mt-4">${chainCards}</div>
      <details class="mt-4">
        <summary class="cursor-pointer text-xs" style="color: var(--accent-soft);">📖 색상·해석 가이드</summary>
        <div class="mt-2 text-xs p-3" style="background: var(--bg-elevated); border-radius: 6px; line-height: 1.6; color: var(--text-secondary);">
          <strong>색상 등급</strong>: 🟢 75+ 우수 · 🔵 50-74 보통 · 🟠 30-49 손실 큼 · 🔴 &lt;30 심각<br>
          <strong>판독 패턴</strong>:<br>
          • <strong>동작 좋음 + 전달 좋음</strong>: 매끄러운 메커닉 ✓<br>
          • <strong>동작 좋음 + 전달 나쁨</strong>: 동작은 깔끔한데 힘이 새는 중 — 측정 시점 점검 필요<br>
          • <strong>동작 나쁨 + 전달 나쁨</strong>: 자세 문제가 직접 힘 손실로 이어짐 — 동작 교정 시급<br>
          • <strong>동작 나쁨 + 전달 좋음</strong>: 비전형 자세지만 보상으로 효율 유지 (개인 스타일)
        </div>
      </details>
    </div>`;
  }

  function _renderETESection(result) {
    const m = result.varScores || {};
    const ete_pt = m.ETE_pelvis_to_trunk?.value;
    const ete_ta = m.ETE_trunk_to_arm?.value;
    const ete_pt_score = m.ETE_pelvis_to_trunk?.score;
    const ete_ta_score = m.ETE_trunk_to_arm?.score;
    const dE_trunk_KH_FC = m.dE_trunk_KH_FC?.value;
    const dE_trunk_FC_BR = m.dE_trunk_FC_BR?.value;
    const dE_arm_FC_BR  = m.dE_arm_FC_BR?.value;
    const W_hip_pos     = m.W_hip_pos_KH_FC?.value;
    const sh_W_pos = m.shoulder_W_pos?.value;
    const sh_W_neg = m.shoulder_W_neg?.value;
    const sh_abs   = m.shoulder_absorption_ratio?.value;
    const el_W_pos = m.elbow_W_pos?.value;
    const el_W_neg = m.elbow_W_neg?.value;
    const el_abs   = m.elbow_absorption_ratio?.value;

    if (ete_pt == null && ete_ta == null && sh_W_pos == null) return '';  // 데이터 없으면 섹션 숨김

    const fmt = (v, d=2) => v == null ? '—' : v.toFixed(d);
    const eteCard = (label, ete, score, formula, dist) => {
      const pct = ete == null ? null : Math.round(ete * 100);
      const c = score == null ? '#94a3b8' : score >= 75 ? '#16a34a' : score >= 50 ? '#22d3ee' : score >= 30 ? '#fb923c' : '#dc2626';
      return `<div class="card-elev p-4" style="background: rgba(15,23,42,0.4); border-left: 3px solid ${c};">
        <div class="text-xs mb-1" style="color: var(--text-muted); letter-spacing: 0.05em;">${label}</div>
        <div class="display flex items-baseline" style="gap: 8px;">
          <span style="font-size: 36px; color: ${c}; font-weight: 700; line-height: 1;">${pct == null ? '—' : pct}</span>
          <span class="text-sm" style="color: var(--text-muted);">%</span>
          <span class="text-xs ml-2" style="color: var(--text-muted);">점수 ${score != null ? score : '—'}/100</span>
        </div>
        <div class="text-xs mt-2 mono" style="color: var(--text-muted);">${formula}</div>
        <div class="text-[10px] mt-1" style="color: var(--text-muted);">${dist}</div>
      </div>`;
    };

    const W_card = (label, W_pos, W_neg, abs_ratio) => `
      <div class="p-3" style="background: rgba(15,23,42,0.3); border-radius: 8px; flex: 1; min-width: 180px;">
        <div class="text-xs mb-2" style="color: var(--text-muted); font-weight: 600;">${label}</div>
        <div class="grid" style="grid-template-columns: 1fr 1fr; gap: 6px;">
          <div><div class="text-[10px]" style="color: var(--text-muted);">만든 힘</div><div class="mono" style="color: #16a34a;">${fmt(W_pos, 1)} J</div></div>
          <div><div class="text-[10px]" style="color: var(--text-muted);">흡수한 힘</div><div class="mono" style="color: #f87171;">${fmt(W_neg, 1)} J</div></div>
          <div style="grid-column: 1/3;"><div class="text-[10px]" style="color: var(--text-muted);">흡수/만든 비율</div><div class="mono" style="color: var(--text-primary);">${fmt(abs_ratio)}</div></div>
        </div>
      </div>`;

    return `<div class="card-elev p-5 mt-6" style="background: linear-gradient(135deg, rgba(34,211,238,0.04), rgba(99,102,241,0.04)); border: 1px solid rgba(34,211,238,0.3);">
      <div class="flex items-baseline justify-between mb-3 flex-wrap" style="gap: 8px;">
        <div>
          <div class="display" style="font-size: 22px; font-weight: 700; color: #22d3ee;">⚡ 골반 → 몸통 → 팔로 힘이 얼마나 잘 넘어갔나</div>
          <div class="text-xs mt-1" style="color: var(--text-secondary);">앞 분절이 만든 힘이 다음 분절로 얼마나 전달됐는지 측정</div>
        </div>
        <div class="text-xs" style="color: var(--text-muted);">★ 100% = 손실 없이 다 넘김</div>
      </div>

      <div class="grid mt-4" style="grid-template-columns: 1fr 1fr; gap: 12px;">
        ${eteCard('골반 → 몸통 전달율', ete_pt, ete_pt_score,
          '몸통이 받은 에너지 ÷ 골반이 만든 일',
          `몸통 에너지 변화 = ${fmt(dE_trunk_KH_FC, 1)} J · 골반 일 = ${fmt(W_hip_pos, 1)} J · 프로 기준 55%±20`)}
        ${eteCard('몸통 → 팔 전달율', ete_ta, ete_ta_score,
          '팔이 받은 에너지 ÷ 몸통이 잃은 에너지',
          `팔 에너지 변화 = ${fmt(dE_arm_FC_BR, 1)} J · 몸통 잃은 양 = ${fmt(Math.abs(dE_trunk_FC_BR || 0), 1)} J · 프로 기준 50%±18`)}
      </div>

      <div class="mt-5">
        <div class="text-xs mb-2" style="color: var(--text-muted); font-weight: 600;">관절이 만든 힘 vs 흡수한 힘</div>
        <div class="flex flex-wrap" style="gap: 12px;">
          ${W_card('어깨', sh_W_pos, sh_W_neg, sh_abs)}
          ${W_card('팔꿈치', el_W_pos, el_W_neg, el_abs)}
        </div>
      </div>

      <details class="mt-4">
        <summary class="cursor-pointer text-xs" style="color: var(--accent-soft);">📖 해석 가이드</summary>
        <div class="mt-2 text-xs p-3" style="background: var(--bg-elevated); border-radius: 6px; line-height: 1.6; color: var(--text-secondary);">
          <strong>전달율</strong>: 앞 분절(골반·몸통)이 만든 힘이 다음 분절(몸통·팔)로 얼마나 잘 넘어갔는지.
          <ul class="mt-1 ml-4" style="list-style: disc;">
            <li>50% 이상 = 우수 (힘이 잘 넘어감)</li>
            <li>35~50% = 보통</li>
            <li>35% 미만 = 손실 큼 (힘이 새고 있음)</li>
          </ul>
          <strong>관절이 만든 힘 vs 흡수한 힘</strong>:<br>
          • 어깨 흡수비 ~1.0 = 정상 (만든 만큼 멈춤)<br>
          • 팔꿈치 흡수비 ~2.0 = 정상 (브레이크 역할이 강함, 즉 통로 역할 잘 함)
        </div>
      </details>
    </div>`;
  }

  // ── 참고문헌 카드 ──
  function _renderELIReferences(result) {
    const TM = window.TheiaMeta;
    if (!TM?.ELI_REFERENCES) return '';
    const refs = TM.ELI_REFERENCES.map(r => `
      <li class="mb-2" style="font-size: 11px; line-height: 1.6;">
        <strong style="color: var(--text-primary);">[${r.id}]</strong>
        <span style="color: var(--text-secondary);">${r.authors} (${r.year}).</span>
        <em style="color: var(--text-secondary);">${r.title}.</em>
        <span style="color: var(--text-muted);">${r.journal}.</span>
        ${r.doi ? `<a href="https://doi.org/${r.doi}" target="_blank" class="mono" style="color: var(--accent-soft); margin-left: 4px;">DOI: ${r.doi}</a>` : ''}
      </li>`).join('');
    return `
    <details class="cat-card mt-4" style="padding: 14px;">
      <summary class="cursor-pointer" style="color: var(--text-muted); font-size: 13px;">📚 참고문헌 (5건) — Integrated ELI 산식 근거</summary>
      <ul class="mt-3 list-none pl-0">${refs}</ul>
      <div class="text-[10px] mt-2" style="color: var(--text-muted); font-style: italic;">
        본 리포트의 ETE·ELI 산식은 위 5개 문헌의 segmental power analysis + lower body energy generation/transfer + proximal-to-distal sequential distribution + sequential motions framework + youth pitcher injury prevention guidelines를 통합 적용함.
      </div>
    </details>`;
  }

  // ── 2단계 · 키네틱 체인이란? — 교육 카드 + GIF ──
  // 우선순위: ① 로컬 kinetic_chain.gif (같은 repo 번들) → ② BBL Uplift CDN fallback → ③ 텍스트 fallback
  function _renderKineticChainEducation(result) {
    const localGif = 'kinetic_chain.gif';
    const cdnGif = 'https://kkl0511.github.io/Uplift_Pitching_Report/kinetic_chain.gif';
    return `
    <div class="cat-card mb-6" style="padding: 18px; border-left: 4px solid var(--accent-soft); background: linear-gradient(180deg, rgba(96,165,250,0.04), transparent);">
      <div class="display text-base mb-2" style="color: var(--accent-soft);">⚡ 2단계 · 키네틱 체인이란?</div>
      <div class="text-sm mb-3" style="color: var(--text-secondary); line-height: 1.6;">
        투구는 <strong>다리에서 시작된 힘이 골반 → 몸통 → 팔</strong>로 채찍처럼 전달되는 운동입니다.
        각 단계의 타이밍과 강도가 정확해야 빠른 공이 나오고 부상도 예방됩니다.
      </div>
      <img src="${localGif}" alt="키네틱 체인 — 5단계 에너지 흐름"
           loading="lazy" decoding="async"
           onerror="this.onerror=null; this.src='${cdnGif}'; this.onerror=function(){ this.style.display='none'; this.nextElementSibling.style.display='block'; };"
           style="width: 100%; max-width: 1000px; display: block; margin: 0 auto; border-radius: 6px;" />
      <!-- 로컬·CDN 모두 실패 시 fallback -->
      <div style="display: none; padding: 24px; background: var(--bg-elevated); border-radius: 6px; text-align: center;">
        <div class="text-sm mb-2" style="color: var(--text-muted);">GIF 로드 실패 — 5단계 시퀀스</div>
        <div class="grid grid-cols-5 gap-2" style="color: var(--text-secondary);">
          <div><strong>① Ground & leg</strong><br><span class="text-xs">하체 추진</span></div>
          <div><strong>② Torso energy</strong><br><span class="text-xs">몸통 에너지</span></div>
          <div><strong>③ Shoulder</strong><br><span class="text-xs">어깨 augment</span></div>
          <div><strong>④ Elbow</strong><br><span class="text-xs">팔꿈치 집중</span></div>
          <div><strong>⑤ Release</strong><br><span class="text-xs">릴리스</span></div>
        </div>
      </div>
      <div class="text-xs text-center mt-2" style="color: var(--text-muted); font-style: italic;">The Kinetic chain in pitch mechanics</div>
    </div>`;
  }

  // ── ★ v0.18 — 액션 버튼 카드로 강조 (저장 / 다운로드 / 인쇄) ──
  function _renderActionButtons(result) {
    return `
    <div class="cat-card mt-6" style="padding: 22px; border: 2px solid var(--accent-soft, #2E75B6); background: linear-gradient(135deg, rgba(46,117,182,0.08), rgba(22,163,74,0.05));">
      <div class="display text-xl mb-2" style="color: var(--accent-soft);">💾 리포트 저장 / 공유</div>
      <div class="text-sm mb-4" style="color: var(--text-secondary);">
        분석 결과를 저장하면 <strong>1차↔2차 비교</strong>·<strong>선수간 비교</strong> 탭에서 활용할 수 있고, 다운로드한 HTML은 인터넷 없이도 선수에게 전달 가능합니다.
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <!-- 1. 저장 (가장 강조) -->
        <button onclick="saveReportClick()"
                style="background: var(--output, #C00000); color: white; padding: 14px 18px; border-radius: 8px; border: none; font-size: 14px; cursor: pointer; font-weight: 700; box-shadow: 0 2px 8px rgba(192,0,0,0.3); transition: all 0.15s;"
                onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(192,0,0,0.4)'"
                onmouseout="this.style.transform=''; this.style.boxShadow='0 2px 8px rgba(192,0,0,0.3)'">
          💾 이 리포트 저장<br><span style="font-size: 11px; font-weight: 400; opacity: 0.9;">(비교 탭에서 사용)</span>
        </button>
        <!-- 2. 오프라인 패키지 -->
        <button onclick="downloadOfflinePackage()"
                style="background: var(--good, #16a34a); color: white; padding: 14px 18px; border-radius: 8px; border: none; font-size: 14px; cursor: pointer; font-weight: 700; box-shadow: 0 2px 8px rgba(22,163,74,0.3); transition: all 0.15s;"
                onmouseover="this.style.transform='translateY(-2px)'"
                onmouseout="this.style.transform=''">
          📦 오프라인 패키지<br><span style="font-size: 11px; font-weight: 400; opacity: 0.9;">(인터넷 불필요)</span>
        </button>
        <!-- 3. HTML 다운로드 -->
        <button onclick="downloadHtml()"
                style="background: var(--accent-soft, #2E75B6); color: white; padding: 14px 18px; border-radius: 8px; border: none; font-size: 14px; cursor: pointer; font-weight: 700; box-shadow: 0 2px 8px rgba(46,117,182,0.3); transition: all 0.15s;"
                onmouseover="this.style.transform='translateY(-2px)'"
                onmouseout="this.style.transform=''">
          📄 HTML 다운로드<br><span style="font-size: 11px; font-weight: 400; opacity: 0.9;">(가벼움·인터넷 필요)</span>
        </button>
        <!-- 4. 인쇄/PDF -->
        <button onclick="window.print()"
                style="background: var(--bg-elevated); color: var(--text-primary); padding: 14px 18px; border-radius: 8px; border: 2px solid var(--border); font-size: 14px; cursor: pointer; font-weight: 700; transition: all 0.15s;"
                onmouseover="this.style.borderColor='var(--accent)'; this.style.transform='translateY(-2px)'"
                onmouseout="this.style.borderColor='var(--border)'; this.style.transform=''">
          🖨 인쇄 / PDF<br><span style="font-size: 11px; font-weight: 400; opacity: 0.7;">(브라우저 인쇄)</span>
        </button>
      </div>
      <div class="text-[11px] mt-3" style="color: var(--text-muted); font-style: italic; line-height: 1.5;">
        ※ <strong>저장</strong>: 브라우저 localStorage에 저장됩니다 (브라우저 캐시 삭제 시 사라짐 — 영구 보관은 HTML 다운로드 권장).
        <br>※ <strong>오프라인 패키지</strong>: 결과 JSON을 포함한 단일 HTML — 다른 PC·태블릿에서도 인터넷 없이 열림.
        <br>※ <strong>HTML 다운로드</strong>: 현재 페이지 그대로 저장 — Tailwind CDN 사용 (인터넷 필요).
      </div>
    </div>`;
  }

  // ── 잠재 구속 예측 ── (★ v0.27 — 향상치 상수 확대)
  // HS Top 10% mode: 측정 구속 기준 카테고리 점수의 부족분만큼 향상 가능치 추정
  // - 체력만 100점 발전 → +6 km/h (기존 5)
  // - 메카닉(Output+Transfer) 100점 발전 → +10 km/h (기존 5)
  // - 둘 다 100점 → +14 km/h (기존 7)
  function _predictPotentialVelo(result) {
    const cur = result.varScores?.ball_speed?.value;
    if (cur == null) return null;
    const out = result.catScores?.OUTPUT?.score ?? 50;
    const tr  = result.catScores?.TRANSFER?.score ?? 50;
    const lk  = result.catScores?.LEAK?.score ?? 50;
    const ctrl = result.catScores?.CONTROL?.score ?? 50;
    // 부족분 — 100 - score
    const fitGap = (100 - ctrl + 0) / 100;  // proxy 체력 (실측 fitness 데이터 있으면 대체)
    const mechGap = (100 - (out + tr) / 2) / 100;
    const fitOnly  = +(cur + 6.0  * fitGap).toFixed(1);
    const mechOnly = +(cur + 10.0 * mechGap).toFixed(1);
    const both     = +(cur + 14.0 * Math.max(fitGap, mechGap)).toFixed(1);
    return { current: cur, fitOnly, mechOnly, both };
  }

  // 좌·우투 + 측정 구속 기준 Mode 분류 (BBL Uplift Mode A/B/C 동일)
  function _getPlayerMode(hand, ballSp) {
    if (ballSp == null) return { id: 'unknown', label: '미평가', color: '#94a3b8' };
    const eliteThr = hand === 'left' ? 135 : 140;
    const devThr   = hand === 'left' ? 125 : 130;
    if (ballSp >= eliteThr) return { id: 'B', label: '⭐ Elite 정착 (Mode B)', color: '#c084fc', desc: 'MaxV ≥' + eliteThr + ' km/h — 미세조정 (좁은 σ)' };
    if (ballSp >= devThr)   return { id: 'C', label: '🔧 표준 발전 (Mode C)', color: '#fb923c', desc: '발전 단계 — 출력·전달 동시 향상' };
    return { id: 'A', label: '🌱 발전 단계 (Mode A)', color: '#60a5fa', desc: '기초 단계 — 체력·시퀀싱 기초 형성' };
  }

  function _renderHeader(result) {
    const TC = window.TheiaCohort;
    const m = TC.getMode(result._mode);
    const ballSp = result.varScores?.ball_speed?.value;
    const hand = result._meta?.handedness || ((window.TheiaApp.getPlayer ? window.TheiaApp.getPlayer().handedness : "right")) || 'right';
    const handLabel = hand === 'left' ? '좌투' : '우투';
    const level = result._meta?.level || '';
    const date = (_getFitMeta() != null && (_getFitMeta() ? _getFitMeta().date : null)) || '';
    const nVar = Object.keys(result.varScores || {}).filter(k => result.varScores[k]?.value != null).length;

    // 잠재 구속 4카드
    const pred = _predictPotentialVelo(result);
    const playerMode = _getPlayerMode(hand, ballSp);

    const card = (label, val, color, delta) => {
      const valStr = val != null ? `<span class="display" style="font-size: 36px; color: ${color}; font-weight: 700; line-height: 1;">${val.toFixed(1)}</span><span class="text-sm" style="color: var(--text-muted); margin-left: 4px;">km/h</span>`
                                  : `<span class="display" style="font-size: 36px; color: var(--text-muted);">—</span>`;
      const deltaStr = delta != null ? `<div class="mt-1 mono" style="color: #16a34a; font-size: 13px; font-weight: 600;">+${delta.toFixed(1)} km/h</div>` : '';
      return `<div style="flex: 1; min-width: 140px;">
        <div class="text-xs mb-1" style="color: var(--text-muted); letter-spacing: 0.05em;">${label}</div>
        <div>${valStr}</div>
        ${deltaStr}
      </div>`;
    };

    let velocityCards = '';
    if (pred) {
      const dMech = +(pred.mechOnly - pred.current).toFixed(1);
      const dFit  = +(pred.fitOnly - pred.current).toFixed(1);
      const dBoth = +(pred.both - pred.current).toFixed(1);
      velocityCards = `
      <div class="flex gap-6 flex-wrap mt-3">
        ${card('측정 구속', pred.current, 'var(--text-primary)', null)}
        ${card('체력만 발전 시 잠재 구속', pred.fitOnly, '#60a5fa', dFit > 0 ? dFit : null)}
        ${card('메카닉만 발전 시 잠재 구속', pred.mechOnly, '#fb923c', dMech > 0 ? dMech : null)}
        ${card('동시 발전 시 잠재 구속', pred.both, '#fbbf24', dBoth > 0 ? dBoth : null)}
      </div>`;
    } else {
      velocityCards = `<div class="text-sm mt-2" style="color: var(--text-muted);">⚾ 구속 미입력 — Step 1에서 평균 구속 입력 또는 Step 2 metadata xlsx 업로드</div>`;
    }

    // 좌·우투 변경 버튼
    const handToggle = `<button onclick="window.TheiaApp.toggleHand && window.TheiaApp.toggleHand()"
      style="background: var(--bg-elevated); border: 1px solid var(--border); padding: 4px 10px; border-radius: 4px; font-size: 11px; cursor: pointer; color: var(--text-secondary); margin-left: 8px;">
      ✏️ ${hand === 'left' ? '우투로 변경' : '좌투로 변경'}
    </button>`;

    return `
    <div class="cat-card mb-6" style="border: 2px solid ${playerMode.color}; padding: 22px;">
      <div class="flex justify-between items-start flex-wrap gap-3 mb-2">
        <div>
          <div class="text-xs mb-1 mono" style="color: var(--text-muted); letter-spacing: 0.1em;">PLAYER ID · ${level || '—'}</div>
          <div class="display text-3xl" style="font-weight: 700;">${result._meta?.athlete || '신규 선수'}</div>
          <div class="text-xs mt-1" style="color: var(--text-muted);">
            ${date || (result._meta?.date || '—')} · ${nVar}개 변수 입력
          </div>
        </div>
        <div class="text-right">
          <div class="mono text-xs uppercase tracking-widest mb-1" style="color: var(--text-muted);">${m.label}</div>
          ${result._mode === 'pro' ? `<div class="mono" style="color: #fbbf24; font-size: 9px; letter-spacing: 0.05em; margin-bottom: 4px;">⚠ 본인 trial이 reference에 포함될 경우<br>자가비교 — 점수 deflate 정상</div>` : ''}
          <div style="background: ${playerMode.color}22; color: ${playerMode.color}; padding: 6px 16px; border-radius: 18px; font-weight: 700; font-size: 14px; display: inline-block;">
            ${handLabel} · ${playerMode.label}
          </div>
          <div>${handToggle}</div>
          <div class="text-xs mt-2" style="color: var(--text-muted);">${playerMode.desc || ''}</div>
        </div>
      </div>
      ${velocityCards}
      <div class="text-xs mt-3 mono" style="color: var(--text-muted);">
        ${result._meta?.height_cm || '—'} cm · ${result._meta?.mass_kg || '—'} kg
        · Trial ${result._n_trials}
      </div>
    </div>`;
  }

  function _renderQuadrantDiagnosis(result) {
    const outScore = result.catScores?.OUTPUT?.score;
    const trScore  = result.catScores?.TRANSFER?.score;
    const injScore = result.catScores?.INJURY?.score;
    if (outScore == null || trScore == null) return `
      <div class="cat-card mb-6" style="padding: 18px;">
        <div class="display text-lg" style="color: var(--accent);">🎯 출력 vs 에너지 효율</div>
        <div class="text-sm mt-2" style="color: var(--text-muted);">OUTPUT/TRANSFER 카테고리 변수 산출 부족 — c3d.txt에 ball_speed·증폭률 변수가 있어야 진단 가능</div>
      </div>`;

    const injRisk = injScore != null ? (100 - injScore) : 50;
    const dotColor = injRisk >= 80 ? '#dc2626' : injRisk >= 50 ? '#fb923c' : '#16a34a';

    // 4사분면 분류 — Elite 상대 용어 (아마 = Amateur)
    let quadrant, qLabel, qColor, qPriority, qMessage;
    if (outScore >= 50 && trScore >= 50) {
      quadrant = 1; qLabel = '① Elite'; qColor = '#16a34a'; qPriority = '유지';
      qMessage = '출력·에너지 효율 모두 코호트 평균 이상. 현재 메카닉 유지 + 부상 모니터링.';
    } else if (outScore >= 50 && trScore < 50) {
      quadrant = 2; qLabel = '② 낭비형 (Inefficient)'; qColor = '#fb923c'; qPriority = '★ 코칭 효과 가장 큼';
      qMessage = '출력은 잘 만드는데 에너지 효율이 낮아 손실. <strong>시퀀싱·증폭 최적화로 즉시 구속 향상 가능</strong> — 메카닉 코칭이 가장 큰 수익을 내는 유형.';
    } else if (outScore < 50 && trScore >= 50) {
      quadrant = 3; qLabel = '③ 효율형 (Underpowered)'; qColor = '#0070C0'; qPriority = '체력 강화';
      qMessage = '메카닉 효율은 좋은데 <strong>출력 자체가 부족</strong>. 체력(파워·근력)으로 출력을 끌어올리면 elite로 점프 가능.';
    } else {
      quadrant = 4; qLabel = '④ 아마 (Amateur)'; qColor = '#94a3b8'; qPriority = '기초';
      qMessage = '둘 다 평균 미만 — Amateur 수준. 체력·시퀀싱 기초 동시 향상 — 인내심 있게 단계별 발전.';
    }

    // SVG 4사분면 (pos: outScore=x, trScore=y)
    const W = 360, H = 320, P = 40;
    const xs = (v) => P + (v / 100) * (W - 2 * P);
    const ys = (v) => H - P - (v / 100) * (H - 2 * P);
    const cx = xs(outScore), cy = ys(trScore);

    const svgQuadrant = `<svg viewBox="0 0 ${W} ${H}" style="width: 100%; max-width: 480px; height: auto;">
      <!-- 4사분면 배경 -->
      <rect x="${xs(50)}" y="${ys(100)}" width="${xs(100)-xs(50)}" height="${ys(50)-ys(100)}" fill="#16a34a" opacity="0.08"/>
      <rect x="${xs(50)}" y="${ys(50)}" width="${xs(100)-xs(50)}" height="${ys(0)-ys(50)}" fill="#fb923c" opacity="0.08"/>
      <rect x="${xs(0)}" y="${ys(100)}" width="${xs(50)-xs(0)}" height="${ys(50)-ys(100)}" fill="#0070C0" opacity="0.08"/>
      <rect x="${xs(0)}" y="${ys(50)}" width="${xs(50)-xs(0)}" height="${ys(0)-ys(50)}" fill="#94a3b8" opacity="0.08"/>
      <!-- 격자 -->
      <line x1="${xs(50)}" y1="${ys(0)}" x2="${xs(50)}" y2="${ys(100)}" stroke="var(--border)" stroke-dasharray="4,4"/>
      <line x1="${xs(0)}" y1="${ys(50)}" x2="${xs(100)}" y2="${ys(50)}" stroke="var(--border)" stroke-dasharray="4,4"/>
      <!-- 축 -->
      <line x1="${xs(0)}" y1="${ys(0)}" x2="${xs(100)}" y2="${ys(0)}" stroke="var(--text-muted)"/>
      <line x1="${xs(0)}" y1="${ys(0)}" x2="${xs(0)}" y2="${ys(100)}" stroke="var(--text-muted)"/>
      <!-- 사분면 라벨 -->
      <text x="${xs(75)}" y="${ys(85)}" text-anchor="middle" font-size="10" fill="#16a34a" font-weight="bold">① Elite</text>
      <text x="${xs(75)}" y="${ys(15)}" text-anchor="middle" font-size="10" fill="#fb923c" font-weight="bold">② 낭비형</text>
      <text x="${xs(25)}" y="${ys(85)}" text-anchor="middle" font-size="10" fill="#0070C0" font-weight="bold">③ 효율형</text>
      <text x="${xs(25)}" y="${ys(15)}" text-anchor="middle" font-size="10" fill="#94a3b8" font-weight="bold">④ 아마</text>
      <!-- 축 라벨 — % 표시 -->
      <text x="${W/2}" y="${H-8}" text-anchor="middle" font-size="11" fill="var(--text-secondary)" font-weight="600">출력 Output (%)</text>
      <text x="14" y="${H/2}" text-anchor="middle" font-size="11" fill="var(--text-secondary)" font-weight="600" transform="rotate(-90 14 ${H/2})">에너지 효율 Energy Efficiency (%)</text>
      <!-- 0/50/100 눈금 -->
      <text x="${xs(0)}" y="${ys(0)+14}" text-anchor="middle" font-size="9" fill="var(--text-muted)">0</text>
      <text x="${xs(50)}" y="${ys(0)+14}" text-anchor="middle" font-size="9" fill="var(--text-muted)">50</text>
      <text x="${xs(100)}" y="${ys(0)+14}" text-anchor="middle" font-size="9" fill="var(--text-muted)">100</text>
      <text x="${xs(0)-12}" y="${ys(0)}" text-anchor="end" font-size="9" fill="var(--text-muted)">0</text>
      <text x="${xs(0)-12}" y="${ys(50)+3}" text-anchor="end" font-size="9" fill="var(--text-muted)">50</text>
      <text x="${xs(0)-12}" y="${ys(100)+3}" text-anchor="end" font-size="9" fill="var(--text-muted)">100</text>
      <!-- 본 선수 점 -->
      <circle cx="${cx}" cy="${cy}" r="9" fill="${dotColor}" stroke="white" stroke-width="2"/>
      <circle cx="${cx}" cy="${cy}" r="14" fill="none" stroke="${dotColor}" stroke-width="1" opacity="0.5"/>
      <text x="${cx}" y="${cy-18}" text-anchor="middle" font-size="11" font-weight="bold" fill="${dotColor}">본 선수</text>
    </svg>`;

    // ★ v0.11 — 캡쳐 이미지 형식 expand 카드 (출력 / 전달 / 부상 위험)
    const TM = window.TheiaMeta;
    const _expandCard = (label, engLabel, score, color, catId, intVarKey, intUnit) => {
      const cat = result.catScores[catId];
      const intVal = cat?.integrationValue;
      const intName = TM?.getVarMeta?.(intVarKey)?.name || intVarKey;
      return `<details class="mb-2" style="background: var(--bg-elevated); border-radius: 6px; border-left: 4px solid ${color}; padding: 10px 14px;">
        <summary class="cursor-pointer" style="list-style: none;">
          <div class="flex items-baseline flex-wrap gap-2">
            <strong style="color: ${color}; font-size: 16px;">▸ ${label}</strong>
            <span style="color: var(--text-muted); font-size: 12px;">(${engLabel})</span>
            <span class="mono text-xs ml-2" style="color: var(--text-muted);">${cat?.total || 0}변수</span>
            <span class="ml-auto" style="font-size: 14px; color: var(--text-muted);">종합 <strong class="mono" style="color: ${color}; font-size: 16px;">${score != null ? score + 'pt' : '—'}</strong>
              <span class="text-xs" style="color: var(--text-muted);"> (${cat?.measured || 0}/${cat?.total || 0}변수)</span></span>
          </div>
          <div class="text-xs mt-1" style="color: var(--text-muted);">${cat?.desc || ''}</div>
          ${intVal != null ? `<div class="text-xs mt-1" style="color: var(--text-secondary);">통합 지표: <strong style="color: ${color};">★ ${intName}</strong> = <span class="mono">${typeof intVal === 'number' ? intVal.toFixed(2) : intVal}${intUnit || ''}</span></div>` : ''}
        </summary>
        <div class="mt-3 pt-3" style="border-top: 1px dashed var(--border);">
          ${_renderVarDetail(result, TM.OTL_CATEGORIES[catId].variables)}
        </div>
      </details>`;
    };

    return `
    <div class="cat-card mb-6" style="padding: 18px;">
      <div class="flex justify-between items-start mb-2">
        <div>
          <div class="mono text-xs uppercase tracking-widest" style="color: var(--text-muted);">DIAGNOSIS · ${ALGORITHM_VERSION}</div>
          <div class="display text-xl mt-1" style="color: var(--accent-soft);">🎯 출력 vs 에너지 효율</div>
        </div>
        <div class="text-right">
          <div class="display text-base" style="color: ${qColor}; font-weight: 700;">${qLabel}</div>
          <div class="text-xs mono uppercase mt-1" style="color: var(--text-muted);">우선순위: ${qPriority}</div>
        </div>
      </div>
      <div class="text-sm leading-relaxed mb-3 p-3 rounded" style="background: var(--bg-elevated); border-left: 3px solid ${qColor};">
        ${qMessage}
      </div>
      <div class="grid md:grid-cols-2 gap-3 items-center mb-4">
        <div>${svgQuadrant}</div>
        <div class="text-xs" style="color: var(--text-muted); line-height: 1.6;">
          <strong>해석:</strong><br>
          • X축 = 출력 (Output) % — 절대 회전 속도·선형 출력의 percentile<br>
          • Y축 = 에너지 효율 (Energy Efficiency) % — 시퀀싱·증폭률·전달 효율<br>
          • 점 색상 = 부상 위험 등급 (<span style="color: #16a34a;">●</span>안전 / <span style="color: #fb923c;">●</span>주의 / <span style="color: #dc2626;">●</span>위험)<br>
          • Elite 사분면 (①) = 출력·효율 모두 ≥50% (코호트 중앙값 이상)
        </div>
      </div>
      <!-- ▸ expand 카드 형식 -->
      ${_expandCard('출력 (Power Generation · 높을수록 좋음)', '각 분절(하체→몸통→팔)이 만들어내는 절대 회전·선형 출력 — Ball velocity는 km/h, wrist 선형 속도는 별도 m/s 변수', outScore, '#16a34a', 'OUTPUT', 'ball_speed', ' km/h')}
      ${_expandCard('에너지 전달 (Transfer Efficiency · 높을수록 좋음)', '분절 간 에너지가 효율적으로 흐르는가 — 타이밍·증폭률·저장방출', trScore, '#fb923c', 'TRANSFER', 'angular_chain_amplification', ' x')}
      ${_expandCard('부하 안전도 (Load Safety · 높을수록 안전)', '★ v0.60 PDF §4 #4 fix — 점수 방향성 명시. 출력의 비용 — UCL stress (팔꿈치) + knee stress (drive 다리). 점수 높음 = 부하 적음 = 안전. UCL stress 경고가 별도 표시되면 그것이 우선.', injScore, '#f87171', 'INJURY', 'max_shoulder_ER', ' °')}
    </div>`;
  }

  // ★ v0.11 — 메카닉 세션(_compute6axisMech) 6축과 동일한 변수 매핑 사용 (일관성)
  function _renderKineticChainStages(result) {
    // 메카닉 세션과 동일한 6단계 정의를 _compute6axisMech에서 가져옴
    const dims = _compute6axisMech(result);
    const stageBoxes = dims.map((d, i) => {
      const avg = d.val;  // 메카닉 세션과 동일한 점수
      const color = avg == null ? '#94a3b8' : avg >= 75 ? '#16a34a' : avg >= 50 ? '#0070C0' : avg >= 35 ? '#fb923c' : '#dc2626';
      const sevIcon = avg == null ? '○' : avg >= 75 ? '✓' : avg >= 50 ? '◐' : avg >= 35 ? '⚠' : '🚨';
      const refVarsHtml = (d.refVars || []).slice(0, 3).map(rv => `<code class="mono text-[9px]" style="background: var(--bg-card); padding: 1px 4px; border-radius: 2px; margin-right: 3px;">${rv}</code>`).join('');
      return `
      <div style="background: var(--bg-elevated); border: 1px solid var(--border); border-left: 4px solid ${color}; border-radius: 6px; padding: 10px 12px;">
        <div class="flex items-center gap-2 mb-1">
          <span class="mono text-xs" style="color: var(--text-muted);">단계 ${i+1}</span>
          <span style="color: ${color}; font-size: 14px;">${sevIcon}</span>
          <strong class="text-sm" style="color: var(--text-primary);">${d.label}</strong>
          <span class="ml-auto mono text-sm" style="color: ${color}; font-weight: 700;">${avg != null ? avg.toFixed(0) : '—'}<span style="font-size:10px; color: var(--text-muted);">/100</span></span>
        </div>
        <div class="text-xs" style="color: var(--text-muted); line-height: 1.5;">
          ${d.desc || ''}
        </div>
        <div class="text-[10px] mt-1" style="color: var(--text-muted);">
          ${refVarsHtml}
        </div>
      </div>`;
    }).join('');

    return `
    <div class="cat-card mb-6" style="padding: 18px;">
      <div class="display text-xl mb-2" style="color: var(--transfer);">⚡ 키네틱 체인 6단계 진단</div>
      <div class="text-sm mb-3" style="color: var(--text-secondary); line-height: 1.6;">
        다리→골반→몸통→팔→릴리스 6 단계 — <strong>메카닉 세션 라디아 차트와 동일한 변수·점수</strong>로 진단합니다.
        각 단계 카드 우상단 점수 = 라디아 차트 정점 점수.
      </div>
      <div class="grid md:grid-cols-2 gap-3">${stageBoxes}</div>
    </div>`;
  }

  // ── 4. 에너지 흐름 (키네틱 변수 기반) ──
  function _renderCategoryCards(result) {
    const TM = window.TheiaMeta;
    let html = '<div class="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">';
    for (const catId of ['OUTPUT', 'TRANSFER', 'LEAK', 'CONTROL', 'INJURY']) {
      const c = result.catScores[catId];
      if (!c) continue;
      const scoreColor = c.score == null ? '#888' : c.score >= 75 ? '#16a34a' : c.score >= 50 ? '#fb923c' : '#dc2626';
      html += `<div class="cat-card ${catId}">
        <div class="cat-header">
          <div class="cat-title">${c.name}</div>
          <div class="cat-score" style="color: ${scoreColor};">${c.score != null ? c.score : '—'}<span class="total">/100</span></div>
        </div>
        <div class="cat-meta">${c.desc}</div>
        <div class="cat-meta mono">측정 ${c.measured}/${c.total} 변수</div>
        ${c.integrationValue != null ? `<div class="text-xs mt-2 p-2 rounded" style="background: var(--bg-elevated); border-left: 3px solid ${c.color};">
          ★ ${TM.getVarMeta(c.integrationVar)?.name || c.integrationVar}: <strong>${formatVal(c.integrationValue, TM.getVarMeta(c.integrationVar)?.unit)}</strong>${c.integrationScore != null ? ` (${c.integrationScore}점)` : ''}
        </div>` : ''}
        <details><summary>변수별 상세 (${c.measured}개)</summary>${_renderVarDetail(result, TM.OTL_CATEGORIES[catId].variables)}</details>
      </div>`;
    }
    html += '</div>';
    return html;
  }

  function _renderGRFSection(result) {
    const m = result.varScores || {};
    const trailV = m['Trail_leg_peak_vertical_GRF']?.value;
    const trailVS = m['Trail_leg_peak_vertical_GRF']?.score;
    const trailAP = m['Trail_leg_peak_AP_GRF']?.value;
    const trailAPS = m['Trail_leg_peak_AP_GRF']?.score;
    const leadV = m['Lead_leg_peak_vertical_GRF']?.value;
    const leadVS = m['Lead_leg_peak_vertical_GRF']?.score;
    const leadAP = m['Lead_leg_peak_AP_GRF']?.value;
    const leadAPS = m['Lead_leg_peak_AP_GRF']?.score;
    const transition = m['trail_to_lead_vgrf_peak_s']?.value;
    const transitionS = m['trail_to_lead_vgrf_peak_s']?.score;
    const trailImpulse = m['trail_impulse_stride']?.value;
    // ★ v0.32 — v0.31의 새 impulse 변수
    const driveAP = m['drive_leg_propulsive_impulse']?.value;
    const driveAPS = m['drive_leg_propulsive_impulse']?.score;
    const brakeAP = m['lead_leg_braking_impulse']?.value;
    const brakeAPS = m['lead_leg_braking_impulse']?.score;
    const trailVZi = m['trail_vGRF_impulse']?.value;
    const trailVZiS = m['trail_vGRF_impulse']?.score;
    const leadVZi = m['lead_vGRF_impulse']?.value;
    const leadVZiS = m['lead_vGRF_impulse']?.score;

    const measured = [trailV, leadV, trailAP, leadAP, transition, trailImpulse, driveAP, brakeAP, trailVZi, leadVZi].filter(x => x != null).length;
    if (measured === 0) {
      return `
      <div class="cat-card mb-6" style="padding: 18px; border-left: 4px solid #6b7280;">
        <div class="display text-xl mb-2" style="color: #6b7280;">🦵 GRF 분석 (지면반력)</div>
        <div class="text-sm" style="color: var(--text-muted);">
          지면반력 데이터 없음 — c3d.txt에 <strong>FP1/FP2 force plate</strong> 데이터 (FORCE X/Y/Z) 또는 <strong>Trail_Leg_GRF/Lead_Leg_GRF</strong> 컬럼 필요.
        </div>
      </div>`;
    }

    // 막대 차트 — Trail vs Lead vGRF
    const W = 340, H = 200, P = 30;
    const maxV = Math.max(2.5, leadV || 2.0, trailV || 2.0);
    const barW = 80;
    const yScale = (v) => H - P - (v / maxV) * (H - 2 * P);

    const grfBar = `<svg viewBox="0 0 ${W} ${H}" style="width: 100%; max-width: 380px; height: auto;">
      <line x1="${P}" y1="${H-P}" x2="${W-P}" y2="${H-P}" stroke="var(--text-muted)"/>
      <line x1="${P}" y1="${P}" x2="${P}" y2="${H-P}" stroke="var(--text-muted)"/>
      ${trailV != null ? `
        <rect x="${W*0.25 - barW/2}" y="${yScale(trailV)}" width="${barW}" height="${(H-P) - yScale(trailV)}" fill="#0070C0" opacity="0.7"/>
        <text x="${W*0.25}" y="${yScale(trailV) - 6}" text-anchor="middle" font-size="13" font-weight="bold" fill="#0070C0">${trailV.toFixed(2)}</text>
        <text x="${W*0.25}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--text-secondary)">축발 (뒷발)</text>
      ` : ''}
      ${leadV != null ? `
        <rect x="${W*0.65 - barW/2}" y="${yScale(leadV)}" width="${barW}" height="${(H-P) - yScale(leadV)}" fill="#C00000" opacity="0.7"/>
        <text x="${W*0.65}" y="${yScale(leadV) - 6}" text-anchor="middle" font-size="13" font-weight="bold" fill="#C00000">${leadV.toFixed(2)}</text>
        <text x="${W*0.65}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--text-secondary)">디딤발 (앞발)</text>
      ` : ''}
      <!-- 우수 기준선 (디딤발 ≥2.0 BW) -->
      <line x1="${P}" y1="${yScale(2.0)}" x2="${W-P}" y2="${yScale(2.0)}" stroke="#16a34a" stroke-dasharray="3,3" opacity="0.6"/>
      <text x="${W-P-2}" y="${yScale(2.0)-3}" text-anchor="end" font-size="9" fill="#16a34a">프로 우수 ≥2.0 BW</text>
      <!-- Y축 단위 -->
      <text x="${P-4}" y="${yScale(0)+3}" text-anchor="end" font-size="9" fill="var(--text-muted)">0</text>
      <text x="${P-4}" y="${yScale(maxV/2)+3}" text-anchor="end" font-size="9" fill="var(--text-muted)">${(maxV/2).toFixed(1)}</text>
      <text x="${P-4}" y="${yScale(maxV)+3}" text-anchor="end" font-size="9" fill="var(--text-muted)">${maxV.toFixed(1)} BW</text>
    </svg>`;

    const fmt = (v, d=2, u='') => v != null ? `${v.toFixed(d)}${u}` : '—';
    const scoreColor = (sc) => sc == null ? '#94a3b8' : sc >= 75 ? '#16a34a' : sc >= 50 ? '#fb923c' : '#dc2626';

    // ★ v0.55 — Impulse 막대 차트: AP impulse(축발 전진 vs 디딤발 브레이킹)로 변경
    //   기존 vGRF impulse(수직 방향) → AP impulse(앞뒤 방향)로 바꿔 차고 나가기·브레이킹 직관적 비교
    const maxImpAP = Math.max(0.05, driveAP || 0.025, brakeAP || 0.01) * 1.2;
    const yScaleI = (v) => H - P - (v / maxImpAP) * (H - 2 * P);
    const impBar = (driveAP != null || brakeAP != null) ? `<svg viewBox="0 0 ${W} ${H}" style="width: 100%; max-width: 380px; height: auto;">
      <line x1="${P}" y1="${H-P}" x2="${W-P}" y2="${H-P}" stroke="var(--text-muted)"/>
      <line x1="${P}" y1="${P}" x2="${P}" y2="${H-P}" stroke="var(--text-muted)"/>
      ${driveAP != null ? `
        <rect x="${W*0.25 - barW/2}" y="${yScaleI(driveAP)}" width="${barW}" height="${(H-P) - yScaleI(driveAP)}" fill="#0070C0" opacity="0.7"/>
        <text x="${W*0.25}" y="${yScaleI(driveAP) - 6}" text-anchor="middle" font-size="13" font-weight="bold" fill="#0070C0">${driveAP.toFixed(4)}</text>
        <text x="${W*0.25}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--text-secondary)">축발 전진 충격량</text>
      ` : ''}
      ${brakeAP != null ? `
        <rect x="${W*0.65 - barW/2}" y="${yScaleI(brakeAP)}" width="${barW}" height="${(H-P) - yScaleI(brakeAP)}" fill="#C00000" opacity="0.7"/>
        <text x="${W*0.65}" y="${yScaleI(brakeAP) - 6}" text-anchor="middle" font-size="13" font-weight="bold" fill="#C00000">${brakeAP.toFixed(4)}</text>
        <text x="${W*0.65}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--text-secondary)">디딤발 브레이킹 충격량</text>
      ` : ''}
      <text x="${P-4}" y="${yScaleI(0)+3}" text-anchor="end" font-size="9" fill="var(--text-muted)">0</text>
      <text x="${P-4}" y="${yScaleI(maxImpAP/2)+3}" text-anchor="end" font-size="9" fill="var(--text-muted)">${(maxImpAP/2).toFixed(3)}</text>
      <text x="${P-4}" y="${yScaleI(maxImpAP)+3}" text-anchor="end" font-size="9" fill="var(--text-muted)">${maxImpAP.toFixed(3)} BW·s</text>
    </svg>` : '';

    // ★ v0.33 — 5-phase GRF 시퀀스 시각화
    const trail_color = '#0070C0', lead_color = '#C00000';
    const phaseChart = `<svg viewBox="0 0 600 130" style="width: 100%; max-width: 580px; height: auto;">
      <!-- 축 -->
      <line x1="40" y1="100" x2="580" y2="100" stroke="var(--text-muted)" stroke-width="1"/>
      <!-- Trail curve (예시 곡선) -->
      <path d="M 40,80 Q 120,80 160,75 Q 200,55 220,40 Q 250,30 270,55 Q 290,80 320,95 L 580,100"
            stroke="${trail_color}" stroke-width="2.5" fill="none" opacity="0.85"/>
      <!-- Lead curve (FC 후 spike) -->
      <path d="M 40,100 L 320,100 Q 350,98 380,55 Q 410,25 440,20 Q 470,30 510,55 L 580,80"
            stroke="${lead_color}" stroke-width="2.5" fill="none" opacity="0.85"/>
      <!-- Phase 라벨 -->
      <text x="80" y="118" text-anchor="middle" font-size="10" fill="var(--text-secondary)">①셋업</text>
      <text x="220" y="118" text-anchor="middle" font-size="10" fill="var(--text-secondary)">②차고 나가기</text>
      <text x="320" y="118" text-anchor="middle" font-size="10" fill="var(--text-secondary)">③전환</text>
      <text x="440" y="118" text-anchor="middle" font-size="10" fill="var(--text-secondary)">④받쳐주기</text>
      <text x="540" y="118" text-anchor="middle" font-size="10" fill="var(--text-secondary)">⑤릴리스</text>
      <!-- Event 마커 -->
      <line x1="220" y1="20" x2="220" y2="100" stroke="#94a3b8" stroke-dasharray="2,3" opacity="0.6"/>
      <text x="220" y="14" text-anchor="middle" font-size="9" fill="var(--text-muted)">무릎 들기</text>
      <line x1="320" y1="20" x2="320" y2="100" stroke="#94a3b8" stroke-dasharray="2,3" opacity="0.6"/>
      <text x="320" y="14" text-anchor="middle" font-size="9" fill="var(--text-muted)">앞발 착지</text>
      <line x1="510" y1="20" x2="510" y2="100" stroke="#94a3b8" stroke-dasharray="2,3" opacity="0.6"/>
      <text x="510" y="14" text-anchor="middle" font-size="9" fill="var(--text-muted)">릴리스</text>
      <!-- 범례 -->
      <line x1="50" y1="40" x2="80" y2="40" stroke="${trail_color}" stroke-width="2.5"/>
      <text x="85" y="44" font-size="11" fill="${trail_color}" font-weight="600">축발 (뒷발)</text>
      <line x1="50" y1="55" x2="80" y2="55" stroke="${lead_color}" stroke-width="2.5"/>
      <text x="85" y="59" font-size="11" fill="${lead_color}" font-weight="600">디딤발 (앞발)</text>
      <text x="40" y="100" font-size="9" fill="var(--text-muted)" text-anchor="end">0</text>
      <text x="40" y="35" font-size="9" fill="var(--text-muted)" text-anchor="end">F</text>
    </svg>`;

    return `
    <div class="cat-card mb-6" style="padding: 18px; border-left: 4px solid var(--accent-soft);">
      <div class="display text-xl mb-2" style="color: var(--accent-soft);">🦵 지면반력 — 투구의 시작은 발 끝에서</div>

      <!-- ① 메카닉 의미 narrative -->
      <div class="p-3 mb-4" style="background: rgba(34,211,238,0.06); border-left: 3px solid #22d3ee; border-radius: 4px;">
        <div class="text-sm" style="color: var(--text-secondary); line-height: 1.7;">
          공을 빠르게 던지는 힘은 결국 <strong>발이 마운드를 미는 힘</strong>에서 시작됩니다.
          이 힘이 <strong>골반 → 몸통 → 팔</strong>로 차례차례 전달되어야 좋은 공이 나옵니다.
          이 섹션은 (a) <strong style="color: ${trail_color};">축발(뒷발)이 만드는 차고 나가는 힘</strong>과
          (b) <strong style="color: ${lead_color};">디딤발(앞발)이 만드는 회전축</strong>을 직접 측정한 결과입니다.
        </div>
      </div>

      <!-- ② 5-phase GRF 시퀀스 -->
      <div class="mb-4">
        <div class="text-sm mb-2" style="color: var(--text-primary); font-weight: 600;">📈 투구 5단계 — 발이 마운드를 미는 흐름</div>
        ${phaseChart}
        <div class="grid mt-2" style="grid-template-columns: repeat(5, 1fr); gap: 6px;">
          <div class="text-[10px] p-2" style="background: var(--bg-elevated); border-radius: 4px; line-height: 1.4;">
            <strong>① 셋업</strong><br><span style="color: var(--text-muted);">두 발에 체중 안정</span>
          </div>
          <div class="text-[10px] p-2" style="background: rgba(0,112,192,0.08); border-radius: 4px; line-height: 1.4;">
            <strong style="color: ${trail_color};">② 차고 나가기</strong><br><span style="color: var(--text-muted);">축발로 밀어 몸 전진</span>
          </div>
          <div class="text-[10px] p-2" style="background: var(--bg-elevated); border-radius: 4px; line-height: 1.4;">
            <strong>③ 무게 이동</strong><br><span style="color: var(--text-muted);">축발→디딤발 전환</span>
          </div>
          <div class="text-[10px] p-2" style="background: rgba(192,0,0,0.08); border-radius: 4px; line-height: 1.4;">
            <strong style="color: ${lead_color};">④ 받쳐주기</strong><br><span style="color: var(--text-muted);">디딤발로 회전축 형성</span>
          </div>
          <div class="text-[10px] p-2" style="background: var(--bg-elevated); border-radius: 4px; line-height: 1.4;">
            <strong>⑤ 릴리스</strong><br><span style="color: var(--text-muted);">팔로우스루</span>
          </div>
        </div>
      </div>

      <!-- ③ Peak + Impulse 측정값 + 차트 -->
      <div class="text-sm mb-2" style="color: var(--text-primary); font-weight: 600;">📊 측정값 — 최대 힘 vs 충격량</div>
      <div class="text-xs mb-3" style="color: var(--text-muted); line-height: 1.5;">
        <strong>최대 힘 (Peak, BW)</strong>: 순간 가장 세게 누른 힘 — 강하지만 짧으면 효과 제한적.
        <strong>충격량 (Impulse, BW·s)</strong>: 힘 × 시간 — <strong>실제로 몸을 움직이는 데 쓴 힘</strong>. NewtForce도 충격량을 더 중요하게 봅니다.
      </div>
      <div class="grid md:grid-cols-2 gap-4 items-start">
        <div>
          <div class="text-xs mb-1" style="color: var(--text-muted); font-weight: 600;">최대 수직 힘 (BW)</div>
          ${grfBar}
          ${impBar ? `<div class="text-xs mt-3 mb-1" style="color: var(--text-muted); font-weight: 600;">앞뒤(AP) 충격량 (BW·s)</div>` + impBar : ''}
        </div>
        <div>
          <table class="var-table" style="font-size: 12px;">
            <thead><tr><th>변수</th><th>값</th><th>점수</th></tr></thead>
            <tbody>
              <tr style="border-bottom: 2px solid var(--border);"><td colspan="3" style="padding-top: 4px; font-weight: 600; color: #0070C0;">축발(뒷발) — 무릎 들기 → 앞발 착지</td></tr>
              <tr><td>축발 최대 수직힘</td><td class="mono">${fmt(trailV, 2, ' BW')}</td><td><strong style="color: ${scoreColor(trailVS)};">${trailVS != null ? trailVS : '—'}</strong></td></tr>
              <tr><td>축발 최대 전진힘</td><td class="mono">${fmt(trailAP, 2, ' BW')}</td><td><strong style="color: ${scoreColor(trailAPS)};">${trailAPS != null ? trailAPS : '—'}</strong></td></tr>
              <tr><td>★ 축발 수직 충격량</td><td class="mono">${fmt(trailVZi, 3, ' BW·s')}</td><td><strong style="color: ${scoreColor(trailVZiS)};">${trailVZiS != null ? trailVZiS : '—'}</strong></td></tr>
              <tr><td>★ 축발 전진 충격량 (차고 나가기)</td><td class="mono">${fmt(driveAP, 4, ' BW·s')}</td><td><strong style="color: ${scoreColor(driveAPS)};">${driveAPS != null ? driveAPS : '—'}</strong></td></tr>
              <tr><td>축발 전체 충격량</td><td class="mono">${fmt(trailImpulse, 3, ' BW·s')}</td><td>—</td></tr>
              <tr style="border-bottom: 2px solid var(--border);"><td colspan="3" style="padding-top: 8px; font-weight: 600; color: #C00000;">디딤발(앞발) — 앞발 착지 → 릴리스</td></tr>
              <tr><td>디딤발 최대 수직힘</td><td class="mono">${fmt(leadV, 2, ' BW')}</td><td><strong style="color: ${scoreColor(leadVS)};">${leadVS != null ? leadVS : '—'}</strong></td></tr>
              <tr><td>디딤발 최대 브레이킹힘</td><td class="mono">${fmt(leadAP, 2, ' BW')}</td><td><strong style="color: ${scoreColor(leadAPS)};">${leadAPS != null ? leadAPS : '—'}</strong></td></tr>
              <tr><td>★ 디딤발 수직 충격량</td><td class="mono">${fmt(leadVZi, 3, ' BW·s')}</td><td><strong style="color: ${scoreColor(leadVZiS)};">${leadVZiS != null ? leadVZiS : '—'}</strong></td></tr>
              <tr><td>★ 디딤발 브레이킹 충격량</td><td class="mono">${fmt(brakeAP, 4, ' BW·s')}</td><td><strong style="color: ${scoreColor(brakeAPS)};">${brakeAPS != null ? brakeAPS : '—'}</strong></td></tr>
              <tr style="border-bottom: 1px solid var(--border);"><td colspan="3" style="padding-top: 8px; font-weight: 600; color: var(--text-muted);">축발→디딤발 전환</td></tr>
              <tr><td>두 발 사이 힘 전환 시간</td><td class="mono">${fmt(transition, 3, ' s')}</td><td><strong style="color: ${scoreColor(transitionS)};">${transitionS != null ? transitionS : '—'}</strong></td></tr>
            </tbody>
          </table>
          <div class="text-xs mt-2" style="color: var(--text-muted); line-height: 1.5;">
            KBO 프로(이영하) 평균: 축발 전진 ~0.020, 디딤발 브레이킹 ~0.001 BW·s
          </div>
        </div>
      </div>

      <!-- ④ 연구 기반 메카닉 해석 -->
      <div class="mt-5 p-4" style="background: linear-gradient(135deg, rgba(0,112,192,0.04), rgba(192,0,0,0.04)); border-radius: 6px; border: 1px solid var(--border);">
        <div class="text-sm mb-3" style="color: var(--text-primary); font-weight: 600;">🔬 연구로 보는 두 발의 역할</div>
        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <div class="text-xs mb-2" style="color: ${trail_color}; font-weight: 700;">🟦 축발 (뒷발) — 차고 나가는 엔진</div>
            <div class="text-xs" style="color: var(--text-secondary); line-height: 1.7;">
              <strong>역할</strong>: 무게중심을 포수 방향으로 밀어주고 회전 준비.
              무릎 들기에서 한 발에 체중 집중 → 차고 나갈 때 수직 힘이 1.0~1.5 BW까지 올라갑니다.<br><br>
              <strong>Slowik 2019</strong>: 축발 전진 충격량이 클수록 구속 ↑ (r=0.41~0.55)<br>
              <strong>McNally 2015</strong>: 축발/디딤발 힘의 균형이 프로 vs 아마추어를 가르는 핵심
            </div>
          </div>
          <div>
            <div class="text-xs mb-2" style="color: ${lead_color}; font-weight: 700;">🟥 디딤발 (앞발) — 회전축 + 몸 받쳐주기</div>
            <div class="text-xs" style="color: var(--text-secondary); line-height: 1.7;">
              <strong>역할</strong>: 앞발 착지 순간 강하게 받쳐주어 앞으로 가던 몸을 회전으로 바꿉니다.
              디딤발이 강할수록 몸통과 팔이 더 빠르게 회전합니다.<br><br>
              <strong>Kageyama 2014</strong>: 디딤발 수직힘이 클수록 구속 ↑ (r=0.55~0.70)<br>
              <strong>Howenstein 2019</strong>: 디딤발 수직힘 강도 = 몸통 회전속도와 직결<br>
              <strong>MLB 프로 우수 투수</strong>: 디딤발 최대 수직힘 ≥ 2.0 BW
            </div>
          </div>
        </div>
        <div class="mt-3 pt-3 text-xs" style="border-top: 1px dashed var(--border); color: var(--text-secondary); line-height: 1.7;">
          <strong>⚠ 부상 위험 연결</strong>: 디딤발이 약하면 → 팔이 더 일하게 됨 → 팔꿈치·어깨 부담 증가.
          디딤발 1.8~2.5 BW가 팔꿈치 부담 감소와 연관 (MacWilliams 1998).
          따라서 <strong>지면반력 분석은 구속 향상뿐 아니라 팔 부상 예방의 출발점</strong>입니다.
        </div>
      </div>

      <!-- ⑤ NewtForce 시그니처 변수 + LHEI -->
      ${(() => {
        const tPkT = m['time_to_peak_trail_force']?.value;
        const tPkTS = m['time_to_peak_trail_force']?.score;
        const tPkL = m['time_to_peak_lead_force']?.value;
        const tPkLS = m['time_to_peak_lead_force']?.score;
        const fBR = m['force_at_ball_release']?.value;
        const fBRS = m['force_at_ball_release']?.score;
        const xInst = m['x_force_instability']?.value;
        const xInstS = m['x_force_instability']?.score;
        const cb = m['clawback_time']?.value;
        const cbS = m['clawback_time']?.score;
        const brakeEff = m['lead_braking_efficiency']?.value;
        const brakeEffS = m['lead_braking_efficiency']?.score;

        // LHEI 종합 — NewtForce §13 가중 평균
        const lhei_components = [
          { name: 'Y Back (drive AP)', score: m['drive_leg_propulsive_impulse']?.score, w: 1, sign: 1 },
          { name: 'Accel Impulse (trail vGRF)', score: m['trail_vGRF_impulse']?.score, w: 1, sign: 1 },
          { name: 'Front-leg Braking', score: m['lead_leg_braking_impulse']?.score, w: 1, sign: 1 },
          { name: 'Lead vGRF', score: m['lead_vGRF_impulse']?.score, w: 1, sign: 1 },
          { name: 'Transfer Time', score: m['trail_to_lead_vgrf_peak_s']?.score, w: 0.5, sign: 1 },
          { name: 'Force at Release', score: fBRS, w: 1, sign: 1 },
          { name: 'X Instability (역)', score: xInstS, w: 0.5, sign: 1 },
          { name: 'Clawback (역)', score: cbS, w: 0.5, sign: 1 },
        ].filter(c => c.score != null);

        let lhei = null;
        if (lhei_components.length >= 4) {
          const totalW = lhei_components.reduce((s, c) => s + c.w, 0);
          lhei = lhei_components.reduce((s, c) => s + c.score * c.w, 0) / totalW;
        }
        const lheiC = lhei == null ? '#94a3b8' : lhei >= 75 ? '#16a34a' : lhei >= 60 ? '#22d3ee' : lhei >= 45 ? '#fb923c' : '#dc2626';
        const lheiLabel = lhei == null ? '미평가' : lhei >= 75 ? '우수' : lhei >= 60 ? '양호' : lhei >= 45 ? '보통' : '개선 필요';

        // 진단 패턴 자동 감지 (NewtForce §6, §10)
        const diagnoses = [];
        const yBackS = m['drive_leg_propulsive_impulse']?.score;
        const playerVeloS = m['Max_CoG_Velo']?.score;
        const accelImpS = m['trail_vGRF_impulse']?.score;
        const frontBrakeS = m['lead_leg_braking_impulse']?.score;

        if (yBackS != null && yBackS < 50 && (playerVeloS == null || playerVeloS < 50)) {
          diagnoses.push({ icon: '🟠', title: '뒤에 처지는 타입', narrative: '축발로 마운드를 충분히 누르지 못하고 몸이 뒤에 남아있음. <strong>훈련</strong>: 힙힌지, 라이드 드릴, 스텝백 드릴 — "뒤에서 버티며 앞으로 타고 나가는" 느낌', color: '#fb923c' });
        }
        if (yBackS != null && yBackS >= 60 && frontBrakeS != null && frontBrakeS < 50) {
          diagnoses.push({ icon: '🔴', title: '앞으로 쏟아지는 타입', narrative: '축발은 잘 미는데 디딤발이 못 받쳐줘서 몸이 앞으로 흘러감 (lunging). <strong>훈련</strong>: 디딤발 받쳐주기 드릴, 스트라이드 컨트롤, 앞무릎 안정화', color: '#dc2626' });
        }
        if (accelImpS != null && accelImpS < 50 && m['Trail_leg_peak_vertical_GRF']?.score >= 60) {
          diagnoses.push({ icon: '🟡', title: '잠깐만 세게 미는 타입', narrative: '순간 힘은 강한데 너무 빨리 끝나버림 (peak ↑ but impulse ↓). <strong>훈련</strong>: 힘을 오래 유지하는 템포·리듬 조절', color: '#fbbf24' });
        }
        if (accelImpS != null && accelImpS < 50 && fBRS != null && fBRS < 50) {
          diagnoses.push({ icon: '🔴', title: '팔로 던지는 타입 (팔 보상)', narrative: '하체 힘이 약한데 구속이 나오면 팔·상체로 보상하고 있을 가능성. <strong>훈련</strong>: 3D 동작 분석·팔꿈치/어깨 부하 측정 병행, 하체 강화', color: '#dc2626' });
        }
        if (xInstS != null && xInstS < 50) {
          diagnoses.push({ icon: '🟠', title: '좌우로 새는 타입', narrative: '발이 1루·3루 쪽으로 흔들림. <strong>훈련</strong>: 발 방향 정렬, 골반 경로 직진, 몸통 기울기 점검', color: '#fb923c' });
        }
        if (diagnoses.length === 0 && lhei != null && lhei >= 70) {
          diagnoses.push({ icon: '🟢', title: '하체 메카닉 우수', narrative: '축발·디딤발·전환·받쳐주기·안정성 모두 적정. 현재 패턴 유지하면서 세부 미세조정만 권장', color: '#16a34a' });
        }

        const fmt2 = (v, d=3, u='') => v == null ? '—' : `${v.toFixed(d)}${u}`;
        const sc2 = (s) => s == null ? '#94a3b8' : s >= 75 ? '#16a34a' : s >= 50 ? '#22d3ee' : s >= 30 ? '#fb923c' : '#dc2626';

        return `
        <!-- ⑥ NewtForce 시그니처 변수 -->
        <div class="mt-5 p-4" style="background: linear-gradient(135deg, rgba(34,211,238,0.04), rgba(99,102,241,0.04)); border-radius: 6px; border: 1px solid rgba(34,211,238,0.3);">
          <div class="flex items-baseline justify-between mb-3 flex-wrap" style="gap: 8px;">
            <div class="text-sm" style="color: #22d3ee; font-weight: 700;">⚙ 하체 효율 핵심 지표 (NewtForce 기준)</div>
            <div class="text-xs" style="color: var(--text-muted);">차고 나가기·전환·받쳐주기·안정성 종합 평가</div>
          </div>
          <table class="var-table" style="font-size: 12px; width: 100%;">
            <thead><tr><th>지표</th><th>값</th><th>의미</th><th>점수</th></tr></thead>
            <tbody>
              <tr><td>축발 최대 힘 도달 시간</td><td class="mono">${fmt2(tPkT, 3, ' s')}</td><td class="text-xs" style="color: var(--text-muted);">무릎 들기→축발 최대 힘 (0.6초 적정)</td><td><strong style="color: ${sc2(tPkTS)};">${tPkTS ?? '—'}</strong></td></tr>
              <tr><td>디딤발 최대 힘 도달 시간</td><td class="mono">${fmt2(tPkL, 3, ' s')}</td><td class="text-xs" style="color: var(--text-muted);">앞발 착지→디딤발 최대 힘 (0.14초 적정)</td><td><strong style="color: ${sc2(tPkLS)};">${tPkLS ?? '—'}</strong></td></tr>
              <tr><td>★ 릴리스 순간 디딤발 힘</td><td class="mono">${fmt2(fBR, 2, ' BW')}</td><td class="text-xs" style="color: var(--text-muted);">릴리스 때 디딤발 받쳐주기 (1.0+ BW = 회전축 유지)</td><td><strong style="color: ${sc2(fBRS)};">${fBRS ?? '—'}</strong></td></tr>
              <tr><td>좌우 흔들림</td><td class="mono">${fmt2(xInst, 4, ' BW')}</td><td class="text-xs" style="color: var(--text-muted);">1루·3루 쪽으로 새는 정도 (작을수록 안정)</td><td><strong style="color: ${sc2(xInstS)};">${xInstS ?? '—'}</strong></td></tr>
              <tr><td>착지 후 균형 회복 시간</td><td class="mono">${fmt2(cb, 3, ' s')}</td><td class="text-xs" style="color: var(--text-muted);">릴리스 후 몸 안정까지 (짧을수록 좋음)</td><td><strong style="color: ${sc2(cbS)};">${cbS ?? '—'}</strong></td></tr>
              <tr><td>디딤발 받쳐주기 효율</td><td class="mono">${fmt2(brakeEff, 3, '')}</td><td class="text-xs" style="color: var(--text-muted);">브레이킹 / 차고 나가기 비율</td><td><strong style="color: ${sc2(brakeEffS)};">${brakeEffS ?? '—'}</strong></td></tr>
            </tbody>
          </table>

          <!-- LHEI 종합 점수 -->
          <div class="mt-4 p-4" style="background: rgba(15,23,42,0.5); border-radius: 6px; border-left: 4px solid ${lheiC};">
            <div class="flex items-center justify-between flex-wrap" style="gap: 12px;">
              <div>
                <div class="text-xs" style="color: var(--text-muted); letter-spacing: 0.05em;">하체 종합 효율 점수 (LHEI)</div>
                <div class="display flex items-baseline" style="gap: 8px; margin-top: 4px;">
                  <span style="font-size: 42px; color: ${lheiC}; font-weight: 700; line-height: 1;">${lhei == null ? '—' : Math.round(lhei)}</span>
                  <span class="text-sm" style="color: var(--text-muted);">/100</span>
                  <span class="text-sm ml-2" style="color: ${lheiC}; font-weight: 600;">${lheiLabel}</span>
                </div>
              </div>
              <div class="text-xs" style="color: var(--text-muted); max-width: 360px; line-height: 1.5;">
                차고 나가기 · 무게 이동 · 받쳐주기 · 전달 · 안정성을 합쳐 평가한 점수.
                <strong>${lhei_components.length}개 지표</strong>의 가중 평균.
              </div>
            </div>
          </div>

          <!-- 투수 유형 자동 진단 -->
          ${diagnoses.length > 0 ? `
          <div class="mt-4">
            <div class="text-xs mb-2" style="color: var(--text-primary); font-weight: 600;">🩺 투수 유형 자동 진단</div>
            ${diagnoses.map(d => `
              <div class="p-3 mb-2" style="background: rgba(15,23,42,0.4); border-radius: 6px; border-left: 3px solid ${d.color};">
                <div class="text-xs mb-1" style="color: ${d.color}; font-weight: 700;">${d.icon} ${d.title}</div>
                <div class="text-xs" style="color: var(--text-secondary); line-height: 1.6;">${d.narrative}</div>
              </div>
            `).join('')}
          </div>` : ''}

          <!-- 4-phase 해석 -->
          <details class="mt-3">
            <summary class="cursor-pointer text-xs" style="color: var(--accent-soft);">📊 투구 단계별 체크포인트</summary>
            <div class="mt-2 text-xs p-3" style="background: var(--bg-elevated); border-radius: 6px; line-height: 1.7; color: var(--text-secondary);">
              <strong>① 무릎 들기 ~ 로딩</strong>: 축발 안정적으로 체중 받기, 힙힌지, 좌우 흔들림 없음<br>
              <strong>② 스트라이드 ~ 라이드</strong>: 축발 차고 나가기 충분, 몸 전진 속도 적정 (뒤에 처지지도, 앞으로 쏟아지지도 X)<br>
              <strong>③ 앞발 착지</strong>: 디딤발 빠르게 받쳐주기, 수직힘 유지, 두 발 전환 부드러움<br>
              <strong>④ 어깨 외회전 ~ 릴리스</strong>: 디딤발 끝까지 버텨주기, 균형 회복 빠름, 앞무릎 무너짐 없음
            </div>
          </details>
        </div>

        <!-- ⑦ 선수 피드백 카드 (NewtForce §11) -->
        ${diagnoses.length > 0 ? `
        <div class="mt-4 p-4" style="background: rgba(251,191,36,0.05); border-radius: 6px; border: 1px solid rgba(251,191,36,0.2);">
          <div class="text-xs mb-2" style="color: #fbbf24; font-weight: 700;">💬 코칭 큐 — 선수에게 전달할 표현</div>
          <table class="var-table" style="font-size: 11px; width: 100%;">
            <thead><tr><th>측정 결과</th><th>선수에게 말할 때</th><th>훈련 방향</th></tr></thead>
            <tbody>
              ${yBackS != null && yBackS < 50 ? '<tr><td>축발이 마운드를 덜 누름</td><td>"축발로 마운드를 오래 잡고 가자"</td><td>뒤에서 버티며 앞으로 타고 나가기</td></tr>' : ''}
              ${accelImpS != null && accelImpS < 50 ? '<tr><td>축발 충격량 부족</td><td>"잠깐 미는 게 아니라 끝까지 밀어"</td><td>힘을 오래 유지하는 템포·리듬</td></tr>' : ''}
              ${playerVeloS != null && playerVeloS < 50 ? '<tr><td>몸 전진 속도 부족</td><td>"뒤에서 멈추지 말고 포수 쪽으로 타고 나가"</td><td>라이드 드릴, 몸 전진 감각</td></tr>' : ''}
              ${frontBrakeS != null && frontBrakeS < 50 ? '<tr><td>디딤발 받쳐주기 약함</td><td>"앞발로 단단히 받쳐줘"</td><td>착지하면 앞발로 몸 받아내기 드릴</td></tr>' : ''}
              ${xInstS != null && xInstS < 50 ? '<tr><td>좌우 흔들림 큼</td><td>"몸이 1루(3루) 쪽으로 새고 있어"</td><td>발 방향·골반 경로·몸통 기울기 정렬</td></tr>' : ''}
              ${cbS != null && cbS < 50 ? '<tr><td>착지 후 안정 늦음</td><td>"착지하고도 몸이 계속 앞으로 흘러가"</td><td>브레이싱 후 회전 안정 드릴</td></tr>' : ''}
            </tbody>
          </table>
        </div>` : ''}
        `;
      })()}

      <!-- ⑧ 산식 reference 펼침 -->
      <details class="mt-3">
        <summary class="cursor-pointer text-xs" style="color: var(--accent-soft);">📚 산식과 참고자료</summary>
        <div class="mt-2 text-xs p-3" style="background: var(--bg-elevated); border-radius: 6px; line-height: 1.7; color: var(--text-secondary);">
          <strong>핵심 산식</strong>:<br>
          • 충격량 (Impulse) = ∫F(t) dt — 힘의 크기 × 시간 (최대 힘보다 더 의미 있는 추진/받쳐주기 지표)<br>
          • 체중 정규화 = 힘 / 체중 — 선수끼리 비교 가능하게<br>
          • 받쳐주기 효율 = 디딤발 브레이킹 충격량 / 축발 전진 충격량<br>
          • 하체 종합 점수 (LHEI) = 8개 지표 가중 평균 (NewtForce §13)<br><br>
          <strong>참고자료</strong>:<br>
          [1] NewtForce. <em>피칭 마운드 지면반력 분석 시스템</em>. newtforce.com<br>
          [2] NewtForce. <em>지면반력과 구속의 관계</em><br>
          [3] Slowik 등 (2019) — 축발 전진 충격량이 구속에 미치는 영향<br>
          [4] Kageyama 등 (2014) — 디딤발 지면반력과 구속 상관관계<br>
          [5] Howenstein 등 (2019) — 디딤발 받쳐주기 패턴 분석<br>
          [6] MacWilliams 등 (1998) — 투구 동작 포스플레이트 분석<br>
          [7] Florida Baseball ARMory — <em>투수의 힙힌지 분석</em><br>
          [8] Florida Baseball ARMory — <em>클로백 — 구속·제구·팔 건강의 숨은 키</em><br>
          [9] Frontiers Sports (2025) — 스트라이드 길이와 하체 에너지 흐름
        </div>
      </details>
    </div>`;
  }

  // ── 7. Kinetics 섹션 (Joint Power, Energy, Torque) ──
  // ════════════════════════════════════════════════════════════
  // 추가 컴포넌트 — 3-col radar / 마네킹 / 종형곡선 / 결함 drill / 훈련 추천
  // ════════════════════════════════════════════════════════════

  function _render3ColumnRadars(result) {
    const cats = result.catScores || {};

    // 체력 (fitness 데이터 있으면 표시 — 4 dim) — ★ v0.59 mode-aware 임계값
    const fitness = _getFit() || {};
    const _fT = _fitThresholds();
    const _isPro = (window.TheiaApp && window.TheiaApp.getMode && window.TheiaApp.getMode() === 'pro');
    const fitDims = [
      { label: '체중당 근력', val: _fitnessScore(fitness.imtp_peak_force_bm, _fT.imtp_bm[0], _fT.imtp_bm[1]), raw: fitness.imtp_peak_force_bm, unit: 'N/kg', desc: '체중 정규화 최대 근력',
        formula: 'IMTP Peak Force / Body Mass (N/kg)', threshold_text: _isPro ? 'VALD MLB 50th 36.3 N/kg · 75th 41.1 · 99th 53.7' : 'Elite ≥35 N/kg · 평균 25 · <20 부족',
        mlb_avg: _isPro ? '36.3 N/kg (VALD Baseball 2024 50th)' : '34 N/kg (Driveline)', coaching: '체중당 근력 부족 시 GRF 생성 능력 제한 — vGRF·trail drive 약화로 직결.', drill: 'Trap Bar Deadlift 3×5, Back Squat 4×5, IMTP holds 3×5s' },
      { label: '체중당 파워', val: _fitnessScore(fitness.cmj_peak_power_bm, _fT.cmj_pwr_bm[0], _fT.cmj_pwr_bm[1]), raw: fitness.cmj_peak_power_bm, unit: 'W/kg', desc: '체중 정규화 폭발력',
        formula: 'CMJ Peak Power / Body Mass (W/kg)', threshold_text: _isPro ? 'VALD MLB 50th 60 W/kg · 75th 65 · 99th 78' : 'Elite ≥70 W/kg · 평균 55 · <40 부족',
        mlb_avg: _isPro ? '60 W/kg (VALD Baseball 2024 50th)' : '68 W/kg (Driveline)', coaching: '체중당 파워는 vGRF rate of force development와 직결 — 키네틱 체인 출력 baseline.', drill: 'Box Jump 3×5, Depth Jump 3×5, Olympic Lift Variations' },
      { label: '반응성 (SSC)', val: _fitnessScore(fitness.cmj_rsi_modified, _fT.cmj_rsi[0], _fT.cmj_rsi[1]), raw: fitness.cmj_rsi_modified, unit: 'm/s', desc: '신장단축주기 효율',
        formula: 'CMJ RSI-modified = Jump Height / Contact Time', threshold_text: _isPro ? 'VALD MLB 50th 0.65 m/s · 75th 0.74 · 99th 0.97' : 'Elite ≥1.0 m/s · 평균 0.7 · <0.5 부족',
        mlb_avg: _isPro ? '0.65 m/s (VALD Baseball 2024 50th)' : '0.95 m/s (Driveline)', coaching: 'Stretch-shortening cycle 효율 — block leg ecc→con 전환의 직접 지표.', drill: 'Drop Jump 3×5, Pogo Jump 3×10, Bounding 3×20m' },
      { label: '체격 (BMI)', val: fitness.bmi != null ? _bmiScore(fitness.bmi) : null, raw: fitness.bmi, unit: '', desc: '신체 구성 (BMI 기반)',
        formula: 'BMI = Mass(kg) / Height(m)²', threshold_text: _isPro ? 'MLB Pro target 26.5 (25~28 안정) — 라인레버리지+근육량' : 'Optimal 22~25 (피칭 elite) · <19 또는 >28 = 발전 권장',
        mlb_avg: _isPro ? '26.5 (MLB pro avg)' : '23 (MLB Combine)', coaching: 'BMI 적정 범위는 라인레버리지·체질량 조합. 너무 낮으면 출력 부족, 너무 높으면 가동 제한.', drill: '단백질 1.6~2.0 g/kg, Compound 리프트, 수면 8h+' },
    ];
    const fitMeasured = fitDims.filter(d => d.val != null).length;
    const fitAvg = fitMeasured > 0 ? Math.round(fitDims.filter(d => d.val != null).reduce((s,d) => s+d.val, 0) / fitMeasured) : null;

    // 메카닉 6각 — 키네틱 체인 6단계
    const mechDims = _compute6axisMech(result);
    const mechMeasured = mechDims.filter(d => d.val != null).length;
    const mechAvg = mechMeasured > 0 ? Math.round(mechDims.filter(d => d.val != null).reduce((s,d) => s+d.val, 0) / mechMeasured) : null;

    // 제구 6각 — P1~P6
    const ctrlDims = _compute6axisCtrl(result);
    const ctrlMeasured = ctrlDims.filter(d => d.val != null).length;
    const ctrlScore = cats.CONTROL?.score;

    const colorScore = (s) => s == null ? '#94a3b8' : s >= 75 ? '#16a34a' : s >= 50 ? '#fb923c' : '#dc2626';

    const TM = window.TheiaMeta;
    const renderColumn = (title, color, score, dims, measured, total, canvasId, gradeText) => {
      const detailRows = dims.map(d => {
        const c = colorScore(d.val);
        const sc = d.val == null ? '—' : d.val + '점';
        const grade = d.val == null ? '미측정' : d.val >= 80 ? '최상위' : d.val >= 70 ? '우수' : d.val >= 50 ? '상위 평균' : '평균 수준 — 발전 여지 큼';
        // 항목별 detail (산식·임계·MLB 평균·코칭·drill)
        // 우선순위: (1) d.varKey → VAR_DETAILS lookup, (2) d 객체 내 인라인 detail (체력 fitDims), (3) d.refVars 첫 번째 매핑
        const detail = (d.varKey && TM?.VAR_DETAILS) ? TM.VAR_DETAILS[d.varKey] : null;
        const inlineDetail = !detail && d.formula ? { formula: d.formula, threshold: d.threshold_text, mlb_avg: d.mlb_avg, coaching: d.coaching, drill: d.drill } : null;
        const refDetail = !detail && !inlineDetail && d.refVars && d.refVars.length && TM?.VAR_DETAILS ? TM.VAR_DETAILS[d.refVars[0]] : null;
        const D = detail || inlineDetail || refDetail;
        const detailHtml = D ? `
          <div class="text-[11px] mt-2 pt-2" style="color: var(--text-secondary); border-top: 1px dashed var(--border); line-height: 1.6;">
            ${D.formula ? `<div><strong style="color: ${color};">📐 산식:</strong> <code class="mono text-[10px]">${D.formula}</code></div>` : ''}
            ${D.threshold ? `<div><strong style="color: ${color};">📊 임계:</strong> ${D.threshold}</div>` : ''}
            ${D.mlb_avg ? `<div><strong style="color: ${color};">🏟️ MLB 평균:</strong> ${D.mlb_avg}</div>` : ''}
            ${D.coaching ? `<div class="mt-1"><strong style="color: #fbbf24;">💡 코칭:</strong> ${D.coaching}</div>` : ''}
            ${D.drill ? `<div class="mt-1"><strong style="color: #16a34a;">💪 drill:</strong> ${D.drill}</div>` : ''}
            ${d.refVars && d.refVars.length > 1 ? `<div class="text-[9px] mt-1" style="color: var(--text-muted);">통합 변수: ${d.refVars.join(', ')}</div>` : ''}
          </div>` : '';
        return `<details style="background: var(--bg-elevated); padding: 10px 12px; border-radius: 6px; margin-bottom: 6px; border-left: 3px solid ${color};">
          <summary class="cursor-pointer" style="list-style: none;">
            <div class="flex justify-between items-baseline">
              <strong class="text-sm">▸ ${d.label}</strong>
              <span class="mono" style="color: ${c}; font-weight: 700;">${sc}</span>
            </div>
            <div class="flex justify-between items-baseline mt-1">
              <span class="text-xs" style="color: var(--text-muted);">${d.desc || ''}</span>
              <span class="text-xs" style="color: ${c}; font-weight: 600;">${grade}</span>
            </div>
          </summary>
          ${detailHtml}
        </details>`;
      }).join('');
      return `<div class="cat-card" style="padding: 16px; flex: 1; min-width: 280px;">
        <div class="flex justify-between items-baseline mb-1">
          <div>
            <div class="mono text-xs uppercase" style="color: var(--text-muted);">SECTION</div>
            <div class="display text-xl" style="color: ${color};">${title}</div>
          </div>
          <div class="text-right">
            <div class="mono text-xs" style="color: var(--text-muted);">MLB 평균 대비</div>
            <div class="display" style="font-size: 36px; color: ${colorScore(score)}; font-weight: 700;">${score != null ? score : '—'}<span class="text-sm" style="color: var(--text-muted);">/100</span></div>
          </div>
        </div>
        <div class="text-xs mb-2" style="color: var(--text-muted);">
          측정 변수: <span style="color: ${color}; font-weight: 600;">${measured}/${total}</span> · 신뢰도 ${measured/total >= 0.7 ? '<span style="color: #16a34a;">높음</span>' : measured/total >= 0.4 ? '<span style="color: #fb923c;">중간</span>' : '<span style="color: #dc2626;">낮음</span>'}
        </div>
        <div class="text-[10px] mb-3" style="color: var(--text-muted); font-style: italic;">
          ※ 100점 = MLB 평균 표준값. 80점+ = 한국 고1 elite. 50점 = 발전 평균.
        </div>
        <div style="height: 240px; position: relative;">
          <canvas id="${canvasId}"></canvas>
        </div>
        <div class="mt-3">${detailRows}</div>
      </div>`;
    };

    return `<div class="flex gap-3 flex-wrap mb-6">
      ${renderColumn('체력', 'var(--transfer)', fitAvg, fitDims, fitMeasured, fitDims.length, 'theia-radar-fit')}
      ${renderColumn('메카닉', 'var(--accent-soft)', mechAvg, mechDims, mechMeasured, mechDims.length, 'theia-radar-mech')}
      ${renderColumn('제구', 'var(--leak)', ctrlScore, ctrlDims, ctrlMeasured, ctrlDims.length, 'theia-radar-ctrl')}
    </div>`;
  }

  // 메카닉 6축 — 키네틱 체인 6단계
  function _compute6axisMech(result) {
    const m = result.varScores || {};
    const _avg = (keys) => {
      const vals = keys.map(k => m[k]?.score).filter(x => x != null);
      return vals.length ? Math.round(vals.reduce((a,b)=>a+b,0) / vals.length) : null;
    };
    const dims = [
      { label: '하체 추진', val: _avg(['Trail_leg_peak_vertical_GRF', 'Trail_leg_peak_AP_GRF', 'Trail_Hip_Power_peak', 'Pelvis_peak']),
        refVars: ['Trail_leg_peak_vertical_GRF', 'Trail_Hip_Power_peak', 'Pelvis_peak'],
        faultIds: ['WeakTrailDrive'],
        desc: '뒷다리로 강하게 밀어 추진력 만들기 (KH→FC)' },
      { label: '앞다리 버팀 (Block)', val: _avg(['Lead_leg_peak_vertical_GRF', 'CoG_Decel', 'Lead_Knee_Power_peak', 'br_lead_leg_knee_flexion', 'lead_knee_ext_change_fc_to_br']),
        refVars: ['Lead_leg_peak_vertical_GRF', 'lead_knee_ext_change_fc_to_br', 'br_lead_leg_knee_flexion'],
        faultIds: ['WeakLeadBlock', 'LeadKneeCollapse', 'PoorBlock'],
        desc: 'FC→BR 무릎 무너짐 여부 — 각도 유지가 핵심' },
      { label: '몸통 에너지 로딩', val: _avg(['fc_xfactor', 'peak_xfactor', 'peak_trunk_CounterRotation', 'trunk_rotation_at_fc']),
        refVars: ['fc_xfactor', 'peak_xfactor', 'trunk_rotation_at_fc'],
        faultIds: ['FlyingOpen'],
        desc: '꼬임·닫힘·기울기·FC 절대 회전으로 트렁크 에너지 저장' },
      { label: '몸통 에너지 발현', val: _avg(['Pelvis_peak', 'Trunk_peak', 'trunk_forward_flexion_vel_peak', 'pelvis_to_trunk', 'pelvis_trunk_speedup']),
        refVars: ['Trunk_peak', 'trunk_forward_flexion_vel_peak', 'Pelvis_peak', 'pelvis_to_trunk'],
        faultIds: ['LateTrunkRotation', 'PoorSpeedupChain', 'ExcessForwardTilt'],
        desc: '회전(Z) + 굴곡(X) 속도로 에너지 발현 (FC→MER→BR)' },
      { label: '팔 에너지', val: _avg(['Arm_peak', 'humerus_segment_peak', 'trunk_to_arm', 'arm_trunk_speedup', 'mer_shoulder_abd', 'max_shoulder_ER', 'Pitching_Shoulder_Power_peak']),
        refVars: ['Arm_peak', 'humerus_segment_peak', 'max_shoulder_ER', 'trunk_to_arm', 'Pitching_Shoulder_Power_peak'],
        faultIds: ['MERShoulderRisk'],
        desc: '레이백·전달율·lag·어깨 IR 속도(=Arm_peak)·humerus segment 통합' },
      { label: '릴리스', val: _avg(['wrist_release_speed', 'angular_chain_amplification', 'br_shoulder_abd', 'Pitching_Elbow_Power_peak']),
        refVars: ['angular_chain_amplification', 'Pitching_Elbow_Power_peak'],
        faultIds: ['HighElbowValgus', 'PoorReleaseConsistency'],
        desc: '손목 릴리스·전체 증폭·UCL stress' },
    ];

    // ★ v0.14 — 결함 검출 시 ELI 영역 점수에 패널티 적용 (모순 해결)
    //   high severity = -25점, medium = -12점, low = -5점
    //   상한선 적용: high 결함 있으면 max 60점, medium 있으면 max 75점
    const faults = result.faults || [];
    const sevPenalty = { high: 35, medium: 18, low: 8 };
    const sevCap     = { high: 50, medium: 65, low: 80 };
    return dims.map(d => {
      if (d.val == null) return d;
      const matchedFaults = faults.filter(f => d.faultIds && d.faultIds.includes(f.id));
      if (matchedFaults.length === 0) return d;
      // 가장 심각한 결함 기준
      const worstSev = matchedFaults.reduce((w, f) => {
        const order = { high: 3, medium: 2, low: 1 };
        return order[f.severity] > order[w] ? f.severity : w;
      }, 'low');
      const totalPenalty = matchedFaults.reduce((sum, f) => sum + (sevPenalty[f.severity] || 0), 0);
      const cap = sevCap[worstSev] || 100;
      const penalized = Math.min(cap, Math.max(0, d.val - totalPenalty));
      return {
        ...d,
        val: penalized,
        valOriginal: d.val,
        faultPenalty: d.val - penalized,
        faults: matchedFaults,
      };
    });
  }

  // 제구 6축 — P1~P6 (산출 안 되는 항목은 desc에 측정 필요 컬럼 안내)
  function _compute6axisCtrl(result) {
    const m = result.varScores || {};
    const need = (col) => `<span style="color: var(--bad, #dc2626);">⚠ 측정 필요:</span> <code class="mono text-[10px]">${col}</code>`;
    return [
      { label: '릴리스 점 일관성 (3D)', val: m.P1_wrist_3D_SD?.score, varKey: 'P1_wrist_3D_SD',
        desc: m.P1_wrist_3D_SD?.score != null ? '손목 X·Y·Z 결합 SD (cm)' : `손목 X·Y·Z 결합 SD — ${need('Pitching_Wrist_jc_Position')}` },
      { label: '팔 슬롯 안정성',        val: m.P2_arm_slot_SD?.score, varKey: 'P2_arm_slot_SD',
        desc: m.P2_arm_slot_SD?.score != null ? '팔 각도 일관성 (deg SD)' : `팔 각도 SD — ${need('arm_slot_angle (Pitching_Wrist_jc_Position 필요)')}` },
      { label: '릴리스 높이 안정성',    val: m.P3_release_height_SD?.score, varKey: 'P3_release_height_SD',
        desc: m.P3_release_height_SD?.score != null ? '수직 위치만 (Y SD, cm)' : `Y SD — ${need('Pitching_Wrist_jc_Position.Y')}` },
      { label: '타이밍 일관성',         val: m.P4_mer_to_br_SD?.score, varKey: 'P4_mer_to_br_SD',
        desc: '운동사슬 타이밍 안정성 (MER→BR ms SD) · ★ events 컬럼 있으면 산출' },
      { label: '스트라이드 일관성',     val: m.P5_stride_SD?.score, varKey: 'P5_stride_SD',
        desc: '발 위치 일관성 (stride_length SD cm)' },
      { label: '몸통 자세 일관성',      val: m.P6_trunk_tilt_SD?.score, varKey: 'P6_trunk_tilt_SD',
        desc: '몸통 기울기 안정성 (fc_trunk_forward_tilt SD deg)' },
    ];
  }

  // 체력 변수 — 단순 linear scoring (raw → 0~100점)
  function _fitnessScore(raw, lo, hi) {
    if (raw == null || !isFinite(raw)) return null;
    if (raw <= lo) return 0;
    if (raw >= hi) return 100;
    return Math.round((raw - lo) / (hi - lo) * 100);
  }
  // ★ v0.59 — 모드별 체력 임계값 (Pro=VALD Baseball 2024 normative, HS=Driveline)
  function _fitThresholds() {
    const mode = (window.TheiaApp && window.TheiaApp.getMode) ? window.TheiaApp.getMode() : 'hs_top10';
    if (mode === 'pro') {
      // VALD Baseball 2024: 50th ≈ 60점, 99th = 100점 매핑
      return {
        imtp_bm:    [24, 42],     // VALD 50th 36.3 N/kg → 68점, 99th 53.7 → 100점
        cmj_pwr_bm: [45, 70],     // VALD 50th 60 W/kg → 60점, 99th 78 → 100점
        cmj_rsi:    [0.40, 0.85], // VALD 50th 0.65 m/s → 56점, 99th 0.97 → 100점
        bmi_target: 26.5,         // MLB pro 평균 BMI 26~27
        bmi_dev_mult: 14,         // BMI 편차 ×14 → 25/28에서 ~80점 유지 (HS보다 관대)
      };
    }
    // hs_top10 — 기존 Driveline 기준
    return {
      imtp_bm:    [25, 35],
      cmj_pwr_bm: [50, 70],
      cmj_rsi:    [0.50, 1.00],
      bmi_target: 22.5,
      bmi_dev_mult: 20,
    };
  }
  // BMI score — 모드별 target / dev_mult 사용 (★ v0.59 mode-aware)
  function _bmiScore(bmi) {
    if (bmi == null) return null;
    const t = _fitThresholds();
    const dev = Math.abs(bmi - t.bmi_target);
    return Math.max(0, Math.round(100 - dev * t.bmi_dev_mult));
  }

  // 3-column radar charts init (Chart.js)
  function _initRadarCharts(result) {
    if (typeof Chart === 'undefined') return;
    // ★ v0.59 mode-aware 임계값
    const _fTr = _fitThresholds();
    const fitDims = [
      { label: '체중당 근력', val: _fitnessScore((_getFit() && _getFit().imtp_peak_force_bm), _fTr.imtp_bm[0], _fTr.imtp_bm[1]) },
      { label: '체중당 파워', val: _fitnessScore((_getFit() && _getFit().cmj_peak_power_bm), _fTr.cmj_pwr_bm[0], _fTr.cmj_pwr_bm[1]) },
      { label: '반응성 (SSC)', val: _fitnessScore((_getFit() && _getFit().cmj_rsi_modified), _fTr.cmj_rsi[0], _fTr.cmj_rsi[1]) },
      { label: '체격 (BMI)',   val: (_getFit() && _getFit().bmi) != null ? _bmiScore((_getFit() || {}).bmi) : null },
    ];
    const mechDims = _compute6axisMech(result);
    const ctrlDims = _compute6axisCtrl(result);

    const drawRadar = (canvasId, dims, color) => {
      const el = document.getElementById(canvasId);
      if (!el) return;
      const labels = dims.map(d => d.label);
      const data = dims.map(d => d.val == null ? 0 : d.val);
      try {
        new Chart(el.getContext('2d'), {
          type: 'radar',
          data: {
            labels,
            datasets: [{
              label: '점수', data,
              backgroundColor: color + '33',
              borderColor: color,
              borderWidth: 2,
              pointBackgroundColor: color,
              pointRadius: 4,
            }],
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
              r: {
                min: 0, max: 100,
                ticks: { stepSize: 25, color: 'rgba(120,120,120,0.6)', backdropColor: 'transparent', font: { size: 9 } },
                grid: { color: 'rgba(120,120,120,0.2)' },
                angleLines: { color: 'rgba(120,120,120,0.2)' },
                pointLabels: { color: 'var(--text-secondary)', font: { size: 11 } },
              },
            },
            plugins: { legend: { display: false } },
          },
        });
      } catch (e) { console.warn('Radar init failed', canvasId, e); }
    };
    drawRadar('theia-radar-fit', fitDims, '#0070C0');
    drawRadar('theia-radar-mech', mechDims, '#fb923c');
    drawRadar('theia-radar-ctrl', ctrlDims, '#7030A0');
  }

  // ════════════════════════════════════════════════════════════
  // v0.6 — BBL Uplift 동일 동적 마네킹 + 종형 곡선
  // ════════════════════════════════════════════════════════════

  // ── 마네킹 (BBL Uplift dynamic SVG, Theia 변수 매핑) ──
  // 통합 표시: 키네틱 체인 흐름 + GRF (양 발) + 팔꿈치 토크/파워 + lag·결함 라벨
  const FAULT_DRILLS = {
    WeakTrailDrive:    ['단일 다리 점프 3×8', 'Sled push 5×20m', 'Trap bar deadlift 3×5'],
    WeakLeadBlock:     ['Eccentric step-down 5초 hold 3×8', 'Drop landing 3×6', 'Single-leg ecc box jump 3×5'],
    PoorSpeedupChain:  ['Connected throw drill', 'Plyo ball throws', '시퀀스 재학습 (느린→빠른 contrast)'],
    LateTrunkRotation: ['회전 메디신볼 throw 3×8', 'Slow-fast contrast 회전', 'Hip-shoulder dissociation'],
    FlyingOpen:        ['FC 거울 hold drill', 'Hip dissociation 3×8', 'Closed posture cue'],
    LeadKneeCollapse:  ['Eccentric step-down 5초 hold', 'Single-leg RDL 3×8', 'Drop landing'],
    ExcessForwardTilt: ['Closed-posture cue', 'Anti-flexion 코어 보강', 'Plank 3×60s'],
    PoorBlock:         ['Stop-and-rotate drill', 'Heavy ecc box jump', 'Single-leg ecc'],
    MERShoulderRisk:   ['Sleeper stretch 3×30s', 'PNF rotator cuff', '메디신볼 회전 던지기 (몸통 활성화)', 'Throwing volume monitoring'],
    PoorReleaseConsistency: ['반복 폼 연습 (mirror)', '비디오 피드백', 'Target throw 5×10'],
    HighElbowValgus:   ['Sleeper stretch 3×30s', 'PNF rotator cuff', '메디신볼 회전 던지기 (몸통 활성화)', 'Throwing volume monitoring'],
  };

  // ── 결함 진단 + drill ──
  function _renderFaultsWithDrills(result) {
    if (!result.faults || result.faults.length === 0) {
      return `
      <div class="cat-card mb-6" style="padding: 16px; border-left: 4px solid #16a34a; background: rgba(22,163,74,0.04);">
        <div class="display text-lg" style="color: #16a34a;">✓ 검출된 결함 없음</div>
        <div class="text-sm mt-1" style="color: var(--text-secondary);">코호트 평균 임계 기준으로 키네틱 결함이 검출되지 않았습니다.</div>
      </div>`;
    }
    // ★ v0.15 — ELI_AREAS 6영역 라벨·idx와 1:1 통일 (모순 해소)
    const STAGE_NAMES = {
      1: '하체 추진',         // = ELI lower_drive (mech_idx 0)
      2: '앞다리 블로킹',     // = ELI lead_block (mech_idx 1)
      3: '골반-몸통 연결',    // = ELI pelvis_trunk (mech_idx 2)
      4: '몸통 파워',         // = ELI trunk_power (mech_idx 3)
      5: '팔 전달',           // = ELI arm_transfer (mech_idx 4)
      6: '부하 대비 효율',    // = ELI load_eff (INJURY)
    };
    const STAGE_OF_FAULT = {
      WeakTrailDrive: 1,
      WeakLeadBlock: 2, LeadKneeCollapse: 2, PoorBlock: 2,
      FlyingOpen: 3,
      LateTrunkRotation: 4, PoorSpeedupChain: 4, ExcessForwardTilt: 4,  // ★ 수정: 5→4 (트렁크)
      MERShoulderRisk: 5,
      HighElbowValgus: 6,  // ★ 수정: 6→6 그대로 (UCL stress = 부하)
      PoorReleaseConsistency: 6,  // 제구 변동 — 부하 대비 효율 영역
    };
    // 단계별 결함 집계
    const stageFaults = {1:[], 2:[], 3:[], 4:[], 5:[], 6:[]};
    const stageMaxSev = {1:'ok', 2:'ok', 3:'ok', 4:'ok', 5:'ok', 6:'ok'};
    const sevPriority = { high: 3, medium: 2, low: 1, ok: 0 };
    for (const f of result.faults) {
      const stage = STAGE_OF_FAULT[f.id] || 4;
      stageFaults[stage].push(f);
      if (sevPriority[f.severity] > sevPriority[stageMaxSev[stage]]) stageMaxSev[stage] = f.severity;
    }
    const sevColor = { high: '#dc2626', medium: '#fb923c', low: '#94a3b8', ok: '#16a34a' };
    const sevIcon  = { high: '⚠⚠', medium: '⚠', low: 'ℹ', ok: '✓' };
    const sevText  = { high: '에너지 누출', medium: '주의', low: '경미', ok: '정상' };

    // ★ v0.17 — ELI 점수 기반 단계 정렬 + 점수 표시 (ELI ↔ 결함 일관성)
    const eliResult = _calculateELI(result);
    const stageELI = {};  // 단계 → ELI 점수
    if (eliResult?.areas) {
      eliResult.areas.forEach((a, i) => { stageELI[i + 1] = a.score; });
    }
    // 단계 1~6을 ELI 점수 오름차순으로 정렬 (가장 약한 단계 위로)
    const sortedStages = [1,2,3,4,5,6].sort((a, b) => {
      const sa = stageELI[a] ?? 100;
      const sb = stageELI[b] ?? 100;
      return sa - sb;
    });
    const stageRows = sortedStages.map(s => {
      const sev = stageMaxSev[s];
      const c = sevColor[sev];
      const fs = stageFaults[s];
      const eliScore = stageELI[s];
      const desc = fs.length > 0 ? fs.map(f => f.label.replace(/\([^)]*\)/, '').trim()).join(', ') : '결함 없음';
      // ELI 점수 기반 추가 평가 (결함 없어도 ELI 낮으면 약함 표시)
      const eliColor = eliScore == null ? '#94a3b8' : eliScore >= 75 ? '#16a34a' : eliScore >= 60 ? '#22d3ee' : eliScore >= 40 ? '#fb923c' : '#dc2626';
      return `<div class="flex items-center gap-2 py-1.5 flex-wrap" style="border-bottom: 1px dashed var(--border);">
        <span style="width: 22px; text-align: center; font-size: 13px; color: ${c};">${sevIcon[sev]}</span>
        <span class="mono text-xs" style="width: 36px; color: var(--text-muted);">단계 ${s}</span>
        <strong class="text-sm" style="width: 130px; color: ${c};">${STAGE_NAMES[s]}</strong>
        <span class="mono text-xs" style="width: 70px; color: ${eliColor}; font-weight: 700;">ELI ${eliScore != null ? eliScore : '—'}점</span>
        <span class="text-xs" style="color: ${c}; font-weight: 600; width: 80px;">${sevText[sev]}</span>
        <span class="text-xs" style="color: var(--text-secondary); flex: 1;">${desc}</span>
      </div>`;
    }).join('');

    // ★ v0.17 — ELI 우선순위 박스 (가장 약한 영역 강조 — 결함 진단 우선순위 통일)
    const weakAreas = (eliResult?.areas || []).filter(a => a.score != null && a.score < 60).sort((a, b) => a.score - b.score);
    const priorityHtml = weakAreas.length > 0 ? `
      <div class="mb-3 p-3 rounded" style="background: rgba(220,38,38,0.08); border-left: 3px solid #dc2626;">
        <div class="text-xs font-semibold mb-2" style="color: #dc2626;">📌 ELI 점수 기반 우선순위 — 다음 영역부터 보강하세요</div>
        <ol class="list-decimal pl-5" style="font-size: 12px; color: var(--text-secondary);">
          ${weakAreas.slice(0, 3).map((a, i) => `
            <li class="mb-1">
              <strong style="color: ${a.score < 40 ? '#dc2626' : '#fb923c'};">${a.name}</strong>
              <span class="mono" style="color: ${a.score < 40 ? '#dc2626' : '#fb923c'}; margin-left: 6px;">${a.score}점</span>
              ${a.weight >= 20 ? '<span style="color: #fbbf24; font-size: 11px;"> (★ 가중치 20)</span>' : ''}
              ${a.matchedFaults?.length > 0
                ? ` — 결함 ${a.matchedFaults.length}건 (${a.matchedFaults.map(f => f.label.replace(/\\([^)]*\\)/g, '').trim()).join(', ')})`
                : ' — 결함 없으나 출력 부족'}
            </li>`).join('')}
        </ol>
      </div>` : '';

    const totalLeak = result.faults.length;
    const highLeak = result.faults.filter(f => f.severity === 'high').length;
    const summaryColor = highLeak > 0 ? '#dc2626' : '#fb923c';
    const summaryMsg = `⚠ ${totalLeak}개 단계에서 에너지 누출 감지 — 아래에서 원인 확인`;

    // 결함별 상세 카드
    const sevLabel = { high: '⚠️ 높음', medium: '⚡ 중간', low: 'ℹ 낮음' };
    const sevOrder = { high: 0, medium: 1, low: 2 };
    const sortedFaults = [...result.faults].sort((a,b) => sevOrder[a.severity] - sevOrder[b.severity]);

    const faultDetailCards = sortedFaults.map(f => {
      const c = sevColor[f.severity] || '#888';
      const stage = STAGE_OF_FAULT[f.id] || 4;
      const drills = FAULT_DRILLS[f.id] || [];
      return `<div style="background: var(--bg-elevated); padding: 12px 14px; margin-bottom: 8px; border-radius: 6px; border-left: 4px solid ${c};">
        <div class="flex items-center gap-2 mb-1 flex-wrap">
          <span class="mono text-xs" style="background: ${c}22; color: ${c}; padding: 2px 8px; border-radius: 3px; font-weight: 600;">${sevLabel[f.severity]}</span>
          <span class="mono text-xs" style="color: var(--text-muted);">단계 ${stage} · ${STAGE_NAMES[stage]}</span>
          <strong style="color: ${c};">${f.label}</strong>
        </div>
        <div class="text-xs mt-2" style="color: var(--text-secondary);"><strong>원인:</strong> ${f.cause}</div>
        <div class="text-xs mt-1" style="color: var(--text-secondary);"><strong>코칭:</strong> ${f.coaching}</div>
        ${drills.length > 0 ? `<div class="text-xs mt-1" style="color: var(--text-muted);"><strong style="color: #16a34a;">💪 추천 drill:</strong> ${drills.join(' · ')}</div>` : ''}
      </div>`;
    }).join('');

    // ★ v0.13 — 3+4단계를 단일 카드로 통합 (단계 요약 → 변수별 결함 detail → drill)
    return `
    <div class="cat-card mb-6" style="padding: 18px; border: 2px solid ${summaryColor}; background: ${summaryColor}08;">
      <div class="display text-xl mb-2" style="color: ${summaryColor};">🔬 결함 진단 + 코칭 처방</div>
      <div class="text-sm mb-3" style="color: ${summaryColor}; font-weight: 600;">${summaryMsg}</div>

      <!-- ★ v0.17 — ELI 우선순위 박스 (가장 약한 영역 강조) -->
      ${priorityHtml}

      <!-- 단계별 요약 (ELI 점수 오름차순 정렬, 가장 약한 단계 위로) -->
      <div class="mb-4">
        <div class="text-xs mb-2 mono uppercase" style="color: var(--text-muted); letter-spacing: 0.05em;">단계별 진단 (ELI 약한 순)</div>
        ${stageRows}
      </div>

      <!-- 변수별 detail + drill (이전 4단계) -->
      <div>
        <div class="text-xs mb-2 mono uppercase" style="color: var(--text-muted); letter-spacing: 0.05em;">변수별 원인 분석 + 추천 drill</div>
        <div class="text-xs mb-2" style="color: var(--text-secondary);">감지된 ${totalLeak}개 결함의 원인을 변수별로 분석하고 drill을 추천합니다.</div>
        ${faultDetailCards}
      </div>

      <div class="text-[11px] mt-2" style="color: var(--text-muted);">
        심각도: <span style="color: #dc2626;">🚨 매우 위험 (즉시 조치)</span> → <span style="color: #fb923c;">⚠️ 높음 (우선 보강)</span> → <span style="color: #fbbf24;">⚡ 중간</span> → <span style="color: #94a3b8;">ℹ 낮음</span>
      </div>
    </div>`;
  }

  // ── 11. 종합 평가 — 강점/약점 영역별 + 다음 단계 우선순위 + 훈련 추천 ──
  function _renderSummaryWithTraining(result) {
    const TM = window.TheiaMeta;
    const m = result.varScores || {};

    // 영역별 강점·약점 분류 (변수 단위)
    const varToArea = {};
    // 메카닉 — OUTPUT/TRANSFER/LEAK/INJURY 변수
    for (const cat of ['OUTPUT','TRANSFER','LEAK','INJURY']) {
      for (const v of TM.OTL_CATEGORIES[cat].variables) varToArea[v] = '메카닉';
    }
    // 제구 — CONTROL
    for (const v of TM.OTL_CATEGORIES.CONTROL.variables) varToArea[v] = '제구';
    // 체력 — fitness 변수 ((_getFit() || {}))
    const fitness = _getFit() || {};
    const fitnessVarsExtra = [];
    // ★ v0.59 mode-aware 임계값 (Pro=VALD, HS=Driveline)
    const _fTx = _fitThresholds();
    const _isProEx = (window.TheiaApp && window.TheiaApp.getMode && window.TheiaApp.getMode() === 'pro');
    // 추가 변수 (SJ/EUR/Grip)는 VALD 직접 데이터 있으면 그것 적용
    const sjPbThr  = _isProEx ? [44, 75]  : [30, 50];   // VALD SJ Power/BM 1st 44, 99th 75
    const eurThr   = _isProEx ? [0.95, 1.10] : [1.0, 1.3];  // VALD CMJ_PP/SJ_PP ≈ 1.02
    const gripThr  = _isProEx ? [55, 75]  : [35, 55];   // VALD Grip 50th 64.4 kg
    if (fitness.cmj_rsi_modified != null) fitnessVarsExtra.push({ key: 'CMJ_RSI', name: 'CMJ RSI-mod', score: _fitnessScore(fitness.cmj_rsi_modified, _fTx.cmj_rsi[0], _fTx.cmj_rsi[1]) });
    if (fitness.cmj_peak_power_bm != null) fitnessVarsExtra.push({ key: 'CMJ_PB', name: 'CMJ 단위파워', score: _fitnessScore(fitness.cmj_peak_power_bm, _fTx.cmj_pwr_bm[0], _fTx.cmj_pwr_bm[1]) });
    if (fitness.sj_peak_power_bm != null) fitnessVarsExtra.push({ key: 'SJ_PB', name: 'SJ 단위파워', score: _fitnessScore(fitness.sj_peak_power_bm, sjPbThr[0], sjPbThr[1]) });
    if (fitness.eur != null) fitnessVarsExtra.push({ key: 'EUR', name: 'EUR (CMJ/SJ 비)', score: _fitnessScore(fitness.eur, eurThr[0], eurThr[1]) });
    if (fitness.imtp_peak_force_bm != null) fitnessVarsExtra.push({ key: 'IMTP_BM', name: 'IMTP/체중', score: _fitnessScore(fitness.imtp_peak_force_bm, _fTx.imtp_bm[0], _fTx.imtp_bm[1]) });
    if (fitness.bmi != null) fitnessVarsExtra.push({ key: 'BMI', name: 'BMI', score: _bmiScore(fitness.bmi) });
    if (fitness.grip_strength_kg != null) fitnessVarsExtra.push({ key: 'GRIP', name: 'Grip 근력', score: _fitnessScore(fitness.grip_strength_kg, gripThr[0], gripThr[1]) });

    const strengths = { '체력': [], '메카닉': [], '제구': [] };
    const weaknesses = { '체력': [], '메카닉': [], '제구': [] };

    // 메카닉·제구 (Theia c3d 변수)
    for (const [k, vs] of Object.entries(m)) {
      if (vs?.score == null) continue;
      const area = varToArea[k];
      if (!area) continue;
      const meta = TM.getVarMeta(k);
      const name = meta?.name || k;
      const item = { key: k, name, score: vs.score };
      if (vs.score >= 75) strengths[area].push(item);
      else if (vs.score <= 35) weaknesses[area].push(item);
    }
    // 체력 (fitness xlsx에서)
    for (const f of fitnessVarsExtra) {
      if (f.score == null) continue;
      if (f.score >= 75) strengths['체력'].push(f);
      else if (f.score <= 35) weaknesses['체력'].push(f);
    }
    // 정렬
    Object.keys(strengths).forEach(a => strengths[a].sort((x,y) => y.score - x.score));
    Object.keys(weaknesses).forEach(a => weaknesses[a].sort((x,y) => x.score - y.score));

    const renderList = (groups, isStrength) => {
      const colors = { '체력': '#0070C0', '메카닉': '#fb923c', '제구': '#7030A0' };
      const sections = ['체력','메카닉','제구'].map(area => {
        const items = groups[area].slice(0, 6);
        if (items.length === 0) return '';
        return `<div class="mb-3">
          <div class="text-xs uppercase mb-2" style="color: ${colors[area]}; font-weight: 600; letter-spacing: 0.05em;">${area}</div>
          ${items.map(it => `<div style="background: var(--bg-elevated); padding: 8px 12px; border-left: 3px solid ${colors[area]}; border-radius: 3px; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center; font-size: 13px;">
            <span>${it.name}</span>
            <strong style="color: ${isStrength ? '#16a34a' : '#dc2626'};">${it.score}점</strong>
          </div>`).join('')}
        </div>`;
      }).filter(s => s).join('');
      return sections || `<div class="text-sm" style="color: var(--text-muted); font-style: italic;">해당 변수 없음</div>`;
    };

    // 다음 단계 우선순위 (가장 약한 영역 + 훈련 추천)
    const trainingPlans = _generateTrainingPlan(weaknesses, fitness);
    const trainingHtml = trainingPlans.length > 0 ? `
      <div class="mt-4">
        <div class="display text-base mb-2" style="color: var(--accent);">🎯 다음 단계 우선순위 + 훈련 추천</div>
        ${trainingPlans.map((p, i) => `<div class="mb-3 p-3 rounded" style="background: var(--bg-elevated); border-left: 3px solid ${p.color};">
          <div class="text-sm font-semibold mb-1" style="color: ${p.color};"><strong>${i+1}. ${p.title}</strong> <span class="text-xs mono" style="color: var(--text-muted); margin-left: 4px;">${p.score != null ? p.score + '점' : ''}</span></div>
          <div class="text-xs mb-1" style="color: var(--text-secondary);">${p.desc}</div>
          ${p.drills?.length ? `<div class="text-xs mt-1"><strong style="color: #16a34a;">💪 추천 훈련:</strong> <span style="color: var(--text-secondary);">${p.drills.join(' · ')}</span></div>` : ''}
          ${p.goal ? `<div class="text-xs mt-1"><strong style="color: #fbbf24;">🎯 6주 목표:</strong> <span style="color: var(--text-secondary);">${p.goal}</span></div>` : ''}
        </div>`).join('')}
      </div>` : '';

    // ★ v0.15 — ELI 영역 강점/약점 우선 표시 (모순 해소)
    //   변수 단위 점수는 raw — 결함 패널티 미반영. 종합 평가에서는 ELI 영역(패널티 적용)을 우선.
    //   변수 단위는 보조 정보로 details 안.
    const eliResult = _calculateELI(result);
    const TM2 = window.TheiaMeta;
    let eliStrengths = '', eliWeaknesses = '';
    if (eliResult && eliResult.areas) {
      const sorted = eliResult.areas.filter(a => a.score != null);
      const areaStrengths = sorted.filter(a => a.score >= 75).sort((a,b) => b.score - a.score);
      const areaWeak = sorted.filter(a => a.score < 50).sort((a,b) => a.score - b.score);
      // 결함 매핑 (영역별)
      const stageOfFaultArea = { WeakTrailDrive: 'lower_drive', WeakLeadBlock: 'lead_block', LeadKneeCollapse: 'lead_block', PoorBlock: 'lead_block',
        FlyingOpen: 'pelvis_trunk', LateTrunkRotation: 'trunk_power', PoorSpeedupChain: 'trunk_power', ExcessForwardTilt: 'trunk_power',
        MERShoulderRisk: 'arm_transfer', HighElbowValgus: 'load_eff', PoorReleaseConsistency: 'load_eff' };
      const faultsByArea = {};
      (result.faults || []).forEach(f => {
        const aid = stageOfFaultArea[f.id] || 'load_eff';
        (faultsByArea[aid] = faultsByArea[aid] || []).push(f);
      });
      const renderArea = (a, isStrength) => {
        const c = isStrength ? '#16a34a' : '#dc2626';
        const fs = faultsByArea[a.id] || [];
        const faultBadges = fs.map(f => `<span class="mono text-[9px]" style="background: rgba(220,38,38,0.15); color: #dc2626; padding: 1px 6px; border-radius: 3px; margin-left: 4px;">${f.severity === 'high' ? '🚨' : '⚠'} ${f.label.replace(/\([^)]*\)/g, '').trim()}</span>`).join(' ');
        return `<div style="background: var(--bg-card); padding: 8px 12px; border-left: 3px solid ${c}; border-radius: 3px; margin-bottom: 6px;">
          <div class="flex justify-between items-baseline">
            <strong style="font-size: 13px;">${a.name}${a.weight >= 20 ? ' ★' : ''} <span class="text-[10px] mono" style="color: var(--text-muted);">w=${a.weight}</span></strong>
            <strong style="color: ${c}; font-size: 14px;">${a.score}점</strong>
          </div>
          ${fs.length > 0 ? `<div class="mt-1">${faultBadges}</div>` : ''}
          <div class="text-[10px] mt-1" style="color: var(--text-muted);">${a.desc}</div>
        </div>`;
      };
      eliStrengths = areaStrengths.length > 0 ? areaStrengths.map(a => renderArea(a, true)).join('')
                                              : `<div class="text-xs" style="color: var(--text-muted); font-style: italic;">75점 이상 영역 없음</div>`;
      eliWeaknesses = areaWeak.length > 0 ? areaWeak.map(a => renderArea(a, false)).join('')
                                          : `<div class="text-xs" style="color: var(--text-muted); font-style: italic;">50점 미만 영역 없음</div>`;
    }

    // ★ v0.17 — 강점/약점 영역 제거 (결함 진단 카드와 중복) → 훈련 추천만 유지
    return `
    <div class="cat-card mt-6" style="padding: 22px;">
      <div class="display text-2xl mb-3">📋 종합 평가 — 다음 단계 훈련 우선순위</div>
      <div class="text-sm mb-4" style="color: var(--text-muted);">
        결함 진단·ELI 영역 평가는 위 섹션에서 확인하세요. 본 카드는 훈련 처방에 집중합니다.
      </div>
      ${trainingHtml || '<div class="text-sm" style="color: var(--text-muted);">결함 없음 — 현재 메카닉 유지 + 부상 모니터링 권장</div>'}
    </div>`;
  }

  // 약점 기반 훈련 추천 생성
  function _generateTrainingPlan(weaknesses, fitness) {
    const plans = [];
    // 체력 약점 우선
    const fitWeak = weaknesses['체력'] || [];
    if (fitWeak.find(w => /imtp|근력|grip/i.test(w.name))) {
      const w = fitWeak.find(w => /imtp|근력|grip/i.test(w.name));
      plans.push({
        title: '근력', score: w.score, color: '#0070C0',
        desc: '데드리프트, 스쿼트, IMTP 트레이닝, 체격성 관리',
        drills: ['Trap Bar Deadlift 3×5', 'Back Squat 4×5', 'Romanian Deadlift 3×8', 'IMTP holds 3×5s'],
        goal: 'IMTP Peak Force +200 N',
      });
    }
    if (fitWeak.find(w => /bmi|체중|체격/i.test(w.name))) {
      const w = fitWeak.find(w => /bmi|체중|체격/i.test(w.name));
      plans.push({
        title: '체격', score: w.score, color: '#60a5fa',
        desc: '영양 섭취, 근육량 증가 (체지방 < 15%)',
        drills: ['단백질 1.6~2.0 g/kg', 'Compound 리프트 3회/주', '수면 8h+'],
        goal: '체중 +3 kg (근육량 증가)',
      });
    }
    if (fitWeak.find(w => /sj|cmj|파워|rsi/i.test(w.name))) {
      const w = fitWeak.find(w => /sj|cmj|파워|rsi/i.test(w.name));
      plans.push({
        title: '폭발력 (Power)', score: w.score, color: '#fbbf24',
        desc: 'Plyometric + 스피드 강화 (CMJ·SJ Peak Power)',
        drills: ['Box Jump 3×5', 'Depth Jump 3×5', 'Med Ball Throw 3×8', 'Olympic Lift Variations'],
        goal: 'CMJ Peak Power/BM +5 W/kg',
      });
    }
    // 메카닉 약점
    const mechWeak = weaknesses['메카닉'] || [];
    if (mechWeak.length > 0) {
      const top = mechWeak[0];
      plans.push({
        title: `메카닉 — ${top.name}`, score: top.score, color: '#fb923c',
        desc: '키네틱 체인 시퀀싱·증폭률 보강',
        drills: ['Connected throw drill', 'Plyo ball throws', 'Hip-shoulder dissociation 3×8'],
        goal: '4사분면 ②→① 영역 이동',
      });
    }
    // 제구
    const ctrlWeak = weaknesses['제구'] || [];
    if (ctrlWeak.length > 0) {
      const top = ctrlWeak[0];
      plans.push({
        title: `제구 — ${top.name}`, score: top.score, color: '#7030A0',
        desc: 'Trial-to-trial 일관성 강화 — 반복 폼 + 비디오 피드백',
        drills: ['Target throw 5×10', 'Mirror drill', '비디오 frame-by-frame 분석'],
        goal: 'P1 wrist 3D SD < 8 cm',
      });
    }
    return plans;
  }

  function _renderVarDetail(result, varNames) {
    const TM = window.TheiaMeta;
    let html = '<table class="var-table"><thead><tr><th>변수</th><th>값</th><th>점수</th><th>의미</th></tr></thead><tbody>';
    for (const v of varNames) {
      const vs = result.varScores[v];
      const meta = TM.getVarMeta(v);
      if (!meta) continue;
      const valStr = vs ? formatVal(vs.value, meta.unit) : '<span class="na">—</span>';
      const scoreStr = vs ? `<span class="score-${vs.score >= 75 ? 'good' : vs.score >= 50 ? 'mid' : 'low'}">${vs.score}</span>` : '<span class="na">—</span>';
      html += `<tr><td><strong>${meta.name}</strong></td><td>${valStr}</td><td>${scoreStr}</td><td><small style="color: var(--text-muted);">${meta.hint || ''}</small></td></tr>`;
    }
    html += '</tbody></table>';
    return html;
  }

  function formatVal(v, unit) {
    if (v == null) return '—';
    const num = typeof v === 'number' ? v : parseFloat(v);
    let s;
    if (Math.abs(num) >= 100) s = num.toFixed(1);
    else if (Math.abs(num) >= 10) s = num.toFixed(2);
    else s = num.toFixed(3);
    return `${s}${unit ? ' ' + unit : ''}`;
  }

  // ════════════════════════════════════════════════════════════
  // 메인 진입점 — 파일 입력 → 리포트 생성
  // ════════════════════════════════════════════════════════════

  // 마네킹/종형 호출은 window.TheiaMannequin로 위임
  // renderReport 내부에서 직접 호출하던 _renderMannequinUplift / _renderKinematicBellUplift 가
  // 이 IIFE 안에 정의되어 있으므로 그대로 작동. (mannequin.js로 분리된 후에도 wrapper 사용 가능)
  function _renderMannequinUplift(result) {
    return (window.TheiaMannequin && window.TheiaMannequin.renderMannequinUplift)
      ? window.TheiaMannequin.renderMannequinUplift(result)
      : '<div class="text-sm text-[var(--text-muted)] py-6 text-center">⚠ TheiaMannequin 미로드</div>';
  }
  function _renderKinematicBellUplift(result) {
    return (window.TheiaMannequin && window.TheiaMannequin.renderKinematicBellUplift)
      ? window.TheiaMannequin.renderKinematicBellUplift(result)
      : '<div class="text-sm text-[var(--text-muted)] py-6 text-center">⚠ TheiaMannequin 미로드</div>';
  }

  // window.TheiaApp 객체에 renderReport 등록 (theia_app.js 로드 후 호출됨)
  function _registerWithApp() {
    if (window.TheiaApp) {
      window.TheiaApp.renderReport = renderReport;
    } else {
      // theia_app.js가 아직 로드 안 됐으면 잠시 후 재시도
      setTimeout(_registerWithApp, 50);
    }
  }
  _registerWithApp();

  window.TheiaRender = { renderReport };
})();
