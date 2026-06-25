import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { berilExec } from "./beril-exec.ts";
import { type ClaimStateSummary, buildClaimState, claimStateSummary } from "./claim-state.ts";

export interface ReviewPreflightView {
  project: string;
  status?: string;
  report: boolean;
  notebookHashes: number;
  claims: ClaimStateSummary;
  redTeam: boolean;
  review: boolean;
  reviewReady: boolean;
  submitReady: boolean;
  blockers: string[];
  warnings: string[];
}

function numberedArtifactExists(files: string[], prefix: "REVIEW" | "REFUTATION"): boolean {
  const re = new RegExp(`^${prefix}_\\d+\\.md$`);
  return files.some((file) => re.test(file));
}

function preflightBlockers(input: {
  report: boolean;
  unsupported: number;
  missingRefuteSearch: number;
  redTeam: boolean;
}): string[] {
  const blockers: string[] = [];
  if (!input.report) blockers.push("REPORT.md is missing");
  if (input.unsupported) blockers.push(`${input.unsupported} claim(s) are unsupported`);
  if (input.missingRefuteSearch)
    blockers.push(`${input.missingRefuteSearch} claim(s) have no refuting evidence search note`);
  if (!input.redTeam) blockers.push("No REFUTATION_N.md red-team pass found");
  return blockers;
}

export function submitReadinessProblems(view: ReviewPreflightView): string[] {
  const problems = [...view.blockers];
  if (!view.review) problems.push("No REVIEW_N.md found yet");
  if (view.status !== "reviewed" && view.status !== "complete") {
    problems.push(`Lifecycle is ${view.status ?? "unknown"}; expected reviewed`);
  }
  return problems;
}

export async function collectReviewPreflight(
  pi: Pick<ExtensionAPI, "exec">,
  cwd: string,
  project: string,
): Promise<ReviewPreflightView> {
  const dir = join(cwd, "projects", project);
  const read = async (name: string) => readFile(join(dir, name), "utf8").catch(() => "");
  const [planMd, reportMd, files] = await Promise.all([
    read("RESEARCH_PLAN.md"),
    read("REPORT.md"),
    readdir(dir).catch(() => [] as string[]),
  ]);
  const state = buildClaimState({ project, planMd, reportMd });
  const claims = claimStateSummary(state.rows);
  const hashes = await berilExec<Record<string, string>>(pi, ["hash", project]).catch(() => ({}));
  const lifecycle: { status?: string } = await berilExec<{ status?: string }>(pi, [
    "lifecycle",
    "status",
    project,
  ]).catch(() => ({}));
  const redTeam = numberedArtifactExists(files, "REFUTATION");
  const review = numberedArtifactExists(files, "REVIEW");
  const missingRefuteSearch = state.rows.filter((row) => !row.refutes.length && !row.refutesSearched?.trim()).length;
  const blockers = preflightBlockers({
    report: Boolean(reportMd.trim()),
    unsupported: claims.unsupported,
    missingRefuteSearch,
    redTeam,
  });
  const warnings: string[] = [];
  if (!Object.keys(hashes).length) warnings.push("No notebook hashes returned");
  if (!review) warnings.push("No REVIEW_N.md found yet; submit is not ready");
  // Calibrated trust: a high/medium claim resting on a single (or no) re-runnable
  // source — a warning, never a blocker; reviewers decide whether the gap is fatal.
  const tierMismatch = state.rows.filter((row) => row.tier_mismatch).length;
  if (tierMismatch)
    warnings.push(`${tierMismatch} claim(s) assert high/medium confidence on a single/no re-runnable source`);
  const view: ReviewPreflightView = {
    project,
    status: lifecycle.status,
    report: Boolean(reportMd.trim()),
    notebookHashes: Object.keys(hashes).length,
    claims,
    redTeam,
    review,
    reviewReady: blockers.length === 0,
    submitReady:
      blockers.length === 0 && review && (lifecycle.status === "reviewed" || lifecycle.status === "complete"),
    blockers,
    warnings,
  };
  return view;
}
