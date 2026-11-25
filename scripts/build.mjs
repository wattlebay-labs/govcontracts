// Build the static site from the dataset the fetch step keeps
// (data/contracts.json, one compact record per contract).
//
// Output, all plain HTML with one stylesheet, written to site/:
//   index.html                 headline numbers, contracts ending by month, top lists
//   categories/                every UNSPSC code in the data
//   category/<code>/           one page per UNSPSC code, with its expiring contracts
//   agencies/, agency/<slug>/  one page per buying agency
//   suppliers/, suppliers/<letter>/, supplier/<abn>/   one page per supplier ABN
//   about/                     source, licence, coverage, caveats
//   sample-pack/               a worked sample of a Bid Draft Pack (sample-pack.mjs)
//   404.html, sitemap.xml, style.css
//   build.json                 when this build was made and how many pages it has
// plus data/build.json: page counts and sizes, small enough to commit.
//
// Every page credits the source and says the figures are derived. Links are
// relative, so the site works under any address.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SAMPLE_PACK_LINK, samplePack } from "./sample-pack.mjs";

export const SITE_NAME = "govcontracts";
export const SOURCE_URL = "https://www.tenders.gov.au/";
export const LICENCE_URL = "https://creativecommons.org/licenses/by/3.0/au/";
const DAY = 864e5;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ---------- small helpers ----------

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const slug = (s) =>
  String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");

// The API gives dates as the UTC instant of midnight in Canberra, so the
// calendar date a notice shows is the date in that time zone.
const canberra = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Sydney",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const dateCache = new Map();
export function localDate(isoString) {
  if (!isoString) return null;
  const hit = dateCache.get(isoString);
  if (hit !== undefined) return hit;
  const t = Date.parse(isoString);
  let out = null;
  if (Number.isFinite(t)) {
    const p = Object.fromEntries(canberra.formatToParts(t).map((x) => [x.type, x.value]));
    out = `${p.year.padStart(4, "0")}-${p.month}-${p.day}`;
  }
  dateCache.set(isoString, out);
  return out;
}

// Some notices carry dates that cannot be right (1900-01-01 was seen).
export const plausible = (ymd) => (ymd && ymd >= "1990-01-01" && ymd <= "2100-12-31" ? ymd : null);

export function addDays(ymd, days) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY).toISOString().slice(0, 10);
}

export function fmtDate(ymd) {
  if (!ymd) return "not stated";
  const [y, m, d] = ymd.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const fmtMonth = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

const whole = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 0 });
export const num = (n) => whole.format(n);
export const money = (n) => (Number.isFinite(n) ? `$${whole.format(Math.round(n))}` : "not stated");
export function moneyShort(n) {
  if (!Number.isFinite(n)) return "not stated";
  const one = (x) => (Math.round(x * 10) / 10).toString();
  if (n >= 1e9) return `$${one(n / 1e9)} billion`;
  if (n >= 1e6) return `$${one(n / 1e6)} million`;
  return money(n);
}

export const cleanAbn = (abn) => {
  const digits = String(abn ?? "").replace(/\s+/g, "");
  return /^\d{11}$/.test(digits) ? digits : null;
};
export const fmtAbn = (abn) => `${abn.slice(0, 2)} ${abn.slice(2, 5)} ${abn.slice(5, 8)} ${abn.slice(8)}`;

const tidy = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

// Distinct values, most frequent first, ignoring case and spacing, each in the
// spelling it most often has. Ties go alphabetically so builds are stable.
export function ranked(values) {
  const groups = new Map();
  for (const raw of values) {
    const text = tidy(raw);
    if (!text) continue;
    const key = text.toLowerCase();
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { count: 0, forms: new Map() }));
    g.count++;
    g.forms.set(text, (g.forms.get(text) || 0) + 1);
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].count - a[1].count || (a[0] < b[0] ? -1 : 1))
    .map(([, g]) => ({ text: [...g.forms.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0], count: g.count }));
}
export const commonest = (values, n = 1) =>
  ranked(values)
    .slice(0, n)
    .map((x) => x.text);

// What a UNSPSC code is used for, judged from the descriptions on its
// contracts. A description only stands for the code when it recurs: in some
// codes every contract is described differently, and one contract's wording
// would mislead. `label` needs 3 contracts and either 5% of the code's
// described contracts or 20 of them; `typical` lists descriptions seen twice
// or more.
export function describeCode(descriptions) {
  const list = ranked(descriptions);
  const described = list.reduce((s, x) => s + x.count, 0);
  const top = list[0];
  const label = top && top.count >= 3 && (top.count >= 20 || top.count / described >= 0.05) ? clip(top.text, 70) : null;
  const typical = list
    .filter((x) => x.count >= 2)
    .slice(0, 3)
    .map((x) => clip(x.text, 70));
  return { label, typical };
}

// ---------- the model ----------

const byEnd = (a, b) => {
  if (a.end === b.end) return a.id < b.id ? -1 : 1;
  if (!a.end) return 1;
  if (!b.end) return -1;
  return a.end < b.end ? -1 : 1;
};

const total = (rows) => rows.reduce((s, r) => s + (r.value || 0), 0);

function tally(rows) {
  const soon = rows.filter((r) => r.soon);
  return { count: rows.length, value: total(rows), soonCount: soon.length, soonValue: total(soon) };
}

// Turn the raw records into rows with usable dates, and group them by
// category, agency and supplier. `nowMs` fixes "today" for the whole build.
export function analyse(records, nowMs) {
  const today = localDate(new Date(nowMs).toISOString());
  const horizon = addDays(today, 365);
  const skipped = { noSupplierAbn: 0, noCategory: 0, noAgency: 0, badEndDate: 0, noValue: 0 };

  const rows = [];
  for (const r of records) {
    if (!r || !r.id) continue;
    const endRaw = localDate(r.end);
    const end = plausible(endRaw);
    if (r.end && !end) skipped.badEndDate++;
    const value = Number.isFinite(r.value) && r.value >= 0 ? r.value : null;
    if (value === null) skipped.noValue++;
    const abn = cleanAbn(r.supplierAbn);
    if (!abn) skipped.noSupplierAbn++;
    const code = /^\d{8}$/.test(String(r.unspsc ?? "")) ? String(r.unspsc) : null;
    if (!code) skipped.noCategory++;
    const agency = tidy(r.agency) || null;
    if (!agency) skipped.noAgency++;
    rows.push({
      id: String(r.id),
      description: tidy(r.description) || null,
      agency,
      supplier: tidy(r.supplier) || null,
      abn,
      state: tidy(r.supplierState) || null,
      value,
      start: plausible(localDate(r.start)),
      end,
      code,
      method: tidy(r.method) || null,
      amended: !!r.amendment,
      soon: !!end && end >= today && end < horizon,
    });
  }
  rows.sort(byEnd);

  const group = (keyOf) => {
    const map = new Map();
    for (const row of rows) {
      const key = keyOf(row);
      if (!key) continue;
      let list = map.get(key);
      if (!list) map.set(key, (list = []));
      list.push(row);
    }
    return map;
  };

  const categories = [...group((r) => r.code).entries()]
    .map(([code, list]) => {
      return { code, rows: list, ...describeCode(list.map((r) => r.description)), ...tally(list) };
    })
    .sort((a, b) => (a.code < b.code ? -1 : 1));

  const usedSlugs = new Set();
  const agencies = [...group((r) => r.agency).entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "en"))
    .map(([name, list]) => {
      let s = slug(name) || "agency";
      for (let i = 2; usedSlugs.has(s); i++) s = `${slug(name) || "agency"}-${i}`;
      usedSlugs.add(s);
      return { name, slug: s, rows: list, ...tally(list) };
    });

  const suppliers = [...group((r) => r.abn).entries()]
    .map(([abn, list]) => {
      const name = commonest(list.map((r) => r.supplier), 1)[0] || `ABN ${fmtAbn(abn)}`;
      const states = [...new Set(list.map((r) => r.state).filter(Boolean))].sort();
      return { abn, name, states, rows: list, ...tally(list) };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || (a.abn < b.abn ? -1 : 1));

  const months = new Map();
  for (let ym = today.slice(0, 7); ym <= addDays(horizon, -1).slice(0, 7); ) {
    months.set(ym, { ym, count: 0, value: 0 });
    const [y, m] = ym.split("-").map(Number);
    ym = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  }
  for (const row of rows) {
    if (!row.soon) continue;
    const m = months.get(row.end.slice(0, 7));
    m.count++;
    m.value += row.value || 0;
  }

  return {
    today,
    horizon,
    rows,
    categories,
    agencies,
    suppliers,
    months: [...months.values()],
    agencySlug: new Map(agencies.map((a) => [a.name, a.slug])),
    supplierName: new Map(suppliers.map((s) => [s.abn, s.name])),
    categoryLabel: new Map(categories.map((c) => [c.code, c.label])),
    totals: tally(rows),
    skipped,
  };
}

// The rows to print when a list is too long for one page: the largest by
// value, shown in end-date order.
export function pick(rows, cap) {
  if (rows.length <= cap) return [...rows].sort(byEnd);
  return [...rows]
    .sort((a, b) => (b.value || 0) - (a.value || 0) || (a.id < b.id ? -1 : 1))
    .slice(0, cap)
    .sort(byEnd);
}

// Biggest groups of rows by total value, e.g. the top suppliers in a category.
function leaders(rows, keyOf, cap) {
  const map = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    let g = map.get(key);
    if (!g) map.set(key, (g = { key, count: 0, value: 0, soonCount: 0, names: [] }));
    g.count++;
    g.value += row.value || 0;
    if (row.soon) g.soonCount++;
    if (g.names.length < 50) g.names.push(row.supplier);
  }
  return [...map.values()].sort((a, b) => b.value - a.value || (a.key < b.key ? -1 : 1)).slice(0, cap);
}

const supplierKey = (r) => r.abn || (r.supplier ? `name:${r.supplier.toLowerCase()}` : null);
const letterOf = (name) => {
  const c = name.normalize("NFKD").replace(/[^A-Za-z0-9]/g, "").charAt(0).toUpperCase();
  return c >= "A" && c <= "Z" ? c.toLowerCase() : "0-9";
};

// What the dataset holds, in a sentence, from the dates the fetch has read in
// full (`coverageOf`). Used on the site and in the category reports.
export function coverageText(cov = {}) {
  const endFrom = plausible(cov?.endFrom || null);
  const endTo = plausible(cov?.endTo || null);
  const publishedFrom = plausible(cov?.publishedFrom || null);
  return endFrom && endTo
    ? `It holds notices for contracts whose end date falls between ${fmtDate(endFrom)} and ${fmtDate(endTo)}` +
        (publishedFrom ? `, and notices published since ${fmtDate(publishedFrom)}` : "") +
        `, and is refreshed daily with new notices and amendments.`
    : `It holds notices for contracts ending in roughly the next 12 months, and recently published notices, and is refreshed daily with new notices and amendments.`;
}
export const PARTIAL = `This is not a full history: earlier contracts that have already ended are not included.`;

// ---------- pages ----------

// Yields { path, body } for every file of the site. `opts`:
//   siteUrl   absolute address of the site, for canonical links and the sitemap
//   updated   ISO time the data was last fetched
//   coverage  { endFrom, endTo, publishedFrom } as YYYY-MM-DD, when known
//   css       the stylesheet text
export function* pages(model, opts = {}) {
  const siteUrl = String(opts.siteUrl || "").replace(/\/+$/, "");
  const basePath = siteUrl ? new URL(`${siteUrl}/`).pathname : "/";
  const updated = localDate(opts.updated || null) || model.today;
  const cap = opts.cap || 150;
  const linked = new Set();
  const made = new Set();

  const coverage = coverageText(opts.coverage);
  const partial = PARTIAL;

  const html = ({ path, title, description, body, noindex = false, absolute = false }) => {
    const depth = path.split("/").length - 1;
    const root = absolute ? basePath : "../".repeat(depth);
    const here = path.replace(/index\.html$/, "");
    const a = (to, text, cls) => {
      linked.add(to);
      return `<a${cls ? ` class="${cls}"` : ""} href="${root}${to}${!root && !to ? "./" : ""}">${text}</a>`;
    };
    made.add(path);
    return {
      path,
      body: `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${noindex ? '<meta name="robots" content="noindex">' : siteUrl ? `<link rel="canonical" href="${esc(`${siteUrl}/${here}`)}">` : ""}
<link rel="stylesheet" href="${root}style.css">
</head>
<body>
<header class="top">
<div class="wrap">
${a("", esc(SITE_NAME), "brand")}
<nav>${a("categories/", "Categories")} ${a("agencies/", "Agencies")} ${a("suppliers/", "Suppliers")} ${a("about/", "About")}</nav>
</div>
</header>
<main class="wrap">
${body(a)}
</main>
<footer class="wrap">
<p>Data: <a href="${SOURCE_URL}" rel="noopener">AusTender</a> contract notices, Department of Finance, licensed under <a href="${LICENCE_URL}" rel="noopener license">CC BY 3.0 AU</a>. Figures on this site are derived from that data and may differ from the source: check the original notice on AusTender before relying on them.</p>
<p>This site is independent. It is not affiliated with, or endorsed by, the Australian Government. Data last updated ${fmtDate(updated)}. ${a("about/", "About this site")} · ${a(SAMPLE_PACK_LINK, "Sample Bid Draft Pack")}</p>
</footer>
</body>
</html>
`,
    };
  };

  const stat = (label, value) => `<div class="stat"><b>${value}</b><span>${esc(label)}</span></div>`;
  const stats = (t) =>
    `<div class="stats">${stat("contracts held", num(t.count))}${stat("total value as published", moneyShort(t.value))}${stat(
      "ending in the next 12 months",
      num(t.soonCount),
    )}${stat("value ending in the next 12 months", moneyShort(t.soonValue))}</div>`;

  const supplierCell = (a, row) =>
    row.abn ? a(`supplier/${row.abn}/`, esc(model.supplierName.get(row.abn))) : esc(row.supplier || "not stated");
  const agencyCell = (a, row) => (row.agency ? a(`agency/${model.agencySlug.get(row.agency)}/`, esc(row.agency)) : "not stated");
  const categoryCell = (a, row) =>
    row.code
      ? `${a(`category/${row.code}/`, row.code)}${model.categoryLabel.get(row.code) ? ` <small>${esc(clip(model.categoryLabel.get(row.code), 40))}</small>` : ""}`
      : "not stated";

  const COLS = {
    end: ["Ends", (a, r) => `<span class="nw">${fmtDate(r.end)}</span>${r.end && r.end < model.today ? " <small>ended</small>" : ""}`],
    supplier: ["Supplier", supplierCell],
    agency: ["Agency", agencyCell],
    what: [
      "Contract",
      (a, r) => `${esc(r.description || "No description")} <small>${esc(r.id)}${r.amended ? ", amended" : ""}</small>`,
      "w",
    ],
    category: ["Category", categoryCell],
    value: ["Value (AUD)", (a, r) => `<span class="nw">${money(r.value)}</span>`, "r"],
    start: ["Started", (a, r) => `<span class="nw">${fmtDate(r.start)}</span>`],
    method: ["Method", (a, r) => esc(r.method || "not stated")],
  };
  const table = (a, rows, cols) =>
    `<div class="scroll"><table class="wide">
<thead><tr>${cols.map((c) => `<th${COLS[c][2] ? ` class="${COLS[c][2]}"` : ""}>${COLS[c][0]}</th>`).join("")}</tr></thead>
<tbody>
${rows.map((r) => `<tr>${cols.map((c) => `<td${COLS[c][2] ? ` class="${COLS[c][2]}"` : ""}>${COLS[c][1](a, r)}</td>`).join("")}</tr>`).join("\n")}
</tbody></table></div>`;

  const expiring = (a, rows, cols, heading = "Contracts ending in the next 12 months") => {
    const soon = rows.filter((r) => r.soon);
    if (!soon.length) return `<h2>${heading}</h2>\n<p>None of the contracts held here end in the next 12 months.</p>`;
    const shown = pick(soon, cap);
    const note =
      soon.length > shown.length
        ? `The ${num(shown.length)} largest of ${num(soon.length)} contracts ending between ${fmtDate(model.today)} and ${fmtDate(addDays(model.horizon, -1))}, in end-date order.`
        : `${num(soon.length)} ${soon.length === 1 ? "contract ends" : "contracts end"} between ${fmtDate(model.today)} and ${fmtDate(addDays(model.horizon, -1))}.`;
    return `<h2>${heading}</h2>\n<p class="note">${note} A contract ending does not mean it will be re-tendered: it may be extended, replaced under a panel, or not renewed.</p>\n${table(a, shown, cols)}`;
  };

  const leaderTable = (a, title, head, list, cell, valueHead = "Value (AUD)") =>
    list.length
      ? `<h2>${title}</h2>
<div class="scroll"><table>
<thead><tr><th>${head}</th><th class="r">Contracts</th><th class="r">Ending in 12 months</th><th class="r">${valueHead}</th></tr></thead>
<tbody>
${list.map((g) => `<tr><td>${cell(g)}</td><td class="r">${num(g.count)}</td><td class="r">${num(g.soonCount)}</td><td class="r nw">${money(g.value)}</td></tr>`).join("\n")}
</tbody></table></div>`
      : "";
  const supplierLeader = (a) => (g) =>
    g.key.startsWith("name:") ? esc(commonest(g.names, 1)[0] || "not stated") : a(`supplier/${g.key}/`, esc(model.supplierName.get(g.key)));
  const agencyLeader = (a) => (g) => a(`agency/${model.agencySlug.get(g.key)}/`, esc(g.key));
  const categoryLeader = (a) => (g) =>
    `${a(`category/${g.key}/`, g.key)}${model.categoryLabel.get(g.key) ? ` <small>${esc(model.categoryLabel.get(g.key))}</small>` : ""}`;

  const top = (list, n) => [...list].sort((x, y) => y.soonValue - x.soonValue || y.count - x.count).slice(0, n);

  // Home
  yield html({
    path: "index.html",
    title: `Australian Government contracts ending soon, by category, agency and supplier | ${SITE_NAME}`,
    description: `${num(model.totals.soonCount)} Australian Government contracts end in the next 12 months. See who holds them, which agency bought them, what they are worth and when they end.`,
    body: (a) => `<h1>Australian Government contracts, and when they end</h1>
<p class="lead">Who supplies the Australian Government, which agency buys, what each contract is worth and when it ends. Built from official AusTender contract notices.</p>
${stats(model.totals)}
<p class="note">${num(model.suppliers.length)} suppliers, ${num(model.agencies.length)} agencies and ${num(model.categories.length)} categories. ${coverage} ${partial}</p>
<h2>Contracts ending, month by month</h2>
<div class="scroll"><table>
<thead><tr><th>Month</th><th class="r">Contracts ending</th><th class="r">Value (AUD)</th></tr></thead>
<tbody>
${model.months.map((m) => `<tr><td>${fmtMonth(m.ym)}</td><td class="r">${num(m.count)}</td><td class="r nw">${money(m.value)}</td></tr>`).join("\n")}
</tbody></table></div>
<p class="note">Counted from ${fmtDate(model.today)} to ${fmtDate(addDays(model.horizon, -1))}, so the first and last months are part months.</p>
${leaderTable(
  a,
  "Categories with the most value ending in the next 12 months",
  "Category (UNSPSC code)",
  top(model.categories, 20).map((c) => ({ key: c.code, count: c.count, soonCount: c.soonCount, value: c.soonValue })),
  categoryLeader(a),
  "Value ending (AUD)",
)}
<p>${a("categories/", `All ${num(model.categories.length)} categories`)}</p>
${leaderTable(
  a,
  "Agencies with the most value ending in the next 12 months",
  "Agency",
  top(model.agencies, 20).map((g) => ({ key: g.name, count: g.count, soonCount: g.soonCount, value: g.soonValue })),
  agencyLeader(a),
  "Value ending (AUD)",
)}
<p>${a("agencies/", `All ${num(model.agencies.length)} agencies`)} · ${a("suppliers/", `All ${num(model.suppliers.length)} suppliers`)}</p>
<h2>Bidding for government work?</h2>
<p>See what a tender asks for, worked through: ${a(SAMPLE_PACK_LINK, "a sample Bid Draft Pack")}, with a compliance checklist, a response outline and first-draft answers, made from a public Australian Government tender document. It is a sample with an invented bidder, not a real bid.</p>`,
  });

  // Categories
  yield html({
    path: "categories/index.html",
    title: `Australian Government contracts by category (UNSPSC) | ${SITE_NAME}`,
    description: `Australian Government contracts in ${num(model.categories.length)} UNSPSC categories, with the number and value ending in the next 12 months.`,
    body: (a) => `<h1>Contracts by category</h1>
<p class="note">AusTender files every contract under a UNSPSC code. The notices give the code but not its official title, so next to each code this page shows the description that agencies most often wrote on contracts filed under it, where one recurs. It is a guide to what the code is used for, not the official name.</p>
<div class="scroll"><table>
<thead><tr><th>UNSPSC code</th><th>Most common description</th><th class="r">Contracts</th><th class="r">Ending in 12 months</th><th class="r">Value ending (AUD)</th></tr></thead>
<tbody>
${model.categories
  .map(
    (c) =>
      `<tr><td>${a(`category/${c.code}/`, c.code)}</td><td>${c.label ? esc(c.label) : "<small>varies by contract</small>"}</td><td class="r">${num(c.count)}</td><td class="r">${num(c.soonCount)}</td><td class="r nw">${money(c.soonValue)}</td></tr>`,
  )
  .join("\n")}
</tbody></table></div>`,
  });

  for (const c of model.categories) {
    const name = c.label ? `UNSPSC ${c.code}: ${c.label}` : `UNSPSC ${c.code}`;
    yield html({
      path: `category/${c.code}/index.html`,
      title: `${clip(name, 70)} | Australian Government contracts ending soon`,
      description: `${num(c.soonCount)} Australian Government contracts under UNSPSC ${c.code} end in the next 12 months, worth ${moneyShort(c.soonValue)}. Suppliers, agencies, values and end dates.`,
      body: (a) => `<p class="crumb">${a("categories/", "Categories")}</p>
<h1>UNSPSC ${c.code}</h1>
<p class="lead">${
        c.typical.length
          ? `Most common contract descriptions under this code: ${c.typical.map((t) => `“${esc(t)}”`).join(", ")}.`
          : "Contracts under this code are each described differently; see the list below."
      }</p>
${stats(c)}
${expiring(a, c.rows, ["end", "supplier", "agency", "what", "value"])}
${leaderTable(a, "Largest suppliers in this category", "Supplier", leaders(c.rows, supplierKey, 25), supplierLeader(a))}
${leaderTable(a, "Agencies buying in this category", "Agency", leaders(c.rows, (r) => r.agency, 25), agencyLeader(a))}
<p class="note">Counts and values cover the contracts held on this site. ${partial}</p>`,
    });
  }

  // Agencies
  yield html({
    path: "agencies/index.html",
    title: `Australian Government agencies and their contracts | ${SITE_NAME}`,
    description: `${num(model.agencies.length)} Australian Government agencies, with the number and value of their contracts ending in the next 12 months.`,
    body: (a) => `<h1>Contracts by agency</h1>
<div class="scroll"><table>
<thead><tr><th>Agency</th><th class="r">Contracts</th><th class="r">Ending in 12 months</th><th class="r">Value ending (AUD)</th></tr></thead>
<tbody>
${model.agencies
  .map(
    (g) =>
      `<tr><td>${a(`agency/${g.slug}/`, esc(g.name))}</td><td class="r">${num(g.count)}</td><td class="r">${num(g.soonCount)}</td><td class="r nw">${money(g.soonValue)}</td></tr>`,
  )
  .join("\n")}
</tbody></table></div>`,
  });

  for (const g of model.agencies) {
    yield html({
      path: `agency/${g.slug}/index.html`,
      title: `${clip(g.name, 60)}: contracts ending soon and largest suppliers | ${SITE_NAME}`,
      description: `${num(g.soonCount)} ${g.name} contracts end in the next 12 months, worth ${moneyShort(g.soonValue)}. Suppliers, categories, values and end dates.`,
      body: (a) => `<p class="crumb">${a("agencies/", "Agencies")}</p>
<h1>${esc(g.name)}</h1>
${stats(g)}
${expiring(a, g.rows, ["end", "supplier", "what", "category", "value"])}
${leaderTable(a, "Largest suppliers to this agency", "Supplier", leaders(g.rows, supplierKey, 25), supplierLeader(a))}
${leaderTable(a, "What this agency buys", "Category (UNSPSC code)", leaders(g.rows, (r) => r.code, 25), categoryLeader(a))}
<p class="note">Counts and values cover the contracts held on this site. ${partial}</p>`,
    });
  }

  // Suppliers
  const letters = new Map();
  for (const s of model.suppliers) {
    const l = letterOf(s.name);
    if (!letters.has(l)) letters.set(l, []);
    letters.get(l).push(s);
  }
  const letterKeys = [...letters.keys()].sort();
  const letterNav = (a, current) =>
    `<p class="letters">${letterKeys.map((l) => (l === current ? `<b>${l.toUpperCase()}</b>` : a(`suppliers/${l}/`, l.toUpperCase()))).join(" ")}</p>`;

  yield html({
    path: "suppliers/index.html",
    title: `Suppliers to the Australian Government, A to Z | ${SITE_NAME}`,
    description: `${num(model.suppliers.length)} suppliers with Australian Government contracts: what they supply, to which agencies, for how much, and when each contract ends.`,
    body: (a) => `<h1>Suppliers</h1>
<p class="note">${num(model.suppliers.length)} suppliers, listed by Australian Business Number. Contracts whose supplier has no ABN on the notice (mostly overseas suppliers) appear in the category and agency tables but have no supplier page.</p>
${letterNav(a, null)}
${leaderTable(
  a,
  "Suppliers with the most value ending in the next 12 months",
  "Supplier",
  top(model.suppliers, 50).map((s) => ({ key: s.abn, count: s.count, soonCount: s.soonCount, value: s.soonValue })),
  supplierLeader(a),
  "Value ending (AUD)",
)}`,
  });

  for (const l of letterKeys) {
    const list = letters.get(l);
    yield html({
      path: `suppliers/${l}/index.html`,
      title: `Suppliers to the Australian Government: ${l.toUpperCase()} | ${SITE_NAME}`,
      description: `${num(list.length)} suppliers to the Australian Government with names starting ${l.toUpperCase()}.`,
      body: (a) => `<p class="crumb">${a("suppliers/", "Suppliers")}</p>
<h1>Suppliers: ${l.toUpperCase()}</h1>
${letterNav(a, l)}
<div class="scroll"><table>
<thead><tr><th>Supplier</th><th class="r">Contracts</th><th class="r">Ending in 12 months</th><th class="r">Value (AUD)</th></tr></thead>
<tbody>
${list
  .map(
    (s) =>
      `<tr><td>${a(`supplier/${s.abn}/`, esc(s.name))}</td><td class="r">${num(s.count)}</td><td class="r">${num(s.soonCount)}</td><td class="r nw">${money(s.value)}</td></tr>`,
  )
  .join("\n")}
</tbody></table></div>`,
    });
  }

  for (const s of model.suppliers) {
    const shown = pick(s.rows, cap);
    const agencyCount = new Set(s.rows.map((r) => r.agency).filter(Boolean)).size;
    yield html({
      path: `supplier/${s.abn}/index.html`,
      title: `${clip(s.name, 60)}: Australian Government contracts | ${SITE_NAME}`,
      description: `${s.name} (ABN ${fmtAbn(s.abn)}): ${num(s.count)} Australian Government ${s.count === 1 ? "contract" : "contracts"} worth ${moneyShort(s.value)}, ${num(s.soonCount)} ending in the next 12 months.`,
      body: (a) => `<p class="crumb">${a("suppliers/", "Suppliers")} › ${a(`suppliers/${letterOf(s.name)}/`, letterOf(s.name).toUpperCase())}</p>
<h1>${esc(s.name)}</h1>
<p class="lead">ABN ${fmtAbn(s.abn)}${s.states.length ? ` · ${esc(s.states.join(", "))}` : ""} · supplies ${num(agencyCount)} ${agencyCount === 1 ? "agency" : "agencies"}</p>
${stats(s)}
<h2>Contracts</h2>
<p class="note">${
        s.rows.length > shown.length ? `The ${num(shown.length)} largest of ${num(s.rows.length)} contracts held here, in end-date order.` : `In end-date order.`
      } Values are the current total on the notice, including any amendments.</p>
${table(a, shown, ["end", "agency", "what", "category", "value", "start", "method"])}
<p class="note">${partial} A contract ending does not mean it will be re-tendered.</p>`,
    });
  }

  // About
  yield html({
    path: "about/index.html",
    title: `About this site and its data | ${SITE_NAME}`,
    description: `Where the contract data comes from, its licence, what the site covers and what to check before relying on it.`,
    body: (a) => `<h1>About this site</h1>
<p>This site lists Australian Government contracts by category, agency and supplier, with a view of the contracts due to end in the next 12 months. It is for businesses that sell to government, or want to, and need to see who holds what and when it runs out.</p>
<h2>Source and licence</h2>
<p>All contract data comes from contract notices published on <a href="${SOURCE_URL}" rel="noopener">AusTender</a>, the Australian Government's procurement information system, through its public contract-notice data service. The data is © Commonwealth of Australia (Department of Finance) and is used under the <a href="${LICENCE_URL}" rel="noopener license">Creative Commons Attribution 3.0 Australia</a> licence.</p>
<p>The figures here are derived from that data: notices are grouped, counted and summed, amendments are folded into their parent contract, and dates are shown as calendar dates in Canberra time. They may differ from the source. AusTender is the authoritative record, so check the original notice there before relying on anything shown here.</p>
<h2>Not a government site</h2>
<p>This site is independent. It is not affiliated with, or endorsed by, the Australian Government, the Department of Finance or AusTender.</p>
<h2>What is covered</h2>
<p>${coverage} ${partial} A supplier or agency page therefore shows current and recent contracts, not everything that supplier or agency has ever signed. State and territory government contracts are not included.</p>
<h2>How to read it</h2>
<ul>
<li><b>Values</b> are in Australian dollars as published on the notice. When a contract has been amended, the value is the new total, not the change.</li>
<li><b>End dates</b> are the dates on the notice. A contract ending does not mean it will be re-tendered: it may be extended, replaced through a panel or standing offer, or simply not renewed. A few notices carry end dates that cannot be right; those are left out of the “ending” counts.</li>
<li><b>Categories</b> are the UNSPSC codes on the notices. The notices do not give the official title of a code, so the site shows the description that agencies most often wrote on contracts under that code, where one recurs. It is a guide, not the official title.</li>
<li><b>Suppliers</b> are grouped by Australian Business Number, under the name most often used on their notices. Suppliers with no ABN on the notice have no page of their own.</li>
</ul>
<h2>The sample Bid Draft Pack</h2>
<p>The ${a(SAMPLE_PACK_LINK, "sample Bid Draft Pack")} is separate from the contract data. It was made from one public tender document released by the Department of Social Services under a Creative Commons Attribution 4.0 International licence, and it names that document and what was changed. The bidder in it is invented.</p>
<p>Data last updated ${fmtDate(updated)}.</p>`,
  });

  // A worked sample of a Bid Draft Pack, from one openly licensed tender document.
  yield html(samplePack(SITE_NAME));

  yield html({
    path: "404.html",
    title: `Page not found | ${SITE_NAME}`,
    description: "That page does not exist.",
    noindex: true,
    absolute: true,
    body: (a) => `<h1>Page not found</h1>
<p>That page does not exist, or the contract it covered is no longer held here. Try the ${a("categories/", "categories")}, ${a("agencies/", "agencies")} or ${a("suppliers/", "suppliers")}.</p>`,
  });

  if (siteUrl) {
    const urls = [...made].filter((p) => p.endsWith("index.html")).map((p) => `${siteUrl}/${p.replace(/index\.html$/, "")}`);
    yield {
      path: "sitemap.xml",
      body: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${esc(u)}</loc><lastmod>${updated}</lastmod></url>`).join("\n")}
</urlset>
`,
    };
  }
  if (opts.css) yield { path: "style.css", body: opts.css };

  // Every internal link must point at a page that was made.
  const broken = [...linked].filter((to) => !made.has(`${to}index.html`));
  yield { path: null, broken };
}

// ---------- command line ----------

// Which end dates the fetch has read in full, from its summary. The fetch asks
// for instants from..to, and a notice's end date is midnight in Canberra, so
// the first whole day is the day after the one `from` falls in.
export function coverageOf(summary) {
  const from = Date.parse(summary?.horizon?.from || "");
  const to = Date.parse(summary?.horizon?.fetchedTo || "");
  if (!summary?.horizon?.complete || !Number.isFinite(from) || !Number.isFinite(to)) return {};
  const startedAt = Date.parse(summary.datasetStarted || "");
  const publishedDays = Number(summary.settings?.PUBLISHED_DAYS);
  return {
    endFrom: addDays(localDate(new Date(from - 1).toISOString()), 1),
    endTo: localDate(new Date(to - 1).toISOString()),
    publishedFrom:
      Number.isFinite(startedAt) && Number.isFinite(publishedDays) ? localDate(new Date(startedAt - publishedDays * DAY).toISOString()) : null,
  };
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const started = Date.now();
  const out = process.env.SITE_DIR || "site";
  const siteUrl = process.env.SITE_URL || "https://wattlebay-labs.github.io/govcontracts";
  const records = await readJson("data/contracts.json");
  if (!Array.isArray(records) || records.length === 0) {
    console.error("No dataset at data/contracts.json: nothing to build");
    process.exit(1);
  }
  const summary = (await readJson("data/summary.json")) || {};
  const nowMs = process.env.BUILD_NOW ? Date.parse(process.env.BUILD_NOW) : Date.now();
  const model = analyse(records, nowMs);

  const coverage = coverageOf(summary);

  await rm(out, { recursive: true, force: true });
  const css = await readFile(new URL("./style.css", import.meta.url), "utf8");
  const counts = { total: 0, home: 0, category: 0, agency: 0, supplier: 0, index: 0, other: 0 };
  const kind = (path) =>
    path === "index.html"
      ? "home"
      : /^(category|agency|supplier)\//.test(path)
        ? path.split("/")[0]
        : /^(categories|agencies|suppliers)\//.test(path)
          ? "index"
          : "other";
  let bytes = 0;
  let largest = { path: null, bytes: 0 };
  let broken = [];
  const dirs = new Set();
  let pending = [];
  for (const file of pages(model, { siteUrl, updated: summary.generatedAt, coverage, css })) {
    if (file.path === null) {
      broken = file.broken;
      continue;
    }
    const target = join(out, file.path);
    const dir = dirname(target);
    if (!dirs.has(dir)) {
      await mkdir(dir, { recursive: true });
      dirs.add(dir);
    }
    const size = Buffer.byteLength(file.body);
    bytes += size;
    if (file.path.endsWith(".html")) {
      counts.total++;
      counts[kind(file.path)]++;
      if (size > largest.bytes) largest = { path: file.path, bytes: size };
    }
    pending.push(writeFile(target, file.body));
    if (pending.length >= 64) {
      await Promise.all(pending);
      pending = [];
    }
  }
  await Promise.all(pending);

  const top = (list, n) => [...list].sort((a, b) => b.soonValue - a.soonValue).slice(0, n);
  const build = {
    generatedAt: new Date().toISOString().slice(0, 19) + "Z",
    dataUpdated: summary.generatedAt || null,
    siteUrl,
    today: model.today,
    pages: counts,
    directories: dirs.size,
    bytes,
    largestPage: largest,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    records: records.length,
    contracts: model.totals,
    suppliers: model.suppliers.length,
    agencies: model.agencies.length,
    categories: model.categories.length,
    skipped: model.skipped,
    brokenLinks: broken.length,
    brokenLinkSamples: broken.slice(0, 10),
    months: model.months,
    categoriesWithLabel: model.categories.filter((c) => c.label).length,
    topCategories: top(model.categories, 10).map((c) => ({ code: c.code, label: c.label, typical: c.typical, count: c.count, soonCount: c.soonCount, soonValue: Math.round(c.soonValue) })),
    topAgencies: top(model.agencies, 5).map((g) => ({ name: g.name, slug: g.slug, count: g.count, soonCount: g.soonCount, soonValue: Math.round(g.soonValue) })),
  };
  await writeFile("data/build.json", JSON.stringify(build, null, 2) + "\n");
  // A stamp inside the site, so a check after a deploy can tell which build
  // the live address is serving.
  await writeFile(join(out, "build.json"), JSON.stringify({ generatedAt: build.generatedAt, dataUpdated: build.dataUpdated, pages: counts }) + "\n");
  console.log(JSON.stringify(build, null, 2));

  if (broken.length) {
    console.error(`${broken.length} internal links point at pages that were not built`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  await main();
}
