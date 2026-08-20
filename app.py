"""
Сайт промокодов — финансово-экономическая модель (упрощённая ФЭМ).

Запуск:
    cd "финмодель-сайт-промокодов"
    streamlit run app.py
"""
import streamlit as st

from ui.form import init_session

st.set_page_config(
    page_title="ФЭМ — сайт промокодов",
    page_icon="💳",
    layout="wide",
    initial_sidebar_state="expanded",
)

init_session()

base_page = st.Page(
    "pages/base.py",
    title="Base",
    icon="🌱",
    default=True,
)
stretch_page = st.Page(
    "pages/stretch.py",
    title="Stretch",
    icon="🚀",
)
parameters_page = st.Page(
    "pages/parameters.py",
    title="Параметры",
    icon="⚙️",
)
logic_page = st.Page(
    "pages/logic.py",
    title="Логика модели",
    icon="📖",
)

pg = st.navigation(
    {
        "Сценарии": [base_page, stretch_page],
        "Справка": [parameters_page, logic_page],
    },
    position="top",
)
pg.run()
