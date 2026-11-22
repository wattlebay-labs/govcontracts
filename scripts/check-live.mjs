// Check the published site after a deploy: ask the live address for a handful
// of pages and fail unless they are the build that was just made.
//
// What it asks for:
//   build.json                 the stamp of the build (waits until it is the expected one)
//   the home page, sitemap.xml, style.css
//   the first category, agency and supplier page named in the sitemap
//   the sample Bid Draft Pack page
//   an address that does not exist (must give the not-found page with a 404)
// Every HTML page must return 200, credit the source, say the figures are
// derived and say the site is not a government one. The sample pack must also
// credit the document it was made from and say what it is and is not.
//
// Settings (environment):
//   SITE_URL          address of the site (required)
//   EXPECT_GENERATED  `generatedAt` of the build that was deployed (optional)
//   EXPECT_PAGES      number of HTML pages that build made (optional)
//   WAIT_SECONDS      how long to wait for the new build to be served (default 300)
//   CHECK_TAG         added to each address as ?v=…, so a cached copy of an
//                     earlier deploy is not what answers
import { appendFile } from "node:fs/promises";

const UA = "govcontracts-check/0.1 (+https://github.com/wattlebay-labs/govcontracts)";

// The three statements every page must carry, as they appear in the HTML.
export const MUST_SAY = [
  ["source credit", /AusTender<\/a> contract notices, Department of Finance/],
  ["licence", /CC BY 3\.0 AU/],
  ["derived-data statement", /derived from that data/],
  ["not-affiliated statement", /not affiliated with/],
];

// What the sample Bid Draft Pack page must also say.
export const SAMPLE_MUST_SAY = [
  ["credit for the tender document", /Exposure Draft of the 2025 National Panel of Assessors program RFT/],
  ["licence of the tender document", /creativecommons\.org\/licenses\/by\/4\.0\//],
  ["statement that it is a sample", /This is a sample, not a real bid/],
  ["statement that the bidder is invented", /is invented/],
  ["statement that nothing is promised", /Nothing here is a promise/],
  ["statement of how it was made", /prepared with AI software/],
];

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function checkSite({
  siteUrl,
  expectGenerated = null,
  expectPages = null,
  waitSeconds = 300,
  tag = "",
  fetchImpl = fetch,
  sleep = realSleep,
  now = Date.now,
  log = () => {},
}) {
  const site = String(siteUrl || "").replace(/\/+$/, "");
  if (!/^https?:\/\/[^/]+/.test(site)) throw new Error("SITE_URL is not an address");
  const results = [];
  const note = (name, ok, detail) => {
    results.push({ name, ok, detail });
    log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
    return ok;
  };
  const withTag = (url) => (tag ? `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(tag)}` : url);
  const get = async (url) => {
    try {
      const res = await fetchImpl(withTag(url), {
        headers: { "user-agent": UA },
        redirect: "follow",
        signal: AbortSignal.timeout(30000),
      });
      return { status: res.status, type: res.headers?.get?.("content-type") || "", text: await res.text() };
    } catch (err) {
      return { status: 0, type: "", text: "", error: String(err?.message || err) };
    }
  };
  const describe = (r) => (r.error ? `no answer (${r.error})` : `HTTP ${r.status}, ${r.text.length} characters`);

  // 1. Wait until the stamp of the new build is what the address serves. A
  // first deploy, or a busy day, can take a minute or two to appear.
  const deadline = now() + waitSeconds * 1000;
  let stamp = null;
  let last = null;
  let tries = 0;
  for (;;) {
    tries++;
    last = await get(`${site}/build.json`);
    if (last.status === 200) {
      try {
        stamp = JSON.parse(last.text);
      } catch {
        stamp = null;
      }
    }
    if (stamp && (!expectGenerated || stamp.generatedAt === expectGenerated)) break;
    if (now() >= deadline) break;
    await sleep(10000);
  }
  if (!stamp) {
    note("build stamp", false, `${site}/build.json gave ${describe(last)} after ${tries} tries`);
    return { ok: false, results };
  }
  if (expectGenerated && stamp.generatedAt !== expectGenerated) {
    note("build stamp", false, `live build is ${stamp.generatedAt}, expected ${expectGenerated}, after ${tries} tries`);
    return { ok: false, results };
  }
  note("build stamp", true, `build ${stamp.generatedAt} is live (try ${tries})`);

  const page = async (name, url, wantStatus = 200, alsoSay = []) => {
    const r = await get(url);
    const problems = [];
    if (r.status !== wantStatus) problems.push(`expected HTTP ${wantStatus}`);
    for (const [what, pattern] of [...MUST_SAY, ...alsoSay]) if (!pattern.test(r.text)) problems.push(`no ${what}`);
    note(name, problems.length === 0, `${url} gave ${describe(r)}${problems.length ? `: ${problems.join(", ")}` : ""}`);
    return r;
  };

  // 2. Home page.
  await page("home page", `${site}/`);

  // 3. Sitemap: right size, and only this site's addresses.
  const map = await get(`${site}/sitemap.xml`);
  const locs = [...map.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
  const foreign = locs.filter((u) => !u.startsWith(`${site}/`));
  const mapProblems = [];
  if (map.status !== 200) mapProblems.push("expected HTTP 200");
  if (locs.length === 0) mapProblems.push("no addresses in it");
  if (foreign.length) mapProblems.push(`${foreign.length} addresses are not under ${site}/ (first: ${foreign[0]})`);
  // The sitemap lists every page except the not-found page.
  if (expectPages !== null && locs.length && locs.length !== expectPages - 1) {
    mapProblems.push(`lists ${locs.length} pages, the build made ${expectPages - 1} besides the not-found page`);
  }
  note("sitemap", mapProblems.length === 0, `${site}/sitemap.xml gave ${describe(map)}, ${locs.length} addresses${mapProblems.length ? `: ${mapProblems.join(", ")}` : ""}`);

  // 4. One page of each kind, taken from the sitemap.
  for (const kind of ["category", "agency", "supplier"]) {
    const url = locs.find((u) => u.startsWith(`${site}/${kind}/`));
    if (!url) {
      note(`${kind} page`, false, "the sitemap names none");
      continue;
    }
    const r = await page(`${kind} page`, url);
    if (r.status === 200 && !r.text.includes(`<link rel="canonical" href="${url.replace(/&/g, "&amp;")}">`)) {
      note(`${kind} page address`, false, `${url} does not name itself as its canonical address`);
    }
  }

  // 5. The sample Bid Draft Pack: listed in the sitemap, and says what it is.
  const sampleUrl = `${site}/sample-pack/`;
  if (locs.length && !locs.includes(sampleUrl)) note("sample pack in sitemap", false, `the sitemap does not name ${sampleUrl}`);
  await page("sample pack page", sampleUrl, 200, SAMPLE_MUST_SAY);

  // 6. Stylesheet.
  const css = await get(`${site}/style.css`);
  note("stylesheet", css.status === 200 && css.text.length > 0 && /css/.test(css.type), `${site}/style.css gave ${describe(css)}, type "${css.type}"`);

  // 7. An address that does not exist gives the site's own not-found page.
  const missing = await page("not-found page", `${site}/no-such-page-${tag || "check"}/`, 404);
  if (missing.status === 404 && !/Page not found/.test(missing.text)) note("not-found page text", false, "the 404 answer is not the site's own page");

  return { ok: results.every((r) => r.ok), results, stamp, sitemapCount: locs.length };
}

async function main() {
  const siteUrl = process.env.SITE_URL;
  const expectPages = process.env.EXPECT_PAGES ? Number(process.env.EXPECT_PAGES) : null;
  const out = await checkSite({
    siteUrl,
    expectGenerated: process.env.EXPECT_GENERATED || null,
    expectPages: Number.isFinite(expectPages) ? expectPages : null,
    waitSeconds: Number(process.env.WAIT_SECONDS) || 300,
    tag: process.env.CHECK_TAG || "",
    log: console.log,
  });
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = out.results.map((r) => `| ${r.ok ? "ok" : "FAIL"} | ${r.name} | ${r.detail.replace(/\|/g, "\\|")} |`).join("\n");
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Live site check: ${out.ok ? "passed" : "FAILED"}\n\n| | Check | Result |\n|---|---|---|\n${rows}\n`);
  }
  console.log(out.ok ? "Live site check passed" : "Live site check FAILED");
  if (!out.ok) process.exit(1);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  await main();
}
