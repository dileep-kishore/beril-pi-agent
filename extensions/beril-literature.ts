import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { berilExec } from "../lib/beril-exec.ts";
import { lastAssistantText, parseJsonl } from "../lib/jsonl.ts";

interface LitRecord {
  pmid?: string;
  title?: string;
  journal?: string;
  year?: string;
  authors?: string[];
}

/** Expand a topic into focused search queries via a `pi --mode json` sub-agent. */
async function expandQueries(pi: ExtensionAPI, topic: string): Promise<string[]> {
  const prompt =
    `Expand this literature-review topic into 2-4 focused PubMed search queries ` +
    `(use MeSH-style terms where helpful). Respond with ONLY a JSON array of query strings. Topic: ${topic}`;
  try {
    const res = await pi.exec("pi", ["--mode", "json", "--no-session", prompt], { timeout: 180_000 });
    const text = lastAssistantText(parseJsonl(res.stdout));
    const arr = JSON.parse(text);
    if (Array.isArray(arr) && arr.length > 0) return arr.map(String);
  } catch {
    // fall through to the bare topic
  }
  return [topic];
}

function dedupe(records: LitRecord[]): LitRecord[] {
  const seen = new Set<string>();
  const out: LitRecord[] = [];
  for (const r of records) {
    const key = r.pmid || r.title || JSON.stringify(r);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function formatReferences(topic: string, records: LitRecord[]): string {
  const lines = [`# References — ${topic}`, "", `${records.length} unique reference(s).`, ""];
  for (const r of records) {
    const authors = r.authors?.length
      ? `${r.authors.slice(0, 3).join(", ")}${r.authors.length > 3 ? " et al." : ""}. `
      : "";
    const cite = `- ${authors}${r.title ?? "(untitled)"}. *${r.journal ?? "?"}* (${r.year ?? "?"}).`;
    lines.push(r.pmid ? `${cite} PMID:${r.pmid}` : cite);
  }
  return `${lines.join("\n")}\n`;
}

export default function berilLiterature(pi: ExtensionAPI) {
  pi.registerTool({
    name: "lit_search",
    label: "Search the literature",
    description: "Search PubMed/Semantic Scholar for a query. Returns a list of normalized citation records.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query (keywords or MeSH terms)." }),
      max: Type.Optional(Type.Integer({ description: "Max results (default 20).", default: 20 })),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const max = params.max ?? 20;
      const records = await berilExec<LitRecord[]>(pi, [
        "lit",
        "search",
        "--query",
        params.query,
        "--max",
        String(max),
      ]);
      const text = `${records.length} result(s) for "${params.query}"`;
      return { content: [{ type: "text", text }], details: { records } };
    },
  });

  pi.registerTool({
    name: "lit_fetch",
    label: "Fetch an article",
    description: "Fetch a single article's metadata by PubMed ID.",
    parameters: Type.Object({
      pmid: Type.String({ description: "PubMed ID." }),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const record = await berilExec<LitRecord>(pi, ["lit", "fetch", "--pmid", params.pmid]);
      return { content: [{ type: "text", text: record.title ?? `PMID ${params.pmid}` }], details: record };
    },
  });

  pi.registerCommand("literature-review", {
    description: "Search the literature for a topic across focused queries and write references.md.",
    async handler(args: string, ctx: ExtensionCommandContext) {
      const topic = args.trim();
      if (!topic) {
        if (ctx.hasUI) ctx.ui.notify("Usage: /literature-review <topic>", "warning");
        return;
      }
      const queries = await expandQueries(pi, topic);
      const batches = await Promise.all(
        queries.map((q) => berilExec<LitRecord[]>(pi, ["lit", "search", "--query", q, "--max", "20"]).catch(() => [])),
      );
      const records = dedupe(batches.flat());
      const path = join(ctx.cwd, "references.md");
      await writeFile(path, formatReferences(topic, records), "utf8");
      if (ctx.hasUI) ctx.ui.notify(`Wrote ${records.length} references to references.md`, "info");
      pi.sendUserMessage(
        `references.md now lists ${records.length} citations for "${topic}" (from queries: ${queries.join("; ")}). ` +
          `Follow the literature-review skill to read and synthesize them.`,
      );
    },
  });
}
