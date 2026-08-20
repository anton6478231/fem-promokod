import { applyBaseConstraints, runModel, sensitivityTable } from "./engine.js";

const ORGANIC_COPY_KEYS = [
  "rnd_months", "traffic_month", "seo_dip_enabled", "seo_dip_floor_pct", "seo_recovery_months",
  "conversion_pct", "approved_activation_share_pct", "paid_partner_share_pct", "arpu",
  "contractor_share_pct", "dev_cost_month", "card_black_enabled", "black_share_pct", "black_ltv",
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
const PHASE_OPTIONS = [
  ["own", "свой сайт"],
  ["rnd", "RnD"],
  ["both", "обе фазы"],
  ["status_quo", "статус-кво"],
];

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

function initState(src) {
  const base = stripMeta(src);
  const stretch = stripMeta(src);
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
      ${field(sc, "dev_cost_month", "Стоимость разработки, ₽/мес")}
    </div>
    <div class="block">
      <h3>Органика</h3>
      ${field(sc, "traffic_month", "Визиты / мес")}
      ${field(sc, "conversion_pct", "Конверсия в активацию, %", { step: 0.1 })}
      ${field(sc, "approved_activation_share_pct", "Доля одобренных, %", { step: 0.1 })}
      ${field(sc, "paid_partner_share_pct", "Доля оплачиваемых, %", { step: 0.1 })}
      ${field(sc, "arpu", "ARPU, ₽")}
      ${field(sc, "contractor_share_pct", "Доля подрядчика, %")}
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
      <h3>Поддержка, ₽/мес</h3>
      <div class="row3">
        ${field(sc, "support_rnd", "RnD")}
        ${field(sc, "support_ops", "Свой сайт")}
        ${field(sc, "support_status_quo", "Статус-кво")}
      </div>
      ${field(sc, "salaries_status_quo", "ЗП статус-кво, ₽/мес")}
    </div>
    <div class="block">
      <h3>Переменные расходы</h3>
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
  const body = rows.map((row, idx) => `
    <tr>
      <td><input data-sc="${sc}" data-arr="variable_costs" data-i="${idx}" data-k="name" value="${escapeAttr(row.name || "")}"></td>
      <td>
        <select data-sc="${sc}" data-arr="variable_costs" data-i="${idx}" data-k="kind">
          ${KIND_OPTIONS.map(([v, l]) => `<option value="${v}" ${row.kind === v ? "selected" : ""}>${l}</option>`).join("")}
        </select>
      </td>
      <td><input type="number" data-sc="${sc}" data-arr="variable_costs" data-i="${idx}" data-k="value" value="${row.value || 0}"></td>
      <td>
        <select data-sc="${sc}" data-arr="variable_costs" data-i="${idx}" data-k="phase">
          ${PHASE_OPTIONS.map(([v, l]) => `<option value="${v}" ${row.phase === v ? "selected" : ""}>${l}</option>`).join("")}
        </select>
      </td>
      <td><button class="icon-btn" data-del="variable_costs" data-sc="${sc}" data-i="${idx}">×</button></td>
    </tr>
  `).join("");
  return `
    <div class="editor table-wrap">
      <table>
        <thead><tr><th>Статья</th><th>Тип</th><th>Значение</th><th>Фаза</th><th></th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <button class="ghost" data-add="variable_costs" data-sc="${sc}" type="button">+ статья</button>
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
      const extra = Object.entries(row.variable_breakdown || {}).map(([n, v]) => `<li>${n}: ${rub(v)}</li>`).join("");
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

function svgChart({ title, labels, series, stacked = false, yFormat = rub }) {
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
        body += `<rect x="${x(i) - bw / 2}" y="${Math.min(y0, y1)}" width="${bw}" height="${Math.max(1, Math.abs(y0 - y1))}" fill="${ser.color}"><title>${ser.name}: ${yFormat(v)}</title></rect>`;
        acc += v;
      }
    }
  } else {
    for (const ser of series) {
      const d = ser.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
      body += `<path d="${d}" fill="none" stroke="${ser.color}" stroke-width="${ser.width || 2}" stroke-dasharray="${ser.dash || ""}"></path>`;
      body += ser.values.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${ser.color}"><title>${labels[i]} · ${ser.name}: ${yFormat(v)}</title></circle>`).join("");
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
  return `<div class="panel card-pad"><h2>${title}</h2><div class="chart">
    <svg viewBox="0 0 ${w} ${h}" role="img">
      ${band}${grid}<line x1="${pad.l}" x2="${w - pad.r}" y1="${zero}" y2="${zero}" stroke="#9ca3af" stroke-dasharray="3 3"></line>
      ${body}${xticks}${legend}
    </svg></div></div>`;
}

function renderCharts(project, scenario, payback) {
  const labels = monthLabels(project);
  const money = (v) => compact(v);
  const visits = (v) => nf.format(Math.round(v));
  const seo = svgChart({
    title: "Органический трафик: SEO-просадка после переезда",
    labels,
    yFormat: visits,
    series: [
      { name: "Статус-кво", color: "#9CA3AF", dash: "4 4", values: project.map((r) => r.sq_organic_traffic) },
      { name: "Проект", color: "#059669", width: 3, values: project.map((r) => r.organic_traffic) },
    ],
  });
  const cf = svgChart({
    title: "Выручка, затраты и денежный поток",
    labels,
    yFormat: money,
    series: [
      { name: "Выручка", color: "#10B981", width: 3, values: project.map((r) => r.gross_revenue) },
      { name: "Затраты", color: "#EF4444", width: 3, values: project.map((r) => r.total_costs) },
      { name: "CF месяца", color: "#3B82F6", values: project.map((r) => r.cash_flow) },
      { name: "Накопленный CF", color: "#8B5CF6", dash: "6 4", values: project.map((r) => r.cumulative_cf) },
    ],
  });
  const inc = svgChart({
    title: `Проект vs подрядчик${payback ? ` · окупаемость М${payback}` : ""}`,
    labels,
    yFormat: money,
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
        series: [
          { name: "Промо органика", color: "#059669", values: project.map((r) => r.organic_promo_revenue || 0) },
          { name: "Промо реклама", color: "#2563EB", values: project.map((r) => r.ads_promo_revenue || 0) },
          { name: "Карты", color: "#D97706", values: project.map((r) => r.card_revenue || 0) },
          { name: "Доп. RnD", color: "#7C3AED", values: project.map((r) => r.extra_product_revenue || 0) },
        ],
      })
    : "";
  return seo + cf + inc + channel + costs;
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
    ${renderTypical(kpis, scenario)}
    ${renderOpex(kpis, params)}
    ${renderComparison(scenario)}
    ${renderCharts(project, scenario, payback)}
    ${renderSensitivity(params)}
    ${renderMonthTable(project, scenario)}
  `;
}

function renderLogic() {
  const base = scenarioParams("base");
  const stretch = scenarioParams("stretch");
  const promo = base.traffic_month * (base.conversion_pct / 100) * (base.approved_activation_share_pct / 100) * (base.paid_partner_share_pct / 100) * base.arpu;
  return `<div class="panel card-pad logic">
    <h2>Логика модели</h2>
    <p>Одна формула выручки, два сценария: Base (органика) и Stretch (RnD + реклама).</p>
    <h3>Формула</h3>
    <pre class="formula">T_org,t = T_org × L_traffic,t × SEO_t
R_promo^ch = T_ch × CR_ch × S_approved,ch × S_paid,ch × ARPU
R = R_promo^org + R_promo^ads + R_black + R_plat + R_extra
Inc_t = CF_проект,t − CF_подрядчик,t
Окупаемость = первый месяц, где сумма Inc ≥ 0</pre>
    <h3>Органика сейчас в Base</h3>
    <p>T_org = ${nf.format(base.traffic_month)}, CR = ${base.conversion_pct}%, оплачиваемые = ${base.paid_partner_share_pct}%, ARPU = ${rub(base.arpu)} → промо ${rub(promo)} / мес.</p>
    <h3>Фазы</h3>
    <p><b>RnD:</b> доля подрядчика ${base.contractor_share_pct}% с промо + разработка ${rub(base.dev_cost_month)}/мес. <b>Свой сайт:</b> подрядчик = 0. В Base нет зарплат и рекламы.</p>
    <p>SEO: после переезда органика падает до пола и линейно возвращается к 100%. Реклама и статус-кво не проседают. Stretch: Base ${stretch.rnd_months} мес. разработки, пол ${stretch.seo_dip_floor_pct}%.</p>
  </div>`;
}

function shell() {
  return `
    <header class="top">
      <h1>ФЭМ <span>промокодов</span></h1>
      <span style="color:#9ca3af;font-size:12px">база ${nf.format(state.base.traffic_month)} визитов · LTV Black ${nf.format(state.base.black_ltv)} ₽</span>
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
        state[sc].variable_costs.push({ name: "Новая статья", kind: "fixed", value: 0, phase: "own" });
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
    }
    const results = document.getElementById("results");
    if (results && (state.tab === "base" || state.tab === "stretch")) {
      results.innerHTML = renderResults(state.tab);
    }
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

async function main() {
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
