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

  function renderReport(result) {
    // ★ v0.13 — 섹션 흐름 재배치 (사용자 요청: 개념→시퀀스→마네킹+ELI→상세 흐름)
    const html = [
      _renderHeader(result),                 // 1. 헤더 (잠재 구속 4 카드)
      _render3ColumnRadars(result),          // 2. 3-col 라디아 (체력·메카닉·제구) — 개관
      _renderQuadrantDiagnosis(result),      // 3. 출력 vs 에너지 효율 (4사분면) — 진단 입구
      _renderKineticChainEducation(result),  // 4. 🎓 키네틱 체인이란? (GIF 교육)
      _renderKinematicBellUplift(result),    // 5. 📊 키네매틱 시퀀스 (간접 추정)
      _renderMannequinUplift(result),        // 6. 🤸 코칭 세션 — 마네킹 + ELI 통합 (직접 진단)
      _renderELISection(result),             // 7. 🔋 ELI 상세 (PDF 산식·등급·핵심 결론)
      _renderGRFSection(result),             // 8. 🦵 GRF 분석 (지면반력 디테일)
      _renderFaultsWithDrills(result),       // 9. 🔬 결함 + drill (3+4단계 통합)
      _renderSummaryWithTraining(result),    // 10. 📋 종합 평가 + 훈련 추천
      _renderELIReferences(result),          // 11. 📚 참고문헌 (접기)
      _renderActionButtons(result),          // 12. [저장 / 다운로드 / 인쇄]
      // ❌ 삭제: _renderKineticChainStages (ELI 6영역과 100% 중복)
    ].join('\n');
    setTimeout(() => _initRadarCharts(result), 100);
    return html;
  }

  // ════════════════════════════════════════════════════════════
  // v0.12 — Integrated Energy Leak Index (ELI)
  //   PDF baseball_pitching_energy_leak_index.pdf 프레임워크
  //   Σ wₖ × LeakScoreₖ (100점, 높을수록 효율적)
  // ════════════════════════════════════════════════════════════
  // ★ v0.16 — _calculateELI 확장: 변수별 산정 근거 정보까지 반환
  // 영역별 변수 매핑 (산정 근거 expand에 사용)
  const ELI_AREA_VARS = {
    lower_drive:  { vars: ['Trail_leg_peak_vertical_GRF','Trail_leg_peak_AP_GRF','Trail_Hip_Power_peak','Pelvis_peak'],
                    faultIds: ['WeakTrailDrive'] },
    lead_block:   { vars: ['Lead_leg_peak_vertical_GRF','CoG_Decel','Lead_Knee_Power_peak','br_lead_leg_knee_flexion','lead_knee_ext_change_fc_to_br'],
                    faultIds: ['WeakLeadBlock','LeadKneeCollapse','PoorBlock'] },
    pelvis_trunk: { vars: ['fc_xfactor','peak_xfactor','peak_trunk_CounterRotation','trunk_rotation_at_fc'],
                    faultIds: ['FlyingOpen'] },
    trunk_power:  { vars: ['Pelvis_peak','Trunk_peak','trunk_forward_flexion_vel_peak','pelvis_to_trunk','pelvis_trunk_speedup'],
                    faultIds: ['LateTrunkRotation','PoorSpeedupChain','ExcessForwardTilt'] },
    arm_transfer: { vars: ['Arm_peak','humerus_segment_peak','trunk_to_arm','arm_trunk_speedup','mer_shoulder_abd','max_shoulder_ER','Pitching_Shoulder_Power_peak'],
                    faultIds: ['MERShoulderRisk'] },
    load_eff:     { from_injury: true, vars: [], faultIds: ['HighElbowValgus','PoorReleaseConsistency'] },
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
    const grade = TM.getELIGrade(eli);

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
            ${a.desc} · <em style="color: ${sc != null && sc < 50 ? '#dc2626' : 'var(--text-muted)'};">${a.leak_when_low}</em>
            ${a.hasFaults ? ` <span style="color: #dc2626; font-weight: 600;">· ⚠ ${a.matchedFaults.length}건 패널티</span>` : ''}
          </div>
        </summary>
        <div class="mt-3 pt-3" style="border-top: 1px dashed var(--border);">
          ${breakdownHtml}
        </div>
      </details>`;
    }).join('');

    // 핵심 결론 문장 (PDF 표 10 형식)
    const conclusionHtml = topWeak && feedbackTpl ? `
      <div class="mt-3 p-3 rounded" style="background: ${grade.color}15; border-left: 3px solid ${grade.color};">
        <div class="text-sm font-semibold mb-1" style="color: ${grade.color};">📝 핵심 결론 (PDF §10 형식)</div>
        <div class="text-sm leading-relaxed" style="color: var(--text-primary);">
          이 선수의 주된 에너지 리크는 <strong>'${topWeak.name}'</strong> 구간에서 나타납니다.
          ${feedbackTpl.diagnosis}
        </div>
        <div class="text-xs mt-2" style="color: var(--text-secondary);">
          <strong style="color: #16a34a;">💪 추천 훈련 방향:</strong> ${feedbackTpl.training}
        </div>
      </div>` : (eli >= 70 ? `
      <div class="mt-3 p-3 rounded" style="background: rgba(22,163,74,0.1); border-left: 3px solid #16a34a;">
        <div class="text-sm" style="color: #16a34a; font-weight: 600;">✓ 영역별 점수 모두 60점 이상 — 명확한 리크 위치 없음. 세부 타이밍 조정 단계.</div>
      </div>` : '');

    // ETE 정의 박스 + 4가지 에너지 역할
    const eteHtml = `
      <details class="mt-3 text-xs" style="background: var(--bg-elevated); padding: 8px 12px; border-radius: 4px; border-left: 2px solid var(--accent-soft);">
        <summary class="cursor-pointer" style="color: var(--accent-soft); font-weight: 600;">🔬 ETE / ELI 산식 (PDF §4-5)</summary>
        <div class="mt-2 leading-relaxed" style="color: var(--text-secondary);">
          <div class="mb-2"><strong>분절 에너지:</strong> <code class="mono text-[10px]">Eᵢ(t) = ½mᵢvᵢ² + ½ωᵢᵀIᵢωᵢ + mᵢghᵢ</code> (병진 + 회전 + 위치)</div>
          <div class="mb-2"><strong>관절 파워:</strong> <code class="mono text-[10px]">Pⱼ(t) = Mⱼ(t) · ωⱼ(t)</code>, W⁺=∫max(P,0)dt 생성, W⁻=∫min(P,0)dt 흡수</div>
          <div class="mb-2"><strong>전달 효율:</strong> <code class="mono text-[10px]">ETE = ΔE_distal / W_proximal⁺</code></div>
          <div class="mb-2"><strong>리크 지수:</strong> <code class="mono text-[10px]">ELI = 1 − ETE</code> (값 클수록 비효율)</div>
          <div class="mb-2"><strong>에너지 역할 4가지:</strong> <em>Source</em> (생성) · <em>Channel</em> (전달) · <em>Absorber</em> (감속) · <em>Sink</em> (비효율 보상)</div>
          <div><strong>현장용 Integrated ELI</strong> = Σ wₖ × LeakScoreₖ (PDF §6 가중치 15·20·20·15·15·15 = 100)</div>
        </div>
      </details>`;

    return `
    <div class="cat-card mb-6" style="padding: 22px; border: 2px solid ${grade.color}; background: linear-gradient(135deg, ${grade.color}10, transparent);">
      <div class="flex justify-between items-start flex-wrap gap-3 mb-3">
        <div>
          <div class="mono text-xs uppercase tracking-widest" style="color: var(--text-muted);">INTEGRATED ELI · PDF §6 프레임워크</div>
          <div class="display text-2xl mt-1" style="color: ${grade.color};">🔋 Energy Leak Index</div>
          <div class="text-xs mt-1" style="color: var(--text-muted);">
            영역별 점수 × 가중치 합 (Aguinaldo 2019 · Pryhoda & Sabick 2022 기반)
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

  // ── 잠재 구속 예측 ──
  // HS Top 10% mode: 측정 구속 기준 카테고리 점수의 부족분만큼 향상 가능치 추정
  // - 체력만 100점 발달 → +5 km/h (lever effect)
  // - 메카닉(Output+Transfer) 100점 발달 → +5 km/h
  // - 둘 다 100점 → +7 km/h (interaction)
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
    const fitOnly  = +(cur + 5.0 * fitGap).toFixed(1);
    const mechOnly = +(cur + 5.0 * mechGap).toFixed(1);
    const both     = +(cur + 7.0 * Math.max(fitGap, mechGap)).toFixed(1);
    return { current: cur, fitOnly, mechOnly, both };
  }

  // 좌·우투 + 측정 구속 기준 Mode 분류 (BBL Uplift Mode A/B/C 동일)
  function _getPlayerMode(hand, ballSp) {
    if (ballSp == null) return { id: 'unknown', label: '미평가', color: '#94a3b8' };
    const eliteThr = hand === 'left' ? 135 : 140;
    const devThr   = hand === 'left' ? 125 : 130;
    if (ballSp >= eliteThr) return { id: 'B', label: '⭐ Elite 정착 (Mode B)', color: '#c084fc', desc: 'MaxV ≥' + eliteThr + ' km/h — 미세조정 (좁은 σ)' };
    if (ballSp >= devThr)   return { id: 'C', label: '🔧 표준 발달 (Mode C)', color: '#fb923c', desc: '발달 단계 — 출력·전달 동시 향상' };
    return { id: 'A', label: '🌱 발달 단계 (Mode A)', color: '#60a5fa', desc: '기초 단계 — 체력·시퀀싱 기초 형성' };
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
        ${card('체력만 발달 시 잠재 구속', pred.fitOnly, '#60a5fa', dFit > 0 ? dFit : null)}
        ${card('메카닉만 발달 시 잠재 구속', pred.mechOnly, '#fb923c', dMech > 0 ? dMech : null)}
        ${card('동시 발달 시 잠재 구속', pred.both, '#fbbf24', dBoth > 0 ? dBoth : null)}
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
      qMessage = '둘 다 평균 미만 — Amateur 수준. 체력·시퀀싱 기초 동시 향상 — 인내심 있게 단계별 발달.';
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
      ${_expandCard('출력 (Power Generation)', '각 분절(하체→몸통→팔)이 만들어내는 절대 회전·선형 출력', outScore, '#16a34a', 'OUTPUT', 'wrist_release_speed', ' m/s')}
      ${_expandCard('에너지 효율 (Energy Transfer / Sequencing)', '분절 간 에너지가 효율적으로 흐르는가 — 타이밍·증폭률·저장방출', trScore, '#fb923c', 'TRANSFER', 'angular_chain_amplification', ' x')}
      ${_expandCard('부상 위험 (Injury Risk)', '출력의 비용 — UCL stress (팔꿈치) + knee stress (drive 다리)', injScore, '#f87171', 'INJURY', 'max_shoulder_ER', ' °')}
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

    const measured = [trailV, leadV, trailAP, leadAP, transition, trailImpulse].filter(x => x != null).length;
    if (measured === 0) {
      return `
      <div class="cat-card mb-6" style="padding: 18px; border-left: 4px solid #6b7280;">
        <div class="display text-xl mb-2" style="color: #6b7280;">🦵 GRF 분석 (지면반력)</div>
        <div class="text-sm" style="color: var(--text-muted);">
          지면반력 데이터 없음 — Visual3D pipeline에서 <strong>Trail_Leg_GRF / Lead_Leg_GRF</strong>로 정규화된 c3d.txt 필요. (박명균 옛 형식의 FP1/FP2 raw는 미지원)
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
        <text x="${W*0.25}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--text-secondary)">Trail vGRF</text>
      ` : ''}
      ${leadV != null ? `
        <rect x="${W*0.65 - barW/2}" y="${yScale(leadV)}" width="${barW}" height="${(H-P) - yScale(leadV)}" fill="#C00000" opacity="0.7"/>
        <text x="${W*0.65}" y="${yScale(leadV) - 6}" text-anchor="middle" font-size="13" font-weight="bold" fill="#C00000">${leadV.toFixed(2)}</text>
        <text x="${W*0.65}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--text-secondary)">Lead vGRF</text>
      ` : ''}
      <!-- elite reference 라인 (Trail≥1.5, Lead≥2.0 BW) -->
      <line x1="${P}" y1="${yScale(2.0)}" x2="${W-P}" y2="${yScale(2.0)}" stroke="#16a34a" stroke-dasharray="3,3" opacity="0.6"/>
      <text x="${W-P-2}" y="${yScale(2.0)-3}" text-anchor="end" font-size="9" fill="#16a34a">elite ≥2.0 BW</text>
      <!-- Y축 단위 -->
      <text x="${P-4}" y="${yScale(0)+3}" text-anchor="end" font-size="9" fill="var(--text-muted)">0</text>
      <text x="${P-4}" y="${yScale(maxV/2)+3}" text-anchor="end" font-size="9" fill="var(--text-muted)">${(maxV/2).toFixed(1)}</text>
      <text x="${P-4}" y="${yScale(maxV)+3}" text-anchor="end" font-size="9" fill="var(--text-muted)">${maxV.toFixed(1)} BW</text>
    </svg>`;

    const fmt = (v, d=2, u='') => v != null ? `${v.toFixed(d)}${u}` : '—';
    const scoreColor = (sc) => sc == null ? '#94a3b8' : sc >= 75 ? '#16a34a' : sc >= 50 ? '#fb923c' : '#dc2626';

    return `
    <div class="cat-card mb-6" style="padding: 18px; border-left: 4px solid var(--accent-soft);">
      <div class="display text-xl mb-2" style="color: var(--accent-soft);">🦵 GRF 분석 (지면반력)</div>
      <div class="text-sm mb-3" style="color: var(--text-secondary);">
        Trail leg(뒷다리) push와 Lead leg(앞다리) block의 지면반력 — 키네틱 체인 1·2 단계의 직접 측정값.
      </div>
      <div class="grid md:grid-cols-2 gap-4 items-center">
        <div>${grfBar}</div>
        <div>
          <table class="var-table" style="font-size: 12px;">
            <thead><tr><th>변수</th><th>값</th><th>점수</th></tr></thead>
            <tbody>
              <tr><td>Trail vGRF (수직)</td><td class="mono">${fmt(trailV, 2, ' BW')}</td><td><strong style="color: ${scoreColor(trailVS)};">${trailVS != null ? trailVS : '—'}</strong></td></tr>
              <tr><td>Trail AP GRF (전후)</td><td class="mono">${fmt(trailAP, 2, ' BW')}</td><td><strong style="color: ${scoreColor(trailAPS)};">${trailAPS != null ? trailAPS : '—'}</strong></td></tr>
              <tr><td>Trail leg impulse</td><td class="mono">${fmt(trailImpulse, 3, ' BW·s')}</td><td>—</td></tr>
              <tr><td>Lead vGRF (수직)</td><td class="mono">${fmt(leadV, 2, ' BW')}</td><td><strong style="color: ${scoreColor(leadVS)};">${leadVS != null ? leadVS : '—'}</strong></td></tr>
              <tr><td>Lead AP GRF (전후)</td><td class="mono">${fmt(leadAP, 2, ' BW')}</td><td><strong style="color: ${scoreColor(leadAPS)};">${leadAPS != null ? leadAPS : '—'}</strong></td></tr>
              <tr><td>Trail→Lead 전환 시간</td><td class="mono">${fmt(transition, 3, ' s')}</td><td><strong style="color: ${scoreColor(transitionS)};">${transitionS != null ? transitionS : '—'}</strong></td></tr>
            </tbody>
          </table>
          <div class="text-xs mt-2" style="color: var(--text-muted); line-height: 1.5;">
            <strong>해석:</strong> Trail vGRF≥1.5 BW (push), Lead vGRF≥2.0 BW (block, elite). 전환시간 짧을수록 sequencing 우수. AP GRF는 forward 추진력.
          </div>
        </div>
      </div>
    </div>`;
  }

  // ── 7. Kinetics 섹션 (Joint Power, Energy, Torque) ──
  // ════════════════════════════════════════════════════════════
  // 추가 컴포넌트 — 3-col radar / 마네킹 / 종형곡선 / 결함 drill / 훈련 추천
  // ════════════════════════════════════════════════════════════

  function _render3ColumnRadars(result) {
    const cats = result.catScores || {};

    // 체력 (fitness 데이터 있으면 표시 — 4 dim)
    const fitness = _getFit() || {};
    const fitDims = [
      { label: '체중당 근력', val: _fitnessScore(fitness.imtp_peak_force_bm, 25, 35), raw: fitness.imtp_peak_force_bm, unit: 'N/kg', desc: '체중 정규화 최대 근력',
        formula: 'IMTP Peak Force / Body Mass (N/kg)', threshold_text: 'Elite ≥35 N/kg · 평균 25 · <20 부족',
        mlb_avg: '34 N/kg (Driveline)', coaching: '체중당 근력 부족 시 GRF 생성 능력 제한 — vGRF·trail drive 약화로 직결.', drill: 'Trap Bar Deadlift 3×5, Back Squat 4×5, IMTP holds 3×5s' },
      { label: '체중당 파워', val: _fitnessScore(fitness.cmj_peak_power_bm, 50, 70), raw: fitness.cmj_peak_power_bm, unit: 'W/kg', desc: '체중 정규화 폭발력',
        formula: 'CMJ Peak Power / Body Mass (W/kg)', threshold_text: 'Elite ≥70 W/kg · 평균 55 · <40 부족',
        mlb_avg: '68 W/kg (Driveline)', coaching: '체중당 파워는 vGRF rate of force development와 직결 — 키네틱 체인 출력 baseline.', drill: 'Box Jump 3×5, Depth Jump 3×5, Olympic Lift Variations' },
      { label: '반응성 (SSC)', val: _fitnessScore(fitness.cmj_rsi_modified, 0.5, 1.0), raw: fitness.cmj_rsi_modified, unit: 'm/s', desc: '신장단축주기 효율',
        formula: 'CMJ RSI-modified = Jump Height / Contact Time', threshold_text: 'Elite ≥1.0 m/s · 평균 0.7 · <0.5 부족',
        mlb_avg: '0.95 m/s (Driveline)', coaching: 'Stretch-shortening cycle 효율 — block leg ecc→con 전환의 직접 지표.', drill: 'Drop Jump 3×5, Pogo Jump 3×10, Bounding 3×20m' },
      { label: '체격 (BMI)', val: fitness.bmi != null ? _bmiScore(fitness.bmi) : null, raw: fitness.bmi, unit: '', desc: '신체 구성 (BMI 기반)',
        formula: 'BMI = Mass(kg) / Height(m)²', threshold_text: 'Optimal 22~25 (피칭 elite) · <19 또는 >28 = 발달 권장',
        mlb_avg: '23 (MLB Combine)', coaching: 'BMI 적정 범위는 라인레버리지·체질량 조합. 너무 낮으면 출력 부족, 너무 높으면 가동 제한.', drill: '단백질 1.6~2.0 g/kg, Compound 리프트, 수면 8h+' },
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
        const grade = d.val == null ? '미측정' : d.val >= 80 ? '최상위' : d.val >= 70 ? '우수' : d.val >= 50 ? '상위 평균' : '평균 수준 — 발달 여지 큼';
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
          ※ 100점 = MLB 평균 표준값. 80점+ = 한국 고1 elite. 50점 = 발달 평균.
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
  // BMI score — 22.5가 elite, 18.5/27.5 양 끝이 0점
  function _bmiScore(bmi) {
    if (bmi == null) return null;
    const dev = Math.abs(bmi - 22.5);
    return Math.max(0, Math.round(100 - dev * 20));
  }

  // 3-column radar charts init (Chart.js)
  function _initRadarCharts(result) {
    if (typeof Chart === 'undefined') return;
    const fitDims = [
      { label: '체중당 근력', val: _fitnessScore((_getFit() && _getFit().imtp_peak_force_bm), 25, 35) },
      { label: '체중당 파워', val: _fitnessScore((_getFit() && _getFit().cmj_peak_power_bm), 50, 70) },
      { label: '반응성 (SSC)', val: _fitnessScore((_getFit() && _getFit().cmj_rsi_modified), 0.5, 1.0) },
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
    if (fitness.cmj_rsi_modified != null) fitnessVarsExtra.push({ key: 'CMJ_RSI', name: 'CMJ RSI-mod', score: _fitnessScore(fitness.cmj_rsi_modified, 0.5, 1.0) });
    if (fitness.cmj_peak_power_bm != null) fitnessVarsExtra.push({ key: 'CMJ_PB', name: 'CMJ 단위파워', score: _fitnessScore(fitness.cmj_peak_power_bm, 50, 70) });
    if (fitness.sj_peak_power_bm != null) fitnessVarsExtra.push({ key: 'SJ_PB', name: 'SJ 단위파워', score: _fitnessScore(fitness.sj_peak_power_bm, 30, 50) });
    if (fitness.eur != null) fitnessVarsExtra.push({ key: 'EUR', name: 'EUR (CMJ/SJ 비)', score: _fitnessScore(fitness.eur, 1.0, 1.3) });
    if (fitness.imtp_peak_force_bm != null) fitnessVarsExtra.push({ key: 'IMTP_BM', name: 'IMTP/체중', score: _fitnessScore(fitness.imtp_peak_force_bm, 25, 35) });
    if (fitness.bmi != null) fitnessVarsExtra.push({ key: 'BMI', name: 'BMI', score: _bmiScore(fitness.bmi) });
    if (fitness.grip_strength_kg != null) fitnessVarsExtra.push({ key: 'GRIP', name: 'Grip 근력', score: _fitnessScore(fitness.grip_strength_kg, 35, 55) });

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
