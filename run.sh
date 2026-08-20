#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

pick_python() {
  if [[ -x "./venv/bin/python" ]]; then
    echo "./venv/bin/python"
    return
  fi
  local case_py="../Москалюк_Антон_кейс_4_решение/venv/bin/python"
  if [[ -x "$case_py" ]]; then
    echo "$case_py"
    return
  fi
  echo "python3"
}

PYTHON_BIN="${PYTHON_BIN:-$(pick_python)}"
exec "$PYTHON_BIN" -m streamlit run app.py --server.port "${PORT:-8501}" --server.headless true
