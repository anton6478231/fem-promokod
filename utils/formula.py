"""Безопасный разбор арифметических формул: + − * / и скобки."""
from __future__ import annotations

import ast
import operator
from typing import Optional, Union


_BIN_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
}
_UNARY_OPS = {
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
}


class FormulaError(ValueError):
    pass


def looks_like_formula(text: str) -> bool:
    stripped = (text or "").strip()
    return stripped.startswith("=")


def format_number(value: float, *, decimals: int = 1, as_int: bool = False) -> str:
    if value is None:
        return ""
    if as_int:
        return str(int(round(float(value))))
    number = float(value)
    rendered = f"{number:.{max(0, decimals)}f}"
    if decimals > 0:
        rendered = rendered.rstrip("0").rstrip(".")
    return rendered if rendered else "0"


def parse_number(text: str) -> float:
    raw = (text or "").strip().replace("\u00a0", " ").replace(" ", "")
    if not raw:
        raise FormulaError("пустое значение")
    if raw.startswith("="):
        raise FormulaError("это формула, нажмите «Рассчитать»")
    if raw.count(",") == 1 and "." not in raw:
        raw = raw.replace(",", ".")
    try:
        return float(raw)
    except ValueError as exc:
        raise FormulaError("нужно число или формула, начиная с =") from exc


def eval_formula(text: str) -> float:
    raw = (text or "").strip().replace("\u00a0", " ")
    if raw.startswith("="):
        raw = raw[1:]
    raw = raw.replace(" ", "")
    if not raw:
        raise FormulaError("пустая формула")
    if raw.count(",") == 1 and "." not in raw:
        raw = raw.replace(",", ".")
    try:
        tree = ast.parse(raw, mode="eval")
    except SyntaxError as exc:
        raise FormulaError("не разобрал формулу. Доступны + − * / и скобки") from exc
    try:
        result = _eval_node(tree.body)
    except ZeroDivisionError as exc:
        raise FormulaError("деление на ноль") from exc
    except FormulaError:
        raise
    except Exception as exc:
        raise FormulaError("не удалось посчитать формулу") from exc
    if not isinstance(result, (int, float)) or result != result:  # NaN
        raise FormulaError("результат не число")
    if result in (float("inf"), float("-inf")):
        raise FormulaError("слишком большое число")
    return float(result)


def try_parse_value(text: str) -> Optional[float]:
    """Число без «=». None, если это формула или мусор."""
    raw = (text or "").strip()
    if not raw or looks_like_formula(raw):
        return None
    try:
        return parse_number(raw)
    except FormulaError:
        return None


def _eval_node(node: ast.AST) -> Union[int, float]:
    if isinstance(node, ast.Expression):
        return _eval_node(node.body)
    if isinstance(node, ast.Constant):
        if isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
            return node.value
        raise FormulaError("в формуле могут быть только числа")
    if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY_OPS:
        return _UNARY_OPS[type(node.op)](_eval_node(node.operand))
    if isinstance(node, ast.BinOp) and type(node.op) in _BIN_OPS:
        left = _eval_node(node.left)
        right = _eval_node(node.right)
        if isinstance(node.op, ast.Div) and right == 0:
            raise ZeroDivisionError
        return _BIN_OPS[type(node.op)](left, right)
    raise FormulaError("в формуле можно только + − * / и скобки")
