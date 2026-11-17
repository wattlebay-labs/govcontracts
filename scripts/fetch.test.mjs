// Run with: node --test scripts/fetch.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { compact, merge, windows } from "./fetch.mjs";

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
  const day = 864e5;
  const w = windows(0, 16 * day, 7);
  assert.equal(w.length, 3);
  assert.equal(w[0][0], "1970-01-01T00:00:00Z");
  assert.equal(w[0][1], w[1][0]);
  assert.equal(w[2][1], "1970-01-17T00:00:00Z");
});
