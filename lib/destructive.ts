/** Custom tools that mutate remote state irreversibly and must pass the safety gate. */
export const DESTRUCTIVE_TOOLS = new Set(["berdl_export", "lakehouse_submit"]);

/** Bash command fragments treated as destructive when run via the built-in `bash` tool. */
const DESTRUCTIVE_BASH = [/\bmc\s+rm\b/, /\brm\s+-rf\b/, /--recursive\s+--force/];

/**
 * Path patterns whose read/write via the built-in `bash` tool must pass the
 * safety gate — secret/credential material a co-scientist should never quietly
 * expose. This is a tripwire (regex over the command string), not a parser: a
 * false positive only costs a confirmation, never silent loss. The leading
 * boundary class on `.env` avoids matching the word "environment".
 */
const SENSITIVE_PATHS = [
  /(^|[\s=:'"(/])\.env(\.[\w.-]+)?\b/, // .env, .env.local, .env.production, path/.env
  /\.ssh\//, // anything under an .ssh directory (~/.ssh/, /home/x/.ssh/)
  /\bid_(rsa|dsa|ecdsa|ed25519)\b/, // private SSH keys
  /\.(pem|key|p12|pfx|keystore|jks)\b/, // key / cert material by extension
  /\b(credentials|secrets?)\b/, // aws/gcloud credentials, *secret* files
  /\.aws\//, // ~/.aws/ (config + credentials)
  /\.netrc\b/, // .netrc tokens
  /\.pgpass\b/, // postgres password file
];

/** Whether a tool call should be gated by the central safety confirmation. */
export function isDestructive(toolName: string, input: Record<string, unknown>): boolean {
  if (DESTRUCTIVE_TOOLS.has(toolName)) return true;
  if (toolName === "bash" && typeof input.command === "string") {
    const cmd = input.command as string;
    return DESTRUCTIVE_BASH.some((re) => re.test(cmd)) || SENSITIVE_PATHS.some((re) => re.test(cmd));
  }
  return false;
}
