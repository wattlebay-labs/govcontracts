// Run with: node --test scripts/build.test.mjs
// All records here are made up.
import test from "node:test";
import assert from "node:assert/strict";
import { posix } from "node:path";
import { BIDDER, CHECKLIST, DRAFTS, OUTLINE, SOURCE, STATUSES } from "./sample-pack.mjs";
import {
  addDays,
  analyse,
  cleanAbn,
  commonest,
  coverageOf,
  describeCode,
  esc,
  fmtAbn,
  fmtDate,
  localDate,
  money,
  moneyShort,
  pages,
  pick,
  plausible,
  slug,
} from "./build.mjs";

const NOW = Date.parse("2026-11-19T08:00:00Z"); // 19 Nov 2026, evening in Canberra

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
  rec(),
  rec({ id: "CN0000002", supplier: "Example Pty Ltd", value: 5000, end: "2026-12-30T13:00:00Z", amendment: true }),
  rec({ id: "CN0000003", supplier: "Example Pty Ltd", value: 250.5, end: "2026-11-01T13:00:00Z" }), // already ended
  rec({ id: "CN0000004", supplier: "Overseas Co", supplierAbn: null, supplierState: null, value: 70000, unspsc: "43230000" }),
  rec({ id: "CN0000005", supplier: "Other & Sons <b>", supplierAbn: "33 333 333 333", agency: "Bureau of Samples", description: '<script>alert("x")</script>' }),
  rec({ id: "CN0000006", supplierAbn: "33333333333", supplier: "Other & Sons <b>", end: "1900-01-01T00:00:00Z", value: null }),
  rec({ id: "CN0000007", supplierAbn: "44444444444", supplier: "3 Rivers Co", unspsc: null, end: "2028-01-01T13:00:00Z" }), // beyond 12 months
  rec({ id: "CN0000008", supplierAbn: "55555555555", supplier: "Élan Consulting", agency: "Bureau of Samples", description: null, end: null }),
];

const build = (records = sample, opts = {}) => {
  const model = analyse(records, NOW);
  const files = new Map();
  let broken = null;
  for (const f of pages(model, { siteUrl: "https://example.org/site", css: "body{}", updated: "2026-11-19T00:34:21Z", ...opts })) {
    if (f.path === null) broken = f.broken;
    else files.set(f.path, f.body);
  }
  return { model, files, broken };
};

test("esc neutralises markup", () => {
  assert.equal(esc(`<a href="x">Tom & 'Jerry'</a>`), "&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;");
  assert.equal(esc(null), "");
});

test("slug makes safe, stable path parts", () => {
  assert.equal(slug("Department of Home Affairs"), "department-of-home-affairs");
  assert.equal(slug("  Arts & Culture — Québec/Office  "), "arts-and-culture-quebec-office");
  assert.equal(slug("../../etc"), "etc");
  assert.equal(slug(""), "");
  assert.ok(slug("x".repeat(200)).length <= 80);
});

test("localDate reads the Canberra calendar date in summer and winter", () => {
  assert.equal(localDate("2026-11-19T13:00:00Z"), "2026-11-20"); // daylight time, UTC+11
  assert.equal(localDate("2028-04-27T14:00:00Z"), "2028-04-28"); // standard time, UTC+10
  assert.equal(localDate("not a date"), null);
  assert.equal(localDate(null), null);
});

test("plausible rejects dates that cannot be right", () => {
  assert.equal(plausible(localDate("1900-01-01T00:00:00Z")), null);
  assert.equal(plausible("2027-06-30"), "2027-06-30");
  assert.equal(plausible(null), null);
});

test("date and money formatting", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2028-03-01", -1), "2028-02-29");
  assert.equal(fmtDate("2027-06-05"), "5 Jun 2027");
  assert.equal(fmtDate(null), "not stated");
  assert.equal(money(1234567.6), "$1,234,568");
  assert.equal(money(null), "not stated");
  assert.equal(moneyShort(129311853009), "$129.3 billion");
  assert.equal(moneyShort(2500000), "$2.5 million");
  assert.equal(moneyShort(999), "$999");
});

test("ABNs are cleaned and formatted", () => {
  assert.equal(cleanAbn("49 626 304 578"), "49626304578");
  assert.equal(cleanAbn("1234"), null);
  assert.equal(cleanAbn("../../../etc/x"), null);
  assert.equal(cleanAbn(null), null);
  assert.equal(fmtAbn("49626304578"), "49 626 304 578");
});

test("commonest ignores case and spacing and is stable on ties", () => {
  assert.deepEqual(commonest(["ICT  Services", "ict services", "ICT Services", "Cleaning", null, ""], 2), ["ICT Services", "Cleaning"]);
  assert.deepEqual(commonest(["b", "a"], 1), ["a"]);
  assert.deepEqual(commonest([], 3), []);
});

test("a code is only labelled by a description that recurs", () => {
  const many = (text, n) => Array.from({ length: n }, () => text);
  assert.deepEqual(describeCode([...many("Labour Hire", 4), ...many("ICT Labour Hire", 2), "One-off study"]), {
    label: "Labour Hire",
    typical: ["Labour Hire", "ICT Labour Hire"],
  });
  // Every contract described differently: no label, nothing typical.
  assert.deepEqual(describeCode(["Wheat genetics study", "Barley head-loss study", "Snail biocontrol"]), { label: null, typical: [] });
  // Recurs, but too rarely to stand for the code.
  const rare = describeCode([...many("Vehicle Spare Parts", 3), ...Array.from({ length: 97 }, (_, i) => `Item ${i}`)]);
  assert.equal(rare.label, null);
  assert.deepEqual(rare.typical, ["Vehicle Spare Parts"]);
  // In a very large code, 20 identical descriptions are enough.
  assert.equal(describeCode([...many("Software", 20), ...Array.from({ length: 980 }, (_, i) => `Item ${i}`)]).label, "Software");
  assert.deepEqual(describeCode([null, ""]), { label: null, typical: [] });
});

test("analyse groups by category, agency and supplier ABN", () => {
  const m = analyse(sample, NOW);
  assert.equal(m.today, "2026-11-19");
  assert.equal(m.rows.length, 8);
  assert.deepEqual(m.categories.map((c) => c.code), ["43230000", "80101500"]);
  assert.deepEqual(m.agencies.map((a) => a.slug), ["bureau-of-samples", "department-of-examples"]);
  // Suppliers without an ABN get no page; names differing only by case are one supplier.
  assert.deepEqual(m.suppliers.map((s) => s.abn).sort(), ["11111111111", "33333333333", "44444444444", "55555555555"]);
  const example = m.suppliers.find((s) => s.abn === "11111111111");
  assert.equal(example.name, "Example Pty Ltd");
  assert.equal(example.count, 3);
  assert.equal(example.value, 6250.5);
  assert.equal(example.soonCount, 2); // one of the three has already ended
  assert.equal(m.skipped.noSupplierAbn, 1);
  assert.equal(m.skipped.noCategory, 1);
  assert.equal(m.skipped.badEndDate, 1);
  assert.equal(m.skipped.noValue, 1);
});

test("'ending in the next 12 months' means today up to 365 days ahead", () => {
  const ends = (end) => analyse([rec({ end })], NOW).rows[0].soon;
  assert.equal(ends("2026-11-18T13:00:00Z"), true); // today, 19 Nov in Canberra
  assert.equal(ends("2026-11-17T13:00:00Z"), false); // yesterday
  assert.equal(ends("2027-11-17T13:00:00Z"), true); // 18 Nov 2027, day 364
  assert.equal(ends("2027-11-18T13:00:00Z"), false); // 19 Nov 2027, day 365
  assert.equal(ends("1900-01-01T00:00:00Z"), false);
  assert.equal(ends(null), false);
});

test("month table covers every month of the window and adds up", () => {
  const m = analyse(sample, NOW);
  assert.equal(m.months[0].ym, "2026-11");
  assert.equal(m.months.at(-1).ym, "2027-11");
  assert.equal(m.months.length, 13);
  assert.equal(m.months.reduce((s, x) => s + x.count, 0), m.totals.soonCount);
});

test("agencies whose names give the same slug get different pages", () => {
  const m = analyse([rec({ agency: "Example Agency" }), rec({ id: "CN2", agency: "Example  Agency!" }), rec({ id: "CN3", agency: "Example-Agency" })], NOW);
  assert.equal(new Set(m.agencies.map((a) => a.slug)).size, m.agencies.length);
});

test("pick keeps the largest rows and returns them in end-date order", () => {
  const rows = analyse(
    [1, 2, 3, 4, 5].map((i) => rec({ id: `CN${i}`, value: i * 100, end: `2027-0${6 - i}-10T14:00:00Z` })),
    NOW,
  ).rows;
  const shown = pick(rows, 2);
  assert.deepEqual(shown.map((r) => r.id), ["CN5", "CN4"]);
  assert.equal(pick(rows, 10).length, 5);
});

test("the site has a page for every category, agency and supplier", () => {
  const { files } = build();
  for (const path of [
    "index.html",
    "categories/index.html",
    "category/80101500/index.html",
    "category/43230000/index.html",
    "agencies/index.html",
    "agency/department-of-examples/index.html",
    "agency/bureau-of-samples/index.html",
    "suppliers/index.html",
    "suppliers/e/index.html",
    "suppliers/o/index.html",
    "suppliers/0-9/index.html",
    "supplier/11111111111/index.html",
    "supplier/33333333333/index.html",
    "about/index.html",
    "sample-pack/index.html",
    "404.html",
    "sitemap.xml",
    "style.css",
  ]) {
    assert.ok(files.has(path), `missing ${path}`);
  }
  assert.ok(![...files.keys()].some((p) => p.includes("null") || p.includes("undefined")));
});

test("every page credits the source, says the data is derived and denies affiliation", () => {
  const { files } = build();
  for (const [path, body] of files) {
    if (!path.endsWith(".html")) continue;
    assert.match(body, /AusTender<\/a> contract notices, Department of Finance/, path);
    assert.match(body, /creativecommons\.org\/licenses\/by\/3\.0\/au\//, path);
    assert.match(body, /CC BY 3\.0 AU/, path);
    assert.match(body, /derived from that data/, path);
    assert.match(body, /not affiliated with, or endorsed by, the Australian Government/, path);
    assert.match(body, /<title>[^<]+<\/title>/, path);
    assert.match(body, /<meta name="description" content="[^"]+">/, path);
    assert.ok(!/undefined|NaN|\[object/.test(body), `${path} prints a missing value`);
  }
});

test("every internal link leads to a page that exists", () => {
  const { files, broken } = build();
  assert.deepEqual(broken, []);
  let checked = 0;
  for (const [path, body] of files) {
    if (!path.endsWith(".html") || path === "404.html") continue;
    for (const [, href] of body.matchAll(/href="([^"]*)"/g)) {
      if (/^https?:/.test(href)) continue;
      const target = posix.normalize(posix.join(posix.dirname(path), href));
      const file = target === "." || target === "./" ? "index.html" : target.endsWith("/") ? `${target}index.html` : target;
      assert.ok(files.has(file), `${path} links to ${href} (${file}), which is not built`);
      checked++;
    }
  }
  assert.ok(checked > 50);
  // The not-found page can be served from any depth, so its links are absolute.
  assert.match(files.get("404.html"), /href="\/site\/categories\/"/);
  assert.match(files.get("404.html"), /href="\/site\/style\.css"/);
});

test("text from notices is escaped everywhere", () => {
  const { files } = build();
  for (const [path, body] of files) {
    assert.ok(!body.includes("<script"), `${path} lets a script tag through`);
    assert.ok(!body.includes("Sons <b>"), `${path} lets markup in a name through`);
  }
  assert.match(files.get("supplier/33333333333/index.html"), /Other &amp; Sons &lt;b&gt;/);
  assert.match(files.get("agency/bureau-of-samples/index.html"), /&lt;script&gt;alert/);
});

test("a supplier page shows its contracts and what is left out", () => {
  const page = build().files.get("supplier/11111111111/index.html");
  assert.match(page, /<h1>Example Pty Ltd<\/h1>/);
  assert.match(page, /ABN 11 111 111 111/);
  assert.match(page, /CN0000001/);
  assert.match(page, /CN0000002, amended/);
  assert.match(page, /30 Jun 2027/); // end date in Canberra time
  assert.match(page, /\$5,000/);
  assert.match(page, /href="\.\.\/\.\.\/agency\/department-of-examples\/"/);
  assert.match(page, /href="\.\.\/\.\.\/category\/80101500\/"/);
  assert.match(page, /not a full history/);
  assert.match(page, /<link rel="canonical" href="https:\/\/example\.org\/site\/supplier\/11111111111\/">/);
});

test("a category page lists expiring contracts but not ended or far-off ones", () => {
  const { files } = build();
  const page = files.get("category/80101500/index.html");
  assert.match(page, /Most common contract descriptions under this code: “Example services”/);
  assert.match(page, /<title>UNSPSC 80101500: Example services \|/);
  // One contract's wording is not used as the name of a code.
  assert.match(files.get("category/43230000/index.html"), /<title>UNSPSC 43230000 \|/);
  assert.match(files.get("category/43230000/index.html"), /each described differently/);
  assert.match(files.get("categories/index.html"), /varies by contract/);
  assert.match(page, /CN0000002/);
  const expiring = page.slice(page.indexOf("Contracts ending in the next 12 months"), page.indexOf("Largest suppliers"));
  assert.ok(!expiring.includes("CN0000003"), "ended contract listed as expiring");
  assert.ok(!expiring.includes("CN0000006"), "contract with an impossible end date listed as expiring");
  // A supplier with no ABN is named but not linked.
  const other = files.get("category/43230000/index.html");
  assert.match(other, /<td>Overseas Co<\/td>/);
  assert.ok(!other.includes("supplier/null"));
});

test("long lists are cut to the largest contracts and say so", () => {
  const many = Array.from({ length: 40 }, (_, i) => rec({ id: `CN${1000 + i}`, value: i + 1 }));
  const page = build(many, { cap: 10 }).files.get("category/80101500/index.html");
  assert.match(page, /The 10 largest of 40 contracts ending between 19 Nov 2026 and 18 Nov 2027/);
  assert.ok(page.includes("CN1039") && !page.includes("CN1000<"));
});

test("sitemap lists every indexable page once, with absolute addresses", () => {
  const { files } = build();
  const locs = [...files.get("sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.equal(new Set(locs).size, locs.length);
  assert.ok(locs.includes("https://example.org/site/"));
  assert.ok(locs.includes("https://example.org/site/supplier/11111111111/"));
  assert.ok(!locs.some((u) => u.includes("404")));
  assert.equal(locs.length, [...files.keys()].filter((p) => p.endsWith("index.html")).length);
});

test("coverage wording follows what the fetch has read", () => {
  const cov = coverageOf({
    datasetStarted: "2026-11-18T08:49:35Z",
    settings: { PUBLISHED_DAYS: 30 },
    horizon: { from: "2026-11-18T00:00:00Z", fetchedTo: "2027-11-20T00:00:00Z", complete: true },
  });
  assert.deepEqual(cov, { endFrom: "2026-11-19", endTo: "2027-11-20", publishedFrom: "2026-10-19" });
  assert.deepEqual(coverageOf({ horizon: { from: "2026-11-18T00:00:00Z", fetchedTo: "2027-06-30T00:00:00Z", complete: false } }), {});
  assert.deepEqual(coverageOf(null), {});
  const about = build(sample, { coverage: cov }).files.get("about/index.html");
  assert.match(about, /end date falls between 19 Nov 2026 and 20 Nov 2027, and notices published since 19 Oct 2026/);
  assert.match(build().files.get("about/index.html"), /roughly the next 12 months/);
});

test("the sample pack says what it is, what it was made from and what it does not promise", () => {
  const { files } = build();
  const page = files.get("sample-pack/index.html");
  assert.match(page, /This is a sample, not a real bid/);
  assert.match(page, /Nothing here is a promise/);
  assert.match(page, /No pack can promise that a bid will succeed, be shortlisted or be found compliant/);
  assert.match(page, /prepared with AI software/);
  assert.match(page, /does not endorse/);
  assert.match(page, /Packs are not on sale/);
  assert.ok(page.includes(`${BIDDER}, is invented`));
  // The source asks to be attributed in these words, and CC BY asks for the
  // licence, a link to the source and a note that it was changed.
  assert.equal(SOURCE.attribution, "Exposure Draft of the 2025 National Panel of Assessors program RFT");
  assert.ok(page.includes(`<a href="${SOURCE.url}" rel="noopener">${SOURCE.attribution}</a>`));
  assert.ok(page.includes(`href="${SOURCE.licenceUrl}"`));
  assert.match(page, /Creative Commons Attribution 4\.0 International/);
  assert.match(page, /summarised and restated from that document in other words/);
  assert.match(page, /Department of Social Services/);
  // No prices, no way to order, no placeholders left in, nothing typed by a visitor.
  assert.ok(!/A\$\d|\$490|\$99\b|\$29\b/.test(page), "the sample quotes a price for a pack");
  assert.ok(!/<form|<input|<script|mailto:/.test(page));
  assert.ok(!/\[[A-Z]{3,}[^\]]*\]/.test(page), "a square-bracket placeholder is showing");
});

test("every line of the sample checklist points at a section and has a status", () => {
  let rows = 0;
  for (const group of CHECKLIST) {
    assert.ok(group.heading && group.note);
    for (const [ref, need, how, status] of group.rows) {
      assert.match(ref, /^\d+(\.\d+)*([,;] | to | and |$)/, `section reference "${ref}"`);
      assert.ok(need.length > 20 && how.length > 5, ref);
      assert.ok(status in STATUSES, `status "${status}"`);
      rows++;
    }
  }
  assert.ok(rows >= 25);
  const page = build().files.get("sample-pack/index.html");
  assert.equal([...page.matchAll(/<span class="tag (\w+)">/g)].length, rows);
});

test("the sample drafts answer each criterion in the outline and flag what must be checked", () => {
  assert.deepEqual(DRAFTS.map((d) => d.name), OUTLINE.map((c) => c.name));
  const page = build().files.get("sample-pack/index.html");
  const flags = [...page.matchAll(/<mark class="chk">Check: [^<]+<\/mark>/g)].length;
  const written = DRAFTS.flatMap((d) => d.paragraphs).join(" ").match(/\[CHECK: /g).length;
  assert.equal(flags, written);
  assert.ok(flags >= 8);
  // The drafts must not promise an outcome.
  assert.ok(!/guarantee|will win|ensure success/i.test(DRAFTS.flatMap((d) => d.paragraphs).join(" ")));
});

test("the sample pack is linked from the home page, the about page and every footer, and is in the sitemap", () => {
  const { files } = build();
  assert.match(files.get("index.html"), /href="sample-pack\/">a sample Bid Draft Pack<\/a>/);
  assert.match(files.get("about/index.html"), /href="\.\.\/sample-pack\/">sample Bid Draft Pack<\/a>/);
  for (const [path, body] of files) {
    if (path.endsWith(".html")) assert.match(body, /sample-pack\/">Sample Bid Draft Pack<\/a><\/p>\n<\/footer>/, path);
  }
  assert.ok(files.get("sitemap.xml").includes("<loc>https://example.org/site/sample-pack/</loc>"));
});
