// Run with: node --test scripts/check-live.test.mjs
// The "live site" here is the build's own output for made-up records, served
// by a stand-in for fetch, so the check and the build cannot drift apart.
import test from "node:test";
import assert from "node:assert/strict";
import { analyse, pages, titlesOf } from "./build.mjs";
import { checkSite } from "./check-live.mjs";

const SITE = "https://example.org/site";
const NOW = Date.parse("2026-11-19T08:00:00Z");
const STAMP = "2026-11-19T08:00:05Z";

const rec = (over = {}) => ({
  id: "CN0000001",
  description: "Example services",
  agency: "Department of Examples",
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

// path -> body, as the build would write it, plus the stamp file.
// A made-up titles file, as make-titles.mjs would write it.
const TITLES = {
  source: {
    file: "Made-up Customised UNSPSC Codeset 1 July 2023.xlsx",
    publisher: "Department of Finance",
    datasetUrl: "https://data.gov.au/data/dataset/made-up",
    licenceId: "cc-by",
    licence: "Creative Commons Attribution 3.0 Australia",
    licenceUrl: "http://creativecommons.org/licenses/by/3.0/au/",
  },
  titles: { 80101500: "Made-up advisory services" },
};

function builtSite({ titles = null } = {}) {
  const model = analyse([rec(), rec({ id: "CN0000002", supplierAbn: "33333333333", supplier: "Other & Sons", agency: "Bureau of Samples" })], NOW, {
    titles: titles ? titlesOf(titles) : null,
  });
  const files = new Map();
  let html = 0;
  for (const f of pages(model, { siteUrl: SITE, css: "body{margin:0}", updated: "2026-11-19T00:34:21Z" })) {
    if (f.path === null) continue;
    files.set(f.path, f.body);
    if (f.path.endsWith(".html")) html++;
  }
  files.set("build.json", JSON.stringify({ generatedAt: STAMP, pages: { total: html }, titledCategories: model.categories.filter((c) => c.title).length }));
  return { files, html };
}

// A stand-in for fetch that serves `files` the way a static host does.
function host(files, { calls = [] } = {}) {
  return async (url) => {
    calls.push(url);
    const u = new URL(url);
    assert.ok(url.startsWith(`${SITE}/`), `asked for an address outside the site: ${url}`);
    let path = u.pathname.slice(new URL(SITE).pathname.length + 1);
    if (path === "" || path.endsWith("/")) path += "index.html";
    const type = path.endsWith(".css") ? "text/css; charset=utf-8" : path.endsWith(".xml") ? "application/xml" : path.endsWith(".json") ? "application/json" : "text/html; charset=utf-8";
    const answer = (status, body, t = type) => ({ status, headers: { get: (h) => (h === "content-type" ? t : null) }, text: async () => body });
    if (files.has(path)) return answer(200, files.get(path));
    return answer(404, files.get("404.html") ?? "Not Found", "text/html; charset=utf-8");
  };
}

const run = (files, over = {}) =>
  checkSite({ siteUrl: `${SITE}/`, expectGenerated: STAMP, waitSeconds: 30, tag: "t1", fetchImpl: host(files), sleep: async () => {}, ...over });

test("a freshly built site passes every check", async () => {
  const { files, html } = builtSite();
  const calls = [];
  const out = await run(files, { expectPages: html, fetchImpl: host(files, { calls }) });
  assert.deepEqual(out.results.filter((r) => !r.ok), []);
  assert.equal(out.ok, true);
  assert.equal(out.sitemapCount, html - 1);
  assert.deepEqual(
    out.results.map((r) => r.name),
    ["build stamp", "home page", "sitemap", "category page", "agency page", "supplier page", "sample pack page", "stylesheet", "not-found page"],
  );
  assert.ok(calls.every((u) => u.includes("v=t1")), "every request carries the tag");
});

test("it waits for the new build to appear, then passes", async () => {
  const { files } = builtSite();
  const fresh = files.get("build.json");
  files.set("build.json", JSON.stringify({ generatedAt: "2026-11-18T08:00:00Z" }));
  let slept = 0;
  const out = await run(files, {
    sleep: async () => {
      if (++slept === 2) files.set("build.json", fresh);
    },
  });
  assert.equal(out.ok, true);
  assert.equal(slept, 2);
});

test("an old build still being served is a failure", async () => {
  const { files } = builtSite();
  files.set("build.json", JSON.stringify({ generatedAt: "2026-11-18T08:00:00Z" }));
  let t = 0;
  const out = await run(files, { now: () => (t += 20000) });
  assert.equal(out.ok, false);
  assert.match(out.results[0].detail, /live build is 2026-11-18T08:00:00Z, expected 2026-11-19T08:00:05Z/);
});

test("a site that is not there at all is a failure, not a crash", async () => {
  let t = 0;
  const out = await checkSite({
    siteUrl: SITE,
    waitSeconds: 30,
    fetchImpl: async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    },
    sleep: async () => {},
    now: () => (t += 20000),
  });
  assert.equal(out.ok, false);
  assert.match(out.results[0].detail, /no answer \(getaddrinfo ENOTFOUND\)/);
});

test("a page without the source credit fails", async () => {
  const { files } = builtSite();
  files.set("index.html", files.get("index.html").replace(/<footer[\s\S]*<\/footer>/, ""));
  const out = await run(files);
  assert.equal(out.ok, false);
  const home = out.results.find((r) => r.name === "home page");
  assert.equal(home.ok, false);
  assert.match(home.detail, /no source credit, no licence, no derived-data statement, no not-affiliated statement/);
});

test("a missing page and a wrong page count are both reported", async () => {
  const { files, html } = builtSite();
  const supplier = [...files.keys()].find((p) => p.startsWith("supplier/"));
  files.delete(supplier);
  const out = await run(files, { expectPages: html + 5 });
  assert.equal(out.ok, false);
  const failed = out.results.filter((r) => !r.ok).map((r) => r.name);
  assert.deepEqual(failed, ["sitemap", "supplier page"]);
});

test("a sample pack that stops saying what it is fails", async () => {
  const { files } = builtSite();
  const page = files.get("sample-pack/index.html");
  files.set("sample-pack/index.html", page.replace("This is a sample, not a real bid", "This is a bid").replace(/prepared with AI software/g, "prepared"));
  const out = await run(files);
  assert.equal(out.ok, false);
  const sample = out.results.find((r) => r.name === "sample pack page");
  assert.match(sample.detail, /no statement that it is a sample, no statement of how it was made/);
});

test("a sample pack without credit for its source document, or missing altogether, fails", async () => {
  const { files } = builtSite();
  const page = files.get("sample-pack/index.html");
  files.set("sample-pack/index.html", page.replaceAll("Exposure Draft of the 2025 National Panel of Assessors program RFT", "a tender"));
  let out = await run(files);
  assert.match(out.results.find((r) => r.name === "sample pack page").detail, /no credit for the tender document/);
  files.delete("sample-pack/index.html");
  files.set("sitemap.xml", files.get("sitemap.xml").replace(/<url><loc>[^<]*sample-pack\/<\/loc>.*<\/url>\n/, ""));
  out = await run(files);
  assert.deepEqual(out.results.filter((r) => !r.ok).map((r) => r.name), ["sample pack in sitemap", "sample pack page"]);
});

test("a host without the site's own not-found page fails", async () => {
  const { files } = builtSite();
  files.delete("404.html");
  const out = await run(files);
  assert.deepEqual(out.results.filter((r) => !r.ok).map((r) => r.name), ["not-found page", "not-found page text"]);
});

test("a sitemap pointing somewhere else fails", async () => {
  const { files } = builtSite();
  files.set("sitemap.xml", files.get("sitemap.xml").replace(`${SITE}/about/`, "https://elsewhere.example/about/"));
  const out = await run(files);
  assert.equal(out.results.find((r) => r.name === "sitemap").ok, false);
});

test("an address is required", async () => {
  await assert.rejects(() => checkSite({ siteUrl: "" }), /SITE_URL/);
});

test("a site built with category titles passes, and the category page is asked for their credit", async () => {
  const { files, html } = builtSite({ titles: TITLES });
  assert.equal(JSON.parse(files.get("build.json")).titledCategories, 1);
  const out = await run(files, { expectPages: html });
  assert.deepEqual(out.results.filter((r) => !r.ok), []);
  assert.equal(out.ok, true);
});

test("category titles without the credit for the codeset, or without saying whose code it is, fail", async () => {
  const path = "category/80101500/index.html";
  const spoil = async (change) => {
    const { files } = builtSite({ titles: TITLES });
    files.set(path, change(files.get(path)));
    const out = await run(files);
    assert.equal(out.ok, false);
    assert.deepEqual(out.results.filter((r) => !r.ok).map((r) => r.name), ["category page"]);
    return out.results.find((r) => r.name === "category page").detail;
  };
  assert.match(await spoil((page) => page.replace(/<p>Category titles are from[^\n]*<\/p>\n/, "")), /no credit for the category titles, no licence of the category titles, no statement of whose code UNSPSC is/);
  assert.match(await spoil((page) => page.replace(/, of the United Nations Development Programme/, "")), /: no statement of whose code UNSPSC is$/);
  assert.match(await spoil((page) => page.replace(/, licensed under <a[^>]*>Creative Commons Attribution 3\.0 Australia<\/a>/, "")), /: no licence of the category titles$/);
  assert.match(await spoil((page) => page.replace(/Codeset 1 July 2023<\/a>, Department of Finance,/, "Codeset 1 July 2023</a>,")), /: no credit for the category titles$/);
});

test("a site built without category titles is not asked for their credit", async () => {
  const { files } = builtSite();
  assert.equal(JSON.parse(files.get("build.json")).titledCategories, 0);
  assert.doesNotMatch(files.get("category/80101500/index.html"), /Category titles/);
  assert.equal((await run(files)).ok, true);
  // a stamp from before titles existed says nothing about them, and still passes
  files.set("build.json", JSON.stringify({ generatedAt: STAMP }));
  assert.equal((await run(files)).ok, true);
});
