/**
 * Tell an INFRASTRUCTURE failure apart from a scientific result — so an API
 * rate-limit, an expired key, an empty billing balance, or a dead data endpoint
 * is never dressed up as "the science says…". This mirrors KING's chrome
 * contract (D66): the matcher is deliberately CONSERVATIVE — it fires only on
 * STRUCTURED tokens (the snake_case error `type` names APIs emit, exact billing
 * phrases, gRPC status codes), never on bare English words. A prose sentence
 * that happens to contain "rate", "429", or "credit" MUST classify as null —
 * locked by a test — because a false positive would hide a real finding behind
 * an "infrastructure" banner.
 */

import { isConnectivityError } from "./beril-exec.ts";

// Re-export so error paths have one import site for both the text classifier and
// the beril-exec transport check (the connectivity "re-export path").
export { isConnectivityError };

export type SysErrorKind = "rate-limit" | "auth" | "billing" | "overloaded" | "connectivity";

export interface SysError {
  kind: SysErrorKind;
  detail: string;
}

/** Structured-token matchers, in priority order. Each pattern is intentionally narrow. */
const MATCHERS: { re: RegExp; kind: SysErrorKind }[] = [
  { re: /rate_limit_error/, kind: "rate-limit" },
  { re: /overloaded_error/, kind: "overloaded" },
  { re: /authentication_error|invalid_api_key|invalid_x_api_key/, kind: "auth" },
  { re: /insufficient_quota|billing_error|credit balance is too low/, kind: "billing" },
  // gRPC transport status codes — the same structured tokens `beril` surfaces.
  { re: /\bRETRIES_EXCEEDED\b|\bUNAVAILABLE\b/, kind: "connectivity" },
];

/** Plain-language, clearly-infrastructural guidance per kind (never science-flavoured). */
const DETAIL: Record<SysErrorKind, string> = {
  "rate-limit": "The API rate limit was hit. Wait a moment, then retry.",
  auth: "API authentication failed. Check or refresh the API key.",
  billing: "The API account is out of credit or quota. Top up billing to continue.",
  overloaded: "The API is temporarily overloaded. Retry shortly.",
  connectivity: "The data endpoint could not be reached. This is an outage, not a data answer.",
};

/**
 * Classify a raw error string as a known infrastructure failure, or `null` when
 * it is anything else (including ordinary science prose). Matching is on
 * structured tokens only, so surrounding JSON/HTTP framing is tolerated but bare
 * words are ignored.
 */
export function classifySysError(text: string): SysError | null {
  if (typeof text !== "string" || !text) return null;
  for (const { re, kind } of MATCHERS) {
    if (re.test(text)) return { kind, detail: DETAIL[kind] };
  }
  return null;
}
