/**
 * The #1 unaddressed workshop ask was "I just want to look at the plot." After a
 * notebook runs, beril knows which figures are NEW; this pure helper finds them
 * by mtime so the analysis extension can offer them as clickable links, and
 * `openCommand` names the platform's read-only viewer launcher so `/figures` can
 * open one without a shell.
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

/**
 * Figure files under `<projectDir>/figures` whose mtime is strictly newer than
 * `sinceMs` (epoch ms), as absolute paths, sorted. A missing `figures/` dir — or
 * any unreadable entry — yields `[]` rather than throwing: "no new figures" is a
 * normal outcome, never an error.
 */
export function newFigures(projectDir: string, sinceMs: number): string[] {
  const dir = join(projectDir, "figures");
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const fresh: string[] = [];
  for (const name of names) {
    const path = join(dir, name);
    try {
      const st = statSync(path);
      if (st.isFile() && st.mtimeMs > sinceMs) fresh.push(path);
    } catch {
      // Skip entries that vanished or can't be stat'd; they're simply not "new".
    }
  }
  return fresh.sort();
}

/** The platform's read-only viewer launcher for a path: `open` on macOS, else `xdg-open`. */
export function openCommand(path: string): string[] {
  return process.platform === "darwin" ? ["open", path] : ["xdg-open", path];
}
