// Tests for the maker of the category titles file. Every workbook and every
// answer from the network here is made up.
import assert from "node:assert/strict";
import { test } from "node:test";
import { workbookOf } from "./made-up-workbook.mjs";
import { CATALOGUE, DATASET_PAGE, makeTitles, titlesFrom } from "./make-titles.mjs";

const code = (i) => String(10000000 + i * 100);
// A sheet like the real one: a heading, the column names, a heading row with
// no code, then rows of codes.
const rowsOf = (n, change = (rows) => rows) =>
  change([
    ["A made-up codeset", "", "", ""],
    ["Code", "Title", "Definition", "Goods/Services"],
    ["", "Made-up segment", "What the segment holds", "Goods"],
    ...Array.from({ length: n }, (_, i) => [code(i), `Made-up thing ${i}`, "", i % 2 ? "Goods" : "Services"]),
  ]);
const sheetOf = (rows, name = "Made-up sheet") => [{ name, rows }];

test("titlesFrom takes the rows with an 8-digit code under the Code and Title heading", () => {
  const out = titlesFrom(sheetOf(rowsOf(3, (rows) => [...rows, ["", "A heading with no code"], ["1234", "Too short to be a code"], [" 99999900 ", "  Spaced   out  title "]])), { minCodes: 3 });
  assert.equal(out.ok, true);
  assert.equal(out.headerRow, 2);
  assert.equal(out.sheet, "Made-up sheet");
  assert.deepEqual(out.titles, { 10000000: "Made-up thing 0", 10000100: "Made-up thing 1", 10000200: "Made-up thing 2", 99999900: "Spaced out title" });
  assert.deepEqual(Object.keys(out.titles), ["10000000", "10000100", "10000200", "99999900"]);
});

test("titlesFrom finds the columns by name, wherever they are, and copes with a very wide row", () => {
  const wide = Array.from({ length: 300 }, () => "");
  wide[0] = "Goods";
  wide[2] = "10000000";
  wide[5] = "Made-up thing";
  wide[299] = "far away";
  const out = titlesFrom(sheetOf([["Goods/Services", "", " CODE ", "", "", "title"], wide]), { minCodes: 1 });
  assert.deepEqual(out.titles, { 10000000: "Made-up thing" });
  // a second sheet is used when the first has no such heading
  const two = titlesFrom([{ name: "Notes", rows: [["Nothing here"]] }, ...sheetOf(rowsOf(2), "Codes")], { minCodes: 2 });
  assert.equal(two.sheet, "Codes");
});

test("titlesFrom stops when the table is not clean", () => {
  assert.match(titlesFrom(sheetOf([["10000000", "No heading row"]])).reason, /no sheet has a row/);
  assert.match(titlesFrom(sheetOf(rowsOf(499))).reason, /only 499 codes/);
  assert.equal(titlesFrom(sheetOf(rowsOf(500))).ok, true);
  assert.match(titlesFrom(sheetOf(rowsOf(3, (rows) => [...rows, [code(1), "Another name"]])), { minCodes: 1 }).reason, /code 10000100 has two titles/);
  assert.match(titlesFrom(sheetOf(rowsOf(3, (rows) => [...rows, ["20000000", "  "]])), { minCodes: 1 }).reason, /code 20000000 has no title \(row 7/);
  assert.match(titlesFrom(sheetOf(rowsOf(3, (rows) => [...rows, ["20000000", "x".repeat(201)]])), { minCodes: 1 }).reason, /201 characters long/);
  // the same code with the same title twice is one code
  const twice = titlesFrom(sheetOf(rowsOf(3, (rows) => [...rows, [code(1), "Made-up  thing 1"]])), { minCodes: 1 });
  assert.equal(twice.ok, true);
  assert.equal(twice.repeats, 1);
  assert.equal(Object.keys(twice.titles).length, 3);
});

// A stand-in for the network: the catalogue, the workbook and the dataset page.
const FILE_URL = "https://data.gov.au/data/dataset/made-up/resource/made-up/download/made-up-unspsc-codeset.xlsx";
const record = (over = {}) => ({
  success: true,
  result: {
    title: "Made-up contract notice data",
    organization: { title: "Department of Made-up Things" },
    license_id: "cc-by",
    license_title: "Creative Commons Attribution 3.0 Australia",
    license_url: "http://creativecommons.org/licenses/by/3.0/au/",
    resources: [
      { id: "r1", name: "Something else.csv", format: "CSV", url: "https://data.gov.au/x.csv" },
      { id: "r2", name: "Made-up UNSPSC Codeset.xlsx", format: "XLSX", url: FILE_URL.replace("https:", "http:"), last_modified: "2024-01-10T00:00:00" },
    ],
    ...over,
  },
});
function network(answers) {
  const asked = [];
  const fetchImpl = async (url, init) => {
    asked.push(url);
    assert.match(init.headers["user-agent"], /^govcontracts-titles\//);
    const a = answers[url];
    if (!a) return new Response("not found", { status: 404 });
    if (a instanceof Error) throw a;
    return new Response(a.body, { status: a.status || 200, headers: { "content-type": a.type || "application/octet-stream" } });
  };
  return { asked, fetchImpl };
}
const quiet = { pause: async () => {}, log: () => {}, now: () => new Date("2026-11-27T09:00:00.123Z") };
const good = (over = {}) => ({
  [CATALOGUE]: { body: JSON.stringify(record()), type: "application/json" },
  [FILE_URL]: { body: workbookOf(rowsOf(520), "Made-up codes") },
  [DATASET_PAGE]: { body: "<html>the dataset</html>", type: "text/html; charset=utf-8" },
  ...over,
});

test("makeTitles asks the catalogue, then the workbook, then the dataset page, and returns the file to write", async () => {
  const net = network(good());
  const out = await makeTitles({ ...quiet, fetchImpl: net.fetchImpl });
  assert.equal(out.ok, true);
  assert.deepEqual(net.asked, [CATALOGUE, FILE_URL, DATASET_PAGE]);
  const f = out.file;
  assert.equal(f.codes, 520);
  assert.equal(f.titles[code(7)], "Made-up thing 7");
  assert.equal(f.sheet, "Made-up codes");
  assert.equal(f.fetchedAt, "2026-11-27T09:00:00Z");
  assert.equal(f.source.file, "Made-up UNSPSC Codeset.xlsx");
  assert.equal(f.source.publisher, "Department of Made-up Things");
  assert.equal(f.source.licenceId, "cc-by");
  assert.equal(f.source.licence, "Creative Commons Attribution 3.0 Australia");
  assert.equal(f.source.fileUrl, FILE_URL);
  assert.equal(f.source.datasetUrl, DATASET_PAGE);
  assert.match(f.source.sha256, /^[0-9a-f]{64}$/);
  assert.equal(f.source.bytes, good()[FILE_URL].body.length);
  assert.match(f.note, /United Nations Development Programme/);
});

test("makeTitles gives no link to the dataset page when that page does not answer", async () => {
  for (const page of [{ body: "no", status: 403, type: "text/html" }, { body: "{}", type: "application/json" }, new Error("ECONNRESET")]) {
    const out = await makeTitles({ ...quiet, fetchImpl: network(good({ [DATASET_PAGE]: page })).fetchImpl });
    assert.equal(out.ok, true);
    assert.equal(out.file.source.datasetUrl, null);
  }
});

test("makeTitles writes nothing when anything is not as expected, and does not ask again", async () => {
  const cases = [
    [{ [CATALOGUE]: { body: "Forbidden", status: 403, type: "text/html" } }, /catalogue did not answer \(status 403\)/, 1],
    [{ [CATALOGUE]: new Error("ETIMEDOUT") }, /catalogue did not answer .*ETIMEDOUT/, 1],
    [{ [CATALOGUE]: { body: "<html>a page</html>", type: "text/html" } }, /not a dataset record/, 1],
    [{ [CATALOGUE]: { body: JSON.stringify(record({ license_id: "other-closed" })), type: "application/json" } }, /licence as "other-closed", not "cc-by"/, 1],
    [{ [CATALOGUE]: { body: JSON.stringify(record({ license_id: undefined })), type: "application/json" } }, /licence as "none"/, 1],
    [{ [CATALOGUE]: { body: JSON.stringify(record({ resources: [] })), type: "application/json" } }, /lists no codeset workbook/, 1],
    [
      { [CATALOGUE]: { body: JSON.stringify(record({ resources: [{ name: "UNSPSC codeset.xlsx", format: "XLSX", url: "https://example.org/codeset.xlsx" }] })), type: "application/json" } },
      /not on data\.gov\.au/,
      1,
    ],
    [{ [FILE_URL]: { body: "Forbidden", status: 403, type: "text/html" } }, /workbook was not served \(status 403\)/, 2],
    [{ [FILE_URL]: { body: "<html>a page where the workbook should be</html>", type: "text/html" } }, /workbook could not be read/, 2],
    [{ [FILE_URL]: { body: workbookOf(rowsOf(40)) } }, /only 40 codes/, 2],
    [{ [FILE_URL]: { body: workbookOf(rowsOf(520, (rows) => [...rows, [code(3), "A second name"]])) } }, /has two titles/, 2],
    [{ [FILE_URL]: { body: Buffer.alloc(5 * 1024 * 1024 + 1) } }, /workbook was not served .*too large/, 2],
  ];
  for (const [over, reason, requests] of cases) {
    const net = network(good(over));
    const out = await makeTitles({ ...quiet, fetchImpl: net.fetchImpl });
    assert.equal(out.ok, false, String(reason));
    assert.match(out.reason, reason);
    assert.equal(out.file, undefined);
    assert.equal(net.asked.length, requests, String(reason));
  }
});
