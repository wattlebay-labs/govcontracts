// Fetch each candidate source once, politely, and save status + a sample.
import { mkdir, writeFile } from "node:fs/promises";

const UA = "govcontracts-probe/0.1 (+https://github.com/wattlebay-labs/govcontracts)";
const day = (offset) => new Date(Date.now() - offset * 864e5).toISOString().slice(0, 10);

const sources = [
  ["austender-rss", "https://www.tenders.gov.au/public_data/rss/rss.xml"],
  ["austender-atm-list", "https://www.tenders.gov.au/atm"],
  ["austender-ocds-contracts", `https://api.tenders.gov.au/ocds/findByDates/contractPublished/${day(3)}T00:00:00Z/${day(2)}T00:00:00Z`],
  ["nsw-ocds-tenders", "https://www.tenders.nsw.gov.au/?event=public.api.tender.search&ResultsPerPage=20"],
  ["nsw-buy-opportunities", "https://buy.nsw.gov.au/opportunity/search"],
  ["qld-qtenders", "https://qtenders.epw.qld.gov.au/qtenders/tender/search/tender-search.do?action=advanced-tender-search-open-tender"],
  ["vic-tenders", "https://www.tenders.vic.gov.au/tender/search?preset=open"],
  ["wa-tenders", "https://www.tenders.wa.gov.au/watenders/tender/search/tender-search.do?action=advanced-tender-search-open-tender"],
  ["sa-tenders", "https://www.tenders.sa.gov.au/tender/search?preset=open"],
  ["tas-tenders", "https://www.tenders.tas.gov.au/OpenForBids/List"],
];

await mkdir("probe", { recursive: true });
const summary = [];
for (const [name, url] of sources) {
  const row = { name, url };
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(30000),
    });
    const body = await res.text();
    row.status = res.status;
    row.finalUrl = res.url;
    row.contentType = res.headers.get("content-type");
    row.bytes = body.length;
    await writeFile(`probe/${name}.sample.txt`, body.slice(0, 60000));
  } catch (err) {
    row.error = String(err?.cause?.code || err?.message || err);
  }
  summary.push(row);
  console.log(JSON.stringify(row));
  await new Promise((r) => setTimeout(r, 1500));
}
await writeFile("probe/summary.json", JSON.stringify(summary, null, 2));
