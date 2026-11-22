# govcontracts

Australian Government contract awards and upcoming contract expiries, by category, agency and supplier.

Data: AusTender contract notices, Department of Finance, licensed CC BY 3.0 AU. This project is independent and is not affiliated with the Australian Government. Data shown is derived and may be modified from the source.

## How it works

- `scripts/fetch.mjs` keeps a dataset of contract notices up to date from the AusTender OCDS API.
- `scripts/build.mjs` turns that dataset into a static site in `site/`: a page per category (UNSPSC code), agency and supplier (ABN), each with the contracts ending in the next 12 months.
- `scripts/sample-pack.mjs` holds the sample Bid Draft Pack page (`sample-pack/`): a compliance checklist, response outline and first-draft answers for an invented bidder, made from the Exposure Draft of the 2025 National Panel of Assessors program RFT (Department of Social Services, CC BY 4.0).
- The fetch and the build run daily in GitHub Actions (`.github/workflows/fetch.yml`), which then publishes the site to GitHub Pages and checks the live address with `scripts/check-live.mjs`. Tests: `node --test scripts/*.test.mjs`.

Site: https://wattlebay-labs.github.io/govcontracts/
