import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Error from a `beril <subcommand>` invocation. `code` is the child process exit code. */
export class BerilError extends Error {
  readonly code: number;
  readonly stderr: string;

  constructor(code: number, message: string, stderr = "") {
    super(message);
    this.name = "BerilError";
    this.code = code;
    this.stderr = stderr;
  }

  /** Exit code 2 is the BERIL "config/usage error" convention. */
  get isUsage(): boolean {
    return this.code === 2;
  }
}

export type BerilErrorKind = "connectivity" | "permission" | "auth" | "usage" | "query" | "unknown";

function errText(err: unknown): string {
  const stderr = err instanceof BerilError ? err.stderr : "";
  const msg = err instanceof Error ? err.message : String(err);
  return `${msg} ${stderr}`;
}

export function classifyBerilError(err: unknown): BerilErrorKind {
  if (err instanceof BerilError && err.isUsage) return "usage";
  const text = errText(err);
  if (/unreachable|RETRIES_EXCEEDED|UNAVAILABLE/i.test(text)) return "connectivity";
  if (
    /KBASE_AUTH_TOKEN|missing token|token is required|expired token|invalid token|authentication required|authentication is missing or expired/i.test(
      text,
    )
  ) {
    return "auth";
  }
  if (
    /AccessControlException|Token denied|AccessDenied|Access denied|not authorized|unauthorized|403\s+Forbidden|permission denied|NoAuthWithAWSException|authorization blocked|do(?:es)? not appear to have permission/i.test(
      text,
    )
  ) {
    return "permission";
  }
  if (/TABLE_OR_VIEW_NOT_FOUND|PARSE_SYNTAX_ERROR|AnalysisException|Syntax error/i.test(text)) return "query";
  return "unknown";
}

/**
 * Whether a thrown error is a *transport* failure (the BERDL Spark Connect
 * endpoint never answered) rather than a genuine SQL/analysis error.
 *
 * The distinction matters for any tool that probes the schema to draw a
 * data-availability conclusion: a `DESCRIBE` that fails because Spark is
 * unreachable means we *could not check* — NOT that the table/column is absent.
 * Conflating the two makes a science tool report "your data can't answer this"
 * during an infrastructure outage. `run_sql.py` surfaces this class with an
 * "unreachable" message; the underlying gRPC status is `UNAVAILABLE` /
 * `RETRIES_EXCEEDED`, so we match all three.
 */
export function isConnectivityError(err: unknown): boolean {
  return classifyBerilError(err) === "connectivity";
}

export function isPermissionError(err: unknown): boolean {
  const kind = classifyBerilError(err);
  return kind === "permission" || kind === "auth";
}

export function permissionGuidance(err: unknown): string {
  const kind = classifyBerilError(err);
  if (kind === "auth") {
    return "BERDL authentication is missing or expired. Stop here and refresh credentials with `uv run beril setup` or inspect `/berdl-status` before retrying.";
  }
  return "BERDL authorization blocked this request. Stop here: the current user does not appear to have permission for one or more requested resources. Request access or choose a table you can read before retrying.";
}

export interface BerilExecOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  cwd?: string;
}

/**
 * Run `beril <args>` via `pi.exec` and parse a single JSON value from stdout.
 *
 * Throws {@link BerilError} on any non-zero exit (carrying stderr), or on stdout
 * that is not valid JSON. The BERIL subcommand I/O contract guarantees exactly
 * one JSON value on stdout and diagnostics on stderr.
 */
export async function berilExec<T = unknown>(
  pi: Pick<ExtensionAPI, "exec">,
  args: string[],
  opts: BerilExecOptions = {},
): Promise<T> {
  const res = await pi.exec("beril", args, {
    timeout: opts.timeoutMs ?? 120_000,
    signal: opts.signal,
    cwd: opts.cwd,
  });
  if (res.code !== 0) {
    const msg = (res.stderr || res.stdout || `beril ${args[0]} exited ${res.code}`).trim();
    throw new BerilError(res.code, msg, res.stderr);
  }
  try {
    return JSON.parse(res.stdout) as T;
  } catch {
    throw new BerilError(0, `beril ${args[0]}: stdout was not JSON: ${res.stdout.slice(0, 200)}`);
  }
}
