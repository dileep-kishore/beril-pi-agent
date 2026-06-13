import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type BashToolOptions, type ExtensionAPI, createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

const CLIPBOARD_IMAGE_RE =
  /(?:\/var\/folders\/[^\s'"`]+\/T\/|\/private\/tmp\/|\/tmp\/)pi-clipboard-[A-Za-z0-9-]+\.(?:png|jpe?g|gif|webp)/gi;
const PI_BASH_LOG_RE = /(?:\/var\/folders\/[^\s'"`]+\/T\/|\/private\/tmp\/|\/tmp\/)pi-bash-[A-Za-z0-9-]+\.log/gi;
const LONG_TOKEN_RE = /\S{90,}/g;

export function redactBashDisplay(command: string): string {
  return command
    .replace(CLIPBOARD_IMAGE_RE, "<clipboard image>")
    .replace(PI_BASH_LOG_RE, "<pi temp log>")
    .replace(LONG_TOKEN_RE, "<long-token>");
}

function compactBashLabel(command: string | undefined): string {
  const redacted = redactBashDisplay((command ?? "").trim());
  if (!redacted) return "bash";
  if (redacted.includes("<clipboard image>")) return "bash <clipboard image>";
  if (redacted.includes("\n") || redacted.includes("<<")) return "bash <script>";

  const [program = "command"] = redacted.split(/\s+/, 1);
  if (redacted.length > 80) return `bash ${program} <args>`;
  return `bash ${redacted}`;
}

function textContent(result: { content?: Array<{ type: string; text?: string }> }): string {
  return result.content?.find((c) => c.type === "text")?.text ?? "";
}

function lineCount(text: string): number {
  const trimmed = text.trimEnd();
  if (!trimmed) return 0;
  return trimmed.split("\n").length;
}

type ShellSettings = { shellPath?: string; shellCommandPrefix?: string };

function readSettings(path: string): ShellSettings {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as ShellSettings;
    return {
      shellPath: typeof parsed.shellPath === "string" ? parsed.shellPath : undefined,
      shellCommandPrefix: typeof parsed.shellCommandPrefix === "string" ? parsed.shellCommandPrefix : undefined,
    };
  } catch {
    return {};
  }
}

function bashOptionsFor(cwd: string): BashToolOptions {
  const configDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  const globalSettings = readSettings(join(configDir, "settings.json"));
  const projectSettings = readSettings(join(cwd, ".pi", "settings.json"));
  const settings = { ...globalSettings, ...projectSettings };
  return { shellPath: settings.shellPath, commandPrefix: settings.shellCommandPrefix };
}

/**
 * Quiet rendering for Pi's built-in bash tool.
 *
 * This intentionally does not reimplement shell execution: each call delegates to
 * Pi's own bash tool definition for the current cwd. Only the TUI renderers are
 * changed so routine plumbing and transient clipboard/temp paths recede from the
 * scientist-facing transcript. The real command remains available to Pi's tool
 * execution, safety hooks, JSON/RPC streams, and session files.
 */
export default function berilQuietTools(pi: ExtensionAPI) {
  const definitions = new Map<string, ReturnType<typeof createBashToolDefinition>>();
  const bashFor = (cwd: string) => {
    let tool = definitions.get(cwd);
    if (!tool) {
      tool = createBashToolDefinition(cwd, bashOptionsFor(cwd));
      definitions.set(cwd, tool);
    }
    return tool;
  };

  const registrationBase = bashFor(process.cwd());

  pi.registerTool({
    ...registrationBase,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return bashFor(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
    },
    renderCall(args, theme) {
      return new Text(theme.fg("dim", compactBashLabel(args.command)), 0, 0);
    },
    renderResult(result, options, theme, context) {
      if (options.expanded) {
        return (
          (bashFor(context.cwd).renderResult as any)?.(result, options, theme, context) ??
          new Text(textContent(result), 0, 0)
        );
      }

      if (options.isPartial) return new Text(theme.fg("dim", "bash running…"), 0, 0);
      if (context.isError) return new Text(theme.fg("error", "bash failed"), 0, 0);

      const lines = lineCount(textContent(result));
      const suffix = lines > 0 ? ` (${lines} line${lines === 1 ? "" : "s"})` : "";
      return new Text(theme.fg("dim", `✓ bash done${suffix}`), 0, 0);
    },
  });
}
