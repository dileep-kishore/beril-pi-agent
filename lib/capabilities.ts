export interface Capability {
  id: string;
  title: string;
  intent: string;
  command: string;
  skill?: string;
  prompt?: string;
  tools: string[];
  when: string;
  next: string;
  aliases: RegExp[];
}

export interface RuntimeSurfaceSummary {
  commandCount: number;
  toolCount: number;
}

export const CAPABILITIES: Capability[] = [
  {
    id: "start",
    title: "Start or Continue",
    intent: "Orient to the current project and choose the next step.",
    command: "/berdl-start",
    prompt: "berdl-start",
    tools: ["berdl_env_check", "berdl_discover"],
    when: "New session, returning to old work, or lost context.",
    next: "/whereami or /next",
    aliases: [/start|continue|where am i|lost|status/i],
  },
  {
    id: "discover",
    title: "Explore data",
    intent: "Find BERDL tables, inspect schema/sample rows, and test answerability.",
    command: "/berdl-preview <table>",
    skill: "berdl-discover",
    tools: ["berdl_discover", "berdl_peek", "berdl_feasibility", "berdl_query"],
    when: "The question depends on unknown tables, joins, coverage, or schema.",
    next: "/research-plan <project>",
    aliases: [/discover|explore|schema|table|coverage|query|data/i],
  },
  {
    id: "plan",
    title: "Plan study",
    intent: "Turn an answerable question into hypotheses and falsifying analyses.",
    command: "/research-plan <project>",
    skill: "research-plan",
    tools: ["berdl_feasibility", "research_plan", "request_checkpoint"],
    when: "A candidate question has enough data support to become a project.",
    next: "/analyze <project> --first-result",
    aliases: [/plan|hypothesis|falsif|study design|question/i],
  },
  {
    id: "analyze",
    title: "Run first result",
    intent: "Run the first discriminating notebook, inspect it, then continue.",
    command: "/analyze <project> --first-result",
    skill: "analysis-notebooks",
    tools: ["notebook_scaffold", "notebook_list", "notebook_run", "request_checkpoint"],
    when: "A plan is approved and the next move is empirical execution.",
    next: "/analyze <project> --continue",
    aliases: [/analy[sz]e|notebook|first result|run result|figure/i],
  },
  {
    id: "literature",
    title: "Find literature",
    intent: "Build project-scoped references and classify papers as support/refute/NEI.",
    command: "/literature-review <topic>",
    skill: "literature-review",
    tools: ["lit_search", "lit_fetch", "lit_abstract", "lit_stance"],
    when: "You need prior work, novelty, citations, or contradictions.",
    next: "add supports/refutes to claims.json and REPORT.md",
    aliases: [/literature|paper|citation|pubmed|has anyone|novel|contradict/i],
  },
  {
    id: "synthesize",
    title: "Synthesize claims",
    intent: "Draft REPORT.md from executed artifacts while preserving support/refute state.",
    command: "/synthesize <project>",
    skill: "synthesize",
    tools: ["claim_state", "claim_ledger", "evidence", "lit_stance"],
    when: "Executed notebooks exist and the first-result checkpoint was accepted.",
    next: "/berdl-refute <project>",
    aliases: [/synthesi[sz]e|report|write findings|interpret/i],
  },
  {
    id: "refute",
    title: "Refute findings",
    intent: "Actively seek disconfirming checks before review or submission.",
    command: "/berdl-refute <project>",
    skill: "berdl-review",
    tools: ["evidence", "claim_state"],
    when: "A report has headline findings that need stress testing.",
    next: "/berdl-review <project>",
    aliases: [/refute|red.?team|stress test|disconfirm|skeptic|contradict/i],
  },
  {
    id: "review",
    title: "Review report",
    intent: "Run independent read-only review or a multi-specialist panel.",
    command: "/berdl-review <project>",
    skill: "berdl-review",
    tools: ["notebook_hash", "claim_ledger", "evidence"],
    when: "REPORT.md and claims.json are ready for external scrutiny.",
    next: "/submit <project>",
    aliases: [/review|critic|panel|audit|hash/i],
  },
  {
    id: "submit",
    title: "Submit",
    intent: "Approve and archive a reviewed project under the responsible ORCID.",
    command: "/submit <project>",
    skill: "submit",
    tools: ["beril_user", "lakehouse_submit", "notebook_hash"],
    when: "Review is current and the responsible author stands behind the report.",
    next: "/science-memory",
    aliases: [/submit|approve|archive|publish|lakehouse/i],
  },
  {
    id: "memory",
    title: "Mine approved memory",
    intent: "Use reviewed discoveries and performance notes to seed better ideas.",
    command: "/idea-tournament <topic>",
    skill: "suggest-research",
    tools: ["science_memory"],
    when: "You want non-random, data-aware next project ideas.",
    next: "/research-plan <project>",
    aliases: [/idea|suggest|memory|next project|brainstorm|tournament/i],
  },
];

export function runtimeSurfaceSummary(
  commands: { name?: string }[] = [],
  tools: { name?: string }[] = [],
): RuntimeSurfaceSummary {
  return { commandCount: commands.length, toolCount: tools.length };
}

export function matchCapability(text: string): Capability | undefined {
  const clean = text.trim();
  if (!clean || clean.startsWith("/")) return undefined;
  const routeOrder: Array<[RegExp, string]> = [
    [/\b(refute|red.?team|stress test|disconfirm|skeptic)\b/i, "refute"],
    [/\b(papers?|literature|citation|pubmed|novel|contradict)\b/i, "literature"],
    [/\b(submit|approve|archive|publish|lakehouse)\b/i, "submit"],
  ];
  for (const [rx, id] of routeOrder) {
    if (rx.test(clean)) return CAPABILITIES.find((cap) => cap.id === id);
  }
  let best: { cap: Capability; score: number } | undefined;
  for (const cap of CAPABILITIES) {
    const score = cap.aliases.filter((rx) => rx.test(clean)).length;
    if (score > 0 && (!best || score > best.score)) best = { cap, score };
  }
  return best?.cap;
}

export function capabilityCatalogMarkdown(summary?: Partial<RuntimeSurfaceSummary>): string {
  const runtime =
    summary?.commandCount != null || summary?.toolCount != null
      ? `Runtime surface: ${summary.commandCount ?? 0} commands, ${summary.toolCount ?? 0} tools.\n\n`
      : "";
  const lines = ["# BERIL Capabilities", "", runtime.trim(), ""].filter(Boolean);
  for (const cap of CAPABILITIES) {
    const promptLine = cap.prompt ? [`- Prompt: \`${cap.prompt}\``] : [];
    const skillLine = cap.skill ? [`- Skill: \`${cap.skill}\``] : [];
    lines.push(
      `## ${cap.title}`,
      "",
      cap.intent,
      "",
      `- Command: \`${cap.command}\``,
      ...promptLine,
      ...skillLine,
      `- Tools: ${cap.tools.map((t) => `\`${t}\``).join(", ")}`,
      `- Use when: ${cap.when}`,
      `- Next: ${cap.next}`,
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

export function resourceLabel(cap: Capability): string {
  if (cap.skill) return `Skill: ${cap.skill}`;
  if (cap.prompt) return `Prompt: ${cap.prompt}`;
  return "Runtime command";
}

export function routeNudge(cap: Capability): string {
  return `Suggested BERIL route: ${cap.title} -> ${cap.command}. ${resourceLabel(cap)}. Next: ${cap.next}.`;
}
