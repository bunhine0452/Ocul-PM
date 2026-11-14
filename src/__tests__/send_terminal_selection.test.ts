// 고른 출력을 Claude 에게 (⌘L) · 받는 곳은 Claude 만 (업그레이드 라운드 TI-08).
import { afterEach, describe, expect, it } from "vitest";

import type { TermInfo } from "@/api/terminal";
import {
  BODY_MAX,
  composeMessage,
  onSendToClaude,
  receiversOf,
  type SendContext,
} from "@/features/terminal/sendToClaude";
import { translateKey, type KeyEventLike } from "@/features/terminal/termKeys";
import { t } from "@/i18n";
import { __setPlatformForTests } from "@/lib/platform";
import { fireKey, openRealTerm, type RealTerm } from "./xtermHarness";

function key(init: Partial<KeyEventLike>): KeyEventLike {
  return {
    type: "keydown",
    key: "l",
    code: "KeyL",
    keyCode: 76,
    isComposing: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...init,
  };
}

describe("⌘L in the key layer", () => {
  it("asks to send the selection only when something is selected", () => {
    expect(translateKey(key({ metaKey: true }), { isMac: true, altScreen: false, hasSelection: true })).toEqual({
      kind: "sendSelection",
    });
    expect(translateKey(key({ metaKey: true }), { isMac: true, altScreen: false, hasSelection: false })).toBeNull();
  });

  it("is Ctrl+Shift+L elsewhere (terminal family) — plain Ctrl+L stays the shell's clear", () => {
    const pc = { isMac: false, altScreen: false, hasSelection: true };
    expect(translateKey(key({ ctrlKey: true, shiftKey: true, key: "L" }), pc)).toEqual({ kind: "sendSelection" });
    expect(translateKey(key({ ctrlKey: true }), pc)).toBeNull();
  });
});

describe("⌘L through the bridge (real xterm)", () => {
  let rt: RealTerm | null = null;
  let off: (() => void) | null = null;
  afterEach(() => {
    off?.();
    off = null;
    rt?.dispose();
    rt = null;
  });

  function listen(): SendContext[] {
    const got: SendContext[] = [];
    off = onSendToClaude((ctx) => got.push(ctx));
    return got;
  }

  it("opens the send dialog with the cleaned selection as a terminal context", async () => {
    const got = listen();
    rt = openRealTerm({ cols: 30 });
    await rt.write("  npm ERR! code 1  \r\n  npm ERR! missing script\r\n");
    rt.term.selectAll();
    const down = fireKey(rt, "keydown", { key: "l", code: "KeyL", keyCode: 76, metaKey: true });
    expect(got).toHaveLength(1);
    expect(got[0].kind).toBe("terminal");
    expect(got[0].body).toBe("npm ERR! code 1\nnpm ERR! missing script");
    expect(got[0].label).toBe(t("send.ctx.terminal", { n: 2 }));
    expect(down.defaultPrevented).toBe(true);
    expect(rt.data).toEqual([]);
  });

  it("does nothing without a selection", () => {
    const got = listen();
    rt = openRealTerm();
    fireKey(rt, "keydown", { key: "l", code: "KeyL", keyCode: 76, metaKey: true });
    expect(got).toHaveLength(0);
  });

  it("Windows: Ctrl+Shift+L", async () => {
    __setPlatformForTests("windows");
    const got = listen();
    rt = openRealTerm();
    await rt.write("boom\r\n");
    rt.term.selectAll();
    fireKey(rt, "keydown", { key: "L", code: "KeyL", keyCode: 76, ctrlKey: true, shiftKey: true });
    expect(got.map((c) => c.body)).toEqual(["boom"]);
  });
});

describe("composeMessage with a terminal context", () => {
  const ctx = (body: string): SendContext => ({ kind: "terminal", label: "2", ref: "", body });

  it("puts the output in a code fence between the context line and what I wrote", () => {
    const msg = composeMessage(t, ctx("error: x\nat y"), " fix it ");
    expect(msg).toBe(`${t("send.msg.terminal", { label: "2", ref: "" })}\n\n\`\`\`\nerror: x\nat y\n\`\`\`\n\nfix it`);
  });

  it("uses a longer fence than any run of backticks inside, so the output cannot close it", () => {
    const msg = composeMessage(t, ctx("a\n```\nb"), "x");
    expect(msg).toContain("````\na\n```\nb\n````");
  });

  it("keeps the last 4000 characters of a long selection and cleans control bytes", () => {
    const long = `${"x".repeat(BODY_MAX)}\x1b[31mTAIL`;
    const msg = composeMessage(t, ctx(long), "x");
    expect(msg).toContain("…\n");
    expect(msg).toContain("TAIL\n```");
    expect(msg).not.toContain("\x1b");
    const fenced = msg.slice(msg.indexOf("```\n") + 4, msg.lastIndexOf("\n```"));
    expect(fenced.length).toBe(BODY_MAX + 2); // 「…」 과 줄바꿈
  });
});

describe("receivers are Claude sessions only", () => {
  function session(id: number, app?: string | null): TermInfo {
    const status = { state: "idle", kind: null, msg: null, since: "", ...(app === undefined ? {} : { app }) };
    return {
      id,
      project_id: 1,
      label: "zsh",
      started_at: "2026-11-15T10:00:00Z",
      alive: true,
      exit_code: null,
      status,
      busy: true,
      unseen: false,
    };
  }

  it("leaves out a session whose program says it is Codex", () => {
    const got = receiversOf([session(1, "claude"), session(2, "codex"), session(3), session(4, null), session(5, "Claude Code")]);
    expect(got.map((s) => s.id)).toEqual([1, 3, 4, 5]);
  });
});
