import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Matches a canonical report_hash footer line (whole line). */
const FOOTER_RE = /^<!--\s*report_hash:\s*sha256:[0-9a-f]+\s*-->\s*$/gm;

/** sha256 of a file's raw bytes as 64-hex (no prefix). Byte-identical to `sha256sum`. */
export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Remove every existing `<!-- report_hash: sha256:… -->` footer line from `body`. */
export function stripReportHashFooters(body: string): string {
  return body.replace(FOOTER_RE, "");
}

/**
 * Strip any existing footers, then append exactly one so it is the single final
 * non-empty line. Byte-identical to `tools/review.sh:252` `printf '\n<!-- ... -->\n' >> file`:
 * append `\n` + footer + `\n` onto the stripped body with no trailing-newline normalization.
 */
export function appendReportHashFooter(body: string, hex: string): string {
  return `${stripReportHashFooters(body)}\n<!-- report_hash: sha256:${hex} -->\n`;
}

/** First `${prefix}_N.md` (N from 1) under `projectDir` that does not yet exist. */
export function nextReviewPath(projectDir: string, prefix: "REVIEW" | "PLAN_REVIEW" | "REFUTATION"): string {
  for (let n = 1; ; n++) {
    const path = join(projectDir, `${prefix}_${n}.md`);
    if (!existsSync(path)) return path;
  }
}
