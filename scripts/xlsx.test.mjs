// Tests for the workbook reader and the codeset probe's own logic.
// Every workbook here is made up, built in the test from its parts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";
import { columnIndex, decodeXml, readWorkbook, unzip } from "./xlsx.mjs";
import { coverage, describeWorkbook, findCodeTable, pickResource } from "./probe-codeset.mjs";

// A zip archive of the given files. `stored` names are kept without compression.
function zip(files, { stored = [], comment = "" } = {}) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.isBuffer(text) ? text : Buffer.from(text, "utf8");
    const keep = stored.includes(name);
    const packed = keep ? data : deflateRawSync(data);
    const nameBuf = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(keep ? 0 : 8, 8);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, packed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(keep ? 0 : 8, 10);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBuf.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const commentBuf = Buffer.from(comment, "utf8");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(commentBuf.length, 20);
  return Buffer.concat([...locals, directory, end, commentBuf]);
}

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Notes &amp; credits" sheetId="1" r:id="rId7"/><sheet name="Codes" sheetId="2" r:id="rId3"/></sheets></workbook>`;
const RELS = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId3" Type="x/worksheet" Target="worksheets/second.xml"/>
<Relationship Id="rId7" Type="x/worksheet" Target="/xl/worksheets/first.xml"/>
<Relationship Id="rId9" Type="x/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
const STRINGS = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="6" uniqueCount="6">
<si><t>Code</t></si>
<si><t>Title</t></si>
<si><t xml:space="preserve">Paper &amp; card </t></si>
<si><r><rPr><b/></rPr><t>Made-up </t></r><r><t>widgets</t></r><rPh sb="0" eb="1"><t>IGNORED</t></rPh></si>
<si><t/></si>
<si><t>Line one_x000D_&#10;line two &#169; &lt;tag&gt;</t></si>
</sst>`;
const FIRST = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>A made-up list</t></is></c></row>
<row r="3"><c r="B3" t="s"><v>5</v></c></row>
</sheetData></worksheet>`;
const SECOND = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<cols><col min="1" max="1" width="12"/></cols><sheetData>
<row r="1" spans="1:3"><c r="A1" s="1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
<row r="2"><c r="A2"><v>11110000</v></c><c r="B2" t="s"><v>2</v></c></row>
<row r="3"><c r="A3"><v>11111100</v></c><c r="B3" s="4"/><c r="C3" t="s"><v>3</v></c></row>
<row r="4"><c r="A4" t="str"><f>A3+1</f><v>11111101</v></c><c r="C4" t="s"><v>4</v></c><c r="AA4" t="b"><v>1</v></c></row>
<row r="5"/>
<row><c><v>7</v></c><c t="s"><v>1</v></c></row>
</sheetData><rowBreaks count="0"/></worksheet>`;

const madeUp = (over = {}, opts) =>
  zip(
    {
      "[Content_Types].xml": "<Types/>",
      "xl/workbook.xml": WORKBOOK,
      "xl/_rels/workbook.xml.rels": RELS,
      "xl/sharedStrings.xml": STRINGS,
      "xl/worksheets/first.xml": FIRST,
      "xl/worksheets/second.xml": SECOND,
      ...over,
    },
    opts,
  );

test("unzip reads compressed and stored files, with a comment after the directory", () => {
  const files = unzip(zip({ "a.txt": "alpha ".repeat(200), "dir/b.txt": "béta" }, { stored: ["dir/b.txt"], comment: "made up" }));
  assert.deepEqual([...files.keys()], ["a.txt", "dir/b.txt"]);
  assert.equal(files.get("a.txt").toString(), "alpha ".repeat(200));
  assert.equal(files.get("dir/b.txt").toString(), "béta");
});

test("unzip refuses what is not a zip, a cut-off archive and a wrong length", () => {
  assert.throws(() => unzip(Buffer.from("<html>403 Forbidden</html>")), /not a zip archive/);
  const good = zip({ "a.txt": "alpha ".repeat(50) });
  assert.throws(() => unzip(good.subarray(0, good.length - 30)), /not a zip archive|damaged/);
  const bad = Buffer.from(good);
  bad.writeUInt32LE(5, bad.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 24);
  assert.throws(() => unzip(bad), /wrong length/);
});

test("columnIndex and decodeXml", () => {
  assert.deepEqual(["A1", "Z9", "AA4", "AB10", "", "7"].map(columnIndex), [0, 25, 26, 27, -1, -1]);
  assert.equal(decodeXml("a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos; &#65;&#x42; &nbsp; &amp;amp;"), `a & b <c> "d" 'e' AB &nbsp; &amp;`);
});

test("readWorkbook gives each sheet's cells as text, in the workbook's order", () => {
  const sheets = readWorkbook(madeUp());
  assert.deepEqual(sheets.map((s) => s.name), ["Notes & credits", "Codes"]);
  assert.deepEqual(sheets[0].rows, [["A made-up list"], [], ["", "Line one\r\nline two © <tag>"]]);
  assert.deepEqual(sheets[1].rows.slice(0, 3), [
    ["Code", "Title"],
    ["11110000", "Paper & card "],
    ["11111100", "", "Made-up widgets"],
  ]);
  // a formula's stored text, an empty string, a far column, an empty row, a row with no references
  const far = sheets[1].rows[3];
  assert.equal(far[0], "11111101");
  assert.equal(far[2], "");
  assert.equal(far.length, 27);
  assert.equal(far[26], "1");
  assert.deepEqual(sheets[1].rows[4], []);
  assert.deepEqual(sheets[1].rows[5], ["7", "Title"]);
  assert.equal(sheets[1].rows.length, 6);
});

test("readWorkbook reads a workbook saved without compression and one without shared strings", () => {
  const names = ["xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/sharedStrings.xml", "xl/worksheets/first.xml", "xl/worksheets/second.xml"];
  assert.deepEqual(readWorkbook(madeUp({}, { stored: names })), readWorkbook(madeUp()));
  const plain = zip({
    "xl/workbook.xml": `<workbook><sheets><sheet name='Only' sheetId="1"/></sheets></workbook>`,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="2"><c r="B2"><v>3.5</v></c></row></sheetData></worksheet>`,
  });
  assert.deepEqual(readWorkbook(plain), [{ name: "Only", rows: [[], ["", "3.5"]] }]);
});

test("readWorkbook says what is wrong with a damaged workbook", () => {
  assert.throws(() => readWorkbook(zip({ "hello.txt": "hi" })), /xl\/workbook\.xml is missing/);
  assert.throws(() => readWorkbook(madeUp({ "xl/sharedStrings.xml": "<sst><si><t>Code</t></si></sst>" })), /no shared string/);
  assert.throws(() => readWorkbook(zip({ "xl/workbook.xml": WORKBOOK, "xl/_rels/workbook.xml.rels": RELS, "xl/sharedStrings.xml": STRINGS, "xl/worksheets/first.xml": FIRST })), /has no file/);
  assert.throws(() => readWorkbook(zip({ "xl/workbook.xml": "<workbook><sheets/></workbook>" })), /no sheets/);
});

// ---------- the probe's own logic ----------

const SHEETS = [
  { name: "About", rows: [["A made-up codeset"], ["Titles © Example Body, used with permission"], ["12345678 is not in a column of codes"]] },
  {
    name: "List",
    rows: [
      ["Made-up list", "", ""],
      ["Level", "Code", "Title"],
      ["Segment", "11000000", "MADE-UP MATERIALS"],
      ["Family", "11110000", "Paper  and\ncard"],
      ["Class", " 11111100 ", "Widgets"],
      ["Commodity", "11111101", "Small widgets"],
      ["Commodity", "11111101", "Small widgets"],
      ["Commodity", "11111102", ""],
      ["Class", "11111100", "Gadgets"],
      ["Class", "11111200", "Software licences and permissions"],
      ["Note", "see above", "not a code"],
    ],
  },
];

test("findCodeTable finds the code and title columns and counts what is odd", () => {
  const { titles, summary } = findCodeTable(SHEETS);
  assert.deepEqual([...titles], [
    ["11000000", "MADE-UP MATERIALS"],
    ["11110000", "Paper and card"],
    ["11111100", "Widgets"],
    ["11111101", "Small widgets"],
    ["11111102", ""],
    ["11111200", "Software licences and permissions"],
  ]);
  assert.deepEqual(
    { ...summary, conflicts: summary.conflicts.length },
    {
      sheet: "List",
      codeColumn: 1,
      titleColumn: 2,
      codeHeader: "Code",
      titleHeader: "Title",
      textColumns: [
        { column: 0, filled: 8, different: 4 },
        { column: 2, filled: 7, different: 6 },
      ],
      firstCodeRow: 3,
      rowsWithCode: 8,
      codes: 6,
      levels: { segment: 1, family: 1, class: 2, commodity: 2 },
      duplicates: 2,
      conflicts: 1,
      emptyTitles: 1,
      longestTitle: "Software licences and permissions",
      allCapsTitles: 1,
    },
  );
  assert.deepEqual(summary.conflicts, [{ code: "11111100", first: "Widgets", second: "Gadgets" }]);
  assert.equal(findCodeTable([{ name: "Empty", rows: [["no codes here"]] }]), null);
});

test("describeWorkbook lists the sheets and any line about rights", () => {
  const d = describeWorkbook(SHEETS);
  assert.deepEqual(d.sheets.map((s) => [s.name, s.rows, s.columns, s.firstRows.length]), [
    ["About", 3, 1, 3],
    ["List", 11, 3, 6],
  ]);
  assert.deepEqual(d.notices, [{ sheet: "About", row: 2, column: 1, text: "Titles © Example Body, used with permission" }]);
});

test("coverage counts the dataset's codes that get a title", () => {
  const { titles } = findCodeTable(SHEETS);
  const records = [
    { unspsc: "11110000", description: "Paper and card" },
    { unspsc: "11110000", description: "Paper and card" },
    { unspsc: "11111100", description: "Widget supply" },
    { unspsc: "99999999", description: "Something else" },
    { unspsc: "11111102", description: "Blank title in the list" },
    { unspsc: null, description: "No code" },
  ];
  const describe = (list) => (list.length > 1 ? { label: list[0] } : { label: null });
  const c = coverage(records, titles, describe);
  assert.deepEqual(
    { ...c, largest: c.largest.length },
    {
      datasetCodes: 4,
      withTitle: 2,
      withoutTitle: 2,
      contracts: 5,
      contractsUnderTitledCodes: 3,
      codesWithoutTitle: [
        { code: "11111102", contracts: 1 },
        { code: "99999999", contracts: 1 },
      ],
      guideLabels: { codesWithGuide: 1, codesWithNeither: 2, codesWithTitleOnly: 1, guideSameAsTitle: 1, guideDiffersFromTitle: 0 },
      largest: 4,
    },
  );
  assert.deepEqual(c.largest[0], { code: "11110000", contracts: 2, title: "Paper and card", guide: "Paper and card" });
});

test("pickResource takes the newest codeset workbook and nothing else", () => {
  const resources = [
    { id: "a", name: "2017-18 Australian Government Contract Data", format: "XLSX", url: "https://data.gov.au/x.xlsx" },
    { id: "b", name: "AusTender Customised UNSPSC Codeset-August 2012.pdf", format: "PDF", url: "https://data.gov.au/b.pdf" },
    { id: "c", name: "Made-up Customised UNSPSC Codeset 2020.xlsx", format: "XLSX", url: "https://data.gov.au/c.xlsx", last_modified: "2020-07-01T00:00:00" },
    { id: "d", name: "Made-up Customised UNSPSC Codeset 2023.xlsx", format: "", url: "https://data.gov.au/d.xlsx", last_modified: "2024-01-10T00:00:00" },
  ];
  assert.equal(pickResource(resources).id, "d");
  assert.equal(pickResource(resources.slice(0, 2)), null);
  assert.equal(pickResource(undefined), null);
});
