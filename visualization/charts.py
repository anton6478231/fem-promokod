"""Графики Plotly для упрощённой ФЭМ сайта промокодов."""
from typing import Any, Dict, List

import plotly.graph_objects as go


def _month_labels(rows: List[Dict[str, Any]]) -> List[str]:
    labels = []
    for r in rows:
        if r["phase"] == "rnd":
            labels.append(f"М{r['month']} RnD")
        else:
            labels.append(f"М{r['month']} свой")
    return labels


def _rnd_vrect(fig: go.Figure, rows: List[Dict[str, Any]]) -> None:
    rnd = [r["month"] for r in rows if r["phase"] == "rnd"]
    if not rnd:
        return
    fig.add_vrect(
        x0=rnd[0] - 0.5,
        x1=rnd[-1] + 0.5,
        fillcolor="rgba(156, 163, 175, 0.16)",
        layer="below",
        line_width=0,
        annotation_text="RnD: сайт у подрядчика",
        annotation_position="top left",
        annotation_font_color="#6B7280",
        annotation_font_size=11,
    )
    fig.add_vline(
        x=rnd[-1] + 0.5,
        line_dash="solid",
        line_color="#6B7280",
        line_width=1.5,
        opacity=0.85,
        annotation_text="свой сайт",
        annotation_position="top right",
        annotation_font_color="#6B7280",
        annotation_font_size=11,
    )


def create_cash_flow_chart(project: List[Dict[str, Any]]) -> go.Figure:
    months = [r["month"] for r in project]
    labels = _month_labels(project)

    fig = go.Figure()
    _rnd_vrect(fig, project)

    fig.add_trace(go.Scatter(
        x=months, y=[r["gross_revenue"] for r in project],
        mode="lines+markers",
        name="Выручка (валовая)",
        line=dict(color="#10B981", width=3),
        marker=dict(size=7),
        hovertemplate="%{x} мес.: %{y:,.0f} ₽<extra>Выручка</extra>",
    ))
    fig.add_trace(go.Scatter(
        x=months, y=[r["total_costs"] for r in project],
        mode="lines+markers",
        name="Затраты",
        line=dict(color="#EF4444", width=3),
        marker=dict(size=7),
        hovertemplate="%{x} мес.: %{y:,.0f} ₽<extra>Затраты</extra>",
    ))
    fig.add_trace(go.Scatter(
        x=months, y=[r["cash_flow"] for r in project],
        mode="lines+markers",
        name="Cash Flow (мес.)",
        line=dict(color="#3B82F6", width=2),
        marker=dict(size=6),
        hovertemplate="%{x} мес.: %{y:,.0f} ₽<extra>CF</extra>",
    ))
    fig.add_trace(go.Scatter(
        x=months, y=[r["cumulative_cf"] for r in project],
        mode="lines+markers",
        name="Накопленный CF",
        line=dict(color="#8B5CF6", width=2, dash="dash"),
        marker=dict(size=5),
        hovertemplate="%{x} мес.: %{y:,.0f} ₽<extra>Cum CF</extra>",
    ))

    fig.add_hline(y=0, line_dash="dot", line_color="gray", opacity=0.5)

    fig.update_xaxes(tickmode="array", tickvals=months, ticktext=labels)
    fig.update_layout(
        title="Выручка, затраты и денежный поток по месяцам",
        xaxis_title="Месяц проекта",
        yaxis_title="Рубли (₽)",
        hovermode="x unified",
        template="plotly_white",
        height=520,
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
    )
    return fig


def create_incremental_chart(
    project: List[Dict[str, Any]],
    payback_month: Any = None,
) -> go.Figure:
    months = [r["month"] for r in project]
    labels = _month_labels(project)
    fig = go.Figure()
    _rnd_vrect(fig, project)

    fig.add_trace(go.Scatter(
        x=months, y=[r["cash_flow"] for r in project],
        mode="lines+markers",
        name="CF проекта (забрать сайт)",
        line=dict(color="#3B82F6", width=3),
        marker=dict(size=6),
        hovertemplate="%{x} мес.: %{y:,.0f} ₽<extra>Проект</extra>",
    ))
    fig.add_trace(go.Scatter(
        x=months, y=[r["sq_cash_flow"] for r in project],
        mode="lines+markers",
        name="CF статус-кво (оставить подрядчику)",
        line=dict(color="#9CA3AF", width=2, dash="dot"),
        marker=dict(size=5),
        hovertemplate="%{x} мес.: %{y:,.0f} ₽<extra>Статус-кво</extra>",
    ))
    fig.add_trace(go.Scatter(
        x=months, y=[r["cumulative_incremental"] for r in project],
        mode="lines+markers",
        name="Накопленный инкремент vs подрядчик",
        line=dict(color="#F59E0B", width=2, dash="dash"),
        marker=dict(size=5),
        hovertemplate="%{x} мес.: %{y:,.0f} ₽<extra>Инкремент</extra>",
    ))
    fig.add_hline(y=0, line_dash="dot", line_color="gray", opacity=0.5)

    if payback_month:
        hit = next((r for r in project if r["month"] == payback_month), None)
        if hit:
            fig.add_trace(go.Scatter(
                x=[hit["month"]],
                y=[hit["cumulative_incremental"]],
                mode="markers",
                name=f"Окупаемость (М{payback_month})",
                marker=dict(size=14, color="#F59E0B", symbol="star"),
                hovertemplate=f"Инкремент ≥ 0 в месяце {payback_month}<extra></extra>",
            ))

    fig.update_xaxes(tickmode="array", tickvals=months, ticktext=labels)
    fig.update_layout(
        title="Проект vs оставить сайт подрядчику (инкрементальный CF)",
        xaxis_title="Месяц проекта",
        yaxis_title="Рубли (₽)",
        hovermode="x unified",
        template="plotly_white",
        height=480,
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
    )
    return fig


def create_costs_structure_chart(project: List[Dict[str, Any]]) -> go.Figure:
    months = [r["month"] for r in project]
    labels = _month_labels(project)
    fig = go.Figure()
    _rnd_vrect(fig, project)

    fig.add_trace(go.Bar(
        x=months, y=[r.get("ops_salaries", 0) for r in project],
        name="ЗП сопровождения",
        marker_color="#EF4444",
        hovertemplate="%{x} мес.: %{y:,.0f} ₽<extra>ЗП сопровождения</extra>",
    ))
    fig.add_trace(go.Bar(
        x=months, y=[r.get("extra_rnd_salaries", 0) for r in project],
        name="ЗП доп. RnD",
        marker_color="#BE123C",
        hovertemplate="%{x} мес.: %{y:,.0f} ₽<extra>Доп. RnD</extra>",
    ))
    fig.add_trace(go.Bar(
        x=months, y=[r.get("dev_cost", 0) for r in project],
        name="Разработка сайта",
        marker_color="#7C3AED",
        hovertemplate="%{x} мес.: %{y:,.0f} ₽<extra>Разработка</extra>",
    ))
    fig.add_trace(go.Bar(
        x=months, y=[r["support"] for r in project],
        name="Поддержка",
        marker_color="#F97316",
        hovertemplate="%{x} мес.: %{y:,.0f} ₽<extra>Поддержка</extra>",
    ))
    fig.add_trace(go.Bar(
        x=months, y=[r["variable_costs"] for r in project],
        name="Переменные",
        marker_color="#F59E0B",
        hovertemplate="%{x} мес.: %{y:,.0f} ₽<extra>Переменные</extra>",
    ))
    fig.add_trace(go.Bar(
        x=months, y=[r.get("ads_cost", 0) for r in project],
        name="Реклама",
        marker_color="#2563EB",
        hovertemplate="%{x} мес.: %{y:,.0f} ₽<extra>Реклама</extra>",
    ))
    fig.add_trace(go.Bar(
        x=months, y=[r["contractor_cost"] for r in project],
        name="Доля подрядчика",
        marker_color="#6B7280",
        hovertemplate="%{x} мес.: %{y:,.0f} ₽<extra>Подрядчик</extra>",
    ))

    fig.update_xaxes(tickmode="array", tickvals=months, ticktext=labels)
    fig.update_layout(
        title="Структура затрат по месяцам",
        xaxis_title="Месяц проекта",
        yaxis_title="Рубли (₽)",
        barmode="stack",
        hovermode="x unified",
        template="plotly_white",
        height=440,
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
    )
    return fig


def create_seo_traffic_chart(project: List[Dict[str, Any]]) -> go.Figure:
    months = [r["month"] for r in project]
    labels = _month_labels(project)
    fig = go.Figure()
    _rnd_vrect(fig, project)

    dipped = [r for r in project if r.get("phase") == "own" and r.get("seo_factor", 1.0) < 0.999]
    if dipped:
        fig.add_vrect(
            x0=dipped[0]["month"] - 0.5,
            x1=dipped[-1]["month"] + 0.5,
            fillcolor="rgba(245, 158, 11, 0.12)",
            layer="below",
            line_width=0,
            annotation_text="SEO-восстановление",
            annotation_position="top left",
            annotation_font_color="#B45309",
            annotation_font_size=11,
        )

    fig.add_trace(go.Scatter(
        x=months, y=[r.get("sq_organic_traffic", r.get("organic_traffic", 0)) for r in project],
        mode="lines+markers",
        name="Органика статус-кво",
        line=dict(color="#9CA3AF", width=2, dash="dot"),
        marker=dict(size=5),
        hovertemplate="%{x} мес.: %{y:,.0f}<extra>Статус-кво</extra>",
    ))
    show_pre_seo = any(
        abs(r.get("organic_traffic_pre_seo", r.get("organic_traffic", 0)) - r.get("organic_traffic", 0)) > 0.5
        for r in project
    ) and any(
        abs(r.get("organic_traffic_pre_seo", 0) - r.get("sq_organic_traffic", r.get("organic_traffic", 0))) > 0.5
        for r in project
    )
    if show_pre_seo:
        fig.add_trace(go.Scatter(
            x=months, y=[r.get("organic_traffic_pre_seo", 0) for r in project],
            mode="lines+markers",
            name="Органика без SEO-просадки",
            line=dict(color="#34D399", width=2, dash="dash"),
            marker=dict(size=5),
            hovertemplate="%{x} мес.: %{y:,.0f}<extra>Без просадки</extra>",
        ))
    fig.add_trace(go.Scatter(
        x=months,
        y=[r.get("organic_traffic", 0) for r in project],
        mode="lines+markers",
        name="Органика проекта",
        line=dict(color="#059669", width=3),
        marker=dict(size=7),
        customdata=[[r.get("seo_factor", 1.0) * 100.0] for r in project],
        hovertemplate="%{x} мес.: %{y:,.0f} (SEO %{customdata[0]:.0f}%)<extra>Проект</extra>",
    ))

    fig.update_xaxes(tickmode="array", tickvals=months, ticktext=labels)
    fig.update_layout(
        title="Органический трафик: SEO-просадка после переезда",
        xaxis_title="Месяц проекта",
        yaxis_title="Визиты / мес.",
        hovermode="x unified",
        template="plotly_white",
        height=440,
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
    )
    return fig


def create_channel_chart(project: List[Dict[str, Any]]) -> go.Figure:
    months = [r["month"] for r in project]
    labels = _month_labels(project)
    fig = go.Figure()
    _rnd_vrect(fig, project)
    fig.add_trace(go.Bar(
        x=months, y=[r.get("organic_promo_revenue", 0) for r in project],
        name="Промо органика",
        marker_color="#059669",
        hovertemplate="%{x} мес.: %{y:,.0f} ₽<extra>Органика</extra>",
    ))
    fig.add_trace(go.Bar(
        x=months, y=[r.get("ads_promo_revenue", 0) for r in project],
        name="Промо реклама",
        marker_color="#2563EB",
        hovertemplate="%{x} мес.: %{y:,.0f} ₽<extra>Реклама</extra>",
    ))
    fig.add_trace(go.Bar(
        x=months, y=[r.get("card_revenue", 0) for r in project],
        name="Карты",
        marker_color="#D97706",
        hovertemplate="%{x} мес.: %{y:,.0f} ₽<extra>Карты</extra>",
    ))
    fig.add_trace(go.Bar(
        x=months, y=[r.get("extra_product_revenue", 0) for r in project],
        name="Доп. выручка RnD",
        marker_color="#7C3AED",
        hovertemplate="%{x} мес.: %{y:,.0f} ₽<extra>Доп. продукт</extra>",
    ))
    fig.update_xaxes(tickmode="array", tickvals=months, ticktext=labels)
    fig.update_layout(
        title="Выручка по каналам: органика vs реклама",
        xaxis_title="Месяц проекта",
        yaxis_title="Рубли (₽)",
        barmode="stack",
        hovermode="x unified",
        template="plotly_white",
        height=440,
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
    )
    return fig
