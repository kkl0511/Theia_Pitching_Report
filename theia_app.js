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

  const ALGORITHM_VERSION = 'v0.1';
  let CURRENT_MODE = 'hs_top10';  // 'hs_top10' or 'pro'
  let CURRENT_PLAYER = { mass_kg: null, height_cm: null, name: null, handedness: null };
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

    // 컬럼 인덱스 매핑 — header[i] + component[i] → col index
    // 같은 header가 X·Y·Z 3컬럼이면 각각 별도 인덱스
    const columnIndex = {};
    for (let i = 0; i < header.length; i++) {
      const h = (header[i] || '').trim();
      const c = (component[i] || '').trim();
      if (!h || h === 'FRAMES' || h === 'TIME') continue;
      const key = c && c !== '0' ? `${h}.${c}` : h;
      if (!columnIndex[key]) columnIndex[key] = i;
    }
    // FRAMES, TIME 특수 매핑
    columnIndex['FRAMES'] = header.findIndex(h => h === 'FRAMES');
    columnIndex['TIME_abs'] = header.findIndex((h, i) => h === 'TIME' && i === columnIndex['FRAMES'] + 1);
    columnIndex['TIME_rel'] = header.findIndex((h, i) => h === 'TIME' && i > columnIndex['TIME_abs']);
    if (columnIndex['TIME_rel'] === -1) columnIndex['TIME_rel'] = columnIndex['TIME_abs'] + 1;

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

    // 이벤트 시간 (row 0의 EVENT_LABEL 컬럼들)
    const events = {};
    if (kinematic.length > 0) {
      const r0 = kinematic[0];
      const evNames = {
        'KH': 'MaxKneeHeight',
        'FS': 'Footstrike',
        'MER': 'Max_External_Rotation',
        'MER_alt': 'Max_Shoulder_Int_Rot',  // 옛 명칭 호환
        'BR': 'Ball_Release',
        'BR100ms': 'Ball_Release_Plus_100ms',
      };
      for (const [k, h] of Object.entries(evNames)) {
        const idx = columnIndex[h];
        if (idx != null) events[k] = safeNum(r0[idx]);
      }
      // MER 명칭 호환 — 정정된 이름 우선, fallback to 옛 이름
      if (events.MER == null && events.MER_alt != null) events.MER = events.MER_alt;
      delete events.MER_alt;
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

  function renderReport(result) {
    const TM = window.TheiaMeta;
    const TC = window.TheiaCohort;
    const m = TC.getMode(result._mode);

    let html = `<div class="report-header">
      <h1>Theia Pitching Report ${ALGORITHM_VERSION}</h1>
      <div class="meta">
        <span class="mode ${result._mode}">${m.label}</span>
        <span>대상: ${m.target}</span>
        <span>Reference: n=${m.n}</span>
      </div>
      <div class="player-meta">
        <strong>${result._meta.athlete || 'Unknown'}</strong> ·
        Trial 수: ${result._n_trials} ·
        Mass: ${result._meta.mass_kg || '—'}kg, Height: ${result._meta.height_cm || '—'}cm
      </div>
    </div>`;

    // 카테고리 카드 5개
    html += '<div class="categories">';
    for (const catId of ['OUTPUT', 'TRANSFER', 'LEAK', 'CONTROL', 'INJURY']) {
      const c = result.catScores[catId];
      if (!c) continue;
      const scoreColor = c.score == null ? '#888' : c.score >= 75 ? '#00B050' : c.score >= 50 ? '#FFA500' : '#C00000';
      html += `<div class="cat-card" style="border-left: 6px solid ${c.color}">
        <div class="cat-header">
          <h3>${c.name}</h3>
          <div class="cat-score" style="color:${scoreColor}">${c.score != null ? c.score : '—'}<span>/100</span></div>
        </div>
        <p class="cat-desc">${c.desc}</p>
        <div class="cat-stats">측정: ${c.measured}/${c.total} 변수</div>
        ${c.integrationValue != null ? `<div class="cat-integration">★ 통합 지표 ${TM.getVarMeta(c.integrationVar)?.name || c.integrationVar}: <strong>${formatVal(c.integrationValue, TM.getVarMeta(c.integrationVar)?.unit)}</strong> (${c.integrationScore || '—'}점)</div>` : ''}
        <details><summary>변수별 상세 (${c.measured}개)</summary>${renderVarDetail(result, TM.OTL_CATEGORIES[catId].variables)}</details>
      </div>`;
    }
    html += '</div>';

    // KINETIC_FAULTS
    if (result.faults.length > 0) {
      html += '<div class="faults"><h2>⚠ 검출된 결함 — 코칭 우선순위</h2>';
      for (const f of result.faults) {
        const sevColor = f.severity === 'high' ? '#C00000' : f.severity === 'medium' ? '#FFA500' : '#888';
        html += `<div class="fault-card" style="border-left: 4px solid ${sevColor}">
          <div class="fault-header"><strong>${f.label}</strong> <span class="sev">[${f.severity}]</span></div>
          <div class="fault-cause"><b>원인:</b> ${f.cause}</div>
          <div class="fault-coach"><b>코칭:</b> ${f.coaching}</div>
        </div>`;
      }
      html += '</div>';
    }

    return html;
  }

  function renderVarDetail(result, varNames) {
    const TM = window.TheiaMeta;
    let html = '<table class="var-table"><thead><tr><th>변수</th><th>값</th><th>점수</th><th>의미</th></tr></thead><tbody>';
    for (const v of varNames) {
      const vs = result.varScores[v];
      const meta = TM.getVarMeta(v);
      if (!meta) continue;
      const valStr = vs ? formatVal(vs.value, meta.unit) : '<span class="na">—</span>';
      const scoreStr = vs ? `<span class="score-${vs.score >= 75 ? 'good' : vs.score >= 50 ? 'mid' : 'low'}">${vs.score}</span>` : '<span class="na">—</span>';
      html += `<tr><td><strong>${meta.name}</strong></td><td>${valStr}</td><td>${scoreStr}</td><td><small>${meta.hint || ''}</small></td></tr>`;
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

    if (!files || files.length === 0) throw new Error('파일이 없습니다');
    if (!mass_kg || !height_cm) throw new Error('Mass·Height 입력 필수');

    const trials = [];
    for (const file of files) {
      const text = await file.text();
      try {
        const parsed = parseC3dTxt(text);
        const scalars = extractScalars(parsed, mass_kg, height_cm);
        trials.push(scalars);
      } catch (e) {
        console.warn(`파싱 실패: ${file.name}`, e);
      }
    }

    if (trials.length === 0) throw new Error('성공한 trial이 없습니다');

    const agg = aggregateTrials(trials);
    const result = calculateScores(agg, mode);
    LAST_RESULT = result;
    return result;
  }

  // Mode 토글
  function setMode(m) { CURRENT_MODE = m; }
  function getMode() { return CURRENT_MODE; }
  function setPlayer(p) { Object.assign(CURRENT_PLAYER, p); }
  function getLastResult() { return LAST_RESULT; }

  // Expose
  window.TheiaApp = {
    ALGORITHM_VERSION,
    parseC3dTxt, extractScalars, aggregateTrials, calculateScores,
    processFiles, renderReport,
    setMode, getMode, setPlayer, getLastResult,
  };
})();
