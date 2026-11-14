// 세션 저장소가 엔진의 사건을 화면 쪽에 잇는다 (11-15 합류 G-05 · G-03).
//
//  - 「최근 소식 없음」 — 출력 · 상태 사건마다 활동 시각을 적는다(`noteTermActivity`). 적는 곳이 시험뿐이라 실제
//    앱에서는 30분 넘게 아무 소식이 없는 「작업 중」 세션도 평소처럼 보였다(활동 시각을 모르면 말하지 않는다).
//  - Shift+Enter — 세션을 열 때 붙인 에이전트 신호(`watchAgentScreen`)를 브리지에 넘긴다. 브리지는 첫 마운트에
//    붙으니, 그 전에 온 claude 의 탐침도 세션 쪽이 이미 봤다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  onEvent: null as null | ((ev: unknown) => void),
  osc: new Map<number, (data: string) => boolean>(),
  bufferChange: [] as Array<(buffer: { type: string }) => void>,
  agent: null as null | (() => boolean),
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options: Record<string, unknown> = {};
    unicode = { activeVersion: "6" };
    buffer = {
      active: { type: "normal", getLine: () => undefined },
      onBufferChange: (fn: (buffer: { type: string }) => void) => {
        h.bufferChange.push(fn);
        return { dispose() {} };
      },
    };
    parser = {
      registerOscHandler: (ident: number, fn: (data: string) => boolean) => {
        h.osc.set(ident, fn);
        return { dispose() {} };
      },
    };
    modes = { mouseTrackingMode: "none" };
    loadAddon() {}
    registerLinkProvider() {
      return { dispose() {} };
    }
    onData() {
      return { dispose() {} };
    }
    onResize() {
      return { dispose() {} };
    }
    write(_data: string, cb?: () => void) {
      cb?.();
    }
    open() {}
    focus() {}
    refresh() {}
    resize() {}
    dispose() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@xterm/addon-search", () => ({ SearchAddon: class {} }));
vi.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: class {} }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    onContextLoss() {}
    onAddTextureAtlasCanvas() {}
    dispose() {}
  },
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("@/features/terminal/imeBridge", () => ({
  attachImeBridge: (_term: unknown, _host: unknown, agent: () => boolean) => {
    h.agent = agent;
    return { dispose() {} };
  },
}));
vi.mock("@/api/terminal", () => ({
  terminalApi: {
    list: async () => [],
    open: async (projectId: number, _c: number, _r: number, _p: string | null, onEvent: (ev: unknown) => void) => {
      h.onEvent = onEvent;
      return { id: 7, project_id: projectId, label: "zsh", started_at: "", alive: true, exit_code: null, status: null, busy: true, unseen: false };
    },
    ack: async () => {},
    write: async () => {},
    resize: async () => {},
    close: async () => {},
  },
}));

import { closeTerm, mountTerm, openTerm, termsSnapshot } from "@/features/terminal/termStore";
import { isQuiet, QUIET_AFTER_MS, sessionView, __resetSessionNumbersForTests } from "@/features/terminal/status";
import { t } from "@/i18n";

const T0 = Date.parse("2026-11-15T09:00:00Z");
const WORKING = { state: "working", kind: null, msg: null, since: "2026-11-15T09:00:00Z" };
const session = () => termsSnapshot().find((s) => s.id === 7)!;
/** 탭 · 칸 머리 · 띠가 쓰는 판정 — 「최근 소식 없음」 이면 낱말이 선다. */
const word = () => sessionView(t, session(), true, 1).word;

beforeEach(() => {
  h.onEvent = null;
  h.osc.clear();
  h.bufferChange = [];
  h.agent = null;
  __resetSessionNumbersForTests();
});
afterEach(() => {
  closeTerm(7);
  vi.restoreAllMocks();
});

describe("quiet (terminal.state.quiet) — the store notes every output and status event", () => {
  it("a working session with no output for 31 minutes reads as quiet; the next output clears it", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(T0);
    await openTerm(1);
    h.onEvent!({ kind: "status", status: WORKING });
    h.onEvent!({ kind: "output", data: "x", n: 1 });
    expect(word()).toBeNull();
    clock.mockReturnValue(T0 + 31 * 60_000);
    expect(word()).toBe(t("terminal.state.quiet"));
    h.onEvent!({ kind: "output", data: "still going", n: 11 });
    expect(word()).toBeNull();
  });

  it("a status event counts as news too, and closing the session forgets its clock", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(T0);
    await openTerm(1);
    h.onEvent!({ kind: "status", status: WORKING });
    clock.mockReturnValue(T0 + QUIET_AFTER_MS - 1);
    h.onEvent!({ kind: "status", status: { ...WORKING, msg: "Edit a.ts" } });
    clock.mockReturnValue(T0 + QUIET_AFTER_MS + 60_000);
    expect(word()).toBeNull();
    const info = session();
    closeTerm(7);
    clock.mockReturnValue(T0 + 10 * QUIET_AFTER_MS);
    expect(isQuiet(info)).toBe(false); // 모르는 것은 「소식 없음」 이라 말하지 않는다
  });
});

describe("Shift+Enter — the bridge gets the session's agent signal", () => {
  it("sees the OSC 7501 that came before the first mount; forgets it when the screen returns to normal", async () => {
    await openTerm(1);
    h.osc.get(7501)!("?"); // claude 의 탐침 — 터미널 화면이 아직 이 세션을 안 그렸다
    const off = mountTerm(7, document.createElement("div"));
    expect(h.agent!()).toBe(true);
    for (const fn of h.bufferChange) fn({ type: "normal" });
    expect(h.agent!()).toBe(false);
    h.osc.get(7501)!("state=idle:app=claude");
    expect(h.agent!()).toBe(true);
    off();
  });
});
