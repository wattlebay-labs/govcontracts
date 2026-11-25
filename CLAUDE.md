# govcontracts — working notes for Claude sessions

This repo is public. The operating plan and rules live outside it, in the owner's private
project docs; a session working here is told where to find them. Keep anything about the owner
or other work out of this repo, its commits and its site.

## Hard rules
- Zero spend. No secrets in this repo (it is public). No customer documents, ever.
- Official or openly licensed data only; credit the source on every page.
- Do NOT work around bot protection. Sources that return 403 to GitHub Actions stay off the list.
- No dependencies unless unavoidable: plain Node 22, built-in `fetch`, static HTML output.

## What works from GitHub Actions (probed 17 Nov 2026, see `probe/summary.json`)
- OK: AusTender OCDS contract-notice API, licence CC BY 3.0 AU (Department of Finance).
  `https://api.tenders.gov.au/ocds/findByDates/{contractPublished|contractStart|contractEnd|contractLastModified}/{fromISO}/{toISO}`
  Response: `{ releases: [ { parties[], awards[], contracts[ {id: "CN…", description, period{startDate,endDate}, value{amount}, items[].classification(UNSPSC)} ], tender{procurementMethod} } ] }`
  Supplier ABN is in `parties[].additionalIdentifiers` (scheme `AU-ABN`), role `supplier`; buyer has role `procuringEntity`.
- BLOCKED (403, CloudFront/Cloudflare): AusTender open-tender pages and RSS, NSW, VIC, SA, WA portals.
- Unclear: QLD QTenders (redirects to a new site), TAS (error page). Not yet usable.

## Data pipeline (`scripts/fetch.mjs`, workflow `fetch-data`)
- The dataset is `data/contracts.json` (one compact record per contract, amendments filed under the
  parent CN) plus `data/state.json` (cursors). Neither is committed: both travel between runs in the
  workflow cache (`dataset-v1-*`, newest wins) and are also uploaded as the `contracts` artifact.
  Only `data/summary.json` is committed; read it to see what the last run did.
- Each run does three pulls in 7-day windows under a time budget (`BUDGET_SECONDS`): `contractPublished`
  and `contractLastModified` from their cursors to now, then `contractEnd` from its cursor towards
  today + 365 days. A cursor only moves past a window that came back complete, so a run that stops
  early or hits an error is picked up by the next one. A new dataset takes several runs to fill
  (`horizon.complete` in the summary says when it has).
- Measured 18 Nov 2026: about 3.5 seconds per page of 100 releases; 143 releases a day by publish date;
  end dates bunch up: the week of 31 December returned 7,378 releases (75 pages) and the week of
  30 June 25,025 releases (252 pages, 14 minutes) in one window. A window is never cut short by the
  budget, only by `HARD_SECONDS`, which stops a run before the job time limit.
- After two runs (18 Nov 2026): 34,947 contracts, 9,116 supplier ABNs, 135 agencies, 486 UNSPSC
  codes, 15.5 MB of JSON (1.8 MB in the cache), horizon fetched to 30 June 2027.
- How the API reports amendments (seen in live data): the release is tagged `contractAmendment`,
  `contracts[0].id` stays the parent CN, `contracts[0].amendments[].id` is `CN…-A1`, and
  `value.amount` is the new total contract value, not the change. So the newest release per CN is the
  current state of the contract. `contractLastModified` returns both new notices and amendments.
- A date range with no notices in it (first seen on a weekend, 22 Nov 2026) is answered with HTTP 400 and
  `{"errorCode": 100, "message": "No Records found for Date Range […]"}`. The script counts that as an
  empty window (`emptyWindows` in the summary) and moves the cursor on; any other 400 is still an error.
  This is also what the unexplained 400 of 18 Nov was (a window less than an hour long).
- End dates are not all sane (one is 1900-01-01): anything that sorts or filters by date must cope.
- If the cache is lost (unused for 7 days) the script starts a new dataset by itself.
- A later job that needs the data (site build) should run in the same workflow after the fetch, or
  restore the same cache.

## Site build (`scripts/build.mjs`, a step of `fetch-data` after the dataset is saved)
- Reads `data/contracts.json` (+ `data/summary.json` for the coverage dates), writes `site/` (ignored by
  git) and `data/build.json` (committed: page counts, bytes, skipped records, broken links, top
  categories). Read `data/build.json` to see what the last build made.
- Pages: home, `categories/`, `category/<unspsc>/`, `agencies/`, `agency/<slug>/`, `suppliers/`,
  `suppliers/<letter>/`, `supplier/<abn>/`, `about/`, `sample-pack/`, `404.html`, `sitemap.xml`, `style.css`
  (source: `scripts/style.css`). All links are relative; only canonical links, the sitemap and
  `404.html` use `SITE_URL` (default: the GitHub Pages address).
- Dates on notices are midnight in Canberra given as UTC, so the build shows the calendar date in
  `Australia/Sydney`. "Ending in the next 12 months" is today to today + 364 days in that zone.
  End dates outside 1990 to 2100 are treated as not stated.
- Long tables are cut to the 150 largest contracts by value, shown in end-date order, and say so.
- UNSPSC codes have no titles in the API. Pages show the code and, where one recurs, the most common
  contract description under it (`describeCode`: 3 contracts and 5% of the code, or 20 contracts),
  and say that this is not the official title. In some codes every contract is described differently
  (seen live: research grants under 70140000), so those get no label. Do not add titles from memory.
- Suppliers are grouped by ABN under their most common name; suppliers without an ABN are named in
  tables but get no page. Agency slugs come from the name (a number is added on a clash).
- The build fails if any internal link points at a page it did not make. Tests use made-up records.
- The build also writes `site/build.json` (`generatedAt`, `dataUpdated`, page counts): the stamp the
  deploy check reads from the live address.

## Sample Bid Draft Pack (`scripts/sample-pack.mjs`, page `sample-pack/`, live since 22 Nov 2026)
- One worked sample: the tender at a glance, a compliance checklist (28 lines, each with its section), a
  response outline, first-draft answers for an invented bidder with "Check" flags, and what is left to
  settle. The content is data at the top of the file; `build.mjs` only places the page. It is linked from
  the home page, the about page and every footer, and is in the sitemap.
- Source: the Exposure Draft of the 2025 National Panel of Assessors program RFT, Department of Social
  Services, August 2024, a PDF on engage.dss.gov.au (address in `SOURCE.url`). Its licence page gives
  CC BY 4.0 and the attribution wording, which must stay exactly as it is in `SOURCE.attribution`.
- How it was read: the cloud shell has no internet, so the PDF was read through the session's web fetch,
  which returned sections 1 to 8.14.14 word for word and only a summary of the rest. Every factual line on
  the page was then checked against the word-for-word part. The end of 8.14, Appendices A to F, the Draft
  Deed and the tender form were not read, and the page says so. Do not add claims about those parts.
- Some headings in the draft have no printed number (minimum content, ESAs, coverage, modern slavery,
  insurance, tax residency): cite them as "3, Coverage" and so on, not with an invented number.
- The page must keep saying: it is a sample and not a real bid; the bidder is invented; nothing is
  promised; it was prepared with AI software; the department does not endorse it; packs are not on
  sale. No price, no contact details, no form. The tests and `check-live.mjs` (`SAMPLE_MUST_SAY`) fail
  if these statements or the source credit go missing.
- Looked at and not used, because their terms do not allow it: the Department of Finance sample approach
  to market (an empty template, CC BY-NC-ND) and a tender published on the National Film and Sound
  Archive site (all rights reserved, personal or educational use only).

## Category reports (`scripts/report.mjs`, since 25 Nov 2026)
- A report covers one UNSPSC code and is a folder `unspsc-<code>/` of four files: `-contracts.csv` (every
  contract held under the code, end-date order), `-suppliers.csv` and `-agencies.csv` (largest total value
  first) and `-read-me.txt` (what is covered, how to read it, source and licence, not a government
  document, no promise). It reuses `analyse` from the build, so dates, ABNs, amendments and impossible end
  dates are handled the same way as on the site.
- CSV, not `.xlsx`: no dependencies. Each file starts with a byte-order mark and uses CRLF, so Excel reads
  the accents. Dates are `YYYY-MM-DD`, values are bare numbers. Text from a notice that begins with `=`,
  `+`, `-` or `@` gets an apostrophe in front, so it cannot run as a formula. In the source the mark is
  written as the escape `\uFEFF`; keep it that way (an editor can turn it into an invisible character).
- Every row ends with a "Source and licence" cell, so the credit stays with a file that is passed on alone.
- One supplier has one name in all three files: the site's name for the ABN, or, with no ABN, the most
  common spelling among that code's contracts (grouped ignoring case). The name on each notice is kept in
  its own column.
- `checkReport` reads a finished report back from its own text and compares it with the dataset (row
  counts, totals to the cent, order, dates, credit on every row, the read-me's statements). A report that
  does not add up is not written and the command exits 1.
- Where reports may go: outside the checkout in the daily run (`REPORT_DIR` under the runner's temp
  folder, thrown away), or the one-day artifact of `make-report`. Never `site/` (the script refuses),
  never git (`reports/` is ignored). Reports are not linked from or mentioned on the site.
- Daily: the `fetch` job runs `node scripts/report.mjs --all` after the site is packaged and commits
  `data/report.json` (`ok`, `problems`, counts, categories by size, the ten largest). The step may fail
  without stopping the deploy, so **read `ok` in `data/report.json`**, and check that its `dataUpdated`
  matches `data/summary.json`'s `generatedAt` to within a minute; a stale file means the step did not run.
- By hand: workflow `make-report` (`.github/workflows/report.yml`, Actions tab, "Run workflow", input
  `codes`: 8-digit codes separated by spaces). It restores the newest dataset cache read-only, makes the
  reports and uploads them as the artifact `category-reports-<run number>`, kept for one day. The codes
  reach the script through the environment and anything that is not 8 digits is refused. A code with no
  contracts fails the run and uploads nothing. The run's log shows which codes were asked for.
- Measured 25 Nov 2026 on live data: all 499 reports made and checked in 2.1 seconds, 22.7 MB, 0
  problems. `make-report` run 1 (codes 43230000 and 95122403): 13 seconds from start to artifact, 8 files,
  122 KB zipped. Sizes: 208 codes hold 1 to 9 contracts, 183 hold 10 to 49, 77 hold 50 to 199, 23 hold 200
  to 999, 8 hold 1,000 or more (largest 80111600: 6,977 contracts, 2.7 MB); the median is 13.
- Not checked: the files have not been opened in Excel itself. One made-up report was converted by
  LibreOffice (dates became dates, values numbers, no formula cells).

## Deploy (`deploy` job of `fetch-data`, live since 20 Nov 2026)
- Live address: https://wattlebay-labs.github.io/govcontracts/ . Every run of `fetch-data` on `main`
  (daily schedule, a push to the scripts or the workflow, or a manual run) fetches, builds, deploys
  and checks. `site/` is still not in git: it goes from the `fetch` job to the `deploy` job as the
  `github-pages` artifact (`actions/upload-pages-artifact@v5`, then `actions/deploy-pages@v5`).
- Only the `deploy` job has `pages: write` and `id-token: write`; it runs in the `github-pages`
  environment and only on `main`.
- After the deploy, `scripts/check-live.mjs` asks the live address for `build.json` (waiting up to
  `WAIT_SECONDS` until it is the build just made), the home page, `sitemap.xml`, `style.css`, the
  first category, agency and supplier page in the sitemap, the sample pack page, and an address that
  does not exist (must be the site's own 404 page). Each page must return the right status and carry the source credit,
  the derived-data statement and the not-affiliated statement, or the run fails. Requests carry
  `?v=<run id>` so a cached copy of an earlier deploy cannot answer. The result is in the job log
  and the run summary. Tests (`scripts/check-live.test.mjs`) run the check against the build's own
  output for made-up records.
- First deploy (run 11): 10,539 pages, deploy step 14 seconds, the new build was served on the first
  request, whole run 80 seconds.
- A failed deploy or check never loses data: the dataset is saved and the summaries are committed in
  the `fetch` job before `deploy` starts. The previous deploy stays live until a new one succeeds.
- The site shows no contact details and does not link to this repository. Keep it that way until
  told otherwise.
- The log warns that `actions/checkout@v4` and `actions/setup-node@v4` target Node 20 and are forced
  onto Node 24 (they run). Moving the `@v4` actions to current majors is a small later job; check
  the cache action's notes first, because the dataset lives in that cache.

## How to run things
- The cloud shell has no internet. Push code; let GitHub Actions run it; pull the results.
- Watch runs: `gh api repos/wattlebay-labs/govcontracts/actions/runs --jq '.workflow_runs[0] | .status+" "+(.conclusion//"")'`
- Push with: `git -c push.negotiate=true push origin main`
