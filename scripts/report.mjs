// Make category reports from the dataset the fetch step keeps
// (data/contracts.json): for one UNSPSC code, every contract held under it,
// with its suppliers and its agencies, as files a spreadsheet program opens.
//
// A report is a folder, unspsc-<code>/, of four files:
//   unspsc-<code>-contracts.csv   one row per contract, in end-date order
//   unspsc-<code>-suppliers.csv   one row per supplier, largest total value first
//   unspsc-<code>-agencies.csv    one row per agency, largest total value first
//   unspsc-<code>-read-me.txt     what the report covers, how to read it, the source
// Every row names the source and its licence, so the credit stays with the
// data when a file is passed on without the others.
//
// Run:
//   node scripts/report.mjs 80100000 43230000   reports for those codes
//   node scripts/report.mjs --all               every code; also writes data/report.json
// Settings (environment):
//   REPORT_DIR    where the report folders go (default: reports)
//   REPORT_CODES  more codes, separated by spaces or commas
//   REPORT_NOW    fixes "today" (an ISO time), for repeatable output
// Each report is read back from its own text and compared with the dataset
// before the run reports success; a report that does not add up fails the run.
// Reports are never written into the site folder: they are not web pages.
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import {
  LICENCE_URL,
  PARTIAL,
  SITE_NAME,
  SOURCE_URL,
  UNSPSC_OWNER,
  addDays,
  analyse,
  commonest,
  coverageOf,
  coverageText,
  fmtDate,
  loadTitles,
  localDate,
  money,
  num,
} from "./build.mjs";

export const CREDIT = "AusTender contract notices, Department of Finance, CC BY 3.0 AU";

// ---------- CSV ----------

// Text that a spreadsheet program would run as a formula if it began a cell.
const FORMULA_START = /^[=+\-@\t\r]/;

// One cell. Numbers are written bare. Text that begins like a formula gets an
// apostrophe in front, which spreadsheet programs show as plain text.
export function cell(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  let s = String(v);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

// A whole file: byte-order mark (so Excel reads it as UTF-8), a header row,
// CRLF line ends.
export const csv = (header, rows) => `\uFEFF${[header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;

// Read CSV text back into rows of strings (RFC 4180: quoted cells, doubled
// quotes, line breaks inside quotes).
export function parseCsv(text) {
  const s = String(text).replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"' && cur === "") quoted = true;
    else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += ch;
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

// ---------- one report ----------

const cents = (n) => Math.round(n * 100) / 100;
// Totals add the values as the report prints them (to the cent), so a file's
// rows always add up to its totals.
const sum = (rows) => cents(rows.reduce((s, r) => s + cents(r.value || 0), 0));
const byValue = (a, b) => b.value - a.value || b.count - a.count || (a.key < b.key ? -1 : 1);

const STATUS = {
  ended: "Ended",
  soon: "Ends within 12 months",
  later: "Ends later",
  none: "End date not stated",
};
const statusOf = (row, today) => (!row.end ? STATUS.none : row.end < today ? STATUS.ended : row.soon ? STATUS.soon : STATUS.later);

export const HEADERS = {
  contracts: [
    "Contract notice",
    "Amended",
    "Agency",
    "Supplier",
    "Supplier ABN",
    "Supplier state",
    "Supplier name on the notice",
    "Description",
    "Value (AUD)",
    "Start date",
    "End date",
    "Status",
    "Procurement method",
    "UNSPSC code",
    "Source and licence",
  ],
  suppliers: [
    "Supplier",
    "Supplier ABN",
    "Supplier state",
    "Contracts",
    "Total value (AUD)",
    "Contracts ending within 12 months",
    "Value ending within 12 months (AUD)",
    "Next end date",
    "Last end date",
    "Agencies",
    "Agency names",
    "Source and licence",
  ],
  agencies: [
    "Agency",
    "Contracts",
    "Total value (AUD)",
    "Contracts ending within 12 months",
    "Value ending within 12 months (AUD)",
    "Next end date",
    "Last end date",
    "Suppliers",
    "Largest supplier by value",
    "Source and licence",
  ],
};

// Group rows and total each group. `nameOf(key, rows)` gives the group's name.
function groups(rows, keyOf, today) {
  const map = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    let g = map.get(key);
    if (!g) map.set(key, (g = { key, rows: [] }));
    g.rows.push(row);
  }
  for (const g of map.values()) {
    const soon = g.rows.filter((r) => r.soon);
    const ends = g.rows.map((r) => r.end).filter(Boolean).sort();
    g.count = g.rows.length;
    g.value = sum(g.rows);
    g.soonCount = soon.length;
    g.soonValue = sum(soon);
    g.nextEnd = ends.find((e) => e >= today) || null;
    g.lastEnd = ends.length ? ends[ends.length - 1] : null;
  }
  return [...map.values()].sort(byValue);
}

const NOT_STATED = "Not stated";
const supplierKey = (r) => r.abn || `name:${(r.supplier || "").toLowerCase()}`;

// The report for one category of the model `analyse` makes. `opts`:
//   dataDate   YYYY-MM-DD the data was last fetched (default: the model's today)
//   coverage   what `coverageOf` returns, for the sentence on what is held
// Returns null when the dataset holds nothing under the code.
export function categoryReport(model, code, opts = {}) {
  const category = (opts.byCode || new Map(model.categories.map((c) => [c.code, c]))).get(String(code));
  if (!category) return null;
  const today = model.today;
  const dataDate = opts.dataDate || today;
  const titles = model.titles || null;
  const rows = category.rows;
  const lastDay = addDays(model.horizon, -1);

  const derived = `Derived from ${CREDIT}; data as at ${dataDate}; may differ from the source`;
  // One name per supplier, the same in all three files: the usual name for
  // the ABN, or, with no ABN, the most common spelling among these contracts.
  const supplierGroups = groups(rows, supplierKey, today);
  const nameOfKey = new Map(
    supplierGroups.map((g) => [g.key, (g.rows[0].abn ? model.supplierName.get(g.key) : commonest(g.rows.map((r) => r.supplier), 1)[0]) || NOT_STATED]),
  );
  const supplierName = (r) => nameOfKey.get(supplierKey(r));

  const contracts = rows.map((r) => [
    r.id,
    r.amended ? "Yes" : "No",
    r.agency || NOT_STATED,
    supplierName(r),
    r.abn || "",
    r.state || "",
    r.supplier || "",
    r.description || "",
    r.value === null ? "" : cents(r.value),
    r.start || "",
    r.end || "",
    statusOf(r, today),
    r.method || "",
    r.code,
    `AusTender contract notice ${r.id}, Department of Finance, CC BY 3.0 AU; data as at ${dataDate}; may differ from the source`,
  ]);

  const suppliers = supplierGroups.map((g) => {
    const agencies = [...new Set(g.rows.map((r) => r.agency).filter(Boolean))].sort((a, b) => a.localeCompare(b, "en"));
    const states = [...new Set(g.rows.map((r) => r.state).filter(Boolean))].sort();
    return [nameOfKey.get(g.key), g.rows[0].abn || "", states.join(", "), g.count, g.value, g.soonCount, g.soonValue, g.nextEnd || "", g.lastEnd || "", agencies.length, agencies.join("; "), derived];
  });

  const agencyGroups = groups(rows, (r) => r.agency || NOT_STATED, today);
  const agencies = agencyGroups.map((g) => {
    const inside = groups(g.rows, supplierKey, today);
    return [g.key, g.count, g.value, g.soonCount, g.soonValue, g.nextEnd || "", g.lastEnd || "", inside.length, nameOfKey.get(inside[0].key), derived];
  });

  const soon = rows.filter((r) => r.soon);
  const totals = {
    contracts: rows.length,
    value: sum(rows),
    soonCount: soon.length,
    soonValue: sum(soon),
    suppliers: suppliers.length,
    agencies: agencies.length,
    noAbn: rows.filter((r) => !r.abn).length,
    noEnd: rows.filter((r) => !r.end).length,
    ended: rows.filter((r) => r.end && r.end < today).length,
  };

  const base = `unspsc-${category.code}`;
  const names = {
    contracts: `${base}-contracts.csv`,
    suppliers: `${base}-suppliers.csv`,
    agencies: `${base}-agencies.csv`,
    readme: `${base}-read-me.txt`,
  };

  // The read-me starts with a byte-order mark too, so that an older Windows
  // text editor reads accented letters in it correctly.
  const readme = [
    `\uFEFFCATEGORY REPORT: UNSPSC ${category.code}`,
    ...(category.title ? [category.title] : []),
    `Australian Government contracts filed under this code on AusTender.`,
    ``,
    `Made ${fmtDate(today)} from data last updated ${fmtDate(dataDate)}.`,
    ``,
    `WHAT THE CODE COVERS`,
    category.title
      ? `AusTender files every contract under a UNSPSC code. The title of this code is "${category.title}", as given in the ${titles.name} (${titles.publisher}).`
      : titles
        ? `AusTender files every contract under a UNSPSC code. This code is not in the ${titles.name} (${titles.publisher}), which this report takes titles from, so it is shown by its number.`
        : `AusTender files every contract under a UNSPSC code. The notices give the code but not its official title.`,
    category.typical.length
      ? `Agencies most often described contracts under this code as: ${category.typical.map((t) => `"${t}"`).join(", ")}. That is a guide to what the code is used for, not the official title.`
      : `Contracts under this code are each described differently, so no description stands for the code: see the Description column.`,
    ``,
    `WHAT IS IN THIS REPORT`,
    `  ${names.contracts}   ${num(totals.contracts)} ${totals.contracts === 1 ? "contract" : "contracts"}, one row each, in end-date order`,
    `  ${names.suppliers}   ${num(totals.suppliers)} ${totals.suppliers === 1 ? "supplier" : "suppliers"}, largest total value first`,
    `  ${names.agencies}    ${num(totals.agencies)} ${totals.agencies === 1 ? "agency" : "agencies"}, largest total value first`,
    `Total value as published: ${money(totals.value)}.`,
    `${num(totals.soonCount)} ${totals.soonCount === 1 ? "contract ends" : "contracts end"} between ${fmtDate(today)} and ${fmtDate(lastDay)} ("within 12 months"), worth ${money(totals.soonValue)}.`,
    ``,
    `WHAT IS COVERED`,
    `This report is made from a dataset of AusTender contract notices. ${coverageText(opts.coverage)} ${PARTIAL}`,
    `So a supplier or agency row shows current and recent contracts under this code, not every contract ever signed. State and territory government contracts are not included.`,
    ``,
    `HOW TO READ IT`,
    `- Values are in Australian dollars as published on the notice. When a contract has been amended ("Amended: Yes"), the value is the new total, not the change.`,
    `- Dates are calendar dates in Canberra, written year-month-day. An empty date was not stated on the notice, or could not be right (a few notices carry dates such as 1900-01-01).`,
    `- Status is worked out on ${fmtDate(today)}: "${STATUS.ended}", "${STATUS.soon}", "${STATUS.later}" or "${STATUS.none}".`,
    `- A contract ending does not mean it will be re-tendered: it may be extended, replaced through a panel or standing offer, or not renewed.`,
    `- Suppliers are grouped by Australian Business Number, under the name most often used on their notices; the name on each notice is kept in its own column. A supplier with no ABN on the notice (mostly overseas suppliers) is grouped by name and its ABN is left empty.`,
    `- Where text on a notice begins with =, +, - or @, an apostrophe has been put in front so that a spreadsheet program shows it as text.`,
    `- The files are comma-separated text (UTF-8), which spreadsheet programs such as Excel open.`,
    ``,
    `SOURCE AND LICENCE`,
    `Data: ${CREDIT}.`,
    `Source: ${SOURCE_URL}   Licence: ${LICENCE_URL}`,
    `The data is (c) Commonwealth of Australia (Department of Finance), used under the Creative Commons Attribution 3.0 Australia licence.`,
    `Figures in this report are derived from that data and may differ from the source: notices are grouped, counted and summed, and amendments are folded into their parent contract. AusTender is the authoritative record, so check the original notice there before relying on anything in this report.`,
    ...(titles
      ? [`Category title: ${titles.name}, ${titles.publisher}, ${titles.licence}${titles.href ? `, ${titles.href}` : ""}. ${UNSPSC_OWNER}.`]
      : []),
    ``,
    `NOT A GOVERNMENT DOCUMENT`,
    `This report is independent. It is not affiliated with, or endorsed by, the Australian Government, the Department of Finance or AusTender.`,
    `It is information, not advice, and nothing in it is a promise that any contract will be re-tendered or that any tender will be won.`,
    ``,
    `Made by ${SITE_NAME}.`,
    ``,
  ].join("\r\n");

  return {
    code: category.code,
    title: category.title || null,
    label: category.label,
    typical: category.typical,
    today,
    dataDate,
    totals,
    folder: base,
    files: [
      { name: names.contracts, body: csv(HEADERS.contracts, contracts) },
      { name: names.suppliers, body: csv(HEADERS.suppliers, suppliers) },
      { name: names.agencies, body: csv(HEADERS.agencies, agencies) },
      { name: names.readme, body: readme },
    ],
  };
}

// What every read-me must say, as it appears in the text.
export const README_MUST_SAY = [
  ["source credit", /AusTender contract notices, Department of Finance, CC BY 3\.0 AU/],
  ["licence address", /creativecommons\.org\/licenses\/by\/3\.0\/au\//],
  ["derived-data statement", /derived from that data and may differ from the source/],
  ["not-affiliated statement", /not affiliated with, or endorsed by, the Australian Government/],
  ["no-promise statement", /nothing in it is a promise/],
  ["partial-history statement", /not a full history/],
];

// Read a finished report back from its own text and compare it with the rows
// it was made from. Returns a list of what is wrong; empty when it adds up.
export function checkReport(report, model, opts = {}) {
  const problems = [];
  const category = (opts.byCode || new Map(model.categories.map((c) => [c.code, c]))).get(report.code);
  if (!category) return [`no category ${report.code} in the dataset`];
  const want = { count: category.rows.length, value: sum(category.rows), soonCount: category.rows.filter((r) => r.soon).length };
  const file = (suffix) => report.files.find((f) => f.name.endsWith(suffix));
  const near = (a, b) => Math.abs(a - b) < 0.005 + 1e-9 * Math.max(Math.abs(a), Math.abs(b));

  const table = (suffix, header) => {
    const f = file(suffix);
    if (!f) {
      problems.push(`${suffix}: file is missing`);
      return null;
    }
    if (!f.body.startsWith("\uFEFF")) problems.push(`${f.name}: no byte-order mark`);
    const rows = parseCsv(f.body);
    if (JSON.stringify(rows[0]) !== JSON.stringify(header)) problems.push(`${f.name}: header row is not the expected one`);
    const body = rows.slice(1);
    const ragged = body.findIndex((r) => r.length !== header.length);
    if (ragged >= 0) problems.push(`${f.name}: row ${ragged + 2} has ${body[ragged].length} cells, not ${header.length}`);
    const uncredited = body.findIndex((r) => !/AusTender contract notice.*Department of Finance, CC BY 3\.0 AU/.test(r[r.length - 1] || ""));
    if (uncredited >= 0) problems.push(`${f.name}: row ${uncredited + 2} does not credit the source`);
    return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
  };
  const add = (rows, col) => cents(rows.reduce((s, r) => s + Number(r[col] || 0), 0));

  const contracts = table("-contracts.csv", HEADERS.contracts);
  if (contracts) {
    if (contracts.length !== want.count) problems.push(`contracts: ${contracts.length} rows, the dataset holds ${want.count}`);
    const ids = new Set(contracts.map((r) => r["Contract notice"]));
    if (ids.size !== contracts.length) problems.push(`contracts: a contract notice appears twice`);
    for (const r of category.rows) if (!ids.has(r.id) && !ids.has(`'${r.id}`)) problems.push(`contracts: ${r.id} is missing`);
    if (!near(add(contracts, "Value (AUD)"), want.value)) problems.push(`contracts: values add to ${add(contracts, "Value (AUD)")}, the dataset says ${want.value}`);
    const soon = contracts.filter((r) => r.Status === STATUS.soon).length;
    if (soon !== want.soonCount) problems.push(`contracts: ${soon} rows end within 12 months, the dataset says ${want.soonCount}`);
    if (contracts.some((r) => r["UNSPSC code"] !== report.code)) problems.push(`contracts: a row is filed under another code`);
    const badDate = contracts.find((r) => [r["Start date"], r["End date"]].some((d) => d && !/^\d{4}-\d{2}-\d{2}$/.test(d)));
    if (badDate) problems.push(`contracts: ${badDate["Contract notice"]} has a date that is not year-month-day`);
    const ends = contracts.map((r) => r["End date"]);
    const dated = ends.filter(Boolean);
    if (dated.some((d, i) => i > 0 && d < dated[i - 1]) || ends.some((d, i) => d && i > 0 && !ends[i - 1])) problems.push(`contracts: rows are not in end-date order`);
  }
  for (const [suffix, header, what] of [
    ["-suppliers.csv", HEADERS.suppliers, "suppliers"],
    ["-agencies.csv", HEADERS.agencies, "agencies"],
  ]) {
    const rows = table(suffix, header);
    if (!rows) continue;
    if (rows.length !== report.totals[what]) problems.push(`${what}: ${rows.length} rows, the report counted ${report.totals[what]}`);
    if (add(rows, "Contracts") !== want.count) problems.push(`${what}: contracts add to ${add(rows, "Contracts")}, the dataset holds ${want.count}`);
    if (!near(add(rows, "Total value (AUD)"), want.value)) problems.push(`${what}: values add to ${add(rows, "Total value (AUD)")}, the dataset says ${want.value}`);
    if (add(rows, "Contracts ending within 12 months") !== want.soonCount) problems.push(`${what}: contracts ending add to ${add(rows, "Contracts ending within 12 months")}, the dataset says ${want.soonCount}`);
    const values = rows.map((r) => Number(r["Total value (AUD)"]));
    if (values.some((v, i) => i > 0 && v > values[i - 1])) problems.push(`${what}: rows are not in value order`);
  }
  const readme = file("-read-me.txt");
  if (!readme) problems.push("read-me: file is missing");
  else {
    for (const [what, pattern] of README_MUST_SAY) if (!pattern.test(readme.body)) problems.push(`read-me: ${what} is missing`);
    if (!readme.body.includes(`UNSPSC ${report.code}`)) problems.push("read-me: the code is missing");
    // A title is only ever the codeset's own, and never goes out without its credit.
    if ((category.title || null) !== (report.title || null)) problems.push("read-me: the title is not the one the codeset gives this code");
    if (category.title && !readme.body.includes(`"${category.title}"`)) problems.push("read-me: the title is missing");
    if (model.titles && !(readme.body.includes(`Category title: ${model.titles.name}, ${model.titles.publisher}`) && readme.body.includes("United Nations Development Programme")))
      problems.push("read-me: the credit for the category title is missing");
  }
  return problems;
}

// ---------- command line ----------

// Codes named on the command line and in REPORT_CODES. Throws on anything
// that is not an 8-digit code, so nothing else can reach a file name.
export function codesFrom(args, env = "") {
  const words = [...args, ...String(env || "").split(/[\s,]+/)].map((w) => w.trim()).filter(Boolean);
  const bad = words.filter((w) => !/^\d{8}$/.test(w));
  if (bad.length) throw new Error(`Not a UNSPSC code (8 digits): ${bad.map((w) => JSON.stringify(w.slice(0, 20))).join(", ")}`);
  return [...new Set(words)];
}

// Reports are files to hand over, not web pages: refuse to put them where the
// site is built.
export function outsideSite(out, siteDir = "site") {
  const o = resolve(out);
  const s = resolve(siteDir);
  return o !== s && !o.startsWith(s + sep) && !s.startsWith(o + sep);
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

const sizeOf = (report) => report.files.reduce((s, f) => s + Buffer.byteLength(f.body), 0);

async function writeReport(out, report) {
  const dir = join(out, report.folder);
  await mkdir(dir, { recursive: true });
  await Promise.all(report.files.map((f) => writeFile(join(dir, f.name), f.body)));
}

// How big the categories are, as a count of codes per number of contracts.
export function sizeBands(counts) {
  const bands = [
    ["1 to 9", 1, 9],
    ["10 to 49", 10, 49],
    ["50 to 199", 50, 199],
    ["200 to 999", 200, 999],
    ["1,000 or more", 1000, Infinity],
  ];
  return bands.map(([contracts, lo, hi]) => ({ contracts, categories: counts.filter((n) => n >= lo && n <= hi).length }));
}

async function main() {
  const started = Date.now();
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const out = process.env.REPORT_DIR || "reports";
  const summaryPath = "data/report.json";
  const stamp = () => new Date().toISOString().slice(0, 19) + "Z";
  const fail = async (message, code = 1) => {
    console.error(message);
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=Category reports::${message.replace(/\r?\n/g, " ")}`);
    if (all) await writeFile(summaryPath, JSON.stringify({ generatedAt: stamp(), ok: false, problems: [message] }, null, 2) + "\n").catch(() => {});
    process.exit(code);
  };

  let codes;
  try {
    codes = codesFrom(args.filter((a) => a !== "--all"), process.env.REPORT_CODES);
  } catch (err) {
    return fail(err.message, 2);
  }
  if (!all && !codes.length) return fail("Name one or more UNSPSC codes (8 digits), or --all", 2);
  if (!outsideSite(out, process.env.SITE_DIR || "site")) return fail(`Reports are not written into the site folder: ${out}`, 2);

  const records = await readJson("data/contracts.json");
  if (!Array.isArray(records) || records.length === 0) return fail("No dataset at data/contracts.json: nothing to report on");
  const summary = (await readJson("data/summary.json")) || {};
  const state = (await readJson("data/state.json")) || {};
  const nowMs = process.env.REPORT_NOW ? Date.parse(process.env.REPORT_NOW) : Date.now();
  const loaded = await loadTitles();
  const titles = loaded && loaded.map ? loaded : null;
  const model = analyse(records, nowMs, { titles });
  const updated = state.updatedAt || summary.generatedAt || null;
  const byCode = new Map(model.categories.map((c) => [c.code, c]));
  const opts = { byCode, dataDate: localDate(updated) || model.today, coverage: coverageOf(summary) };

  if (all) codes = model.categories.map((c) => c.code);
  const missing = codes.filter((c) => !byCode.has(c));
  if (missing.length) return fail(`No contracts are held under: ${missing.join(", ")}. Nothing was written.`);

  const made = [];
  const problems = [];
  for (const code of codes) {
    const report = categoryReport(model, code, opts);
    const wrong = checkReport(report, model, opts);
    if (wrong.length) {
      problems.push(...wrong.slice(0, 5).map((p) => `${code}: ${p}`));
      continue; // a report that does not add up is not written
    }
    await writeReport(out, report);
    made.push({ code, title: report.title, label: report.label, ...report.totals, bytes: sizeOf(report) });
  }
  const seconds = Math.round((Date.now() - started) / 100) / 10;

  if (all) {
    const bySize = [...made].sort((a, b) => b.contracts - a.contracts || (a.code < b.code ? -1 : 1));
    const counts = bySize.map((r) => r.contracts);
    const brief = (r) => r && { code: r.code, title: r.title, label: r.label, contracts: r.contracts, suppliers: r.suppliers, agencies: r.agencies, value: Math.round(r.value), soonCount: r.soonCount, bytes: r.bytes };
    const result = {
      generatedAt: stamp(),
      dataUpdated: updated,
      today: model.today,
      ok: problems.length === 0,
      problems: problems.slice(0, 20),
      problemCount: problems.length,
      categories: model.categories.length,
      reports: made.length,
      reportsWithTitle: made.filter((r) => r.title).length,
      files: made.length * 4,
      bytes: made.reduce((s, r) => s + r.bytes, 0),
      seconds,
      contractsInReports: made.reduce((s, r) => s + r.contracts, 0),
      medianContracts: counts.length ? counts[Math.floor(counts.length / 2)] : 0,
      categoriesBySize: sizeBands(counts),
      largest: bySize.slice(0, 10).map(brief),
      smallest: brief(bySize[bySize.length - 1]) || null,
    };
    await writeFile(summaryPath, JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(JSON.stringify({ out, seconds, dataUpdated: updated, reports: made, problems }, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY && made.length) {
      const lines = [
        `### Category reports made`,
        ``,
        `| UNSPSC code | Contracts | Suppliers | Agencies | Ending within 12 months | Size |`,
        `|---|---:|---:|---:|---:|---:|`,
        ...made.map((r) => `| ${r.code} | ${num(r.contracts)} | ${num(r.suppliers)} | ${num(r.agencies)} | ${num(r.soonCount)} | ${num(Math.round(r.bytes / 1024))} KB |`),
        ``,
        `Data last updated ${fmtDate(opts.dataDate)}. Made in ${seconds} seconds. The files are in this run's artifact.`,
        ``,
      ];
      await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join("\n")).catch(() => {});
    }
  }

  if (problems.length) {
    const message = `${problems.length} problems in the reports, e.g. ${problems[0]}`;
    console.error(message);
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=Category reports::${message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  await main();
}
