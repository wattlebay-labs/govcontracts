// Run with: node --test scripts/report.test.mjs
// All records here are made up.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyse, coverageOf, titlesOf } from "./build.mjs";
import { HEADERS, README_MUST_SAY, categoryReport, cell, checkReport, codesFrom, csv, outsideSite, parseCsv, sizeBands } from "./report.mjs";

const NOW = Date.parse("2026-11-19T08:00:00Z"); // 19 Nov 2026, evening in Canberra
const SCRIPT = fileURLToPath(new URL("./report.mjs", import.meta.url));

const rec = (over = {}) => ({
  id: "CN0000001",
  notice: "CN0000001",
  released: "2026-11-01T00:00:00Z",
  description: "Example services",
  agency: "Department of Examples",
  agencyAbn: "22222222222",
  division: null,
  supplier: "EXAMPLE PTY LTD",
  supplierAbn: "11111111111",
  supplierState: "NSW",
  value: 1000,
  start: "2026-06-30T14:00:00Z",
  end: "2027-06-29T14:00:00Z",
  unspsc: "80101500",
  method: "Open tender",
  amendment: false,
  ...over,
});

const sample = [
  rec(), // ends 30 Jun 2027
  rec({ id: "CN0000002", supplier: "Example Pty Ltd", value: 5000.1, end: "2026-12-30T13:00:00Z", amendment: true }),
  rec({ id: "CN0000003", supplier: "Example Pty Ltd", value: 250.55, end: "2026-11-01T13:00:00Z" }), // already ended
  rec({ id: "CN0000004", supplier: "Overseas Co", supplierAbn: null, supplierState: null, value: 70000, agency: "Bureau of Samples" }),
  rec({ id: "CN0000005", supplier: "overseas co", supplierAbn: null, supplierState: null, value: 30000, agency: "Bureau of Samples", end: "2028-01-01T13:00:00Z" }), // beyond 12 months
  rec({ id: "CN0000006", supplier: '=HYPERLINK("http://example.org","x")', supplierAbn: "33 333 333 333", supplierState: "VIC", description: 'Tables, "large", and chairs', value: 12.3 }),
  rec({ id: "CN0000007", supplier: "Other & Sons", supplierAbn: "44444444444", end: "1900-01-01T00:00:00Z", value: null, description: "+61 phone line" }),
  rec({ id: "CN0000008", supplier: "Élan Consulting", supplierAbn: "55555555555", description: null, end: null, start: null, method: null }),
  rec({ id: "CN0000009", unspsc: "43230000", supplier: "Software Co", supplierAbn: "66666666666", value: 999 }),
];

const model = () => analyse(sample, NOW);
// The same records with a made-up titles file, as make-titles.mjs would write it.
const TITLES = {
  source: {
    file: "Made-up Customised UNSPSC Codeset 1 July 2023.xlsx",
    publisher: "Department of Made-up Things",
    datasetUrl: "https://data.gov.au/data/dataset/made-up",
    licenceId: "cc-by",
    licence: "Creative Commons Attribution 3.0 Australia",
    licenceUrl: "http://creativecommons.org/licenses/by/3.0/au/",
  },
  titles: { 80101500: "Made-up advisory services" },
};
const titledModel = () => analyse(sample, NOW, { titles: titlesOf(TITLES) });
const make = (code = "80101500", opts = {}) => categoryReport(model(), code, { dataDate: "2026-11-19", ...opts });
const table = (report, suffix) => {
  const rows = parseCsv(report.files.find((f) => f.name.endsWith(suffix)).body);
  return rows.slice(1).map((r) => Object.fromEntries(rows[0].map((h, i) => [h, r[i]])));
};
const readme = (report) => report.files.find((f) => f.name.endsWith("-read-me.txt")).body;

test("cells are quoted when they need it and never start a formula", () => {
  assert.equal(cell("plain"), "plain");
  assert.equal(cell("a,b"), '"a,b"');
  assert.equal(cell('say "hi"'), '"say ""hi"""');
  assert.equal(cell("two\nlines"), '"two\nlines"');
  assert.equal(cell(" padded "), '" padded "');
  assert.equal(cell(null), "");
  assert.equal(cell(undefined), "");
  assert.equal(cell(1234.5), "1234.5");
  assert.equal(cell(0), "0");
  assert.equal(cell(NaN), "");
  assert.equal(cell("=SUM(A1)"), "'=SUM(A1)");
  assert.equal(cell("+61 2 0000 0000"), "'+61 2 0000 0000");
  assert.equal(cell("-10% uplift"), "'-10% uplift");
  assert.equal(cell("@cmd"), "'@cmd");
  assert.equal(cell('=A1,"x"'), `"'=A1,""x"""`);
  assert.equal(cell("2027-06-30"), "2027-06-30");
});

test("a file reads back as the rows it was written from", () => {
  const rows = [
    ["a", "b,c", 'd "e"', "f\r\ng", "", 12.5, null],
    ["Élan", " x ", "last", "", "", 0, "end"],
  ];
  const text = csv(["h1", "h2", "h3", "h4", "h5", "h6", "h7"], rows);
  assert.ok(text.startsWith("\uFEFF"));
  assert.ok(text.endsWith("\r\n"));
  assert.deepEqual(parseCsv(text), [
    ["h1", "h2", "h3", "h4", "h5", "h6", "h7"],
    ["a", "b,c", 'd "e"', "f\r\ng", "", "12.5", ""],
    ["Élan", " x ", "last", "", "", "0", "end"],
  ]);
  assert.deepEqual(parseCsv("a,b\nc,d"), [["a", "b"], ["c", "d"]]);
  assert.deepEqual(parseCsv(""), []);
});

test("a report has four files named after its code", () => {
  const report = make();
  assert.equal(report.folder, "unspsc-80101500");
  assert.deepEqual(
    report.files.map((f) => f.name),
    ["unspsc-80101500-contracts.csv", "unspsc-80101500-suppliers.csv", "unspsc-80101500-agencies.csv", "unspsc-80101500-read-me.txt"],
  );
  assert.equal(categoryReport(model(), "99999999"), null);
});

test("contracts: every contract under the code, once, in end-date order", () => {
  const rows = table(make(), "-contracts.csv");
  assert.deepEqual(Object.keys(rows[0]), HEADERS.contracts);
  assert.deepEqual(
    rows.map((r) => r["Contract notice"]),
    ["CN0000003", "CN0000002", "CN0000001", "CN0000004", "CN0000006", "CN0000005", "CN0000007", "CN0000008"],
  );
  assert.ok(!rows.some((r) => r["Contract notice"] === "CN0000009")); // another code
  const by = Object.fromEntries(rows.map((r) => [r["Contract notice"], r]));
  assert.equal(by.CN0000001["End date"], "2027-06-30"); // the Canberra calendar date
  assert.equal(by.CN0000001["Start date"], "2026-07-01");
  assert.equal(by.CN0000001.Status, "Ends within 12 months");
  assert.equal(by.CN0000003.Status, "Ended");
  assert.equal(by.CN0000005.Status, "Ends later");
  assert.equal(by.CN0000008.Status, "End date not stated");
  assert.equal(by.CN0000002.Amended, "Yes");
  assert.equal(by.CN0000001.Amended, "No");
  assert.equal(by.CN0000002["Value (AUD)"], "5000.1");
  assert.equal(by.CN0000001["Supplier ABN"], "11111111111");
  assert.equal(by.CN0000001["UNSPSC code"], "80101500");
  assert.match(by.CN0000001["Source and licence"], /^AusTender contract notice CN0000001, Department of Finance, CC BY 3\.0 AU; data as at 2026-11-19/);
});

test("contracts: dates that cannot be right, missing values and missing text are left empty", () => {
  const by = Object.fromEntries(table(make(), "-contracts.csv").map((r) => [r["Contract notice"], r]));
  assert.equal(by.CN0000007["End date"], ""); // 1900-01-01 on the notice
  assert.equal(by.CN0000007.Status, "End date not stated");
  assert.equal(by.CN0000007["Value (AUD)"], "");
  assert.equal(by.CN0000008.Description, "");
  assert.equal(by.CN0000008["Start date"], "");
  assert.equal(by.CN0000008["Procurement method"], "");
});

test("contracts: a supplier is shown under its usual name, with the name on the notice kept", () => {
  const by = Object.fromEntries(table(make(), "-contracts.csv").map((r) => [r["Contract notice"], r]));
  assert.equal(by.CN0000001.Supplier, "Example Pty Ltd"); // the most common spelling for the ABN
  assert.equal(by.CN0000001["Supplier name on the notice"], "EXAMPLE PTY LTD");
  assert.equal(by.CN0000004.Supplier, "Overseas Co");
  assert.equal(by.CN0000004["Supplier ABN"], "");
  assert.equal(by.CN0000005.Supplier, "Overseas Co"); // one supplier, one name, in every file
  assert.equal(by.CN0000005["Supplier name on the notice"], "overseas co");
});

test("text from a notice cannot run as a formula", () => {
  const report = make();
  const text = report.files[0].body;
  assert.ok(text.includes(`"'=HYPERLINK(""http://example.org"",""x"")"`));
  assert.ok(!/(^|,|\n)"?=/.test(text.replace(/^\uFEFF/, "")));
  const by = Object.fromEntries(table(report, "-contracts.csv").map((r) => [r["Contract notice"], r]));
  assert.equal(by.CN0000006.Supplier, `'=HYPERLINK("http://example.org","x")`);
  assert.equal(by.CN0000006.Description, 'Tables, "large", and chairs');
  assert.equal(by.CN0000007.Description, "'+61 phone line");
  assert.ok(table(report, "-suppliers.csv").some((r) => r.Supplier.startsWith("'=HYPERLINK")));
});

test("suppliers: grouped by ABN, or by name when there is none, largest first", () => {
  const rows = table(make(), "-suppliers.csv");
  assert.deepEqual(Object.keys(rows[0]), HEADERS.suppliers);
  assert.deepEqual(
    rows.map((r) => r.Supplier),
    ["Overseas Co", "Example Pty Ltd", "Élan Consulting", `'=HYPERLINK("http://example.org","x")`, "Other & Sons"],
  );
  const overseas = rows[0];
  assert.equal(overseas["Supplier ABN"], "");
  assert.equal(overseas.Contracts, "2"); // two spellings, one supplier
  assert.equal(overseas["Total value (AUD)"], "100000");
  assert.equal(overseas["Contracts ending within 12 months"], "1");
  assert.equal(overseas["Value ending within 12 months (AUD)"], "70000");
  assert.equal(overseas["Next end date"], "2027-06-30");
  assert.equal(overseas["Last end date"], "2028-01-02");
  assert.equal(overseas.Agencies, "1");
  assert.equal(overseas["Agency names"], "Bureau of Samples");
  const example = rows[1];
  assert.equal(example["Supplier ABN"], "11111111111");
  assert.equal(example.Contracts, "3");
  assert.equal(example["Total value (AUD)"], "6250.65");
  assert.equal(example["Contracts ending within 12 months"], "2"); // the ended one is not counted
  assert.equal(example["Value ending within 12 months (AUD)"], "6000.1");
  assert.equal(example["Next end date"], "2026-12-31"); // the ended contract is not "next"
  assert.equal(example["Supplier state"], "NSW");
  assert.match(example["Source and licence"], /^Derived from AusTender contract notices, Department of Finance, CC BY 3\.0 AU; data as at 2026-11-19/);
  const other = rows[4];
  assert.equal(other["Total value (AUD)"], "0");
  assert.equal(other["Next end date"], "");
  assert.equal(other["Last end date"], "");
});

test("agencies: one row each, with their suppliers counted", () => {
  const rows = table(make(), "-agencies.csv");
  assert.deepEqual(Object.keys(rows[0]), HEADERS.agencies);
  assert.deepEqual(rows.map((r) => r.Agency), ["Bureau of Samples", "Department of Examples"]);
  assert.equal(rows[0].Contracts, "2");
  assert.equal(rows[0].Suppliers, "1");
  assert.equal(rows[0]["Largest supplier by value"], "Overseas Co");
  assert.equal(rows[1].Contracts, "6");
  assert.equal(rows[1].Suppliers, "4");
  assert.equal(rows[1]["Largest supplier by value"], "Example Pty Ltd");
  assert.equal(rows[1]["Total value (AUD)"], "7262.95");
});

test("the three tables agree with each other and with the totals", () => {
  const report = make();
  const add = (rows, col) => Math.round(rows.reduce((s, r) => s + Number(r[col] || 0), 0) * 100) / 100;
  const contracts = table(report, "-contracts.csv");
  const suppliers = table(report, "-suppliers.csv");
  const agencies = table(report, "-agencies.csv");
  assert.equal(contracts.length, 8);
  assert.equal(report.totals.contracts, 8);
  assert.equal(report.totals.value, 107262.95);
  assert.equal(add(contracts, "Value (AUD)"), 107262.95);
  assert.equal(add(suppliers, "Total value (AUD)"), 107262.95);
  assert.equal(add(agencies, "Total value (AUD)"), 107262.95);
  assert.equal(add(suppliers, "Contracts"), 8);
  assert.equal(add(agencies, "Contracts"), 8);
  assert.equal(report.totals.soonCount, 4);
  assert.equal(add(suppliers, "Contracts ending within 12 months"), 4);
  assert.equal(report.totals.noAbn, 2);
  assert.equal(report.totals.ended, 1);
  assert.equal(report.totals.noEnd, 2);
});

test("the read-me credits the source and says what the report is not", () => {
  const cov = coverageOf({
    datasetStarted: "2026-11-18T08:49:35Z",
    settings: { PUBLISHED_DAYS: 30 },
    horizon: { from: "2026-11-18T00:00:00Z", fetchedTo: "2027-11-20T00:00:00Z", complete: true },
  });
  const text = readme(make("80101500", { coverage: cov }));
  for (const [what, pattern] of README_MUST_SAY) assert.match(text, pattern, what);
  assert.match(text, /CATEGORY REPORT: UNSPSC 80101500/);
  assert.match(text, /Made 19 Nov 2026 from data last updated 19 Nov 2026/);
  assert.match(text, /8 contracts, one row each/);
  assert.match(text, /5 suppliers/);
  assert.match(text, /2 agencies/);
  assert.match(text, /Total value as published: \$107,263\./);
  assert.match(text, /4 contracts end between 19 Nov 2026 and 18 Nov 2027/);
  assert.match(text, /end date falls between 19 Nov 2026 and 20 Nov 2027/);
  assert.match(text, /does not mean it will be re-tendered/);
  assert.match(text, /not the official title/);
  assert.match(readme(make()), /roughly the next 12 months/);
  // One contract, described once: no description stands for the code.
  assert.match(readme(make("43230000")), /each described differently/);
  assert.match(readme(make("43230000")), /1 contract, one row each/);
  assert.ok(text.startsWith("\uFEFFCATEGORY REPORT"));
  assert.ok(text.split("\r\n").length > 30 && !/[^\r]\n/.test(text));
});

test("a report offers nothing for sale and names no one behind it", () => {
  for (const f of make().files) {
    assert.doesNotMatch(f.body, /\bprice|\bbuy\b|\bpurchase|\bpay|subscri|\$99|\$29|\$490|refund|stripe|\border (now|a|your|form)|@[a-z0-9-]+\.[a-z]/i, f.name);
    assert.doesNotMatch(f.body, /https?:\/\/(?!www\.tenders\.gov\.au\/|creativecommons\.org\/|example\.org)/, f.name);
  }
  for (const f of categoryReport(titledModel(), "80101500", { dataDate: "2026-11-19" }).files) {
    assert.doesNotMatch(f.body, /\bprice|\bbuy\b|\bpurchase|\bpay|subscri|\$99|\$29|\$490|refund|stripe|\border (now|a|your|form)|@[a-z0-9-]+\.[a-z]/i, f.name);
    assert.doesNotMatch(f.body, /https?:\/\/(?!www\.tenders\.gov\.au\/|creativecommons\.org\/|example\.org|data\.gov\.au\/)/, f.name);
  }
});

test("a finished report passes its own check, and a spoiled one does not", () => {
  const m = model();
  const report = categoryReport(m, "80101500", { dataDate: "2026-11-19" });
  assert.deepEqual(checkReport(report, m), []);
  assert.deepEqual(checkReport(categoryReport(m, "43230000"), m), []);

  const spoil = (suffix, change) => {
    const copy = { ...report, files: report.files.map((f) => (f.name.endsWith(suffix) ? { ...f, body: change(f.body) } : f)) };
    return checkReport(copy, m);
  };
  const dropRow = (n) => (body) => body.split("\r\n").filter((_, i) => i !== n).join("\r\n");
  assert.match(spoil("-contracts.csv", dropRow(2)).join("\n"), /7 rows, the dataset holds 8/);
  assert.match(spoil("-contracts.csv", dropRow(2)).join("\n"), /CN0000002 is missing/);
  assert.match(spoil("-contracts.csv", (b) => b.replace(",70000,", ",7000,")).join("\n"), /values add to/);
  assert.match(spoil("-contracts.csv", (b) => b.replace(/CC BY 3\.0 AU/, "")).join("\n"), /does not credit the source/);
  assert.match(spoil("-contracts.csv", (b) => b.replace("\uFEFF", "")).join("\n"), /no byte-order mark/);
  assert.match(spoil("-contracts.csv", (b) => b.replace("Contract notice", "CN")).join("\n"), /header row/);
  assert.match(spoil("-contracts.csv", (b) => b.replace("2026-12-31", "31/12/2026")).join("\n"), /not year-month-day/);
  assert.match(spoil("-contracts.csv", (b) => b.replace("2026-11-02", "2027-11-02")).join("\n"), /not in end-date order/);
  assert.match(spoil("-suppliers.csv", dropRow(1)).join("\n"), /suppliers: 4 rows, the report counted 5/);
  assert.match(spoil("-suppliers.csv", dropRow(1)).join("\n"), /suppliers: contracts add to 6/);
  assert.match(spoil("-agencies.csv", (b) => b.replace(",100000,", ",1,")).join("\n"), /agencies: values add to/);
  assert.match(spoil("-read-me.txt", (b) => b.replace(/not affiliated with/, "close to")).join("\n"), /not-affiliated statement is missing/);
  assert.match(spoil("-read-me.txt", (b) => b.replace(/AusTender contract notices, Department of Finance, CC BY 3\.0 AU/, "public data")).join("\n"), /source credit is missing/);
  assert.match(checkReport({ ...report, files: report.files.slice(0, 3) }, m).join("\n"), /read-me: file is missing/);
});

test("only 8-digit codes are accepted", () => {
  assert.deepEqual(codesFrom(["80101500"], "43230000, 80101500\n70140000"), ["80101500", "43230000", "70140000"]);
  assert.deepEqual(codesFrom([], ""), []);
  assert.deepEqual(codesFrom([], undefined), []);
  assert.throws(() => codesFrom(["../../etc"]), /Not a UNSPSC code/);
  assert.throws(() => codesFrom([], "8010150"), /Not a UNSPSC code/);
  assert.throws(() => codesFrom([], "80101500; rm -rf x"), /Not a UNSPSC code/);
  assert.throws(() => codesFrom(["--other"]), /Not a UNSPSC code/);
});

test("reports are kept out of the site folder", () => {
  assert.equal(outsideSite("reports", "site"), true);
  assert.equal(outsideSite("/tmp/reports", "site"), true);
  assert.equal(outsideSite("site", "site"), false);
  assert.equal(outsideSite("site/reports", "site"), false);
  assert.equal(outsideSite("./site/a/b", "site"), false);
  assert.equal(outsideSite(".", "site"), false); // the site folder would sit inside it
  assert.equal(outsideSite("site-reports", "site"), true);
});

test("categories are counted by size", () => {
  assert.deepEqual(sizeBands([1, 9, 10, 49, 50, 200, 999, 1000, 25000]), [
    { contracts: "1 to 9", categories: 2 },
    { contracts: "10 to 49", categories: 2 },
    { contracts: "50 to 199", categories: 1 },
    { contracts: "200 to 999", categories: 2 },
    { contracts: "1,000 or more", categories: 2 },
  ]);
});

// ---------- the command, run in a scratch folder ----------

const run = (cwd, args, env = {}) =>
  new Promise((resolve) => {
    const clean = { ...process.env, REPORT_NOW: "2026-11-19T08:00:00Z", ...env };
    for (const k of ["GITHUB_ACTIONS", "GITHUB_STEP_SUMMARY", "REPORT_CODES", "REPORT_DIR", "SITE_DIR"]) if (!(k in env)) delete clean[k];
    execFile(process.execPath, [SCRIPT, ...args], { cwd, env: clean }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });

async function scratch(records = sample) {
  const dir = await mkdtemp(join(tmpdir(), "report-test-"));
  await mkdir(join(dir, "data"));
  if (records) await writeFile(join(dir, "data/contracts.json"), JSON.stringify(records));
  await writeFile(join(dir, "data/state.json"), JSON.stringify({ updatedAt: "2026-11-18T18:20:00Z" }));
  return dir;
}

test("command: named codes are written to the report folder and nowhere else", async () => {
  const dir = await scratch();
  const res = await run(dir, ["80101500"], { REPORT_CODES: "43230000" });
  assert.equal(res.code, 0, res.stderr);
  assert.deepEqual((await readdir(join(dir, "reports"))).sort(), ["unspsc-43230000", "unspsc-80101500"]);
  assert.deepEqual((await readdir(join(dir, "reports/unspsc-80101500"))).sort(), [
    "unspsc-80101500-agencies.csv",
    "unspsc-80101500-contracts.csv",
    "unspsc-80101500-read-me.txt",
    "unspsc-80101500-suppliers.csv",
  ]);
  assert.deepEqual((await readdir(dir)).sort(), ["data", "reports"]);
  assert.deepEqual((await readdir(join(dir, "data"))).sort(), ["contracts.json", "state.json"]); // no summary for named codes
  const text = await readFile(join(dir, "reports/unspsc-80101500/unspsc-80101500-read-me.txt"), "utf8");
  assert.match(text, /data last updated 19 Nov 2026/); // 18 Nov 18:20 UTC is the 19th in Canberra
  const out = JSON.parse(res.stdout);
  assert.equal(out.reports.length, 2);
  assert.equal(out.reports[0].contracts, 8);
});

test("command: --all makes every category and writes a summary", async () => {
  const dir = await scratch();
  const res = await run(dir, ["--all"], { REPORT_DIR: "out/reports" });
  assert.equal(res.code, 0, res.stderr);
  assert.deepEqual((await readdir(join(dir, "out/reports"))).sort(), ["unspsc-43230000", "unspsc-80101500"]);
  const summary = JSON.parse(await readFile(join(dir, "data/report.json"), "utf8"));
  assert.equal(summary.ok, true);
  assert.equal(summary.reports, 2);
  assert.equal(summary.categories, 2);
  assert.equal(summary.files, 8);
  assert.equal(summary.contractsInReports, 9);
  assert.equal(summary.dataUpdated, "2026-11-18T18:20:00Z");
  assert.equal(summary.largest[0].code, "80101500");
  assert.equal(summary.smallest.code, "43230000");
  assert.deepEqual(summary.categoriesBySize[0], { contracts: "1 to 9", categories: 2 });
  assert.equal(summary.problemCount, 0);
});

test("command: a code with no contracts, a bad code or no dataset writes nothing and fails", async () => {
  const dir = await scratch();
  const unknown = await run(dir, ["80101500", "12345678"]);
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /No contracts are held under: 12345678/);
  const bad = await run(dir, ["8010"]);
  assert.equal(bad.code, 2);
  const injected = await run(dir, [], { REPORT_CODES: "80101500/../../x" });
  assert.equal(injected.code, 2);
  const none = await run(dir, []);
  assert.equal(none.code, 2);
  assert.deepEqual((await readdir(dir)).sort(), ["data"]);

  const empty = await scratch(null);
  const res = await run(empty, ["--all"]);
  assert.equal(res.code, 1);
  assert.match(res.stderr, /No dataset/);
  const summary = JSON.parse(await readFile(join(empty, "data/report.json"), "utf8"));
  assert.equal(summary.ok, false);
});

test("command: refuses to write into the site folder", async () => {
  const dir = await scratch();
  for (const where of ["site", "site/reports"]) {
    const res = await run(dir, ["80101500"], { REPORT_DIR: where });
    assert.equal(res.code, 2);
    assert.match(res.stderr, /not written into the site folder/);
  }
  const moved = await run(dir, ["80101500"], { REPORT_DIR: "public/reports", SITE_DIR: "public" });
  assert.equal(moved.code, 2);
  assert.deepEqual((await readdir(dir)).sort(), ["data"]);
});

test("with titles, the read-me gives the code's title, credits the codeset and says whose code UNSPSC is", () => {
  const m = titledModel();
  const report = categoryReport(m, "80101500", { dataDate: "2026-11-19" });
  const text = readme(report);
  assert.equal(report.title, "Made-up advisory services");
  assert.ok(text.startsWith("\uFEFFCATEGORY REPORT: UNSPSC 80101500\r\nMade-up advisory services\r\n"));
  assert.match(text, /The title of this code is "Made-up advisory services", as given in the Made-up Customised UNSPSC Codeset 1 July 2023 \(Department of Made-up Things\)\./);
  assert.match(text, /Category title: Made-up Customised UNSPSC Codeset 1 July 2023, Department of Made-up Things, Creative Commons Attribution 3\.0 Australia, https:\/\/data\.gov\.au\/data\/dataset\/made-up\. UNSPSC is the United Nations Standard Products and Services Code, of the United Nations Development Programme\./);
  // what agencies wrote is still there, still as a guide
  assert.match(text, /That is a guide to what the code is used for, not the official title/);
  for (const [what, pattern] of README_MUST_SAY) assert.match(text, pattern, what);
  assert.ok(!/[^\r]\n/.test(text));
  assert.deepEqual(checkReport(report, m), []);

  // a code the codeset does not list: no title, and the read-me says so
  const other = categoryReport(m, "43230000", { dataDate: "2026-11-19" });
  assert.equal(other.title, null);
  assert.match(readme(other), /This code is not in the Made-up Customised UNSPSC Codeset 1 July 2023 \(Department of Made-up Things\)/);
  assert.match(readme(other), /Category title: Made-up Customised UNSPSC Codeset/);
  assert.deepEqual(checkReport(other, m), []);
});

test("with titles, a report whose title or title credit has gone does not pass its own check", () => {
  const m = titledModel();
  const fresh = () => categoryReport(m, "80101500", { dataDate: "2026-11-19" });
  const spoil = (change) => {
    const report = fresh();
    const f = report.files.find((x) => x.name.endsWith("-read-me.txt"));
    f.body = change(f.body);
    return checkReport(report, m);
  };
  assert.deepEqual(spoil((t) => t.replace(/Category title: [^\r]*\r\n/, "")), ["read-me: the credit for the category title is missing"]);
  assert.deepEqual(spoil((t) => t.replace(/, of the United Nations Development Programme/, "")), ["read-me: the credit for the category title is missing"]);
  assert.deepEqual(spoil((t) => t.replace(/"Made-up advisory services"/, '"Something else"')), ["read-me: the title is missing"]);
  const renamed = fresh();
  renamed.title = "Something else";
  assert.deepEqual(checkReport(renamed, m), ["read-me: the title is not the one the codeset gives this code"]);
  // a report made without titles is not one for a dataset that has them
  assert.deepEqual(checkReport(make(), m), [
    "read-me: the title is not the one the codeset gives this code",
    "read-me: the title is missing",
    "read-me: the credit for the category title is missing",
  ]);
  // and without titles nothing about them is asked for or said
  assert.deepEqual(checkReport(make(), model()), []);
  assert.equal(make().title, null);
  assert.doesNotMatch(readme(make()), /Codeset|United Nations|Category title/);
});
