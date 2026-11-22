// Run with: node --test scripts/fetch.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { baseId, compact, merge, newState, plan, saysNoRecords, settings, sync, windows } from "./fetch.mjs";

const DAY = 864e5;

const release = {
  date: "2026-11-14T02:48:10Z",
  tag: ["contract"],
  parties: [
    {
      name: "EXAMPLE PTY LTD",
      roles: ["supplier"],
      additionalIdentifiers: [{ id: "11111111111", scheme: "AU-ABN" }],
      address: { region: "NSW" },
      contactPoint: { division: "EXAMPLE DIVISION" },
    },
    {
      name: "Example Agency",
      roles: ["procuringEntity"],
      additionalIdentifiers: [{ id: "22222222222", scheme: "AU-ABN" }],
    },
  ],
  contracts: [
    {
      id: "CN0000001",
      description: " Example services ",
      items: [{ classification: { scheme: "UNSPSC", id: "80131500" } }],
      period: { startDate: "2026-09-22T14:00:00Z", endDate: "2027-10-30T13:00:00Z" },
      value: { currency: "AUD", amount: "61929.12" },
    },
  ],
  tender: { procurementMethod: "limited", procurementMethodDetails: "Limited tender" },
};

test("compact maps an OCDS release to a flat record", () => {
  const r = compact(release);
  assert.equal(r.id, "CN0000001");
  assert.equal(r.notice, "CN0000001");
  assert.equal(r.description, "Example services");
  assert.equal(r.supplier, "EXAMPLE PTY LTD");
  assert.equal(r.supplierAbn, "11111111111");
  assert.equal(r.agency, "Example Agency");
  assert.equal(r.agencyAbn, "22222222222");
  assert.equal(r.value, 61929.12);
  assert.equal(r.end, "2027-10-30T13:00:00Z");
  assert.equal(r.unspsc, "80131500");
  assert.equal(r.method, "Limited tender");
  assert.equal(r.amendment, false);
});

test("compact tolerates missing pieces", () => {
  assert.equal(compact({}), null);
  assert.equal(compact({ contracts: [{}] }), null);
  const r = compact({ contracts: [{ id: "CN2" }] });
  assert.equal(r.value, null);
  assert.equal(r.supplier, null);
});

test("an amendment notice is filed under its parent contract", () => {
  assert.equal(baseId("CN1234567-A2"), "CN1234567");
  assert.equal(baseId("CN1234567"), "CN1234567");
  const r = compact({ tag: ["contractAmendment"], contracts: [{ id: "CN1234567-A2" }] });
  assert.equal(r.id, "CN1234567");
  assert.equal(r.notice, "CN1234567-A2");
  assert.equal(r.amendment, true);
});

test("merge keeps the most recent release per contract", () => {
  const m = new Map();
  merge(m, { id: "A", released: "2026-01-02", value: 2 });
  merge(m, { id: "A", released: "2026-01-01", value: 1 });
  merge(m, { id: "A", released: "2026-01-03", value: 3 });
  merge(m, null);
  assert.equal(m.size, 1);
  assert.equal(m.get("A").value, 3);
});

test("windows cover the range without gaps or overrun", () => {
  const w = windows(0, 16 * DAY, 7);
  assert.equal(w.length, 3);
  assert.equal(w[0][0], "1970-01-01T00:00:00Z");
  assert.equal(w[0][1], w[1][0]);
  assert.equal(w[2][1], "1970-01-17T00:00:00Z");
});

test("settings fall back to defaults for missing or bad values", () => {
  const s = settings({ ENDING_DAYS: "90", PAUSE_MS: "", BUDGET_SECONDS: "abc" });
  assert.equal(s.ENDING_DAYS, 90);
  assert.equal(s.PAUSE_MS, 800);
  assert.equal(s.BUDGET_SECONDS, 600);
});

test("a new dataset plans a backfill; a caught-up one plans a small update", () => {
  const cfg = settings({});
  const now = Date.parse("2026-11-18T09:30:00Z");
  const state = newState(now, cfg);
  const first = plan(state, now, cfg);
  assert.deepEqual(first.map((p) => p.dateType), ["contractPublished", "contractLastModified", "contractEnd"]);
  assert.equal(new Date(first[0].from).toISOString(), "2026-10-18T00:00:00.000Z"); // 30 days + 1 overlap
  assert.equal(new Date(first[2].from).toISOString(), "2026-11-18T00:00:00.000Z");
  assert.equal(new Date(first[2].to).toISOString(), "2027-11-19T00:00:00.000Z");

  // Next day, with every cursor where a complete run leaves it.
  state.cursors = {
    contractPublished: "2026-11-18T09:30:00Z",
    contractLastModified: "2026-11-18T09:30:00Z",
    contractEnd: "2027-11-19T00:00:00Z",
  };
  const next = plan(state, now + DAY, cfg);
  assert.equal(next[0].to - next[0].from, 2 * DAY);
  assert.equal(next[2].to - next[2].from, DAY);
});

// A stand-in for the API: serves `perWindow` releases for every window in
// pages of 2, and whatever `override` returns for a URL.
function fakeApi({ perWindow = 3, override = () => null } = {}) {
  const calls = [];
  let n = 0;
  const json = (status, body) => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  const fetch = async (url) => {
    calls.push(url);
    const special = override(url);
    if (special) return json(special.status, special.body || {});
    const [base, query] = url.split("?page=");
    const page = Number(query || 0);
    const [dateType, from] = base.split("/").slice(-3);
    const all = Array.from({ length: perWindow }, (_, i) => ({
      date: from,
      tag: ["contract"],
      contracts: [{ id: `CN${dateType}-${from}-${i}`, period: { endDate: from } }],
    }));
    const slice = all.slice(page * 2, page * 2 + 2);
    n += slice.length;
    const more = (page + 1) * 2 < all.length;
    return json(200, { releases: slice, links: more ? { next: `${base}?page=${page + 1}` } : {} });
  };
  return { fetch, calls, served: () => n };
}

function fakeIo(api, startMs, msPerRequest = 1000) {
  let t = startMs;
  return {
    fetch: async (url) => {
      t += msPerRequest;
      return api.fetch(url);
    },
    sleep: async () => {},
    now: () => t,
    log: () => {},
  };
}

test("sync follows pages, stops at the budget and resumes from the cursor", async () => {
  const cfg = settings({ PUBLISHED_DAYS: "6", ENDING_DAYS: "27", BUDGET_SECONDS: "8" });
  const start = Date.parse("2026-11-18T09:30:00Z");
  const state = newState(start, cfg);
  const byId = new Map();
  const api = fakeApi();

  const first = await sync(state, byId, cfg, fakeIo(api, start));
  assert.equal(first.budgetSpent, true);
  assert.equal(first.errors.length, 0);
  assert.equal(first.perPull.contractPublished.caughtUp, true);
  assert.equal(first.perPull.contractLastModified.caughtUp, true);
  assert.equal(first.perPull.contractEnd.caughtUp, false);
  assert.equal(byId.size, api.served()); // every release from every page was kept
  assert.equal(state.runs, 1);
  const cursorAfterFirst = state.cursors.contractEnd;
  assert.ok(cursorAfterFirst > "2026-11-18T00:00:00Z" && cursorAfterFirst < "2026-12-16T00:00:00Z");

  // Second run, same day, plenty of budget: finishes the horizon without
  // asking again for the windows it already has.
  const callsBefore = api.calls.length;
  const second = await sync(state, byId, { ...cfg, BUDGET_SECONDS: 600 }, fakeIo(api, start + 3600e3));
  assert.equal(second.perPull.contractEnd.caughtUp, true);
  assert.equal(state.cursors.contractEnd, "2026-12-16T00:00:00Z");
  const repeated = api.calls.slice(callsBefore).filter((u) => u.includes("/contractEnd/2026-11-18T00:00:00Z/"));
  assert.equal(repeated.length, 0);
  // The "what is new" pulls only re-read the overlap before their cursors.
  assert.equal(second.perPull.contractPublished.windows, 1);
  assert.equal(second.perPull.contractPublished.from, "2026-11-17T09:30:00Z");
  assert.equal(second.perPull.contractLastModified.windows, 1);
  assert.equal(state.runs, 2);
});

test("a window with no notices in it is an empty window, not an error", async () => {
  const cfg = settings({ PUBLISHED_DAYS: "6", ENDING_DAYS: "13" });
  const start = Date.parse("2026-11-22T09:00:00Z");
  const state = newState(start, cfg);
  const none = { errorCode: 100, message: "No Records found for Date Range ['2026-11-20T23:21:34Z'-'2026-11-22T08:58:51Z']" };
  const api = fakeApi({ override: (url) => (url.includes("/contractLastModified/") ? { status: 400, body: none } : null) });
  const stats = await sync(state, new Map(), cfg, fakeIo(api, start));
  assert.deepEqual(stats.errors, []);
  assert.equal(stats.emptyWindows, 1);
  assert.equal(stats.perPull.contractLastModified.releases, 0);
  assert.equal(stats.perPull.contractLastModified.caughtUp, true);
  assert.equal(stats.windowsOk, stats.windowsTried);
  // The cursor moves on, as after any window that came back complete.
  assert.ok(state.cursors.contractLastModified > "2026-11-22T00:00:00Z");
});

test("only the API's own 'no records' answer counts as an empty window", () => {
  const body = JSON.stringify({ errorCode: 100, message: "No Records found for Date Range ['a'-'b']" });
  assert.equal(saysNoRecords(400, body), true);
  assert.equal(saysNoRecords(404, body), false);
  assert.equal(saysNoRecords(400, JSON.stringify({ errorCode: 101, message: "No Records found" })), false);
  assert.equal(saysNoRecords(400, JSON.stringify({ errorCode: 100, message: "Invalid date" })), false);
  assert.equal(saysNoRecords(400, "<html>Bad Request</html>"), false);
  assert.equal(saysNoRecords(400, ""), false);
});

test("a refused window is recorded and its cursor stays put", async () => {
  const cfg = settings({ PUBLISHED_DAYS: "6", ENDING_DAYS: "13" });
  const start = Date.parse("2026-11-18T09:30:00Z");
  const state = newState(start, cfg);
  const before = state.cursors.contractLastModified;
  const api = fakeApi({
    override: (url) => (url.includes("/contractLastModified/") ? { status: 400, body: { message: "bad" } } : null),
  });
  const stats = await sync(state, new Map(), cfg, fakeIo(api, start));
  assert.equal(stats.errors.length, 1);
  assert.equal(stats.errors[0].status, 400);
  assert.match(stats.errors[0].body, /bad/);
  assert.equal(state.cursors.contractLastModified, before);
  assert.equal(stats.perPull.contractLastModified.caughtUp, false);
  assert.equal(stats.perPull.contractEnd.caughtUp, true); // the other pulls still ran
});

test("a server error is retried, then recorded without moving the cursor", async () => {
  const cfg = settings({ PUBLISHED_DAYS: "6", ENDING_DAYS: "6" });
  const start = Date.parse("2026-11-18T09:30:00Z");
  const state = newState(start, cfg);
  const api = fakeApi({ override: (url) => (url.includes("/contractEnd/") ? { status: 503 } : null) });
  const stats = await sync(state, new Map(), cfg, fakeIo(api, start));
  assert.equal(api.calls.filter((u) => u.includes("/contractEnd/")).length, 3);
  assert.equal(stats.errors.length, 1);
  assert.equal(state.cursors.contractEnd, "2026-11-18T00:00:00Z");
});

test("amendments are counted and sampled against the record held before", async () => {
  const cfg = settings({ PUBLISHED_DAYS: "1", ENDING_DAYS: "1" });
  const start = Date.parse("2026-11-18T09:30:00Z");
  const state = newState(start, cfg);
  const byId = new Map([["CN7", { id: "CN7", released: "2026-01-01T00:00:00Z", value: 100 }]]);
  const amendment = {
    date: "2026-11-18T01:00:00Z",
    tag: ["contractAmendment"],
    parties: [{ name: "X", roles: ["supplier"], contactPoint: { telephone: "000" } }],
    contracts: [{ id: "CN7-A1", value: { amount: "150" } }],
  };
  const api = fakeApi({
    perWindow: 0,
    override: (url) => (url.includes("/contractLastModified/") ? { status: 200, body: { releases: [amendment] } } : null),
  });
  const stats = await sync(state, byId, cfg, fakeIo(api, start));
  assert.equal(byId.get("CN7").value, 150);
  assert.equal(byId.get("CN7").notice, "CN7-A1");
  assert.deepEqual(stats.lastModified, { releases: 1, amendments: 1, alsoInPublishedPull: 0, newToDataset: 0 });
  assert.equal(stats.amendmentSamples.length, 1);
  assert.equal(stats.amendmentSamples[0].previous.value, 100);
  assert.equal(JSON.stringify(stats.amendmentSamples).includes("telephone"), false);
  assert.equal(stats.tags.contractAmendment, 1);
});

test("a window that outlasts the hard time limit is cut short and retried next run", async () => {
  const cfg = settings({ PUBLISHED_DAYS: "1", ENDING_DAYS: "6", BUDGET_SECONDS: "50", HARD_SECONDS: "20" });
  const start = Date.parse("2026-11-18T09:30:00Z");
  const state = newState(start, cfg);
  const byId = new Map();
  // 60 releases per window = 30 pages at one second each: longer than the limit.
  const stats = await sync(state, byId, cfg, fakeIo(fakeApi({ perWindow: 60 }), start));
  assert.equal(stats.errors.length, 1);
  assert.equal(stats.errors[0].error, "time limit");
  assert.ok(byId.size > 0); // what was read is kept
  assert.equal(state.cursors.contractPublished, "2026-11-17T00:00:00Z"); // but the cursor has not moved
  assert.equal(stats.windowsOk, 0);
});
