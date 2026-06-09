import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type DiscoverSnapshot,
  type DiscoverTheme,
  discoverLines,
  discoverSummary,
  discoverTitle,
} from "../lib/ui/discover.ts";

const theme: DiscoverTheme = { fg: (_color, text) => text, bold: (text) => text };

const inventory: DiscoverSnapshot = {
  tenants: [
    {
      id: "kbase",
      name: "KBase",
      collections: [
        { id: "kbase.ke_pangenome", name: "Ke Pangenome", description: "pangenomes", tables: [] },
        { id: "kbase.ann", name: "Annotations", description: "", tables: [] },
      ],
    },
    { id: "cdm", name: "CDM", collections: [{ id: "cdm.genomes", name: "Genomes", tables: [] }] },
  ],
};

const scoped: DiscoverSnapshot = {
  scope: { database: "kbase.ke_pangenome" },
  tenants: [
    {
      id: "kbase",
      collections: [
        {
          id: "kbase.ke_pangenome",
          tables: [
            { name: "genome", description: "one row per genome", row_count: 42 },
            { name: "cluster", row_count: 1200 },
          ],
        },
      ],
    },
  ],
};

test("inventory title counts tenants and databases", () => {
  assert.equal(discoverTitle(inventory), "Collections · 2 tenants · 3 databases");
});

test("inventory lines list tenants and their databases — never raw JSON", () => {
  const text = discoverLines(theme, inventory).join("\n");
  assert.ok(text.includes("KBase") && text.includes("Ke Pangenome") && text.includes("pangenomes"));
  assert.ok(text.includes("CDM") && text.includes("Genomes"));
  assert.ok(!text.includes("{") && !text.includes('"tables"'), "no JSON braces/keys leak through");
});

test("scoped title and lines surface tables with row counts", () => {
  assert.equal(discoverTitle(scoped), "Tables in kbase.ke_pangenome · 2");
  const text = discoverLines(theme, scoped).join("\n");
  assert.ok(text.includes("genome") && text.includes("42 rows") && text.includes("one row per genome"));
  assert.ok(text.includes("cluster") && text.includes("1.2k rows"));
});

test("empty inventory degrades to a muted note", () => {
  assert.equal(discoverLines(theme, { tenants: [] }).join("\n"), "(no accessible collections)");
});

test("discoverSummary is compact plain markdown (the model's content), never JSON", () => {
  const inv = discoverSummary(inventory);
  assert.ok(inv.startsWith("Collections · 2 tenants · 3 databases"));
  assert.ok(inv.includes("- KBase: Ke Pangenome, Annotations"));
  assert.ok(!inv.includes("{"));
  const sc = discoverSummary(scoped);
  assert.ok(sc.includes("- genome (42 rows) — one row per genome"));
  assert.ok(sc.includes("- cluster (1.2k rows)"));
});
