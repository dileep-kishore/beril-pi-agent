import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { complete, getModel } from "@earendil-works/pi-ai";
import type { AssistantMessage, Context, Model, ProviderStreamOptions } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type LitRecord, fetchArticle, searchPubmed } from "../lib/lit.ts";
import { articleCard, callLine, errorCard, litCard, partialLine, toolErrorText } from "../lib/ui/science-cards.ts";

/** Default model for query expansion when the session has none selected. */
const DEFAULT_EXPANSION_MODEL = "claude-sonnet-4-5";

/**
 * Injectable seam for {@link expandQueries}: lets tests substitute the model
 * lookup / completion without hitting the network. Defaults to the real pi-ai
 * `getModel`/`complete`. The signatures are loosened to reflect runtime reality
 * (`getModel` returns `undefined` when a model is not found — see summarize.ts).
 */
export interface Completer {
  getModel?: (provider: string, modelId: string) => Model<any> | undefined;
  complete?: (model: Model<any>, ctx: Context, opts: ProviderStreamOptions) => Promise<AssistantMessage>;
}

/**
 * Expand a topic into focused PubMed search queries via an in-process `complete()`
 * call. Prefers `ctx.model`; otherwise falls back to the default model + the
 * model registry's resolved auth. Returns `[topic]` whenever no model/auth is
 * available or the response is not a JSON array of strings.
 */
export async function expandQueries(
  ctx: Pick<ExtensionCommandContext, "model" | "modelRegistry" | "signal">,
  topic: string,
  deps: Completer = {},
): Promise<string[]> {
  const prompt = `Expand this literature-review topic into 2-4 focused PubMed search queries (use MeSH-style terms where helpful). Respond with ONLY a JSON array of query strings. Topic: ${topic}`;
  const getModelFn = deps.getModel ?? getModel;
  const completeFn = deps.complete ?? complete;
  try {
    let model = ctx.model;
    let apiKey: string | undefined;
    let headers: Record<string, string> | undefined;
    if (model) {
      // Session has a model; resolve its auth (may already be wired by the runtime).
      const auth = ctx.modelRegistry ? await ctx.modelRegistry.getApiKeyAndHeaders(model) : undefined;
      if (auth?.ok) {
        apiKey = auth.apiKey;
        headers = auth.headers;
      }
    } else {
      // No session model: fall back to a default, mirroring summarize.ts:163-178.
      model = getModelFn("anthropic", DEFAULT_EXPANSION_MODEL);
      const auth = model && ctx.modelRegistry ? await ctx.modelRegistry.getApiKeyAndHeaders(model) : undefined;
      if (!model || !auth?.ok || !auth.apiKey) return [topic];
      apiKey = auth.apiKey;
      headers = auth.headers;
    }
    if (!model) return [topic];

    const response = await completeFn(
      model,
      { messages: [{ role: "user", content: prompt, timestamp: Date.now() }] },
      { apiKey, headers, signal: ctx.signal },
    );
    const text = response.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("");
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
    description: "Search PubMed for a query. Returns a list of normalized citation records.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query (keywords or MeSH terms)." }),
      max: Type.Optional(Type.Integer({ description: "Max results (default 20).", default: 20 })),
    }),
    async execute(_id, params, signal, _onUpdate, _ctx) {
      const max = params.max ?? 20;
      const records = await searchPubmed(params.query, max, signal);
      const text = `${records.length} result(s) for "${params.query}"`;
      return { content: [{ type: "text", text }], details: { records } };
    },
    renderCall(args, theme) {
      return callLine(theme, `lit search · ${args.query}`);
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      if (isPartial) return partialLine(theme, "Searching the literature…");
      const { records } = result.details as { records: LitRecord[] };
      return litCard(theme, records, expanded);
    },
  });

  pi.registerTool({
    name: "lit_fetch",
    label: "Fetch an article",
    description: "Fetch a single article's metadata by PubMed ID.",
    parameters: Type.Object({
      pmid: Type.String({ description: "PubMed ID." }),
    }),
    async execute(_id, params, signal, _onUpdate, _ctx) {
      const record = await fetchArticle(params.pmid, signal);
      return { content: [{ type: "text", text: record.title ?? `PMID ${params.pmid}` }], details: record };
    },
    renderCall(args, theme) {
      return callLine(theme, `lit fetch · PMID ${args.pmid}`);
    },
    renderResult(result, { isPartial }, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      if (isPartial) return partialLine(theme, "Fetching article…");
      return articleCard(theme, result.details as LitRecord);
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
      const queries = await expandQueries(ctx, topic, (ctx as { __completer?: Completer }).__completer);
      const batches = await Promise.all(queries.map((q) => searchPubmed(q, 20, ctx.signal).catch(() => [])));
      const records = dedupe(batches.flat());
      const path = join(ctx.cwd, "references.md");
      await writeFile(path, formatReferences(topic, records), "utf8");
      if (ctx.hasUI) ctx.ui.notify(`Wrote ${records.length} references to references.md`, "info");
      pi.sendUserMessage(
        `references.md now lists ${records.length} citations for "${topic}" (from queries: ${queries.join("; ")}). Follow the literature-review skill to read and synthesize them.`,
      );
    },
  });
}
