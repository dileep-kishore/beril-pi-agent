import { basename, resolve } from "node:path";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth } from "@earendil-works/pi-tui";
import { GATE_CATALOG, type GateRecord, type GateType, latestVerdicts } from "../gates.ts";
import type { SysError } from "../syserror.ts";
import { linesCard } from "./card.ts";
import { GLYPH } from "./glyphs.ts";
import { hyperlink } from "./links.ts";
import { domainStyle } from "./palette.ts";
import { badge } from "./render-utils.ts";
import { cardHeader } from "./status-line-header.ts";

/**
 * The KOROS-mined cards: data-validity, knowledge-commons, figures, the
 * infrastructure-error banner, and the `/gates` reference. Same house style as
 * `science-cards.ts` — text-presentation glyphs from `glyphs.ts` (ASCII fallback
 * comes for free), per-domain title hues from `palette.ts`, framed by `card.ts`.
 * The two calibrated framings that matter: the commons card is REUSE-framed (KING
 * D55 — never "don't redo"), and the sysError card reads as infrastructure, kept
 * visually apart from the science family.
 */

// ── Data validity (contract 3) ──────────────────────────────────────────────

export interface ValidationColumn {
  name: string;
  dtype: string;
  null_frac: number;
  distinct: number;
  flags: string[];
}

export interface ValidationFinding {
  check: string;
  severity: "warn" | "info";
  column?: string;
  detail: string;
}

export interface ValidationResult {
  n_rows: number;
  columns: ValidationColumn[];
  findings: ValidationFinding[];
  verdict: "pass" | "warn";
}

/**
 * Data-validity profile → a data card: a verdict badge over per-finding lines. A
 * judgment gate, so a `warn` verdict informs (amber) without blocking; `pass`
 * settles quietly. The human decides what to do about the flags.
 */
export function validationCard(theme: Theme, r: ValidationResult): Component {
  const columns = r.columns ?? [];
  const findings = r.findings ?? [];
  const warn = r.verdict === "warn";
  const [vGlyph, vColor]: [string, ThemeColor] = warn ? [GLYPH.warn, "warning"] : [GLYPH.ok, "success"];
  const lines: string[] = [
    `${theme.fg(vColor, `${vGlyph} ${r.verdict}`)}  ${theme.fg("dim", `${r.n_rows} rows · ${columns.length} columns`)}`,
    "",
  ];
  if (findings.length) {
    for (const f of findings) {
      const [g, color]: [string, ThemeColor] =
        f.severity === "warn" ? [GLYPH.warn, "warning"] : [GLYPH.bullet, "muted"];
      const col = f.column ? `${theme.fg("text", f.column)}: ` : "";
      lines.push(`  ${theme.fg(color, g)} ${col}${theme.fg("text", f.detail)}`);
    }
  } else {
    lines.push(`  ${theme.fg("success", GLYPH.ok)} ${theme.fg("muted", "no traps found")}`);
  }
  lines.push("", verifyLine(theme, "open the flagged columns in the data, then re-run berdl_validate"));
  return linesCard(theme, {
    title: cardHeader(theme, { title: `Data validity ${GLYPH.bullet} ${r.verdict}` }),
    accentStyle: domainStyle(theme, "data"),
    state: warn ? "warning" : "settled",
    lines,
    maxBodyLines: 30,
  });
}

// ── Knowledge commons (contract 4) ──────────────────────────────────────────

export interface CommonsMatch {
  score: number;
  kind: "finding" | "lesson" | "gap";
  project: string;
  body: string;
  created: string;
}

export interface CommonsQueryResult {
  verdict: "novel" | "related" | "overlap";
  matches: CommonsMatch[];
}

/** Reuse-framed headline per verdict (KING D55 — never "don't redo"). */
const COMMONS_HEADLINE: Record<CommonsQueryResult["verdict"], [string, string, ThemeColor]> = {
  novel: [GLYPH.add, "novel — reusable context, no duplicate", "success"],
  related: [GLYPH.bullet, "looks distinct — related prior work below", "accent"],
  overlap: [GLYPH.warn, "strong overlap — skim the top match, then build on it", "warning"],
};

/**
 * Commons query → a reuse-framed card. Every verdict is phrased as an
 * OPPORTUNITY (context to reuse, prior work to build on), never a prohibition.
 * Gap matches are rendered distinctly — an open gap is the most actionable thing
 * a scientist can find in shared memory.
 */
export function commonsCard(theme: Theme, r: CommonsQueryResult): Component {
  const matches = r.matches ?? [];
  const [hGlyph, headline, hColor] = COMMONS_HEADLINE[r.verdict] ?? COMMONS_HEADLINE.related;
  const lines: string[] = [`${theme.fg(hColor, `${hGlyph} ${headline}`)}`];
  if (matches.length) lines.push("");
  for (const m of matches) {
    const pct = `${Math.round((m.score ?? 0) * 100)}%`;
    const isGap = m.kind === "gap";
    const kindTag = isGap ? theme.fg("warning", "gap") : theme.fg("muted", m.kind);
    const head = `  ${kindTag} ${theme.fg("dim", pct)} ${theme.fg("dim", m.project)}`;
    lines.push(isGap ? `${head} ${theme.fg("warning", "— open gap, most actionable")}` : head);
    lines.push(`      ${theme.fg("text", clip(m.body, 68))}`);
  }
  lines.push("", verifyLine(theme, "open the matched project's REPORT.md before building on it"));
  return linesCard(theme, {
    title: cardHeader(theme, { title: `Commons ${GLYPH.bullet} ${r.verdict}` }),
    accentStyle: domainStyle(theme, "governance"),
    state: r.verdict === "overlap" ? "warning" : "settled",
    lines,
    maxBodyLines: 30,
  });
}

// ── Figures (contract 10) ────────────────────────────────────────────────────

/**
 * New figures → a card of one clickable OSC-8 link per plot (basename shown,
 * `file://` target), so a scientist can open the plot straight from the terminal
 * — or run `/figures` to launch the newest in the OS viewer.
 */
export function figuresCard(theme: Theme, paths: string[]): Component {
  const figs = paths ?? [];
  const lines = figs.length
    ? figs.map((p) => `  ${theme.fg("dim", GLYPH.kindFigure)} ${theme.fg("text", fileLink(p))}`)
    : [theme.fg("muted", "(no new figures)")];
  if (figs.length) lines.push("", theme.fg("dim", "open with /figures"));
  return linesCard(theme, {
    title: cardHeader(theme, { title: `Figures ${GLYPH.bullet} ${figs.length}` }),
    accentStyle: domainStyle(theme, "analysis"),
    state: "settled",
    lines,
    maxBodyLines: 24,
  });
}

// ── Infrastructure error (contract 8) ────────────────────────────────────────

/**
 * An infrastructure failure → a deliberately NON-science card: a neutral gray
 * frame and an "Infrastructure" title so it can never be mistaken for a finding.
 * It states plainly that this is plumbing, not a result, and carries the
 * plain-language guidance for the kind.
 */
export function sysErrorCard(theme: Theme, err: SysError): Component {
  return linesCard(theme, {
    title: cardHeader(theme, { title: `Infrastructure ${GLYPH.bullet} ${err.kind}` }),
    accentStyle: domainStyle(theme, "neutral"),
    state: "warning",
    lines: [theme.fg("muted", "Infrastructure problem, not a scientific result."), "", theme.fg("text", err.detail)],
    maxBodyLines: 10,
  });
}

// ── Gate reference (contract 7 / 10) ─────────────────────────────────────────

/** type → a small legible badge colour. */
const GATE_TYPE_COLOR: Record<GateType, ThemeColor> = {
  auto: "dim",
  judgment: "muted",
  human: "warning",
};

/** A recorded verdict/override as a styled trailing fragment, or "". */
function recordedTag(theme: Theme, rec: GateRecord | undefined): string {
  if (!rec) return "";
  if (rec.override) {
    const by = rec.by ? ` by ${rec.by}` : "";
    return theme.fg("warning", `  ${GLYPH.warn} overridden${by}`);
  }
  if (rec.verdict === "pass") return theme.fg("success", `  ${GLYPH.ok} pass`);
  if (rec.verdict === "fail") return theme.fg("error", `  ${GLYPH.bad} fail`);
  return "";
}

/**
 * The `/gates` card: the catalog grouped by lifecycle edge, each gate with its
 * plain-language `what`, its `needs`/`whoDecides`, and any recorded verdict or
 * override merged in (last record per gate id wins). A governance-framed
 * reference, not an enforcement wall.
 */
export function gateReferenceCard(theme: Theme, recorded?: GateRecord[]): Component {
  const latest = latestVerdicts(recorded ?? []);
  const lines: string[] = [];
  let lastEdge: string | undefined;
  for (const gate of GATE_CATALOG) {
    if (gate.edge !== lastEdge) {
      if (lines.length) lines.push("");
      lines.push(theme.bold(theme.fg("text", displayEdge(gate.edge))));
      lastEdge = gate.edge;
    }
    const tag = badge(theme, gate.type, GATE_TYPE_COLOR[gate.type]);
    lines.push(`  ${theme.fg("text", gate.id)} ${tag}${recordedTag(theme, latest.get(gate.id))}`);
    lines.push(`    ${theme.fg("muted", gate.what)}`);
    lines.push(`    ${theme.fg("dim", `${gate.needs}  ${GLYPH.bullet}  decided by ${gate.whoDecides}`)}`);
  }
  return linesCard(theme, {
    title: cardHeader(theme, { title: "Gates" }),
    accentStyle: domainStyle(theme, "governance"),
    state: "settled",
    lines,
    maxBodyLines: 80,
  });
}

// ── shared helpers ───────────────────────────────────────────────────────────

/** Standard verification footer (mirrors `science-cards.ts`). */
function verifyLine(theme: Theme, action: string): string {
  return `${theme.fg("muted", "Verify     ")}${theme.fg("text", action)}`;
}

/** " → "-joined edge for display, glyph-aware for ASCII terminals. */
function displayEdge(edge: string): string {
  return edge.split("→").join(` ${GLYPH.arrow} `);
}

/** A clickable OSC-8 file link: basename shown, `file://<abs path>` target. */
function fileLink(path: string): string {
  return hyperlink(basename(path), `file://${encodeURI(resolve(path))}`);
}

/** Single-line clip with an ellipsis (visible-width aware). */
function clip(text: string, width: number): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  return truncateToWidth(flat, width);
}
