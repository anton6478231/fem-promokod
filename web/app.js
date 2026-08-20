import { applyBaseConstraints, runModel, sensitivityTable } from "./engine.js?v=20260820-logic";

const ORGANIC_COPY_KEYS = [
  "rnd_months", "traffic_month", "seo_dip_enabled", "seo_dip_floor_pct", "seo_recovery_months",
  "conversion_pct", "approved_activation_share_pct", "paid_partner_share_pct", "arpu",
  "contractor_share_pct", "contractor_share_rnd", "contractor_share_ops", "contractor_share_status_quo",
  "dev_cost_month", "dev_cost_rnd", "dev_cost_ops", "dev_cost_status_quo",
  "card_black_enabled", "black_share_pct", "black_ltv",
  "card_platinum_enabled", "platinum_share_pct", "platinum_ltv", "support_rnd", "support_ops",
  "support_status_quo", "salaries_status_quo",
];

const TABS = [
  ["base", "Base"],
  ["stretch", "Stretch"],
  ["params", "Параметры"],
  ["logic", "Логика"],
];

const KIND_OPTIONS = [
  ["fixed", "фикс ₽/мес"],
  ["per_paid_activation", "₽ за оплаченную"],
  ["per_activation", "₽ за активацию"],
  ["pct_of_revenue", "% от выручки"],
];
const KIND_UNITS = {
  fixed: "₽/мес",
  per_paid_activation: "₽ / оплаченную",
  per_activation: "₽ / активацию",
  pct_of_revenue: "% от выручки",
};

const KEEP_ZERO = new Set([
  "Выручка (валовая)", "Доля подрядчика", "Разработка сайта", "Поддержка", "Итого затраты", "CF месяца",
]);

const nf = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

let defaults = null;
let state = null;
let paramScenario = "base";

function rub(value) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${nf.format(Math.round(value))} ₽`;
}

function compact(value) {
  if (value == null || Number.isNaN(value)) return "—";
  const sign = value < 0 ? "−" : "";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${sign}${nf1.format(abs / 1e9)} млрд ₽`;
  if (abs >= 1e6) return `${sign}${nf1.format(abs / 1e6)} млн ₽`;
  if (abs >= 1e3) return `${sign}${nf1.format(abs / 1e3)} тыс ₽`;
  return `${sign}${nf.format(abs)} ₽`;
}

function numCompact(value) {
  const sign = value < 0 ? "−" : "";
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${sign}${nf1.format(abs / 1e6)} млн`;
  if (abs >= 1e3) return `${sign}${nf.format(abs / 1e3)} тыс`;
  return `${sign}${nf.format(abs)}`;
}

function moneyClass(value) {
  if (value > 0.5) return "pos";
  if (value < -0.5) return "neg";
  return "";
}

function scenarioParams(name) {
  const raw = {
    ...state[name],
    num_months: state.num_months,
    scenario: name,
  };
  return name === "base" ? applyBaseConstraints(raw) : raw;
}

function stripMeta(src) {
  const next = structuredClone(src);
  delete next._context;
  delete next._traffic_note;
  delete next._seo_note;
  delete next._funnel_note;
  delete next._arpu_note;
  delete next._cards_note;
  return next;
}

function normalizeVariableCost(row) {
  const next = { ...row, kind: row.kind || "fixed", name: row.name || "" };
  if (next.rnd != null || next.ops != null || next.status_quo != null) {
    next.rnd = Number(next.rnd || 0);
    next.ops = Number(next.ops || 0);
    next.status_quo = Number(next.status_quo || 0);
    return next;
  }
  const value = Number(next.value || 0);
  const phase = String(next.phase || "own");
  next.rnd = phase === "rnd" || phase === "both" ? value : 0;
  next.ops = phase === "own" || phase === "both" ? value : 0;
  next.status_quo = phase === "status_quo" || phase === "rnd" || phase === "both" ? value : 0;
  return next;
}

function normalizeScenario(p) {
  if (p.contractor_share_rnd == null) p.contractor_share_rnd = p.contractor_share_pct ?? 0;
  if (p.contractor_share_ops == null) p.contractor_share_ops = 0;
  if (p.contractor_share_status_quo == null) p.contractor_share_status_quo = p.contractor_share_pct ?? 0;
  if (p.dev_cost_rnd == null) p.dev_cost_rnd = p.dev_cost_month ?? 0;
  if (p.dev_cost_ops == null) p.dev_cost_ops = 0;
  if (p.dev_cost_status_quo == null) p.dev_cost_status_quo = 0;
  p.variable_costs = (p.variable_costs || []).map(normalizeVariableCost);
  return p;
}

function initState(src) {
  const base = normalizeScenario(stripMeta(src));
  const stretch = normalizeScenario(stripMeta(src));
  return {
    tab: (location.hash.replace("#", "") || "base"),
    num_months: src.num_months,
    base,
    stretch,
  };
}

function field(sc, key, label, opts = {}) {
  const value = key === "num_months" ? state.num_months : state[sc][key];
  const type = opts.check ? "checkbox" : "number";
  if (opts.check) {
    return `<label class="check"><input type="checkbox" autocomplete="off" data-sc="${sc}" data-key="${key}" ${value ? "checked" : ""}>${label}</label>`;
  }
  const step = opts.step ?? 1;
  return `<label class="field">${label}<input type="${type}" autocomplete="off" data-sc="${sc}" data-key="${key}" value="${value ?? 0}" step="${step}"></label>`;
}

function costPhaseRow(sc, title, rndKey, opsKey, sqKey, opts = {}) {
  return `<div class="cost-card">
    <h3>${title}</h3>
    <div class="row3">
      ${field(sc, rndKey, "RnD", opts)}
      ${field(sc, opsKey, "Свой сайт", opts)}
      ${field(sc, sqKey, "Статус-кво", opts)}
    </div>
  </div>`;
}

function arrField(sc, arr, i, key, label, opts = {}) {
  const value = state[sc][arr][i][key] ?? 0;
  const step = opts.step ?? 1;
  return `<label class="field">${label}<input type="number" autocomplete="off" data-sc="${sc}" data-arr="${arr}" data-i="${i}" data-k="${key}" value="${value}" step="${step}"></label>`;
}

function formBlocks(sc, { full = false } = {}) {
  const stretch = sc === "stretch";
  const ads = stretch ? `
    <div class="block">
      <h3>Реклама</h3>
      ${field(sc, "ads_enabled", "Включить рекламу", { check: true })}
      <div class="row">
        ${field(sc, "ads_start_month", "Старт, месяц")}
        ${field(sc, "ads_end_month", "Конец (0 = до горизонта)")}
      </div>
      ${field(sc, "ads_traffic_month", "Рекламный трафик, визитов/мес")}
      ${field(sc, "ads_cost_month", "Бюджет, ₽/мес")}
      ${field(sc, "conversion_pct_ads", "CR рекламы, %", { step: 0.1 })}
      ${field(sc, "approved_activation_share_pct_ads", "Одобренные, %", { step: 0.1 })}
      ${field(sc, "paid_partner_share_pct_ads", "Оплачиваемые, %", { step: 0.1 })}
    </div>` : "";

  const rnd = stretch ? `
    <div class="block">
      <h3>Доп. продуктовый RnD</h3>
      <p>Зарплаты в окне [старт; старт+длительность). После завершения — лифты воронки.</p>
      ${rndEditor(sc)}
    </div>
    <div class="block">
      <h3>Команда сопровождения</h3>
      <div class="row">
        ${field(sc, "team_headcount_rnd", "Людей в RnD")}
        ${field(sc, "team_avg_salary_rnd", "Ср. ЗП RnD, ₽")}
      </div>
      <div class="row">
        ${field(sc, "team_headcount_ops", "Людей после запуска")}
        ${field(sc, "team_avg_salary_ops", "Ср. ЗП после запуска, ₽")}
      </div>
    </div>
    <div class="block">
      <h3>Лифты своего сайта</h3>
      <div class="row">
        ${field(sc, "own_traffic_lift_pct", "Трафик, %")}
        ${field(sc, "own_conversion_lift_pct", "CR, %")}
      </div>
      <div class="row">
        ${field(sc, "own_paid_share_lift_pct", "Оплачиваемые, %")}
        ${field(sc, "own_arpu_lift_pct", "ARPU, %")}
      </div>
    </div>` : "";

  return `
    <div class="block">
      <h3>Горизонт и разработка</h3>
      ${field(sc, "num_months", "Горизонт, мес.")}
      ${field(sc, "rnd_months", "Разработка сайта, мес.")}
    </div>
    <div class="block">
      <h3>Органика</h3>
      ${field(sc, "traffic_month", "Визиты / мес")}
      ${field(sc, "conversion_pct", "Конверсия в активацию, %", { step: 0.1 })}
      ${field(sc, "approved_activation_share_pct", "Доля одобренных, %", { step: 0.1 })}
      ${field(sc, "paid_partner_share_pct", "Доля оплачиваемых, %", { step: 0.1 })}
      ${field(sc, "arpu", "ARPU, ₽")}
    </div>
    <div class="block">
      <h3>SEO-просадка</h3>
      ${field(sc, "seo_dip_enabled", "Учитывать SEO-просадку", { check: true })}
      <div class="row">
        ${field(sc, "seo_dip_floor_pct", "Пол в первый свой месяц, %")}
        ${field(sc, "seo_recovery_months", "Восстановление, мес.")}
      </div>
    </div>
    ${ads}
    <div class="block">
      <h3>Карты</h3>
      ${field(sc, "card_black_enabled", "Учитывать Black", { check: true })}
      <div class="row">
        ${field(sc, "black_share_pct", "Доля Black, %", { step: 0.01 })}
        ${field(sc, "black_ltv", "LTV Black, ₽")}
      </div>
      ${field(sc, "card_platinum_enabled", "Учитывать Platinum", { check: true })}
      <div class="row">
        ${field(sc, "platinum_share_pct", "Доля Platinum, %", { step: 0.01 })}
        ${field(sc, "platinum_ltv", "LTV Platinum, ₽")}
      </div>
    </div>
    ${rnd}
    <div class="block">
      <h3>Затраты по фазам</h3>
      <p class="hint">Как у поддержки: RnD / свой сайт / статус-кво. Статьи ниже можно менять и добавлять.</p>
      ${costPhaseRow(sc, "Доля подрядчика, %", "contractor_share_rnd", "contractor_share_ops", "contractor_share_status_quo", { step: 0.1 })}
      ${costPhaseRow(sc, "Разработка сайта, ₽/мес", "dev_cost_rnd", "dev_cost_ops", "dev_cost_status_quo")}
      ${costPhaseRow(sc, "Поддержка, ₽/мес", "support_rnd", "support_ops", "support_status_quo")}
      ${field(sc, "salaries_status_quo", "ЗП статус-кво, ₽/мес")}
    </div>
    <div class="block">
      <h3>Статьи затрат</h3>
      ${vcEditor(sc)}
    </div>
    ${stretch && !full ? "" : ""}
    ${sc === "base" ? `<p class="hint">В Base зарплаты, реклама и лифты принудительно = 0: вкладка отвечает, отобьётся ли забор на текущей органике.</p>` : ""}
  `;
}

function rndEditor(sc) {
  const rows = state[sc].extra_rnd || [];
  const body = rows.map((row, idx) => `
    <tr>
      <td><input data-sc="${sc}" data-arr="extra_rnd" data-i="${idx}" data-k="name" value="${escapeAttr(row.name || "")}"></td>
      <td><input type="number" data-sc="${sc}" data-arr="extra_rnd" data-i="${idx}" data-k="start_month" value="${row.start_month || 1}"></td>
      <td><input type="number" data-sc="${sc}" data-arr="extra_rnd" data-i="${idx}" data-k="duration_months" value="${row.duration_months || 0}"></td>
      <td><input type="number" data-sc="${sc}" data-arr="extra_rnd" data-i="${idx}" data-k="headcount" value="${row.headcount || 0}"></td>
      <td><input type="number" data-sc="${sc}" data-arr="extra_rnd" data-i="${idx}" data-k="avg_salary" value="${row.avg_salary || 0}"></td>
      <td><input type="number" data-sc="${sc}" data-arr="extra_rnd" data-i="${idx}" data-k="paid_lift_pct" value="${row.paid_lift_pct || 0}"></td>
      <td><input type="number" data-sc="${sc}" data-arr="extra_rnd" data-i="${idx}" data-k="traffic_lift_pct" value="${row.traffic_lift_pct || 0}"></td>
      <td><input type="number" data-sc="${sc}" data-arr="extra_rnd" data-i="${idx}" data-k="conversion_lift_pct" value="${row.conversion_lift_pct || 0}"></td>
      <td><button class="icon-btn" data-del="extra_rnd" data-sc="${sc}" data-i="${idx}">×</button></td>
    </tr>
  `).join("");
  return `
    <div class="editor table-wrap">
      <table>
        <thead><tr><th>Инициатива</th><th>Старт</th><th>Мес.</th><th>Людей</th><th>ЗП</th><th>Лифт paid %</th><th>Лифт трафика %</th><th>Лифт CR %</th><th></th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <button class="ghost" data-add="extra_rnd" data-sc="${sc}" type="button">+ инициатива</button>
  `;
}

function vcEditor(sc) {
  const rows = state[sc].variable_costs || [];
  const blocks = rows.map((row, idx) => {
    const unit = KIND_UNITS[row.kind] || "₽/мес";
    return `
    <div class="cost-card">
      <div class="cost-card-head">
        <input class="cost-title" data-sc="${sc}" data-arr="variable_costs" data-i="${idx}" data-k="name" value="${escapeAttr(row.name || "")}" placeholder="Название статьи">
        <select data-sc="${sc}" data-arr="variable_costs" data-i="${idx}" data-k="kind">
          ${KIND_OPTIONS.map(([v, l]) => `<option value="${v}" ${row.kind === v ? "selected" : ""}>${l}</option>`).join("")}
        </select>
        <button class="icon-btn" data-del="variable_costs" data-sc="${sc}" data-i="${idx}" type="button">×</button>
      </div>
      <p class="caption">Значение, ${unit}</p>
      <div class="row3">
        ${arrField(sc, "variable_costs", idx, "rnd", "RnD", { step: row.kind === "pct_of_revenue" ? 0.1 : 1 })}
        ${arrField(sc, "variable_costs", idx, "ops", "Свой сайт", { step: row.kind === "pct_of_revenue" ? 0.1 : 1 })}
        ${arrField(sc, "variable_costs", idx, "status_quo", "Статус-кво", { step: row.kind === "pct_of_revenue" ? 0.1 : 1 })}
      </div>
    </div>`;
  }).join("");
  return `
    ${blocks || `<p class="caption">Статей пока нет — добавьте хостинг, SEO или свою строку.</p>`}
    <button class="ghost" data-add="variable_costs" data-sc="${sc}" type="button">+ статья затрат</button>
  `;
}

function escapeAttr(s) {
  return String(s).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function kpiCard(label, value, delta, ok) {
  const deltaHtml = delta
    ? `<div class="delta ${ok === false ? "bad" : "ok"}">${delta}</div>`
    : "";
  return `<div class="kpi"><div class="lbl">${label}</div><div class="val">${value}</div>${deltaHtml}</div>`;
}

function monthCostLines(row, extraNames = []) {
  if (!row) return [];
  const lines = [
    ["Выручка (валовая)", row.gross_revenue || 0],
    ["  промо органика", row.organic_promo_revenue || 0],
    ["  промо реклама", row.ads_promo_revenue || 0],
    ["  карты", row.card_revenue || 0],
    ["  доп. выручка RnD", row.extra_product_revenue || 0],
    ["Доля подрядчика", -(row.contractor_cost || 0)],
    ["Разработка сайта", -(row.dev_cost || 0)],
    ["Поддержка", -(row.support || 0)],
    ["ЗП сопровождения", -(row.ops_salaries || 0)],
    ["ЗП доп. RnD", -(row.extra_rnd_salaries || 0)],
    ["Реклама", -(row.ads_cost || 0)],
  ];
  const breakdown = { ...(row.variable_breakdown || {}) };
  for (const name of extraNames) if (name && !(name in breakdown)) breakdown[name] = 0;
  for (const [name, amount] of Object.entries(breakdown)) lines.push([name, -Number(amount)]);
  lines.push(["Итого затраты", -(row.total_costs || 0)]);
  lines.push(["CF месяца", row.cash_flow || 0]);
  return lines;
}

function renderTypical(kpis, scenario) {
  const own = kpis.typical_own;
  const launch = kpis.typical_own_launch;
  const rnd = kpis.typical_rnd;
  const sq = kpis.typical_sq;
  const showLaunch = launch && own && launch.month !== own.month && Math.abs((launch.seo_factor || 1) - (own.seo_factor || 1)) > 0.001;
  const blocks = showLaunch
    ? [
        [sq, "Статус-кво"],
        [rnd, "Разработка"],
        [launch, "Первый свой месяц"],
        [own, "Свой сайт после SEO"],
      ]
    : [
        [sq, "Статус-кво"],
        [rnd, "Разработка"],
        [own, "Свой сайт"],
      ];
  return `<div class="panel card-pad"><h2>Типовой месяц</h2>
    <div class="phase-grid">${blocks.map(([row, title]) => {
      if (!row) return `<div class="phase"><h4>${title}</h4><p class="caption">Нет месяцев этой фазы.</p></div>`;
      const seo = (row.seo_factor || 1) * 100;
      const extra = Object.entries(row.variable_breakdown || {})
        .filter(([, v]) => Math.abs(v) >= 0.5)
        .map(([n, v]) => `<li>${n}: ${rub(v)}</li>`).join("");
      const stretchBits = scenario === "stretch"
        ? `<li>промо реклама: ${rub(row.ads_promo_revenue || 0)}</li>
           <li>ЗП сопровождения: ${rub(row.ops_salaries || 0)}</li>
           <li>ЗП доп. RnD: ${rub(row.extra_rnd_salaries || 0)}</li>
           <li>реклама: ${rub(row.ads_cost || 0)}</li>`
        : "";
      return `<div class="phase"><h4>${title}</h4><ul>
        <li>Органика: ${nf.format(Math.round(row.organic_traffic || 0))} (SEO ${seo.toFixed(0)}%)</li>
        <li>Валовая выручка: ${rub(row.gross_revenue)}</li>
        <li>промо органика: ${rub(row.organic_promo_revenue || 0)}</li>
        ${stretchBits}
        <li>карты: ${rub(row.card_revenue || 0)}</li>
        <li>доля подрядчика: ${rub(row.contractor_cost)}</li>
        <li>разработка: ${rub(row.dev_cost || 0)}</li>
        <li>поддержка: ${rub(row.support)}</li>
        ${extra}
        <li><b>CF месяца: ${rub(row.cash_flow)}</b></li>
      </ul></div>`;
    }).join("")}</div></div>`;
}

function renderOpex(kpis, params) {
  const names = (params.variable_costs || []).map((x) => String(x.name || "").trim()).filter(Boolean);
  const keep = new Set([...KEEP_ZERO, ...names]);
  const sources = [kpis.typical_sq, kpis.typical_rnd, kpis.typical_own];
  const labels = [];
  for (const src of sources) {
    for (const [name] of monthCostLines(src, names)) {
      if (!labels.includes(name)) labels.push(name);
    }
  }
  const maps = sources.map((src) => Object.fromEntries(monthCostLines(src, names)));
  const rows = labels.filter((name) => {
    const vals = maps.map((m) => m[name] || 0);
    return keep.has(name) || vals.some((v) => Math.abs(v) >= 0.5);
  });
  return `<div class="panel card-pad"><h2>Из чего складывается месяц</h2>
    <p class="caption">Отрицательные = затраты. «Свой сайт» — первый месяц с SEO = 100%.</p>
    <div class="table-wrap"><table><thead><tr><th>Статья</th><th>Статус-кво</th><th>RnD</th><th>Свой сайт</th></tr></thead>
    <tbody>${rows.map((name) => `<tr><td>${name}</td>${maps.map((m) => {
      const v = m[name] || 0;
      return `<td class="${moneyClass(v)}">${rub(v)}</td>`;
    }).join("")}</tr>`).join("")}</tbody></table></div></div>`;
}

function renderComparison(current) {
  const base = runModel(scenarioParams("base")).kpis;
  const stretch = runModel(scenarioParams("stretch")).kpis;
  const pay = (m) => (m ? `${m} мес.` : "нет");
  const rows = [
    ["Окупаемость vs подрядчик", pay(base.payback_incremental_month), pay(stretch.payback_incremental_month)],
    [`Инкремент за ${base.num_months} мес.`, rub(base.final_cumulative_incremental), rub(stretch.final_cumulative_incremental)],
    ["CF проекта", rub(base.total_cf), rub(stretch.total_cf)],
    ["Выручка", rub(base.total_gross), rub(stretch.total_gross)],
    ["Затраты", rub(base.total_costs), rub(stretch.total_costs)],
    ["ЗП доп. RnD", "—", rub(stretch.total_extra_rnd_salaries || 0)],
    ["Реклама", "—", rub(stretch.total_ads_cost || 0)],
  ];
  return `<div class="panel card-pad"><h2>Base vs Stretch</h2>
    <p class="caption">Сейчас открыт <b>${current}</b>.</p>
    <div class="table-wrap"><table><thead><tr><th>Метрика</th><th>Base</th><th>Stretch</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join("")}</tbody></table></div></div>`;
}

function monthLabels(project) {
  return project.map((r) => `М${r.month} ${r.phase === "rnd" ? "RnD" : "свой"}`);
}

function svgChart({ title, labels, series, stacked = false, yFormat = rub, yKind = "money" }) {
  const w = 900;
  const h = 340;
  const pad = { l: 78, r: 18, t: 36, b: 46 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const n = labels.length || 1;
  const totals = labels.map((_, i) => series.reduce((s, ser) => s + (stacked ? ser.values[i] : 0), 0));
  const all = stacked ? totals : series.flatMap((s) => s.values);
  let min = Math.min(0, ...all);
  let max = Math.max(0, ...all);
  if (min === max) max = min + 1;
  const y = (v) => pad.t + ih - ((v - min) / (max - min)) * ih;
  const x = (i) => (stacked
    ? pad.l + ((i + 0.5) / n) * iw
    : pad.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw));
  const zero = y(0);
  const rndCount = labels.filter((l) => l.includes("RnD")).length;
  const band = rndCount
    ? `<rect x="${pad.l}" y="${pad.t}" width="${(rndCount / n) * iw}" height="${ih}" fill="rgba(156,163,175,.16)"></rect>`
    : "";
  let body = "";
  if (stacked) {
    const bw = Math.max(4, (iw / n) * 0.72);
    for (let i = 0; i < n; i += 1) {
      let acc = 0;
      for (const ser of series) {
        const v = ser.values[i] || 0;
        const y1 = y(acc + v);
        const y0 = y(acc);
        body += `<rect x="${x(i) - bw / 2}" y="${Math.min(y0, y1)}" width="${bw}" height="${Math.max(1, Math.abs(y0 - y1))}" fill="${ser.color}"></rect>`;
        acc += v;
      }
    }
  } else {
    for (const ser of series) {
      const d = ser.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
      body += `<path d="${d}" fill="none" stroke="${ser.color}" stroke-width="${ser.width || 2}" stroke-dasharray="${ser.dash || ""}"></path>`;
      body += ser.values.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${ser.color}"></circle>`).join("");
    }
  }
  const ticks = 4;
  const grid = Array.from({ length: ticks + 1 }, (_, i) => {
    const v = min + ((max - min) * i) / ticks;
    const yy = y(v);
    return `<line x1="${pad.l}" x2="${w - pad.r}" y1="${yy}" y2="${yy}" stroke="#e5e7eb"></line>
      <text x="${pad.l - 8}" y="${yy + 4}" text-anchor="end" font-size="11" fill="#6b7280">${yFormat(v)}</text>`;
  }).join("");
  const xticks = labels.map((l, i) => {
    if (n > 18 && i % 2) return "";
    return `<text x="${x(i)}" y="${h - 14}" text-anchor="middle" font-size="10" fill="#6b7280">${l}</text>`;
  }).join("");
  const legend = series.map((s, i) => `<g transform="translate(${pad.l + i * 160}, 16)">
    <rect width="10" height="10" fill="${s.color}"></rect>
    <text x="14" y="10" font-size="11" fill="#374151">${s.name}</text></g>`).join("");
  const hover = `<g class="chart-hover" opacity="0" pointer-events="none">
      <rect class="chart-hover-band" x="0" y="${pad.t}" width="0" height="${ih}" fill="rgba(17,24,39,.06)"></rect>
      <line class="chart-hover-line" y1="${pad.t}" y2="${pad.t + ih}" stroke="#111827" stroke-width="1.25" stroke-dasharray="3 3"></line>
      ${series.map((s, si) => `<circle class="chart-hover-dot" data-si="${si}" r="5" fill="${s.color}" stroke="#fff" stroke-width="2"></circle>`).join("")}
    </g>
    <rect class="chart-hit" x="${pad.l}" y="${pad.t}" width="${iw}" height="${ih}" fill="transparent"></rect>`;
  const payload = {
    labels, stacked, yKind, w, h, min, max, n, pad,
    series: series.map((s) => ({ name: s.name, color: s.color, values: s.values })),
  };
  return `<div class="panel card-pad"><h2>${title}</h2><div class="chart" data-chart="${escapeAttr(JSON.stringify(payload))}">
    <svg viewBox="0 0 ${w} ${h}" role="img">
      ${band}${grid}<line x1="${pad.l}" x2="${w - pad.r}" y1="${zero}" y2="${zero}" stroke="#9ca3af" stroke-dasharray="3 3"></line>
      ${body}${xticks}${legend}${hover}
    </svg>
    <div class="chart-tooltip" hidden></div>
  </div></div>`;
}

function renderCashFlowChart(project) {
  const labels = monthLabels(project);
  return svgChart({
    title: "Выручка, затраты и денежный поток",
    labels,
    yFormat: compact,
    yKind: "money",
    series: [
      { name: "Выручка", color: "#10B981", width: 3, values: project.map((r) => r.gross_revenue) },
      { name: "Затраты", color: "#EF4444", width: 3, values: project.map((r) => r.total_costs) },
      { name: "CF месяца", color: "#3B82F6", values: project.map((r) => r.cash_flow) },
      { name: "Накопленный CF", color: "#8B5CF6", dash: "6 4", values: project.map((r) => r.cumulative_cf) },
    ],
  });
}

function renderOtherCharts(project, scenario, payback) {
  const labels = monthLabels(project);
  const money = (v) => compact(v);
  const visits = (v) => nf.format(Math.round(v));
  const seo = svgChart({
    title: "Органический трафик: SEO-просадка после переезда",
    labels,
    yFormat: visits,
    yKind: "count",
    series: [
      { name: "Статус-кво", color: "#9CA3AF", dash: "4 4", values: project.map((r) => r.sq_organic_traffic) },
      { name: "Проект", color: "#059669", width: 3, values: project.map((r) => r.organic_traffic) },
    ],
  });
  const inc = svgChart({
    title: `Проект vs подрядчик${payback ? ` · окупаемость М${payback}` : ""}`,
    labels,
    yFormat: money,
    yKind: "money",
    series: [
      { name: "CF проекта", color: "#3B82F6", width: 3, values: project.map((r) => r.cash_flow) },
      { name: "CF статус-кво", color: "#9CA3AF", dash: "4 4", values: project.map((r) => r.sq_cash_flow) },
      { name: "Накопленный инкремент", color: "#F59E0B", dash: "6 4", values: project.map((r) => r.cumulative_incremental) },
    ],
  });
  const costs = svgChart({
    title: "Структура затрат",
    labels,
    stacked: true,
    yFormat: money,
    yKind: "money",
    series: [
      { name: "ЗП сопровождения", color: "#EF4444", values: project.map((r) => r.ops_salaries || 0) },
      { name: "ЗП доп. RnD", color: "#BE123C", values: project.map((r) => r.extra_rnd_salaries || 0) },
      { name: "Разработка", color: "#7C3AED", values: project.map((r) => r.dev_cost || 0) },
      { name: "Поддержка", color: "#F97316", values: project.map((r) => r.support || 0) },
      { name: "Переменные", color: "#F59E0B", values: project.map((r) => r.variable_costs || 0) },
      { name: "Реклама", color: "#2563EB", values: project.map((r) => r.ads_cost || 0) },
      { name: "Подрядчик", color: "#6B7280", values: project.map((r) => r.contractor_cost || 0) },
    ],
  });
  const channel = scenario === "stretch"
    ? svgChart({
        title: "Выручка по каналам",
        labels,
        stacked: true,
        yFormat: money,
        yKind: "money",
        series: [
          { name: "Промо органика", color: "#059669", values: project.map((r) => r.organic_promo_revenue || 0) },
          { name: "Промо реклама", color: "#2563EB", values: project.map((r) => r.ads_promo_revenue || 0) },
          { name: "Карты", color: "#D97706", values: project.map((r) => r.card_revenue || 0) },
          { name: "Доп. RnD", color: "#7C3AED", values: project.map((r) => r.extra_product_revenue || 0) },
        ],
      })
    : "";
  return seo + inc + channel + costs;
}

function renderSensitivity(params) {
  const sens = sensitivityTable(params);
  const rows = Object.values(sens).map((items) => {
    const by = Object.fromEntries(items.map((r) => [r.delta, r]));
    const pay = by[0].payback ? `${by[0].payback} мес.` : "нет";
    return `<tr><td>${items[0].label}</td><td>${rub(by[-0.2].total_incremental)}</td><td>${rub(by[0].total_incremental)}</td><td>${rub(by[0.2].total_incremental)}</td><td>${pay}</td></tr>`;
  }).join("");
  return `<div class="panel card-pad"><h2>Чувствительность инкремента (±20%)</h2>
    <div class="table-wrap"><table><thead><tr><th>Параметр</th><th>−20%</th><th>База</th><th>+20%</th><th>Окупаемость</th></tr></thead>
    <tbody>${rows}</tbody></table></div></div>`;
}

function renderMonthTable(project, scenario) {
  const extraHead = scenario === "stretch"
    ? "<th>Реклама визиты</th><th>Промо реклама</th><th>ЗП RnD</th>"
    : "";
  const rows = project.map((r) => {
    const extra = scenario === "stretch"
      ? `<td>${nf.format(Math.round(r.ads_traffic || 0))}</td><td>${rub(r.ads_promo_revenue || 0)}</td><td>${rub(r.extra_rnd_salaries || 0)}</td>`
      : "";
    return `<tr>
      <td>${r.month}</td><td>${r.phase === "rnd" ? "разработка" : "свой сайт"}</td>
      <td>${nf.format(Math.round(r.organic_traffic))}</td>
      <td>${Math.round((r.seo_factor || 1) * 100)}</td>
      <td>${rub(r.organic_promo_revenue)}</td>
      ${extra}
      <td>${rub(r.card_revenue)}</td>
      <td>${rub(r.gross_revenue)}</td>
      <td>${rub(r.total_costs)}</td>
      <td class="${moneyClass(r.cash_flow)}">${rub(r.cash_flow)}</td>
      <td class="${moneyClass(r.cumulative_incremental)}">${rub(r.cumulative_incremental)}</td>
    </tr>`;
  }).join("");
  return `<div class="panel card-pad"><h2>Помесячная таблица</h2>
    <div class="table-wrap"><table><thead><tr>
      <th>Месяц</th><th>Фаза</th><th>Органика</th><th>SEO %</th><th>Промо органика</th>${extraHead}
      <th>Карты</th><th>Выручка</th><th>Затраты</th><th>CF</th><th>Накопл. инкремент</th>
    </tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function renderResults(scenario) {
  const params = scenarioParams(scenario);
  const { project, kpis } = runModel(params);
  const payback = kpis.payback_incremental_month;
  const inc = kpis.final_cumulative_incremental;
  const stretchKpis = scenario === "stretch"
    ? `<div class="kpis four">
        ${kpiCard(`Промо органика за ${kpis.num_months} мес.`, compact(kpis.total_organic_promo))}
        ${kpiCard(`Промо с рекламы за ${kpis.num_months} мес.`, compact(kpis.total_ads_promo))}
        ${kpiCard(`Бюджет рекламы за ${kpis.num_months} мес.`, compact(kpis.total_ads_cost))}
        ${kpiCard(`ЗП доп. RnD за ${kpis.num_months} мес.`, compact(kpis.total_extra_rnd_salaries))}
      </div>`
    : "";
  const title = scenario === "base"
    ? "Base — органика без рекламы и зарплат"
    : "Stretch — доп. RnD + реклама";
  const caption = scenario === "base"
    ? "Забираем сайт: N месяцев разработки, дальше только поддержка. Ответ на вопрос: отобьётся ли инвестиция на текущем потоке."
    : "Тот же забор сайта, плюс ручной продуктовый RnD и рекламный канал с отдельной воронкой.";
  const copyBtn = scenario === "stretch"
    ? `<p><button class="ghost" data-copy-organic type="button">Скопировать органику и поддержку из Base</button></p>`
    : "";
  const seoNote = params.seo_dip_enabled
    ? ` После переезда органика × SEO-фактор (пол ${params.seo_dip_floor_pct}% , ${params.seo_recovery_months} мес. до 100%).`
    : "";
  return `
    <div class="panel card-pad">
      <h2 style="text-transform:none;letter-spacing:0;font-size:22px;color:#111">${title}</h2>
      <p class="caption">${caption}</p>
      ${copyBtn}
      <div class="banner">Органика в базе: ${nf.format(params.traffic_month)} × ${params.conversion_pct}% × ${params.approved_activation_share_pct}% × ${params.paid_partner_share_pct}% × ${nf.format(params.arpu)} ₽ = <b>${rub(kpis.promo_revenue_base)} / мес.</b> Итого статус-кво <b>${rub(kpis.gross_month_base)} / мес.</b>${seoNote}</div>
    </div>
    <div class="kpis">
      ${kpiCard("Срок окупаемости (vs подрядчик)", payback ? `${payback} мес.` : "не окупается", payback ? "достигнут" : `за ${kpis.num_months} мес.`, Boolean(payback))}
      ${kpiCard(`Инкремент за ${kpis.num_months} мес.`, compact(inc), inc >= 0 ? "лучше подрядчика" : "хуже подрядчика", inc >= 0)}
      ${kpiCard("Инвестиции на разработке", compact(kpis.rnd_investment))}
    </div>
    <div class="kpis four">
      ${kpiCard(`Выручка за ${kpis.num_months} мес.`, compact(kpis.total_gross))}
      ${kpiCard(`Затраты за ${kpis.num_months} мес.`, compact(kpis.total_costs))}
      ${kpiCard(`CF проекта за ${kpis.num_months} мес.`, compact(kpis.total_cf), kpis.total_cf >= 0 ? "прибыль" : "убыток", kpis.total_cf >= 0)}
      ${kpiCard("Оплачиваемых активаций / мес", numCompact(kpis.paid_activations_base))}
    </div>
    ${stretchKpis}
    ${renderCashFlowChart(project)}
    ${renderTypical(kpis, scenario)}
    ${renderOpex(kpis, params)}
    ${renderComparison(scenario)}
    ${renderOtherCharts(project, scenario, payback)}
    ${renderSensitivity(params)}
    ${renderMonthTable(project, scenario)}
  `;
}

function phaseName(phase) {
  if (phase === "rnd") return "RnD";
  if (phase === "own") return "свой сайт";
  return "статус-кво";
}

function ratePct(x) {
  return `${nf1.format((Number(x) || 0) * 100)}%`;
}

function logicKind(kind) {
  const hit = KIND_OPTIONS.find(([v]) => v === kind);
  return hit ? hit[1] : (kind || "fixed");
}

function vcAmountFormula(kind) {
  if (kind === "per_paid_activation") return "ставка × (оплаченные органика + оплаченные реклама)";
  if (kind === "per_activation") return "ставка × (активации органика + активации реклама)";
  if (kind === "pct_of_revenue") return "валовая выручка × ставка / 100";
  return "ставка, ₽/мес";
}

function walkMonth(title, row) {
  if (!row) return `<h3>${title}</h3><p>Нет такого месяца в горизонте.</p>`;
  const vc = Object.entries(row.variable_breakdown || {})
    .map(([n, v]) => `  ${n} = ${rub(v)}`)
    .join("\n");
  return `<h3>${title}</h3>
    <p>Месяц ${row.month}, фаза «${phaseName(row.phase)}», SEO-фактор ${ratePct(row.seo_factor)}.</p>
    <pre class="formula">T_org = ${nf.format(row.organic_traffic)}
CR_org = ${ratePct(row.conversion)}
S_approved_org = ${ratePct(row.approved_share)}
S_paid_org = ${ratePct(row.paid_share)}
ARPU = ${rub(row.arpu)}
активации_org = T_org × CR_org = ${nf.format(row.organic_activations)}
оплаченные_org = активации_org × S_approved_org × S_paid_org = ${nf.format(row.organic_paid_activations)}
R_promo_org = оплаченные_org × ARPU = ${rub(row.organic_promo_revenue)}

T_ads = ${nf.format(row.ads_traffic || 0)}
R_promo_ads = ${rub(row.ads_promo_revenue || 0)}
R_promo = R_promo_org + R_promo_ads = ${rub(row.promo_revenue)}

R_cards = ${rub(row.card_revenue || 0)}
R_extra = ${rub(row.extra_product_revenue || 0)}
R = R_promo + R_cards + R_extra = ${rub(row.gross_revenue)}

подрядчик = R_promo × доля_подрядчика = ${rub(row.contractor_cost)}
разработка = ${rub(row.dev_cost || 0)}
поддержка = ${rub(row.support)}
ЗП сопровождения = ${rub(row.ops_salaries || 0)}
ЗП доп. RnD = ${rub(row.extra_rnd_salaries || 0)}
реклама = ${rub(row.ads_cost || 0)}
переменные = ${rub(row.variable_costs || 0)}${vc ? `\n${vc}` : ""}

затраты = ЗП + поддержка + разработка + переменные + подрядчик + реклама
        = ${rub(row.total_costs)}
CF = R − затраты = ${rub(row.cash_flow)}</pre>`;
}

function renderLogic() {
  const base = scenarioParams("base");
  const stretch = scenarioParams("stretch");
  const baseRun = runModel(base);
  const stretchRun = runModel(stretch);
  const b = baseRun.kpis;
  const s = stretchRun.kpis;
  const recovery = Math.max(0, Math.trunc(base.seo_recovery_months || 0));
  const seoOwn = baseRun.project.filter((r) => r.phase === "own").slice(0, recovery + 2);
  const vcItems = (base.variable_costs || []).filter((x) => String(x.name || "").trim());
  const rndItems = (stretch.extra_rnd || []).filter((x) => String(x.name || "").trim());
  const adsEnd = Number(stretch.ads_end_month || 0);
  const adsWindow = adsEnd > 0
    ? `месяцы ${Math.max(1, Math.trunc(stretch.ads_start_month || 1))}…${adsEnd}`
    : `с месяца ${Math.max(1, Math.trunc(stretch.ads_start_month || 1))} до конца горизонта`;
  const vcTable = vcItems.length
    ? `<div class="table-wrap logic-table"><table><thead><tr><th>Статья</th><th>Тип</th><th>RnD</th><th>Свой сайт</th><th>Статус-кво</th><th>Как считается</th></tr></thead><tbody>
      ${vcItems.map((x) => `<tr>
        <td>${escapeAttr(x.name)}</td>
        <td>${logicKind(x.kind)}</td>
        <td>${nf.format(x.rnd || 0)}</td>
        <td>${nf.format(x.ops || 0)}</td>
        <td>${nf.format(x.status_quo || 0)}</td>
        <td>${vcAmountFormula(x.kind)}</td>
      </tr>`).join("")}
    </tbody></table></div>`
    : "<p>Статей затрат нет.</p>";
  const rndTable = rndItems.length
    ? `<div class="table-wrap logic-table"><table><thead><tr><th>Инициатива</th><th>Окно ЗП</th><th>ЗП / мес</th><th>Лифты после окна</th></tr></thead><tbody>
      ${rndItems.map((x) => {
        const start = Math.max(1, Math.trunc(x.start_month || 1));
        const dur = Math.max(0, Math.trunc(x.duration_months || 0));
        const pay = dur > 0 ? `t ∈ [${start}; ${start + dur})` : "выкл (duration = 0)";
        const salary = (Math.max(0, Number(x.headcount) || 0) * Math.max(0, Number(x.avg_salary) || 0));
        const lifts = [
          Number(x.traffic_lift_pct) ? `трафик +${nf1.format(x.traffic_lift_pct)}%` : "",
          Number(x.conversion_lift_pct) ? `CR +${nf1.format(x.conversion_lift_pct)}%` : "",
          Number(x.approved_lift_pct) ? `одобренные +${nf1.format(x.approved_lift_pct)}%` : "",
          Number(x.paid_lift_pct) ? `оплачиваемые +${nf1.format(x.paid_lift_pct)}%` : "",
          Number(x.arpu_lift_pct) ? `ARPU +${nf1.format(x.arpu_lift_pct)}%` : "",
          Number(x.extra_revenue_month) ? `R_extra +${rub(x.extra_revenue_month)}/мес` : "",
        ].filter(Boolean).join(", ") || "нет";
        return `<tr><td>${escapeAttr(x.name)}</td><td>${pay}</td><td>${rub(salary)}</td><td>${lifts}. Включаются с t ≥ ${start + dur}</td></tr>`;
      }).join("")}
    </tbody></table></div>`
    : "<p>В Stretch нет инициатив extra_rnd.</p>";

  return `<div class="panel card-pad logic">
    <h2>Логика модели</h2>
    <p>Ниже — порядок расчёта, как в движке. Два независимых прогона параметров: Base и Stretch. Каждый месяц считается дважды: проект и статус-кво.</p>

    <h3>1. Горизонт</h3>
    <pre class="formula">N = max(1, trunc(num_months))           сейчас ${b.num_months}
RnD_мес = min(max(0, trunc(rnd_months)), N)  сейчас Base ${b.rnd_months}, Stretch ${s.rnd_months}
t = 1 … N</pre>

    <h3>2. Фаза месяца t</h3>
    <pre class="formula">если это ряд статус-кво:           phase = status_quo
иначе если t ≤ RnD_мес:            phase = rnd
иначе:                             phase = own</pre>
    <p>Статус-кво каждый месяц считается как будто сайт так и остался у подрядчика: без разработки, без SEO-просадки, без рекламы, без доп. RnD, без лифтов.</p>

    <h3>3. Что обнуляет вкладка Base</h3>
    <pre class="formula">scenario = base
extra_rnd = []
team_schedule = []
ads_enabled = false
ads_traffic_month = 0
ads_cost_month = 0
team_headcount_rnd = 0
team_headcount_ops = 0
salaries_rnd = 0
salaries_ops = 0
own_*_lift_pct = 0</pre>
    <p>Поэтому в Base нет рекламы, зарплат команды, доп. RnD и лифтов. Stretch эти поля не трогает.</p>

    <h3>4. SEO-фактор органики</h3>
    <pre class="formula">если phase ∈ {status_quo, rnd} или seo_dip_enabled = нет:
    SEO = 1

floor = min(max(seo_dip_floor_pct / 100, 0), 1)     сейчас ${ratePct((base.seo_dip_floor_pct || 0) / 100)}
recovery = max(0, trunc(seo_recovery_months))     сейчас ${recovery}
elapsed = t − RnD_мес                             номер месяца на своём сайте

elapsed ≤ 0            → SEO = 1
recovery ≤ 0           → SEO = floor
elapsed > recovery     → SEO = 1
recovery = 1           → SEO = floor
иначе:
    progress = (elapsed − 1) / (recovery − 1)
    SEO = floor + (1 − floor) × progress</pre>
    <p>Реклама и статус-кво SEO не умножают. Первый свой месяц (elapsed = 1) всегда даёт SEO = floor. К 100% линейно приходит на месяце elapsed = recovery.</p>
    ${seoOwn.length ? `<div class="table-wrap logic-table"><table><thead><tr><th>Месяц проекта</th><th>elapsed</th><th>SEO</th><th>T_org</th></tr></thead><tbody>
      ${seoOwn.map((r) => `<tr><td>M${r.month}</td><td>${r.month - b.rnd_months}</td><td>${ratePct(r.seo_factor)}</td><td>${nf.format(r.organic_traffic)}</td></tr>`).join("")}
    </tbody></table></div>` : ""}

    <h3>5. Лифты продукта L (только Stretch и только phase = own)</h3>
    <pre class="formula">старт: L_traffic = L_cr = L_approved = L_paid = L_arpu = 1, R_extra = 0

если не Stretch или phase ∈ {status_quo, rnd}: лифты не применяются (все L = 1, R_extra = 0)

иначе:
  L_x *= 1 + own_x_lift_pct / 100
    сейчас Stretch: трафик ${nf1.format(stretch.own_traffic_lift_pct || 0)}%,
    CR ${nf1.format(stretch.own_conversion_lift_pct || 0)}%,
    одобренные ${nf1.format(stretch.own_approved_share_lift_pct || 0)}%,
    оплачиваемые ${nf1.format(stretch.own_paid_share_lift_pct || 0)}%,
    ARPU ${nf1.format(stretch.own_arpu_lift_pct || 0)}%

  для каждой инициативы extra_rnd:
    start = max(1, trunc(start_month))
    duration = max(0, trunc(duration_months))
    doneAt = start + duration
    если t ≥ doneAt:
      L_x *= 1 + lift_pct инициативы / 100
      R_extra += max(0, extra_revenue_month)

  затем L_x = max(L_x, 0)</pre>
    <p>Лифты инициативы включаются <b>после</b> окна зарплаты, не во время него. Несколько инициатив перемножаются.</p>
    ${rndTable}

    <h3>6. Органическая воронка</h3>
    <pre class="formula">T_org = max(0, traffic_month × L_traffic × SEO)
CR_org = min(max(conversion_pct / 100 × L_cr, 0), 1)
S_approved_org = min(max(approved_activation_share_pct / 100 × L_approved, 0), 1)
S_paid_org = min(max(paid_partner_share_pct / 100 × L_paid, 0), 1)
ARPU = max(0, arpu × L_arpu)

активации_org = T_org × CR_org
одобренные_org = активации_org × S_approved_org
оплаченные_org = одобренные_org × S_paid_org
R_promo_org = оплаченные_org × ARPU</pre>
    <p>Сейчас в панели Base: T_org база = ${nf.format(base.traffic_month)}, CR = ${nf1.format(base.conversion_pct)}%, одобренные = ${nf1.format(base.approved_activation_share_pct)}%, оплачиваемые = ${nf1.format(base.paid_partner_share_pct)}%, ARPU = ${rub(base.arpu)}.</p>
    <p>Без лифтов и при SEO = 1: ${nf.format(base.traffic_month)} × ${nf1.format(base.conversion_pct)}% × ${nf1.format(base.approved_activation_share_pct)}% × ${nf1.format(base.paid_partner_share_pct)}% × ${nf.format(base.arpu)} = <b>${rub(b.promo_revenue_base)}</b> промо / мес.</p>

    <h3>7. Реклама (только Stretch, не статус-кво)</h3>
    <pre class="formula">реклама включена, если:
  Stretch
  и ads_enabled
  и t ≥ max(1, trunc(ads_start_month))
  и (ads_end_month = 0 или t ≤ ads_end_month)

иначе T_ads = 0, R_promo_ads = 0, ads_cost = 0

если включена:
  T_ads = max(0, ads_traffic_month)          без SEO и без L_traffic
  CR_ads = min(max(conversion_pct_ads / 100 × L_cr, 0), 1)
  S_approved_ads = min(max(approved_activation_share_pct_ads / 100 × L_approved, 0), 1)
  S_paid_ads = min(max(paid_partner_share_pct_ads / 100 × L_paid, 0), 1)
  ARPU_ads = max(0, arpu × L_arpu)           тот же arpu, что у органики
  ads_cost = max(0, ads_cost_month)

  R_promo_ads = T_ads × CR_ads × S_approved_ads × S_paid_ads × ARPU_ads</pre>
    <p>Сейчас Stretch: ${stretch.ads_enabled ? "включена" : "выключена"}, окно ${adsWindow}, T_ads = ${nf.format(stretch.ads_traffic_month || 0)}, бюджет = ${rub(stretch.ads_cost_month || 0)}, CR = ${nf1.format(stretch.conversion_pct_ads || 0)}%, одобренные = ${nf1.format(stretch.approved_activation_share_pct_ads || 0)}%, оплачиваемые = ${nf1.format(stretch.paid_partner_share_pct_ads || 0)}%.</p>

    <h3>8. Карты</h3>
    <pre class="formula">T = T_org + T_ads

S_black = card_black_enabled ? min(max(black_share_pct / 100, 0), 1) : 0
S_plat  = card_platinum_enabled ? min(max(platinum_share_pct / 100, 0), 1) : 0

R_black = T × S_black × max(0, black_ltv)
R_plat  = T × S_plat  × max(0, platinum_ltv)
R_cards = R_black + R_plat</pre>
    <p>LTV целиком в месяц оформления. Доля подрядчика на карты не режется. Сейчас доли ${nf1.format(base.black_share_pct || 0)}% Black и ${nf1.format(base.platinum_share_pct || 0)}% Platinum, LTV ${rub(base.black_ltv)} и ${rub(base.platinum_ltv)}.</p>

    <h3>9. Валовая выручка</h3>
    <pre class="formula">R_promo = R_promo_org + R_promo_ads
R_extra = 0 в статус-кво, иначе сумма extra_revenue_month сработавших инициатив
R = R_promo + R_cards + R_extra</pre>

    <h3>10. Доля подрядчика</h3>
    <pre class="formula">pct(phase):
  status_quo → contractor_share_status_quo   иначе contractor_share_pct
  rnd        → contractor_share_rnd          иначе contractor_share_pct
  own        → contractor_share_ops          иначе 0

подрядчик = R_promo × pct / 100</pre>
    <p>Режется только промо, не карты и не R_extra. Сейчас Base: RnD ${nf1.format(base.contractor_share_rnd ?? base.contractor_share_pct)}%, свой сайт ${nf1.format(base.contractor_share_ops || 0)}%, статус-кво ${nf1.format(base.contractor_share_status_quo ?? base.contractor_share_pct)}%.</p>

    <h3>11. Разработка и поддержка</h3>
    <pre class="formula">разработка(phase) = max(0, ₽/мес этой фазы)
  rnd:        dev_cost_rnd, иначе dev_cost_month
  own:        dev_cost_ops, иначе 0
  status_quo: dev_cost_status_quo, иначе 0

поддержка(phase):
  rnd / own / status_quo → support_rnd / support_ops / support_status_quo</pre>
    <p>Сейчас разработка ${rub(base.dev_cost_rnd ?? base.dev_cost_month)} / ${rub(base.dev_cost_ops || 0)} / ${rub(base.dev_cost_status_quo || 0)}. Поддержка ${rub(base.support_rnd)} / ${rub(base.support_ops)} / ${rub(base.support_status_quo)}.</p>

    <h3>12. Зарплаты</h3>
    <pre class="formula">статус-кво:  salaries_status_quo                    сейчас ${rub(base.salaries_status_quo || 0)}
Base:        0

Stretch, если есть team_schedule на этот t:
  ЗП_сопровождения = max(0, headcount) × max(0, avg_salary)

Stretch, phase = rnd:
  если team_headcount_rnd != 0 или team_avg_salary_rnd != 0:
    ЗП_сопровождения = max(0, headcount_rnd) × max(0, avg_salary_rnd)
  иначе salaries_rnd

Stretch, phase = own:
  если team_headcount_ops != 0 или team_avg_salary_ops != 0:
    ЗП_сопровождения = max(0, headcount_ops) × max(0, avg_salary_ops)
  иначе salaries_ops

ЗП доп. RnD (только Stretch, в статус-кво = 0):
  сумма по инициативам, где duration > 0 и start ≤ t < start + duration:
    headcount × avg_salary

ЗП = ЗП_сопровождения + ЗП доп. RnD</pre>

    <h3>13. Статьи затрат</h3>
    <pre class="formula">ставка(phase) = rnd / ops / status_quo у статьи

fixed:                 сумма = ставка
per_paid_activation:   сумма = ставка × оплаченные (органика + реклама)
per_activation:        сумма = ставка × активации (органика + реклама)
pct_of_revenue:        сумма = R × ставка / 100

переменные = сумма статей</pre>
    ${vcTable}

    <h3>14. Затраты и CF месяца</h3>
    <pre class="formula">фикс = ЗП + поддержка + разработка
затраты = фикс + переменные + подрядчик + ads_cost
CF_t = R − затраты</pre>
    <p>В ряде статус-кво после расчёта принудительно: ads_cost = 0, ЗП доп. RnD = 0, R_extra = 0.</p>

    <h3>15. Инкремент и окупаемость</h3>
    <pre class="formula">Inc_t = CF_проект,t − CF_статус-кво,t
накопленный CF_t = сумма CF_проект с 1 по t
накопленный Inc_t = сумма Inc с 1 по t

окупаемость vs подрядчик = первый t, где накопленный Inc_t ≥ 0
окупаемость проекта     = первый t, где накопленный CF_t ≥ 0
если не случилось за N месяцев — «нет»

инвестиции на разработке = max(0, − сумма Inc_t по месяцам phase = rnd)</pre>
    <p>Сейчас Base: окупаемость vs подрядчик ${b.payback_incremental_month ? `${b.payback_incremental_month} мес.` : "нет"}, накопленный Inc = ${rub(b.final_cumulative_incremental)}, CF проекта = ${rub(b.total_cf)}, инвестиции RnD = ${rub(b.rnd_investment)}.</p>
    <p>Stretch: окупаемость vs подрядчик ${s.payback_incremental_month ? `${s.payback_incremental_month} мес.` : "нет"}, накопленный Inc = ${rub(s.final_cumulative_incremental)}, CF проекта = ${rub(s.total_cf)}.</p>

    <h3>16. Суммы за горизонт</h3>
    <pre class="formula">выручка за N мес. = сумма R
затраты за N мес. = сумма затраты
CF проекта        = сумма CF_проект
промо органика    = сумма R_promo_org
промо реклама     = сумма R_promo_ads
бюджет рекламы    = сумма ads_cost
ЗП доп. RnD       = сумма ЗП доп. RnD</pre>

    <h3>17. Чувствительность</h3>
    <p>Для каждого драйвера (трафик, CR, одобренные, оплачиваемые, ARPU, доли и LTV карт; если SEO включён — пол и recovery; в Stretch при рекламе — T_ads, CR_ads, paid_ads, бюджет) параметр умножается на 0,8 / 1,0 / 1,2. Пересчитывается вся модель. В таблице — итоговый Inc и окупаемость vs подрядчик.</p>

    <h3>18. Как выбирается «типовой месяц» на вкладках</h3>
    <pre class="formula">статус-кво     = первый месяц ряда статус-кво
RnD            = первый месяц phase = rnd
первый свой    = первый месяц phase = own
свой после SEO = первый own, где SEO ≥ 0,999; иначе последний own</pre>

    ${walkMonth("Пример: статус-кво, Base", b.typical_sq)}
    ${walkMonth("Пример: RnD, Base", b.typical_rnd)}
    ${walkMonth("Пример: первый свой месяц, Base", b.typical_own_launch)}
    ${b.typical_own && b.typical_own_launch && b.typical_own.month !== b.typical_own_launch.month
      ? walkMonth("Пример: свой сайт после SEO = 100%, Base", b.typical_own)
      : ""}
  </div>`;
}

function shell() {
  return `
    <header class="top">
      <h1>ФЭМ <span>промокодов</span></h1>
      <span style="color:#9ca3af;font-size:12px">база ${nf.format(state.base.traffic_month)} визитов · LTV Black ${nf.format(state.base.black_ltv)} ₽ · сборка 20.08 19:30</span>
      <nav class="tabs">${TABS.map(([id, label]) => `<button data-tab="${id}" class="${state.tab === id ? "active" : ""}">${label}</button>`).join("")}</nav>
    </header>
    <div id="workspace"></div>
  `;
}

function renderWorkspace() {
  const root = document.getElementById("workspace");
  const tab = state.tab;
  if (tab === "logic") {
    root.innerHTML = `<div class="layout single">${renderLogic()}</div>`;
    return;
  }
  if (tab === "params") {
    root.innerHTML = `<div class="layout single">
      <div class="panel card-pad">
        <div class="tabs" style="margin:0 0 12px;justify-content:flex-start">
          <button data-param-sc="base" class="${paramScenario === "base" ? "active" : ""}" style="color:#111;border:1px solid #e5e7eb">Base</button>
          <button data-param-sc="stretch" class="${paramScenario === "stretch" ? "active" : ""}" style="color:#111;border:1px solid #e5e7eb">Stretch</button>
        </div>
        ${formBlocks(paramScenario, { full: true })}
      </div>
    </div>`;
    return;
  }
  root.innerHTML = `<div class="layout">
    <aside class="panel sidebar">
      <h2>${tab === "base" ? "Base: органика без рекламы и ЗП" : "Stretch: RnD + реклама"}</h2>
      <p class="caption">Коэффициенты живут в своей вкладке.</p>
      ${formBlocks(tab)}
    </aside>
    <main class="main" id="results">${renderResults(tab)}</main>
  </div>`;
}

function parseValue(input) {
  if (input.type === "checkbox") return input.checked;
  const raw = input.value.trim();
  if (raw.startsWith("=")) {
    const expr = raw.slice(1).replace(/[^0-9+\-*/().\s]/g, "");
    try {
      const v = Function(`"use strict"; return (${expr})`)();
      return Number(v);
    } catch {
      return 0;
    }
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function chartPayload(el) {
  if (!el._payload) {
    try {
      el._payload = JSON.parse(el.getAttribute("data-chart") || "null");
    } catch {
      el._payload = null;
    }
  }
  return el._payload;
}

function formatChartValue(kind, v) {
  if (kind === "count") return nf.format(Math.round(v));
  return compact(v);
}

function hideChartHover(chart) {
  if (!chart) return;
  const hover = chart.querySelector(".chart-hover");
  const tip = chart.querySelector(".chart-tooltip");
  if (hover) hover.setAttribute("opacity", "0");
  if (tip) {
    tip.hidden = true;
  }
}

function svgToViewX(svg, clientX) {
  const rect = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  return ((clientX - rect.left) / rect.width) * (vb.width || 900);
}

function chartX(p, i) {
  const iw = p.w - p.pad.l - p.pad.r;
  if (p.stacked) return p.pad.l + ((i + 0.5) / p.n) * iw;
  return p.pad.l + (p.n === 1 ? iw / 2 : (i / (p.n - 1)) * iw);
}

function chartY(p, v) {
  const ih = p.h - p.pad.t - p.pad.b;
  return p.pad.t + ih - ((v - p.min) / (p.max - p.min)) * ih;
}

function nearestMonth(p, px) {
  const iw = p.w - p.pad.l - p.pad.r;
  if (p.stacked) {
    return Math.min(Math.max(Math.floor(((px - p.pad.l) / iw) * p.n), 0), p.n - 1);
  }
  if (p.n <= 1) return 0;
  return Math.min(Math.max(Math.round(((px - p.pad.l) / iw) * (p.n - 1)), 0), p.n - 1);
}

function updateChartHover(chart, event) {
  const payload = chartPayload(chart);
  const svg = chart.querySelector("svg");
  const hover = chart.querySelector(".chart-hover");
  const tip = chart.querySelector(".chart-tooltip");
  if (!payload || !svg || !hover || !tip) return;
  const px = svgToViewX(svg, event.clientX);
  if (px < payload.pad.l || px > payload.w - payload.pad.r) {
    hideChartHover(chart);
    return;
  }
  const i = nearestMonth(payload, px);
  const x = chartX(payload, i);
  hover.setAttribute("opacity", "1");
  const line = hover.querySelector(".chart-hover-line");
  const band = hover.querySelector(".chart-hover-band");
  if (line) {
    line.setAttribute("x1", x);
    line.setAttribute("x2", x);
  }
  if (band) {
    const iw = payload.w - payload.pad.l - payload.pad.r;
    const bw = payload.stacked ? Math.max(8, (iw / payload.n) * 0.72) : 8;
    band.setAttribute("x", x - bw / 2);
    band.setAttribute("width", bw);
  }
  let acc = 0;
  hover.querySelectorAll(".chart-hover-dot").forEach((dot) => {
    const ser = payload.series[Number(dot.dataset.si)];
    if (!ser) return;
    const v = ser.values[i] || 0;
    if (payload.stacked) acc += v;
    const yv = payload.stacked ? acc : v;
    dot.setAttribute("cx", x);
    dot.setAttribute("cy", chartY(payload, yv));
    dot.setAttribute("display", payload.stacked && Math.abs(v) < 0.5 ? "none" : "inline");
  });
  const shown = payload.stacked
    ? payload.series.filter((ser) => Math.abs(ser.values[i] || 0) >= 0.5)
    : payload.series;
  const rows = (shown.length ? shown : payload.series).map((ser) => {
    const v = ser.values[i] || 0;
    const cls = payload.yKind === "money" ? moneyClass(v) : "";
    return `<div class="tt-row"><i class="dot" style="background:${ser.color}"></i><span>${ser.name}</span><b class="${cls}">${formatChartValue(payload.yKind, v)}</b></div>`;
  }).join("");
  const total = payload.stacked
    ? payload.series.reduce((s, ser) => s + (ser.values[i] || 0), 0)
    : null;
  const totalRow = total != null
    ? `<div class="tt-row tt-total"><span>Итого</span><b>${formatChartValue(payload.yKind, total)}</b></div>`
    : "";
  tip.hidden = false;
  tip.innerHTML = `<div class="tt-month">${payload.labels[i]}</div>${rows}${totalRow}`;
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  let left = event.clientX + 16;
  let top = event.clientY + 16;
  if (left + tw > window.innerWidth - 8) left = event.clientX - tw - 16;
  if (top + th > window.innerHeight - 8) top = event.clientY - th - 16;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${Math.max(8, top)}px`;
}

function bind() {
  document.body.addEventListener("click", (e) => {
    const tabBtn = e.target.closest("[data-tab]");
    if (tabBtn) {
      state.tab = tabBtn.dataset.tab;
      location.hash = state.tab;
      render();
      return;
    }
    const psc = e.target.closest("[data-param-sc]");
    if (psc) {
      paramScenario = psc.dataset.paramSc;
      renderWorkspace();
      return;
    }
    const add = e.target.closest("[data-add]");
    if (add) {
      const sc = add.dataset.sc;
      if (add.dataset.add === "extra_rnd") {
        state[sc].extra_rnd = state[sc].extra_rnd || [];
        state[sc].extra_rnd.push({
          name: "Новая инициатива", start_month: 5, duration_months: 6, headcount: 1,
          avg_salary: 250000, traffic_lift_pct: 0, conversion_lift_pct: 0, approved_lift_pct: 0,
          paid_lift_pct: 0, arpu_lift_pct: 0, extra_revenue_month: 0,
        });
      } else {
        state[sc].variable_costs = state[sc].variable_costs || [];
        state[sc].variable_costs.push({ name: "Новая статья", kind: "fixed", rnd: 0, ops: 0, status_quo: 0 });
      }
      renderWorkspace();
      return;
    }
    const del = e.target.closest("[data-del]");
    if (del) {
      const sc = del.dataset.sc;
      state[sc][del.dataset.del].splice(Number(del.dataset.i), 1);
      renderWorkspace();
      return;
    }
    if (e.target.closest("[data-copy-organic]")) {
      for (const key of ORGANIC_COPY_KEYS) state.stretch[key] = state.base[key];
      state.stretch.variable_costs = structuredClone(state.base.variable_costs || []);
      renderWorkspace();
    }
  });

  document.body.addEventListener("input", (e) => {
    const el = e.target.closest("[data-key], [data-arr]");
    if (!el) return;
    const sc = el.dataset.sc;
    if (el.dataset.arr) {
      const i = Number(el.dataset.i);
      const k = el.dataset.k;
      const v = el.type === "number" ? parseValue(el) : el.value;
      state[sc][el.dataset.arr][i][k] = k === "name" || k === "kind" || k === "phase" ? el.value : v;
    } else if (el.dataset.key === "num_months") {
      state.num_months = Math.max(1, Math.trunc(parseValue(el)));
    } else {
      state[sc][el.dataset.key] = parseValue(el);
      if (el.dataset.key === "dev_cost_rnd") state[sc].dev_cost_month = state[sc].dev_cost_rnd;
      if (el.dataset.key === "contractor_share_rnd") state[sc].contractor_share_pct = state[sc].contractor_share_rnd;
    }
    if (el.dataset.k === "kind" && (state.tab === "base" || state.tab === "stretch" || state.tab === "params")) {
      renderWorkspace();
      return;
    }
    const results = document.getElementById("results");
    if (results && (state.tab === "base" || state.tab === "stretch")) {
      results.innerHTML = renderResults(state.tab);
    }
  });

  let activeChart = null;
  document.body.addEventListener("pointermove", (e) => {
    const chart = e.target.closest("[data-chart]");
    if (activeChart && activeChart !== chart) hideChartHover(activeChart);
    activeChart = chart || null;
    if (!chart) return;
    updateChartHover(chart, e);
  });
  document.body.addEventListener("pointerleave", () => {
    if (activeChart) hideChartHover(activeChart);
    activeChart = null;
  });

  window.addEventListener("hashchange", () => {
    const next = location.hash.replace("#", "") || "base";
    if (TABS.some(([id]) => id === next) && next !== state.tab) {
      state.tab = next;
      render();
    }
  });
}

function render() {
  if (!["base", "stretch", "params", "logic"].includes(state.tab)) state.tab = "base";
  document.getElementById("app").innerHTML = shell();
  renderWorkspace();
}

const defaultsUrl = new URL("./defaults.js", import.meta.url);

function bustStylesheet() {
  const href = new URL(`./styles.css?t=${Date.now()}`, import.meta.url).href;
  const existing = [...document.querySelectorAll('link[rel="stylesheet"]')].find((l) => l.href.includes("styles.css"));
  if (existing) {
    existing.href = href;
    return;
  }
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

async function main() {
  bustStylesheet();
  const bust = `t=${Date.now()}`;
  const mod = await import(`${defaultsUrl.href}?${bust}`);
  defaults = mod.default;
  state = initState(defaults);
  if (location.hash.replace("#", "")) state.tab = location.hash.replace("#", "");
  bind();
  render();
}

main().catch((err) => {
  document.getElementById("app").innerHTML = `<p style="padding:24px">Не удалось загрузить модель: ${err.message}</p>`;
});

window.addEventListener("pageshow", (event) => {
  if (event.persisted) window.location.reload();
});
