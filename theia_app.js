/**
 * theia_app.js — Theia Pitching Report 메인 로직 (v0.1)
 *
 * 입력: c3d.txt 파일 1개 이상 (한 선수의 trial 모음)
 * 출력: Output / Transfer / Leak / Control / Injury 리포트
 *
 * 의존: metadata_theia.js (TheiaMeta), cohort_theia.js (TheiaCohort)
 *
 * Author: Theia Pitching Report v0.1 (2026-05-05)
 */
(function () {
  'use strict';

  const ALGORITHM_VERSION = 'v0.4';
  let CURRENT_MODE = 'hs_top10';  // 'hs_top10' or 'pro'
  let CURRENT_PLAYER = { mass_kg: null, height_cm: null, name: null, handedness: null, level: null };
  let CURRENT_FITNESS = null;  // wide format xlsx에서 로드한 체력 변수 (CMJ·SJ·IMTP·Grip)
  let CURRENT_FITNESS_META = null;  // school·date·ball_speed_max
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
      const score = TC.getScore(val, varName, def.polarity, mode);
      if (score != null) {
        varScores[varName] = { value: val, score, polarity: def.polarity };
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

  // ════════════════════════════════════════════════════════════
  // UI 렌더링
  // ════════════════════════════════════════════════════════════

  // ════════════════════════════════════════════════════════════
  // 리포트 — 헤더 → 4사분면 진단 → 키네틱 체인 6단계 →
  //         에너지 흐름(키네틱 기반) → 카테고리 5 → GRF 섹션 →
  //         Kinetics(파워) 섹션 → 결함 → 종합 평가
  // ════════════════════════════════════════════════════════════
  function renderReport(result) {
    return [
      _renderHeader(result),
      _renderQuadrantDiagnosis(result),
      _renderKineticChainStages(result),
      _renderEnergyFlowKinetic(result),
      _renderCategoryCards(result),
      _renderGRFSection(result),
      _renderKineticsSection(result),
      _renderFaultsSection(result),
      _renderSummaryNarrative(result),
    ].join('\n');
  }

  // ── 1. Header ──
  function _renderHeader(result) {
    const TC = window.TheiaCohort;
    const m = TC.getMode(result._mode);
    const ballSp = result.varScores?.ball_speed?.value;
    const ballSpStr = ballSp != null ? `${ballSp.toFixed(1)} km/h` : '—';
    const ballSpScore = result.varScores?.ball_speed?.score;
    const ballSpSrc = result._ball_speed_source === 'user_input' ? '입력값' :
                      result._ball_speed_source === 'c3d_pitch_speed_kmh' ? 'c3d.txt' : '미입력';
    const pitchType = result._meta?.pitch_type || 'FF';
    const pitchLabel = { FF: '직구', CB: '커브', SL: '슬라이더', CH: '체인지업', CT: '커터', SI: '싱커', OTHER: '기타' }[pitchType] || pitchType;
    const level = result._meta?.level || '';

    return `
    <div class="cat-card mb-6" style="background: linear-gradient(135deg, rgba(31,56,100,0.06), rgba(46,117,182,0.04)); border-left: 6px solid var(--accent, #1F3864); padding: 18px 22px;">
      <div class="display text-2xl mb-1" style="color: var(--accent);">📋 Theia Pitching Report
        <span class="mono text-xs ml-2" style="color: var(--text-muted);">${ALGORITHM_VERSION}</span>
      </div>
      <div class="text-xs mb-2" style="color: var(--text-muted);">
        <span style="background: ${result._mode === 'pro' ? 'var(--output)' : 'var(--accent-soft)'}; color: white; padding: 2px 8px; border-radius: 10px; font-size: 11px;">${m.label}</span>
        · 대상: ${m.target} · Reference n=${m.n}
      </div>
      <div class="text-base mt-2">
        <strong>${result._meta?.athlete || '신규 선수'}</strong>
        ${level ? `<span style="background: var(--accent); color: white; padding: 2px 8px; border-radius: 10px; font-size: 11px; margin-left: 4px;">${level}</span>` : ''}
        <span class="text-xs" style="color: var(--text-muted); margin-left: 6px;">
          Trial ${result._n_trials} · ${result._meta?.mass_kg || '—'}kg · ${result._meta?.height_cm || '—'}cm
        </span>
      </div>
      <div class="mt-2">
        <strong style="color: var(--output, #C00000); font-size: 18px;">⚾ ${ballSpStr}</strong>
        ${ballSpScore != null ? `<span class="text-xs" style="color: var(--text-muted); margin-left: 6px;">(${ballSpScore}점 · 출처: ${ballSpSrc})</span>` : `<span class="text-xs" style="color: var(--text-muted); margin-left: 6px;">(${ballSpSrc})</span>`}
        · 구질: <strong>${pitchLabel}</strong>
      </div>
    </div>`;
  }

  // ── 2. Output vs Transfer 4사분면 진단 (SVG scatter) ──
  function _renderQuadrantDiagnosis(result) {
    const outScore = result.catScores?.OUTPUT?.score;
    const trScore  = result.catScores?.TRANSFER?.score;
    const injScore = result.catScores?.INJURY?.score;
    if (outScore == null || trScore == null) return `
      <div class="cat-card mb-6" style="padding: 18px;">
        <div class="display text-lg" style="color: var(--accent);">🎯 출력 vs 전달 진단</div>
        <div class="text-sm mt-2" style="color: var(--text-muted);">OUTPUT/TRANSFER 카테고리 변수 산출 부족 — c3d.txt에 ball_speed·증폭률 변수가 있어야 진단 가능</div>
      </div>`;

    const injRisk = injScore != null ? (100 - injScore) : 50;  // 안전점수 → 위험%
    const dotColor = injRisk >= 80 ? '#dc2626' : injRisk >= 50 ? '#fb923c' : '#16a34a';

    // 4사분면 분류
    let quadrant, qLabel, qColor, qPriority, qMessage;
    if (outScore >= 50 && trScore >= 50) {
      quadrant = 1; qLabel = '① Elite'; qColor = '#16a34a'; qPriority = '유지';
      qMessage = '출력·전달 모두 코호트 평균 이상. 현재 메카닉 유지 + 부상 모니터링.';
    } else if (outScore >= 50 && trScore < 50) {
      quadrant = 2; qLabel = '② 낭비형 (Inefficient)'; qColor = '#fb923c'; qPriority = '★ 코칭 효과 가장 큼';
      qMessage = '출력은 잘 만드는데 시퀀싱·증폭률이 낮아 손실. <strong>전달 최적화로 즉시 구속 향상 가능</strong> — 메카닉 코칭이 가장 큰 수익을 내는 유형.';
    } else if (outScore < 50 && trScore >= 50) {
      quadrant = 3; qLabel = '③ 효율형 (Underpowered)'; qColor = '#0070C0'; qPriority = '체력 강화';
      qMessage = '메카닉(전달)은 좋은데 <strong>출력 자체가 부족</strong>. 체력(파워·근력)으로 출력을 끌어올리면 elite로 점프 가능.';
    } else {
      quadrant = 4; qLabel = '④ 발달 단계 (Foundation)'; qColor = '#94a3b8'; qPriority = '기초';
      qMessage = '둘 다 평균 미만. 체력·시퀀싱 기초 동시 향상 — 인내심 있게 단계별 발달.';
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
      <text x="${xs(25)}" y="${ys(15)}" text-anchor="middle" font-size="10" fill="#94a3b8" font-weight="bold">④ 발달</text>
      <!-- 축 라벨 -->
      <text x="${W/2}" y="${H-8}" text-anchor="middle" font-size="11" fill="var(--text-secondary)" font-weight="600">출력 Output (percentile)</text>
      <text x="14" y="${H/2}" text-anchor="middle" font-size="11" fill="var(--text-secondary)" font-weight="600" transform="rotate(-90 14 ${H/2})">전달 Transfer (percentile)</text>
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

    return `
    <div class="cat-card mb-6" style="padding: 18px;">
      <div class="flex justify-between items-start mb-2">
        <div>
          <div class="mono text-xs uppercase tracking-widest" style="color: var(--text-muted);">DIAGNOSIS · ${ALGORITHM_VERSION}</div>
          <div class="display text-xl mt-1" style="color: var(--accent-soft);">🎯 출력 vs 전달 분리 진단</div>
        </div>
        <div class="text-right">
          <div class="display text-base" style="color: ${qColor}; font-weight: 700;">${qLabel}</div>
          <div class="text-xs mono uppercase mt-1" style="color: var(--text-muted);">우선순위: ${qPriority}</div>
        </div>
      </div>
      <div class="text-sm leading-relaxed mb-3 p-3 rounded" style="background: var(--bg-elevated); border-left: 3px solid ${qColor};">
        ${qMessage}
      </div>
      <div class="grid md:grid-cols-2 gap-3 items-center">
        <div>${svgQuadrant}</div>
        <div>
          <table class="var-table" style="font-size: 12px;">
            <thead><tr><th>카테고리</th><th>점수</th><th>측정</th></tr></thead>
            <tbody>
              <tr><td>출력 (Output)</td><td><strong style="color: ${outScore >= 50 ? '#16a34a' : '#fb923c'};">${outScore}</strong></td><td class="mono">${result.catScores.OUTPUT.measured}/${result.catScores.OUTPUT.total}</td></tr>
              <tr><td>전달 (Transfer)</td><td><strong style="color: ${trScore >= 50 ? '#16a34a' : '#fb923c'};">${trScore}</strong></td><td class="mono">${result.catScores.TRANSFER.measured}/${result.catScores.TRANSFER.total}</td></tr>
              <tr><td>부상 위험 (Injury 안전도)</td><td><strong style="color: ${(injScore || 0) >= 50 ? '#16a34a' : '#dc2626'};">${injScore != null ? injScore : '—'}</strong></td><td class="mono">${result.catScores.INJURY?.measured || 0}/${result.catScores.INJURY?.total || 0}</td></tr>
            </tbody>
          </table>
          <div class="text-xs mt-3" style="color: var(--text-muted); line-height: 1.6;">
            <strong>해석:</strong> X축=출력(절대 회전속도·GRF), Y축=전달(시퀀싱·증폭률). 점 색상=부상 위험 (<span style="color: #16a34a;">●</span>안전 / <span style="color: #fb923c;">●</span>주의 / <span style="color: #dc2626;">●</span>위험).
          </div>
        </div>
      </div>
    </div>`;
  }

  // ── 3. 키네틱 체인 6단계 ──
  function _renderKineticChainStages(result) {
    const m = result.varScores || {};
    const v = (k) => m[k]?.value;
    const s = (k) => m[k]?.score;
    const stages = [
      { n: 1, name: '하체 드라이브 (Trail Drive)',  vars: ['Trail_leg_peak_vertical_GRF', 'Trail_leg_peak_AP_GRF', 'Trail_Hip_Power_peak'], desc: '뒷다리 추진 — 지면에서 시작되는 힘' },
      { n: 2, name: '앞다리 블록 (Lead Block)',    vars: ['Lead_leg_peak_vertical_GRF', 'CoG_Decel', 'Lead_Knee_Power_peak'], desc: '앞다리 stiffness — 추진→회전 전환' },
      { n: 3, name: '분리 (Hip-Trunk Separation)',  vars: ['fc_xfactor', 'peak_xfactor', 'peak_trunk_CounterRotation'], desc: 'X-factor 분리 자세 — 회전 저장' },
      { n: 4, name: '몸통 가속 (Trunk Acceleration)', vars: ['Pelvis_peak', 'Trunk_peak', 'pelvis_to_trunk', 'pelvis_trunk_speedup'], desc: '골반→몸통 회전 가속' },
      { n: 5, name: '상지 코킹·전달 (Arm Cocking)',  vars: ['Trunk_peak', 'Arm_peak', 'trunk_to_arm', 'arm_trunk_speedup', 'mer_shoulder_abd', 'max_shoulder_ER'], desc: '몸통→팔 전달 + ER cocking' },
      { n: 6, name: '릴리스 가속 (Release)',         vars: ['Arm_peak', 'wrist_release_speed', 'angular_chain_amplification', 'br_shoulder_abd', 'br_lead_leg_knee_flexion'], desc: '팔 채찍 + 공 가속' },
    ];

    // 각 단계 평균 점수 + 누락 변수 비율
    const stageBoxes = stages.map(stg => {
      const scored = stg.vars.map(k => s(k)).filter(x => x != null);
      const avg = scored.length ? scored.reduce((a,b)=>a+b,0) / scored.length : null;
      const color = avg == null ? '#94a3b8' : avg >= 75 ? '#16a34a' : avg >= 50 ? '#0070C0' : avg >= 35 ? '#fb923c' : '#dc2626';
      const sevIcon = avg == null ? '○' : avg >= 75 ? '✓' : avg >= 50 ? '◐' : avg >= 35 ? '⚠' : '🚨';
      return `
      <div style="background: var(--bg-elevated); border: 1px solid var(--border); border-left: 4px solid ${color}; border-radius: 6px; padding: 10px 12px;">
        <div class="flex items-center gap-2 mb-1">
          <span class="mono text-xs" style="color: var(--text-muted);">단계 ${stg.n}</span>
          <span style="color: ${color}; font-size: 14px;">${sevIcon}</span>
          <strong class="text-sm" style="color: var(--text-primary);">${stg.name}</strong>
          <span class="ml-auto mono text-sm" style="color: ${color}; font-weight: 700;">${avg != null ? avg.toFixed(0) : '—'}<span style="font-size:10px; color: var(--text-muted);">/100</span></span>
        </div>
        <div class="text-xs" style="color: var(--text-muted); line-height: 1.5;">
          ${stg.desc} <span class="mono" style="margin-left:6px;">(${scored.length}/${stg.vars.length} 변수)</span>
        </div>
      </div>`;
    }).join('');

    return `
    <div class="cat-card mb-6" style="padding: 18px;">
      <div class="display text-xl mb-2" style="color: var(--transfer);">⚡ 키네틱 체인 6단계 진단</div>
      <div class="text-sm mb-3" style="color: var(--text-secondary); line-height: 1.6;">
        다리에서 시작된 힘이 골반→몸통→팔로 전달되는 흐름을 6 단계로 분리해서 진단합니다. 각 단계는 GRF·X-factor·회전속도·관절 power 등 키네틱 변수의 종합 점수입니다.
      </div>
      <div class="grid md:grid-cols-2 gap-3">${stageBoxes}</div>
    </div>`;
  }

  // ── 4. 에너지 흐름 (키네틱 변수 기반) ──
  function _renderEnergyFlowKinetic(result) {
    const m = result.varScores || {};
    const v = (k) => m[k]?.value;

    // 키네틱 흐름: GRF (Trail) → 골반 → 몸통 → 팔 → 손목 (release)
    // 가능하면 Joint Power 사용, 없으면 회전 속도(°/s) → power proxy
    const trailGRF = v('Trail_leg_peak_vertical_GRF');     // BW
    const leadGRF  = v('Lead_leg_peak_vertical_GRF');      // BW
    const trailHipP = v('Trail_Hip_Power_peak');           // W (kinetic)
    const leadHipP  = v('Lead_Hip_Power_peak');            // W
    const leadKneeP = v('Lead_Knee_Power_peak');           // W
    const pelvisPk = v('Pelvis_peak');                     // °/s
    const trunkPk  = v('Trunk_peak');                      // °/s
    const armPk    = v('Arm_peak');                        // °/s
    const shoulderP = v('Pitching_Shoulder_Power_peak');   // W (kinetic)
    const elbowP   = v('Pitching_Elbow_Power_peak');       // W (kinetic)
    const wristV   = v('wrist_release_speed');             // m/s

    // 표시할 노드 — kinetic이 있으면 우선, 없으면 kinematic
    const nodes = [
      { label: 'Trail GRF', val: trailGRF, unit: 'BW', kind: 'kinetic', tag: 'Trail leg push' },
      { label: 'Trail Hip P', val: trailHipP, unit: 'W', kind: 'kinetic', tag: '뒷다리 power' },
      { label: 'Lead GRF', val: leadGRF, unit: 'BW', kind: 'kinetic', tag: '앞다리 block' },
      { label: 'Lead Hip P', val: leadHipP, unit: 'W', kind: 'kinetic', tag: '앞다리 hip power' },
      { label: 'Lead Knee P', val: leadKneeP, unit: 'W', kind: 'kinetic', tag: '앞무릎 power' },
      { label: 'Pelvis ω', val: pelvisPk, unit: '°/s', kind: 'kinematic', tag: '골반 회전' },
      { label: 'Trunk ω', val: trunkPk, unit: '°/s', kind: 'kinematic', tag: '몸통 회전' },
      { label: 'Shoulder P', val: shoulderP, unit: 'W', kind: 'kinetic', tag: '어깨 power' },
      { label: 'Elbow P', val: elbowP, unit: 'W', kind: 'kinetic', tag: '팔꿈치 power' },
      { label: 'Arm ω', val: armPk, unit: '°/s', kind: 'kinematic', tag: '상완 IR/ER' },
      { label: 'Wrist V', val: wristV, unit: 'm/s', kind: 'kinematic', tag: '손목 release' },
    ];
    const measured = nodes.filter(n => n.val != null);
    const total = nodes.length;
    const measuredCnt = measured.length;

    // 시각화 — 노드 chain
    const arrowsHtml = measured.length > 0 ? measured.map((n, i) => {
      const color = n.kind === 'kinetic' ? '#7030A0' : '#0070C0';
      const bg = n.kind === 'kinetic' ? 'rgba(112,48,160,0.08)' : 'rgba(0,112,192,0.08)';
      const arrow = i < measured.length - 1 ? '<span style="color: var(--text-muted); margin: 0 4px;">→</span>' : '';
      return `<span style="display: inline-block; padding: 6px 10px; background: ${bg}; border: 1px solid ${color}40; border-left: 3px solid ${color}; border-radius: 4px; margin: 3px 0; font-size: 11px;">
        <div style="color: var(--text-muted); font-size: 9px; text-transform: uppercase;">${n.tag}</div>
        <strong>${n.label}</strong>
        <span class="mono" style="color: ${color}; margin-left: 4px;">${typeof n.val === 'number' ? n.val.toFixed(n.unit === 'BW' ? 2 : (Math.abs(n.val) >= 100 ? 0 : 1)) : '—'}<span style="font-size: 9px; opacity: 0.7;">${n.unit}</span></strong>
      </span>${arrow}`;
    }).join('') : '<div class="text-sm" style="color: var(--text-muted);">키네틱 변수 미측정 — Visual3D pipeline (inverse dynamics) 적용된 c3d.txt 필요</div>';

    const kineticOnly = measured.filter(n => n.kind === 'kinetic').length;
    const kinematicOnly = measured.filter(n => n.kind === 'kinematic').length;

    return `
    <div class="cat-card mb-6" style="padding: 18px; border-left: 4px solid var(--leak);">
      <div class="display text-xl mb-2" style="color: var(--leak);">🔗 에너지 흐름 — 키네틱 기반</div>
      <div class="text-sm mb-3" style="color: var(--text-secondary); line-height: 1.6;">
        지면에서 손목까지 에너지의 흐름을 <strong>관절 Power(키네틱)</strong> + 회전 속도(키네매틱) 기반으로 시각화합니다. <span style="color: var(--leak);">●</span> 보라색=Joint Power (Tier 2 inverse dynamics), <span style="color: var(--transfer);">●</span> 파란색=각속도/속도.
      </div>
      <div class="text-xs mb-3 mono" style="color: var(--text-muted);">
        측정 ${measuredCnt}/${total} 노드 · 키네틱 ${kineticOnly}, 키네매틱 ${kinematicOnly}
      </div>
      <div style="line-height: 2.4;">${arrowsHtml}</div>
    </div>`;
  }

  // ── 5. 카테고리 카드 5개 ──
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

  // ── 6. GRF 분석 섹션 ──
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
  function _renderKineticsSection(result) {
    const m = result.varScores || {};
    const items = [
      { key: 'Trail_Hip_Power_peak',     label: 'Trail Hip Power',     stage: '단계 1' },
      { key: 'Lead_Hip_Power_peak',      label: 'Lead Hip Power',      stage: '단계 1·2' },
      { key: 'Lead_Knee_Power_peak',     label: 'Lead Knee Power',     stage: '단계 2' },
      { key: 'Pitching_Shoulder_Power_peak', label: '★ Shoulder Power',  stage: '단계 5' },
      { key: 'Pitching_Elbow_Power_peak', label: '★ Elbow Power',      stage: '단계 5·6' },
    ];
    const measured = items.filter(it => m[it.key]?.value != null);
    if (measured.length === 0) {
      return `
      <div class="cat-card mb-6" style="padding: 18px; border-left: 4px solid #6b7280;">
        <div class="display text-xl mb-2" style="color: #6b7280;">⚙️ Kinetics (관절 Power·Energy·Torque)</div>
        <div class="text-sm" style="color: var(--text-muted);">
          관절 power 데이터 없음 — Visual3D pipeline의 <strong>Joint Power</strong> (Tier 2 inverse dynamics) 적용된 c3d.txt 필요.<br>
          기대 변수: <code class="mono text-xs">Trail_Hip_Power.Z, Lead_Hip_Power.Z, Lead_Knee_Power.Z, Pitching_Shoulder_Power.Z, Pitching_Elbow_Power.Z</code>
        </div>
      </div>`;
    }

    // Joint Power 막대 차트
    const W = 480, H = 240, P = 40;
    const maxP = Math.max(...measured.map(it => Math.abs(m[it.key].value)), 100);
    const barW = (W - 2 * P) / measured.length * 0.6;
    const xStep = (W - 2 * P) / measured.length;
    const yScale = (v) => H - P - (v / maxP) * (H - 2 * P);

    const bars = measured.map((it, i) => {
      const val = m[it.key].value;
      const sc = m[it.key].score;
      const cx = P + xStep * (i + 0.5);
      const color = sc == null ? '#94a3b8' : sc >= 75 ? '#16a34a' : sc >= 50 ? '#fb923c' : '#dc2626';
      return `
        <rect x="${cx - barW/2}" y="${yScale(val)}" width="${barW}" height="${(H-P) - yScale(val)}" fill="${color}" opacity="0.75"/>
        <text x="${cx}" y="${yScale(val) - 6}" text-anchor="middle" font-size="11" font-weight="bold" fill="${color}">${val >= 1000 ? (val/1000).toFixed(1)+'k' : val.toFixed(0)}</text>
        <text x="${cx}" y="${H - 22}" text-anchor="middle" font-size="10" fill="var(--text-secondary)" font-weight="600">${it.label.replace('★ ', '')}</text>
        <text x="${cx}" y="${H - 8}" text-anchor="middle" font-size="9" fill="var(--text-muted)">${it.stage}</text>
      `;
    }).join('');

    const kineticBar = `<svg viewBox="0 0 ${W} ${H}" style="width: 100%; height: auto;">
      <line x1="${P}" y1="${H-P}" x2="${W-P}" y2="${H-P}" stroke="var(--text-muted)"/>
      <line x1="${P}" y1="${P}" x2="${P}" y2="${H-P}" stroke="var(--text-muted)"/>
      <text x="${P-4}" y="${yScale(0)+3}" text-anchor="end" font-size="9" fill="var(--text-muted)">0</text>
      <text x="${P-4}" y="${yScale(maxP)+3}" text-anchor="end" font-size="9" fill="var(--text-muted)">${maxP >= 1000 ? (maxP/1000).toFixed(1)+'k' : maxP.toFixed(0)}</text>
      <text x="${P-32}" y="${H/2}" text-anchor="middle" font-size="11" fill="var(--text-secondary)" font-weight="600" transform="rotate(-90 ${P-32} ${H/2})">Joint Power (W)</text>
      ${bars}
    </svg>`;

    const fmt = (v, u='W') => v != null ? `${v >= 1000 ? (v/1000).toFixed(2)+'k' : v.toFixed(0)} ${u}` : '—';
    const scoreColor = (sc) => sc == null ? '#94a3b8' : sc >= 75 ? '#16a34a' : sc >= 50 ? '#fb923c' : '#dc2626';

    return `
    <div class="cat-card mb-6" style="padding: 18px; border-left: 4px solid var(--leak);">
      <div class="display text-xl mb-2" style="color: var(--leak);">⚙️ Kinetics — 관절 Power·Energy·Torque</div>
      <div class="text-sm mb-3" style="color: var(--text-secondary); line-height: 1.6;">
        <strong>Inverse Dynamics</strong>로 산출한 관절별 <strong>Power peak</strong> — 각 분절이 만드는 진짜 출력 (단순 회전속도가 아닌 토크×각속도).
        에너지가 단계별로 어떻게 만들어지고 전달되는지 보여주는 <em>가장 직접적인 키네틱 지표</em>입니다.
      </div>
      <div>${kineticBar}</div>
      <table class="var-table mt-3" style="font-size: 12px;">
        <thead><tr><th>관절</th><th>단계</th><th>Peak Power</th><th>점수</th><th>역할</th></tr></thead>
        <tbody>
          ${measured.map(it => {
            const val = m[it.key].value;
            const sc = m[it.key].score;
            const role = {
              'Trail_Hip_Power_peak': '뒷다리 신전 → 골반 회전 추진',
              'Lead_Hip_Power_peak': '앞다리 hip — 추진→회전 전환 hub',
              'Lead_Knee_Power_peak': '앞무릎 ecc/iso → block stiffness',
              'Pitching_Shoulder_Power_peak': 'GH joint → 팔 IR 가속 (★ release power)',
              'Pitching_Elbow_Power_peak': 'elbow ext + IR transfer (UCL stress)',
            }[it.key] || '—';
            return `<tr>
              <td><strong>${it.label}</strong></td>
              <td class="mono text-xs">${it.stage}</td>
              <td class="mono">${fmt(val)}</td>
              <td><strong style="color: ${scoreColor(sc)};">${sc != null ? sc : '—'}</strong></td>
              <td class="text-xs" style="color: var(--text-muted);">${role}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      <div class="text-xs mt-2" style="color: var(--text-muted); line-height: 1.5;">
        <strong>해석 가이드:</strong> Shoulder Power가 가장 높은 단일 출력 (≈1500W elite). Lead Knee Power(eccentric, 음수)는 block 강도 — 절댓값이 클수록 좋음. Elbow Power 과도(>500W)는 UCL stress 신호.
      </div>
    </div>`;
  }

  // ── 8. 결함 진단 ──
  function _renderFaultsSection(result) {
    if (!result.faults || result.faults.length === 0) {
      return `
      <div class="cat-card mb-6" style="padding: 16px; border-left: 4px solid #16a34a; background: rgba(22,163,74,0.04);">
        <div class="display text-lg" style="color: #16a34a;">✓ 검출된 결함 없음</div>
        <div class="text-sm mt-1" style="color: var(--text-secondary);">코호트 평균 임계 기준으로 키네틱 결함이 검출되지 않았습니다.</div>
      </div>`;
    }
    const sevColor = { high: '#dc2626', medium: '#fb923c', low: '#94a3b8' };
    const sevLabel = { high: '⚠️ 높음', medium: '⚡ 중간', low: 'ℹ 낮음' };
    const sevOrder = { high: 0, medium: 1, low: 2 };
    const sorted = [...result.faults].sort((a,b) => sevOrder[a.severity] - sevOrder[b.severity]);
    return `
    <div class="cat-card mb-6" style="padding: 18px; border-left: 4px solid var(--bad);">
      <div class="display text-xl mb-2" style="color: var(--bad);">🔬 결함 진단 — 코칭 우선순위</div>
      <div class="text-sm mb-3" style="color: var(--text-secondary);">
        ${sorted.length}개 결함 검출. 심각도 순서로 정렬했습니다.
      </div>
      ${sorted.map(f => {
        const c = sevColor[f.severity] || '#888';
        return `<div style="background: var(--bg-elevated); padding: 12px 14px; margin-bottom: 8px; border-radius: 6px; border-left: 4px solid ${c};">
          <div class="flex items-center gap-2 mb-1 flex-wrap">
            <span class="mono text-xs" style="background: ${c}22; color: ${c}; padding: 2px 8px; border-radius: 3px; font-weight: 600;">${sevLabel[f.severity] || f.severity}</span>
            <strong style="color: ${c};">${f.label}</strong>
          </div>
          <div class="text-xs mt-1" style="color: var(--text-secondary);"><strong>원인:</strong> ${f.cause}</div>
          <div class="text-xs mt-1" style="color: var(--text-secondary);"><strong>코칭:</strong> ${f.coaching}</div>
        </div>`;
      }).join('')}
    </div>`;
  }

  // ── 9. 종합 평가 ──
  function _renderSummaryNarrative(result) {
    const cats = result.catScores || {};
    const out = cats.OUTPUT?.score, tr = cats.TRANSFER?.score, lk = cats.LEAK?.score;
    const ctrl = cats.CONTROL?.score, inj = cats.INJURY?.score;
    const ballSp = result.varScores?.ball_speed?.value;
    const name = result._meta?.athlete || '신규 선수';
    const level = result._meta?.level || '';

    // 강점·약점
    const allScores = [
      { name: '출력', score: out, color: '#C00000' },
      { name: '전달', score: tr, color: '#0070C0' },
      { name: '누수', score: lk, color: '#7030A0' },
      { name: '제구', score: ctrl, color: '#2E7D32' },
      { name: '부상 안전도', score: inj, color: '#FF8C00' },
    ].filter(c => c.score != null);
    const strengths = allScores.filter(c => c.score >= 70).sort((a,b)=>b.score-a.score);
    const weaknesses = allScores.filter(c => c.score < 50).sort((a,b)=>a.score-b.score);

    let narrative = `<strong>${name}</strong>${level ? ' (' + level + ')' : ''} — `;
    if (ballSp) narrative += `평균 구속 <strong>${ballSp.toFixed(1)} km/h</strong>. `;
    if (strengths.length > 0) {
      narrative += `<span style="color: #16a34a;">강점: ${strengths.map(s => `${s.name}(${s.score})`).join(', ')}</span>. `;
    }
    if (weaknesses.length > 0) {
      narrative += `<span style="color: #dc2626;">우선 개선: ${weaknesses.map(s => `${s.name}(${s.score})`).join(', ')}</span>. `;
    }
    if (out != null && tr != null) {
      if (out >= 50 && tr < 50) narrative += '출력은 만들어지지만 전달 효율이 낮음 — 메카닉 코칭 우선이 가장 큰 수익.';
      else if (out < 50 && tr >= 50) narrative += '메카닉(전달)은 좋으나 출력 자체 부족 — 체력·파워 강화로 raw output 끌어올리기.';
      else if (out >= 50 && tr >= 50) narrative += 'Elite 영역 (① 사분면). 현 상태 유지 + 부상 모니터링.';
      else narrative += '출력·전달 모두 발달 단계 — 기초부터 단계별 향상.';
    }

    return `
    <div class="cat-card mt-6" style="padding: 18px; background: linear-gradient(135deg, rgba(31,56,100,0.05), rgba(46,117,182,0.03)); border: 1px solid var(--border);">
      <div class="display text-xl mb-3" style="color: var(--accent);">📋 종합 평가</div>
      <div class="text-sm leading-relaxed" style="color: var(--text-primary);">${narrative}</div>
      <div class="grid grid-cols-2 md:grid-cols-5 gap-2 mt-4">
        ${allScores.map(c => {
          const color = c.score >= 75 ? '#16a34a' : c.score >= 50 ? '#fb923c' : '#dc2626';
          return `<div style="background: var(--bg-elevated); padding: 10px; border-radius: 6px; text-align: center; border-top: 3px solid ${c.color};">
            <div class="text-xs" style="color: var(--text-muted);">${c.name}</div>
            <div class="display text-2xl" style="color: ${color}; font-weight: 700;">${c.score}</div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
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

  // Mode 토글
  function setMode(m) { CURRENT_MODE = m; }
  function getMode() { return CURRENT_MODE; }
  function setPlayer(p) { Object.assign(CURRENT_PLAYER, p); }
  function getLastResult() { return LAST_RESULT; }
  function setFitnessData(fitness, meta) {
    CURRENT_FITNESS = fitness || null;
    CURRENT_FITNESS_META = meta || null;
  }
  function getFitnessData() { return CURRENT_FITNESS; }
  function getFitnessMeta() { return CURRENT_FITNESS_META; }

  // Expose
  window.TheiaApp = {
    ALGORITHM_VERSION,
    parseC3dTxt, extractScalars, aggregateTrials, calculateScores,
    processFiles, renderReport,
    setMode, getMode, setPlayer, getLastResult,
    setFitnessData, getFitnessData, getFitnessMeta,
  };
})();
