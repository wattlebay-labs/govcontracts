# govcontracts

Australian Government contract awards and upcoming contract expiries, by category, agency and supplier.

Data: AusTender contract notices, Department of Finance, licensed CC BY 3.0 AU. This project is independent and is not affiliated with the Australian Government. Data shown is derived and may be modified from the source.

## How it works

- `scripts/fetch.mjs` keeps a dataset of contract notices up to date from the AusTender OCDS API.
- `scripts/build.mjs` turns that dataset into a static site in `site/`: a page per category (UNSPSC code), agency and supplier (ABN), each with the contracts ending in the next 12 months.
- Both run daily in GitHub Actions (`.github/workflows/fetch.yml`). Tests: `node --test scripts/*.test.mjs`.
