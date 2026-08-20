/** Движок ФЭМ. Порт models/engine.py — те же формулы, те же KPI. */

const PHASE_OWN = "own";
const PHASE_RND = "rnd";
const PHASE_SQ = "status_quo";
const SCENARIO_BASE = "base";
const SCENARIO_STRETCH = "stretch";

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

function isStretch(params) {
  return String(params.scenario || SCENARIO_BASE).trim().toLowerCase() === SCENARIO_STRETCH;
}

function clone(value) {
  return structuredClone(value);
}

function channelPromo(traffic, conversion, approvedShare, paidShare, arpu) {
  traffic = Math.max(traffic, 0);
  conversion = Math.min(Math.max(conversion, 0), 1);
  approvedShare = Math.min(Math.max(approvedShare, 0), 1);
  paidShare = Math.min(Math.max(paidShare, 0), 1);
  arpu = Math.max(arpu, 0);
  const activations = traffic * conversion;
  const approved = activations * approvedShare;
  const paid = approved * paidShare;
  return [activations, approved, paid, paid * arpu];
}

export function cardOriginations(params, traffic) {
  let blackShare = enabled(params, "card_black_enabled") ? f(params, "black_share_pct") / 100 : 0;
  let platinumShare = enabled(params, "card_platinum_enabled") ? f(params, "platinum_share_pct") / 100 : 0;
  blackShare = Math.min(Math.max(blackShare, 0), 1);
  platinumShare = Math.min(Math.max(platinumShare, 0), 1);
  const blackLtv = Math.max(0, f(params, "black_ltv"));
  const platinumLtv = Math.max(0, f(params, "platinum_ltv"));
  const blackApps = traffic * blackShare;
  const platinumApps = traffic * platinumShare;
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
  const floor = Math.min(Math.max(f(params, "seo_dip_floor_pct", 70) / 100, 0), 1);
  const recovery = Math.max(0, i(params, "seo_recovery_months", 6));
  const rndMonths = Math.max(0, i(params, "rnd_months"));
  const elapsed = month - rndMonths;
  if (elapsed <= 0) return 1;
  if (recovery <= 0) return floor;
  if (elapsed > recovery) return 1;
  if (recovery === 1) return floor;
  const progress = (elapsed - 1) / (recovery - 1);
  return floor + (1 - floor) * progress;
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

export function funnelRates(params, phase, month = 1) {
  const effects = productEffects(params, month, phase);
  const seo = seoOrganicFactor(params, month, phase);
  const traffic = Math.max(0, f(params, "traffic_month") * effects.traffic * seo);
  const conversion = Math.min(Math.max((f(params, "conversion_pct") / 100) * effects.conversion, 0), 1);
  const approvedShare = Math.min(
    Math.max((f(params, "approved_activation_share_pct", 100) / 100) * effects.approved, 0),
    1,
  );
  const paidShare = Math.min(Math.max((f(params, "paid_partner_share_pct") / 100) * effects.paid, 0), 1);
  const arpu = Math.max(0, f(params, "arpu") * effects.arpu);
  return [traffic, conversion, approvedShare, paidShare, arpu];
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

export function adsFunnel(params, month, phase) {
  if (!adsActive(params, month, phase)) return [0, 0, 0, 0, 0, 0];
  const effects = productEffects(params, month, phase);
  const traffic = Math.max(0, f(params, "ads_traffic_month"));
  const conversion = Math.min(Math.max((f(params, "conversion_pct_ads") / 100) * effects.conversion, 0), 1);
  const approvedShare = Math.min(
    Math.max((f(params, "approved_activation_share_pct_ads", 100) / 100) * effects.approved, 0),
    1,
  );
  const paidShare = Math.min(Math.max((f(params, "paid_partner_share_pct_ads") / 100) * effects.paid, 0), 1);
  const arpu = Math.max(0, f(params, "arpu") * effects.arpu);
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
  const orgPreSeo = Math.max(0, f(params, "traffic_month") * effects.traffic);
  const [orgTraffic, orgCr, orgApproved, orgPaid, orgArpu] = funnelRates(params, phase, month);
  let [adsTraffic, adsCr, adsApproved, adsPaid, adsArpu, adsCost] = adsFunnel(params, month, phase);

  const [orgAct, orgAppr, orgPaidN, orgPromo] = channelPromo(orgTraffic, orgCr, orgApproved, orgPaid, orgArpu);
  const [adsAct, adsAppr, adsPaidN, adsPromo] = channelPromo(adsTraffic, adsCr, adsApproved, adsPaid, adsArpu);

  const traffic = orgTraffic + adsTraffic;
  const activations = orgAct + adsAct;
  const approvedActivations = orgAppr + adsAppr;
  const paidActivations = orgPaidN + adsPaidN;
  const promoRevenue = orgPromo + adsPromo;
  let extraProductRevenue = statusQuo ? 0 : effects.extra_revenue;

  const [blackApps, platinumApps, blackRevenue, platinumRevenue, cardRevenue] = cardOriginations(params, traffic);
  const gross = promoRevenue + cardRevenue + extraProductRevenue;
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
    salaries = opsSalaries;
  }

  const fixed = salaries + support + devCost;
  const totalCosts = fixed + variable + contractorCost + adsCost;
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
    support,
    variable_costs: variable,
    variable_breakdown: vcBreakdown,
    fixed_costs: fixed,
    total_costs: totalCosts,
    cash_flow: cashFlow,
    lift_traffic: effects.traffic,
    lift_conversion: effects.conversion,
    lift_paid: effects.paid,
  };
}

function firstNonneg(rows, field) {
  for (const row of rows) {
    if ((row[field] || 0) >= 0) return row.month;
  }
  return null;
}

export function runModel(inputParams) {
  let params = clone(inputParams);
  const numMonths = Math.max(1, i(params, "num_months", 24));
  const rndMonths = Math.max(0, Math.min(i(params, "rnd_months"), numMonths));
  params.rnd_months = rndMonths;
  params.num_months = numMonths;
  if (!isStretch(params)) params.scenario = SCENARIO_BASE;

  const project = [];
  const statusQuo = [];
  let cumCf = 0;
  let cumSq = 0;
  let cumInc = 0;

  for (let m = 1; m <= numMonths; m += 1) {
    const p = monthRow(m, params, false);
    const s = monthRow(m, params, true);
    cumCf += p.cash_flow;
    cumSq += s.cash_flow;
    const inc = p.cash_flow - s.cash_flow;
    cumInc += inc;
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
  const typicalOwn = ownRows.find((r) => (r.seo_factor || 1) >= 0.999) || ownRows[ownRows.length - 1] || null;
  const typicalRnd = rndRows[0] || null;
  const typicalSq = statusQuo[0] || null;

  let rndInvestment = rndRows.reduce((sum, r) => sum - r.incremental_cf, 0);
  rndInvestment = Math.max(0, rndInvestment);

  const sqMonth1 = monthRow(1, params, true);
  const kpis = {
    scenario: params.scenario || SCENARIO_BASE,
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
    final_cumulative_cf: project[project.length - 1].cumulative_cf,
    final_cumulative_incremental: project[project.length - 1].cumulative_incremental,
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
  return next;
}
