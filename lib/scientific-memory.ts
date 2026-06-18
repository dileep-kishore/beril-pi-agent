import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type ScientificMemoryKind = "discovery" | "performance";

export interface ScientificMemoryRecord {
  project: string;
  kind: ScientificMemoryKind;
  text: string;
  source: string;
}

function sectionBullets(markdown: string, heading: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const out: string[] = [];
  let inSection = false;
  const target = heading.toLowerCase();
  for (const line of lines) {
    const h = line.match(/^##+\s+(.+?)\s*$/);
    if (h) {
      inSection = h[1].trim().toLowerCase() === target;
      continue;
    }
    if (!inSection) continue;
    const bullet = line.match(/^\s*[-*]\s+(.+?)\s*$/);
    if (bullet) out.push(bullet[1].trim());
  }
  return out;
}

export function extractApprovedMemories(project: string, reportMd: string): ScientificMemoryRecord[] {
  const source = `projects/${project}/REPORT.md`;
  return [
    ...sectionBullets(reportMd, "Discoveries").map((text) => ({ project, kind: "discovery" as const, text, source })),
    ...sectionBullets(reportMd, "Performance Notes").map((text) => ({
      project,
      kind: "performance" as const,
      text,
      source,
    })),
  ];
}

function isApprovedYaml(yaml: string): boolean {
  return /^\s*status:\s*complete\s*$/im.test(yaml) || /^\s*approval:\s*$/im.test(yaml);
}

export async function scanApprovedMemoryIndex(root: string): Promise<ScientificMemoryRecord[]> {
  const projectsDir = join(root, "projects");
  const out: ScientificMemoryRecord[] = [];
  let entries: string[] = [];
  try {
    entries = await readdir(projectsDir);
  } catch {
    return [];
  }
  for (const name of entries.sort()) {
    const dir = join(projectsDir, name);
    const yaml = await readFile(join(dir, "beril.yaml"), "utf8").catch(() => "");
    if (!isApprovedYaml(yaml)) continue;
    const report = await readFile(join(dir, "REPORT.md"), "utf8").catch(() => "");
    out.push(...extractApprovedMemories(name, report));
  }
  return out;
}

export function serializeMemoryIndex(records: ScientificMemoryRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : "");
}

export async function writeMemoryIndex(root: string, records: ScientificMemoryRecord[]): Promise<string> {
  const path = join(root, "science-memory.jsonl");
  await writeFile(path, serializeMemoryIndex(records), "utf8");
  return path;
}

export function buildIdeaTournamentPrompt(topic: string, memories: ScientificMemoryRecord[]): string {
  const basis = memories.length
    ? memories.map((m) => `- [${m.kind}] ${m.project}: ${m.text} (${m.source})`).join("\n")
    : "- No approved memories indexed yet; be explicit about uncertainty.";
  return `Run a BERIL idea tournament for this topic: ${topic || "(open topic)"}.

Use these approved memory records as prior context:
${basis}

Roles:
1. Data scout: propose answerable questions grounded in BERDL tables and likely joins.
2. Literature scout: ask whether anyone has tested each idea and what would make it novel.
3. Methods skeptic: identify confounding, missing controls, and the first discriminating analysis.
4. Refuter: state what result would make each idea uninteresting or false.
5. Novelty ranker: rank 3-5 candidates by answerability, novelty, expected scientific value, and cost.

Return a compact board with candidate, why now, data needed, falsifying test, literature check, risk, and next command.`;
}
