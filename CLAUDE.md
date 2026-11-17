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

## How to run things
- The cloud shell has no internet. Push code; let GitHub Actions run it; pull the results.
- Watch runs: `gh api repos/wattlebay-labs/govcontracts/actions/runs --jq '.workflow_runs[0] | .status+" "+(.conclusion//"")'`
- Push with: `git -c push.negotiate=true push origin main`
