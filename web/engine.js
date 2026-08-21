/** Движок ФЭМ. Порт models/engine.py — те же формулы, те же KPI. */

const PHASE_OWN = "own";
const PHASE_RND = "rnd";
const PHASE_SQ = "status_quo";
const SCENARIO_BASE = "base";
const SCENARIO_STRETCH = "stretch";
const SCENARIO_PESS = "pess";

export const PESS_HAIRCUT = {
  seo_dip_floor_pct: 70,
  seo_recovery_months: 9,
  seo_final_pct: 90,
  rnd_months: 4,
  dev_cost_rnd: 2200000,
  support_ops: 80000,
};

function f(params, key, def = 0) {
  const raw = params[key];
  if (raw === undefined || raw === null || raw === "") return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}

function i(params, key, def = 0) {
  return Math.trunc(f(params, key, def));
}

function enabled(params, key, def = true) {
  const value = params[key];
  if (value === undefined) return def;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    return s !== "0" && s !== "false" && s !== "нет" && s !== "";
  }
  return Boolean(value);
}

function clamp01(value) {
  return Math.min(Math.max(value, 0), 1);
}

export function isStretch(params) {
  return String(params.scenario || SCENARIO_BASE).trim().toLowerCase() === SCENARIO_STRETCH;
}

export function isPess(params) {
  return String(params.scenario || SCENARIO_BASE).trim().toLowerCase() === SCENARIO_PESS;
}

function clone(value) {
  return structuredClone(value);
}

function channelPromo(traffic, conversion, approvedShare, paidShare, arpu) {
  traffic = Math.max(traffic, 0);
  conversion = clamp01(conversion);
  approvedShare = clamp01(approvedShare);
  paidShare = clamp01(paidShare);
  arpu = Math.max(arpu, 0);
  const activations = traffic * conversion;
  const approved = activations * approvedShare;
  const paid = approved * paidShare;
  return [activations, approved, paid, paid * arpu];
}

function ownStart(params) {
  return Math.max(0, i(params, "rnd_months")) + 1;
}

function clampedLaunch(params, key, fallback) {
  return Math.max(ownStart(params), i(params, key, fallback));
}

function trendFactor(params, month) {
  const annual = f(params, "traffic_trend_pct") / 100;
  if (!annual) return 1;
  return (1 + annual) ** ((month - 1) / 12);
}

function ownRamp(startPct, targetPct, elapsed, rampMonths) {
  const start = clamp01(startPct / 100);
  const target = clamp01(targetPct / 100);
  if (elapsed <= 0) return 1;
  if (start === target) return target;
  if (rampMonths <= 0) return target;
  if (elapsed >= rampMonths) return target;
  if (rampMonths === 1) return start;
  const progress = (elapsed - 1) / (rampMonths - 1);
  return start + (target - start) * progress;
}

function coverageFactor(params, month, phase) {
  if (phase === PHASE_SQ || phase === PHASE_RND) return 1;
  const elapsed = month - Math.max(0, i(params, "rnd_months"));
  return ownRamp(
    f(params, "coverage_start_pct", 100),
    f(params, "coverage_target_pct", 100),
    elapsed,
    i(params, "coverage_ramp_months", 0),
  );
}

function monetizationFactor(params, month, phase) {
  if (phase === PHASE_SQ || phase === PHASE_RND) return 1;
  const elapsed = month - Math.max(0, i(params, "rnd_months"));
  return ownRamp(
    f(params, "mon_start_pct", 100),
    f(params, "mon_target_pct", 100),
    elapsed,
    i(params, "mon_ramp_months", 0),
  );
}

export function tidEffects(params, month, phase, statusQuo = false) {
  const idle = { factor: 0, repeatTraffic: 0, convFactor: 1, cardFactor: 1 };
  if (statusQuo || !isStretch(params) || phase !== PHASE_OWN) return idle;
  if (!enabled(params, "tid_enabled", false)) return idle;
  const launch = clampedLaunch(params, "tid_launch", 4);
  if (month < launch) return idle;
  const ramp = Math.max(1, i(params, "tid_ramp_months", 6));
  const factor = clamp01((month - launch + 1) / ramp);
  const auth = Math.max(0, f(params, "tid_auth_share_pct") / 100);
  const repeatLift = Math.max(0, f(params, "tid_repeat_lift_pct") / 100);
  const cpaLift = Math.max(0, f(params, "tid_cpa_lift_pct") / 100);
  const cardLift = Math.max(0, f(params, "tid_card_lift_pct") / 100);
  return {
    factor,
    repeatTraffic: Math.max(0, f(params, "traffic_month")) * auth * repeatLift * factor,
    convFactor: 1 + auth * cpaLift * factor,
    cardFactor: 1 + auth * cardLift * factor,
  };
}

function distributionTraffic(params, month, phase, statusQuo = false) {
  if (statusQuo || !isStretch(params) || phase !== PHASE_OWN) return 0;
  const launch = clampedLaunch(params, "distribution_launch", 7);
  if (month < launch) return 0;
  return Math.max(0, f(params, "stretch_extra_traffic"));
}

function distributionCost(params, month, phase, statusQuo = false) {
  if (statusQuo || !isStretch(params) || phase !== PHASE_OWN) return 0;
  const launch = clampedLaunch(params, "distribution_launch", 7);
  if (month < launch) return 0;
  return Math.max(0, f(params, "distribution_cost"));
}

export function onsiteAdRevenue(params, traffic, month, phase, statusQuo = false) {
  if (statusQuo || !isStretch(params) || phase !== PHASE_OWN) return 0;
  if (!enabled(params, "onsite_ads_enabled", false)) return 0;
  const launch = clampedLaunch(params, "onsite_ad_launch", 4);
  if (month < launch) return 0;
  const impressions = Math.max(0, f(params, "onsite_ad_impressions"));
  const fill = clamp01(f(params, "onsite_ad_fill_pct") / 100);
  const ecpm = Math.max(0, f(params, "onsite_ad_ecpm"));
  return Math.max(0, traffic) * impressions * fill * ecpm / 1000;
}

export function cardOriginations(params, traffic, month = 1, phase = PHASE_OWN, statusQuo = false) {
  const tid = tidEffects(params, month, phase, statusQuo);
  const blackOn = enabled(params, "card_black_enabled");
  const platOn = enabled(params, "card_platinum_enabled");
  const blackLtv = Math.max(0, f(params, "black_ltv"));
  const platinumLtv = Math.max(0, f(params, "platinum_ltv"));

  if (
    isStretch(params)
    && !statusQuo
    && phase === PHASE_OWN
    && enabled(params, "bank_enabled", false)
  ) {
    const launch = clampedLaunch(params, "bank_launch", 5);
    if (month < launch) return [0, 0, 0, 0, 0];
    const ramp = Math.max(1, i(params, "bank_ramp_months", 6));
    const bankFactor = clamp01((month - launch + 1) / ramp);
    const scale = bankFactor * tid.cardFactor;
    const debitRate = blackOn
      ? clamp01(f(params, "debit_show_pct") / 100)
        * clamp01(f(params, "debit_util_pct") / 100)
        * clamp01(f(params, "debit_inc_pct") / 100)
      : 0;
    const creditRate = platOn
      ? clamp01(f(params, "credit_show_pct") / 100)
        * clamp01(f(params, "credit_util_pct") / 100)
        * clamp01(f(params, "credit_inc_pct") / 100)
      : 0;
    const blackApps = traffic * debitRate * scale;
    const platinumApps = traffic * creditRate * scale;
    const blackRevenue = blackApps * blackLtv;
    const platinumRevenue = platinumApps * platinumLtv;
    return [blackApps, platinumApps, blackRevenue, platinumRevenue, blackRevenue + platinumRevenue];
  }

  let blackShare = blackOn ? f(params, "black_share_pct") / 100 : 0;
  let platinumShare = platOn ? f(params, "platinum_share_pct") / 100 : 0;
  blackShare = clamp01(blackShare);
  platinumShare = clamp01(platinumShare);
  const cardScale = (!statusQuo && phase === PHASE_OWN) ? tid.cardFactor : 1;
  const blackApps = traffic * blackShare * cardScale;
  const platinumApps = traffic * platinumShare * cardScale;
  const blackRevenue = blackApps * blackLtv;
  const platinumRevenue = platinumApps * platinumLtv;
  return [blackApps, platinumApps, blackRevenue, platinumRevenue, blackRevenue + platinumRevenue];
}

function initiativeWindow(raw) {
  return [Math.max(1, i(raw, "start_month", 1)), Math.max(0, i(raw, "duration_months", 0))];
}

export function extraRndPayroll(params, month) {
  if (!isStretch(params)) return [0, 0, 0, []];
  let total = 0;
  let people = 0;
  const active = [];
  for (const raw of params.extra_rnd || []) {
    const [start, duration] = initiativeWindow(raw);
    if (duration <= 0) continue;
    if (start <= month && month < start + duration) {
      const headcount = Math.max(0, f(raw, "headcount"));
      const avgSalary = Math.max(0, f(raw, "avg_salary"));
      total += headcount * avgSalary;
      people += headcount;
      active.push(String(raw.name || "").trim() || "RnD");
    }
  }
  return [total, people, people ? total / people : 0, active];
}

export function seoOrganicFactor(params, month, phase) {
  if (phase === PHASE_SQ || phase === PHASE_RND) return 1;
  if (!enabled(params, "seo_dip_enabled", true)) return 1;
  const floor = clamp01(f(params, "seo_dip_floor_pct", 70) / 100);
  const final = clamp01(f(params, "seo_final_pct", 100) / 100);
  const recovery = Math.max(0, i(params, "seo_recovery_months", 6));
  const rndMonths = Math.max(0, i(params, "rnd_months"));
  const elapsed = month - rndMonths;
  if (elapsed <= 0) return 1;
  if (recovery <= 0) return floor;
  if (elapsed > recovery) return final;
  if (recovery === 1) return floor;
  const progress = (elapsed - 1) / (recovery - 1);
  return floor + (final - floor) * progress;
}

export function productEffects(params, month, phase) {
  const effects = {
    traffic: 1,
    conversion: 1,
    approved: 1,
    paid: 1,
    arpu: 1,
    extra_revenue: 0,
  };
  if (!isStretch(params) || phase === PHASE_SQ || phase === PHASE_RND) return effects;

  effects.traffic *= 1 + f(params, "own_traffic_lift_pct") / 100;
  effects.conversion *= 1 + f(params, "own_conversion_lift_pct") / 100;
  effects.approved *= 1 + f(params, "own_approved_share_lift_pct") / 100;
  effects.paid *= 1 + f(params, "own_paid_share_lift_pct") / 100;
  effects.arpu *= 1 + f(params, "own_arpu_lift_pct") / 100;

  for (const raw of params.extra_rnd || []) {
    const [start, duration] = initiativeWindow(raw);
    const doneAt = start + duration;
    if (month < doneAt) continue;
    effects.traffic *= 1 + f(raw, "traffic_lift_pct") / 100;
    effects.conversion *= 1 + f(raw, "conversion_lift_pct") / 100;
    effects.approved *= 1 + f(raw, "approved_lift_pct") / 100;
    effects.paid *= 1 + f(raw, "paid_lift_pct") / 100;
    effects.arpu *= 1 + f(raw, "arpu_lift_pct") / 100;
    effects.extra_revenue += Math.max(0, f(raw, "extra_revenue_month"));
  }
  for (const key of ["traffic", "conversion", "approved", "paid", "arpu"]) {
    effects[key] = Math.max(effects[key], 0);
  }
  return effects;
}

export function funnelRates(params, phase, month = 1, statusQuo = false) {
  const effects = productEffects(params, month, phase);
  const seo = seoOrganicFactor(params, month, phase);
  const tid = tidEffects(params, month, phase, statusQuo);
  const coverage = coverageFactor(params, month, phase);
  const monetization = monetizationFactor(params, month, phase);
  const trend = trendFactor(params, month);
  const seoShare = clamp01(f(params, "seo_share_pct", 100) / 100);
  const baseOrganic = Math.max(0, f(params, "traffic_month") * effects.traffic * trend);
  const seoTraffic = baseOrganic * seoShare * seo;
  const otherTraffic = baseOrganic * (1 - seoShare);
  const extraTraffic = tid.repeatTraffic + distributionTraffic(params, month, phase, statusQuo);
  const traffic = seoTraffic + otherTraffic + extraTraffic;
  const conversion = clamp01((f(params, "conversion_pct") / 100) * effects.conversion * tid.convFactor);
  const approvedShare = clamp01((f(params, "approved_activation_share_pct", 100) / 100) * effects.approved);
  const paidShare = clamp01((f(params, "paid_partner_share_pct") / 100) * effects.paid);
  const arpu = Math.max(0, f(params, "arpu") * effects.arpu * coverage * monetization);
  return [traffic, conversion, approvedShare, paidShare, arpu, seoTraffic, otherTraffic, extraTraffic];
}

export function adsActive(params, month, phase) {
  if (!isStretch(params) || phase === PHASE_SQ) return false;
  if (!enabled(params, "ads_enabled", false)) return false;
  const start = Math.max(1, i(params, "ads_start_month", 1));
  const end = i(params, "ads_end_month", 0);
  if (month < start) return false;
  if (end > 0 && month > end) return false;
  return true;
}

export function adsFunnel(params, month, phase, statusQuo = false) {
  if (!adsActive(params, month, phase)) return [0, 0, 0, 0, 0, 0];
  const effects = productEffects(params, month, phase);
  const tid = tidEffects(params, month, phase, statusQuo);
  const coverage = coverageFactor(params, month, phase);
  const monetization = monetizationFactor(params, month, phase);
  const traffic = Math.max(0, f(params, "ads_traffic_month"));
  const conversion = clamp01((f(params, "conversion_pct_ads") / 100) * effects.conversion * tid.convFactor);
  const approvedShare = clamp01((f(params, "approved_activation_share_pct_ads", 100) / 100) * effects.approved);
  const paidShare = clamp01((f(params, "paid_partner_share_pct_ads") / 100) * effects.paid);
  const arpu = Math.max(0, f(params, "arpu") * effects.arpu * coverage * monetization);
  const cost = Math.max(0, f(params, "ads_cost_month"));
  return [traffic, conversion, approvedShare, paidShare, arpu, cost];
}

function teamForMonth(params, month, phase, statusQuo) {
  if (statusQuo) return [f(params, "salaries_status_quo"), 0, 0];
  if (!isStretch(params)) return [0, 0, 0];

  for (const raw of params.team_schedule || []) {
    if (i(raw, "month") !== month) continue;
    const headcount = f(raw, "headcount");
    const avgSalary = f(raw, "avg_salary");
    return [Math.max(0, headcount) * Math.max(0, avgSalary), headcount, avgSalary];
  }

  if (phase === PHASE_RND) {
    const headcount = f(params, "team_headcount_rnd");
    const avgSalary = f(params, "team_avg_salary_rnd");
    if (headcount || avgSalary) {
      return [Math.max(0, headcount) * Math.max(0, avgSalary), headcount, avgSalary];
    }
    return [f(params, "salaries_rnd"), 0, 0];
  }

  const headcount = f(params, "team_headcount_ops");
  const avgSalary = f(params, "team_avg_salary_ops");
  if (headcount || avgSalary) {
    return [Math.max(0, headcount) * Math.max(0, avgSalary), headcount, avgSalary];
  }
  return [f(params, "salaries_ops"), 0, 0];
}

function hasPhaseSplit(raw) {
  return raw.rnd != null || raw.ops != null || raw.status_quo != null;
}

function itemRate(raw, phase) {
  if (hasPhaseSplit(raw)) {
    let value = 0;
    if (phase === PHASE_SQ) value = Number(raw.status_quo || 0);
    else if (phase === PHASE_RND) value = Number(raw.rnd || 0);
    else value = Number(raw.ops || 0);
    return Number.isFinite(value) ? value : 0;
  }

  const itemPhase = String(raw.phase || "own");
  const applies =
    itemPhase === "both" ||
    itemPhase === phase ||
    (phase === PHASE_SQ && (itemPhase === "rnd" || itemPhase === "both" || itemPhase === PHASE_SQ));
  if (!applies) return null;
  const value = Number(raw.value || 0);
  return Number.isFinite(value) ? value : 0;
}

export function calculateVariableCosts(items, phase, traffic, activations, paidActivations, grossRevenue) {
  let total = 0;
  const breakdown = {};
  for (const raw of items || []) {
    const name = String(raw.name || "").trim();
    if (!name) continue;
    const value = itemRate(raw, phase);
    if (value == null) continue;

    const kind = String(raw.kind || "fixed");
    let amount = 0;
    if (kind === "fixed") amount = value;
    else if (kind === "per_paid_activation") amount = value * paidActivations;
    else if (kind === "per_activation") amount = value * activations;
    else if (kind === "pct_of_revenue") amount = (grossRevenue * value) / 100;

    breakdown[name] = (breakdown[name] || 0) + amount;
    total += amount;
  }
  return [total, breakdown];
}

function phaseAmount(params, phase, rndKey, opsKey, sqKey, fallbackRnd = 0, fallbackOps = 0, fallbackSq = 0) {
  if (phase === PHASE_SQ) return f(params, sqKey, fallbackSq);
  if (phase === PHASE_RND) return f(params, rndKey, fallbackRnd);
  return f(params, opsKey, fallbackOps);
}

function monthRow(month, params, statusQuo) {
  const rndMonths = Math.max(0, i(params, "rnd_months"));
  let phase;
  let contractorPct;
  let support;
  let vcPhase;
  let devCost;

  if (statusQuo) {
    phase = PHASE_SQ;
    vcPhase = PHASE_SQ;
  } else if (month <= rndMonths) {
    phase = PHASE_RND;
    vcPhase = PHASE_RND;
  } else {
    phase = PHASE_OWN;
    vcPhase = PHASE_OWN;
  }

  const contractorFallback = f(params, "contractor_share_pct");
  contractorPct = phaseAmount(
    params, phase,
    "contractor_share_rnd", "contractor_share_ops", "contractor_share_status_quo",
    contractorFallback, 0, contractorFallback,
  ) / 100;
  support = phaseAmount(params, phase, "support_rnd", "support_ops", "support_status_quo");
  devCost = Math.max(0, phaseAmount(
    params, phase,
    "dev_cost_rnd", "dev_cost_ops", "dev_cost_status_quo",
    f(params, "dev_cost_month"), 0, 0,
  ));

  const effects = productEffects(params, month, phase);
  const seo = seoOrganicFactor(params, month, phase);
  const tid = tidEffects(params, month, phase, statusQuo);
  const coverage = coverageFactor(params, month, phase);
  const monetization = monetizationFactor(params, month, phase);
  const orgPreSeo = Math.max(0, f(params, "traffic_month") * effects.traffic * trendFactor(params, month));
  const [orgTraffic, orgCr, orgApproved, orgPaid, orgArpu] = funnelRates(params, phase, month, statusQuo);
  let [adsTraffic, adsCr, adsApproved, adsPaid, adsArpu, adsCost] = adsFunnel(params, month, phase, statusQuo);

  const [orgAct, orgAppr, orgPaidN, orgPromo] = channelPromo(orgTraffic, orgCr, orgApproved, orgPaid, orgArpu);
  const [adsAct, adsAppr, adsPaidN, adsPromo] = channelPromo(adsTraffic, adsCr, adsApproved, adsPaid, adsArpu);

  const traffic = orgTraffic + adsTraffic;
  const activations = orgAct + adsAct;
  const approvedActivations = orgAppr + adsAppr;
  const paidActivations = orgPaidN + adsPaidN;
  const promoRevenue = orgPromo + adsPromo;
  let extraProductRevenue = statusQuo ? 0 : effects.extra_revenue;
  let onsiteAds = onsiteAdRevenue(params, traffic, month, phase, statusQuo);
  let distCost = distributionCost(params, month, phase, statusQuo);
  let transition = 0;
  if (!statusQuo && month === rndMonths + 1) {
    transition = Math.max(0, f(params, "transition_cost"));
  }

  const [blackApps, platinumApps, blackRevenue, platinumRevenue, cardRevenue] = cardOriginations(
    params, traffic, month, phase, statusQuo,
  );
  const gross = promoRevenue + cardRevenue + extraProductRevenue + onsiteAds;
  const contractorCost = promoRevenue * contractorPct;

  const [opsSalaries, teamHeadcount, teamAvgSalary] = teamForMonth(params, month, phase, statusQuo);
  let [rndSalaries, rndHeadcount, rndAvgSalary, rndNames] = extraRndPayroll(statusQuo ? {} : params, month);
  let salaries = opsSalaries + rndSalaries;

  const [variable, vcBreakdown] = calculateVariableCosts(
    params.variable_costs || [],
    vcPhase,
    traffic,
    activations,
    paidActivations,
    gross,
  );

  if (statusQuo) {
    adsCost = 0;
    rndSalaries = 0;
    rndHeadcount = 0;
    rndAvgSalary = 0;
    rndNames = [];
    extraProductRevenue = 0;
    onsiteAds = 0;
    distCost = 0;
    transition = 0;
    salaries = opsSalaries;
  }

  const fixed = salaries + support + devCost;
  const totalCosts = fixed + variable + contractorCost + adsCost + distCost + transition;
  const cashFlow = gross - totalCosts;
  const teamTotal = teamHeadcount + rndHeadcount;

  return {
    month,
    phase,
    traffic,
    organic_traffic: orgTraffic,
    organic_traffic_pre_seo: orgPreSeo,
    seo_factor: seo,
    ads_traffic: adsTraffic,
    conversion: orgCr,
    approved_share: orgApproved,
    paid_share: orgPaid,
    arpu: orgArpu,
    ads_conversion: adsCr,
    ads_approved_share: adsApproved,
    ads_paid_share: adsPaid,
    activations,
    organic_activations: orgAct,
    ads_activations: adsAct,
    approved_activations: approvedActivations,
    paid_activations: paidActivations,
    organic_paid_activations: orgPaidN,
    ads_paid_activations: adsPaidN,
    black_apps: blackApps,
    platinum_apps: platinumApps,
    promo_revenue: promoRevenue,
    organic_promo_revenue: orgPromo,
    ads_promo_revenue: adsPromo,
    extra_product_revenue: extraProductRevenue,
    onsite_ad_revenue: onsiteAds,
    black_revenue: blackRevenue,
    platinum_revenue: platinumRevenue,
    card_revenue: cardRevenue,
    team_headcount: teamTotal,
    team_avg_salary: teamTotal ? salaries / teamTotal : 0,
    ops_headcount: teamHeadcount,
    ops_avg_salary: teamAvgSalary,
    extra_rnd_headcount: rndHeadcount,
    extra_rnd_avg_salary: rndAvgSalary,
    extra_rnd_names: rndNames,
    gross_revenue: gross,
    net_revenue: gross - contractorCost,
    contractor_cost: contractorCost,
    salaries,
    ops_salaries: opsSalaries,
    extra_rnd_salaries: rndSalaries,
    dev_cost: devCost,
    ads_cost: adsCost,
    distribution_cost: distCost,
    transition_cost: transition,
    support,
    variable_costs: variable,
    variable_breakdown: vcBreakdown,
    fixed_costs: fixed,
    total_costs: totalCosts,
    cash_flow: cashFlow,
    lift_traffic: effects.traffic,
    lift_conversion: effects.conversion,
    lift_paid: effects.paid,
    tid_factor: tid.factor,
    tid_repeat_traffic: tid.repeatTraffic,
    tid_conv_factor: tid.convFactor,
    tid_card_factor: tid.cardFactor,
    coverage,
    monetization,
  };
}

function firstNonneg(rows, field) {
  for (const row of rows) {
    if ((row[field] || 0) >= 0) return row.month;
  }
  return null;
}

function normalizeScenarioName(params) {
  const raw = String(params.scenario || SCENARIO_BASE).trim().toLowerCase();
  if (raw === SCENARIO_STRETCH) return SCENARIO_STRETCH;
  if (raw === SCENARIO_PESS) return SCENARIO_PESS;
  return SCENARIO_BASE;
}

export function runModel(inputParams) {
  let params = clone(inputParams);
  const numMonths = Math.max(1, i(params, "num_months", 24));
  const rndMonths = Math.max(0, Math.min(i(params, "rnd_months"), numMonths));
  params.rnd_months = rndMonths;
  params.num_months = numMonths;
  params.scenario = normalizeScenarioName(params);

  const project = [];
  const statusQuo = [];
  let cumCf = 0;
  let cumSq = 0;
  let cumInc = 0;
  let minCumInc = 0;

  for (let m = 1; m <= numMonths; m += 1) {
    const p = monthRow(m, params, false);
    const s = monthRow(m, params, true);
    cumCf += p.cash_flow;
    cumSq += s.cash_flow;
    const inc = p.cash_flow - s.cash_flow;
    cumInc += inc;
    minCumInc = Math.min(minCumInc, cumInc);
    p.cumulative_cf = cumCf;
    s.cumulative_cf = cumSq;
    p.sq_cash_flow = s.cash_flow;
    p.sq_organic_traffic = s.organic_traffic;
    p.incremental_cf = inc;
    p.cumulative_incremental = cumInc;
    project.push(p);
    statusQuo.push(s);
  }

  const paybackProject = firstNonneg(project, "cumulative_cf");
  const paybackIncremental = firstNonneg(project, "cumulative_incremental");
  const ownRows = project.filter((r) => r.phase === PHASE_OWN);
  const rndRows = project.filter((r) => r.phase === PHASE_RND);
  const typicalOwnLaunch = ownRows[0] || null;
  const terminalSeo = seoOrganicFactor(params, rndMonths + Math.max(0, i(params, "seo_recovery_months", 6)) + 1, PHASE_OWN);
  const typicalOwn = ownRows.find((r) => Math.abs((r.seo_factor || 1) - terminalSeo) < 0.001) || ownRows[ownRows.length - 1] || null;
  const typicalRnd = rndRows[0] || null;
  const typicalSq = statusQuo[0] || null;

  let rndInvestment = rndRows.reduce((sum, r) => sum - r.incremental_cf, 0);
  rndInvestment = Math.max(0, rndInvestment);

  const yearIndex = Math.min(11, project.length - 1);
  const sqMonth1 = monthRow(1, params, true);
  const kpis = {
    scenario: params.scenario,
    num_months: numMonths,
    rnd_months: rndMonths,
    gross_month_base: sqMonth1.gross_revenue,
    promo_revenue_base: sqMonth1.promo_revenue,
    card_revenue_base: sqMonth1.card_revenue,
    paid_activations_base: sqMonth1.paid_activations,
    approved_activations_base: sqMonth1.approved_activations,
    activations_base: sqMonth1.activations,
    total_gross: project.reduce((s, r) => s + r.gross_revenue, 0),
    total_costs: project.reduce((s, r) => s + r.total_costs, 0),
    total_cf: project.reduce((s, r) => s + r.cash_flow, 0),
    total_incremental: project.reduce((s, r) => s + r.incremental_cf, 0),
    total_ads_cost: project.reduce((s, r) => s + r.ads_cost, 0),
    total_extra_rnd_salaries: project.reduce((s, r) => s + r.extra_rnd_salaries, 0),
    total_dev_cost: project.reduce((s, r) => s + r.dev_cost, 0),
    total_organic_promo: project.reduce((s, r) => s + r.organic_promo_revenue, 0),
    total_ads_promo: project.reduce((s, r) => s + r.ads_promo_revenue, 0),
    total_onsite_ads: project.reduce((s, r) => s + (r.onsite_ad_revenue || 0), 0),
    total_card_revenue: project.reduce((s, r) => s + (r.card_revenue || 0), 0),
    final_cumulative_cf: project[project.length - 1].cumulative_cf,
    final_cumulative_incremental: project[project.length - 1].cumulative_incremental,
    year_incremental: project[yearIndex].cumulative_incremental,
    max_need: Math.abs(minCumInc),
    payback_project_month: paybackProject,
    payback_incremental_month: paybackIncremental,
    rnd_investment: rndInvestment,
    typical_own: typicalOwn,
    typical_own_launch: typicalOwnLaunch,
    typical_rnd: typicalRnd,
    typical_sq: typicalSq,
  };

  return { params, project, status_quo: statusQuo, kpis };
}

export function sensitivityTable(params, deltas = [-0.2, 0, 0.2]) {
  const drivers = [
    ["traffic_month", "Органический трафик / мес"],
    ["conversion_pct", "Конверсия органики"],
    ["approved_activation_share_pct", "Доля одобренных (органика)"],
    ["paid_partner_share_pct", "Доля оплачиваемых (органика)"],
    ["arpu", "ARPU"],
    ["black_share_pct", "Доля оформлений Black"],
    ["black_ltv", "LTV Black"],
    ["platinum_share_pct", "Доля оформлений Platinum"],
    ["platinum_ltv", "LTV Platinum"],
  ];
  if (enabled(params, "seo_dip_enabled", true)) {
    drivers.push(
      ["seo_dip_floor_pct", "SEO-пол после переезда"],
      ["seo_recovery_months", "Срок восстановления SEO, мес."],
      ["seo_final_pct", "SEO после восстановления"],
    );
  }
  if (isStretch(params) && enabled(params, "ads_enabled", false)) {
    drivers.push(
      ["ads_traffic_month", "Рекламный трафик / мес"],
      ["conversion_pct_ads", "Конверсия рекламы"],
      ["paid_partner_share_pct_ads", "Доля оплачиваемых (реклама)"],
      ["ads_cost_month", "Бюджет рекламы / мес"],
    );
  }
  if (isStretch(params) && enabled(params, "tid_enabled", false)) {
    drivers.push(["tid_auth_share_pct", "T-ID: доля авторизованных"]);
  }
  if (isStretch(params) && enabled(params, "onsite_ads_enabled", false)) {
    drivers.push(["onsite_ad_ecpm", "Onsite eCPM"]);
  }
  if (isStretch(params) && enabled(params, "bank_enabled", false)) {
    drivers.push(
      ["debit_show_pct", "Black: показ"],
      ["credit_show_pct", "Platinum: показ"],
    );
  }
  const out = {};
  for (const [key, label] of drivers) {
    const baseVal = f(params, key);
    out[key] = deltas.map((d) => {
      const trial = clone(params);
      trial[key] = baseVal * (1 + d);
      const result = runModel(trial);
      return {
        delta: d,
        label,
        total_incremental: result.kpis.total_incremental,
        payback: result.kpis.payback_incremental_month,
        final_cf: result.kpis.final_cumulative_cf,
      };
    });
  }
  return out;
}

export function applyBaseConstraints(params) {
  const next = clone(params);
  next.scenario = SCENARIO_BASE;
  next.team_schedule = [];
  next.extra_rnd = [];
  next.ads_enabled = false;
  next.ads_traffic_month = 0;
  next.ads_cost_month = 0;
  next.team_headcount_rnd = 0;
  next.team_headcount_ops = 0;
  next.salaries_rnd = 0;
  next.salaries_ops = 0;
  next.own_traffic_lift_pct = 0;
  next.own_conversion_lift_pct = 0;
  next.own_approved_share_lift_pct = 0;
  next.own_paid_share_lift_pct = 0;
  next.own_arpu_lift_pct = 0;
  next.tid_enabled = false;
  next.tid_auth_share_pct = 0;
  next.tid_repeat_lift_pct = 0;
  next.tid_cpa_lift_pct = 0;
  next.tid_card_lift_pct = 0;
  next.onsite_ads_enabled = false;
  next.onsite_ad_impressions = 0;
  next.onsite_ad_fill_pct = 0;
  next.onsite_ad_ecpm = 0;
  next.bank_enabled = false;
  next.debit_show_pct = 0;
  next.debit_util_pct = 0;
  next.debit_inc_pct = 0;
  next.credit_show_pct = 0;
  next.credit_util_pct = 0;
  next.credit_inc_pct = 0;
  next.stretch_extra_traffic = 0;
  next.distribution_cost = 0;
  next.coverage_start_pct = 100;
  next.coverage_target_pct = 100;
  next.mon_start_pct = 100;
  next.mon_target_pct = 100;
  return next;
}

export function applyPessConstraints(params) {
  const next = applyBaseConstraints(params);
  next.scenario = SCENARIO_PESS;
  return next;
}

export function applyPessHaircut(params) {
  const next = applyPessConstraints(params);
  Object.assign(next, PESS_HAIRCUT);
  next.dev_cost_month = next.dev_cost_rnd;
  return next;
}
