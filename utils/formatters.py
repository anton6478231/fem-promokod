"""Форматирование чисел для UI."""


def format_currency(value: float, suffix: str = " ₽") -> str:
    if value is None:
        return "—"
    return f"{value:,.0f}{suffix}".replace(",", " ")


def format_currency_compact(value: float) -> str:
    if value is None:
        return "—"
    abs_val = abs(value)
    sign = "−" if value < 0 else ""
    if abs_val >= 1_000_000_000:
        return f"{sign}{abs_val / 1_000_000_000:.1f} млрд ₽"
    if abs_val >= 1_000_000:
        return f"{sign}{abs_val / 1_000_000:.1f} млн ₽"
    if abs_val >= 1_000:
        return f"{sign}{abs_val / 1_000:.1f} тыс ₽"
    return f"{sign}{abs_val:.0f} ₽"


def format_number_compact(value: float) -> str:
    if value is None:
        return "—"
    abs_val = abs(value)
    sign = "−" if value < 0 else ""
    if abs_val >= 1_000_000:
        return f"{sign}{abs_val / 1_000_000:.1f} млн"
    if abs_val >= 1_000:
        return f"{sign}{abs_val / 1_000:.0f} тыс"
    return f"{sign}{abs_val:.0f}"


def format_pct(value: float, decimals: int = 1) -> str:
    if value is None:
        return "—"
    return f"{value * 100:.{decimals}f}%"


def format_months(month) -> str:
    if month is None:
        return "не окупается"
    return f"{int(month)} мес."
