"""Общий экран расчёта для вкладок Base и Stretch."""
from __future__ import annotations

import pandas as pd
import streamlit as st

from models import run_model, sensitivity_table
from ui.form import (
    copy_base_organic_to_stretch,
    read_params,
    render_sidebar_controls,
    render_variable_costs_editor,
)
from utils.formatters import format_currency, format_currency_compact
from visualization import (
    create_cash_flow_chart,
    create_channel_chart,
    create_costs_structure_chart,
    create_incremental_chart,
    create_seo_traffic_chart,
    display_kpi_cards,
)


SCENARIO_META = {
    "base": {
        "title": "Base — органика без рекламы и зарплат",
        "caption": (
            "Забираем сайт: N месяцев разработки, дальше только поддержка. "
            "Воронка — текущий органический трафик, без рекламы и без продуктовых лифтов. "
            "Нужен, чтобы понять, отобьётся ли инвестиция на том, что уже есть."
        ),
    },
    "stretch": {
        "title": "Stretch — доп. RnD + реклама",
        "caption": (
            "Тот же забор сайта, плюс ручной продуктовый RnD (зарплаты и лифты после завершения) "
            "и рекламный канал с отдельными коэффициентами активации."
        ),
    },
}


def _payback_label(month) -> str:
    return f"{month} мес." if month else "нет"


def render_comparison(current: str) -> None:
    base = run_model(read_params("base"))["kpis"]
    stretch = run_model(read_params("stretch"))["kpis"]
    st.markdown("#### Base vs Stretch")
    mark = " ← эта вкладка"
    st.caption(
        f"Коэффициенты считаются из session_state обеих вкладок. "
        f"Сейчас открыт **{current}**{mark}."
    )
    rows = [
        ("Окупаемость vs подрядчик",
         _payback_label(base["payback_incremental_month"]),
         _payback_label(stretch["payback_incremental_month"])),
        (f"Инкремент за {base['num_months']} мес.",
         format_currency(base["final_cumulative_incremental"]),
         format_currency(stretch["final_cumulative_incremental"])),
        ("CF проекта", format_currency(base["total_cf"]), format_currency(stretch["total_cf"])),
        ("Выручка", format_currency(base["total_gross"]), format_currency(stretch["total_gross"])),
        ("Затраты", format_currency(base["total_costs"]), format_currency(stretch["total_costs"])),
        ("ЗП доп. RnD", "—", format_currency(stretch.get("total_extra_rnd_salaries", 0.0))),
        ("Реклама", "—", format_currency(stretch.get("total_ads_cost", 0.0))),
    ]
    st.dataframe(
        pd.DataFrame(rows, columns=["Метрика", "Base", "Stretch"]),
        width="stretch",
        hide_index=True,
    )


def _month_cost_lines(row: dict | None, extra_vc_names: list[str] | None = None) -> list[tuple[str, float]]:
    if not row:
        return []
    lines = [
        ("Выручка (валовая)", row.get("gross_revenue", 0.0)),
        ("  промо органика", row.get("organic_promo_revenue", 0.0)),
        ("  промо реклама", row.get("ads_promo_revenue", 0.0)),
        ("  карты", row.get("card_revenue", 0.0)),
        ("  доп. выручка RnD", row.get("extra_product_revenue", 0.0)),
        ("Доля подрядчика", -row.get("contractor_cost", 0.0)),
        ("Разработка сайта", -row.get("dev_cost", 0.0)),
        ("Поддержка", -row.get("support", 0.0)),
        ("ЗП сопровождения", -row.get("ops_salaries", 0.0)),
        ("ЗП доп. RnD", -row.get("extra_rnd_salaries", 0.0)),
        ("Реклама", -row.get("ads_cost", 0.0)),
    ]
    breakdown = {str(name): -float(amount) for name, amount in (row.get("variable_breakdown") or {}).items()}
    for name in extra_vc_names or []:
        if name and name not in breakdown:
            breakdown[name] = 0.0
    for name, amount in breakdown.items():
        lines.append((name, amount))
    leftover = float(row.get("variable_costs") or 0.0) - sum(
        float(v) for v in (row.get("variable_breakdown") or {}).values()
    )
    if abs(leftover) > 0.5:
        lines.append(("Прочие переменные", -leftover))
    lines.append(("Итого затраты", -row.get("total_costs", 0.0)))
    lines.append(("CF месяца", row.get("cash_flow", 0.0)))
    return lines


KEEP_ZERO_ROWS = {
    "Выручка (валовая)",
    "Доля подрядчика",
    "Разработка сайта",
    "Поддержка",
    "Итого затраты",
    "CF месяца",
}


def render_opex_map(kpis: dict, params: dict | None = None) -> None:
    sq = kpis.get("typical_sq")
    rnd = kpis.get("typical_rnd")
    own = kpis.get("typical_own")
    if not (sq or rnd or own):
        return

    extra_vc_names = [
        str(item.get("name") or "").strip()
        for item in (params or {}).get("variable_costs") or []
        if str(item.get("name") or "").strip()
    ]
    keep_zero = KEEP_ZERO_ROWS | set(extra_vc_names)

    labels: list[str] = []
    for source in (sq, rnd, own):
        for name, _ in _month_cost_lines(source, extra_vc_names):
            if name not in labels:
                labels.append(name)

    def _as_map(row: dict | None) -> dict[str, float]:
        return {name: value for name, value in _month_cost_lines(row, extra_vc_names)}

    sq_map, rnd_map, own_map = _as_map(sq), _as_map(rnd), _as_map(own)
    table_rows = []
    for name in labels:
        sq_v, rnd_v, own_v = sq_map.get(name, 0.0), rnd_map.get(name, 0.0), own_map.get(name, 0.0)
        if name not in keep_zero and abs(sq_v) < 0.5 and abs(rnd_v) < 0.5 and abs(own_v) < 0.5:
            continue
        table_rows.append({
            "Статья": name,
            "Статус-кво (подрядчик)": sq_v,
            "RnD проекта": rnd_v,
            "Свой сайт": own_v,
        })

    st.markdown("#### Из чего складывается месяц")
    st.caption(
        "Считается заново при каждом изменении таблицы ниже. 0 ₽ = статья есть, но в этой фазе не списывается. "
        "Отрицательные = затраты. «Свой сайт» — первый месяц с SEO = 100% (или последний, если горизонт короче восстановления)."
    )
    st.dataframe(
        pd.DataFrame(table_rows),
        width="stretch",
        hide_index=True,
        column_config={
            "Статус-кво (подрядчик)": st.column_config.NumberColumn(format="%.0f ₽"),
            "RnD проекта": st.column_config.NumberColumn(format="%.0f ₽"),
            "Свой сайт": st.column_config.NumberColumn(format="%.0f ₽"),
        },
    )


def render_typical_month(kpis: dict, scenario: str) -> None:
    own = kpis.get("typical_own")
    own_launch = kpis.get("typical_own_launch")
    rnd = kpis.get("typical_rnd")
    sq = kpis.get("typical_sq")
    if not (rnd or own or sq):
        return

    show_launch = (
        own_launch
        and own
        and own_launch.get("month") != own.get("month")
        and abs(float(own_launch.get("seo_factor", 1.0)) - float(own.get("seo_factor", 1.0))) > 0.001
    )
    st.markdown("#### Типовой месяц")
    if show_launch:
        st.caption(
            f"«Свой сайт» — первый месяц с восстановленным SEO "
            f"(мес. {own['month']}, {own.get('seo_factor', 1) * 100:.0f}%). "
            f"Отдельно — первый месяц после переезда (мес. {own_launch['month']}, "
            f"{own_launch.get('seo_factor', 1) * 100:.0f}% органики)."
        )
        cols = st.columns(4)
        blocks = [
            (cols[0], sq, "Статус-кво (оставить подрядчику)"),
            (cols[1], rnd, "Разработка (сайт ещё у подрядчика)"),
            (cols[2], own_launch, "Первый свой месяц (SEO-просадка)"),
            (cols[3], own, "Свой сайт после восстановления SEO"),
        ]
    else:
        cols = st.columns(3)
        blocks = [
            (cols[0], sq, "Статус-кво (оставить подрядчику)"),
            (cols[1], rnd, "Разработка (сайт ещё у подрядчика)"),
            (cols[2], own, "Свой сайт"),
        ]
    for col, row, title in blocks:
        with col:
            st.markdown(f"**{title}**")
            if not row:
                st.caption("Нет месяцев этой фазы.")
                continue
            seo_pct = float(row.get("seo_factor", 1.0)) * 100.0
            lines = [
                f"- Органика: {row.get('organic_traffic', 0):,.0f} визитов (SEO {seo_pct:.0f}%)",
                f"- Валовая выручка: {format_currency(row['gross_revenue'])}",
                f"- промо органика: {format_currency(row.get('organic_promo_revenue', 0))}",
            ]
            if scenario == "stretch":
                lines.append(f"- промо реклама: {format_currency(row.get('ads_promo_revenue', 0))}")
            lines.extend([
                f"- карты: {format_currency(row.get('card_revenue', 0))}",
                f"- доля подрядчика: {format_currency(row['contractor_cost'])}",
                f"- разработка: {format_currency(row.get('dev_cost', 0))}",
                f"- поддержка: {format_currency(row['support'])}",
            ])
            for name, amount in (row.get("variable_breakdown") or {}).items():
                lines.append(f"- {name}: {format_currency(amount)}")
            if scenario == "stretch":
                lines.append(f"- ЗП сопровождения: {format_currency(row.get('ops_salaries', 0))}")
                lines.append(f"- ЗП доп. RnD: {format_currency(row.get('extra_rnd_salaries', 0))}")
                lines.append(f"- реклама: {format_currency(row.get('ads_cost', 0))}")
            lines.append(f"- **CF месяца: {format_currency(row['cash_flow'])}**")
            st.write("\n".join(lines).replace(",", " "))


def render_month_table(project: list, scenario: str) -> None:
    st.markdown("#### Помесячная таблица")
    phase_ru = {"rnd": "разработка", "own": "свой сайт"}
    rows = []
    for r in project:
        row = {
            "Месяц": r["month"],
            "Фаза": phase_ru.get(r["phase"], r["phase"]),
            "Органика": r.get("organic_traffic", r["traffic"]),
            "SEO, %": r.get("seo_factor", 1.0) * 100.0,
            "Акт. органика": r.get("organic_activations", 0),
            "Оплачено органика": r.get("organic_paid_activations", 0),
            "Промо органика": r.get("organic_promo_revenue", 0),
        }
        if scenario == "stretch":
            row.update({
                "Реклама визиты": r.get("ads_traffic", 0),
                "Акт. реклама": r.get("ads_activations", 0),
                "Оплачено реклама": r.get("ads_paid_activations", 0),
                "Промо реклама": r.get("ads_promo_revenue", 0),
                "Бюджет рекламы": r.get("ads_cost", 0),
                "ЗП доп. RnD": r.get("extra_rnd_salaries", 0),
                "ЗП сопровожд.": r.get("ops_salaries", 0),
                "Доп. продукт": r.get("extra_product_revenue", 0),
            })
        row.update({
            "Карты": r.get("card_revenue", 0),
            "Выручка": r["gross_revenue"],
            "Подрядчик": r["contractor_cost"],
            "Разработка": r.get("dev_cost", 0),
            "Поддержка": r["support"],
            "Переменные": r["variable_costs"],
            "Затраты": r["total_costs"],
            "CF": r["cash_flow"],
            "Накопл. CF": r["cumulative_cf"],
            "CF статус-кво": r["sq_cash_flow"],
            "Инкремент": r["incremental_cf"],
            "Накопл. инкремент": r["cumulative_incremental"],
        })
        rows.append(row)
    table = pd.DataFrame(rows)
    money_cols = [
        col for col in table.columns
        if col not in ("Месяц", "Фаза", "Органика", "SEO, %", "Акт. органика", "Оплачено органика",
                       "Реклама визиты", "Акт. реклама", "Оплачено реклама")
    ]
    config = {
        "Органика": st.column_config.NumberColumn(format="%.0f"),
        "SEO, %": st.column_config.NumberColumn(format="%.0f"),
        "Акт. органика": st.column_config.NumberColumn(format="%.0f"),
        "Оплачено органика": st.column_config.NumberColumn(format="%.0f"),
        "Реклама визиты": st.column_config.NumberColumn(format="%.0f"),
        "Акт. реклама": st.column_config.NumberColumn(format="%.0f"),
        "Оплачено реклама": st.column_config.NumberColumn(format="%.0f"),
    }
    for col in money_cols:
        config[col] = st.column_config.NumberColumn(format="%.0f ₽")
    st.dataframe(table, width="stretch", hide_index=True, column_config=config)


def render_scenario(scenario: str) -> None:
    render_sidebar_controls(scenario)
    params = read_params(scenario)
    result = run_model(params)
    project = result["project"]
    kpis = result["kpis"]
    meta = SCENARIO_META[scenario]

    st.title(meta["title"])
    st.caption(
        meta["caption"]
        + " Косты месяца (поддержка, хостинг, SEO, атрибуция) — в таблице «Из чего складывается месяц»."
    )

    if scenario == "stretch":
        if st.button("Скопировать органику и поддержку из Base", help="Не трогает доп. RnD, рекламу, лифты и команду Stretch. Копирует SEO-просадку."):
            copy_base_organic_to_stretch()
            st.rerun()

    traffic = params["traffic_month"]
    arpu = params["arpu"]
    gross = kpis["gross_month_base"]
    promo = kpis.get("promo_revenue_base", gross)
    cards = kpis.get("card_revenue_base", 0.0)
    seo_note = ""
    if params.get("seo_dip_enabled", True):
        seo_note = (
            f" После переезда органика × SEO-фактор "
            f"(пол {params.get('seo_dip_floor_pct', 70):.0f}%, "
            f"{params.get('seo_recovery_months', 6)} мес. до 100%)."
        )
    st.info(
        (
            f"**Органика в базе:** {traffic:,.0f} × {params['conversion_pct']:.1f}% × "
            f"{params.get('approved_activation_share_pct', 100):.1f}% × "
            f"{params['paid_partner_share_pct']:.1f}% × {arpu:,.0f} ₽ = "
            f"**{format_currency(promo)} / мес.** "
            f"**Карты:** Black {params.get('black_share_pct', 0):.2f}% × {params.get('black_ltv', 0):,.0f} ₽ + "
            f"Platinum {params.get('platinum_share_pct', 0):.2f}% × {params.get('platinum_ltv', 0):,.0f} ₽ = "
            f"**{format_currency(cards)} / мес.** "
            f"Итого статус-кво **{format_currency(gross)} / мес.** "
            f"({format_currency_compact(gross * 12)} / год)."
            f"{seo_note}"
        ).replace(",", " ")
    )

    display_kpi_cards(kpis, scenario)
    render_typical_month(kpis, scenario)
    render_opex_map(kpis, params)
    render_variable_costs_editor(scenario)

    st.markdown("---")
    render_comparison(scenario)

    st.markdown("---")
    st.plotly_chart(create_seo_traffic_chart(project), width="stretch")
    st.plotly_chart(create_cash_flow_chart(project), width="stretch")
    st.plotly_chart(
        create_incremental_chart(project, kpis.get("payback_incremental_month")),
        width="stretch",
    )
    if scenario == "stretch":
        st.plotly_chart(create_channel_chart(project), width="stretch")
    st.plotly_chart(create_costs_structure_chart(project), width="stretch")

    st.markdown("#### Чувствительность инкремента (±20% к драйверам выручки)")
    st.caption("Как меняется накопленный инкремент vs подрядчик и срок окупаемости, если сдвинуть один параметр.")
    sens = sensitivity_table(params)
    sens_rows = []
    for key, rows in sens.items():
        label = rows[0]["label"]
        by_delta = {r["delta"]: r for r in rows}
        payback = by_delta[0.0]["payback"]
        sens_rows.append({
            "Параметр": label,
            "−20% инкремент": by_delta[-0.2]["total_incremental"],
            "База инкремент": by_delta[0.0]["total_incremental"],
            "+20% инкремент": by_delta[0.2]["total_incremental"],
            "Окупаемость база": f"{payback} мес." if payback else "нет",
        })
    st.dataframe(
        pd.DataFrame(sens_rows),
        width="stretch",
        hide_index=True,
        column_config={
            "−20% инкремент": st.column_config.NumberColumn(format="%.0f ₽"),
            "База инкремент": st.column_config.NumberColumn(format="%.0f ₽"),
            "+20% инкремент": st.column_config.NumberColumn(format="%.0f ₽"),
        },
    )

    render_month_table(project, scenario)
