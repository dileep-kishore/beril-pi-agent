export type ScienceLabelKind = "lifecycle" | "checkpoint" | "manual";

export interface LabelledEntry {
  id: string;
}

export function slugLabel(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function scienceLabel(kind: ScienceLabelKind, project: string, detail?: string): string {
  const p = slugLabel(project || "project");
  if (kind === "lifecycle") return `beril:${p}:${slugLabel(detail || "state")}`;
  if (kind === "checkpoint") return `beril:${p}:checkpoint:${slugLabel(detail || "decision")}`;
  return `beril:${p}:${slugLabel(detail || "bookmark")}`;
}

export function findLabelledEntry<T extends LabelledEntry>(
  entries: T[],
  getLabel: (id: string) => string | undefined,
  query: string,
): T | undefined {
  const q = slugLabel(query);
  for (let i = entries.length - 1; i >= 0; i--) {
    const label = getLabel(entries[i].id);
    if (!label) continue;
    if (slugLabel(label).includes(q)) return entries[i];
  }
  return undefined;
}

export function lastLabelableEntry<T extends LabelledEntry>(entries: T[]): T | undefined {
  return entries.at(-1);
}
