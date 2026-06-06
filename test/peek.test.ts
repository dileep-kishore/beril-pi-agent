import assert from "node:assert/strict";
import { test } from "node:test";
import { clampSampleLimit, describeSql, formatPeek, isPlausibleTable, sampleSql } from "../lib/peek.ts";

test("isPlausibleTable accepts 1–3 segment identifiers, rejects injection", () => {
  assert.ok(isPlausibleTable("genome"));
  assert.ok(isPlausibleTable("ke_pangenome.genome"));
  assert.ok(isPlausibleTable("kbase.ke_pangenome.genome"));
  // Injection / malformed input must be rejected before interpolation.
  assert.ok(!isPlausibleTable("genome; DROP TABLE x"));
  assert.ok(!isPlausibleTable("a.b.c.d"));
  assert.ok(!isPlausibleTable("genome WHERE 1=1"));
  assert.ok(!isPlausibleTable("`t`"));
  assert.ok(!isPlausibleTable(""));
});

test("clampSampleLimit defaults and bounds the sample size", () => {
  assert.equal(clampSampleLimit(undefined), 5);
  assert.equal(clampSampleLimit(Number.NaN), 5);
  assert.equal(clampSampleLimit(0), 1);
  assert.equal(clampSampleLimit(1000), 50);
  assert.equal(clampSampleLimit(12), 12);
  assert.equal(clampSampleLimit(7.9), 7);
});

test("sql builders interpolate the validated table", () => {
  assert.equal(describeSql("ke_pangenome.genome"), "DESCRIBE ke_pangenome.genome");
  assert.equal(sampleSql("ke_pangenome.genome", 5), "SELECT * FROM ke_pangenome.genome LIMIT 5");
});

test("formatPeek shows documented columns and the sample, skipping DESCRIBE noise", () => {
  const describeRows = [
    { col_name: "genome_id", data_type: "string", comment: "GTDB accession" },
    { col_name: "gc_content", data_type: "double", comment: "" },
    { col_name: "", data_type: "", comment: "" }, // separator row
    { col_name: "# Partition Information", data_type: "", comment: "" }, // section header
  ];
  const sampleRows = [{ genome_id: "RS_GCF_1", gc_content: 0.51 }];
  const out = formatPeek("ke_pangenome.genome", describeRows, sampleRows);
  assert.match(out, /genome_id: string — GTDB accession/);
  assert.match(out, /gc_content: double/);
  assert.doesNotMatch(out, /Partition Information/);
  assert.match(out, /Sample \(1 row\):/);
  assert.match(out, /RS_GCF_1/);
});

test("formatPeek handles an empty schema gracefully", () => {
  const out = formatPeek("x.y", [], []);
  assert.match(out, /schema unavailable/);
  assert.match(out, /Sample \(0 rows\):/);
});
