import assert from "node:assert/strict";
import { test } from "node:test";
import { GATE_CATALOG, type GateRecord, formatGateReference, gatesForEdge, latestVerdicts } from "../lib/gates.ts";

test("GATE_CATALOG entries are well-formed and jargon-free-shaped", () => {
  assert.ok(GATE_CATALOG.length > 0);
  for (const g of GATE_CATALOG) {
    assert.ok(g.id && g.what && g.needs && g.whoDecides, `${g.id} has all plain-language fields`);
    assert.ok(g.edge.includes("→"), `${g.id} edge names the transition`);
    assert.ok(["auto", "judgment", "human"].includes(g.type), `${g.id} has a known type`);
    assert.ok(
      ["you", "the record", "a recorded judgment"].includes(g.whoDecides),
      `${g.id} whoDecides is one of the three`,
    );
  }
});

test("gatesForEdge returns the gates on a given lifecycle edge, in order", () => {
  const gates = gatesForEdge("active", "analysis");
  assert.deepEqual(
    gates.map((g) => g.id),
    ["report-present", "claims-present", "data-validity"],
  );
  assert.equal(gatesForEdge("nope", "nowhere").length, 0);
});

test("latestVerdicts takes the last record per gate id", () => {
  const records: GateRecord[] = [
    { gate: "data-validity", verdict: "fail", at: "1" },
    { gate: "data-validity", verdict: "pass", at: "2" },
    { gate: "coherence", override: true, reason: "stale ok", by: "0000-0002", at: "3" },
  ];
  const latest = latestVerdicts(records);
  assert.equal(latest.get("data-validity")?.verdict, "pass", "later record wins");
  assert.equal(latest.get("coherence")?.override, true);
  assert.equal(latest.size, 2);
});

test("formatGateReference merges recorded verdicts and overrides into the catalog", () => {
  const lines = formatGateReference([
    { gate: "data-validity", verdict: "pass", by: "0000-0001", at: "2" },
    { gate: "coherence", override: true, reason: "record intentionally behind", by: "0000-0002", at: "3" },
  ]);
  const text = lines.join("\n");
  assert.ok(lines.length > GATE_CATALOG.length, "one line per gate plus edge headers and needs lines");
  assert.ok(/data-validity.*pass/.test(text), "recorded pass verdict is merged in");
  assert.ok(/coherence.*overridden/.test(text), "override is merged in");
  assert.ok(text.includes("active → analysis"), "edge headers are spaced for reading");
});

test("formatGateReference works with no records", () => {
  const lines = formatGateReference();
  assert.ok(lines.length > 0);
  assert.ok(lines.join("\n").includes("commons-check"));
});
