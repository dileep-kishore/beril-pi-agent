import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { callLine, docsCard, errorCard, partialLine, toolErrorText, webDocCard } from "../lib/ui/science-cards.ts";
import { type DocsResult, type WebDoc, lookupDocs, readWeb } from "../lib/web.ts";

/**
 * Web access for the co-scientist — two READ-ONLY tools, both free and key-free.
 *
 * `web_read` fetches a public http(s) URL and extracts its readable article text
 * locally (no service, no cost), guarded by an SSRF/private-IP block + size +
 * timeout (see lib/web.ts). `docs_lookup` fetches current library docs via
 * Context7's no-key tier (best-effort; a rate limit returns an honest card, never
 * a thrown turn). Neither mutates anything, so they are deliberately NOT in
 * lib/destructive.ts. Every result carries its source URL + retrieval date so a
 * web/docs claim is a citable, LOW-tier source (lib/science.ts keeps web/docs
 * below any re-runnable result).
 */
export default function berilWeb(pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_read",
    label: "Read a web page",
    description:
      "Fetch a public http(s) URL and extract its readable article text (title, byline, body). Read-only; use this instead of hand-writing curl in bash. Carries the source URL + retrieval date so the page is a citable, low-tier source.",
    parameters: Type.Object({
      url: Type.String({ description: "Public http(s) URL to read." }),
    }),
    async execute(_id, params, signal) {
      const doc = await readWeb(params.url, signal);
      return { content: [{ type: "text", text: doc.title || doc.finalUrl }], details: doc };
    },
    renderCall(args, theme) {
      return callLine(theme, `web read · ${args.url}`);
    },
    renderResult(result, { isPartial }, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      if (isPartial) return partialLine(theme, "Reading the page…");
      return webDocCard(theme, result.details as WebDoc);
    },
  });

  pi.registerTool({
    name: "docs_lookup",
    label: "Look up library docs",
    description:
      "Fetch current documentation/code snippets for a library, framework, SDK, or CLI tool via Context7 (no key required; CONTEXT7_API_KEY lifts limits). Use this to write code against the CURRENT API instead of a stale recalled signature. Best-effort: on a rate limit it returns an honest 'unavailable' card rather than failing.",
    parameters: Type.Object({
      library: Type.String({ description: "Library/framework name, e.g. 'scanpy' or 'Next.js'." }),
      topic: Type.Optional(Type.String({ description: "Focus the docs on a question/topic." })),
    }),
    async execute(_id, params, signal) {
      const r = await lookupDocs(params.library, params.topic ?? "", signal);
      return { content: [{ type: "text", text: r.ok ? `docs for ${r.library}` : (r.note ?? "no docs") }], details: r };
    },
    renderCall(args, theme) {
      return callLine(theme, `docs lookup · ${args.library}`);
    },
    renderResult(result, { isPartial }, theme, context) {
      if (context?.isError) return errorCard(theme, toolErrorText(result));
      if (isPartial) return partialLine(theme, "Looking up docs…");
      return docsCard(theme, result.details as DocsResult);
    },
  });
}
