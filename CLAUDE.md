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
  end dates bunch up (the week of 31 December returned 7,378 releases, 75 pages, in one window), so
  expect the 30 June window to be the longest. `HARD_SECONDS` stops a run before the job time limit.
- How the API reports amendments (seen in live data): the release is tagged `contractAmendment`,
  `contracts[0].id` stays the parent CN, `contracts[0].amendments[].id` is `CN…-A1`, and
  `value.amount` is the new total contract value, not the change. So the newest release per CN is the
  current state of the contract. `contractLastModified` returns both new notices and amendments.
- End dates are not all sane (one is 1900-01-01): anything that sorts or filters by date must cope.
- If the cache is lost (unused for 7 days) the script starts a new dataset by itself.
- A later job that needs the data (site build) should run in the same workflow after the fetch, or
  restore the same cache.

## How to run things
- The cloud shell has no internet. Push code; let GitHub Actions run it; pull the results.
- Watch runs: `gh api repos/wattlebay-labs/govcontracts/actions/runs --jq '.workflow_runs[0] | .status+" "+(.conclusion//"")'`
- Push with: `git -c push.negotiate=true push origin main`
