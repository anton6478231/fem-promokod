import { mount } from "https://cdn.jsdelivr.net/npm/@stlite/browser@1.8.1/build/stlite.js";

const here = import.meta.url;
const paths = [
  "app.py",
  "config/defaults.json",
  "models/__init__.py",
  "models/engine.py",
  "pages/base.py",
  "pages/logic.py",
  "pages/parameters.py",
  "pages/stretch.py",
  "ui/__init__.py",
  "ui/form.py",
  "ui/formula_input.py",
  "ui/scenario_view.py",
  "utils/__init__.py",
  "utils/formatters.py",
  "utils/formula.py",
  "visualization/__init__.py",
  "visualization/charts.py",
  "visualization/kpi_cards.py",
];

const files = Object.fromEntries(
  paths.map((path) => [path, { url: new URL(path, here).href }]),
);

mount(
  {
    requirements: ["pandas", "plotly"],
    entrypoint: "app.py",
    files,
    streamlitConfig: {
      "browser.gatherUsageStats": false,
      "client.toolbarMode": "viewer",
      "server.baseUrlPath": "fem-promokod",
    },
  },
  document.getElementById("root"),
);
