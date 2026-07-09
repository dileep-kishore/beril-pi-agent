import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Image } from "@earendil-works/pi-tui";

/**
 * Inline figure rendering — the workshop's #1 ask ("I just want to look at the
 * plot"). pi-tui's `Image` speaks the Kitty/iTerm2 graphics protocols and
 * degrades to a text placeholder on terminals without image support, so the plot
 * shows IN the transcript; the `figuresCard` link list stays the universal
 * fallback for opening it externally.
 */

const RASTER_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** The raster MIME type for a figure path, or undefined when not inline-renderable. */
export function mimeFor(path: string): string | undefined {
  return RASTER_MIME[extname(path).toLowerCase()];
}

/**
 * Inline `Image` components (capped count + height, filename captions) for the
 * raster figures among `paths`. Never throws — a non-raster or unreadable file
 * is simply skipped; it still appears as a link in the figures card.
 */
export function inlineImages(theme: Theme, paths: string[], max = 3, maxHeightCells = 20): Component[] {
  const images: Component[] = [];
  for (const path of paths ?? []) {
    if (images.length >= max) break;
    const mime = mimeFor(path);
    if (!mime) continue;
    try {
      images.push(
        new Image(
          readFileSync(path).toString("base64"),
          mime,
          { fallbackColor: (s) => theme.fg("muted", s) },
          { filename: basename(path), maxHeightCells },
        ),
      );
    } catch {
      // Unreadable → skipped; the link in figuresCard still points at it.
    }
  }
  return images;
}
