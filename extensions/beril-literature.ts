import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { complete, getModel } from "@earendil-works/pi-ai";
import type { AssistantMessage, Context, Model, ProviderStreamOptions } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type LitRecord, fetchAbstract, fetchArticle, searchPubmed } from "../lib/lit.ts";
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

export interface CitationCheck {
  pmid: string;
  ok: boolean;
  title?: string;
  reason?: string;
}

/** Resolve a PMID via lit_fetch before it may be written; flag unresolvable ones. */
export async function resolveCitation(
  pmid: string,
  signal?: AbortSignal,
  fetcher: (p: string, s?: AbortSignal) => Promise<LitRecord> = fetchArticle,
): Promise<CitationCheck> {
  try {
    const rec = await fetcher(pmid, signal);
    if (!rec.title) return { pmid, ok: false, reason: "resolved but no title — probable fabrication" };
    return { pmid, ok: true, title: rec.title };
  } catch {
    return { pmid, ok: false, reason: "did not resolve at PubMed — probable fabrication" };
  }
}

/** One paper's assessed stance toward a hypothesis (model-assigned or NEI fallback). */
export interface StanceResult {
  record: LitRecord;
  stance: string;
  confidence: string;
  exact_quote: string;
  qualifiers: string[];
}

/**
 * Assess each abstract's stance toward a hypothesis via an in-process `complete()`
 * call. Mirrors {@link expandQueries} exactly for model/auth resolution and the
 * `__completer` seam: prefers `ctx.model`, else falls back to the default model +
 * the registry's resolved auth. Returns every paper as `NEI` (low confidence)
 * whenever no model/auth is available or the response is not a usable JSON array.
 */
export async function assessStances(
  ctx: Pick<ExtensionCommandContext, "model" | "modelRegistry" | "signal">,
  hypothesis: string,
  assessed: { record: LitRecord; abstract: string }[],
  deps: Completer = {},
): Promise<StanceResult[]> {
  const nei = (): StanceResult[] =>
    assessed.map(({ record }) => ({ record, stance: "NEI", confidence: "low", exact_quote: "", qualifiers: [] }));

  const corpus = assessed
    .map(
      ({ record, abstract }) =>
        `PMID ${record.pmid ?? "?"}: ${record.title ?? "(untitled)"}\nAbstract: ${abstract || "(no abstract)"}`,
    )
    .join("\n\n");
  const prompt = `Assess each paper's stance toward this hypothesis. For each, decide whether the abstract "supports", "refutes", or gives NEI (not enough info). Respond with ONLY a JSON array of objects { "pmid": string, "stance": "supports"|"refutes"|"NEI", "confidence": "high"|"medium"|"low", "exact_quote": string (verbatim sentence from the abstract, or ""), "qualifiers": string[] }.\n\nHypothesis: ${hypothesis}\n\nPapers:\n${corpus}`;

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
      // No session model: fall back to a default, mirroring expandQueries.
      model = getModelFn("anthropic", DEFAULT_EXPANSION_MODEL);
      const auth = model && ctx.modelRegistry ? await ctx.modelRegistry.getApiKeyAndHeaders(model) : undefined;
      if (!model || !auth?.ok || !auth.apiKey) return nei();
      apiKey = auth.apiKey;
      headers = auth.headers;
    }
    if (!model) return nei();

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
    if (!Array.isArray(arr)) return nei();
    const byPmid = new Map<string, (typeof arr)[number]>();
    for (const item of arr) {
      if (item && typeof item.pmid !== "undefined") byPmid.set(String(item.pmid), item);
    }
    return assessed.map(({ record }) => {
      const m = record.pmid ? byPmid.get(String(record.pmid)) : undefined;
      if (!m) return { record, stance: "NEI", confidence: "low", exact_quote: "", qualifiers: [] };
      return {
        record,
        stance: typeof m.stance === "string" ? m.stance : "NEI",
        confidence: typeof m.confidence === "string" ? m.confidence : "low",
        exact_quote: typeof m.exact_quote === "string" ? m.exact_quote : "",
        qualifiers: Array.isArray(m.qualifiers) ? m.qualifiers.map(String) : [],
      };
    });
  } catch {
    // fall through to all-NEI
  }
  return nei();
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

  pi.registerTool({
    name: "lit_stance",
    label: "Assess literature stance",
    description:
      "For a hypothesis, fetch top-N PubMed abstracts and assess each paper's stance: supports / refutes / NEI (not enough info). Returns the stance, a confidence, and the verbatim sentence behind it — so literature becomes first-class supporting OR refuting evidence. 'NEI' / 'insufficient evidence in the retrieved set' is an honest, encouraged outcome.",
    parameters: Type.Object({
      hypothesis: Type.String({ description: "The hypothesis to assess papers against." }),
      max: Type.Optional(Type.Integer({ description: "Papers to assess (default 5).", default: 5 })),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const max = params.max ?? 5;
      const records = await searchPubmed(params.hypothesis, max, signal);
      const assessed: { record: LitRecord; abstract: string }[] = [];
      for (const r of records) {
        const abstract = r.pmid ? await fetchAbstract(r.pmid, signal).catch(() => "") : "";
        assessed.push({ record: r, abstract });
      }
      // The model assigns stance; on no model/auth, return NEI honestly.
      const stances = await assessStances(
        ctx as Pick<ExtensionCommandContext, "model" | "modelRegistry" | "signal">,
        params.hypothesis,
        assessed,
        (ctx as { __completer?: Completer }).__completer,
      );
      const text = stances
        .map((s) => `${s.stance.toUpperCase()} (${s.confidence}) — ${s.record.title ?? s.record.pmid}`)
        .join("\n");
      return { content: [{ type: "text", text: text || "(no papers)" }], details: { stances } };
    },
    renderCall(args, theme) {
      return callLine(theme, `lit stance · ${args.hypothesis.slice(0, 50)}`);
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      if (isPartial) return partialLine(theme, "Assessing literature stance…");
      const { stances } = result.details as { stances: StanceResult[] };
      return litCard(
        theme,
        stances.map((s) => s.record),
        expanded,
      );
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
      // Verify-on-write: resolve each PMID at PubMed (paced through the shared gate)
      // and drop any that don't resolve — an unresolvable PMID is a probable
      // fabrication and must not reach references.md.
      const checks = await Promise.all(
        records.map((r) =>
          r.pmid
            ? resolveCitation(r.pmid, ctx.signal).catch(
                (): CitationCheck => ({ pmid: r.pmid as string, ok: false, reason: "check errored" }),
              )
            : Promise.resolve<CitationCheck>({ pmid: "", ok: true }),
        ),
      );
      const verified = records.filter((_, i) => checks[i].ok);
      const dropped = checks.filter((c) => !c.ok);
      const path = join(ctx.cwd, "references.md");
      await writeFile(path, formatReferences(topic, verified), "utf8");
      if (ctx.hasUI) ctx.ui.notify(`Wrote ${verified.length} references to references.md`, "info");
      const droppedNote = dropped.length
        ? ` Dropped ${dropped.length} unresolved/flagged PMID(s) (probable fabrication): ${dropped.map((c) => c.pmid).join(", ")}.`
        : "";
      pi.sendUserMessage(
        `references.md now lists ${verified.length} citations for "${topic}" (from queries: ${queries.join("; ")}).${droppedNote} Follow the literature-review skill to read and synthesize them.`,
      );
    },
  });
}
