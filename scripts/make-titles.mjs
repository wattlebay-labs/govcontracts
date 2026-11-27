// Make data/unspsc-titles.json: the title of each UNSPSC code AusTender uses.
//
// The contract notices give a category as an 8-digit UNSPSC code with no
// title. The Department of Finance publishes the list of codes AusTender uses,
// with a title for each, as a workbook on data.gov.au ("AusTender Customised
// UNSPSC Codeset"), where the catalogue gives its licence as Creative Commons
// Attribution 3.0 Australia. UNSPSC itself, the United Nations Standard
// Products and Services Code, is the United Nations Development Programme's.
//
// This is started by hand (workflow `make-titles`), not by the daily run: it
// asks the catalogue where the workbook is and what its licence is, fetches
// the workbook once, and writes the small file the site build reads. It
// writes nothing unless the catalogue still gives the open licence and the
// workbook still holds a clean table of codes. A refusal is left alone.
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DATASET_ID, pickResource } from "./probe-codeset.mjs";
import { readWorkbook } from "./xlsx.mjs";

const UA = "govcontracts-titles/0.1 (+https://github.com/wattlebay-labs/govcontracts)";
export const TITLES_PATH = "data/unspsc-titles.json";
export const CATALOGUE = `https://data.gov.au/data/api/3/action/package_show?id=${DATASET_ID}`;
export const DATASET_PAGE = `https://data.gov.au/data/dataset/${DATASET_ID}`;
export const OPEN_LICENCE = "cc-by";
export const MIN_CODES = 500;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_TITLE = 200;

const tidy = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

// The table of codes in a workbook: the first sheet with a row whose cells
// include "Code" and "Title", and under it every row that has an 8-digit
// code. Returns { ok, reason, sheet, headerRow, titles } where `titles` is
// code -> title in code order. Anything odd about the table is a reason to
// stop, not something to patch over: an empty title, a code given two
// different titles, a title too long to be one, or too few codes.
export function titlesFrom(sheets, { minCodes = MIN_CODES } = {}) {
  for (const sheet of sheets || []) {
    for (const [i, row] of sheet.rows.entries()) {
      const cells = row.map((c) => tidy(c).toLowerCase());
      const codeCol = cells.indexOf("code");
      const titleCol = cells.indexOf("title");
      if (codeCol < 0 || titleCol < 0) continue;
      const found = new Map();
      let repeats = 0;
      for (const [j, r] of sheet.rows.entries()) {
        if (j <= i) continue;
        const code = tidy(r[codeCol]);
        if (!/^\d{8}$/.test(code)) continue;
        const title = tidy(r[titleCol]);
        const where = `row ${j + 1} of "${sheet.name}"`;
        if (!title) return { ok: false, reason: `code ${code} has no title (${where})` };
        if (title.length > MAX_TITLE) return { ok: false, reason: `the title of code ${code} is ${title.length} characters long (${where})` };
        if (found.has(code)) {
          if (found.get(code) !== title) return { ok: false, reason: `code ${code} has two titles: "${found.get(code)}" and "${title}"` };
          repeats += 1;
          continue;
        }
        found.set(code, title);
      }
      if (found.size < minCodes) return { ok: false, reason: `only ${found.size} codes under the heading row of "${sheet.name}", expected at least ${minCodes}` };
      const titles = Object.fromEntries([...found].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
      return { ok: true, reason: "", sheet: sheet.name, headerRow: i + 1, repeats, titles };
    }
  }
  return { ok: false, reason: 'no sheet has a row with the column names "Code" and "Title"' };
}

async function get(fetchImpl, url, accept, log) {
  const row = { url };
  try {
    const res = await fetchImpl(url, { headers: { "user-agent": UA, accept }, redirect: "follow", signal: AbortSignal.timeout(60000) });
    row.status = res.status;
    row.contentType = res.headers.get("content-type");
    const body = Buffer.from(await res.arrayBuffer());
    row.bytes = body.length;
    if (body.length > MAX_BYTES) row.error = `too large to use: ${body.length} bytes`;
    else if (res.ok) row.body = body;
  } catch (err) {
    row.error = String(err?.cause?.code || err?.message || err);
  }
  const { body, ...shown } = row;
  log(JSON.stringify(shown));
  return row;
}

// Ask the catalogue, fetch the workbook, and return either
// { ok: true, file } (the object to write) or { ok: false, reason }.
export async function makeTitles({ fetchImpl = fetch, now = () => new Date(), pause = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log } = {}) {
  const stop = (reason) => ({ ok: false, reason });

  // 1. The catalogue's record of the dataset: its licence and the workbook's address.
  const cat = await get(fetchImpl, CATALOGUE, "application/json", log);
  if (!cat.body) return stop(`the catalogue did not answer (status ${cat.status ?? "none"}${cat.error ? `, ${cat.error}` : ""})`);
  let record = null;
  try {
    const json = JSON.parse(cat.body.toString("utf8"));
    if (json && json.success && json.result) record = json.result;
  } catch {
    // not JSON: no record
  }
  if (!record) return stop("the catalogue's answer is not a dataset record");
  if (record.license_id !== OPEN_LICENCE) return stop(`the catalogue gives the dataset's licence as "${record.license_id ?? "none"}", not "${OPEN_LICENCE}"`);
  const resource = pickResource(record.resources);
  if (!resource) return stop("the dataset record lists no codeset workbook");
  const address = String(resource.url || "").replace(/^http:\/\//i, "https://");
  if (!/^https:\/\/([a-z0-9-]+\.)*data\.gov\.au\//i.test(address)) return stop("the workbook's address is not on data.gov.au");

  // 2. The workbook, once.
  await pause(1500);
  const file = await get(fetchImpl, address, "*/*", log);
  if (!file.body) return stop(`the workbook was not served (status ${file.status ?? "none"}${file.error ? `, ${file.error}` : ""})`);
  let sheets;
  try {
    sheets = readWorkbook(file.body);
  } catch (err) {
    return stop(`the workbook could not be read: ${err.message}`);
  }
  const table = titlesFrom(sheets);
  if (!table.ok) return stop(table.reason);

  // 3. Whether the dataset's own page answers at its usual address, so the
  // site can link to it. Asked for once; any answer but 200 means no link.
  await pause(1500);
  const page = await get(fetchImpl, DATASET_PAGE, "text/html", log);
  const pageOk = page.status === 200 && /html/i.test(page.contentType || "");

  return {
    ok: true,
    file: {
      what: "Titles of the UNSPSC codes used on AusTender, from the AusTender Customised UNSPSC Codeset",
      madeBy: "scripts/make-titles.mjs",
      fetchedAt: now().toISOString().replace(/\.\d+Z$/, "Z"),
      source: {
        file: tidy(resource.name),
        publisher: tidy(record.organization?.title),
        dataset: tidy(record.title),
        datasetId: DATASET_ID,
        datasetUrl: pageOk ? DATASET_PAGE : null,
        resourceId: resource.id ?? null,
        fileUrl: address,
        fileLastModified: resource.last_modified ?? null,
        licenceId: record.license_id,
        licence: tidy(record.license_title),
        licenceUrl: record.license_url ?? null,
        bytes: file.body.length,
        sha256: createHash("sha256").update(file.body).digest("hex"),
      },
      note: "UNSPSC is the United Nations Standard Products and Services Code, of the United Nations Development Programme. The titles are as given in the Department of Finance file named above, with runs of spaces collapsed.",
      sheet: table.sheet,
      headerRow: table.headerRow,
      codes: Object.keys(table.titles).length,
      titles: table.titles,
    },
  };
}

async function main() {
  const out = await makeTitles();
  if (!out.ok) {
    console.error(`Nothing written: ${out.reason}`);
    process.exit(1);
  }
  await mkdir(dirname(TITLES_PATH), { recursive: true });
  await writeFile(TITLES_PATH, JSON.stringify(out.file, null, 2) + "\n");
  const { titles, ...rest } = out.file;
  console.log(JSON.stringify({ ...rest, firstTitles: Object.entries(titles).slice(0, 5) }, null, 2));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  await main();
}
