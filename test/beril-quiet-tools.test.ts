import assert from "node:assert/strict";
import { test } from "node:test";
import berilDisplay, { redactBashDisplay } from "../extensions/beril-display.ts";

const theme = {
  fg: (_c: string, s: string) => s,
  bold: (s: string) => s,
  getColorMode: () => "truecolor",
} as any;

function harness() {
  const tools: Record<string, any> = {};
  const pi: any = { registerTool: (t: any) => (tools[t.name] = t), on: () => {} };
  berilDisplay(pi);
  return { tools };
}

test("registers a bash override", () => {
  const { tools } = harness();
  assert.ok(tools.bash);
  assert.equal(tools.bash.name, "bash");
  assert.equal(typeof tools.bash.execute, "function");
});

test("redacts transient clipboard images and pi temp logs", () => {
  const input =
    "file /var/folders/fy/v71_p2597xxd32m35rzvh2_m0000gp/T/pi-clipboard-a903bb53-912c-4920-b722-b46cf7cc458f.png && tail /tmp/pi-bash-abc123.log";
  assert.equal(redactBashDisplay(input), "file <clipboard image> && tail <pi temp log>");
});

test("renderCall hides clipboard temp paths", () => {
  const { tools } = harness();
  const component = tools.bash.renderCall(
    {
      command:
        "python /var/folders/fy/v71_p2597xxd32m35rzvh2_m0000gp/T/pi-clipboard-a903bb53-912c-4920-b722-b46cf7cc458f.png",
    },
    theme,
    {},
  );
  assert.equal(component.render(100).join("\n").trimEnd(), "bash <clipboard image>");
});

test("renderCall hides multiline shell scripts", () => {
  const { tools } = harness();
  const component = tools.bash.renderCall({ command: "cat <<'EOF'\nsecret-ish plumbing\nEOF" }, theme, {});
  assert.equal(component.render(100).join("\n").trimEnd(), "bash <script>");
});

test("collapsed renderResult shows only a compact completion line", () => {
  const { tools } = harness();
  const component = tools.bash.renderResult(
    { content: [{ type: "text", text: "one\ntwo\n" }], details: {} },
    { expanded: false, isPartial: false },
    theme,
    { cwd: process.cwd(), isError: false },
  );
  assert.equal(component.render(100).join("\n").trimEnd(), "✓ bash done (2 lines)");
});
