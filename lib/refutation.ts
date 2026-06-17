export function summarizeRefutationChecks(markdown: string, limit = 6): string[] {
  const lines = markdown.split(/\r?\n/);
  const out: string[] = [];
  let inTargetSection = false;
  for (const line of lines) {
    if (/^#{1,4}\s+/.test(line)) {
      inTargetSection = /surviving|disconfirm|contradict|critical|refut/i.test(line);
      continue;
    }
    if (!inTargetSection) continue;
    const bullet = line.match(/^\s*[-*]\s+(.+?)\s*$/);
    if (!bullet) continue;
    const text = bullet[1].trim();
    if (text && !/^none\b/i.test(text)) out.push(text);
    if (out.length >= limit) break;
  }
  if (out.length) return out;
  return lines
    .map((l) => l.match(/^\s*[-*]\s+(.+?)\s*$/)?.[1]?.trim())
    .filter((l): l is string => Boolean(l && !/^none\b/i.test(l)))
    .slice(0, limit);
}
