import { appendFile, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const TRACE_FILE = "TRACE.jsonl";
const PROVENANCE_FILE = "provenance.json";
const SECRET_KEY = /(token|secret|password|authorization|api[_-]?key|credential)/i;
const MAX_STRING = 240;

export interface ProjectTraceRow {
  at?: string;
  project?: string;
  event: string;
  [key: string]: unknown;
}

export interface ProvenanceSnapshot {
  project: string;
  updated_at: string;
  runtime: {
    beril_package_version?: string;
    pi_coding_agent_version?: string;
    model_id?: string;
    mode?: string;
  };
  [key: string]: unknown;
}

function nowIso(): string {
  return new Date().toISOString();
}

function projectDir(cwd: string, project: string): string {
  return join(cwd, "projects", project);
}

async function requireProjectDir(cwd: string, project: string): Promise<string> {
  const dir = projectDir(cwd, project);
  const s = await stat(dir).catch(() => undefined);
  if (!s?.isDirectory()) throw new Error(`project not found: projects/${project}`);
  return dir;
}

export function redactForTrace(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redactForTrace(v));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY.test(key) ? "[redacted]" : redactForTrace(item);
    }
    return out;
  }
  if (typeof value === "string" && value.length > MAX_STRING) return `${value.slice(0, MAX_STRING)}...`;
  return value;
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  try {
    const payload = JSON.parse(await readFile(path, "utf8"));
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  } catch {
    return {};
  }
}

async function packageVersions(cwd: string): Promise<{
  beril_package_version?: string;
  pi_coding_agent_version?: string;
}> {
  const pkg = await readJson(join(cwd, "package.json"));
  const dev = (pkg.devDependencies ?? {}) as Record<string, unknown>;
  const deps = (pkg.dependencies ?? {}) as Record<string, unknown>;
  const piVersion = dev["@earendil-works/pi-coding-agent"] ?? deps["@earendil-works/pi-coding-agent"];
  return {
    beril_package_version: typeof pkg.version === "string" ? pkg.version : undefined,
    pi_coding_agent_version: typeof piVersion === "string" ? piVersion : undefined,
  };
}

export async function buildProvenanceSnapshot(
  cwd: string,
  project: string,
  ctx: { model?: { id?: string }; mode?: string },
  extra: Record<string, unknown> = {},
): Promise<ProvenanceSnapshot> {
  const versions = await packageVersions(cwd);
  return {
    project,
    updated_at: nowIso(),
    runtime: {
      ...versions,
      model_id: ctx.model?.id,
      mode: ctx.mode,
    },
    ...extra,
  };
}

export async function writeProvenanceSnapshot(
  cwd: string,
  project: string,
  snapshot: ProvenanceSnapshot,
): Promise<ProvenanceSnapshot> {
  const dir = await requireProjectDir(cwd, project);
  const existing = await readJson(join(dir, PROVENANCE_FILE));
  const merged = { ...existing, ...snapshot };
  await writeFile(join(dir, PROVENANCE_FILE), `${JSON.stringify(merged, null, 2)}\n`);
  return merged as ProvenanceSnapshot;
}

export async function appendProjectTrace(cwd: string, project: string, row: ProjectTraceRow): Promise<ProjectTraceRow> {
  const dir = await requireProjectDir(cwd, project);
  const payload = redactForTrace({
    at: row.at ?? nowIso(),
    project,
    ...row,
  }) as ProjectTraceRow;
  await appendFile(join(dir, TRACE_FILE), `${JSON.stringify(payload)}\n`);
  return payload;
}

export async function readProjectTrace(cwd: string, project: string, limit?: number): Promise<ProjectTraceRow[]> {
  try {
    const text = await readFile(join(projectDir(cwd, project), TRACE_FILE), "utf8");
    const rows = text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ProjectTraceRow);
    return limit && limit > 0 ? rows.slice(-limit) : rows;
  } catch {
    return [];
  }
}
