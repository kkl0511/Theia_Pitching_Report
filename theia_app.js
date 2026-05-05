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

  const ALGORITHM_VERSION = 'v0.52';
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
      // ★ v0.18.2/v0.19 — 다음 두 케이스에서 component 무시하고 헤더 이름만 등록:
      //   1) EVENT_LABEL/EVENT_TIME (이벤트 시점 라벨)
      //   2) 헤더가 _Scalar/_Energy/_ME/_Mechanical_Energy로 끝남 (단일 scalar 변수)
      //      예: R_Shoulder_Power_Scalar (component='X'이지만 단일 변수)
      const isEventLabel = dt === 'EVENT_LABEL' || dt === 'EVENT_TIME';
      const isScalarVar = /(_Scalar|_Energy|_ME|_Mechanical_Energy)$/.test(h);
      const key = (isEventLabel || isScalarVar)
        ? h
        : (c && c !== '0' ? `${h}.${c}` : h);
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

    // ★ v0.30 — 데이터 row 분류 (col 0 ITEM 기반)
    //   kin frame: TIME_rel(col 2) != null
    //   force-only frame: TIME_rel == null이지만 col 0 (ITEM) != null
    //     ※ col 1 (FRAMES) 비어있을 수 있어 ITEM (col 0)으로 검사
    const kinematic = [];
    const force_only = [];
    let firstFrame = null, lastKinTime = null;
    const itemIdx = 0;  // col 0 = ITEM
    for (let i = 5; i < lines.length; i++) {
      const r = lines[i].split('\t');
      if (r.length < 3) continue;
      const tt = safeNum(r[columnIndex['TIME_rel']]);
      const item = safeNum(r[itemIdx]);
      if (tt != null) {
        kinematic.push(r);
        lastKinTime = tt;
      } else if (item != null) {
        force_only.push(r);
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
      // ★ v0.18.2 — leeyoungha 형식 'MaxShoulderVel' 추가 (MER 시점 후보)
      const evCandidates = {
        'KH': ['MaxKneeHeight', 'KneeHeight'],
        'FS': ['Footstrike', 'FootStrike', 'FootContact', 'FC'],
        'MER': ['MaxShoulderVel', 'Max_External_Rotation', 'Max_Shoulder_Int_Rot', 'MER', 'MaxShoulderEr', 'MaxShoulderER'],
        'BR': ['Ball_Release', 'Release', 'BR'],
        'BR100ms': ['Ball_Release_Plus_100ms', 'Release100msAfter', 'BR100ms', 'ReleasePlus100ms'],
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
      // ★ v0.20 — events sanity check (비정상 trial 자동 제외)
      //   조건: KH > 0.3s · FS > KH+0.1 · MER > FS+0.05 · BR > MER 또는 |MER−BR|<0.05 · BR < 30s
      //   부적합 시 events 무효화 → 시점 기반 변수 NULL → aggregateTrials에서 자동 제외
      const KH = events.KH, FS = events.FS, MER = events.MER, BR = events.BR;
      let sane = true;
      const reasons = [];
      if (KH != null && KH < 0.3) { sane = false; reasons.push('KH<0.3s'); }
      if (BR != null && BR < 0.3) { sane = false; reasons.push('BR<0.3s'); }
      if (BR != null && BR > 60) { sane = false; reasons.push('BR>60s'); }
      if (KH != null && BR != null && BR <= KH) { sane = false; reasons.push('BR<=KH'); }
      if (KH != null && FS != null && FS < KH + 0.1) { sane = false; reasons.push('FS<KH+0.1'); }
      if (FS != null && MER != null && MER < FS + 0.05) { sane = false; reasons.push('MER<FS+0.05'); }
      if (MER != null && BR != null && (BR < MER - 0.05 || BR > MER + 0.5)) { sane = false; reasons.push('BR-MER 비정상'); }
      if (!sane) {
        events._invalid = true;
        events._invalid_reasons = reasons;
        // events 무효화 → 시점 기반 변수가 산출되지 않도록
        delete events.KH;
        delete events.FS;
        delete events.MER;
        delete events.BR;
        delete events.BR100ms;
      }
    }

    const result = {
      meta: { filePath, athlete, trialName, handHint, fps, duration: lastKinTime },
      header, dtype, component, columnIndex,
      kinematic, force_only,
      events
    };

    // ★ v0.22 — 자동 디지털 필터링 default OFF (이중 필터 회피)
    //   대부분 c3d.txt는 Visual3D pipeline에서 이미 좌표 필터링(예: 20Hz Butterworth) 후
    //   각도·각속도·파워가 derive된 데이터. 추가 필터링은 이중 필터링 = peak 깎임.
    //   필터 안 된 raw 데이터인 경우만 UI에서 토글 ON으로 활성화.
    if (typeof window !== 'undefined' && window._THEIA_FILTER_ON === true) {
      _applyAutoFilter(result);
    }
    return result;
  }

  // ════════════════════════════════════════════════════════════
  // v0.21 — Butterworth 4th order low-pass + zero-lag filtfilt
  //   RBJ cookbook biquad design (cascade 2 biquads = 4th order)
  // ════════════════════════════════════════════════════════════
  function _butter4LowpassSOS(fps, fc) {
    // 4차 Butterworth = 2 biquads cascade. Q_k = 1/(2cos(θ_k)), θ_k = π(2k-1)/(2N), N=4.
    const sos = [];
    const w0 = 2 * Math.PI * fc / fps;
    const cw = Math.cos(w0), sw = Math.sin(w0);
    for (let k = 1; k <= 2; k++) {
      const Q = 1 / (2 * Math.cos(Math.PI * (2*k - 1) / 8));
      const alpha = sw / (2 * Q);
      const a0 = 1 + alpha;
      sos.push([
        (1 - cw) / 2 / a0,    // b0
        (1 - cw) / a0,         // b1
        (1 - cw) / 2 / a0,     // b2
        1.0,                    // a0 (normalized)
        -2 * cw / a0,           // a1
        (1 - alpha) / a0,       // a2
      ]);
    }
    return sos;
  }

  function _sosFilterForward(sos, x) {
    let y = x.slice();
    for (const [b0, b1, b2, , a1, a2] of sos) {
      const out = new Array(y.length);
      let z1 = 0, z2 = 0;
      for (let n = 0; n < y.length; n++) {
        const v = y[n] - a1 * z1 - a2 * z2;
        out[n] = b0 * v + b1 * z1 + b2 * z2;
        z2 = z1; z1 = v;
      }
      y = out;
    }
    return y;
  }

  function _filtfilt(sos, x) {
    if (x.length < 12) return x;
    // odd-extension padding (Octave 방식)
    const npad = Math.min(3 * sos.length * 3, Math.floor(x.length / 3));
    const front = new Array(npad), back = new Array(npad);
    for (let i = 0; i < npad; i++) front[i] = 2 * x[0] - x[npad - i];
    for (let i = 0; i < npad; i++) back[i] = 2 * x[x.length - 1] - x[x.length - 2 - i];
    const padded = front.concat(x, back);
    // Forward
    const fwd = _sosFilterForward(sos, padded);
    // Reverse → forward → reverse (filtfilt)
    fwd.reverse();
    const bwd = _sosFilterForward(sos, fwd);
    bwd.reverse();
    return bwd.slice(npad, npad + x.length);
  }

  // 컬럼 카테고리 분류 → 컷오프 결정
  function _columnCutoff(headerName, dt) {
    if (dt === 'FORCE' || dt === 'MOMENT' || dt === 'FREEMOMENT' || dt === 'COP') return 25;
    if (/_Ang_Vel$/.test(headerName)) return 15;
    if (/(_Scalar|_Energy|_ME|_Mechanical_Energy)$/.test(headerName)) return 10;
    return 10;  // angle, position, etc.
  }

  // 자동 필터 — 모든 numeric 컬럼에 카테고리별 컷오프 적용
  function _applyAutoFilter(parsed) {
    const { columnIndex, header, dtype, kinematic, force_only, meta } = parsed;
    const fps = meta.fps;
    if (!fps || fps < 50 || fps > 2000) return;  // 비정상 fps
    const tRelIdx = columnIndex['TIME_rel'];

    // SOS 캐시 (컷오프별)
    const sosCache = {};
    function getSOS(cutoff) {
      if (!sosCache[cutoff]) sosCache[cutoff] = _butter4LowpassSOS(fps, cutoff);
      return sosCache[cutoff];
    }

    // 컬럼별 분류
    const colsByCutoff = {};  // {10: [colIdx,...], 15: [...], 25: [...]}
    const skipCols = new Set();
    for (const [key, idx] of Object.entries(columnIndex)) {
      // 시간·이벤트는 필터 제외
      if (idx == null || idx < 0) continue;
      // 헤더 검색 (key는 'Pelvis_Ang_Vel.Z' 형태이고 columnIndex의 키)
      // dtype과 헤더 이름 추출
      const baseName = key.replace(/\.[XYZ]$/, '');
      const dt = (dtype[idx] || '').trim();
      if (dt === 'FRAME_NUMBERS' || dt === 'EVENT_LABEL' || dt === 'EVENT_TIME') continue;
      if (key === 'FRAMES' || key === 'TIME_abs' || key === 'TIME_rel') continue;
      const cut = _columnCutoff(baseName, dt);
      (colsByCutoff[cut] = colsByCutoff[cut] || []).push(idx);
    }

    // kinematic frame 시계열 필터 (kinematic 변수)
    let nFiltered = 0;
    for (const [cut, cols] of Object.entries(colsByCutoff)) {
      if (parseInt(cut) === 25) continue;  // GRF는 force_only도 포함하니 별도 처리
      const sos = getSOS(parseInt(cut));
      for (const colIdx of cols) {
        const sig = new Array(kinematic.length);
        let allNaN = true;
        for (let i = 0; i < kinematic.length; i++) {
          const v = parseFloat(kinematic[i][colIdx]);
          if (isFinite(v)) { sig[i] = v; allNaN = false; }
          else sig[i] = NaN;
        }
        if (allNaN) continue;
        // NaN 보간
        let firstValid = -1;
        for (let i = 0; i < sig.length; i++) if (!isNaN(sig[i])) { firstValid = i; break; }
        let lastValid = -1;
        for (let i = sig.length - 1; i >= 0; i--) if (!isNaN(sig[i])) { lastValid = i; break; }
        if (firstValid < 0 || lastValid - firstValid < 10) continue;
        for (let i = firstValid; i <= lastValid; i++) {
          if (isNaN(sig[i])) {
            // linear interp from previous & next valid
            let pPrev = i - 1, pNext = i + 1;
            while (pPrev >= firstValid && isNaN(sig[pPrev])) pPrev--;
            while (pNext <= lastValid && isNaN(sig[pNext])) pNext++;
            if (pPrev >= 0 && pNext <= lastValid) {
              sig[i] = sig[pPrev] + (sig[pNext] - sig[pPrev]) * (i - pPrev) / (pNext - pPrev);
            } else if (pPrev >= 0) sig[i] = sig[pPrev];
            else if (pNext <= lastValid) sig[i] = sig[pNext];
          }
        }
        // 필터 적용 (valid 구간만)
        try {
          const validSig = sig.slice(firstValid, lastValid + 1);
          const filtered = _filtfilt(sos, validSig);
          // 결과 다시 row에 기록
          for (let i = 0; i < filtered.length; i++) {
            kinematic[firstValid + i][colIdx] = filtered[i].toFixed(5);
          }
          nFiltered++;
        } catch (e) { /* 필터 실패 — raw 유지 */ }
      }
    }

    // GRF 필터 (kinematic + force_only frame 모두)
    const grfCols = colsByCutoff[25] || [];
    if (grfCols.length > 0) {
      const sosGRF = getSOS(25);
      // 모든 frame을 시간 순서로 결합
      const allFrames = [...kinematic, ...force_only];
      // absolute time으로 정렬 (TIME_abs는 항상 있음)
      const tAbsIdx = columnIndex['TIME_abs'];
      if (tAbsIdx != null) {
        allFrames.sort((a, b) => (parseFloat(a[tAbsIdx]) || 0) - (parseFloat(b[tAbsIdx]) || 0));
      }
      for (const colIdx of grfCols) {
        const sig = allFrames.map(r => parseFloat(r[colIdx]));
        let firstValid = -1, lastValid = -1;
        for (let i = 0; i < sig.length; i++) if (isFinite(sig[i])) { firstValid = i; break; }
        for (let i = sig.length - 1; i >= 0; i--) if (isFinite(sig[i])) { lastValid = i; break; }
        if (firstValid < 0 || lastValid - firstValid < 10) continue;
        const validSig = [];
        for (let i = firstValid; i <= lastValid; i++) {
          validSig.push(isFinite(sig[i]) ? sig[i] : (validSig.length ? validSig[validSig.length-1] : 0));
        }
        try {
          const filtered = _filtfilt(sosGRF, validSig);
          for (let i = 0; i < filtered.length; i++) {
            allFrames[firstValid + i][colIdx] = filtered[i].toFixed(5);
          }
          nFiltered++;
        } catch (e) {}
      }
    }
    parsed.meta._filtered = true;
    parsed.meta._filter_n_cols = nFiltered;
    parsed.meta._filter_info = { fps, cutoffs: { angle_pos: 10, ang_vel: 15, power_me: 10, grf: 25 }, order: 4, type: 'Butterworth lowpass · zero-lag filtfilt' };
  }

  // ════════════════════════════════════════════════════════════
  // 헬퍼 — 시계열 분석
  // ════════════════════════════════════════════════════════════

  function valAtTime(parsed, varKey, t) {
    if (t == null) return null;
    const idx = parsed.columnIndex[varKey];
    if (idx == null) return null;
    const tIdx = parsed.columnIndex['TIME_rel'];
    // ★ v0.38 — kin frame 시간 보간 (가장 가까운 점 기준)
    let prev = null, next = null;
    for (const r of parsed.kinematic) {
      const tt = safeNum(r[tIdx]);
      const v = safeNum(r[idx]);
      if (tt == null || v == null) continue;
      if (tt <= t) prev = { t: tt, v };
      else { next = { t: tt, v }; break; }
    }
    if (prev && next && next.t > prev.t) {
      const frac = (t - prev.t) / (next.t - prev.t);
      return prev.v + frac * (next.v - prev.v);
    }
    if (prev) return prev.v;
    if (next) return next.v;
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

  // ★ v0.31 — Force-only sub-frame 시간 좌표 변환
  //   force-only frame: col 1·col 2 비어있고 col 0 (ITEM)만 있음
  //   국민대 lab: fps_force = 1200Hz (force plate sample rate)
  //   force-only가 trial 끝부분만 cover (시작 시점 trigger 후)
  //   ★ 핵심 가정: force-only 마지막 ITEM ↔ trial end (= lastKinTime)
  //   T0 = lastKinTime - (N_force / fps_force)
  //   ITEM N → t = T0 + (N - lastKinItem) / fps_force
  //              = lastKinTime + (N - lastForceItem) / fps_force
  const FPS_FORCE_DEFAULT = 1200;
  function forceOnlyTimes(parsed, varKey) {
    const idx = parsed.columnIndex[varKey];
    if (idx == null || parsed.force_only.length === 0) return [];
    const itemIdx = 0;
    const tIdx = parsed.columnIndex['TIME_rel'];

    const kin = parsed.kinematic;
    if (kin.length < 2) return [];
    const lastKinItem = safeNum(kin[kin.length - 1][itemIdx]);
    const lastKinTime = safeNum(kin[kin.length - 1][tIdx]);
    if (lastKinItem == null || lastKinTime == null) return [];
    const fpsForce = FPS_FORCE_DEFAULT;
    const N_force = parsed.force_only.length;
    // force-only 시작 시간 T0 = lastKinTime - (N_force / fps_force)
    const T0 = lastKinTime - (N_force / fpsForce);

    const rows = parsed.force_only.map(r => ({
      item: safeNum(r[itemIdx]),
      v: safeNum(r[idx])
    })).filter(x => x.item != null && x.v != null).sort((a,b) => a.item - b.item);
    if (rows.length < 2) return [];
    return rows.map(({item, v}) => ({ t: T0 + (item - lastKinItem) / fpsForce, v }));
  }

  // ★ v0.29 — FP1/FP2 → Lead/Trail 고정 매핑 (사용자 데이터 검증 후 확정)
  //   FP2 = Trail leg (좌·우완 무관) — 시작부터 trail leg 위, FC 직후 떠나며 0
  //   FP1 = Lead leg  (좌·우완 무관) — FC 전 0, FC 후 spike (블로킹)
  //   ★ 이영하 8 trial 실측 검증: FP2가 정적 weight → push → 떠남 패턴 (= trail)
  //   각 plate의 FC 전후 0/non-zero는 정상이며 impulse 적분에 영향 없음.
  function detectGRFPlateMapping(parsed, mass_kg) {
    const fp1 = getForceTimeSeries(parsed, 'FP1.Z');
    const fp2 = getForceTimeSeries(parsed, 'FP2.Z');
    const has1 = fp1.length > 0;
    const has2 = fp2.length > 0;
    if (!has1 && !has2) return { trail: null, lead: null, source: 'no_force_data' };
    return { trail: 'FP2', lead: 'FP1', source: 'lab_convention_FP2_trail_FP1_lead' };
  }

  function detectFCfromGRF(parsed, mass_kg, leadKey) {
    // ★ v0.37 — 통합 force time series 사용 (kin + force-only)
    const key = leadKey ? `${leadKey}.Z` : 'Lead_Leg_GRF.Z';
    const arr = getForceTimeSeries(parsed, key);
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
    const arr = getForceTimeSeries(parsed, varKey);
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
    const arr = getForceTimeSeries(parsed, varKey);
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
    const arr = getForceTimeSeries(parsed, varKey);
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

  // ★ v0.37 — force time series에서 시간 보간으로 값 추출 (force-aware valAtTime)
  //   기존 valAtTime은 kin frame만 검색 → force-only 데이터 못 봄 → 결측 발생
  //   이 함수는 getForceTimeSeries (kin + force-only 통합)에서 보간
  function forceValAtTime(parsed, varKey, t) {
    if (t == null) return null;
    const series = getForceTimeSeries(parsed, varKey);
    if (series.length === 0) return null;
    // 시간 보간 — t 양쪽 가까운 두 점에서 선형 보간
    let prev = null, next = null;
    for (const p of series) {
      if (p.t <= t) prev = p;
      else { next = p; break; }
    }
    if (prev && next && next.t > prev.t) {
      const frac = (t - prev.t) / (next.t - prev.t);
      return prev.v + frac * (next.v - prev.v);
    }
    if (prev) return prev.v;
    if (next) return next.v;
    return null;
  }

  // ★ v0.30 — kin frame + force_only frame 통합 시계열
  //   1. kin frame에서 추출 (TIME_rel 사용)
  //   2. force_only frame에서 추출 (col 0 ITEM 기반 시간 변환)
  //   3. 두 시계열 합쳐서 시간순 정렬 → 하나의 단일 시계열 반환
  //      이렇게 하면 kin frame이 0뿐이어도 force_only가 보완해줌 (lead leg case)
  function getForceTimeSeries(parsed, varKey) {
    const ci = parsed.columnIndex;
    const idx = ci[varKey];
    if (idx == null) return [];
    const ti = ci['TIME_rel'];
    // kin frame 시계열
    const kinSeries = [];
    for (const r of parsed.kinematic) {
      if (r.length <= Math.max(idx, ti)) continue;
      const t = safeNum(r[ti]); const v = safeNum(r[idx]);
      if (t != null && v != null) kinSeries.push({ t, v });
    }
    // force_only 시계열 (ITEM 기반 시간 변환)
    const foSeries = forceOnlyTimes(parsed, varKey);
    // 결합: 두 시계열의 max 값 비교 — 큰 쪽 우선
    const kinMax = kinSeries.reduce((m, x) => Math.max(m, Math.abs(x.v)), 0);
    const foMax  = foSeries.reduce((m, x) => Math.max(m, Math.abs(x.v)), 0);
    // 두 시계열 모두 의미있으면 합쳐서 시간순 정렬
    if (kinMax > 50 && foMax > 50) {
      const merged = [...kinSeries, ...foSeries].sort((a, b) => a.t - b.t);
      return merged;
    }
    if (foMax > 50) return foSeries;
    if (kinMax > 50) return kinSeries;
    // 둘 다 거의 0이면 force_only 시계열 반환 (있는 경우)
    return foSeries.length > 0 ? foSeries : kinSeries;
  }

  // ★ v0.28 — Phase A: signed GRF impulse (방향 보존)
  //   propulsive (양의 AP): drive_leg_propulsive_impulse = ∫max(F_AP,0) dt / BW
  //   braking (음의 AP):    lead_leg_braking_impulse    = ∫max(-F_AP,0) dt / BW
  function grfSignedImpulseBW(parsed, varKey, tFrom, tTo, mass_kg, sign) {
    if (!mass_kg) return null;
    const arr = getForceTimeSeries(parsed, varKey);
    if (arr.length < 2 || tFrom == null || tTo == null) return null;
    const lo = Math.min(tFrom, tTo), hi = Math.max(tFrom, tTo);
    let total = 0;
    for (let i = 1; i < arr.length; i++) {
      if (lo <= arr[i].t && arr[i].t <= hi) {
        const dt = arr[i].t - arr[i-1].t;
        const v = (arr[i].v + arr[i-1].v) / 2;
        const signed = sign === 'positive' ? Math.max(v, 0) : Math.max(-v, 0);
        total += signed * dt;
      }
    }
    const bw = mass_kg * 9.81;
    return total / bw;
  }

  // ★ v0.39 — Joint Power W⁺/W⁻ 적분 (force-aware: kin + force_only 통합)
  //   기존엔 kin frame만 → 일부 trial 결측. 통합 시계열 사용으로 강화.
  function jointPowerWork(parsed, key, tFrom, tTo) {
    if (parsed.columnIndex[key] == null || tFrom == null || tTo == null) {
      return { Wpos: null, Wneg: null, absorption: null };
    }
    const lo = Math.min(tFrom, tTo), hi = Math.max(tFrom, tTo);
    // 통합 시계열 (kin + force_only) 사용
    const fullSeries = getForceTimeSeries(parsed, key);
    const series = fullSeries.filter(p => lo <= p.t && p.t <= hi);
    if (series.length < 2) return { Wpos: null, Wneg: null, absorption: null };
    let Wpos = 0, Wneg = 0;
    for (let i = 1; i < series.length; i++) {
      const dt = series[i].t - series[i-1].t;
      const avg = (series[i].v + series[i-1].v) / 2;
      if (avg > 0) Wpos += avg * dt;
      else         Wneg += avg * dt;
    }
    const absorption = Wpos > 0 ? Math.abs(Wneg) / Wpos : null;
    return { Wpos, Wneg, absorption };
  }

  // ★ v0.28 — Phase C: Mechanical Energy at event time
  function meAtTime(parsed, key, t) {
    return valAtTime(parsed, key, t);
  }

  // ════════════════════════════════════════════════════════════
  // 변수 산출 — extract_theia_scalars.py JS 포팅
  // ════════════════════════════════════════════════════════════

  function extractScalars(parsed, mass_kg, height_cm) {
    const ev = parsed.events;
    const ci = parsed.columnIndex;

    // ★ v0.24 — FP1/FP2 → Trail/Lead 자동 매핑 (Theia c3d.txt에 FP1/FP2 헤더가 있는 경우)
    //   기존 'Trail_Leg_GRF.Z' / 'Lead_Leg_GRF.Z' 헤더가 없으면 FP1/FP2로 fallback
    const hasLegacyGRF = parsed.columnIndex['Trail_Leg_GRF.Z'] != null
                       || parsed.columnIndex['Lead_Leg_GRF.Z'] != null;
    let trailKey = hasLegacyGRF ? 'Trail_Leg_GRF' : null;
    let leadKey  = hasLegacyGRF ? 'Lead_Leg_GRF'  : null;
    let grfMapSource = hasLegacyGRF ? 'legacy_GRF_header' : null;
    if (!hasLegacyGRF) {
      const map = detectGRFPlateMapping(parsed, mass_kg);
      trailKey = map.trail;
      leadKey  = map.lead;
      grfMapSource = map.source;
    }
    ev._grf_mapping = { trail: trailKey, lead: leadKey, source: grfMapSource };

    // FC 검출 — Lead vGRF 기반 우선, fallback to V3D Footstrike
    const fcGrf = detectFCfromGRF(parsed, mass_kg, leadKey);
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

    // ★ Arm_peak = Pitching_Shoulder_Ang_Vel.Z (어깨 IR/ER 각속도 = "Shoulder IR vel max")
    //   주의: humerus segment 자체 각속도(Pitching_Humerus_Ang_Vel)와 다름 — 박명균 col 17 vs col 5
    //   둘 다 비슷한 시점에 비슷한 값(~7000°/s elite)이지만 정의 다름
    const armPeak = maxAbsBetween(parsed, 'Pitching_Shoulder_Ang_Vel.Z', winFrom, winTo);
    out.Arm_peak = armPeak != null ? Math.abs(armPeak) : null;
    out.shoulder_ir_vel_max = out.Arm_peak;  // alias (BBL Uplift 호환)

    // ★ humerus segment 절대 각속도 (분리 산출 — 새 변수)
    const humerusSegPeak = maxAbsBetween(parsed, 'Pitching_Humerus_Ang_Vel.Z', winFrom, winTo);
    out.humerus_segment_peak = humerusSegPeak != null ? Math.abs(humerusSegPeak) : null;

    // ★ 몸통 굴곡 속도 peak (Thorax_Ang_Vel.X = frontal axis 회전 = forward flexion 각속도)
    const trunkFlexVel = maxAbsBetween(parsed, 'Thorax_Ang_Vel.X', winFrom, winTo);
    out.trunk_forward_flexion_vel_peak = trunkFlexVel != null ? Math.abs(trunkFlexVel) : null;

    // ★ FC 시점 몸통 절대 회전 각도 (Trunk_Angle.Z at FC = "Flying Open" 절대값)
    //   양수 = 닫힘 (좋음), 음수 = 일찍 열림 (Flying Open)
    if (ev.FC != null) {
      out.trunk_rotation_at_fc = valAtTime(parsed, 'Trunk_Angle.Z', ev.FC);
    }

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
    // ★ v0.48 — Visual3D Trunk Cardan(XYZ) 순서: X=forward tilt, Y=lateral lean, Z=axial rotation
    //   기존 코드가 Z축(회전)을 읽어 trunk_rotation_at_fc와 같은 값(예: 91°) 출력하던 버그 수정
    out.fc_trunk_forward_tilt = valAtTime(parsed, 'Trunk_Angle.X', ev.FC);
    if (ev.FC != null) {
      // ★ v0.49 — peak_trunk_CounterRotation = Trunk_Angle.Z(axial rotation) range [0, FC]
      //   기존 'Trunk_Angle.Y'(lateral lean) 사용 시 코호트 산출(extract_theia_scalars.py)과
      //   축이 어긋나 박명균 8 trial 평균 14.5° (코호트 mean 39.6°와 큰 차이) 발생.
      //   Python 산출 검증치: 박명균 trial 1 [0, FC] Z range = 49.9° (xlsx 48.04와 일치)
      const zMax = maxBetween(parsed, 'Trunk_Angle.Z', 0, ev.FC);
      const zMin = minBetween(parsed, 'Trunk_Angle.Z', 0, ev.FC);
      if (zMax != null && zMin != null) out.peak_trunk_CounterRotation = Math.abs(zMax - zMin);
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

    // ── GRF ── (★ v0.24 — trailKey/leadKey 동적 매핑)
    if (mass_kg) {
      if (trailKey) {
        out.Trail_leg_peak_vertical_GRF = grfPeakBW(parsed, `${trailKey}.Z`, winFrom, winTo, mass_kg);
        out.Trail_leg_peak_AP_GRF       = grfPeakBW(parsed, `${trailKey}.X`, winFrom, winTo, mass_kg);
        out.trail_impulse_stride        = grfImpulseBW(parsed, `${trailKey}.Z`, ev.KH, ev.FC, mass_kg);
      }
      if (leadKey) {
        out.Lead_leg_peak_vertical_GRF = grfPeakBW(parsed, `${leadKey}.Z`, winFrom, winTo, mass_kg);
        out.Lead_leg_peak_AP_GRF       = grfPeakBW(parsed, `${leadKey}.X`, winFrom, winTo, mass_kg);
      }
      if (trailKey && leadKey) {
        const trailPeakT = grfPeakTime(parsed, `${trailKey}.Z`, winFrom, winTo);
        const leadPeakT  = grfPeakTime(parsed, `${leadKey}.Z`,  winFrom, winTo);
        if (trailPeakT != null && leadPeakT != null) {
          out.trail_to_lead_vgrf_peak_s = leadPeakT - trailPeakT;
        }

        // ★ v0.34 — NewtForce 시그니처 변수 추가
        // Time to Peak Force (각 leg의 peak 도달 시간 — push/block 효율)
        if (trailPeakT != null && ev.KH != null) {
          out.time_to_peak_trail_force = trailPeakT - ev.KH;  // s, KH→trail peak
        }
        if (leadPeakT != null && ev.FC != null) {
          out.time_to_peak_lead_force = leadPeakT - ev.FC;    // s, FC→lead peak
        }

        // ★ v0.37 — Force at Ball Release (force-only sub-frame까지 활용)
        if (ev.BR != null) {
          const fzAtBR = forceValAtTime(parsed, `${leadKey}.Z`, ev.BR);
          if (fzAtBR != null && mass_kg) {
            out.force_at_ball_release = Math.abs(fzAtBR) / (mass_kg * 9.81);
          }
        }

        // X Force Instability (좌우 방향 흔들림 — KH→BR 동안 |FP1.X|+|FP2.X|의 SD)
        const trailX = getForceTimeSeries(parsed, `${trailKey}.X`);
        const leadX  = getForceTimeSeries(parsed, `${leadKey}.X`);
        const xInRange = (arr) => arr.filter(p => p.t >= ev.KH && p.t <= ev.BR);
        if (mass_kg && (trailX.length || leadX.length) && ev.KH != null && ev.BR != null) {
          const tInR = xInRange(trailX), lInR = xInRange(leadX);
          const xSum = [...tInR, ...lInR].map(p => Math.abs(p.v));
          if (xSum.length >= 5) {
            const mean = xSum.reduce((s, v) => s + v, 0) / xSum.length;
            const variance = xSum.reduce((s, v) => s + (v - mean) ** 2, 0) / xSum.length;
            out.x_force_instability = Math.sqrt(variance) / (mass_kg * 9.81);  // BW
          }
        }

        // ★ v0.37 — Clawback Time (force-aware)
        if (ev.BR != null && mass_kg) {
          const leadZ = getForceTimeSeries(parsed, `${leadKey}.Z`);
          const peakAtBR = Math.abs(forceValAtTime(parsed, `${leadKey}.Z`, ev.BR) || 0);
          const target = peakAtBR * 0.5;
          let recoveryT = null;
          for (const p of leadZ) {
            if (p.t > ev.BR && Math.abs(p.v) <= target) {
              recoveryT = p.t - ev.BR;
              break;
            }
          }
          if (recoveryT != null) out.clawback_time = recoveryT;
        }

        // Lead Braking Efficiency = brake_impulse / propulsive_impulse
        if (out.drive_leg_propulsive_impulse > 0 && out.lead_leg_braking_impulse != null) {
          out.lead_braking_efficiency = out.lead_leg_braking_impulse / out.drive_leg_propulsive_impulse;
        }
      }
    }

    // ── Joint Power (Tier 2) — 두 형식 호환 ──
    //   1차: 표준 키 (Pitching_Shoulder_Power 등) — Visual3D pipeline 표준
    //   2차: leeyoungha 새 형식 fallback (R_Shoulder_Power_Scalar / L_Knee_Power_Scalar 등)
    //   좌·우투 기반 매핑: 우투 → 던지는 팔 = R, Lead leg = L, Trail leg = R
    const isLeftHanded = (parsed.meta?.handHint === 'left');
    const armSide  = isLeftHanded ? 'L' : 'R';   // 던지는 팔 (LH 좌투 / RH 우투)
    const trailSide = isLeftHanded ? 'L' : 'R';  // Trail leg = 던지는 팔 같은 쪽
    const leadSide  = isLeftHanded ? 'R' : 'L';  // Lead leg = 반대쪽

    const jointPowerMap = [
      // [out 변수, 표준 키, 새 형식 fallback 키들...]
      ['Pitching_Shoulder_Power_peak', 'Pitching_Shoulder_Power', `${armSide}_Shoulder_Power_Scalar`, `${armSide}_Shoulder_Power`],
      ['Pitching_Elbow_Power_peak',    'Pitching_Elbow_Power',    `${armSide}_Elbow_Power_Scalar`,    `${armSide}_Elbow_Power`],
      ['Trail_Hip_Power_peak',         'Trail_Hip_Power',         `${trailSide}_Hip_Power_Scalar`,    `${trailSide}_Hip_Power`],
      ['Lead_Hip_Power_peak',          'Lead_Hip_Power',          `${leadSide}_Hip_Power_Scalar`,     `${leadSide}_Hip_Power`],
      ['Lead_Knee_Power_peak',         'Lead_Knee_Power',         `${leadSide}_Knee_Power_Scalar`,    `${leadSide}_Knee_Power`],
    ];
    for (const [outKey, ...candidates] of jointPowerMap) {
      for (const varKey of candidates) {
        if (ci[varKey] != null) {
          const v = maxAbsBetween(parsed, varKey, winFrom, winTo);
          if (v != null) { out[outKey] = Math.abs(v); break; }
        }
      }
    }

    // ── 분절 Mechanical Energy (J) — leeyoungha 새 형식에 직접 측정값 있음 ──
    //   PDF §4 권장: KE 추정(0.5·I·ω²) 대신 직접 측정 ME 사용
    const meMap = [
      ['Pelvis_ME_peak',  'Pelvis_Mechanical_Energy',  'Pelvis_ME'],
      ['Trunk_ME_peak',   'Trunk_Mechanical_Energy',   'Trunk_ME'],
      ['Arm_ME_peak',     `${armSide}_Humerus_Mechanical_Energy`, `${armSide}_Humerus_ME`],
    ];
    for (const [outKey, ...candidates] of meMap) {
      for (const varKey of candidates) {
        if (ci[varKey] != null) {
          const v = maxBetween(parsed, varKey, winFrom, winTo);
          if (v != null) { out[outKey] = v; break; }
        }
      }
    }

    // ── Wrist 3D 위치 (P1·P3 산출용 trial-level value) ──
    // ★ v0.25 — 두 c3d.txt 형식 호환:
    //   Visual3D pipeline 형식: 'Pitching_Wrist_jc_Position.X/Y/Z' (LINK_MODEL_BASED)
    //   Theia 직접 export 형식: 'R_WRIST.X/Y/Z' / 'L_WRIST.X/Y/Z' (LANDMARK)
    //   case-insensitive 매칭 (R_WRIST·R_Elbow·R_ANKLE 등 케이스 mix)
    function findKeyCI(prefix, axis) {
      if (ci[`${prefix}.${axis}`] != null) return `${prefix}.${axis}`;
      // case-insensitive 검색
      const target = `${prefix}.${axis}`.toLowerCase();
      for (const k of Object.keys(ci)) {
        if (k.toLowerCase() === target) return k;
      }
      return null;
    }
    const isLH = parsed.meta?.handHint === 'left';
    const sidePrefix = isLH ? 'L' : 'R';
    function resolveJointKey(jcName, landmarkName) {
      // jcName: 'Pitching_Wrist_jc_Position', landmarkName: 'WRIST' (uppercase 검색)
      const xKey = findKeyCI(jcName, 'X');
      if (xKey) return jcName;
      // landmark 시도: R_WRIST or R_Wrist (case-insensitive)
      const lmKey = findKeyCI(`${sidePrefix}_${landmarkName}`, 'X');
      if (lmKey) return lmKey.replace('.X', '');
      return null;
    }
    const wristKey    = resolveJointKey('Pitching_Wrist_jc_Position',    'WRIST');
    const elbowKey    = resolveJointKey('Pitching_Elbow_jc_Position',    'ELBOW');
    const shoulderKey = resolveJointKey('Pitching_Shoulder_jc_Position', 'SHOULDER');
    ev._joint_keys = { wrist: wristKey, elbow: elbowKey, shoulder: shoulderKey, side: sidePrefix };

    if (wristKey && ev.BR != null) {
      out.wrist_x_at_BR = valAtTime(parsed, `${wristKey}.X`, ev.BR);
      out.wrist_y_at_BR = valAtTime(parsed, `${wristKey}.Y`, ev.BR);
      out.wrist_z_at_BR = valAtTime(parsed, `${wristKey}.Z`, ev.BR);
    }

    // ── arm_slot ── (어깨-손목 위치차로 던지는 팔 각도 산출 — 사이드암/오버핸드 구분)
    if (ev.BR != null && shoulderKey && wristKey) {
      const sx = valAtTime(parsed, `${shoulderKey}.X`, ev.BR);
      const sy = valAtTime(parsed, `${shoulderKey}.Y`, ev.BR);
      const sz = valAtTime(parsed, `${shoulderKey}.Z`, ev.BR);
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

    // ════════════════════════════════════════════════════════════
    // ★ v0.28 — PDF §4·5·7 핵심 변수 추가
    // ════════════════════════════════════════════════════════════
    const isLH28 = parsed.meta?.handHint === 'left';
    const armSide28  = isLH28 ? 'L' : 'R';   // 던지는 팔
    const trailSide28 = isLH28 ? 'L' : 'R';  // Trail leg
    const leadSide28  = isLH28 ? 'R' : 'L';  // Lead leg

    // ── Phase A: GRF impulse (PDF §7) ──
    if (mass_kg && trailKey && leadKey && ev.KH != null && ev.FC != null && ev.BR != null) {
      // drive-leg propulsive impulse: trail AP force 양의 방향, KH→FC
      out.drive_leg_propulsive_impulse = grfSignedImpulseBW(parsed, `${trailKey}.X`, ev.KH, ev.FC, mass_kg, 'positive');
      // lead-leg braking impulse: lead AP force 음의 방향, FC→BR
      out.lead_leg_braking_impulse = grfSignedImpulseBW(parsed, `${leadKey}.X`, ev.FC, ev.BR, mass_kg, 'negative');
      // vertical GRF impulse: 양 leg KH→BR
      out.trail_vGRF_impulse = grfImpulseBW(parsed, `${trailKey}.Z`, ev.KH, ev.FC, mass_kg);
      out.lead_vGRF_impulse  = grfImpulseBW(parsed, `${leadKey}.Z`,  ev.FC, ev.BR, mass_kg);
    }

    // ── Phase B: Joint W⁺/W⁻ 적분 (PDF §4) ──
    //   8 joint × {W_pos, W_neg, absorption_ratio}
    const jp_pairs = [
      ['shoulder',     `${armSide28}_Shoulder_Power_Scalar`],
      ['elbow',        `${armSide28}_Elbow_Power_Scalar`],
      ['trail_hip',    `${trailSide28}_Hip_Power_Scalar`],
      ['lead_hip',     `${leadSide28}_Hip_Power_Scalar`],
      ['trail_knee',   `${trailSide28}_Knee_Power_Scalar`],
      ['lead_knee',    `${leadSide28}_Knee_Power_Scalar`],
    ];
    if (ev.KH != null && ev.BR != null) {
      jp_pairs.forEach(([name, key]) => {
        const w = jointPowerWork(parsed, key, ev.KH, ev.BR);
        if (w.Wpos != null) {
          out[`${name}_W_pos`] = w.Wpos;
          out[`${name}_W_neg`] = w.Wneg;
          out[`${name}_absorption_ratio`] = w.absorption;
        }
      });
    }

    // ── Phase C: ETE — Energy Transfer Efficiency (PDF §5 핵심) ──
    //   ETE_pelvis_to_trunk = ΔE_trunk(KH→FC) / W⁺_hip(KH→FC)
    //   ETE_trunk_to_arm    = ΔE_arm(FC→BR)  / |ΔE_trunk_loss(FC→BR)|
    if (ev.KH != null && ev.FC != null && ev.BR != null) {
      const me_pelvis_KH = meAtTime(parsed, 'Pelvis_Mechanical_Energy', ev.KH);
      const me_pelvis_FC = meAtTime(parsed, 'Pelvis_Mechanical_Energy', ev.FC);
      const me_trunk_KH  = meAtTime(parsed, 'Trunk_Mechanical_Energy', ev.KH);
      const me_trunk_FC  = meAtTime(parsed, 'Trunk_Mechanical_Energy', ev.FC);
      const me_trunk_BR  = meAtTime(parsed, 'Trunk_Mechanical_Energy', ev.BR);
      const me_arm_FC    = meAtTime(parsed, `${armSide28}_Humerus_ME`, ev.FC);
      const me_arm_BR    = meAtTime(parsed, `${armSide28}_Humerus_ME`, ev.BR);

      if (me_pelvis_KH != null && me_pelvis_FC != null) out.dE_pelvis_KH_FC = me_pelvis_FC - me_pelvis_KH;
      if (me_trunk_KH  != null && me_trunk_FC  != null) out.dE_trunk_KH_FC  = me_trunk_FC  - me_trunk_KH;
      if (me_trunk_FC  != null && me_trunk_BR  != null) out.dE_trunk_FC_BR  = me_trunk_BR  - me_trunk_FC;
      if (me_arm_FC    != null && me_arm_BR    != null) out.dE_arm_FC_BR    = me_arm_BR    - me_arm_FC;

      // Hip W+ KH→FC (양 hip 합)
      const wHipR = jointPowerWork(parsed, `${trailSide28}_Hip_Power_Scalar`, ev.KH, ev.FC);
      const wHipL = jointPowerWork(parsed, `${leadSide28}_Hip_Power_Scalar`, ev.KH, ev.FC);
      const W_hip_pos = (wHipR.Wpos || 0) + (wHipL.Wpos || 0);

      // ETE_pelvis_to_trunk = max(0, ΔE_trunk_KH_FC) / W_hip_pos
      if (W_hip_pos > 0 && out.dE_trunk_KH_FC != null) {
        const dE = Math.max(0, out.dE_trunk_KH_FC);
        out.W_hip_pos_KH_FC = W_hip_pos;
        out.ETE_pelvis_to_trunk = Math.min(2.0, dE / W_hip_pos);  // 상한 2.0 (이상값 방지)
        out.ELI_segment_pelvis_trunk = Math.max(0, Math.min(1, 1 - out.ETE_pelvis_to_trunk));
      }

      // ETE_trunk_to_arm = ΔE_arm_FC_BR / |ΔE_trunk_loss(FC→BR)|
      //   trunk가 잃은 에너지가 arm으로 얼마나 변환됐는지
      if (out.dE_arm_FC_BR != null && out.dE_trunk_FC_BR != null) {
        const trunkLoss = Math.max(0, -out.dE_trunk_FC_BR);  // 음수면 양수로 변환
        const armGain  = Math.max(0, out.dE_arm_FC_BR);
        if (trunkLoss > 0) {
          out.trunk_loss_FC_BR = trunkLoss;
          out.ETE_trunk_to_arm = Math.min(2.0, armGain / trunkLoss);
          out.ELI_segment_trunk_arm = Math.max(0, Math.min(1, 1 - out.ETE_trunk_to_arm));
        }
      }
    }

    // ── Phase D: Δknee, Δω, pelvis_deceleration ──
    //   PDF §7: knee_flexion_change_FC_to_MER, pelvis_deceleration
    if (ev.FC != null && ev.MER != null) {
      const knee_FC  = valAtTime(parsed, 'Lead_Knee_Angle.X', ev.FC);
      const knee_MER = valAtTime(parsed, 'Lead_Knee_Angle.X', ev.MER);
      if (knee_FC != null && knee_MER != null) {
        out.knee_flexion_change_FC_to_MER = Math.abs(knee_MER) - Math.abs(knee_FC);  // 양수=무릎 더 굴곡(무너짐)
      }
    }
    if (ev.MER != null && ev.BR != null) {
      const knee_MER = valAtTime(parsed, 'Lead_Knee_Angle.X', ev.MER);
      const knee_BR  = valAtTime(parsed, 'Lead_Knee_Angle.X', ev.BR);
      if (knee_MER != null && knee_BR != null) {
        out.knee_flexion_change_MER_to_BR = Math.abs(knee_BR) - Math.abs(knee_MER);  // 양수=계속 굴곡, 음수=신전
      }
    }
    // pelvis deceleration: peak ω - ω(MER)
    if (ev.MER != null && out.Pelvis_peak != null) {
      const pelvis_at_MER = Math.abs(valAtTime(parsed, 'Pelvis_Ang_Vel.Z', ev.MER) || 0);
      out.pelvis_deceleration = out.Pelvis_peak - pelvis_at_MER;  // 양수=감속함(좋음)
    }

    // ★ v0.43 — 결과(A) 변수 fallback proxy
    //   ME 데이터 없거나 ETE 산출 fail 시 speedup ratio로 대체 산출 (절대 결측 안 나오게)
    if (out.ETE_pelvis_to_trunk == null && out.pelvis_trunk_speedup != null) {
      // speedup ratio 0.8~2.0 범위 → ETE 0~1로 매핑 (1.36 ≈ 0.47)
      out.ETE_pelvis_to_trunk = Math.max(0, Math.min(1, (out.pelvis_trunk_speedup - 0.8) / 1.2));
      out._ETE_p2t_proxy = true;
    }
    if (out.ETE_trunk_to_arm == null && out.arm_trunk_speedup != null) {
      // arm/trunk 2~6 범위 → ETE 0~1 (5.0 ≈ 0.75)
      out.ETE_trunk_to_arm = Math.max(0, Math.min(1, (out.arm_trunk_speedup - 2) / 4));
      out._ETE_t2a_proxy = true;
    }
    // ELI_segment도 동시 산출
    if (out.ELI_segment_pelvis_trunk == null && out.ETE_pelvis_to_trunk != null) {
      out.ELI_segment_pelvis_trunk = Math.max(0, Math.min(1, 1 - out.ETE_pelvis_to_trunk));
    }
    if (out.ELI_segment_trunk_arm == null && out.ETE_trunk_to_arm != null) {
      out.ELI_segment_trunk_arm = Math.max(0, Math.min(1, 1 - out.ETE_trunk_to_arm));
    }
    // dE 변수도 회전 속도 기반 proxy (mass·관성 모멘트 표준값 사용)
    //   몸통 회전 KE ≈ 0.5 × I × ω²,  I_trunk ≈ 1.5 kg·m², ω in rad/s
    const degToRad = Math.PI / 180;
    if (out.dE_trunk_KH_FC == null && out.Trunk_peak != null) {
      const omega_rad = out.Trunk_peak * degToRad;
      out.dE_trunk_KH_FC = 0.5 * 1.5 * omega_rad * omega_rad * 0.3;  // 30% 비율 proxy
      out._dE_trunk_KH_FC_proxy = true;
    }
    if (out.dE_arm_FC_BR == null && out.Arm_peak != null) {
      const omega_rad = out.Arm_peak * degToRad;
      out.dE_arm_FC_BR = 0.5 * 0.05 * omega_rad * omega_rad * 0.3;  // I_humerus ~0.05
      out._dE_arm_FC_BR_proxy = true;
    }
    if (out.dE_trunk_FC_BR == null && out.dE_trunk_KH_FC != null) {
      // FC→BR 동안 trunk 잃은 에너지 ≈ KH→FC 만든 에너지의 -2배 (감속이 더 큼)
      out.dE_trunk_FC_BR = -out.dE_trunk_KH_FC * 2;
      out._dE_trunk_FC_BR_proxy = true;
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
      // ★ v0.45 — scoreSource 정밀 분기 (cohort_theia.js의 getScoreSource 활용)
      let scoreSource = (TC.getScoreSource ? TC.getScoreSource(varName, mode) : null) || 'cohort';
      // ★ 통합 fallback — cohort에 분포 없을 때 임계 기반 점수
      //   P 카테고리(SD), HIGHER (deg/s 등), SIGNED (FC 회전 같은 양수=좋음) 모두 대응
      if (score == null && TM.getFallbackScore) {
        const fb = TM.getFallbackScore(varName, val);
        if (fb != null) {
          score = Math.round(fb);
          scoreSource = TM.P_THRESHOLDS?.[varName] ? 'p_threshold_fallback' :
                        TM.HIGHER_THRESHOLDS?.[varName] ? 'higher_threshold_fallback' :
                        TM.SIGNED_THRESHOLDS?.[varName] ? 'signed_threshold_fallback' : 'fallback';
        }
      }
      // ★ v0.44 — score null이어도 value 있으면 varScores에 넣음 (인과 분석에서 표시)
      varScores[varName] = { value: val, score: score != null ? score : null, polarity: def.polarity, scoreSource };
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

  // ════════════════════════════════════════════════════════════
  // localStorage 기반 선수 저장 / 불러오기 / 재계산
  // ════════════════════════════════════════════════════════════
  const STORAGE_KEY = 'theia_saved_players_v0';

  function _readStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }
  function _writeStorage(obj) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); return true; }
    catch (e) { console.warn('localStorage 쓰기 실패', e); return false; }
  }

  // 현재 결과를 저장 — 비교용 (input + result + fitness 함께)
  function saveCurrentReport(label) {
    if (!LAST_RESULT) return false;
    const all = _readStorage();
    const name = LAST_RESULT._meta?.athlete || CURRENT_PLAYER.name || '신규 선수';
    const key = label || (name + '__' + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, ''));
    all[key] = {
      label: key,
      saved_at: new Date().toISOString(),
      version: ALGORITHM_VERSION,
      player: { ...CURRENT_PLAYER },
      mode: CURRENT_MODE,
      fitness: CURRENT_FITNESS,
      fitness_meta: CURRENT_FITNESS_META,
      result: LAST_RESULT,
    };
    return _writeStorage(all);
  }

  function listSavedPlayers() {
    const all = _readStorage();
    return Object.values(all).map(r => ({
      key: r.label, name: r.player?.name || r.result?._meta?.athlete || '?',
      saved_at: r.saved_at, version: r.version, level: r.player?.level,
    })).sort((a, b) => (b.saved_at || '').localeCompare(a.saved_at || ''));
  }

  function loadSavedPlayer(key) {
    const all = _readStorage();
    return all[key] || null;
  }

  function deleteSavedPlayer(key) {
    const all = _readStorage();
    if (all[key]) {
      delete all[key];
      _writeStorage(all);
      return true;
    }
    return false;
  }

  // 저장된 모든 선수 결과를 현재 산식으로 재계산 (스칼라값은 보존, 점수만 재산출)
  // 실제 c3d.txt가 없으므로 mass·height만으로는 재산출 불가. agg 데이터가 있으면 calculateScores 다시.
  function recomputeAllSaved() {
    const all = _readStorage();
    let updated = 0;
    for (const key of Object.keys(all)) {
      const r = all[key];
      if (!r.result?.varScores) continue;
      // varScores → agg 재구성 (raw value)
      const agg = { _n_trials: r.result._n_trials, _meta: r.result._meta };
      for (const [k, vs] of Object.entries(r.result.varScores)) {
        if (vs.value != null) agg[k] = vs.value;
      }
      try {
        const newResult = calculateScores(agg, r.mode);
        all[key].result = newResult;
        all[key].version = ALGORITHM_VERSION;
        all[key].recomputed_at = new Date().toISOString();
        updated++;
      } catch (e) { console.warn('재계산 실패:', key, e); }
    }
    _writeStorage(all);
    return updated;
  }

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
    saveCurrentReport, listSavedPlayers, loadSavedPlayer, deleteSavedPlayer, recomputeAllSaved,
  };
})();
