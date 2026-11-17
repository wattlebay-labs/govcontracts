// Fetch Australian Government contract notices from the official AusTender
// OCDS API (Department of Finance, CC BY 3.0 AU) and write compact records.
//
// Two pulls, in fixed-size date windows with a pause between calls:
//   - contracts PUBLISHED in the last PUBLISHED_DAYS days
//   - contracts ENDING in the next ENDING_DAYS days
// Output: data/contracts.json (array of compact records, newest release wins)
//         data/summary.json   (counts, sizes, errors — small enough to commit)
import { mkdir, writeFile } from "node:fs/promises";

const API = "https://api.tenders.gov.au/ocds/findByDates";
const UA = "govcontracts/0.1 (+https://github.com/wattlebay-labs/govcontracts)";
const PUBLISHED_DAYS = Number(process.env.PUBLISHED_DAYS || 30);
const ENDING_DAYS = Number(process.env.ENDING_DAYS || 365);
const WINDOW_DAYS = Number(process.env.WINDOW_DAYS || 7);
const PAUSE_MS = Number(process.env.PAUSE_MS || 800);
const MAX_PAGES_PER_WINDOW = 200;

const DAY = 864e5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (t) => new Date(t).toISOString().slice(0, 19) + "Z";
const startOfTodayUtc = () => Math.floor(Date.now() / DAY) * DAY;

export function windows(fromMs, toMs, days = WINDOW_DAYS) {
  const out = [];
  for (let t = fromMs; t < toMs; t += days * DAY) {
    out.push([iso(t), iso(Math.min(t + days * DAY, toMs))]);
  }
  return out;
}

const abnOf = (party) =>
  party?.additionalIdentifiers?.find((i) => i.scheme === "AU-ABN")?.id || null;

// One OCDS release -> one compact record (or null if it has no contract).
export function compact(release) {
  const c = release?.contracts?.[0];
  if (!c?.id) return null;
  const parties = release.parties || [];
  const supplier = parties.find((p) => p.roles?.includes("supplier"));
  const buyer = parties.find((p) => p.roles?.includes("procuringEntity"));
  const amount = Number(c.value?.amount);
  return {
    id: c.id,
    released: release.date || null,
    description: (c.description || "").trim() || null,
    agency: buyer?.name || null,
    agencyAbn: abnOf(buyer),
    division: supplier?.contactPoint?.division || null,
    supplier: supplier?.name || null,
    supplierAbn: abnOf(supplier),
    supplierState: supplier?.address?.region || null,
    value: Number.isFinite(amount) ? amount : null,
    start: c.period?.startDate || null,
    end: c.period?.endDate || null,
    unspsc: c.items?.[0]?.classification?.id || null,
    method: release.tender?.procurementMethodDetails || release.tender?.procurementMethod || null,
    amendment: (release.tag || []).includes("contractAmendment"),
  };
}

// Keep the most recently released record per contract id.
export function merge(map, record) {
  if (!record) return;
  const prev = map.get(record.id);
  if (!prev || String(record.released) >= String(prev.released)) map.set(record.id, record);
}

async function fetchWindow(dateType, from, to, stats) {
  let url = `${API}/${dateType}/${from}/${to}`;
  const releases = [];
  const seen = new Set();
  for (let page = 0; url && page < MAX_PAGES_PER_WINDOW; page++) {
    if (seen.has(url)) {
      stats.errors.push({ url, error: "pagination loop" });
      break;
    }
    seen.add(url);
    stats.pages++;
    let body = null;
    for (let attempt = 1; attempt <= 3 && !body; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { "user-agent": UA, accept: "application/json" },
          signal: AbortSignal.timeout(60000),
        });
        stats.requests++;
        if (res.status === 429 || res.status >= 500) {
          await sleep(5000 * attempt);
          continue;
        }
        if (!res.ok) {
          stats.errors.push({ url, status: res.status });
          return releases;
        }
        body = await res.json();
      } catch (err) {
        if (attempt === 3) stats.errors.push({ url, error: String(err?.cause?.code || err?.message || err) });
        await sleep(3000 * attempt);
      }
    }
    if (!body) return releases;
    releases.push(...(body.releases || []));
    const next = body.links?.next;
    if (next) stats.pagedWindows.add(`${dateType} ${from}`);
    url = next || null;
    await sleep(PAUSE_MS);
  }
  return releases;
}

async function main() {
  const today = startOfTodayUtc();
  const plan = [
    ["contractPublished", windows(today - PUBLISHED_DAYS * DAY, today + DAY)],
    ["contractEnd", windows(today, today + ENDING_DAYS * DAY)],
  ];
  const stats = { requests: 0, pages: 0, errors: [], pagedWindows: new Set() };
  const started = Date.now();
  const byId = new Map();
  const perPull = {};
  let maxWindow = 0;

  for (const [dateType, wins] of plan) {
    let n = 0;
    for (const [from, to] of wins) {
      const pagesBefore = stats.pages;
      const releases = await fetchWindow(dateType, from, to, stats);
      n += releases.length;
      console.log(`${dateType} ${from.slice(0, 10)}..${to.slice(0, 10)} releases=${releases.length} pages=${stats.pages - pagesBefore}`);
      maxWindow = Math.max(maxWindow, releases.length);
      for (const r of releases) merge(byId, compact(r));
    }
    perPull[dateType] = { windows: wins.length, releases: n };
    console.log(dateType, perPull[dateType]);
  }

  const records = [...byId.values()].sort((a, b) => String(a.end).localeCompare(String(b.end)));
  const json = JSON.stringify(records);
  await mkdir("data", { recursive: true });
  await writeFile("data/contracts.json", json);

  const count = (key) => new Set(records.map((r) => r[key]).filter(Boolean)).size;
  const summary = {
    generatedAt: new Date().toISOString(),
    source: "AusTender OCDS API, Department of Finance, CC BY 3.0 AU",
    settings: { PUBLISHED_DAYS, ENDING_DAYS, WINDOW_DAYS },
    perPull,
    requests: stats.requests,
    pages: stats.pages,
    seconds: Math.round((Date.now() - started) / 1000),
    largestWindow: maxWindow,
    windowsWithMorePages: stats.pagedWindows.size,
    contracts: records.length,
    suppliers: count("supplierAbn"),
    agencies: count("agency"),
    categories: count("unspsc"),
    totalValue: Math.round(records.reduce((s, r) => s + (r.value || 0), 0)),
    bytes: json.length,
    errors: stats.errors.slice(0, 20),
    errorCount: stats.errors.length,
    sample: records.slice(0, 3),
  };
  await writeFile("data/summary.json", JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ...summary, sample: undefined }, null, 2));
  // Fail the job only if nothing came back at all.
  if (records.length === 0) process.exit(1);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  await main();
}
