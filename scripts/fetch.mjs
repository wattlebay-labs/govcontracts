// Fetch Australian Government contract notices from the official AusTender
// OCDS API (Department of Finance, CC BY 3.0 AU) and keep a compact dataset
// up to date between runs.
//
// The dataset (data/contracts.json) and the cursors (data/state.json) are
// carried from one run to the next by the workflow cache, so each run only
// asks the API for what it does not have yet:
//   - contractPublished     from its cursor (first run: PUBLISHED_DAYS back) to now
//   - contractLastModified  from its cursor to now (amendments and changes)
//   - contractEnd           from its cursor towards today + ENDING_DAYS
// Each pull moves in fixed-size date windows with a pause between calls and
// stops when the run's time budget is spent; the next run resumes from the
// cursor. The first runs therefore backfill the "ending soon" horizon in
// chunks, and later runs are small daily updates.
//
// Output: data/contracts.json (array of compact records, one per contract)
//         data/state.json     (cursors)
//         data/summary.json   (counts, sizes, errors: small enough to commit)
import { mkdir, readFile, writeFile } from "node:fs/promises";

const API = "https://api.tenders.gov.au/ocds/findByDates";
const UA = "govcontracts/0.2 (+https://github.com/wattlebay-labs/govcontracts)";
// Contract end dates bunch up on a few days (31 December, 30 June), so one
// window can run to hundreds of pages. The page cap only guards against a
// runaway; HARD_SECONDS is what stops a run before the job's own time limit,
// so that what was fetched is still saved.
const MAX_PAGES_PER_WINDOW = 1500;
const STATE_VERSION = 1;
const DAY = 864e5;

const iso = (t) => new Date(t).toISOString().slice(0, 19) + "Z";
const dayStart = (t) => Math.floor(t / DAY) * DAY;

export function settings(env = process.env) {
  const num = (key, fallback) => {
    const v = env[key];
    return v === undefined || v === "" || !Number.isFinite(Number(v)) ? fallback : Number(v);
  };
  return {
    PUBLISHED_DAYS: num("PUBLISHED_DAYS", 30),
    ENDING_DAYS: num("ENDING_DAYS", 365),
    WINDOW_DAYS: num("WINDOW_DAYS", 7),
    OVERLAP_DAYS: num("OVERLAP_DAYS", 1),
    PAUSE_MS: num("PAUSE_MS", 800),
    BUDGET_SECONDS: num("BUDGET_SECONDS", 600),
    HARD_SECONDS: num("HARD_SECONDS", 2400),
  };
}

export function windows(fromMs, toMs, days = 7) {
  const out = [];
  for (let t = fromMs; t < toMs; t += days * DAY) {
    out.push([iso(t), iso(Math.min(t + days * DAY, toMs))]);
  }
  return out;
}

const abnOf = (party) =>
  party?.additionalIdentifiers?.find((i) => i.scheme === "AU-ABN")?.id || null;

// "CN1234567-A2" (an amendment notice) belongs to contract "CN1234567".
export const baseId = (id) => String(id).replace(/-A\d+$/i, "");

const isAmendment = (release) =>
  (release?.tag || []).includes("contractAmendment") ||
  /-A\d+$/i.test(String(release?.contracts?.[0]?.id || ""));

// One OCDS release -> one compact record (or null if it has no contract).
export function compact(release) {
  const c = release?.contracts?.[0];
  if (!c?.id) return null;
  const parties = release.parties || [];
  const supplier = parties.find((p) => p.roles?.includes("supplier"));
  const buyer = parties.find((p) => p.roles?.includes("procuringEntity"));
  const amount = Number(c.value?.amount);
  return {
    id: baseId(c.id),
    notice: String(c.id),
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
    amendment: isAmendment(release),
  };
}

// Keep the most recently released record per contract.
export function merge(map, record) {
  if (!record) return;
  const prev = map.get(record.id);
  if (!prev || String(record.released) >= String(prev.released)) map.set(record.id, record);
}

export function newState(nowMs, cfg) {
  const today = dayStart(nowMs);
  return {
    version: STATE_VERSION,
    createdAt: iso(nowMs),
    runs: 0,
    endFrom: iso(today),
    cursors: {
      contractPublished: iso(today - cfg.PUBLISHED_DAYS * DAY),
      contractLastModified: iso(today),
      contractEnd: iso(today),
    },
  };
}

// What this run should ask for, in order. The two "what is new" pulls go
// first and re-read OVERLAP_DAYS before their cursor; the horizon pull uses
// whatever time is left.
export function plan(state, nowMs, cfg) {
  const now = Math.floor(nowMs / 1000) * 1000;
  const overlap = cfg.OVERLAP_DAYS * DAY;
  const horizon = dayStart(nowMs) + (cfg.ENDING_DAYS + 1) * DAY;
  const at = (key) => Date.parse(state.cursors[key]);
  return [
    { dateType: "contractPublished", from: at("contractPublished") - overlap, to: now },
    { dateType: "contractLastModified", from: at("contractLastModified") - overlap, to: now },
    { dateType: "contractEnd", from: at("contractEnd"), to: horizon },
  ];
}

async function fetchWindow(dateType, from, to, stats, io, cfg) {
  let url = `${API}/${dateType}/${from}/${to}`;
  const releases = [];
  const seen = new Set();
  for (let page = 0; url; page++) {
    if (page >= MAX_PAGES_PER_WINDOW) {
      stats.errors.push({ url, error: "page limit" });
      return { releases, ok: false };
    }
    if (seen.has(url)) {
      stats.errors.push({ url, error: "pagination loop" });
      return { releases, ok: false };
    }
    if (io.now() >= stats.hardDeadline) {
      stats.errors.push({ url, error: "time limit", pagesRead: page });
      return { releases, ok: false };
    }
    seen.add(url);
    stats.pages++;
    let body = null;
    for (let attempt = 1; attempt <= 3 && !body; attempt++) {
      try {
        const res = await io.fetch(url, {
          headers: { "user-agent": UA, accept: "application/json" },
          signal: AbortSignal.timeout(60000),
        });
        stats.requests++;
        if (res.status === 429 || res.status >= 500) {
          if (attempt === 3) stats.errors.push({ url, status: res.status });
          await io.sleep(5000 * attempt);
          continue;
        }
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          stats.errors.push({ url, status: res.status, body: text.slice(0, 200) });
          return { releases, ok: false };
        }
        body = await res.json();
      } catch (err) {
        if (attempt === 3) stats.errors.push({ url, error: String(err?.cause?.code || err?.message || err) });
        await io.sleep(3000 * attempt);
      }
    }
    if (!body) return { releases, ok: false };
    releases.push(...(body.releases || []));
    const next = body.links?.next;
    if (next) stats.pagedWindows.add(`${dateType} ${from}`);
    url = next || null;
    await io.sleep(cfg.PAUSE_MS);
  }
  return { releases, ok: true };
}

// Run every pull in the plan against the dataset `byId`, moving each cursor
// only past windows that came back complete. Returns the run's statistics.
export async function sync(state, byId, cfg, io) {
  const started = io.now();
  const deadline = started + cfg.BUDGET_SECONDS * 1000;
  const stats = {
    hardDeadline: started + cfg.HARD_SECONDS * 1000,
    requests: 0,
    pages: 0,
    errors: [],
    pagedWindows: new Set(),
    windowsTried: 0,
    windowsOk: 0,
    largestWindow: 0,
    budgetSpent: false,
    perPull: {},
    tags: {},
    amendmentSamples: [],
    lastModified: { releases: 0, amendments: 0, alsoInPublishedPull: 0, newToDataset: 0 },
  };
  const publishedIds = new Set();

  for (const pull of plan(state, started, cfg)) {
    const { dateType } = pull;
    const mine = { windows: 0, releases: 0, from: iso(pull.from), to: iso(pull.to), caughtUp: false };
    stats.perPull[dateType] = mine;
    let complete = true;
    for (const [from, to] of windows(pull.from, pull.to, cfg.WINDOW_DAYS)) {
      if (io.now() >= Math.min(deadline, stats.hardDeadline)) {
        stats.budgetSpent = true;
        complete = false;
        break;
      }
      const pagesBefore = stats.pages;
      stats.windowsTried++;
      const { releases, ok } = await fetchWindow(dateType, from, to, stats, io, cfg);
      io.log(`${dateType} ${from}..${to} releases=${releases.length} pages=${stats.pages - pagesBefore} ok=${ok}`);
      mine.windows++;
      mine.releases += releases.length;
      stats.largestWindow = Math.max(stats.largestWindow, releases.length);
      for (const release of releases) {
        const record = compact(release);
        for (const tag of release.tag || []) stats.tags[tag] = (stats.tags[tag] || 0) + 1;
        if (!record) continue;
        const previous = byId.get(record.id) || null;
        if (dateType === "contractPublished") publishedIds.add(record.id);
        if (dateType === "contractLastModified") {
          stats.lastModified.releases++;
          if (record.amendment) stats.lastModified.amendments++;
          if (publishedIds.has(record.id)) stats.lastModified.alsoInPublishedPull++;
          else if (!previous) stats.lastModified.newToDataset++;
        }
        // Keep a few raw amendment notices (without party contact details)
        // next to what was held before, to check how amendments are reported.
        if (record.amendment && stats.amendmentSamples.length < 3) {
          stats.amendmentSamples.push({
            dateType,
            ocid: release.ocid || null,
            releaseDate: release.date || null,
            tag: release.tag || null,
            contract: release.contracts[0],
            previous,
          });
        }
        merge(byId, record);
      }
      if (!ok) {
        complete = false;
        break;
      }
      stats.windowsOk++;
      state.cursors[dateType] = to;
    }
    mine.caughtUp = complete;
    mine.cursor = state.cursors[dateType];
    io.log(dateType, JSON.stringify(mine));
  }
  state.runs = (state.runs || 0) + 1;
  state.updatedAt = iso(io.now());
  stats.seconds = Math.round((io.now() - started) / 1000);
  return stats;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const cfg = settings();
  const io = {
    fetch: (url, init) => fetch(url, init),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    log: (...args) => console.log(...args),
  };

  let state = await readJson("data/state.json");
  let previous = await readJson("data/contracts.json");
  const resumed = state?.version === STATE_VERSION && Array.isArray(previous) && !!state.cursors;
  if (!resumed) {
    state = newState(io.now(), cfg);
    previous = [];
  }
  console.log(resumed ? `Resuming: ${previous.length} contracts held, run ${state.runs + 1}` : "No stored dataset: starting a new one");
  const byId = new Map(previous.map((r) => [r.id, r]));
  const before = byId.size;

  const stats = await sync(state, byId, cfg, io);

  const records = [...byId.values()].sort((a, b) => String(a.end).localeCompare(String(b.end)));
  const json = JSON.stringify(records);
  await mkdir("data", { recursive: true });
  await writeFile("data/contracts.json", json);
  await writeFile("data/state.json", JSON.stringify(state, null, 2));

  const now = io.now();
  const count = (key) => new Set(records.map((r) => r[key]).filter(Boolean)).size;
  const ends = records.map((r) => r.end).filter(Boolean);
  const endingSoon = records.filter((r) => {
    const t = Date.parse(r.end);
    return t >= now && t < now + cfg.ENDING_DAYS * DAY;
  });
  const horizon = stats.perPull.contractEnd;
  const summary = {
    generatedAt: iso(now),
    source: "AusTender OCDS API, Department of Finance, CC BY 3.0 AU",
    settings: cfg,
    resumed,
    runs: state.runs,
    datasetStarted: state.createdAt,
    cursors: state.cursors,
    horizon: {
      from: state.endFrom,
      fetchedTo: state.cursors.contractEnd,
      target: horizon?.to || null,
      complete: !!horizon?.caughtUp,
    },
    perPull: stats.perPull,
    requests: stats.requests,
    pages: stats.pages,
    seconds: stats.seconds,
    budgetSpent: stats.budgetSpent,
    windowsTried: stats.windowsTried,
    windowsOk: stats.windowsOk,
    largestWindow: stats.largestWindow,
    windowsWithMorePages: stats.pagedWindows.size,
    contractsBefore: before,
    contracts: records.length,
    contractsEndingWithinHorizon: endingSoon.length,
    amendedContracts: records.filter((r) => r.amendment).length,
    suppliers: count("supplierAbn"),
    agencies: count("agency"),
    categories: count("unspsc"),
    totalValue: Math.round(records.reduce((s, r) => s + (r.value || 0), 0)),
    earliestEnd: ends.length ? ends.reduce((a, b) => (a < b ? a : b)) : null,
    latestEnd: ends.length ? ends.reduce((a, b) => (a > b ? a : b)) : null,
    bytes: json.length,
    errors: stats.errors.slice(0, 20),
    errorCount: stats.errors.length,
    diagnostics: {
      tags: stats.tags,
      lastModified: stats.lastModified,
      amendmentSamples: stats.amendmentSamples,
    },
    sample: endingSoon.slice(0, 3),
  };
  await writeFile("data/summary.json", JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ...summary, sample: undefined, diagnostics: undefined }, null, 2));

  // Fail the job if there is no dataset at all, or if nothing could be read.
  if (records.length === 0) process.exit(1);
  if (stats.windowsTried > 0 && stats.windowsOk === 0) process.exit(1);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  await main();
}
