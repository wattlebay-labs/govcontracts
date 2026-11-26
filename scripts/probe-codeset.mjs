// One-off look at a possible source of category titles: the "AusTender
// Customised UNSPSC Codeset" workbook that the Department of Finance
// publishes on data.gov.au with the historical contract notice data, where it
// is labelled Creative Commons Attribution 3.0 Australia.
//
// It asks data.gov.au's catalogue (its public CKAN API) what the dataset's
// licence is and where the workbook is, fetches the workbook once, and writes
// probe/codeset.json: what answered, what the workbook holds, and, when the
// contract dataset is at hand, how many of its category codes get a title.
// It changes nothing on the site. A refusal (403) is recorded and left alone.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readWorkbook } from "./xlsx.mjs";

const UA = "govcontracts-probe/0.2 (+https://github.com/wattlebay-labs/govcontracts)";
export const DATASET_ID = "5c7fa69b-b0e9-4553-b8df-2a022dd2e982";
const API_PATHS = ["https://data.gov.au/data/api/3/action/package_show", "https://data.gov.au/api/3/action/package_show"];
const MAX_BYTES = 5 * 1024 * 1024;
const NOTICE = /copyright|©|\(c\)|licen[cs]e|all rights|permission|UNDP|GS1|United Nations|trade ?mark|®/i;

const clip = (s, n = 120) => (s.length > n ? `${s.slice(0, n)}…` : s);
const isCode = (s) => /^\d{8}$/.test(s.trim());

// The resource in a CKAN dataset record that is the codeset workbook: the
// newest one whose name says so.
export function pickResource(resources) {
  const hits = (resources || []).filter((r) => /unspsc|codeset/i.test(`${r.name || ""} ${r.description || ""}`) && /xlsx/i.test(`${r.format || ""} ${r.url || ""}`));
  hits.sort((a, b) => String(b.last_modified || b.created || "").localeCompare(String(a.last_modified || a.created || "")));
  return hits[0] || null;
}

// Find the table of codes in a workbook: the sheet and column holding the
// most 8-digit codes, and beside it the column that holds the most text on
// those rows. Returns the code -> title map and what was odd about it.
export function findCodeTable(sheets) {
  let best = null;
  for (const sheet of sheets) {
    const width = Math.max(0, ...sheet.rows.map((r) => r.length));
    for (let col = 0; col < width; col++) {
      const rows = sheet.rows.map((r, i) => [i, r]).filter(([, r]) => isCode(r[col] || ""));
      if (!rows.length || (best && rows.length <= best.rows.length)) continue;
      best = { sheet, col, rows, width };
    }
  }
  if (!best) return null;
  // The title column is the one with the most different texts on those rows
  // (a column that only says "Class" or "Commodity" has few).
  let titleCol = -1;
  let most = 0;
  const textColumns = [];
  for (let col = 0; col < best.width; col++) {
    if (col === best.col) continue;
    const texts = best.rows.map(([, r]) => (r[col] || "").trim()).filter((t) => /[A-Za-z]/.test(t));
    if (!texts.length) continue;
    const different = new Set(texts).size;
    textColumns.push({ column: col, filled: texts.length, different });
    if (different > most) {
      most = different;
      titleCol = col;
    }
  }
  const firstRow = best.rows[0][0];
  const header = firstRow > 0 ? best.sheet.rows[firstRow - 1] || [] : [];
  const titles = new Map();
  const conflicts = [];
  let duplicates = 0;
  let emptyTitles = 0;
  let longest = "";
  for (const [, r] of best.rows) {
    const code = r[best.col].trim();
    const title = titleCol < 0 ? "" : (r[titleCol] || "").replace(/\s+/g, " ").trim();
    if (!title) emptyTitles += 1;
    if (titles.has(code)) {
      duplicates += 1;
      if (titles.get(code) !== title && conflicts.length < 10) conflicts.push({ code, first: titles.get(code), second: title });
      continue;
    }
    titles.set(code, title);
    if (title.length > longest.length) longest = title;
  }
  const codes = [...titles.keys()];
  return {
    titles,
    summary: {
      sheet: best.sheet.name,
      codeColumn: best.col,
      titleColumn: titleCol,
      codeHeader: clip(header[best.col] || ""),
      titleHeader: titleCol < 0 ? "" : clip(header[titleCol] || ""),
      textColumns,
      firstCodeRow: firstRow + 1,
      rowsWithCode: best.rows.length,
      codes: codes.length,
      levels: {
        segment: codes.filter((c) => c.endsWith("000000")).length,
        family: codes.filter((c) => c.endsWith("0000") && !c.endsWith("000000")).length,
        class: codes.filter((c) => c.endsWith("00") && !c.endsWith("0000")).length,
        commodity: codes.filter((c) => !c.endsWith("00")).length,
      },
      duplicates,
      conflicts,
      emptyTitles,
      longestTitle: longest,
      allCapsTitles: codes.filter((c) => /[A-Z]/.test(titles.get(c)) && titles.get(c) === titles.get(c).toUpperCase()).length,
    },
  };
}

export function describeWorkbook(sheets) {
  const notices = [];
  const out = sheets.map((sheet) => {
    for (const [i, row] of sheet.rows.entries()) {
      // A row of the code table is not a notice, whatever its title says
      // ("Software licences").
      if (row.some((cell) => isCode(cell))) continue;
      for (const [j, cell] of row.entries()) {
        if (NOTICE.test(cell) && notices.length < 25) notices.push({ sheet: sheet.name, row: i + 1, column: j + 1, text: clip(cell, 400) });
      }
    }
    return {
      name: sheet.name,
      rows: sheet.rows.length,
      columns: Math.max(0, ...sheet.rows.map((r) => r.length)),
      firstRows: sheet.rows.slice(0, 6).map((r) => r.map((c) => clip(c))),
    };
  });
  return { sheets: out, notices };
}

// How the titles fit the contract dataset: which of its codes get one.
export function coverage(records, titles, describe) {
  const byCode = new Map();
  for (const r of records) {
    if (!r || !r.unspsc) continue;
    if (!byCode.has(r.unspsc)) byCode.set(r.unspsc, []);
    byCode.get(r.unspsc).push(r.description);
  }
  const rows = [...byCode].map(([code, list]) => ({
    code,
    contracts: list.length,
    title: titles.get(code) || "",
    guide: describe ? describe(list).label || "" : "",
  }));
  rows.sort((a, b) => b.contracts - a.contracts || a.code.localeCompare(b.code));
  const withTitle = rows.filter((r) => r.title);
  const without = rows.filter((r) => !r.title);
  const same = (a, b) => a.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === b.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return {
    datasetCodes: rows.length,
    withTitle: withTitle.length,
    withoutTitle: without.length,
    contracts: rows.reduce((n, r) => n + r.contracts, 0),
    contractsUnderTitledCodes: withTitle.reduce((n, r) => n + r.contracts, 0),
    codesWithoutTitle: without.slice(0, 60).map((r) => ({ code: r.code, contracts: r.contracts })),
    guideLabels: {
      codesWithGuide: rows.filter((r) => r.guide).length,
      codesWithNeither: rows.filter((r) => !r.guide && !r.title).length,
      codesWithTitleOnly: rows.filter((r) => !r.guide && r.title).length,
      guideSameAsTitle: rows.filter((r) => r.guide && r.title && same(r.guide, r.title)).length,
      guideDiffersFromTitle: rows.filter((r) => r.guide && r.title && !same(r.guide, r.title)).length,
    },
    largest: rows.slice(0, 8).map((r) => ({ code: r.code, contracts: r.contracts, title: r.title, guide: r.guide })),
  };
}

async function get(url, accept, log) {
  const row = { url };
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept }, redirect: "follow", signal: AbortSignal.timeout(60000) });
    row.status = res.status;
    row.finalUrl = res.url;
    row.contentType = res.headers.get("content-type");
    const declared = Number(res.headers.get("content-length"));
    if (declared > MAX_BYTES) {
      row.error = `too large to read: ${declared} bytes`;
      await res.body?.cancel();
    } else {
      const body = Buffer.from(await res.arrayBuffer());
      row.bytes = body.length;
      if (body.length > MAX_BYTES) row.error = `too large to use: ${body.length} bytes`;
      else if (res.ok) row.body = body;
      // What a refusal or an error page says, so the record explains itself.
      else row.sample = clip(body.toString("utf8").replace(/\s+/g, " "), 300);
    }
  } catch (err) {
    row.error = String(err?.cause?.code || err?.message || err);
  }
  const { body, ...shown } = row;
  log.push(shown);
  console.log(JSON.stringify(shown));
  return row;
}

async function main() {
  const out = {
    probedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    what: "AusTender Customised UNSPSC Codeset, Department of Finance, on data.gov.au",
    ok: false,
    reason: "",
    requests: [],
  };
  const finish = async (reason) => {
    out.reason = reason;
    await mkdir("probe", { recursive: true });
    await writeFile("probe/codeset.json", JSON.stringify(out, null, 2) + "\n");
    console.log(JSON.stringify({ ok: out.ok, reason: out.reason, table: out.table, coverage: out.coverage, notices: out.notices }, null, 2));
  };

  // 1. The catalogue record: licence and the workbook's address.
  let record = null;
  for (const base of API_PATHS) {
    const res = await get(`${base}?id=${DATASET_ID}`, "application/json", out.requests);
    if (res.body) {
      try {
        const json = JSON.parse(res.body.toString("utf8"));
        if (json && json.success && json.result) record = json.result;
      } catch {
        // not JSON: treated as no record
      }
      if (!record) out.requests.at(-1).sample = clip(res.body.toString("utf8").replace(/\s+/g, " "), 300);
    }
    // Only a "not found" is a reason to try the other address. A refusal is
    // an answer, and is left alone.
    if (record || res.status !== 404) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (!record) return finish("the catalogue did not give the dataset record");
  out.dataset = {
    title: record.title ?? null,
    organisation: record.organization?.title ?? null,
    licenceId: record.license_id ?? null,
    licenceTitle: record.license_title ?? null,
    licenceUrl: record.license_url ?? null,
    modified: record.metadata_modified ?? null,
    resources: (record.resources || []).length,
    notesMentioningRights: NOTICE.test(record.notes || "") ? clip(String(record.notes), 1500) : null,
  };
  const resource = pickResource(record.resources);
  if (!resource) return finish("the dataset record lists no codeset workbook");
  out.resource = {
    id: resource.id ?? null,
    name: resource.name ?? null,
    format: resource.format ?? null,
    size: resource.size ?? null,
    created: resource.created ?? null,
    lastModified: resource.last_modified ?? null,
    url: resource.url ?? null,
    description: clip(String(resource.description || ""), 800),
  };
  // An old catalogue entry can give an http address for the same host.
  const address = String(resource.url || "").replace(/^http:\/\//i, "https://");
  if (!/^https:\/\/([a-z0-9-]+\.)*data\.gov\.au\//i.test(address)) return finish("the workbook's address is not on data.gov.au");

  // 2. The workbook itself.
  await new Promise((r) => setTimeout(r, 1500));
  const file = await get(address, "*/*", out.requests);
  if (!file.body) return finish(`the workbook was not served (status ${file.status ?? "none"}${file.error ? `, ${file.error}` : ""})`);
  out.file = { bytes: file.body.length, sha256: createHash("sha256").update(file.body).digest("hex") };
  let sheets;
  try {
    sheets = readWorkbook(file.body);
  } catch (err) {
    return finish(`the workbook could not be read: ${err.message}`);
  }
  const described = describeWorkbook(sheets);
  out.workbook = { sheets: described.sheets };
  out.notices = described.notices;
  const table = findCodeTable(sheets);
  if (!table) return finish("no column of 8-digit codes was found in the workbook");
  out.table = table.summary;

  // 3. Against the contract dataset, when it is here.
  let records = null;
  try {
    records = JSON.parse(await readFile("data/contracts.json", "utf8"));
  } catch {
    // no dataset in this checkout
  }
  if (Array.isArray(records) && records.length) {
    const { describeCode } = await import("./build.mjs");
    out.coverage = coverage(records, table.titles, describeCode);
  } else {
    out.coverage = null;
  }
  out.ok = true;
  return finish(out.coverage ? "workbook read and compared with the contract dataset" : "workbook read; no contract dataset here to compare with");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  await main();
}
