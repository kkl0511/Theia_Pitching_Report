/**
 * theia_app.js — 메인 진입점 (파서·점수·API) (Theia v0.7+)
 *
 * 역할: c3d.txt 파서 + 변수 산출 + aggregateTrials + calculateScores + processFiles + state·API
 * 렌더링은 theia_render.js / theia_mannequin.js로 분리됨 (script 로드 순서 무관 — 위임 패턴)
 *
 * 의존: window.TheiaCohort (cohort_theia.js) · window.TheiaMeta (metadata_theia.js)
 * 노출: window.TheiaApp = { ALGORITHM_VERSION, parseC3dTxt, extractScalars,
 *                          aggregateTrials, calculateScores, processFiles, renderReport,
 *                          setMode/getMode/setPlayer/getPlayer, setFitnessData/getFitnessData/getFitnessMeta,
 *                          getLastResult }
 */
(function () {
  'use strict';

  const ALGORITHM_VERSION = 'v0.8';
  let CURRENT_MODE = 'hs_top10';
  let CURRENT_PLAYER = { mass_kg: null, height_cm: null, name: null, handedness: null, level: null };
  let CURRENT_FITNESS = null;
  let CURRENT_FITNESS_META = null;
  let LAST_RESULT = null;

  // ════════════════════════════════════════════════════════════
  // c3d.txt 파서 (87 컬럼 헤더 기반)
  // ════════════════════════════════════════════════════════════

  function safeNum(v) {
    if (v == null || v === '') return null;
    const f = parseFloat(v);
    return isFinite(f) ? f : null;
  }

  /**
   * c3d.txt 텍스트 → 구조화된 데이터
   * { meta, header, dtype, component, kinematic, force_only, columnIndex }
   */
  function parseC3dTxt(text) {
    const lines = text.split(/\r?\n/);
    if (lines.length < 6) throw new Error('c3d.txt too short (<6 rows)');

    const row1 = lines[0].split('\t');
    const header = lines[1].split('\t');
    const dtype = lines[2].split('\t');
    const proc = lines[3].split('\t');
    const component = lines[4].split('\t');

    // 파일 경로 (row1 col 1) → athlete name·trial 추출
    const filePath = (row1[1] || '').replace(/\\/g, '/');
    const m = filePath.match(/\/Data\/([^/]+)\/(?:[^/]+\/)?([^/]+)\.c3d/i);
    const athlete = m ? m[1].trim() : null;
    const trialName = m ? m[2].trim() : null;
    const handHint = trialName && /\bLH\b|Left/i.test(trialName) ? 'left' :
                      trialName && /\bRH\b|Right/i.test(trialName) ? 'right' : null;

    // ★ 헤더와 데이터 row의 시작 위치 차이 자동 검출 (offset)
    //   dtype row 'FRAME_NUMBERS' 첫 위치 = data col 시간 컬럼 위치 (가장 신뢰)
    //   header sparse — 'TIME' 한 번이지만 데이터엔 두 시간 컬럼 (capture abs + trial rel)
    //   - 박명균 (46컬럼): dtype col 1='FRAME_NUMBERS', header col 2='FRAMES' → offset=1
    //   - 새 샘플 (87컬럼): dtype col 1='FRAME_NUMBERS', header col 1='FRAMES' → offset=0
    const frameHeaderIdx = header.findIndex(h => (h || '').trim() === 'FRAMES');
    let dataStart = 0;
    for (let i = 0; i < dtype.length; i++) {
      if ((dtype[i] || '').trim() === 'FRAME_NUMBERS') { dataStart = i; break; }
    }
    const offset = frameHeaderIdx >= 0 ? frameHeaderIdx - dataStart : 0;

    // 컬럼 인덱스 매핑 — header[i] (propagated) ↔ dtype·component·data col (i - offset)
    // ★ 박명균: header sparse(col 4='Pelvis_Ang_Vel') ↔ component col 3='Z' → 'Pelvis_Ang_Vel.Z'=col 3
    // ★ 새 샘플: header dense(col 4='Pelvis_Ang_Vel') ↔ component col 4='Z' → 'Pelvis_Ang_Vel.Z'=col 4
    const columnIndex = {};
    let lastH = '';
    for (let i = 0; i < header.length; i++) {
      const rawH = (header[i] || '').trim();
      if (rawH) lastH = rawH;
      const h = lastH;
      const dataCol = i - offset;
      if (dataCol < 0 || dataCol >= dtype.length) continue;
      const c = (component[dataCol] || '').trim();
      const dt = (dtype[dataCol] || '').trim();
      if (!h || h === 'FRAMES' || h === 'TIME' || dt === 'FRAME_NUMBERS') continue;
      const key = c && c !== '0' ? `${h}.${c}` : h;
      if (columnIndex[key] == null) columnIndex[key] = dataCol;
    }

    // FRAMES, TIME — dtype 'FRAME_NUMBERS' 위치 기반
    const frameNumIdxs = [];
    for (let i = 0; i < dtype.length; i++) {
      if ((dtype[i] || '').trim() === 'FRAME_NUMBERS') frameNumIdxs.push(i - offset);
    }
    columnIndex['FRAMES'] = frameHeaderIdx >= 0 ? frameHeaderIdx - offset : (frameNumIdxs[0] != null ? frameNumIdxs[0] - 1 : 0);
    columnIndex['TIME_abs'] = frameNumIdxs[0] != null ? frameNumIdxs[0] : columnIndex['FRAMES'] + 1;
    columnIndex['TIME_rel'] = frameNumIdxs[1] != null ? frameNumIdxs[1] : columnIndex['TIME_abs'] + 1;

    // 데이터 row 6+ — kinematic (TIME_rel != null) + force-only (TIME_rel == null)
    const kinematic = [];
    const force_only = [];
    let firstFrame = null, lastKinTime = null;
    for (let i = 5; i < lines.length; i++) {
      const r = lines[i].split('\t');
      if (r.length < 5) continue;
      const tt = safeNum(r[columnIndex['TIME_rel']]);
      if (tt != null) {
        kinematic.push(r);
        lastKinTime = tt;
      } else {
        const f = safeNum(r[columnIndex['FRAMES']]);
        if (f != null) force_only.push(r);
      }
    }

    // FPS 추정
    let fps = 300;
    if (kinematic.length >= 2) {
      const t1 = safeNum(kinematic[1][columnIndex['TIME_rel']]) || 0;
      const t0 = safeNum(kinematic[0][columnIndex['TIME_rel']]) || 0;
      const dt = t1 - t0;
      if (dt > 0) fps = Math.round(1 / dt);
    }

    // 이벤트 시간 (row 0의 EVENT_LABEL 컬럼들) — 새 형식·박명균 옛 형식 모두 지원
    const events = {};
    if (kinematic.length > 0) {
      const r0 = kinematic[0];
      // 각 이벤트별로 시도할 컬럼명 후보 리스트 (앞 우선)
      const evCandidates = {
        'KH': ['MaxKneeHeight'],
        'FS': ['Footstrike', 'FootStrike', 'FootContact'],
        'MER': ['Max_External_Rotation', 'Max_Shoulder_Int_Rot', 'MER'],
        'BR': ['Ball_Release', 'Release', 'BR'],
        'BR100ms': ['Ball_Release_Plus_100ms', 'Release100msAfter', 'BR100ms'],
      };
      for (const [k, cands] of Object.entries(evCandidates)) {
        for (const h of cands) {
          const idx = columnIndex[h];
          if (idx != null) {
            const v = safeNum(r0[idx]);
            if (v != null) { events[k] = v; break; }
          }
        }
      }
    }

    return {
      meta: { filePath, athlete, trialName, handHint, fps, duration: lastKinTime },
      header, dtype, component, columnIndex,
      kinematic, force_only,
      events
    };
  }

  // ════════════════════════════════════════════════════════════
  // 헬퍼 — 시계열 분석
  // ════════════════════════════════════════════════════════════

  function valAtTime(parsed, varKey, t) {
    if (t == null) return null;
    const idx = parsed.columnIndex[varKey];
    if (idx == null) return null;
    const tIdx = parsed.columnIndex['TIME_rel'];
    for (const r of parsed.kinematic) {
      const tt = safeNum(r[tIdx]);
      if (tt != null && tt >= t) return safeNum(r[idx]);
    }
    return null;
  }

  function maxAbsBetween(parsed, varKey, tFrom, tTo) {
    const idx = parsed.columnIndex[varKey];
    if (idx == null || tFrom == null || tTo == null) return null;
    const tIdx = parsed.columnIndex['TIME_rel'];
    const lo = Math.min(tFrom, tTo), hi = Math.max(tFrom, tTo);
    let best = null;
    for (const r of parsed.kinematic) {
      const tt = safeNum(r[tIdx]); const v = safeNum(r[idx]);
      if (tt == null || v == null) continue;
      if (lo <= tt && tt <= hi) {
        if (best == null || Math.abs(v) > Math.abs(best)) best = v;
      }
    }
    return best;
  }

  function argmaxAbs(parsed, varKey, tFrom, tTo) {
    const idx = parsed.columnIndex[varKey];
    if (idx == null || tFrom == null || tTo == null) return null;
    const tIdx = parsed.columnIndex['TIME_rel'];
    const lo = Math.min(tFrom, tTo), hi = Math.max(tFrom, tTo);
    let bestAbs = -1, bestT = null;
    for (const r of parsed.kinematic) {
      const tt = safeNum(r[tIdx]); const v = safeNum(r[idx]);
      if (tt == null || v == null) continue;
      if (lo <= tt && tt <= hi) {
        if (Math.abs(v) > bestAbs) { bestAbs = Math.abs(v); bestT = tt; }
      }
    }
    return bestT;
  }

  function maxBetween(parsed, varKey, tFrom, tTo) {
    const idx = parsed.columnIndex[varKey];
    if (idx == null || tFrom == null || tTo == null) return null;
    const tIdx = parsed.columnIndex['TIME_rel'];
    const lo = Math.min(tFrom, tTo), hi = Math.max(tFrom, tTo);
    let best = null;
    for (const r of parsed.kinematic) {
      const tt = safeNum(r[tIdx]); const v = safeNum(r[idx]);
      if (tt == null || v == null) continue;
      if (lo <= tt && tt <= hi && (best == null || v > best)) best = v;
    }
    return best;
  }

  function minBetween(parsed, varKey, tFrom, tTo) {
    const idx = parsed.columnIndex[varKey];
    if (idx == null || tFrom == null || tTo == null) return null;
    const tIdx = parsed.columnIndex['TIME_rel'];
    const lo = Math.min(tFrom, tTo), hi = Math.max(tFrom, tTo);
    let best = null;
    for (const r of parsed.kinematic) {
      const tt = safeNum(r[tIdx]); const v = safeNum(r[idx]);
      if (tt == null || v == null) continue;
      if (lo <= tt && tt <= hi && (best == null || v < best)) best = v;
    }
    return best;
  }

  // Force-only stream (sub-frame) 처리
  function forceOnlyTimes(parsed, varKey) {
    const idx = parsed.columnIndex[varKey];
    if (idx == null || parsed.force_only.length === 0) return [];
    const fIdx = parsed.columnIndex['FRAMES'];
    const dur = parsed.meta.duration;
    if (!dur) return [];
    const rows = parsed.force_only.map(r => ({
      f: safeNum(r[fIdx]), v: safeNum(r[idx])
    })).filter(x => x.f != null && x.v != null).sort((a,b) => a.f - b.f);
    if (rows.length < 2) return [];
    const first = rows[0].f, last = rows[rows.length-1].f;
    const span = last - first;
    if (span <= 0) return [];
    return rows.map(({f, v}) => ({ t: (f - first) / span * dur, v }));
  }

  function detectFCfromGRF(parsed, mass_kg) {
    const arr = forceOnlyTimes(parsed, 'Lead_Leg_GRF.Z');
    if (arr.length === 0) return null;
    const baselineN = Math.min(100, Math.floor(arr.length / 4));
    const baseline = arr.slice(0, baselineN).reduce((s, x) => s + x.v, 0) / baselineN;
    const threshold = mass_kg ? mass_kg * 9.81 * 0.1 : 70;
    const target = baseline + threshold;
    for (const x of arr) {
      if (x.v > target) return x.t;
    }
    return null;
  }

  function grfPeakBW(parsed, varKey, tFrom, tTo, mass_kg) {
    if (!mass_kg) return null;
    const arr = forceOnlyTimes(parsed, varKey);
    if (!arr.length || tFrom == null || tTo == null) return null;
    const lo = Math.min(tFrom, tTo), hi = Math.max(tFrom, tTo);
    let best = 0;
    for (const x of arr) {
      if (lo <= x.t && x.t <= hi && Math.abs(x.v) > best) best = Math.abs(x.v);
    }
    const bw = mass_kg * 9.81;
    return best > 0 ? best / bw : null;
  }

  function grfPeakTime(parsed, varKey, tFrom, tTo) {
    const arr = forceOnlyTimes(parsed, varKey);
    if (!arr.length || tFrom == null || tTo == null) return null;
    const lo = Math.min(tFrom, tTo), hi = Math.max(tFrom, tTo);
    let bestAbs = -1, bestT = null;
    for (const x of arr) {
      if (lo <= x.t && x.t <= hi && Math.abs(x.v) > bestAbs) {
        bestAbs = Math.abs(x.v); bestT = x.t;
      }
    }
    return bestT;
  }

  function grfImpulseBW(parsed, varKey, tFrom, tTo, mass_kg) {
    if (!mass_kg) return null;
    const arr = forceOnlyTimes(parsed, varKey);
    if (arr.length < 2 || tFrom == null || tTo == null) return null;
    const lo = Math.min(tFrom, tTo), hi = Math.max(tFrom, tTo);
    let total = 0;
    for (let i = 1; i < arr.length; i++) {
      if (lo <= arr[i].t && arr[i].t <= hi) {
        const dt = arr[i].t - arr[i-1].t;
        total += Math.abs(arr[i].v) * dt;
      }
    }
    const bw = mass_kg * 9.81;
    return total / bw;
  }

  // ════════════════════════════════════════════════════════════
  // 변수 산출 — extract_theia_scalars.py JS 포팅
  // ════════════════════════════════════════════════════════════

  function extractScalars(parsed, mass_kg, height_cm) {
    const ev = parsed.events;
    const ci = parsed.columnIndex;

    // FC 검출 — Lead vGRF 기반 우선, fallback to V3D Footstrike
    const fcGrf = detectFCfromGRF(parsed, mass_kg);
    ev.FC = fcGrf != null ? fcGrf : ev.FS;
    ev._fc_source = fcGrf != null ? 'lead_vGRF' : 'visual3d_label';

    const out = {
      _meta: { ...parsed.meta, mass_kg, height_cm },
      _events: ev,
    };

    const winFrom = ev.KH;
    const winTo = ev.BR100ms;

    // ── Output ──
    out.Pelvis_peak = maxAbsBetween(parsed, 'Pelvis_Ang_Vel.Z', winFrom, winTo);
    if (out.Pelvis_peak != null) out.Pelvis_peak = Math.abs(out.Pelvis_peak);
    out.Trunk_peak = maxAbsBetween(parsed, 'Thorax_Ang_Vel.Z', winFrom, winTo);
    if (out.Trunk_peak != null) out.Trunk_peak = Math.abs(out.Trunk_peak);

    // Arm_peak = Pitching_Shoulder_Ang_Vel.Z (humerus IR/ER vel — Theia 검증된 정의)
    const armPeak = maxAbsBetween(parsed, 'Pitching_Shoulder_Ang_Vel.Z', winFrom, winTo);
    out.Arm_peak = armPeak != null ? Math.abs(armPeak) : null;

    // peak frames (timing for lag)
    const pelvisPeakT = argmaxAbs(parsed, 'Pelvis_Ang_Vel.Z', winFrom, winTo);
    const trunkPeakT = argmaxAbs(parsed, 'Thorax_Ang_Vel.Z', winFrom, winTo);
    const armPeakT = argmaxAbs(parsed, 'Pitching_Shoulder_Ang_Vel.Z', winFrom, winTo);
    if (pelvisPeakT != null && trunkPeakT != null) out.pelvis_to_trunk = trunkPeakT - pelvisPeakT;  // s
    if (trunkPeakT != null && armPeakT != null) out.trunk_to_arm = armPeakT - trunkPeakT;

    // Speedup
    if (out.Pelvis_peak > 0 && out.Trunk_peak != null) out.pelvis_trunk_speedup = out.Trunk_peak / out.Pelvis_peak;
    if (out.Trunk_peak > 0 && out.Arm_peak != null) out.arm_trunk_speedup = out.Arm_peak / out.Trunk_peak;
    if (out.Pelvis_peak > 0 && out.Arm_peak != null) out.angular_chain_amplification = out.Arm_peak / out.Pelvis_peak;

    // X-factor
    if (ev.KH != null && ev.FC != null) {
      const xf = maxAbsBetween(parsed, 'Trunk_wrt_Pelvis_Angle.Z', ev.KH, ev.FC + 0.05);
      if (xf != null) out.peak_xfactor = Math.abs(xf);
    }
    out.fc_xfactor = ev.FC != null ? Math.abs(valAtTime(parsed, 'Trunk_wrt_Pelvis_Angle.Z', ev.FC) || 0) : null;

    // proper sequence
    if (pelvisPeakT != null && trunkPeakT != null && armPeakT != null) {
      out.proper_sequence_binary = (pelvisPeakT < trunkPeakT && trunkPeakT < armPeakT) ? 1 : 0;
    }

    // ── 자세 (Leak) ──
    out.fc_trunk_forward_tilt = valAtTime(parsed, 'Trunk_Angle.Z', ev.FC);
    if (ev.FC != null) {
      const yMax = maxBetween(parsed, 'Trunk_Angle.Y', 0, ev.FC);
      const yMin = minBetween(parsed, 'Trunk_Angle.Y', 0, ev.FC);
      if (yMax != null && yMin != null) out.peak_trunk_CounterRotation = Math.abs(yMax - yMin);
    }

    // ── 무릎 ──
    out.fc_lead_leg_knee_flexion = valAtTime(parsed, 'Lead_Knee_Angle.X', ev.FC);
    out.br_lead_leg_knee_flexion = valAtTime(parsed, 'Lead_Knee_Angle.X', ev.BR);
    if (out.fc_lead_leg_knee_flexion != null && out.br_lead_leg_knee_flexion != null) {
      out.lead_knee_ext_change_fc_to_br = out.br_lead_leg_knee_flexion - out.fc_lead_leg_knee_flexion;
    }

    // ── 어깨 ──
    const shZmax = maxBetween(parsed, 'Pitching_Shoulder_Angle.Z', winFrom, winTo);
    if (shZmax != null) out.max_shoulder_ER = shZmax;
    out.fc_shoulder_abd = valAtTime(parsed, 'Pitching_Shoulder_Angle.Y', ev.FC);
    out.mer_shoulder_abd = valAtTime(parsed, 'Pitching_Shoulder_Angle.Y', ev.MER);
    out.br_shoulder_abd = valAtTime(parsed, 'Pitching_Shoulder_Angle.Y', ev.BR);

    // ── Stride ──
    if (parsed.kinematic.length > 0) {
      const r0 = parsed.kinematic[0];
      const stMIdx = ci['STRIDE_LENGTH.X'] || ci['STRIDE_LENGTH'];
      const stPctIdx = ci['STRIDE_LENGTH_PCT.X'] || ci['STRIDE_LENGTH_PCT'] || ci['STRIDE_LENGTH_MEAN_PERCENT'];
      const sM = stMIdx != null ? safeNum(r0[stMIdx]) : null;
      out.stride_length = sM != null ? sM * 100 : null;  // m → cm
      out.stride_length_pct = stPctIdx != null ? safeNum(r0[stPctIdx]) : null;
    }

    // ── COM (3D 합성 가능 시) ──
    if (ci['Whole_Body_COM_Position.X'] != null) {
      // Max_CoG_Velo — 3D vector velocity max
      const tIdx = ci['TIME_rel'];
      const cx = ci['Whole_Body_COM_Position.X'];
      const cy = ci['Whole_Body_COM_Position.Y'];
      const cz = ci['Whole_Body_COM_Position.Z'];
      const lo = (ev.KH || ev.FC) ? (ev.KH || ev.FC) - 0.05 : 0;
      const hi = ev.BR != null ? ev.BR + 0.05 : null;
      if (hi != null) {
        let max = 0, prev = null, prevT = null;
        for (const r of parsed.kinematic) {
          const tt = safeNum(r[tIdx]);
          const x = safeNum(r[cx]), y = safeNum(r[cy]), z = safeNum(r[cz]);
          if (tt == null || x == null || y == null || z == null) { prev = null; continue; }
          if (lo <= tt && tt <= hi) {
            if (prev != null) {
              const dt = tt - prevT;
              if (dt > 0) {
                const v = Math.sqrt((x-prev[0])**2 + (y-prev[1])**2 + (z-prev[2])**2) / dt;
                if (v > max) max = v;
              }
            }
            prev = [x, y, z]; prevT = tt;
          }
        }
        if (max > 0) out.Max_CoG_Velo = max;
      }
    }

    // ── GRF ──
    if (mass_kg) {
      out.Trail_leg_peak_vertical_GRF = grfPeakBW(parsed, 'Trail_Leg_GRF.Z', winFrom, winTo, mass_kg);
      out.Trail_leg_peak_AP_GRF = grfPeakBW(parsed, 'Trail_Leg_GRF.X', winFrom, winTo, mass_kg);
      out.Lead_leg_peak_vertical_GRF = grfPeakBW(parsed, 'Lead_Leg_GRF.Z', winFrom, winTo, mass_kg);
      out.Lead_leg_peak_AP_GRF = grfPeakBW(parsed, 'Lead_Leg_GRF.X', winFrom, winTo, mass_kg);
      out.trail_impulse_stride = grfImpulseBW(parsed, 'Trail_Leg_GRF.Z', ev.KH, ev.FC, mass_kg);
      const trailPeakT = grfPeakTime(parsed, 'Trail_Leg_GRF.Z', winFrom, winTo);
      const leadPeakT = grfPeakTime(parsed, 'Lead_Leg_GRF.Z', winFrom, winTo);
      if (trailPeakT != null && leadPeakT != null) {
        out.trail_to_lead_vgrf_peak_s = leadPeakT - trailPeakT;
      }
    }

    // ── Joint Power (Tier 2) ──
    for (const [outKey, varKey] of [
      ['Pitching_Shoulder_Power_peak', 'Pitching_Shoulder_Power'],
      ['Pitching_Elbow_Power_peak', 'Pitching_Elbow_Power'],
      ['Lead_Hip_Power_peak', 'Lead_Hip_Power'],
      ['Trail_Hip_Power_peak', 'Trail_Hip_Power'],
      ['Lead_Knee_Power_peak', 'Lead_Knee_Power'],
    ]) {
      if (ci[varKey] != null) {
        const v = maxAbsBetween(parsed, varKey, winFrom, winTo);
        if (v != null) out[outKey] = Math.abs(v);
      }
    }

    // ── Wrist 3D 위치 (P1·P3 산출용 trial-level value) ──
    if (ci['Pitching_Wrist_jc_Position.X'] != null && ev.BR != null) {
      out.wrist_x_at_BR = valAtTime(parsed, 'Pitching_Wrist_jc_Position.X', ev.BR);
      out.wrist_y_at_BR = valAtTime(parsed, 'Pitching_Wrist_jc_Position.Y', ev.BR);
      out.wrist_z_at_BR = valAtTime(parsed, 'Pitching_Wrist_jc_Position.Z', ev.BR);
    }

    // ── arm_slot ──
    if (ev.BR != null && ci['Pitching_Shoulder_jc_Position.X'] != null) {
      const sx = valAtTime(parsed, 'Pitching_Shoulder_jc_Position.X', ev.BR);
      const sy = valAtTime(parsed, 'Pitching_Shoulder_jc_Position.Y', ev.BR);
      const sz = valAtTime(parsed, 'Pitching_Shoulder_jc_Position.Z', ev.BR);
      const wx = out.wrist_x_at_BR, wy = out.wrist_y_at_BR, wz = out.wrist_z_at_BR;
      if ([sx,sy,sz,wx,wy,wz].every(v => v != null)) {
        const vDiff = wz - sz;
        const hDiff = Math.sqrt((wx-sx)**2 + (wy-sy)**2);
        out.arm_slot_angle = Math.atan2(vDiff, hDiff) * 180 / Math.PI;
      }
    }

    // ── MER→BR time ──
    if (ev.MER != null && ev.BR != null) out.mer_to_br_time = (ev.BR - ev.MER) * 1000;  // ms

    // ── ball_speed (Visual3D pre-computed) ──
    const ballSpIdx = ci['pitch_speed_kmh'];
    if (ballSpIdx != null && parsed.kinematic.length > 0) {
      out.ball_speed = safeNum(parsed.kinematic[0][ballSpIdx]);
    }

    return out;
  }

  // ════════════════════════════════════════════════════════════
  // Multi-trial 집계 — 평균 + P 카테고리 SD
  // ════════════════════════════════════════════════════════════

  function aggregateTrials(trials) {
    const agg = { _n_trials: trials.length, _events: trials[0]._events, _meta: trials[0]._meta };
    const SCALAR_KEYS = new Set();
    for (const t of trials) {
      for (const k of Object.keys(t)) {
        if (typeof t[k] === 'number') SCALAR_KEYS.add(k);
      }
    }

    function collect(key) {
      return trials.map(t => t[key]).filter(v => v != null && !isNaN(v));
    }
    function mean(arr) { return arr.length ? arr.reduce((s,x) => s+x, 0) / arr.length : null; }
    function stdev(arr) {
      if (arr.length < 2) return null;
      const m = mean(arr);
      return Math.sqrt(arr.reduce((s,x) => s + (x-m)**2, 0) / (arr.length - 1));
    }

    // 평균
    for (const k of SCALAR_KEYS) {
      const vals = collect(k);
      if (vals.length) agg[k] = mean(vals);
    }

    // lag s → ms 변환 (평가 단계에서)
    if (agg.pelvis_to_trunk != null) agg.pelvis_to_trunk_ms = agg.pelvis_to_trunk * 1000;
    if (agg.trunk_to_arm != null) agg.trunk_to_arm_ms = agg.trunk_to_arm * 1000;
    if (agg.trail_to_lead_vgrf_peak_s != null) agg.trail_to_lead_vgrf_peak_s_ms = agg.trail_to_lead_vgrf_peak_s * 1000;

    // P 카테고리 SD
    const wxs = collect('wrist_x_at_BR');
    const wys = collect('wrist_y_at_BR');
    const wzs = collect('wrist_z_at_BR');
    if (wxs.length >= 2 && wys.length >= 2 && wzs.length >= 2) {
      const sdX = stdev(wxs), sdY = stdev(wys), sdZ = stdev(wzs);
      agg.P1_wrist_3D_SD = Math.sqrt(sdX**2 + sdY**2 + sdZ**2) * 100;  // m → cm
      agg.P3_release_height_SD = sdZ * 100;  // m → cm
    }
    const slots = collect('arm_slot_angle');
    if (slots.length >= 2) agg.P2_arm_slot_SD = stdev(slots);
    const merBr = collect('mer_to_br_time');
    if (merBr.length >= 2) agg.P4_mer_to_br_SD = stdev(merBr);
    const strides = collect('stride_length');
    if (strides.length >= 2) agg.P5_stride_SD = stdev(strides);
    const tilts = collect('fc_trunk_forward_tilt');
    if (tilts.length >= 2) agg.P6_trunk_tilt_SD = stdev(tilts);

    return agg;
  }

  // ════════════════════════════════════════════════════════════
  // 점수 산출 + 카테고리 진단
  // ════════════════════════════════════════════════════════════

  function calculateScores(agg, mode) {
    const TM = window.TheiaMeta;
    const TC = window.TheiaCohort;
    const result = { _mode: mode, _algorithm_version: ALGORITHM_VERSION, _meta: agg._meta, _n_trials: agg._n_trials };

    const varScores = {};
    for (const [varName, def] of Object.entries(TM.VAR_DEFS)) {
      const val = agg[varName];
      if (val == null) continue;
      let score = TC.getScore(val, varName, def.polarity, mode);
      let scoreSource = 'cohort';
      // ★ P 카테고리 fallback — cohort에 분포 없을 때 임계 기반 점수 사용 (Driveline·Werner·Murray ref)
      if (score == null && TM.P_THRESHOLDS && TM.P_THRESHOLDS[varName]) {
        score = TM.pFallbackScore(varName, val);
        if (score != null) score = Math.round(score);
        scoreSource = 'p_threshold_fallback';
      }
      if (score != null) {
        varScores[varName] = { value: val, score, polarity: def.polarity, scoreSource };
      }
    }
    result.varScores = varScores;

    // 카테고리별 종합 점수 (변수별 점수 평균)
    const catScores = {};
    for (const [catId, cat] of Object.entries(TM.OTL_CATEGORIES)) {
      const scores = [];
      const measured = [];
      const missing = [];
      for (const v of cat.variables) {
        if (varScores[v] != null) {
          scores.push(varScores[v].score);
          measured.push(v);
        } else {
          missing.push(v);
        }
      }
      const catScore = scores.length > 0 ? scores.reduce((s,x) => s+x, 0) / scores.length : null;
      catScores[catId] = {
        id: catId,
        name: cat.name,
        desc: cat.desc,
        color: cat.color,
        score: catScore != null ? Math.round(catScore) : null,
        measured: measured.length,
        total: cat.variables.length,
        missing,
        integrationVar: cat.integration_var,
        integrationValue: agg[cat.integration_var],
        integrationScore: varScores[cat.integration_var]?.score,
      };
    }
    result.catScores = catScores;

    // KINETIC_FAULTS 검출
    const faults = [];
    for (const f of TM.KINETIC_FAULTS) {
      if (f.detect(agg)) {
        faults.push({ id: f.id, label: f.label, severity: f.severity, cause: f.cause, coaching: f.coaching });
      }
    }
    result.faults = faults;

    return result;
  }
  async function processFiles(files, opts = {}) {
    const mode = opts.mode || CURRENT_MODE;
    const mass_kg = opts.mass_kg || CURRENT_PLAYER.mass_kg;
    const height_cm = opts.height_cm || CURRENT_PLAYER.height_cm;
    const level = opts.level || CURRENT_PLAYER.level || null;
    const userBallSpeed = opts.ball_speed != null && !isNaN(opts.ball_speed) ? opts.ball_speed : null;
    const userBallSpeedSD = opts.ball_speed_sd != null && !isNaN(opts.ball_speed_sd) ? opts.ball_speed_sd : null;
    const pitchType = opts.pitch_type || 'FF';

    if (!files || files.length === 0) throw new Error('파일이 없습니다');
    if (!mass_kg || !height_cm) throw new Error('Mass·Height 입력 필수');

    const trials = [];
    for (const file of files) {
      const text = await file.text();
      try {
        const parsed = parseC3dTxt(text);
        const scalars = extractScalars(parsed, mass_kg, height_cm);
        // c3d.txt에 ball_speed 없으면 사용자 입력값 사용
        if (scalars.ball_speed == null && userBallSpeed != null) {
          scalars.ball_speed = userBallSpeed;
          scalars._ball_speed_source = 'user_input';
        } else if (scalars.ball_speed != null) {
          scalars._ball_speed_source = 'c3d_pitch_speed_kmh';
        }
        trials.push(scalars);
      } catch (e) {
        console.warn(`파싱 실패: ${file.name}`, e);
      }
    }

    if (trials.length === 0) throw new Error('성공한 trial이 없습니다');

    const agg = aggregateTrials(trials);
    // ball_speed 평균이 산출 안 됐으면(c3d.txt 부재 + 사용자 미입력) null. 사용자 입력만 있으면 그 값 사용.
    if (agg.ball_speed == null && userBallSpeed != null) {
      agg.ball_speed = userBallSpeed;
    }
    if (userBallSpeedSD != null) agg.ball_speed_SD = userBallSpeedSD;
    agg._pitch_type = pitchType;
    agg._level = level;

    const result = calculateScores(agg, mode);
    result._ball_speed_source = trials[0]?._ball_speed_source || (userBallSpeed != null ? 'user_input' : 'none');
    if (result._meta) {
      result._meta.pitch_type = pitchType;
      result._meta.level = level;
    }
    LAST_RESULT = result;
    return result;
  }


  // ════════════════════════════════════════════════════════════
  // State accessors / Public API
  // ════════════════════════════════════════════════════════════
  function setMode(m) { CURRENT_MODE = m; }
  function getMode() { return CURRENT_MODE; }
  function setPlayer(p) { Object.assign(CURRENT_PLAYER, p); }
  function getPlayer() { return Object.assign({}, CURRENT_PLAYER); }
  function getLastResult() { return LAST_RESULT; }
  function setFitnessData(fitness, meta) {
    CURRENT_FITNESS = fitness || null;
    CURRENT_FITNESS_META = meta || null;
  }
  function getFitnessData() { return CURRENT_FITNESS; }
  function getFitnessMeta() { return CURRENT_FITNESS_META; }

  // 렌더링 위임 — theia_render.js가 로드되면 renderReport를 덮어씀
  function renderReport(result) {
    if (window.TheiaRender && window.TheiaRender.renderReport && window.TheiaRender.renderReport !== renderReport) {
      return window.TheiaRender.renderReport(result);
    }
    return '<div class="text-sm text-[var(--text-muted)] py-6 text-center">⚠ TheiaRender 미로드 — theia_render.js를 index.html에 추가하세요.</div>';
  }

  window.TheiaApp = {
    ALGORITHM_VERSION,
    parseC3dTxt, extractScalars, aggregateTrials, calculateScores,
    processFiles, renderReport,
    setMode, getMode, setPlayer, getPlayer, getLastResult,
    setFitnessData, getFitnessData, getFitnessMeta,
  };
})();
