"""Страница вбивки всех параметров модели — вкладки Base / Stretch."""
import streamlit as st

from models import run_model
from ui.form import (
    copy_base_organic_to_stretch,
    read_params,
    render_full_form,
    reset_to_defaults,
)
from utils.formatters import format_currency, format_currency_compact

st.title("Параметры модели")
st.caption(
    "У каждого сценария свой набор коэффициентов. Переключение вкладок их не сбрасывает. "
    "Горизонт расчёта общий, чтобы сравнивать Base и Stretch на одной длине."
)

st.number_input(
    "Горизонт расчёта, мес. (общий)",
    min_value=1, max_value=60, step=1,
    key="num_months",
    help="Один горизонт для обеих вкладок.",
)

base_tab, stretch_tab = st.tabs(["Base", "Stretch"])

with base_tab:
    top = st.columns([3, 1])
    with top[1]:
        if st.button("Сбросить Base к базе", width="stretch"):
            reset_to_defaults("base")
            st.rerun()
    render_full_form("base", include_shared_horizon=False)
    params = read_params("base")
    preview = run_model(params)
    kpis = preview["kpis"]
    base_rev = kpis["gross_month_base"]
    st.markdown("---")
    st.markdown("#### Предпросмотр Base")
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Валовая выручка / мес", format_currency_compact(base_rev))
    c2.metric("Оплачиваемых активаций / мес", f"{kpis['paid_activations_base']:,.0f}".replace(",", " "))
    payback = kpis["payback_incremental_month"]
    c3.metric("Окупаемость vs подрядчик", f"{payback} мес." if payback else "нет")
    c4.metric(
        f"Инкремент за {kpis['num_months']} мес.",
        format_currency_compact(kpis["final_cumulative_incremental"]),
    )
    st.caption(
        f"Точная база: {format_currency(base_rev)} / мес. "
        f"Промо {format_currency(kpis.get('promo_revenue_base', base_rev))} + "
        f"карты {format_currency(kpis.get('card_revenue_base', 0))}."
    )

with stretch_tab:
    top = st.columns([2, 1, 1])
    with top[1]:
        if st.button("Органика из Base", width="stretch"):
            copy_base_organic_to_stretch()
            st.rerun()
    with top[2]:
        if st.button("Сбросить Stretch к базе", width="stretch"):
            reset_to_defaults("stretch")
            st.rerun()
    render_full_form("stretch", include_shared_horizon=False)
    params = read_params("stretch")
    preview = run_model(params)
    kpis = preview["kpis"]
    stretch_rev = kpis["gross_month_base"]
    st.markdown("---")
    st.markdown("#### Предпросмотр Stretch")
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Валовая выручка / мес (база)", format_currency_compact(stretch_rev))
    c2.metric("Окупаемость vs подрядчик", f"{kpis['payback_incremental_month']} мес." if kpis["payback_incremental_month"] else "нет")
    c3.metric("ЗП доп. RnD / горизонт", format_currency_compact(kpis.get("total_extra_rnd_salaries", 0)))
    c4.metric("Реклама / горизонт", format_currency_compact(kpis.get("total_ads_cost", 0)))
    st.caption(
        f"Инкремент за {kpis['num_months']} мес.: "
        f"{format_currency(kpis['final_cumulative_incremental'])}."
    )
