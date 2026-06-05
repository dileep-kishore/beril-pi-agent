/** Custom tools that mutate remote state irreversibly and must pass the safety gate. */
export const DESTRUCTIVE_TOOLS = new Set(["berdl_export", "lakehouse_submit"]);

/** Bash command fragments treated as destructive when run via the built-in `bash` tool. */
const DESTRUCTIVE_BASH = [/\bmc\s+rm\b/, /\brm\s+-rf\b/, /--recursive\s+--force/];

/** Whether a tool call should be gated by the central safety confirmation. */
export function isDestructive(toolName: string, input: Record<string, unknown>): boolean {
  if (DESTRUCTIVE_TOOLS.has(toolName)) return true;
  if (toolName === "bash" && typeof input.command === "string") {
    return DESTRUCTIVE_BASH.some((re) => re.test(input.command as string));
  }
  return false;
}
