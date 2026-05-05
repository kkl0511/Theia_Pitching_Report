/**
 * cohort_theia.js — 듀얼 코호트 reference wrapper
 *   ① cohort_theia_hs_top10_v0.json — 고교 1학년 상위 10% 실측 (n=41)
 *   ② cohort_theia_pro_v0.json — 문헌+Driveline Pro reference (Gaussian)
 *
 * Mode 분기: percentile (HS Top 10%) / Gaussian (Pro)
 * Exposes: window.TheiaCohort = { load, getDist, getMode, percentile, gaussianScore }
 */
(function () {
  'use strict';

  let HS_DATA = null;
  let PRO_DATA = null;
  let LOADED = false;

  // Inline JSON (fetch 미사용 — file:// 환경 호환)
  HS_DATA = /* @COHORT_HS_TOP10_JSON@ */ null;
  PRO_DATA = /* @COHORT_PRO_JSON@ */ null;

  /**
   * load() — 외부 JSON 동적 로드 (서빙 환경에서). file:// 환경에서는 inline 데이터 사용.
   */
  async function load(opts = {}) {
    if (LOADED) return;
    if (HS_DATA && PRO_DATA) {
      LOADED = true;
      return;
    }
    try {
      const hsPath = opts.hsPath || './cohort_theia_hs_top10_v0.json';
      const proPath = opts.proPath || './cohort_theia_pro_v0.json';
      [HS_DATA, PRO_DATA] = await Promise.all([
        fetch(hsPath).then(r => r.json()),
        fetch(proPath).then(r => r.json())
      ]);
      LOADED = true;
    } catch (e) {
      console.warn('TheiaCohort: 외부 JSON 로드 실패. inline 데이터 또는 수동 setData 필요.', e);
    }
  }

  /**
   * 외부에서 직접 데이터 주입 (file:// 또는 사용자 임의 데이터)
   */
  function setData(hs, pro) {
    HS_DATA = hs;
    PRO_DATA = pro;
    LOADED = true;
  }

  /**
   * 변수 분포 가져오기. mode = 'hs_top10' or 'pro'
   * 반환: HS는 {mean, stdev, median, q25, q75, min, max, n}, Pro는 {optimal, sigma, ref, polarity, ...}
   */
  function getDist(varName, mode) {
    const data = mode === 'pro' ? PRO_DATA : HS_DATA;
    if (!data) return null;
    return data.var_distributions?.[varName] || null;
  }

  function getMode(modeId) {
    const data = modeId === 'pro' ? PRO_DATA : HS_DATA;
    if (!data) return null;
    return {
      id: data.meta.cohort_id,
      label: data.meta.cohort_label_kr,
      target: data.meta.evaluation_target,
      n: data.meta.n_players,
      desc: data.meta.cohort_description,
    };
  }

  /**
   * Percentile 산출 (HS mode) — 코호트 상위 N% 위치
   * polarity: 'higher' (높을수록 좋음) / 'lower' (낮을수록 좋음) / 'absolute' (양방향 sigma)
   */
  function percentile(value, varName, polarity = 'higher') {
    const dist = getDist(varName, 'hs_top10');
    if (!dist || value == null || isNaN(value)) return null;
    const { mean, stdev, q25, q75 } = dist;
    if (stdev === 0) return 50;

    // Z-score 기반 normal CDF approximation
    let z = (value - mean) / stdev;
    if (polarity === 'lower') z = -z;
    if (polarity === 'absolute') z = -Math.abs(z);

    // Normal CDF (Abramowitz approximation)
    const cdf = 0.5 * (1 + _erf(z / Math.SQRT2));
    return Math.round(cdf * 100);
  }

  /**
   * Gaussian score (Pro mode) — 문헌 optimal 대비 점수
   * 정의: score = 100 × exp(-((value - optimal)/sigma)² / 2)
   */
  function gaussianScore(value, varName) {
    const dist = getDist(varName, 'pro');
    if (!dist || value == null || isNaN(value)) return null;
    const { optimal, sigma, polarity } = dist;
    if (sigma == null || sigma === 0) return null;

    const dev = (value - optimal) / sigma;
    let score;
    if (polarity === 'higher') {
      // 양수 dev = 좋음, 음수 = 페널티 (sigma 1당 -34점)
      score = 50 + 50 * _erf(dev / Math.SQRT2);
    } else if (polarity === 'lower') {
      score = 50 - 50 * _erf(dev / Math.SQRT2);
    } else {
      // absolute — 양방향 페널티 (절대값 가까울수록 좋음)
      score = 100 * Math.exp(-(dev * dev) / 2);
    }
    return Math.round(Math.max(0, Math.min(100, score)));
  }

  /**
   * 점수 산출 wrapper — mode에 따라 percentile or gaussian 자동 분기
   */
  function getScore(value, varName, polarity, mode) {
    if (mode === 'pro') {
      return gaussianScore(value, varName);
    } else {
      return percentile(value, varName, polarity);
    }
  }

  // Approximate erf function (Abramowitz & Stegun)
  function _erf(x) {
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;
    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return sign * y;
  }

  function isLoaded() { return LOADED; }
  function getRawData(mode) {
    return mode === 'pro' ? PRO_DATA : HS_DATA;
  }

  window.TheiaCohort = {
    load, setData, getDist, getMode, getScore, percentile, gaussianScore,
    isLoaded, getRawData
  };
})();
