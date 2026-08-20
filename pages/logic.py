"""Страница с формулами и допущениями модели."""
import streamlit as st

from ui.form import read_params
from utils.formatters import format_currency

base = read_params("base")
stretch = read_params("stretch")


def _promo(p: dict) -> float:
    return (
        p["traffic_month"]
        * (p["conversion_pct"] / 100.0)
        * (p.get("approved_activation_share_pct", 100.0) / 100.0)
        * (p["paid_partner_share_pct"] / 100.0)
        * p["arpu"]
    )


promo = _promo(base)
black_on = bool(base.get("card_black_enabled", True))
plat_on = bool(base.get("card_platinum_enabled", True))
black_rev = (
    base["traffic_month"] * (base.get("black_share_pct", 0.0) / 100.0) * base.get("black_ltv", 0.0)
    if black_on else 0.0
)
plat_rev = (
    base["traffic_month"] * (base.get("platinum_share_pct", 0.0) / 100.0) * base.get("platinum_ltv", 0.0)
    if plat_on else 0.0
)
gross = promo + black_rev + plat_rev

st.title("Логика модели")
st.caption("Одна формула выручки, два сценария: Base (органика) и Stretch (RnD + реклама).")

st.markdown("### Что моделируем")
st.markdown(
    """
Сайт отдаёт неперсонализированные промокоды неавторизованному трафику. Деньги приходят
только если партнёр подтвердил целевое действие. Параллельно с того же трафика можно
моделировать оформление карт **Black** и **Platinum**.

Сейчас площадка у подрядчика: часть **промо**-выручки ему уходит, LTV карт — целиком банку.

Две вкладки считают **одну и ту же воронку**, но разный кост и upside:

| | **Base** | **Stretch** |
|---|---|---|
| Зачем | отобьётся ли забор сайта на текущей органике | что будет, если ещё вложить в продукт и рекламу |
| Трафик | органика, после RnD — SEO-просадка | органика (та же SEO-просадка) + реклама |
| После запуска | только поддержка, **без зарплат** | поддержка + ЗП доп. RnD + опционально команда |
| Продукт | без лифтов | ручные инициативы RnD → лифты и/или доп. выручка после завершения |
| Реклама | нет | бюджет ₽/мес + отдельная воронка активации |
"""
)

st.markdown("### Формула выручки")
st.latex(r"T_{org,t} = T_{org} \times L_{traffic,t} \times SEO_t")
st.latex(r"R_{promo}^{ch} = T_{ch} \times CR_{ch} \times S_{approved,ch} \times S_{paid,ch} \times ARPU")
st.latex(r"R_{promo} = R_{promo}^{org} + R_{promo}^{ads}")
st.latex(r"R_{black} = (T_{org}+T_{ads}) \times S_{black} \times LTV_{black}")
st.latex(r"R_{plat} = (T_{org}+T_{ads}) \times S_{plat} \times LTV_{plat}")
st.latex(r"R = R_{promo} + R_{black} + R_{plat} + R_{extra}")
st.markdown(
    f"""
Органика сейчас в Base:

| Символ | Смысл | Сейчас |
|---|---|---|
| $T_{{org}}$ | органические визиты / мес | {base['traffic_month']:,.0f} |
| $CR_{{org}}$ | клик «Активировать» | {base['conversion_pct']:.1f}% |
| $S_{{approved,org}}$ | дошли до целевого действия | {base.get('approved_activation_share_pct', 100):.1f}% |
| $S_{{paid,org}}$ | партнёр оплатил | {base['paid_partner_share_pct']:.1f}% |
| $ARPU$ | выплата за оплаченную активацию | {base['arpu']:,.0f} ₽ |
| $R_{{promo}}^{{org}}$ | промо-выручка органики | {format_currency(promo)} |
| $R$ | валовая выручка месяца (статус-кво) | **{format_currency(gross)}** |
""".replace(",", " ")
)
st.markdown(
    f"""
Реклама в Stretch (своя воронка, не смешивается с органикой):

| Символ | Смысл | Сейчас |
|---|---|---|
| $T_{{ads}}$ | рекламные визиты / мес | {stretch.get('ads_traffic_month', 0):,.0f} |
| $CR_{{ads}}$ | активация с рекламы | {stretch.get('conversion_pct_ads', 0):.1f}% |
| $S_{{approved,ads}}$ | одобренные с рекламы | {stretch.get('approved_activation_share_pct_ads', 100):.1f}% |
| $S_{{paid,ads}}$ | оплаченные с рекламы | {stretch.get('paid_partner_share_pct_ads', 0):.1f}% |
| бюджет | ₽ / мес пока реклама включена | {stretch.get('ads_cost_month', 0):,.0f} ₽ |
""".replace(",", " ")
)

st.markdown("### Фазы")
c1, c2 = st.columns(2)
with c1:
    st.markdown("**Разработка (сайт ещё у подрядчика)**")
    st.markdown(
        f"""
- Выручка как в базе (в Stretch уже может капать реклама, если старт ≤ этого месяца)
- Минус доля подрядчика {base['contractor_share_pct']:.0f}% **только с промо**
- Минус стоимость разработки {base.get('dev_cost_month', 0):,.0f} ₽/мес
- Минус поддержка {base['support_rnd']:,.0f} ₽
- Длительность: Base {base['rnd_months']} мес., Stretch {stretch['rnd_months']} мес.
""".replace(",", " ")
    )
with c2:
    st.markdown("**Свой сайт**")
    st.markdown(
        f"""
- **Base:** доля подрядчика = 0, зарплат нет, только поддержка {base['support_ops']:,.0f} ₽ + переменные. Органика × $SEO_t$
- **Stretch:** плюс ЗП доп. RnD (пока инициатива идёт), после завершения — лифты воронки и $R_{{extra}}$. Лифт трафика умножается **поверх** $SEO_t$
- Реклама: отдельный $T_{{ads}}$ и бюджет, если месяц попал в окно кампании; **SEO-просадка на рекламу не действует**
""".replace(",", " ")
    )

st.markdown("### SEO-просадка после переезда")
base_seo_on = bool(base.get("seo_dip_enabled", True))
stretch_seo_on = bool(stretch.get("seo_dip_enabled", True))
base_floor = float(base.get("seo_dip_floor_pct", 70) or 0)
stretch_floor = float(stretch.get("seo_dip_floor_pct", 70) or 0)
base_rec = int(base.get("seo_recovery_months", 6) or 0)
stretch_rec = int(stretch.get("seo_recovery_months", 6) or 0)
st.markdown(
    f"""
После RnD сайт переезжает на домен/контур внутри Т. Внешняя органика падает
до пола и линейно возвращается к 100% исходного $T_{{org}}$.

$$
SEO_t =
\\begin{cases}
1, & t \\le T_{{rnd}} \\text{{ (сайт ещё у подрядчика / статус-кво)}} \\\\
s, & t = T_{{rnd}}+1 \\text{{ (первый месяц своего сайта)}} \\\\
s + (1-s)\\dfrac{{t - T_{{rnd}} - 1}}{{T_{{rec}} - 1}}, & T_{{rnd}} < t < T_{{rnd}} + T_{{rec}} \\\\
1, & t \\ge T_{{rnd}} + T_{{rec}}
\\end{cases}
$$

| | **Base** | **Stretch** |
|---|---|---|
| Включено | {"да" if base_seo_on else "нет"} | {"да" if stretch_seo_on else "нет"} |
| Пол $s$ | {base_floor:.0f}% | {stretch_floor:.0f}% |
| $T_{{rec}}$ | {base_rec} мес. | {stretch_rec} мес. |
| Первый свой месяц | мес. {int(base["rnd_months"]) + 1}: {base["traffic_month"] * base_floor / 100:,.0f} визитов | мес. {int(stretch["rnd_months"]) + 1} |
| Реклама / статус-кво | не проседают | не проседают |

$T_{{rec}} = 0$ → пол навсегда. У каждого сценария свои $s$ и $T_{{rec}}$.
Лифт трафика Stretch: $T_{{org,t}} = T_{{org}} \\times (1+\\text{{лифт}}) \\times SEO_t$.
""".replace(",", " ")
)

st.markdown("### Доп. RnD в Stretch")
st.markdown(
    r"""
Каждая строка инициативы:

- в месяцах $[\text{старт};\ \text{старт}+\text{длительность})$ начисляется $\text{люди} \times \overline{\text{ЗП}}$
- начиная с месяца завершения к органическому трафику и к **конверсии/оплате обоих каналов**
  умножаются $(1 + \text{лифт}/100)$; рекламный объём $T_{ads}$ лифтом трафика не раздувается
- несколько инициатив перемножаются; $R_{extra}$ складывается

Так модель отделяет «забрать сайт как есть» (Base) от «вложить в продукт» (Stretch).
"""
)

st.markdown("### Затраты")
st.markdown(
    r"""
$$
C_t = \underbrace{\text{разработка}_t + \text{поддержка}_t + \text{ЗП}_t}_{\text{постоянные}}
+ VC_t + \text{доля подрядчика}_t + \text{реклама}_t
$$

$$
CF_t = R_t - C_t
$$

В Base $\text{ЗП}_t = 0$ и $\text{реклама}_t = 0$.
"""
)

st.markdown("### Срок окупаемости")
st.markdown(
    """
Основной KPI — **инкремент к статус-кво** «оставить сайт подрядчику»
(без разработки, без команды, без рекламы, без лифтов):

$$
Inc_t = CF^{проект}_t - CF^{подрядчик}_t
$$

**Срок окупаемости** — первый месяц, где $\\sum Inc \\ge 0$.

Таблица Base vs Stretch на вкладках расчёта показывает, сколько extra-RnD и реклама
добавляют (или съедают) относительно голого забора сайта.
"""
)

st.markdown("### Что должно быть правдой")
st.markdown(
    """
1. **Base:** доля подрядчика заметно больше будущей поддержки — иначе забирать сайт бессмысленно.
2. **Stretch RnD:** лифт оплачиваемых / конверсии после инициативы окупает фонд зарплат на горизонте.
3. **Stretch реклама:** $R_{promo}^{ads}$ за месяц ≥ бюджет, иначе канал жжёт CF (холодный трафик с более низкой CR).
4. Коэффициенты активации органики и рекламы задаются **раздельно** — смешивать в один CR нельзя:
   оценка «как быстро отобьётся органика» сразу испортится купленным трафиком.
5. **SEO:** пол после переезда и срок восстановления заданы явно. Если органика не возвращается
   к 100% за $T_{rec}$ месяцев, окупаемость vs подрядчик сдвигается вправо (ниже база промо и карт).
"""
)
