"""Общие виджеты параметров. Ключи session_state разделены по сценариям base/stretch."""
from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, List

import pandas as pd
import streamlit as st

from models.engine import PHASE_OWN, seo_organic_factor

from .formula_input import formula_number_input, reset_formula_field


DEFAULTS_PATH = Path(__file__).resolve().parent.parent / "config" / "defaults.json"

SCENARIOS = ("base", "stretch")
SHARED_KEYS = {"num_months"}

KIND_OPTIONS = [
    "fixed",
    "per_paid_activation",
    "per_activation",
    "pct_of_revenue",
]
PHASE_OPTIONS = ["rnd", "own", "both", "status_quo"]

KIND_HELP = (
    "`fixed` — ₽ в месяц; "
    "`per_paid_activation` — ₽ за оплаченную партнёром активацию; "
    "`per_activation` — ₽ за любую активацию промокода; "
    "`pct_of_revenue` — % от валовой выручки."
)

SCALAR_KEYS = [
    "num_months",
    "rnd_months",
    "traffic_month",
    "seo_dip_enabled",
    "seo_dip_floor_pct",
    "seo_recovery_months",
    "conversion_pct",
    "approved_activation_share_pct",
    "paid_partner_share_pct",
    "arpu",
    "contractor_share_pct",
    "dev_cost_month",
    "card_black_enabled",
    "black_share_pct",
    "black_ltv",
    "card_platinum_enabled",
    "platinum_share_pct",
    "platinum_ltv",
    "team_headcount_rnd",
    "team_avg_salary_rnd",
    "team_headcount_ops",
    "team_avg_salary_ops",
    "salaries_rnd",
    "salaries_ops",
    "salaries_status_quo",
    "support_rnd",
    "support_ops",
    "support_status_quo",
    "own_traffic_lift_pct",
    "own_conversion_lift_pct",
    "own_approved_share_lift_pct",
    "own_paid_share_lift_pct",
    "own_arpu_lift_pct",
    "ads_enabled",
    "ads_start_month",
    "ads_end_month",
    "ads_traffic_month",
    "ads_cost_month",
    "conversion_pct_ads",
    "approved_activation_share_pct_ads",
    "paid_partner_share_pct_ads",
]

FORMULA_FIELDS = {
    "traffic_month": {"decimals": 0, "as_int": True},
    "seo_dip_floor_pct": {"decimals": 0, "as_int": False},
    "conversion_pct": {"decimals": 1, "as_int": False},
    "approved_activation_share_pct": {"decimals": 1, "as_int": False},
    "paid_partner_share_pct": {"decimals": 1, "as_int": False},
    "arpu": {"decimals": 0, "as_int": False},
    "contractor_share_pct": {"decimals": 0, "as_int": False},
    "dev_cost_month": {"decimals": 0, "as_int": True},
    "black_share_pct": {"decimals": 2, "as_int": False},
    "black_ltv": {"decimals": 0, "as_int": False},
    "platinum_share_pct": {"decimals": 2, "as_int": False},
    "platinum_ltv": {"decimals": 0, "as_int": False},
    "own_traffic_lift_pct": {"decimals": 0, "as_int": False},
    "own_conversion_lift_pct": {"decimals": 0, "as_int": False},
    "own_approved_share_lift_pct": {"decimals": 0, "as_int": False},
    "own_paid_share_lift_pct": {"decimals": 0, "as_int": False},
    "own_arpu_lift_pct": {"decimals": 0, "as_int": False},
    "ads_traffic_month": {"decimals": 0, "as_int": True},
    "ads_cost_month": {"decimals": 0, "as_int": True},
    "conversion_pct_ads": {"decimals": 1, "as_int": False},
    "approved_activation_share_pct_ads": {"decimals": 1, "as_int": False},
    "paid_partner_share_pct_ads": {"decimals": 1, "as_int": False},
}

ORGANIC_COPY_KEYS = [
    "rnd_months",
    "traffic_month",
    "seo_dip_enabled",
    "seo_dip_floor_pct",
    "seo_recovery_months",
    "conversion_pct",
    "approved_activation_share_pct",
    "paid_partner_share_pct",
    "arpu",
    "contractor_share_pct",
    "dev_cost_month",
    "card_black_enabled",
    "black_share_pct",
    "black_ltv",
    "card_platinum_enabled",
    "platinum_share_pct",
    "platinum_ltv",
    "support_rnd",
    "support_ops",
    "support_status_quo",
    "salaries_status_quo",
]

EXTRA_RND_COLUMNS = [
    "name",
    "start_month",
    "duration_months",
    "headcount",
    "avg_salary",
    "traffic_lift_pct",
    "conversion_lift_pct",
    "approved_lift_pct",
    "paid_lift_pct",
    "arpu_lift_pct",
    "extra_revenue_month",
]


def skey(scenario: str, key: str) -> str:
    if key in SHARED_KEYS:
        return key
    return f"{scenario}__{key}"


def load_defaults() -> Dict[str, Any]:
    with open(DEFAULTS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def build_team_schedule(
    num_months: int,
    rnd_months: int,
    headcount_rnd: int,
    avg_salary_rnd: float,
    headcount_ops: int,
    avg_salary_ops: float,
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for month in range(1, max(1, num_months) + 1):
        if month <= rnd_months:
            rows.append({
                "month": month,
                "phase": "RnD",
                "headcount": int(headcount_rnd),
                "avg_salary": float(avg_salary_rnd),
            })
        else:
            rows.append({
                "month": month,
                "phase": "свой сайт",
                "headcount": int(headcount_ops),
                "avg_salary": float(avg_salary_ops),
            })
    return rows


def _phase_label(month: int, rnd_months: int) -> str:
    return "RnD" if month <= rnd_months else "свой сайт"


def _coerce_team_row(rec: Dict[str, Any], month: int, rnd_months: int) -> Dict[str, Any]:
    try:
        headcount = int(float(rec.get("headcount") or 0))
    except (TypeError, ValueError):
        headcount = 0
    try:
        avg_salary = float(rec.get("avg_salary") or 0.0)
    except (TypeError, ValueError):
        avg_salary = 0.0
    return {
        "month": month,
        "phase": _phase_label(month, rnd_months),
        "headcount": max(0, headcount),
        "avg_salary": max(0.0, avg_salary),
    }


def _is_editor_state(value: Any) -> bool:
    return isinstance(value, dict) and (
        "edited_rows" in value or "added_rows" in value or "deleted_rows" in value
    )


def _as_records(value: Any) -> List[Dict[str, Any]]:
    """data_editor в session_state может быть DataFrame, list или внутренний dict Streamlit."""
    if value is None or _is_editor_state(value):
        return []
    if isinstance(value, pd.DataFrame):
        if value.empty:
            return []
        return value.to_dict("records")
    if isinstance(value, list):
        return [row for row in value if isinstance(row, dict)]
    if isinstance(value, dict):
        try:
            frame = pd.DataFrame(value)
        except (ValueError, TypeError):
            return []
        if frame.empty:
            return []
        return frame.to_dict("records")
    return []


def _apply_editor_delta(base: Any, delta: Dict[str, Any]) -> pd.DataFrame:
    """Накладывает внутренний diff data_editor на текущий DataFrame."""
    rows = _as_records(base)
    edited = delta.get("edited_rows") or {}
    for raw_idx, changes in edited.items():
        try:
            idx = int(raw_idx)
        except (TypeError, ValueError):
            continue
        if 0 <= idx < len(rows) and isinstance(changes, dict):
            rows[idx].update(changes)
    deleted = set()
    for raw_idx in delta.get("deleted_rows") or []:
        try:
            deleted.add(int(raw_idx))
        except (TypeError, ValueError):
            continue
    rows = [row for idx, row in enumerate(rows) if idx not in deleted]
    for rec in delta.get("added_rows") or []:
        if isinstance(rec, dict):
            rows.append(rec)
    return pd.DataFrame(rows)


def _frame_from_editor_value(value: Any, fallback: Any) -> pd.DataFrame | None:
    """Живое значение data_editor (DataFrame или diff) → DataFrame. None = редактор ещё не монтировался."""
    if value is None:
        return None
    if _is_editor_state(value):
        return _apply_editor_delta(fallback, value)
    if isinstance(value, pd.DataFrame):
        return value.copy()
    records = _as_records(value)
    if records:
        return pd.DataFrame(records)
    if isinstance(value, (list, dict)) and not value:
        return pd.DataFrame()
    return None


def sync_df_from_editor(scenario: str, df_suffix: str, editor_suffix: str) -> None:
    """Переносит правки data_editor в df *до* run_model. Иначе сводка живёт на старом кадре."""
    df_key = skey(scenario, df_suffix)
    editor_key = skey(scenario, editor_suffix)
    if editor_key not in st.session_state:
        return
    frame = _frame_from_editor_value(st.session_state.get(editor_key), st.session_state.get(df_key))
    if frame is None:
        return
    st.session_state[df_key] = frame


def sync_all_editors(scenario: str | None = None) -> None:
    targets = SCENARIOS if scenario is None else (scenario,)
    for item in targets:
        sync_df_from_editor(item, "variable_costs_df", "variable_costs_editor")
        sync_df_from_editor(item, "team_schedule_df", "team_schedule_editor")
        sync_df_from_editor(item, "extra_rnd_df", "extra_rnd_editor")


def _on_variable_costs_edit(scenario: str) -> None:
    sync_df_from_editor(scenario, "variable_costs_df", "variable_costs_editor")


def _on_team_schedule_edit(scenario: str) -> None:
    sync_df_from_editor(scenario, "team_schedule_df", "team_schedule_editor")


def _on_extra_rnd_edit(scenario: str) -> None:
    sync_df_from_editor(scenario, "extra_rnd_df", "extra_rnd_editor")


def resize_team_schedule(
    records: List[Dict[str, Any]],
    num_months: int,
    rnd_months: int,
    defaults: Dict[str, Any],
) -> List[Dict[str, Any]]:
    by_month: Dict[int, Dict[str, Any]] = {}
    for rec in records:
        try:
            month = int(float(rec.get("month") or 0))
        except (TypeError, ValueError):
            continue
        if month >= 1:
            by_month[month] = rec

    last = _coerce_team_row(
        {
            "headcount": defaults.get("team_headcount_rnd", 0),
            "avg_salary": defaults.get("team_avg_salary_rnd", 0),
        },
        1,
        rnd_months,
    )
    rows: List[Dict[str, Any]] = []
    for month in range(1, max(1, num_months) + 1):
        if month in by_month:
            last = _coerce_team_row(by_month[month], month, rnd_months)
        elif month > rnd_months and (month - 1) <= rnd_months:
            last = _coerce_team_row(
                {
                    "headcount": defaults.get("team_headcount_ops", last["headcount"]),
                    "avg_salary": defaults.get("team_avg_salary_ops", last["avg_salary"]),
                },
                month,
                rnd_months,
            )
        else:
            last = _coerce_team_row(last, month, rnd_months)
        rows.append(last)
    return rows


def _extra_rnd_frame(records: List[Dict[str, Any]]) -> pd.DataFrame:
    if not records:
        return pd.DataFrame(columns=EXTRA_RND_COLUMNS)
    frame = pd.DataFrame(records)
    for col in EXTRA_RND_COLUMNS:
        if col not in frame.columns:
            frame[col] = 0 if col != "name" else ""
    return frame[EXTRA_RND_COLUMNS]


def init_session() -> None:
    defaults = load_defaults()
    if "num_months" not in st.session_state:
        st.session_state.num_months = defaults["num_months"]
    extra_default = defaults.get("extra_rnd", [])
    for scenario in SCENARIOS:
        for key in SCALAR_KEYS:
            if key in SHARED_KEYS:
                continue
            sk = skey(scenario, key)
            if sk not in st.session_state:
                if key in st.session_state:
                    st.session_state[sk] = st.session_state[key]
                else:
                    st.session_state[sk] = defaults.get(key, 0)
        vc_key = skey(scenario, "variable_costs_df")
        if vc_key not in st.session_state:
            legacy = st.session_state.get("variable_costs_df")
            st.session_state[vc_key] = (
                legacy.copy() if isinstance(legacy, pd.DataFrame) else pd.DataFrame(defaults.get("variable_costs", []))
            )
        team_key = skey(scenario, "team_schedule_df")
        if team_key not in st.session_state:
            legacy_team = st.session_state.get("team_schedule_df")
            if isinstance(legacy_team, pd.DataFrame) and not legacy_team.empty:
                st.session_state[team_key] = legacy_team.copy()
            else:
                st.session_state[team_key] = pd.DataFrame(
                    build_team_schedule(
                        int(defaults["num_months"]),
                        int(defaults["rnd_months"]),
                        int(defaults["team_headcount_rnd"]),
                        float(defaults["team_avg_salary_rnd"]),
                        int(defaults["team_headcount_ops"]),
                        float(defaults["team_avg_salary_ops"]),
                    )
                )
            st.session_state[skey(scenario, "_team_schedule_sig")] = (
                int(st.session_state.get("num_months") or defaults["num_months"]),
                int(_state_get(scenario, "rnd_months") or defaults["rnd_months"]),
            )
        rnd_key = skey(scenario, "extra_rnd_df")
        if rnd_key not in st.session_state:
            st.session_state[rnd_key] = _extra_rnd_frame(extra_default if scenario == "stretch" else [])
    sync_all_editors()


def _state_get(scenario: str, key: str, default: Any = None) -> Any:
    return st.session_state.get(skey(scenario, key), default)


def _vc_from_state(scenario: str) -> List[Dict[str, Any]]:
    sync_df_from_editor(scenario, "variable_costs_df", "variable_costs_editor")
    records = _as_records(_state_get(scenario, "variable_costs_df"))
    if not records:
        records = _as_records(_state_get(scenario, "variable_costs_editor"))
    if not records:
        return []
    rows: List[Dict[str, Any]] = []
    for rec in records:
        name = str(rec.get("name") or "").strip()
        if not name:
            continue
        try:
            value = float(rec.get("value") or 0.0)
        except (TypeError, ValueError):
            value = 0.0
        kind = rec.get("kind") if rec.get("kind") in KIND_OPTIONS else "fixed"
        phase = rec.get("phase") if rec.get("phase") in PHASE_OPTIONS else "own"
        rows.append({"name": name, "kind": kind, "value": value, "phase": phase})
    return rows


def _team_from_state(scenario: str) -> List[Dict[str, Any]]:
    sync_df_from_editor(scenario, "team_schedule_df", "team_schedule_editor")
    records = _as_records(_state_get(scenario, "team_schedule_df"))
    if not records:
        records = _as_records(_state_get(scenario, "team_schedule_editor"))
    num_months = int(st.session_state.get("num_months") or 24)
    rnd_months = int(_state_get(scenario, "rnd_months") or 0)
    defaults = load_defaults()
    rows = resize_team_schedule(records, num_months, rnd_months, {
        **defaults,
        "team_headcount_rnd": _state_get(scenario, "team_headcount_rnd", defaults.get("team_headcount_rnd", 0)),
        "team_avg_salary_rnd": _state_get(scenario, "team_avg_salary_rnd", defaults.get("team_avg_salary_rnd", 0)),
        "team_headcount_ops": _state_get(scenario, "team_headcount_ops", defaults.get("team_headcount_ops", 0)),
        "team_avg_salary_ops": _state_get(scenario, "team_avg_salary_ops", defaults.get("team_avg_salary_ops", 0)),
    })
    return [
        {"month": r["month"], "headcount": r["headcount"], "avg_salary": r["avg_salary"]}
        for r in rows
    ]


def _extra_rnd_from_state(scenario: str) -> List[Dict[str, Any]]:
    sync_df_from_editor(scenario, "extra_rnd_df", "extra_rnd_editor")
    records = _as_records(_state_get(scenario, "extra_rnd_df"))
    if not records:
        records = _as_records(_state_get(scenario, "extra_rnd_editor"))
    rows: List[Dict[str, Any]] = []
    for rec in records:
        name = str(rec.get("name") or "").strip()
        if not name:
            continue
        row: Dict[str, Any] = {"name": name}
        for col in EXTRA_RND_COLUMNS:
            if col == "name":
                continue
            try:
                row[col] = float(rec.get(col) or 0.0)
            except (TypeError, ValueError):
                row[col] = 0.0
        row["start_month"] = int(row["start_month"])
        row["duration_months"] = int(row["duration_months"])
        row["headcount"] = int(row["headcount"])
        rows.append(row)
    return rows


def read_params(scenario: str = "base") -> Dict[str, Any]:
    sync_all_editors(scenario)
    params = deepcopy(load_defaults())
    params["scenario"] = scenario
    for key in SCALAR_KEYS:
        sk = skey(scenario, key)
        if sk in st.session_state:
            params[key] = st.session_state[sk]
    params["variable_costs"] = _vc_from_state(scenario)

    if scenario == "base":
        params["team_schedule"] = []
        params["extra_rnd"] = []
        params["ads_enabled"] = False
        params["ads_traffic_month"] = 0
        params["ads_cost_month"] = 0
        params["team_headcount_rnd"] = 0
        params["team_headcount_ops"] = 0
        params["salaries_rnd"] = 0
        params["salaries_ops"] = 0
        params["own_traffic_lift_pct"] = 0.0
        params["own_conversion_lift_pct"] = 0.0
        params["own_approved_share_lift_pct"] = 0.0
        params["own_paid_share_lift_pct"] = 0.0
        params["own_arpu_lift_pct"] = 0.0
        return params

    params["team_schedule"] = _team_from_state(scenario)
    params["extra_rnd"] = _extra_rnd_from_state(scenario)
    rnd_hc = float(params.get("team_headcount_rnd") or 0)
    rnd_avg = float(params.get("team_avg_salary_rnd") or 0)
    ops_hc = float(params.get("team_headcount_ops") or 0)
    ops_avg = float(params.get("team_avg_salary_ops") or 0)
    if rnd_hc or rnd_avg:
        params["salaries_rnd"] = rnd_hc * rnd_avg
    if ops_hc or ops_avg:
        params["salaries_ops"] = ops_hc * ops_avg
    return params


def render_horizon_block(scenario: str, *, include_shared_horizon: bool = True) -> None:
    st.markdown("##### Горизонт и разработка сайта")
    if include_shared_horizon:
        st.number_input(
            "Горизонт расчёта, мес.",
            min_value=1, max_value=60, step=1,
            key="num_months",
            help="Общий для Base и Stretch, чтобы сравнивать один горизонт. База = 24.",
        )
    st.number_input(
        "Длительность разработки сайта, мес.",
        min_value=0, max_value=18, step=1,
        key=skey(scenario, "rnd_months"),
        help=(
            "Пока сайт у подрядчика: выручка уже идёт, с неё режется его доля, "
            "плюс стоимость разработки. 0 = сайт сразу свой."
        ),
    )
    formula_number_input(
        "Стоимость разработки, ₽/мес. в период RnD",
        skey(scenario, "dev_cost_month"),
        min_value=0, max_value=50_000_000,
        decimals=0, as_int=True,
        help="Агентство / подряд на переписывание. В Base это единственная «инвестиция» сверх доли подрядчика.",
    )


def render_organic_block(scenario: str) -> None:
    st.markdown("##### Органический трафик")
    st.caption(
        "Промо органика: трафик × конверсия × доля одобренных × доля оплачиваемых × ARPU. "
        "В коэффициент можно вписать `=5000000/12` и нажать «Рассчитать»."
    )
    formula_number_input(
        "Органический трафик в месяц, визитов",
        skey(scenario, "traffic_month"),
        min_value=0, max_value=50_000_000,
        decimals=0, as_int=True,
        help="Текущий органический поток. База: 5 млн/год ÷ 12 ≈ 417 000.",
    )
    formula_number_input(
        "Конверсия в активацию (органика), %",
        skey(scenario, "conversion_pct"),
        min_value=0.0, max_value=100.0,
        decimals=1,
        help="Доля органических визитов с кликом «Активировать». База ≈ 10%.",
    )
    formula_number_input(
        "Доля одобренных активаций (органика), %",
        skey(scenario, "approved_activation_share_pct"),
        min_value=0.0, max_value=100.0,
        decimals=1,
        help="Из кликнувших «Активировать» — какая доля дошла до целевого действия у партнёра.",
    )
    formula_number_input(
        "Доля оплачиваемых партнёров (органика), % от одобренных",
        skey(scenario, "paid_partner_share_pct"),
        min_value=0.0, max_value=100.0,
        decimals=1,
        help="Какая часть одобренных активаций подтверждена партнёром и приносит деньги. База ≈ 10%.",
    )
    formula_number_input(
        "ARPU, ₽ за оплаченную активацию",
        skey(scenario, "arpu"),
        min_value=0.0, max_value=100_000.0,
        decimals=0,
        help="Средняя выплата партнёра. Общая для органики и рекламы. База 250 ₽ (оценочно).",
    )
    formula_number_input(
        "Доля подрядчика, % от промо-выручки",
        skey(scenario, "contractor_share_pct"),
        min_value=0.0, max_value=100.0,
        decimals=0,
        help="С промо, пока сайт у подрядчика. На LTV карт не режется. После своего сайта = 0.",
    )


def render_seo_dip_block(scenario: str) -> None:
    st.markdown("##### SEO-просадка после переезда")
    st.caption(
        "Когда после RnD сайт переезжает внутрь Т, внешняя органика падает до пола "
        "и линейно возвращается к 100% исходного. Статус-кво и реклама не проседают. "
        "Продуктовые лифты Stretch умножаются поверх восстановленной базы."
    )
    st.checkbox(
        "Учитывать SEO-просадку",
        key=skey(scenario, "seo_dip_enabled"),
        help="Если снять галку, органика после запуска сразу = 100% базы (× лифты Stretch).",
    )
    c1, c2 = st.columns(2)
    with c1:
        formula_number_input(
            "Пол органики в первый месяц своего сайта, % от исходного",
            skey(scenario, "seo_dip_floor_pct"),
            min_value=0.0, max_value=100.0,
            decimals=0,
            help="База 70%: в месяц переезда внешний трафик = 0.7 × текущая органика.",
        )
    with c2:
        st.number_input(
            "Срок восстановления, мес.",
            min_value=0, max_value=36, step=1,
            key=skey(scenario, "seo_recovery_months"),
            help=(
                "За сколько месяцев своего сайта органика линейно дойдёт до 100%. "
                "6 = первый свой месяц 70%, шестой — 100%. 0 = пол навсегда."
            ),
        )

    enabled = bool(_state_get(scenario, "seo_dip_enabled", True))
    if not enabled:
        st.caption("Просадка выключена: после RnD органика сразу на 100% исходного.")
        return

    rnd = int(_state_get(scenario, "rnd_months") or 0)
    recovery = int(_state_get(scenario, "seo_recovery_months") or 0)
    traffic = float(_state_get(scenario, "traffic_month") or 0)
    floor_pct = float(_state_get(scenario, "seo_dip_floor_pct") or 0)
    preview_params = {
        "seo_dip_enabled": True,
        "seo_dip_floor_pct": floor_pct,
        "seo_recovery_months": recovery,
        "rnd_months": rnd,
    }

    def _visits(month: int) -> tuple[float, float]:
        factor = seo_organic_factor(preview_params, month, PHASE_OWN)
        return factor, traffic * factor

    if recovery <= 0:
        factor, visits = _visits(rnd + 1)
        st.caption(
            f"Срок 0: с мес. {rnd + 1} органика навсегда {factor * 100:.0f}% = "
            f"{visits:,.0f} визитов/мес.".replace(",", " ")
        )
        return

    first_m = rnd + 1
    last_m = rnd + recovery
    f1, v1 = _visits(first_m)
    f2, v2 = _visits(last_m)
    mid_elapsed = max(1, (recovery + 1) // 2)
    mid_m = rnd + mid_elapsed
    fm, vm = _visits(mid_m)
    st.caption(
        f"Календарь (без продуктовых лифтов): мес. {first_m} (первый свой) = "
        f"{f1 * 100:.0f}% → {v1:,.0f} визитов; "
        f"мес. {mid_m} = {fm * 100:.0f}% → {vm:,.0f}; "
        f"мес. {last_m} = {f2 * 100:.0f}% → {v2:,.0f}. "
        f"Дальше 100% = {traffic:,.0f}.".replace(",", " ")
    )


def render_ads_block(scenario: str) -> None:
    st.markdown("##### Рекламный трафик")
    st.caption(
        "Отдельная воронка: рекламный визит конвертируется хуже органики. "
        "Бюджет — фикс ₽/мес., не зависит от органики. "
        "Продуктовые лифты после доп. RnD применяются к конверсии/оплате рекламы, но не раздувают купленный трафик."
    )
    st.checkbox(
        "Включить рекламу",
        key=skey(scenario, "ads_enabled"),
        help="Если снять галку, рекламный трафик и бюджет = 0, коэффициенты сохраняются.",
    )
    c1, c2 = st.columns(2)
    with c1:
        st.number_input(
            "Старт рекламы, месяц",
            min_value=1, max_value=60, step=1,
            key=skey(scenario, "ads_start_month"),
        )
        formula_number_input(
            "Рекламный трафик в месяц, визитов",
            skey(scenario, "ads_traffic_month"),
            min_value=0, max_value=50_000_000,
            decimals=0, as_int=True,
            help="Купленные визиты. 0 = считаем только коэффициенты, без объёма.",
        )
        formula_number_input(
            "Бюджет рекламы, ₽/мес",
            skey(scenario, "ads_cost_month"),
            min_value=0, max_value=50_000_000,
            decimals=0, as_int=True,
            help="Списывается целиком в каждом месяце, пока реклама включена.",
        )
    with c2:
        st.number_input(
            "Конец рекламы, месяц (0 = до горизонта)",
            min_value=0, max_value=60, step=1,
            key=skey(scenario, "ads_end_month"),
        )
        formula_number_input(
            "Конверсия в активацию (реклама), %",
            skey(scenario, "conversion_pct_ads"),
            min_value=0.0, max_value=100.0,
            decimals=1,
            help="Обычно ниже органики: холодный трафик. База 5% (оценочно).",
        )
        formula_number_input(
            "Доля одобренных активаций (реклама), %",
            skey(scenario, "approved_activation_share_pct_ads"),
            min_value=0.0, max_value=100.0,
            decimals=1,
        )
        formula_number_input(
            "Доля оплачиваемых партнёров (реклама), % от одобренных",
            skey(scenario, "paid_partner_share_pct_ads"),
            min_value=0.0, max_value=100.0,
            decimals=1,
            help="База 8% (оценочно, хуже органических 10%).",
        )
    ads_on = bool(_state_get(scenario, "ads_enabled", False))
    ads_t = float(_state_get(scenario, "ads_traffic_month") or 0) if ads_on else 0.0
    ads_cr = float(_state_get(scenario, "conversion_pct_ads") or 0) / 100.0 if ads_on else 0.0
    ads_ap = float(_state_get(scenario, "approved_activation_share_pct_ads") or 0) / 100.0 if ads_on else 0.0
    ads_pd = float(_state_get(scenario, "paid_partner_share_pct_ads") or 0) / 100.0 if ads_on else 0.0
    arpu = float(_state_get(scenario, "arpu") or 0)
    ads_promo = ads_t * ads_cr * ads_ap * ads_pd * arpu
    ads_cost = float(_state_get(scenario, "ads_cost_month") or 0) if ads_on else 0.0
    st.caption(
        f"Реклама в месяц (без лифтов): {ads_t:,.0f} × {ads_cr * 100:.1f}% × "
        f"{ads_ap * 100:.1f}% × {ads_pd * 100:.1f}% × {arpu:,.0f} ₽ = "
        f"{ads_promo:,.0f} ₽ выручки, бюджет {ads_cost:,.0f} ₽.".replace(",", " ")
    )


def render_cards_block(scenario: str) -> None:
    st.markdown("##### Карты Т-Банка с сайта")
    st.caption(
        "Выручка карт / мес = (органика + реклама) × доля оформивших × LTV. "
        "LTV — доход банка на одно оформление, целиком в месяц заявки."
    )
    left, right = st.columns(2)
    with left:
        st.markdown("**Black**")
        st.checkbox(
            "Учитывать Black",
            key=skey(scenario, "card_black_enabled"),
            help="Если снять галку, выручка Black = 0, параметры сохраняются.",
        )
        formula_number_input(
            "Доля посетителей, кто оформит Black, %",
            skey(scenario, "black_share_pct"),
            min_value=0.0, max_value=100.0,
            decimals=2,
        )
        formula_number_input(
            "LTV Black, ₽ за оформление",
            skey(scenario, "black_ltv"),
            min_value=0.0, max_value=10_000_000.0,
            decimals=0,
            help="База 12 000 ₽ (оценочно, lifetime в месяц заявки).",
        )
    with right:
        st.markdown("**Platinum**")
        st.checkbox(
            "Учитывать Platinum",
            key=skey(scenario, "card_platinum_enabled"),
            help="Если снять галку, выручка Platinum = 0, параметры сохраняются.",
        )
        formula_number_input(
            "Доля посетителей, кто оформит Platinum, %",
            skey(scenario, "platinum_share_pct"),
            min_value=0.0, max_value=100.0,
            decimals=2,
        )
        formula_number_input(
            "LTV Platinum, ₽ за оформление",
            skey(scenario, "platinum_ltv"),
            min_value=0.0, max_value=10_000_000.0,
            decimals=0,
            help="База 25 000 ₽ (оценочно, lifetime в месяц заявки).",
        )
    org = float(_state_get(scenario, "traffic_month") or 0)
    ads_on = bool(_state_get(scenario, "ads_enabled", False)) if scenario == "stretch" else False
    ads = float(_state_get(scenario, "ads_traffic_month") or 0) if ads_on else 0.0
    traffic = org + ads
    black_on = bool(_state_get(scenario, "card_black_enabled", True))
    plat_on = bool(_state_get(scenario, "card_platinum_enabled", True))
    black_share = float(_state_get(scenario, "black_share_pct") or 0) / 100.0 if black_on else 0.0
    plat_share = float(_state_get(scenario, "platinum_share_pct") or 0) / 100.0 if plat_on else 0.0
    black_rev = traffic * black_share * float(_state_get(scenario, "black_ltv") or 0)
    plat_rev = traffic * plat_share * float(_state_get(scenario, "platinum_ltv") or 0)
    st.caption(
        f"Трафик для карт: органика {org:,.0f} + реклама {ads:,.0f} = {traffic:,.0f} "
        f"(без SEO-просадки; в первые месяцы своего сайта органика ниже). "
        f"Black: {black_rev:,.0f} ₽/мес. Platinum: {plat_rev:,.0f} ₽/мес. "
        f"Итого карты: {black_rev + plat_rev:,.0f} ₽/мес.".replace(",", " ")
    )


def render_costs_block(scenario: str) -> None:
    st.markdown("##### Поддержка, ₽/мес")
    st.caption(
        "Три разных числа: пока пишем сайт / когда сайт наш / если оставить подрядчику навсегда. "
        "Хостинг, SEO и атрибуция — не здесь, а в таблице «Переменные расходы» ниже."
    )
    c1, c2, c3 = st.columns(3)
    with c1:
        st.number_input(
            "Поддержка в RnD",
            min_value=0, max_value=10_000_000, step=10_000, format="%d",
            key=skey(scenario, "support_rnd"),
            help="Пока сайт ещё у подрядчика (месяцы разработки проекта).",
        )
    with c2:
        st.number_input(
            "Поддержка своего сайта",
            min_value=0, max_value=10_000_000, step=10_000, format="%d",
            key=skey(scenario, "support_ops"),
            help="Фикс после забора. Сверх него идут строки переменных (хостинг / SEO / атрибуция).",
        )
    with c3:
        st.number_input(
            "Поддержка статус-кво",
            min_value=0, max_value=10_000_000, step=5_000, format="%d",
            key=skey(scenario, "support_status_quo"),
            help="Если сайт навсегда оставить подрядчику. База 20 000 ₽.",
        )


def _sync_team_schedule_df(scenario: str) -> None:
    num_months = int(st.session_state.get("num_months") or 24)
    rnd_months = int(_state_get(scenario, "rnd_months") or 0)
    sig = (num_months, rnd_months)
    defaults = load_defaults()
    records = _as_records(_state_get(scenario, "team_schedule_df"))
    if not records:
        records = _as_records(_state_get(scenario, "team_schedule_editor"))
    rows = resize_team_schedule(
        records,
        num_months,
        rnd_months,
        {
            **defaults,
            "team_headcount_rnd": _state_get(scenario, "team_headcount_rnd", defaults.get("team_headcount_rnd", 0)),
            "team_avg_salary_rnd": _state_get(scenario, "team_avg_salary_rnd", defaults.get("team_avg_salary_rnd", 0)),
            "team_headcount_ops": _state_get(scenario, "team_headcount_ops", defaults.get("team_headcount_ops", 0)),
            "team_avg_salary_ops": _state_get(scenario, "team_avg_salary_ops", defaults.get("team_avg_salary_ops", 0)),
        },
    )
    new_df = pd.DataFrame(rows)[["month", "phase", "headcount", "avg_salary"]]
    sig_key = skey(scenario, "_team_schedule_sig")
    df_key = skey(scenario, "team_schedule_df")
    editor_key = skey(scenario, "team_schedule_editor")
    if st.session_state.get(sig_key) != sig:
        st.session_state[df_key] = new_df
        st.session_state[sig_key] = sig
        if editor_key in st.session_state:
            del st.session_state[editor_key]


def render_team_block(scenario: str, *, compact: bool = False) -> None:
    st.markdown("##### Команда сопровождения (не доп. RnD)")
    st.caption(
        "Это фонд «просто команда на сайте», отдельно от таблицы доп. RnD ниже. "
        "В Base зарплат нет. Фонд месяца = люди × средняя ЗП."
    )
    t1, t2 = st.columns(2)
    with t1:
        st.caption("Шаблон RnD (переписывание сайта)")
        st.number_input(
            "Людей в RnD",
            min_value=0, max_value=50, step=1,
            key=skey(scenario, "team_headcount_rnd"),
        )
        st.number_input(
            "Средняя ЗП RnD, ₽/мес",
            min_value=0, max_value=5_000_000, step=10_000, format="%d",
            key=skey(scenario, "team_avg_salary_rnd"),
        )
    with t2:
        st.caption("Шаблон своего сайта")
        st.number_input(
            "Людей после запуска",
            min_value=0, max_value=50, step=1,
            key=skey(scenario, "team_headcount_ops"),
        )
        st.number_input(
            "Средняя ЗП после запуска, ₽/мес",
            min_value=0, max_value=5_000_000, step=10_000, format="%d",
            key=skey(scenario, "team_avg_salary_ops"),
        )

    if st.button("Заполнить все месяцы по шаблону", width="stretch", key=skey(scenario, "fill_team")):
        num_months = int(st.session_state.get("num_months") or 24)
        rnd_months = int(_state_get(scenario, "rnd_months") or 0)
        st.session_state[skey(scenario, "team_schedule_df")] = pd.DataFrame(
            build_team_schedule(
                num_months,
                rnd_months,
                int(_state_get(scenario, "team_headcount_rnd") or 0),
                float(_state_get(scenario, "team_avg_salary_rnd") or 0),
                int(_state_get(scenario, "team_headcount_ops") or 0),
                float(_state_get(scenario, "team_avg_salary_ops") or 0),
            )
        )
        st.session_state[skey(scenario, "_team_schedule_sig")] = (num_months, rnd_months)
        editor_key = skey(scenario, "team_schedule_editor")
        if editor_key in st.session_state:
            del st.session_state[editor_key]
        st.rerun()

    _sync_team_schedule_df(scenario)
    table_area = (
        st.expander("Помесячно: люди × средняя ЗП", expanded=False)
        if compact
        else st.container()
    )
    with table_area:
        edited = st.data_editor(
            st.session_state[skey(scenario, "team_schedule_df")],
            num_rows="fixed",
            width="stretch",
            disabled=["month", "phase"],
            column_config={
                "month": st.column_config.NumberColumn("Месяц", format="%d"),
                "phase": st.column_config.TextColumn("Фаза"),
                "headcount": st.column_config.NumberColumn("Людей", min_value=0, step=1, format="%d"),
                "avg_salary": st.column_config.NumberColumn("Средняя ЗП, ₽", min_value=0, step=10_000, format="%.0f"),
            },
            key=skey(scenario, "team_schedule_editor"),
            on_change=_on_team_schedule_edit,
            args=(scenario,),
            hide_index=True,
        )
        if isinstance(edited, pd.DataFrame):
            st.session_state[skey(scenario, "team_schedule_df")] = edited
    payroll = _team_from_state(scenario)
    if payroll:
        rnd_months = int(_state_get(scenario, "rnd_months") or 0)
        first = payroll[0]
        own = next((r for r in payroll if r["month"] > rnd_months), None)
        horizon_total = sum(r["headcount"] * r["avg_salary"] for r in payroll)
        bits = [
            f"мес. 1: {first['headcount']:.0f} чел. × {first['avg_salary']:,.0f} ₽ = "
            f"{first['headcount'] * first['avg_salary']:,.0f} ₽".replace(",", " ")
        ]
        if own:
            bits.append(
                f"мес. {own['month']}: {own['headcount']:.0f} чел. × {own['avg_salary']:,.0f} ₽ = "
                f"{own['headcount'] * own['avg_salary']:,.0f} ₽".replace(",", " ")
            )
        bits.append(f"фонд за горизонт: {horizon_total:,.0f} ₽".replace(",", " "))
        st.caption(" · ".join(bits))


def render_extra_rnd_block(scenario: str, *, compact: bool = False) -> None:
    st.markdown("##### Доп. продуктовый RnD")
    st.caption(
        "Каждая строка — инициатива: зарплаты идут в месяцах [старт; старт+длительность). "
        "После завершения к воронке умножаются лифты, плюс опциональная доп. выручка ₽/мес. "
        "Несколько инициатив складываются (лифты перемножаются)."
    )
    df_key = skey(scenario, "extra_rnd_df")
    editor_key = skey(scenario, "extra_rnd_editor")
    table_area = (
        st.expander("Таблица инициатив", expanded=not compact)
        if compact
        else st.container()
    )
    with table_area:
        edited = st.data_editor(
            st.session_state[df_key],
            num_rows="dynamic",
            width="stretch",
            column_config={
                "name": st.column_config.TextColumn("Инициатива"),
                "start_month": st.column_config.NumberColumn("Старт, мес.", min_value=1, step=1, format="%d"),
                "duration_months": st.column_config.NumberColumn("Длительность", min_value=0, step=1, format="%d"),
                "headcount": st.column_config.NumberColumn("Людей", min_value=0, step=1, format="%d"),
                "avg_salary": st.column_config.NumberColumn("Ср. ЗП, ₽", min_value=0, step=10_000, format="%.0f"),
                "traffic_lift_pct": st.column_config.NumberColumn("Лифт трафика, %", step=1, format="%.0f"),
                "conversion_lift_pct": st.column_config.NumberColumn("Лифт CR, %", step=1, format="%.0f"),
                "approved_lift_pct": st.column_config.NumberColumn("Лифт одобренных, %", step=1, format="%.0f"),
                "paid_lift_pct": st.column_config.NumberColumn("Лифт оплачиваемых, %", step=1, format="%.0f"),
                "arpu_lift_pct": st.column_config.NumberColumn("Лифт ARPU, %", step=1, format="%.0f"),
                "extra_revenue_month": st.column_config.NumberColumn("Доп. выручка, ₽/мес", min_value=0, step=10_000, format="%.0f"),
            },
            key=editor_key,
            on_change=_on_extra_rnd_edit,
            args=(scenario,),
            hide_index=True,
        )
        if isinstance(edited, pd.DataFrame):
            st.session_state[df_key] = edited
    initiatives = _extra_rnd_from_state(scenario)
    if initiatives:
        bits = []
        for item in initiatives:
            pay = item["headcount"] * item["avg_salary"] * item["duration_months"]
            bits.append(
                f"{item['name']}: {item['headcount']:.0f} чел. × {item['duration_months']:.0f} мес. "
                f"= {pay:,.0f} ₽ фонда, затем лифт paid {item['paid_lift_pct']:+.0f}%".replace(",", " ")
            )
        st.caption(" · ".join(bits[:4]))


def render_status_quo_block(scenario: str) -> None:
    st.markdown("##### Статус-кво: если не забирать сайт")
    st.caption(
        "Серая линия на графике. Без разработки, без своей команды, без рекламы. "
        "Поддержка статус-кво — в блоке «Поддержка» выше. Окупаемость = проект минус этот сценарий."
    )
    st.number_input(
        "Зарплаты статус-кво, ₽/мес",
        min_value=0, max_value=50_000_000, step=10_000, format="%d",
        key=skey(scenario, "salaries_status_quo"),
        help="0 = сейчас нет своей команды на сайте у подрядчика.",
    )


def render_lifts_block(scenario: str) -> None:
    with st.expander("Общий лифт после запуска своего сайта (сверх доп. RnD)", expanded=False):
        st.caption(
            "Относительный прирост с месяца, когда сайт уже свой. "
            "0 = воронка как в базе; продуктовый upside лучше задавать строками доп. RnD. "
            "Лифты перемножаются с эффектом завершённых инициатив."
        )
        formula_number_input(
            "Лифт органического трафика, %",
            skey(scenario, "own_traffic_lift_pct"),
            min_value=-50.0, max_value=200.0,
            decimals=0,
        )
        formula_number_input(
            "Лифт конверсии в активацию, %",
            skey(scenario, "own_conversion_lift_pct"),
            min_value=-50.0, max_value=200.0,
            decimals=0,
        )
        formula_number_input(
            "Лифт доли одобренных активаций, %",
            skey(scenario, "own_approved_share_lift_pct"),
            min_value=-50.0, max_value=200.0,
            decimals=0,
        )
        formula_number_input(
            "Лифт доли оплачиваемых, %",
            skey(scenario, "own_paid_share_lift_pct"),
            min_value=-50.0, max_value=400.0,
            decimals=0,
            help="Например 50 = доля оплачиваемых 10% → 15% за счёт своей атрибуции.",
        )
        formula_number_input(
            "Лифт ARPU, %",
            skey(scenario, "own_arpu_lift_pct"),
            min_value=-50.0, max_value=200.0,
            decimals=0,
        )


def render_variable_costs_summary(scenario: str) -> None:
    rows = _vc_from_state(scenario)
    st.markdown("##### Переменные расходы")
    if not rows:
        st.caption("Статей нет. Добавить можно в таблице на этой странице или во вкладке «Параметры».")
        return
    bits = []
    for row in rows:
        bits.append(f"{row['name']}: {row['value']:,.0f} ({row['kind']}, фаза {row['phase']})")
    st.caption(
        "Сейчас в расчёте: " + " · ".join(bits).replace(",", " ")
        + ". Править — таблица «Переменные расходы» на этой странице."
    )


def render_variable_costs_editor(scenario: str) -> None:
    st.markdown("##### Переменные расходы (хостинг, SEO, атрибуция и любые свои статьи)")
    st.caption(
        KIND_HELP
        + " Фаза: `rnd` = только месяцы разработки проекта, `own` = только свой сайт, "
        "`status_quo` = только «оставить подрядчику», `both` = разработка и свой сайт. "
        "База: Хостинг 40 000 (`own`), SEO 30 000 (`own`), Атрибуция 8 ₽ за оплаченную активацию (`own`)."
    )
    edited = st.data_editor(
        st.session_state[skey(scenario, "variable_costs_df")],
        num_rows="dynamic",
        width="stretch",
        column_config={
            "name": st.column_config.TextColumn("Статья", required=False),
            "kind": st.column_config.SelectboxColumn("Тип", options=KIND_OPTIONS),
            "value": st.column_config.NumberColumn("Значение", min_value=0, step=1),
            "phase": st.column_config.SelectboxColumn("Фаза", options=PHASE_OPTIONS),
        },
        key=skey(scenario, "variable_costs_editor"),
        on_change=_on_variable_costs_edit,
        args=(scenario,),
        hide_index=True,
    )
    if isinstance(edited, pd.DataFrame):
        st.session_state[skey(scenario, "variable_costs_df")] = edited


def _copy_formula_meta(src_key: str, dst_key: str) -> None:
    for suffix in ("__raw", "__formula", "__formula_error"):
        src = f"{src_key}{suffix}"
        dst = f"{dst_key}{suffix}"
        if src in st.session_state:
            st.session_state[dst] = st.session_state[src]


def copy_base_organic_to_stretch() -> None:
    """Копирует органику/SEO/карты/поддержку из Base в Stretch, не трогая RnD/рекламу Stretch."""
    for key in ORGANIC_COPY_KEYS:
        src = skey("base", key)
        dst = skey("stretch", key)
        if src in st.session_state:
            st.session_state[dst] = st.session_state[src]
        if key in FORMULA_FIELDS:
            _copy_formula_meta(src, dst)
    vc = _state_get("base", "variable_costs_df")
    if isinstance(vc, pd.DataFrame):
        st.session_state[skey("stretch", "variable_costs_df")] = vc.copy()
    editor = skey("stretch", "variable_costs_editor")
    if editor in st.session_state:
        del st.session_state[editor]


def reset_to_defaults(scenario: str) -> None:
    defaults = load_defaults()
    st.session_state.num_months = defaults["num_months"]
    for key in SCALAR_KEYS:
        if key in SHARED_KEYS:
            continue
        st.session_state[skey(scenario, key)] = defaults[key]
        if key in FORMULA_FIELDS:
            meta = FORMULA_FIELDS[key]
            reset_formula_field(
                skey(scenario, key),
                float(defaults.get(key) or 0),
                decimals=meta["decimals"],
                as_int=meta["as_int"],
            )
    st.session_state[skey(scenario, "variable_costs_df")] = pd.DataFrame(defaults.get("variable_costs", []))
    vc_editor = skey(scenario, "variable_costs_editor")
    if vc_editor in st.session_state:
        del st.session_state[vc_editor]
    st.session_state[skey(scenario, "team_schedule_df")] = pd.DataFrame(
        build_team_schedule(
            int(defaults["num_months"]),
            int(defaults["rnd_months"]),
            int(defaults["team_headcount_rnd"]),
            float(defaults["team_avg_salary_rnd"]),
            int(defaults["team_headcount_ops"]),
            float(defaults["team_avg_salary_ops"]),
        )
    )
    st.session_state[skey(scenario, "_team_schedule_sig")] = (
        int(defaults["num_months"]),
        int(defaults["rnd_months"]),
    )
    team_editor = skey(scenario, "team_schedule_editor")
    if team_editor in st.session_state:
        del st.session_state[team_editor]
    extra = defaults.get("extra_rnd", []) if scenario == "stretch" else []
    st.session_state[skey(scenario, "extra_rnd_df")] = _extra_rnd_frame(extra)
    rnd_editor = skey(scenario, "extra_rnd_editor")
    if rnd_editor in st.session_state:
        del st.session_state[rnd_editor]


def render_sidebar_controls(scenario: str) -> None:
    title = "Base: органика без рекламы и ЗП" if scenario == "base" else "Stretch: RnD + реклама"
    st.sidebar.header(title)
    st.sidebar.caption("Коэффициенты живут в своей вкладке: переключение их не сбрасывает.")
    with st.sidebar:
        render_horizon_block(scenario)
        render_organic_block(scenario)
        render_seo_dip_block(scenario)
        if scenario == "stretch":
            render_ads_block(scenario)
        render_cards_block(scenario)
        if scenario == "stretch":
            render_extra_rnd_block(scenario, compact=True)
            render_team_block(scenario, compact=True)
        render_costs_block(scenario)
        render_status_quo_block(scenario)
        render_variable_costs_summary(scenario)
        if scenario == "stretch":
            render_lifts_block(scenario)
        if scenario == "base":
            st.info(
                "В Base зарплаты команды, реклама и лифты **принудительно = 0**. "
                "Это не скрытый кост: вкладка отвечает, отобьётся ли забор на текущей органике. "
                "Люди / реклама / лифты — только Stretch."
            )


def render_full_form(scenario: str, *, include_shared_horizon: bool = True) -> None:
    render_horizon_block(scenario, include_shared_horizon=include_shared_horizon)
    st.markdown("---")
    render_organic_block(scenario)
    st.markdown("---")
    render_seo_dip_block(scenario)
    if scenario == "stretch":
        st.markdown("---")
        render_ads_block(scenario)
    st.markdown("---")
    render_cards_block(scenario)
    if scenario == "stretch":
        st.markdown("---")
        render_extra_rnd_block(scenario)
        st.markdown("---")
        render_team_block(scenario)
        render_lifts_block(scenario)
    st.markdown("---")
    render_costs_block(scenario)
    render_status_quo_block(scenario)
    st.markdown("---")
    render_variable_costs_editor(scenario)
