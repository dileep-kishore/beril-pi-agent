import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  type CheckpointOpt,
  type CheckpointPick,
  buildOverlay,
  normalizeOptions,
} from "../lib/ui/checkpoint-overlay.ts";
import { DEFAULT_CHECKPOINT_OPTIONS } from "../lib/ui/checkpoint.ts";

const theme = {
  fg: (_c: string, s: string) => s,
  bold: (s: string) => s,
  italic: (s: string) => s,
  strikethrough: (s: string) => s,
  underline: (s: string) => s,
  getColorMode: () => "truecolor",
} as any;

// Synthesize the raw input the terminal would send for a key, so handleInput +
// matchesKey route exactly as they do live (no Kitty protocol asserted active).
const KEY = {
  up: "\x1b[A",
  down: "\x1b[B",
  enter: "\r",
  space: " ",
  escape: "\x1b",
};

function drive(opts: CheckpointOpt[], multi: boolean, keys: string[]): CheckpointPick | undefined {
  let result: CheckpointPick | undefined;
  const comp = buildOverlay(opts, multi, "Plan ready?", undefined, theme, (r) => {
    result = r;
  });
  for (const k of keys) comp.handleInput?.(k);
  return result;
}

test("normalizeOptions wraps bare strings into {label}", () => {
  assert.deepEqual(normalizeOptions(["A", "B"]), [{ label: "A" }, { label: "B" }]);
});

test("normalizeOptions passes typed options through unchanged", () => {
  const typed: CheckpointOpt[] = [{ label: "Adjust", rationale: "rework the plan", preview: "details" }];
  assert.deepEqual(normalizeOptions(typed), typed);
});

test("normalizeOptions falls back to the default options when absent/empty", () => {
  assert.deepEqual(
    normalizeOptions(undefined),
    DEFAULT_CHECKPOINT_OPTIONS.map((label) => ({ label })),
  );
  assert.deepEqual(
    normalizeOptions([]),
    DEFAULT_CHECKPOINT_OPTIONS.map((label) => ({ label })),
  );
});

test("single-select: down then enter chooses the second option", () => {
  const pick = drive([{ label: "A" }, { label: "B" }], false, [KEY.down, KEY.enter]);
  assert.deepEqual(pick, { labels: ["B"] });
});

test("single-select: cursor wraps past the end", () => {
  // 2 options, two downs returns to the first.
  const pick = drive([{ label: "A" }, { label: "B" }], false, [KEY.down, KEY.down, KEY.enter]);
  assert.deepEqual(pick, { labels: ["A"] });
});

test("multi-select: space/down/space/enter returns both labels in option order", () => {
  const pick = drive([{ label: "A" }, { label: "B" }], true, [KEY.space, KEY.down, KEY.space, KEY.enter]);
  assert.deepEqual(pick, { labels: ["A", "B"] });
});

test("multi-select: enter with nothing ticked falls back to the cursor label", () => {
  const pick = drive([{ label: "A" }, { label: "B" }], true, [KEY.down, KEY.enter]);
  assert.deepEqual(pick, { labels: ["B"] });
});

test("multi-select: toggling the same option twice deselects it", () => {
  const pick = drive([{ label: "A" }, { label: "B" }], true, [KEY.space, KEY.space, KEY.down, KEY.space, KEY.enter]);
  assert.deepEqual(pick, { labels: ["B"] });
});

test("escape dismisses with no labels (the promise never hangs)", () => {
  const pick = drive([{ label: "A" }, { label: "B" }], false, [KEY.escape]);
  assert.deepEqual(pick, { labels: [] });
});

test("render(60) frames the title, the focused preview, and the single-select hint", () => {
  let _done = false;
  const comp = buildOverlay(
    [{ label: "Approve", preview: "kick off the analysis" }, { label: "Adjust" }],
    false,
    "Plan ready?",
    "Drafted a 3-notebook plan.",
    theme,
    () => {
      _done = true;
    },
  );
  const text = comp.render(60).join("\n");
  assert.ok(text.includes("Checkpoint · Plan ready?"));
  assert.ok(text.includes("Drafted a 3-notebook plan."));
  assert.ok(text.includes("kick off the analysis"), "focused option's preview shows");
  assert.ok(text.includes("enter choose"), "single-select hint shows");
  assert.ok(!_done, "rendering does not resolve");
});

test("render(60) shows the multi-select hint and checkbox prefixes", () => {
  const comp = buildOverlay([{ label: "A" }, { label: "B" }], true, "Pick all", undefined, theme, () => {});
  const text = comp.render(60).join("\n");
  assert.ok(text.includes("space toggle"), "multi-select hint shows");
  assert.ok(text.includes("[ ]"), "unchecked checkbox shows");
});

test("every rendered line is exactly the frame width (frameCard pads)", () => {
  // frameCard pads each line to `width` *visible* columns (it injects a RESET escape
  // per body row, so raw `.length` overcounts — assert on visibleWidth).
  const comp = buildOverlay([{ label: "A" }, { label: "B" }], false, "T", undefined, theme, () => {});
  for (const line of comp.render(50)) assert.equal(visibleWidth(line), 50);
});
