"""Поле числа с Excel-логикой: «=2*5» → Рассчитать → число, «Посмотреть формулу»."""
from __future__ import annotations

from typing import Optional

import streamlit as st

from utils.formula import (
    FormulaError,
    eval_formula,
    format_number,
    looks_like_formula,
    parse_number,
    try_parse_value,
)


def raw_key(key: str) -> str:
    return f"{key}__raw"


def formula_key(key: str) -> str:
    return f"{key}__formula"


def error_key(key: str) -> str:
    return f"{key}__formula_error"


def init_formula_field(key: str, value: float, *, decimals: int = 1, as_int: bool = False) -> None:
    if raw_key(key) not in st.session_state:
        st.session_state[raw_key(key)] = format_number(value, decimals=decimals, as_int=as_int)
    if formula_key(key) not in st.session_state:
        st.session_state[formula_key(key)] = ""
    if error_key(key) not in st.session_state:
        st.session_state[error_key(key)] = ""


def reset_formula_field(key: str, value: float, *, decimals: int = 1, as_int: bool = False) -> None:
    st.session_state[raw_key(key)] = format_number(value, decimals=decimals, as_int=as_int)
    st.session_state[formula_key(key)] = ""
    st.session_state[error_key(key)] = ""


def _clamp(value: float, min_value: Optional[float], max_value: Optional[float]) -> float:
    if min_value is not None:
        value = max(float(min_value), value)
    if max_value is not None:
        value = min(float(max_value), value)
    return value


def _on_calculate(key: str, min_value: Optional[float], max_value: Optional[float], decimals: int, as_int: bool) -> None:
    text = str(st.session_state.get(raw_key(key)) or "").strip()
    try:
        if looks_like_formula(text) or (text and any(ch in text for ch in "+-*/()") and not _is_plain_number(text)):
            formula = text if looks_like_formula(text) else f"={text}"
            value = eval_formula(formula)
            st.session_state[formula_key(key)] = formula if formula.startswith("=") else f"={formula}"
        else:
            value = parse_number(text)
        value = _clamp(value, min_value, max_value)
        if as_int:
            value = float(int(round(value)))
        st.session_state[key] = value
        st.session_state[raw_key(key)] = format_number(value, decimals=decimals, as_int=as_int)
        st.session_state[error_key(key)] = ""
    except FormulaError as exc:
        st.session_state[error_key(key)] = str(exc)


def _is_plain_number(text: str) -> bool:
    try:
        parse_number(text)
        return True
    except FormulaError:
        return False


def _on_view_formula(key: str) -> None:
    stored = str(st.session_state.get(formula_key(key)) or "").strip()
    if not stored:
        return
    if not stored.startswith("="):
        stored = f"={stored}"
    st.session_state[raw_key(key)] = stored
    st.session_state[error_key(key)] = ""


def formula_number_input(
    label: str,
    key: str,
    *,
    min_value: Optional[float] = None,
    max_value: Optional[float] = None,
    help: Optional[str] = None,
    decimals: int = 1,
    as_int: bool = False,
) -> float:
    """Текстовое окошко числа. «=...» включает формулу, «Рассчитать» даёт ответ."""
    current = st.session_state.get(key, 0.0)
    try:
        current = float(current or 0.0)
    except (TypeError, ValueError):
        current = 0.0
    init_formula_field(key, current, decimals=decimals, as_int=as_int)

    extra_help = (
        "Формула: начните с = (например =5000000/12) и нажмите «Рассчитать». "
        "Потом можно править число или открыть формулу заново."
    )
    full_help = f"{help} {extra_help}".strip() if help else extra_help

    st.text_input(label, key=raw_key(key), help=full_help)

    displayed = str(st.session_state.get(raw_key(key)) or "")
    if not looks_like_formula(displayed):
        parsed = try_parse_value(displayed)
        if parsed is not None:
            parsed = _clamp(parsed, min_value, max_value)
            if as_int:
                parsed = float(int(round(parsed)))
            st.session_state[key] = parsed

    stored_formula = str(st.session_state.get(formula_key(key)) or "").strip()
    showing_formula = looks_like_formula(displayed)
    buttons = st.columns(2)
    with buttons[0]:
        st.button(
            "Рассчитать",
            key=f"{key}__calc",
            width="stretch",
            on_click=_on_calculate,
            args=(key, min_value, max_value, decimals, as_int),
        )
    with buttons[1]:
        if stored_formula and not showing_formula:
            st.button(
                "Посмотреть формулу",
                key=f"{key}__view",
                width="stretch",
                on_click=_on_view_formula,
                args=(key,),
            )
        elif showing_formula:
            st.caption("формула активна")

    err = str(st.session_state.get(error_key(key)) or "")
    if err:
        st.error(err)
    elif showing_formula:
        st.caption("Нажмите «Рассчитать», чтобы подставить число.")

    try:
        return float(st.session_state.get(key) or 0.0)
    except (TypeError, ValueError):
        return 0.0
