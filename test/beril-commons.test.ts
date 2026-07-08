import assert from "node:assert/strict";
import { test } from "node:test";
import berilCommons from "../extensions/beril-commons.ts";

/** Harness with a programmable `pi.exec` and captured `sendMessage` payloads. */
function harness(exec: (cmd: string, args: string[]) => any) {
  const tools: any = {};
  const commands: any = {};
  const messages: any[] = [];
  const pi: any = {
    registerTool: (t: any) => (tools[t.name] = t),
    registerCommand: (n: string, o: any) => (commands[n] = o),
    registerMessageRenderer: () => {},
    sendMessage: (m: any) => messages.push(m),
    sendUserMessage: () => {},
    on: () => {},
    exec: async (cmd: string, args: string[]) => exec(cmd, args),
    events: { emit: () => {}, on: () => () => {} },
  };
  berilCommons(pi);
  return { tools, commands, messages };
}

const ok = (obj: unknown) => ({ stdout: JSON.stringify(obj), stderr: "", code: 0, killed: false });
const cmdCtx = () => ({ hasUI: true, ui: { notify: () => {} } }) as any;

test("registers the commons tools and /commons command", () => {
  const h = harness(() => ok({}));
  assert.ok(h.tools.commons_check && h.tools.commons_land);
  assert.ok(h.commands.commons);
});

test("commons_check reuse-frames an overlap (never 'don't redo')", async () => {
  const h = harness(() =>
    ok({ verdict: "overlap", matches: [{ score: 0.7, kind: "finding", project: "prior", body: "x" }] }),
  );
  const res = await h.tools.commons_check.execute("1", { question: "does X hold?" }, undefined, undefined, {});
  const text = res.content[0].text as string;
  assert.match(text, /build on/i);
  assert.doesNotMatch(text, /don'?t redo/i);
});

test("commons_check flags an open gap as most actionable", async () => {
  const h = harness(() => ok({ verdict: "related", matches: [{ score: 0.3, kind: "gap", project: "p", body: "g" }] }));
  const res = await h.tools.commons_check.execute("1", { question: "q" }, undefined, undefined, {});
  assert.match(res.content[0].text as string, /gap/i);
});

test("commons_land --from-report shells the extraction verb", async () => {
  const calls: string[][] = [];
  const h = harness((_c, args) => {
    calls.push(args);
    return ok({ landed: 3, skipped_duplicates: 1, by_kind: { finding: 2, gap: 1 } });
  });
  const res = await h.tools.commons_land.execute("1", { project: "demo", from_report: true }, undefined, undefined, {});
  assert.deepEqual(calls[0], ["commons", "land", "demo", "--from-report"]);
  assert.match(res.content[0].text as string, /Landed 3/);
});

test("/commons sends a rendered commons card", async () => {
  const h = harness(() => ok({ verdict: "novel", matches: [] }));
  await h.commands.commons.handler("methanol dehydrogenase", cmdCtx());
  assert.equal(h.messages[0].customType, "beril-commons-check");
  assert.equal(h.messages[0].details.result.verdict, "novel");
});
