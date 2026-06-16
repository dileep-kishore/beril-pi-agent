import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

/**
 * Project-id completions for slash commands. Pi's command completion API passes
 * only the current argument prefix (no ctx), so resolve relative to process.cwd()
 * — `beril start` chdirs to the repo root before launching Pi.
 */
export function projectCompletions(prefix: string): AutocompleteItem[] | null {
  const first = prefix.trimStart().split(/\s+/)[0] ?? "";
  const dir = join(process.cwd(), "projects");
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => {
      try {
        return statSync(join(dir, name)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return null;
  }
  const items = names
    .filter((name) => name.startsWith(first))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 50)
    .map((name) => ({ value: name, label: name }));
  return items.length ? items : null;
}
