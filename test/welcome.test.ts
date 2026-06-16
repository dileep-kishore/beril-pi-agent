import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { BRANDS } from "../lib/ui/brand.ts";
import { TIPS, type WelcomeTheme, pickTip, welcomePanel } from "../lib/ui/welcome.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  getColorMode: () => "truecolor",
} as unknown as WelcomeTheme;

const state = {
  brand: BRANDS.beril,
  connection: "BERDL off-cluster",
  ready: true,
  researcher: "Dileep Kishore",
  orcidOk: true,
  state: "active",
  tip: "hello tip",
};

test("welcome panel is a frame whose every line is exactly `width` columns", () => {
  for (const width of [60, 70, 90]) {
    const lines = welcomePanel(theme, state, width);
    assert.ok(lines[0].startsWith("╭"), "top border");
    assert.ok(lines.at(-1)?.endsWith("╯"), "bottom border");
    for (const line of lines) assert.equal(visibleWidth(line), width);
  }
});

test("welcome panel carries the identity, connection, arc, and tip", () => {
  const text = welcomePanel(theme, state, 80).join("\n");
  assert.ok(text.includes("BERIL"), "brand in the title/body");
  assert.ok(text.includes("Dileep Kishore"), "researcher");
  assert.ok(text.includes("BERDL off-cluster ✓"), "connection");
  assert.ok(text.includes("explore") && text.includes("analyze"), "the arc steps");
  assert.ok(text.includes("hello tip"), "the tip");
});

test("pickTip wraps deterministically over the tip list", () => {
  assert.equal(pickTip(0), TIPS[0]);
  assert.equal(pickTip(TIPS.length), TIPS[0]);
  assert.equal(pickTip(-1), TIPS[TIPS.length - 1]);
});
