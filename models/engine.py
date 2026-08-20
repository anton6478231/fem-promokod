"""
Движок ФЭМ сайта промокодов. Два сценария, одна формула.

Выручка промо по каналу:
    R_promo = traffic × CR × S_approved × S_paid × ARPU

    conversion = клик «Активировать» / переход на сайт партнёра
    approved   = доля тех, кто не отвалился у партнёра (целевое действие)
    paid       = доля одобренных, которых партнёр подтвердил и оплатил

    Карты: R_cards = traffic_total × share × LTV (доля подрядчика не режется).

SEO-просадка (только органика, только свой сайт):
    После RnD внешний трафик падает до seo_dip_floor_pct от исходного
    и за seo_recovery_months линейно возвращается к 100%.
    Статус-кво и реклама не проседают. Продуктовые лифты Stretch умножаются сверху.

Сценарии:
    Base    — забрать сайт на текущем органическом трафике.
              RnD-месяцы: доля подрядчика + стоимость разработки.
              После запуска: только поддержка (без зарплат, без рекламы, без лифтов).
    Stretch — Base + доп. продуктовый RnD (зарплаты и лифты после завершения) +
              рекламный трафик с отдельной воронкой активации + опционально команда.

Статус-кво: сайт навсегда у подрядчика (без разработки, без команды, без рекламы).
Инкрементальный CF = CF проекта − CF статус-кво.
Срок окупаемости = первый месяц, где накопленный инкремент ≥ 0.
"""
from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict, List, Optional, Tuple


VC_KINDS = (
    "fixed",
    "per_paid_activation",
    "per_activation",
    "pct_of_revenue",
)

PHASE_OWN = "own"
PHASE_RND = "rnd"
PHASE_SQ = "status_quo"
SCENARIO_BASE = "base"
SCENARIO_STRETCH = "stretch"


def _f(params: Dict, key: str, default: float = 0.0) -> float:
    try:
        return float(params.get(key, default) or 0.0)
    except (TypeError, ValueError):
        return default


def _i(params: Dict, key: str, default: int = 0) -> int:
    try:
        return int(params.get(key, default) or 0)
    except (TypeError, ValueError):
        return default


def _enabled(params: Dict, key: str, default: bool = True) -> bool:
    value = params.get(key, default)
    if isinstance(value, str):
        return value.strip().lower() not in ("0", "false", "нет", "")
    return bool(value)


def _is_stretch(params: Dict) -> bool:
    return str(params.get("scenario") or SCENARIO_BASE).strip().lower() == SCENARIO_STRETCH


def _channel_promo(
    traffic: float,
    conversion: float,
    approved_share: float,
    paid_share: float,
    arpu: float,
) -> Tuple[float, float, float, float]:
    """activations, approved, paid, promo revenue."""
    traffic = max(traffic, 0.0)
    conversion = min(max(conversion, 0.0), 1.0)
    approved_share = min(max(approved_share, 0.0), 1.0)
    paid_share = min(max(paid_share, 0.0), 1.0)
    arpu = max(arpu, 0.0)
    activations = traffic * conversion
    approved = activations * approved_share
    paid = approved * paid_share
    return activations, approved, paid, paid * arpu


def card_originations(params: Dict, traffic: float) -> Tuple[float, float, float, float, float]:
    """black apps, platinum apps, black revenue, platinum revenue, card revenue."""
    black_share = _f(params, "black_share_pct") / 100.0 if _enabled(params, "card_black_enabled") else 0.0
    platinum_share = _f(params, "platinum_share_pct") / 100.0 if _enabled(params, "card_platinum_enabled") else 0.0
    black_share = min(max(black_share, 0.0), 1.0)
    platinum_share = min(max(platinum_share, 0.0), 1.0)
    black_ltv = max(0.0, _f(params, "black_ltv"))
    platinum_ltv = max(0.0, _f(params, "platinum_ltv"))
    black_apps = traffic * black_share
    platinum_apps = traffic * platinum_share
    black_revenue = black_apps * black_ltv
    platinum_revenue = platinum_apps * platinum_ltv
    return black_apps, platinum_apps, black_revenue, platinum_revenue, black_revenue + platinum_revenue


def _initiative_window(raw: Dict[str, Any]) -> Tuple[int, int]:
    start = max(1, _i(raw, "start_month", 1))
    duration = max(0, _i(raw, "duration_months", 0))
    return start, duration


def extra_rnd_payroll(params: Dict, month: int) -> Tuple[float, float, float, List[str]]:
    """Фонд доп. RnD в месяце: (₽, люди, средняя ЗП, имена активных инициатив)."""
    if not _is_stretch(params):
        return 0.0, 0.0, 0.0, []
    total = 0.0
    people = 0.0
    active: List[str] = []
    for raw in params.get("extra_rnd") or []:
        start, duration = _initiative_window(raw)
        if duration <= 0:
            continue
        if start <= month < start + duration:
            headcount = max(0.0, _f(raw, "headcount"))
            avg_salary = max(0.0, _f(raw, "avg_salary"))
            total += headcount * avg_salary
            people += headcount
            name = str(raw.get("name") or "").strip() or "RnD"
            active.append(name)
    avg = (total / people) if people else 0.0
    return total, people, avg, active


def seo_organic_factor(params: Dict, month: int, phase: str) -> float:
    """Доля исходной органики после переезда на свой сайт.

    RnD и статус-кво: 1.0 (домен подрядчика, ранжирование не ломаем).
    Первый месяц своего сайта: seo_dip_floor_pct / 100 (по умолчанию 70%).
    К seo_recovery_months-му месяцу своего сайта линейно 100%.
    recovery = 0 → пол навсегда. Рекламу не трогает.
    """
    if phase in (PHASE_SQ, PHASE_RND):
        return 1.0
    if not _enabled(params, "seo_dip_enabled", True):
        return 1.0

    floor = min(max(_f(params, "seo_dip_floor_pct", 70.0) / 100.0, 0.0), 1.0)
    recovery = max(0, _i(params, "seo_recovery_months", 6))
    rnd_months = max(0, _i(params, "rnd_months"))
    elapsed = month - rnd_months
    if elapsed <= 0:
        return 1.0
    if recovery <= 0:
        return floor
    if elapsed > recovery:
        return 1.0
    if recovery == 1:
        return floor
    progress = (elapsed - 1) / (recovery - 1)
    return floor + (1.0 - floor) * progress


def product_effects(params: Dict, month: int, phase: str) -> Dict[str, float]:
    """Мультипликаторы воронки и доп. выручка после завершённых инициатив."""
    effects = {
        "traffic": 1.0,
        "conversion": 1.0,
        "approved": 1.0,
        "paid": 1.0,
        "arpu": 1.0,
        "extra_revenue": 0.0,
    }
    if not _is_stretch(params) or phase in (PHASE_SQ, PHASE_RND):
        return effects

    effects["traffic"] *= 1.0 + _f(params, "own_traffic_lift_pct") / 100.0
    effects["conversion"] *= 1.0 + _f(params, "own_conversion_lift_pct") / 100.0
    effects["approved"] *= 1.0 + _f(params, "own_approved_share_lift_pct") / 100.0
    effects["paid"] *= 1.0 + _f(params, "own_paid_share_lift_pct") / 100.0
    effects["arpu"] *= 1.0 + _f(params, "own_arpu_lift_pct") / 100.0

    for raw in params.get("extra_rnd") or []:
        start, duration = _initiative_window(raw)
        done_at = start + duration
        if month < done_at:
            continue
        effects["traffic"] *= 1.0 + _f(raw, "traffic_lift_pct") / 100.0
        effects["conversion"] *= 1.0 + _f(raw, "conversion_lift_pct") / 100.0
        effects["approved"] *= 1.0 + _f(raw, "approved_lift_pct") / 100.0
        effects["paid"] *= 1.0 + _f(raw, "paid_lift_pct") / 100.0
        effects["arpu"] *= 1.0 + _f(raw, "arpu_lift_pct") / 100.0
        effects["extra_revenue"] += max(0.0, _f(raw, "extra_revenue_month"))

    for key in ("traffic", "conversion", "approved", "paid", "arpu"):
        effects[key] = max(effects[key], 0.0)
    return effects


def funnel_rates(params: Dict, phase: str, month: int = 1) -> Tuple[float, float, float, float, float]:
    """Органический канал: traffic, conversion, approved, paid [0..1], arpu."""
    effects = product_effects(params, month, phase)
    seo = seo_organic_factor(params, month, phase)
    traffic = max(0.0, _f(params, "traffic_month") * effects["traffic"] * seo)
    conversion = min(max(_f(params, "conversion_pct") / 100.0 * effects["conversion"], 0.0), 1.0)
    approved_share = min(max(_f(params, "approved_activation_share_pct", 100.0) / 100.0 * effects["approved"], 0.0), 1.0)
    paid_share = min(max(_f(params, "paid_partner_share_pct") / 100.0 * effects["paid"], 0.0), 1.0)
    arpu = max(0.0, _f(params, "arpu") * effects["arpu"])
    return traffic, conversion, approved_share, paid_share, arpu


def ads_active(params: Dict, month: int, phase: str) -> bool:
    if not _is_stretch(params) or phase == PHASE_SQ:
        return False
    if not _enabled(params, "ads_enabled", False):
        return False
    start = max(1, _i(params, "ads_start_month", 1))
    end = _i(params, "ads_end_month", 0)
    if month < start:
        return False
    if end > 0 and month > end:
        return False
    return True


def ads_funnel(params: Dict, month: int, phase: str) -> Tuple[float, float, float, float, float, float]:
    """traffic, conversion, approved, paid, arpu, ads_cost. Нулевые, если реклама выключена."""
    if not ads_active(params, month, phase):
        return 0.0, 0.0, 0.0, 0.0, 0.0, 0.0
    effects = product_effects(params, month, phase)
    traffic = max(0.0, _f(params, "ads_traffic_month"))
    conversion = min(max(_f(params, "conversion_pct_ads") / 100.0 * effects["conversion"], 0.0), 1.0)
    approved_share = min(
        max(_f(params, "approved_activation_share_pct_ads", 100.0) / 100.0 * effects["approved"], 0.0),
        1.0,
    )
    paid_share = min(max(_f(params, "paid_partner_share_pct_ads") / 100.0 * effects["paid"], 0.0), 1.0)
    arpu = max(0.0, _f(params, "arpu") * effects["arpu"])
    cost = max(0.0, _f(params, "ads_cost_month"))
    return traffic, conversion, approved_share, paid_share, arpu, cost


def _team_for_month(params: Dict, month: int, phase: str, *, status_quo: bool) -> Tuple[float, float, float]:
    """Сопровождение/шаблон команды. В Base всегда 0. Статус-кво — отдельное поле."""
    if status_quo:
        return _f(params, "salaries_status_quo"), 0.0, 0.0
    if not _is_stretch(params):
        return 0.0, 0.0, 0.0

    for raw in params.get("team_schedule") or []:
        if _i(raw, "month") != month:
            continue
        headcount = _f(raw, "headcount")
        avg_salary = _f(raw, "avg_salary")
        return max(0.0, headcount) * max(0.0, avg_salary), headcount, avg_salary

    if phase == PHASE_RND:
        headcount = _f(params, "team_headcount_rnd")
        avg_salary = _f(params, "team_avg_salary_rnd")
        if headcount or avg_salary:
            return max(0.0, headcount) * max(0.0, avg_salary), headcount, avg_salary
        return _f(params, "salaries_rnd"), 0.0, 0.0

    headcount = _f(params, "team_headcount_ops")
    avg_salary = _f(params, "team_avg_salary_ops")
    if headcount or avg_salary:
        return max(0.0, headcount) * max(0.0, avg_salary), headcount, avg_salary
    return _f(params, "salaries_ops"), 0.0, 0.0


def calculate_variable_costs(
    items: List[Dict[str, Any]],
    phase: str,
    traffic: float,
    activations: float,
    paid_activations: float,
    gross_revenue: float,
) -> Tuple[float, Dict[str, float]]:
    """Сумма переменных статей, попадающих в фазу. phase='status_quo' берёт rnd+both."""
    total = 0.0
    breakdown: Dict[str, float] = {}

    for raw in items or []:
        name = str(raw.get("name") or "").strip()
        if not name:
            continue
        item_phase = str(raw.get("phase") or "own")
        applies = (
            item_phase == "both"
            or item_phase == phase
            or (phase == PHASE_SQ and item_phase in ("rnd", "both", PHASE_SQ))
        )
        if not applies:
            continue

        kind = str(raw.get("kind") or "fixed")
        try:
            value = float(raw.get("value") or 0.0)
        except (TypeError, ValueError):
            value = 0.0

        if kind == "fixed":
            amount = value
        elif kind == "per_paid_activation":
            amount = value * paid_activations
        elif kind == "per_activation":
            amount = value * activations
        elif kind == "pct_of_revenue":
            amount = gross_revenue * value / 100.0
        else:
            amount = 0.0

        breakdown[name] = breakdown.get(name, 0.0) + amount
        total += amount

    return total, breakdown


def _month_row(month: int, params: Dict, *, status_quo: bool) -> Dict[str, Any]:
    rnd_months = max(0, _i(params, "rnd_months"))

    if status_quo:
        phase = PHASE_SQ
        contractor_pct = _f(params, "contractor_share_pct") / 100.0
        support = _f(params, "support_status_quo")
        vc_phase = PHASE_SQ
        dev_cost = 0.0
    elif month <= rnd_months:
        phase = PHASE_RND
        contractor_pct = _f(params, "contractor_share_pct") / 100.0
        support = _f(params, "support_rnd")
        vc_phase = PHASE_RND
        dev_cost = max(0.0, _f(params, "dev_cost_month"))
    else:
        phase = PHASE_OWN
        contractor_pct = 0.0
        support = _f(params, "support_ops")
        vc_phase = PHASE_OWN
        dev_cost = 0.0

    effects = product_effects(params, month, phase)
    seo = seo_organic_factor(params, month, phase)
    org_pre_seo = max(0.0, _f(params, "traffic_month") * effects["traffic"])
    org_traffic, org_cr, org_approved, org_paid, org_arpu = funnel_rates(
        params, phase, month,
    )
    ads_traffic, ads_cr, ads_approved, ads_paid, ads_arpu, ads_cost = ads_funnel(
        params, month, phase,
    )

    org_act, org_appr, org_paid_n, org_promo = _channel_promo(
        org_traffic, org_cr, org_approved, org_paid, org_arpu,
    )
    ads_act, ads_appr, ads_paid_n, ads_promo = _channel_promo(
        ads_traffic, ads_cr, ads_approved, ads_paid, ads_arpu,
    )

    traffic = org_traffic + ads_traffic
    activations = org_act + ads_act
    approved_activations = org_appr + ads_appr
    paid_activations = org_paid_n + ads_paid_n
    promo_revenue = org_promo + ads_promo
    extra_product_revenue = 0.0 if status_quo else effects["extra_revenue"]

    black_apps, platinum_apps, black_revenue, platinum_revenue, card_revenue = card_originations(
        params, traffic,
    )
    gross = promo_revenue + card_revenue + extra_product_revenue
    contractor_cost = promo_revenue * contractor_pct

    ops_salaries, team_headcount, team_avg_salary = _team_for_month(
        params, month, phase, status_quo=status_quo,
    )
    rnd_salaries, rnd_headcount, rnd_avg_salary, rnd_names = extra_rnd_payroll(
        params if not status_quo else {}, month,
    )
    salaries = ops_salaries + rnd_salaries

    variable, vc_breakdown = calculate_variable_costs(
        params.get("variable_costs") or [],
        vc_phase,
        traffic,
        activations,
        paid_activations,
        gross,
    )
    if status_quo:
        ads_cost = 0.0
        rnd_salaries = 0.0
        rnd_headcount = 0.0
        rnd_avg_salary = 0.0
        rnd_names = []
        extra_product_revenue = 0.0

    fixed = salaries + support + dev_cost
    total_costs = fixed + variable + contractor_cost + ads_cost
    cash_flow = gross - total_costs

    return {
        "month": month,
        "phase": phase,
        "traffic": traffic,
        "organic_traffic": org_traffic,
        "organic_traffic_pre_seo": org_pre_seo,
        "seo_factor": seo,
        "ads_traffic": ads_traffic,
        "conversion": org_cr,
        "approved_share": org_approved,
        "paid_share": org_paid,
        "arpu": org_arpu,
        "ads_conversion": ads_cr,
        "ads_approved_share": ads_approved,
        "ads_paid_share": ads_paid,
        "activations": activations,
        "organic_activations": org_act,
        "ads_activations": ads_act,
        "approved_activations": approved_activations,
        "paid_activations": paid_activations,
        "organic_paid_activations": org_paid_n,
        "ads_paid_activations": ads_paid_n,
        "black_apps": black_apps,
        "platinum_apps": platinum_apps,
        "promo_revenue": promo_revenue,
        "organic_promo_revenue": org_promo,
        "ads_promo_revenue": ads_promo,
        "extra_product_revenue": extra_product_revenue,
        "black_revenue": black_revenue,
        "platinum_revenue": platinum_revenue,
        "card_revenue": card_revenue,
        "team_headcount": team_headcount + rnd_headcount,
        "team_avg_salary": (
            salaries / (team_headcount + rnd_headcount)
            if (team_headcount + rnd_headcount)
            else 0.0
        ),
        "ops_headcount": team_headcount,
        "ops_avg_salary": team_avg_salary,
        "extra_rnd_headcount": rnd_headcount,
        "extra_rnd_avg_salary": rnd_avg_salary,
        "extra_rnd_names": rnd_names,
        "gross_revenue": gross,
        "net_revenue": gross - contractor_cost,
        "contractor_cost": contractor_cost,
        "salaries": salaries,
        "ops_salaries": ops_salaries,
        "extra_rnd_salaries": rnd_salaries,
        "dev_cost": dev_cost,
        "ads_cost": ads_cost,
        "support": support,
        "variable_costs": variable,
        "variable_breakdown": vc_breakdown,
        "fixed_costs": fixed,
        "total_costs": total_costs,
        "cash_flow": cash_flow,
        "lift_traffic": effects["traffic"],
        "lift_conversion": effects["conversion"],
        "lift_paid": effects["paid"],
    }


def _first_nonneg(rows: List[Dict], field: str) -> Optional[int]:
    for row in rows:
        if row.get(field, 0.0) >= 0:
            return int(row["month"])
    return None


def run_model(params: Dict[str, Any]) -> Dict[str, Any]:
    """Считает проект, статус-кво и KPI на горизонте num_months."""
    num_months = max(1, _i(params, "num_months", 24))
    rnd_months = max(0, min(_i(params, "rnd_months"), num_months))
    params = deepcopy(params)
    params["rnd_months"] = rnd_months
    params["num_months"] = num_months
    if not _is_stretch(params):
        params["scenario"] = SCENARIO_BASE

    project: List[Dict[str, Any]] = []
    status_quo: List[Dict[str, Any]] = []
    cum_cf = 0.0
    cum_sq = 0.0
    cum_inc = 0.0

    for m in range(1, num_months + 1):
        p = _month_row(m, params, status_quo=False)
        s = _month_row(m, params, status_quo=True)
        cum_cf += p["cash_flow"]
        cum_sq += s["cash_flow"]
        inc = p["cash_flow"] - s["cash_flow"]
        cum_inc += inc
        p["cumulative_cf"] = cum_cf
        s["cumulative_cf"] = cum_sq
        p["sq_cash_flow"] = s["cash_flow"]
        p["sq_organic_traffic"] = s["organic_traffic"]
        p["incremental_cf"] = inc
        p["cumulative_incremental"] = cum_inc
        project.append(p)
        status_quo.append(s)

    payback_project = _first_nonneg(project, "cumulative_cf")
    payback_incremental = _first_nonneg(project, "cumulative_incremental")

    own_rows = [r for r in project if r["phase"] == PHASE_OWN]
    rnd_rows = [r for r in project if r["phase"] == PHASE_RND]
    typical_own_launch = own_rows[0] if own_rows else None
    typical_own = next(
        (r for r in own_rows if r.get("seo_factor", 1.0) >= 0.999),
        own_rows[-1] if own_rows else None,
    )
    typical_rnd = rnd_rows[0] if rnd_rows else None
    typical_sq = status_quo[0] if status_quo else None

    rnd_investment = -sum(r["incremental_cf"] for r in rnd_rows) if rnd_rows else 0.0
    rnd_investment = max(0.0, rnd_investment)

    total_gross = sum(r["gross_revenue"] for r in project)
    total_costs = sum(r["total_costs"] for r in project)
    total_cf = sum(r["cash_flow"] for r in project)
    total_inc = sum(r["incremental_cf"] for r in project)
    total_ads_cost = sum(r["ads_cost"] for r in project)
    total_extra_rnd = sum(r["extra_rnd_salaries"] for r in project)
    total_dev = sum(r["dev_cost"] for r in project)
    total_org_promo = sum(r["organic_promo_revenue"] for r in project)
    total_ads_promo = sum(r["ads_promo_revenue"] for r in project)

    kpis = {
        "scenario": params.get("scenario", SCENARIO_BASE),
        "num_months": num_months,
        "rnd_months": rnd_months,
        "gross_month_base": _month_row(1, params, status_quo=True)["gross_revenue"],
        "promo_revenue_base": _month_row(1, params, status_quo=True)["promo_revenue"],
        "card_revenue_base": _month_row(1, params, status_quo=True)["card_revenue"],
        "paid_activations_base": _month_row(1, params, status_quo=True)["paid_activations"],
        "approved_activations_base": _month_row(1, params, status_quo=True)["approved_activations"],
        "activations_base": _month_row(1, params, status_quo=True)["activations"],
        "total_gross": total_gross,
        "total_costs": total_costs,
        "total_cf": total_cf,
        "total_incremental": total_inc,
        "total_ads_cost": total_ads_cost,
        "total_extra_rnd_salaries": total_extra_rnd,
        "total_dev_cost": total_dev,
        "total_organic_promo": total_org_promo,
        "total_ads_promo": total_ads_promo,
        "final_cumulative_cf": project[-1]["cumulative_cf"],
        "final_cumulative_incremental": project[-1]["cumulative_incremental"],
        "payback_project_month": payback_project,
        "payback_incremental_month": payback_incremental,
        "rnd_investment": rnd_investment,
        "typical_own": typical_own,
        "typical_own_launch": typical_own_launch,
        "typical_rnd": typical_rnd,
        "typical_sq": typical_sq,
    }

    return {
        "params": params,
        "project": project,
        "status_quo": status_quo,
        "kpis": kpis,
    }


def sensitivity_table(params: Dict[str, Any], deltas: Tuple[float, ...] = (-0.2, 0.0, 0.2)) -> Dict[str, List[Dict]]:
    """Чувствительность итогового инкрементального CF к ±20% драйверов выручки."""
    drivers = [
        ("traffic_month", "Органический трафик / мес"),
        ("conversion_pct", "Конверсия органики"),
        ("approved_activation_share_pct", "Доля одобренных (органика)"),
        ("paid_partner_share_pct", "Доля оплачиваемых (органика)"),
        ("arpu", "ARPU"),
        ("black_share_pct", "Доля оформлений Black"),
        ("black_ltv", "LTV Black"),
        ("platinum_share_pct", "Доля оформлений Platinum"),
        ("platinum_ltv", "LTV Platinum"),
    ]
    if _enabled(params, "seo_dip_enabled", True):
        drivers.extend([
            ("seo_dip_floor_pct", "SEO-пол после переезда"),
            ("seo_recovery_months", "Срок восстановления SEO, мес."),
        ])
    if _is_stretch(params) and _enabled(params, "ads_enabled", False):
        drivers.extend([
            ("ads_traffic_month", "Рекламный трафик / мес"),
            ("conversion_pct_ads", "Конверсия рекламы"),
            ("paid_partner_share_pct_ads", "Доля оплачиваемых (реклама)"),
            ("ads_cost_month", "Бюджет рекламы / мес"),
        ])
    out: Dict[str, List[Dict]] = {}
    for key, label in drivers:
        rows = []
        base_val = _f(params, key)
        for d in deltas:
            trial = deepcopy(params)
            trial[key] = base_val * (1.0 + d)
            result = run_model(trial)
            rows.append({
                "delta": d,
                "label": label,
                "total_incremental": result["kpis"]["total_incremental"],
                "payback": result["kpis"]["payback_incremental_month"],
                "final_cf": result["kpis"]["final_cumulative_cf"],
            })
        out[key] = rows
    return out
