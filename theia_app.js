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

  const ALGORITHM_VERSION = 'v0.6';
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
  // 리포트 v0.5 — BBL Uplift 스타일 풀 컴포넌트
  //   1. Header (4 잠재구속 카드 + Mode 배지)
  //   2. 3-column radar (체력 / 메카닉 6각 / 제구)
  //   3. 출력 vs 전달 4사분면 진단
  //   4. 코칭 세션 — 마네킹 에너지 흐름
  //   5. 키네매틱 시퀀스 — 종형 곡선
  //   6. 키네틱 체인 6단계 진단
  //   7. 에너지 흐름 — 키네틱 변수 기반
  //   8. GRF 섹션
  //   9. Kinetics (Joint Power) 섹션
  //  10. 결함 + drill
  //  11. 종합 평가 (강점·약점 + 훈련 추천)
  // ════════════════════════════════════════════════════════════
  function renderReport(result) {
    const html = [
      _renderHeader(result),
      _render3ColumnRadars(result),
      _renderQuadrantDiagnosis(result),
      _renderMannequinUplift(result),       // ★ v0.6 — BBL Uplift dynamic SVG + GRF·Power·Torque 통합
      _renderKinematicBellUplift(result),    // ★ v0.6 — BBL Uplift dynamic 종형 곡선
      _renderKineticChainStages(result),
      _renderGRFSection(result),
      _renderFaultsWithDrills(result),
      _renderSummaryWithTraining(result),
    ].join('\n');
    setTimeout(() => _initRadarCharts(result), 100);
    return html;
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

  // ── 1. Header (BBL Uplift 스타일 — 4 잠재구속 카드 + Mode 배지) ──
  function _renderHeader(result) {
    const TC = window.TheiaCohort;
    const m = TC.getMode(result._mode);
    const ballSp = result.varScores?.ball_speed?.value;
    const hand = result._meta?.handedness || (CURRENT_PLAYER.handedness) || 'right';
    const handLabel = hand === 'left' ? '좌투' : '우투';
    const level = result._meta?.level || '';
    const date = (typeof CURRENT_FITNESS_META === 'object' && CURRENT_FITNESS_META?.date) || '';
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

  // ── 결함별 drill 추천 매핑 ──
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

  // ════════════════════════════════════════════════════════════
  // 추가 컴포넌트 — 3-col radar / 마네킹 / 종형곡선 / 결함 drill / 훈련 추천
  // ════════════════════════════════════════════════════════════

  // ── 2. 3-column radar (체력 / 메카닉 6각 / 제구) ──
  function _render3ColumnRadars(result) {
    const cats = result.catScores || {};

    // 체력 (fitness 데이터 있으면 표시 — 4 dim)
    const fitness = CURRENT_FITNESS || {};
    const fitDims = [
      { label: '체중당 근력', val: _fitnessScore(fitness.imtp_peak_force_bm, 25, 35), raw: fitness.imtp_peak_force_bm, unit: 'N/kg', desc: '체중 정규화 최대 근력' },
      { label: '체중당 파워', val: _fitnessScore(fitness.cmj_peak_power_bm, 50, 70), raw: fitness.cmj_peak_power_bm, unit: 'W/kg', desc: '체중 정규화 폭발력' },
      { label: '반응성 (SSC)', val: _fitnessScore(fitness.cmj_rsi_modified, 0.5, 1.0), raw: fitness.cmj_rsi_modified, unit: 'm/s', desc: '신장단축주기 효율' },
      { label: '체격 (BMI)',   val: fitness.bmi != null ? _bmiScore(fitness.bmi) : null, raw: fitness.bmi, unit: '', desc: '신체 구성 (BMI 기반)' },
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

    const renderColumn = (title, color, score, dims, measured, total, canvasId, gradeText) => {
      const detailRows = dims.map(d => {
        const c = colorScore(d.val);
        const sc = d.val == null ? '—' : d.val + '점';
        const grade = d.val == null ? '미측정' : d.val >= 80 ? '최상위' : d.val >= 70 ? '우수' : d.val >= 50 ? '상위 평균' : '평균 수준 — 발달 여지 큼';
        return `<div style="background: var(--bg-elevated); padding: 10px 12px; border-radius: 6px; margin-bottom: 6px; border-left: 3px solid ${color};">
          <div class="flex justify-between items-baseline">
            <strong class="text-sm">${d.label}</strong>
            <span class="mono" style="color: ${c}; font-weight: 700;">${sc}</span>
          </div>
          <div class="flex justify-between items-baseline mt-1">
            <span class="text-xs" style="color: var(--text-muted);">${d.desc || ''}</span>
            <span class="text-xs" style="color: ${c}; font-weight: 600;">${grade}</span>
          </div>
        </div>`;
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
    return [
      { label: '하체 추진',          val: _avg(['Trail_leg_peak_vertical_GRF', 'Trail_leg_peak_AP_GRF', 'Trail_Hip_Power_peak', 'Pelvis_peak']), desc: '뒷다리로 강하게 밀어 추진력 만들기 (KH→FC)' },
      { label: '앞다리 버팀 (Block)', val: _avg(['Lead_leg_peak_vertical_GRF', 'CoG_Decel', 'Lead_Knee_Power_peak', 'br_lead_leg_knee_flexion', 'lead_knee_ext_change_fc_to_br']), desc: 'FC→BR 무릎 무너짐 여부 — 각도 유지가 핵심' },
      { label: '몸통 에너지 로딩',    val: _avg(['fc_xfactor', 'peak_xfactor', 'peak_trunk_CounterRotation']), desc: '꼬임·닫힘·기울기·골반속도·lag으로 트렁크 에너지 저장·전달' },
      { label: '몸통 에너지 발현',    val: _avg(['Pelvis_peak', 'Trunk_peak', 'pelvis_to_trunk', 'pelvis_trunk_speedup']), desc: '몸통 회전·굴곡 속도로 에너지 발현 (FC→MER→BR)' },
      { label: '팔 에너지',           val: _avg(['Arm_peak', 'trunk_to_arm', 'arm_trunk_speedup', 'mer_shoulder_abd', 'max_shoulder_ER', 'Pitching_Shoulder_Power_peak']), desc: '레이백·전달율·lag·어깨 IR 속도 통합 평가' },
      { label: '릴리스',             val: _avg(['wrist_release_speed', 'angular_chain_amplification', 'br_shoulder_abd', 'Pitching_Elbow_Power_peak']), desc: '손목 릴리스·전체 증폭·UCL stress' },
    ];
  }

  // 제구 6축 — P1~P6
  function _compute6axisCtrl(result) {
    const m = result.varScores || {};
    return [
      { label: '릴리스 점 일관성 (3D)', val: m.P1_wrist_3D_SD?.score, desc: '손목 X·Y·Z 결합 SD' },
      { label: '팔 슬롯 안정성',        val: m.P2_arm_slot_SD?.score, desc: '팔 각도 일관성' },
      { label: '릴리스 높이 안정성',    val: m.P3_release_height_SD?.score, desc: '수직 위치만 (Y SD)' },
      { label: '타이밍 일관성',         val: m.P4_mer_to_br_SD?.score, desc: '운동사슬 타이밍 안정성' },
      { label: '스트라이드 일관성',     val: m.P5_stride_SD?.score, desc: '발 위치 일관성' },
      { label: '몸통 자세 일관성',      val: m.P6_trunk_tilt_SD?.score, desc: '몸통 기울기 안정성' },
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
      { label: '체중당 근력', val: _fitnessScore(CURRENT_FITNESS?.imtp_peak_force_bm, 25, 35) },
      { label: '체중당 파워', val: _fitnessScore(CURRENT_FITNESS?.cmj_peak_power_bm, 50, 70) },
      { label: '반응성 (SSC)', val: _fitnessScore(CURRENT_FITNESS?.cmj_rsi_modified, 0.5, 1.0) },
      { label: '체격 (BMI)',   val: CURRENT_FITNESS?.bmi != null ? _bmiScore(CURRENT_FITNESS.bmi) : null },
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

    return `
    <div class="cat-card mb-6" style="padding: 16px; background: #0b1220; border: 1px solid #1e293b;">
      <div class="display text-xl mb-1" style="color: #fb923c;">⚡ 키네틱 체인 — 에너지 흐름 (파워 기반)</div>
      <div class="text-xs mb-2" style="color: #64748b;">
        Trail GRF → Trail Hip P → Pelvis ω → Trunk ω → Shoulder P → Elbow P → 공
        — 색상은 분절별 코호트 percentile 점수, 라벨은 절대값 (W·BW·°/s).
      </div>
      <details class="mb-2 text-xs" style="background: #0b1f3a; padding: 6px 10px; border-radius: 4px; border-left: 2px solid #60a5fa;">
        <summary class="cursor-pointer" style="color: #93c5fd; font-weight: 600;">📖 어떻게 읽나요? (코치용 가이드)</summary>
        <div class="mt-2 leading-relaxed" style="color: #cbd5e1;">
          <strong style="color: #22d3ee;">에너지 흐름 — 키네틱 기반</strong>: 발에서 시작한 추진력이 무릎·골반·몸통·어깨·팔꿈치를 거쳐 손목으로 전달되는 power 사슬. 각 분절은 <strong>Joint Power(W)</strong>로 평가되며, 어디서 power 손실이 발생하는지 시각화합니다.<br><br>
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

  // ── 4. (legacy) 마네킹 에너지 흐름 (SVG) — v0.6에서 _renderMannequinUplift로 대체 ──
  function _renderMannequinEnergyFlow(result) {
    const m = result.varScores || {};
    // 분절별 코호트 percentile 색상 — green/orange/red
    const segColor = (sc) => sc == null ? '#94a3b8' : sc >= 70 ? '#22d3ee' : sc >= 50 ? '#3b82f6' : sc >= 35 ? '#fbbf24' : '#dc2626';
    const trailLeg = m.Trail_leg_peak_vertical_GRF?.score ?? m.Trail_Hip_Power_peak?.score;
    const leadLeg  = m.Lead_leg_peak_vertical_GRF?.score ?? m.Lead_Knee_Power_peak?.score;
    const pelvis   = m.Pelvis_peak?.score;
    const trunk    = m.Trunk_peak?.score;
    const shoulder = m.Pitching_Shoulder_Power_peak?.score ?? m.Arm_peak?.score;
    const elbow    = m.Pitching_Elbow_Power_peak?.score ?? m.max_shoulder_ER?.score;
    const wrist    = m.wrist_release_speed?.score ?? m.angular_chain_amplification?.score;

    // 결함 검출 — kinetic chain 정상/비정상
    const faultStages = (result.faults || []).map(f => f.label);
    const allOk = faultStages.length === 0;

    // 단순화된 마네킹 — 우투 throwing pose
    const mannequinSvg = `<svg viewBox="0 0 600 480" style="width: 100%; max-height: 480px;">
      <defs>
        <radialGradient id="bg" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stop-color="#0a1424" stop-opacity="1"/>
          <stop offset="100%" stop-color="#000" stop-opacity="0.95"/>
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="600" height="480" fill="url(#bg)" rx="6"/>
      <!-- 지면 -->
      <line x1="40" y1="430" x2="560" y2="430" stroke="#475569" stroke-dasharray="4 4" stroke-width="1"/>
      <!-- 머리 -->
      <circle cx="300" cy="120" r="22" fill="#cbd5e1" stroke="#94a3b8" stroke-width="1.5"/>
      <!-- 몸통 — color = trunk -->
      <path d="M 280,140 L 320,140 L 330,260 L 270,260 Z" fill="${segColor(trunk)}" stroke="#475569" stroke-width="2" opacity="0.85"/>
      <!-- 골반 — pelvis -->
      <path d="M 270,260 L 330,260 L 340,300 L 260,300 Z" fill="${segColor(pelvis)}" stroke="#475569" stroke-width="2" opacity="0.85"/>
      <!-- 좌측 (글러브) 어깨·팔 -->
      <line x1="280" y1="155" x2="245" y2="200" stroke="#cbd5e1" stroke-width="14" stroke-linecap="round"/>
      <line x1="245" y1="200" x2="225" y2="245" stroke="#94a3b8" stroke-width="11" stroke-linecap="round"/>
      <!-- 우측 (피칭) 어깨·상완·전완 — 색상 적용 -->
      <line x1="320" y1="155" x2="400" y2="195" stroke="${segColor(shoulder)}" stroke-width="14" stroke-linecap="round"/>
      <text x="395" y="190" font-size="9" fill="${segColor(shoulder)}" font-weight="700">SHOULDER</text>
      <line x1="400" y1="195" x2="480" y2="160" stroke="${segColor(elbow)}" stroke-width="11" stroke-linecap="round"/>
      <circle cx="400" cy="195" r="6" fill="${segColor(elbow)}" stroke="white" stroke-width="1.5"/>
      <text x="404" y="178" font-size="9" fill="${segColor(elbow)}" font-weight="700">ELBOW</text>
      <!-- 손목·공 -->
      <circle cx="480" cy="160" r="8" fill="${segColor(wrist)}" stroke="white" stroke-width="2"/>
      <text x="488" y="158" font-size="9" fill="${segColor(wrist)}" font-weight="700">WRIST</text>
      <!-- 우측 다리 (Trail, 뒷다리) -->
      <line x1="290" y1="300" x2="240" y2="380" stroke="${segColor(trailLeg)}" stroke-width="16" stroke-linecap="round"/>
      <line x1="240" y1="380" x2="220" y2="425" stroke="${segColor(trailLeg)}" stroke-width="13" stroke-linecap="round"/>
      <text x="190" y="395" font-size="10" fill="${segColor(trailLeg)}" font-weight="700">TRAIL</text>
      <!-- 좌측 다리 (Lead, 앞다리) -->
      <line x1="310" y1="300" x2="380" y2="370" stroke="${segColor(leadLeg)}" stroke-width="16" stroke-linecap="round"/>
      <line x1="380" y1="370" x2="430" y2="425" stroke="${segColor(leadLeg)}" stroke-width="13" stroke-linecap="round"/>
      <text x="430" y="395" font-size="10" fill="${segColor(leadLeg)}" font-weight="700">LEAD</text>
      <!-- 키네틱 체인 화살표 -->
      <text x="40" y="60" font-size="11" fill="#22d3ee" font-weight="600">지면 → 앞다리 → 골반 → 몸통 → 어깨 → 팔꿈치 → 손목</text>
      <!-- 상태 배지 -->
      <rect x="195" y="445" width="${allOk ? 200 : 250}" height="26" rx="13" fill="${allOk ? '#16a34a' : '#dc2626'}22" stroke="${allOk ? '#16a34a' : '#dc2626'}" stroke-width="2"/>
      <text x="${allOk ? 295 : 320}" y="463" text-anchor="middle" font-size="13" fill="${allOk ? '#16a34a' : '#dc2626'}" font-weight="700">${allOk ? '✓ 키네틱 체인 정상' : '⚠ ' + faultStages.length + '개 단계 에너지 누출'}</text>
    </svg>`;

    return `
    <div class="cat-card mb-6" style="padding: 18px; border-left: 4px solid var(--accent-soft);">
      <div class="display text-xl mb-1" style="color: var(--accent-soft);">🎬 코칭 세션 — 메카닉 시각화</div>
      <div class="text-xs mb-2" style="color: var(--text-muted);">키네틱 체인 마네킹 → 시퀀스 차트 → 동영상 순으로 데이터 → 시각 → 실제 동작을 연결해 분석합니다.</div>
      <div class="display text-lg mt-3 mb-1" style="color: var(--text-primary);">⚡ 키네틱 체인 — 에너지 흐름</div>
      <div class="text-xs mb-3" style="color: var(--text-secondary);">지면 → 앞다리 → 골반 → 몸통 → 어깨 → 팔꿈치 → 손목 순으로 에너지가 전달됩니다. 색상은 해당 분절의 코호트 백분위 점수.</div>
      <div>${mannequinSvg}</div>
      <div class="text-xs mt-2" style="color: var(--text-muted); line-height: 1.6;">
        <span style="color: #16a34a;">●</span> 정상 단계는 라벨 없음 ·
        <span style="color: #fbbf24;">●</span> 미세 누수 (발달 단계 경향) ·
        <span style="color: #dc2626;">●</span> 명확한 누수 (KINETIC_FAULTS 진단 수준) — 누수가 감지된 단계만 라벨 표시
      </div>
    </div>`;
  }

  // ── 5. 키네매틱 시퀀스 — 종형 곡선 (Pelvis/Trunk/Arm peak timing) ──
  function _renderKinematicSequenceBell(result) {
    const m = result.varScores || {};
    // 박명균 같이 lag만 있고 절대 시간 없는 경우 — pelvis=0 기준 상대 시간
    const lag1 = m.pelvis_to_trunk?.value;  // s 단위
    const lag2 = m.trunk_to_arm?.value;     // s 단위
    if (lag1 == null || lag2 == null) {
      return `
      <div class="cat-card mb-6" style="padding: 18px;">
        <div class="display text-xl mb-2">📊 키네매틱 시퀀스 — 피크 속도 타이밍</div>
        <div class="text-sm" style="color: var(--text-muted);">lag 변수 (pelvis_to_trunk, trunk_to_arm) 미산출 — 피크 검출 실패</div>
      </div>`;
    }
    const t_pelvis = 0;
    const t_trunk = Math.round(lag1 * 1000);  // ms
    const t_arm = t_trunk + Math.round(lag2 * 1000);

    // 종형 곡선 — Gaussian
    const W = 800, H = 280, P = 50;
    const x_max = Math.max(t_arm + 100, 200);
    const x_min = -100;
    const xs = (t) => P + ((t - x_min) / (x_max - x_min)) * (W - 2*P);
    const ys = (y) => H - P - y * (H - 2*P);
    const sigma = 60;  // ms
    const gauss = (t, mu) => Math.exp(-((t - mu) ** 2) / (2 * sigma * sigma));
    const path = (mu, color) => {
      let d = '';
      for (let t = x_min; t <= x_max; t += 5) {
        const y = gauss(t, mu);
        d += (d === '' ? 'M' : ' L') + xs(t) + ',' + ys(y);
      }
      return `<path d="${d}" stroke="${color}" stroke-width="3" fill="${color}22" fill-opacity="0.4"/>`;
    };

    // 이상적 lag 영역 음영 (40~60 ms)
    const idealRect1 = `<rect x="${xs(40)}" y="${P-10}" width="${xs(60) - xs(40)}" height="${H - 2*P + 20}" fill="#16a34a" opacity="0.05"/>`;
    const idealRect2 = `<rect x="${xs(t_trunk + 40)}" y="${P-10}" width="${xs(t_trunk + 60) - xs(t_trunk + 40)}" height="${H - 2*P + 20}" fill="#16a34a" opacity="0.05"/>`;

    const lag1Color = (Math.abs(t_trunk) >= 30 && Math.abs(t_trunk) <= 70) ? '#16a34a' : '#fb923c';
    const lag2Color = (Math.abs(t_arm - t_trunk) >= 30 && Math.abs(t_arm - t_trunk) <= 70) ? '#16a34a' : '#fb923c';

    return `
    <div class="cat-card mb-6" style="padding: 18px;">
      <div class="display text-xl mb-1">📊 키네매틱 시퀀스 — 피크 속도 타이밍</div>
      <div class="text-sm mb-3" style="color: var(--text-secondary);">
        골반 → 몸통 → 팔 순서로 회전 속도가 정점을 찍어야 합니다. 각 단계 사이 lag은 <strong>40~50 ms</strong>가 이상적.
      </div>
      <svg viewBox="0 0 ${W} ${H}" style="width: 100%; height: auto;">
        ${idealRect1}${idealRect2}
        ${path(t_pelvis, '#0070C0')}
        ${path(t_trunk, '#16a34a')}
        ${path(t_arm, '#fb923c')}
        <!-- peak markers -->
        <circle cx="${xs(t_pelvis)}" cy="${ys(1)}" r="8" fill="#0070C0" stroke="white" stroke-width="2"/>
        <text x="${xs(t_pelvis)}" y="${ys(1) - 14}" text-anchor="middle" font-size="13" fill="#0070C0" font-weight="700">골반 ${t_pelvis}ms</text>
        <circle cx="${xs(t_trunk)}" cy="${ys(1)}" r="8" fill="#16a34a" stroke="white" stroke-width="2"/>
        <text x="${xs(t_trunk)}" y="${ys(1) - 14}" text-anchor="middle" font-size="13" fill="#16a34a" font-weight="700">몸통 ${t_trunk}ms</text>
        <circle cx="${xs(t_arm)}" cy="${ys(1)}" r="8" fill="#fb923c" stroke="white" stroke-width="2"/>
        <text x="${xs(t_arm)}" y="${ys(1) - 14}" text-anchor="middle" font-size="13" fill="#fb923c" font-weight="700">상완 ${t_arm}ms</text>
        <!-- 축 -->
        <line x1="${xs(x_min)}" y1="${ys(0)}" x2="${xs(x_max)}" y2="${ys(0)}" stroke="#64748b"/>
        <!-- Δt 라벨 -->
        <line x1="${xs(t_pelvis)}" y1="${H-30}" x2="${xs(t_trunk)}" y2="${H-30}" stroke="${lag1Color}" stroke-width="2" marker-start="url(#arr1)" marker-end="url(#arr1)"/>
        <text x="${(xs(t_pelvis)+xs(t_trunk))/2}" y="${H-35}" text-anchor="middle" font-size="11" fill="${lag1Color}" font-weight="700">Δt 골반→몸통 ${t_trunk}ms</text>
        <line x1="${xs(t_trunk)}" y1="${H-12}" x2="${xs(t_arm)}" y2="${H-12}" stroke="${lag2Color}" stroke-width="2"/>
        <text x="${(xs(t_trunk)+xs(t_arm))/2}" y="${H-17}" text-anchor="middle" font-size="11" fill="${lag2Color}" font-weight="700">Δt 몸통→상완 ${t_arm - t_trunk}ms</text>
        <!-- y label -->
        <text x="${P + 4}" y="${P + 14}" font-size="10" fill="var(--text-muted)">↑ 정규화 회전 속도 (이상 lag 30~60 ms 영역 음영)</text>
      </svg>
    </div>`;
  }

  // ── 10. 결함 + drill ──
  function _renderFaultsWithDrills(result) {
    if (!result.faults || result.faults.length === 0) {
      return `
      <div class="cat-card mb-6" style="padding: 16px; border-left: 4px solid #16a34a; background: rgba(22,163,74,0.04);">
        <div class="display text-lg" style="color: #16a34a;">✓ 검출된 결함 없음</div>
        <div class="text-sm mt-1" style="color: var(--text-secondary);">코호트 평균 임계 기준으로 키네틱 결함이 검출되지 않았습니다.</div>
      </div>`;
    }
    const STAGE_NAMES = { 1: '하체 드라이브', 2: '앞다리 블록', 3: '분리 형성', 4: '트렁크 가속', 5: '상지 코킹·전달', 6: '릴리스 가속' };
    const STAGE_OF_FAULT = {
      WeakTrailDrive: 1, WeakLeadBlock: 2, FlyingOpen: 3, LateTrunkRotation: 4,
      PoorSpeedupChain: 4, LeadKneeCollapse: 2, ExcessForwardTilt: 5, PoorBlock: 2,
      MERShoulderRisk: 6, HighElbowValgus: 6, PoorReleaseConsistency: 6,
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

    // 단계별 요약 박스
    const stageRows = [1,2,3,4,5,6].map(s => {
      const sev = stageMaxSev[s];
      const c = sevColor[sev];
      const fs = stageFaults[s];
      const desc = fs.length > 0 ? fs.map(f => f.label.replace(/\([^)]*\)/, '').trim()).join(', ') : '결함 없음';
      return `<div class="flex items-center gap-2 py-1.5" style="border-bottom: 1px dashed var(--border);">
        <span style="width: 22px; text-align: center; font-size: 13px; color: ${c};">${sevIcon[sev]}</span>
        <span class="mono text-xs" style="width: 36px; color: var(--text-muted);">단계 ${s}</span>
        <strong class="text-sm" style="width: 130px; color: ${c};">${STAGE_NAMES[s]}</strong>
        <span class="text-xs" style="color: ${c}; font-weight: 600; width: 80px;">${sevText[sev]}</span>
        <span class="text-xs" style="color: var(--text-secondary); flex: 1;">${desc}</span>
      </div>`;
    }).join('');

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

    return `
    <div class="cat-card mb-6" style="padding: 18px; border: 2px solid ${summaryColor}; background: ${summaryColor}08;">
      <div class="display text-xl mb-2" style="color: ${summaryColor};">⚡ 3단계 · 당신의 에너지 흐름</div>
      <div class="text-sm mb-3" style="color: ${summaryColor}; font-weight: 600;">${summaryMsg}</div>
      <div>${stageRows}</div>
    </div>
    <div class="cat-card mb-6" style="padding: 18px; border: 2px solid ${summaryColor}; background: ${summaryColor}05;">
      <div class="display text-xl mb-2" style="color: ${summaryColor};">🔬 4단계 · 에너지 리크의 원인</div>
      <div class="text-sm mb-3" style="color: var(--text-secondary);">위에서 감지된 ${totalLeak}개 단계의 에너지 누출 원인을 변인별로 분석합니다.</div>
      ${faultDetailCards}
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
    // 체력 — fitness 변수 (CURRENT_FITNESS)
    const fitness = CURRENT_FITNESS || {};
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

    return `
    <div class="cat-card mt-6" style="padding: 22px;">
      <div class="display text-2xl mb-4">📋 종합 평가 (선수·코치용 해설)</div>
      <div class="grid md:grid-cols-2 gap-4">
        <div class="p-4" style="background: var(--bg-elevated); border-left: 4px solid #16a34a; border-radius: 6px;">
          <div class="display text-base mb-3" style="color: #16a34a;">⭐ 강점 (75점 이상, 영역별)</div>
          ${renderList(strengths, true)}
        </div>
        <div class="p-4" style="background: var(--bg-elevated); border-left: 4px solid #dc2626; border-radius: 6px;">
          <div class="display text-base mb-3" style="color: #dc2626;">🔧 약점 (35점 이하, 영역별)</div>
          ${renderList(weaknesses, false)}
        </div>
      </div>
      ${trainingHtml}
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
