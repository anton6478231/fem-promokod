"""KPI-карточки ФЭМ — Base и Stretch."""
from typing import Any, Dict

import streamlit as st

from utils.formatters import format_currency, format_currency_compact, format_number_compact

_KPI_CSS = """
<style>
section.main div[data-testid="stMetric"] {
    min-width: 0;
    padding: 0.5rem 0.4rem;
    background: #F9FAFB;
    border-radius: 0.5rem;
    border: 1px solid #E5E7EB;
}
section.main div[data-testid="stMetric"] label {
    white-space: normal !important;
    word-break: break-word;
    line-height: 1.3;
    font-size: 0.78rem;
    color: #6B7280;
}
section.main div[data-testid="stMetric"] [data-testid="stMetricValue"] {
    white-space: normal !important;
    word-break: break-word;
    line-height: 1.2;
    font-size: clamp(0.9rem, 2.2vw, 1.25rem);
    font-weight: 700;
    color: #111827;
}
</style>
"""


def display_kpi_cards(kpis: Dict[str, Any], scenario: str = "base") -> None:
    st.markdown(_KPI_CSS, unsafe_allow_html=True)

    payback = kpis.get("payback_incremental_month")
    horizon = kpis["num_months"]
    rnd = kpis["rnd_months"]
    is_stretch = scenario == "stretch"
    payback_help = (
        "Первый месяц, когда накопленный инкремент (проект − «оставить сайт подрядчику») ≥ 0. "
        f"Включая разработку ({rnd} мес.)."
    )
    if is_stretch:
        payback_help += " Stretch дороже Base: зарплаты доп. RnD и реклама сдвигают окупаемость вправо, если лифты не компенсируют."
    else:
        payback_help += " Base: окупаемость забора сайта на текущей органике, без рекламы и продуктовых лифтов."

    r0c1, r0c2, r0c3 = st.columns(3)
    with r0c1:
        if payback:
            st.metric(
                label="Срок окупаемости (vs подрядчик)",
                value=f"{payback} мес.",
                delta="достигнут",
                help=payback_help,
            )
        else:
            st.metric(
                label="Срок окупаемости (vs подрядчик)",
                value="не окупается",
                delta=f"за {horizon} мес.",
                delta_color="inverse",
                help=payback_help,
            )
    with r0c2:
        inc = kpis["final_cumulative_incremental"]
        st.metric(
            label=f"Инкремент за {horizon} мес.",
            value=format_currency_compact(inc),
            delta="лучше подрядчика" if inc >= 0 else "хуже подрядчика",
            delta_color="normal" if inc >= 0 else "inverse",
            help=(
                "Сумма (CF проекта − CF статус-кво) за горизонт. "
                f"Точное значение: {format_currency(inc)}."
            ),
        )
    with r0c3:
        st.metric(
            label="Инвестиции на разработке (vs статус-кво)",
            value=format_currency_compact(kpis["rnd_investment"]),
            help=(
                "Сколько проект проигрывает статус-кво за месяцы разработки сайта: "
                "стоимость разработки + (в Stretch) старт команды. "
                f"{format_currency(kpis['rnd_investment'])}."
            ),
        )

    st.markdown("---")

    r1c1, r1c2, r1c3, r1c4 = st.columns(4)
    with r1c1:
        st.metric(
            label=f"Выручка за {horizon} мес.",
            value=format_currency_compact(kpis["total_gross"]),
            help=f"Валовая выручка проекта: {format_currency(kpis['total_gross'])}.",
        )
    with r1c2:
        st.metric(
            label=f"Затраты за {horizon} мес.",
            value=format_currency_compact(kpis["total_costs"]),
            help=f"Разработка + поддержка + подрядчик + (Stretch: ЗП, реклама): {format_currency(kpis['total_costs'])}.",
        )
    with r1c3:
        cf = kpis["total_cf"]
        st.metric(
            label=f"CF проекта за {horizon} мес.",
            value=format_currency_compact(cf),
            delta="прибыль" if cf >= 0 else "убыток",
            delta_color="normal" if cf >= 0 else "inverse",
            help=f"Сумма (выручка − затраты) по месяцам: {format_currency(cf)}.",
        )
    with r1c4:
        st.metric(
            label="Оплачиваемых активаций / мес (база)",
            value=format_number_compact(kpis["paid_activations_base"]),
            help=(
                f"{kpis['paid_activations_base']:,.0f} шт. в статус-кво "
                "(органика × конверсия × одобренные × оплачиваемые)."
            ),
        )

    if is_stretch:
        s1, s2, s3, s4 = st.columns(4)
        with s1:
            st.metric(
                label=f"Промо органика за {horizon} мес.",
                value=format_currency_compact(kpis.get("total_organic_promo", 0)),
                help=format_currency(kpis.get("total_organic_promo", 0)),
            )
        with s2:
            st.metric(
                label=f"Промо с рекламы за {horizon} мес.",
                value=format_currency_compact(kpis.get("total_ads_promo", 0)),
                help=format_currency(kpis.get("total_ads_promo", 0)),
            )
        with s3:
            st.metric(
                label=f"Бюджет рекламы за {horizon} мес.",
                value=format_currency_compact(kpis.get("total_ads_cost", 0)),
                help=format_currency(kpis.get("total_ads_cost", 0)),
            )
        with s4:
            st.metric(
                label=f"ЗП доп. RnD за {horizon} мес.",
                value=format_currency_compact(kpis.get("total_extra_rnd_salaries", 0)),
                help=format_currency(kpis.get("total_extra_rnd_salaries", 0)),
            )
