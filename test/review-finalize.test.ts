import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appendReportHashFooter, nextReviewPath, sha256File, stripReportHashFooters } from "../lib/review-finalize.ts";

test("sha256File is byte-identical to sha256sum", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rf-"));
  const f = join(dir, "REPORT.md");
  await writeFile(f, "hello\n"); // sha256("hello\n") = 5891b5b5…
  assert.equal(sha256File(f), "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03");
});

test("footer is the single final non-empty line, idempotent", () => {
  const hex = "a".repeat(64);
  const once = appendReportHashFooter("body\n", hex);
  assert.match(once, /<!-- report_hash: sha256:a{64} -->\n$/);
  const twice = appendReportHashFooter(once, hex);
  assert.equal((twice.match(/report_hash/g) || []).length, 1);
  assert.equal(stripReportHashFooters(once).includes("report_hash"), false);
});

test("footer format matches tools/review.sh printf (leading newline + trailing newline)", () => {
  const hex = "b".repeat(64);
  assert.equal(appendReportHashFooter("body\n", hex), `body\n\n<!-- report_hash: sha256:${hex} -->\n`);
});

// Byte-identity vs `tools/review.sh:252` `printf '\n<!-- ... -->\n' >> file`, which appends
// exactly ONE leading newline to whatever the file already ends with (no trailing-newline
// normalization). Verified against bash for each body-ending shape.
test("appendReportHashFooter matches bash printf-append byte-for-byte", () => {
  const hex = "c".repeat(64);
  const footer = `<!-- report_hash: sha256:${hex} -->\n`;
  // body ends in one \n → one blank line before footer
  assert.equal(appendReportHashFooter("LGTM\n", hex), `LGTM\n\n${footer}`);
  // body with NO trailing newline → footer directly after, no blank line
  assert.equal(appendReportHashFooter("LGTM", hex), `LGTM\n${footer}`);
  // body with multiple trailing newlines → all preserved, plus the printf's \n
  assert.equal(appendReportHashFooter("LGTM\n\n\n", hex), `LGTM\n\n\n\n${footer}`);
});

test("nextReviewPath returns the first non-existent ${prefix}_N.md", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rf-"));
  assert.equal(nextReviewPath(dir, "REVIEW"), join(dir, "REVIEW_1.md"));
  await writeFile(join(dir, "REVIEW_1.md"), "x");
  assert.equal(nextReviewPath(dir, "REVIEW"), join(dir, "REVIEW_2.md"));
  await writeFile(join(dir, "REVIEW_2.md"), "x");
  assert.equal(nextReviewPath(dir, "REVIEW"), join(dir, "REVIEW_3.md"));
  // distinct prefix has an independent counter
  assert.equal(nextReviewPath(dir, "PLAN_REVIEW"), join(dir, "PLAN_REVIEW_1.md"));
});
