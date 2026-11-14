// 「내 차례」 한 키 (⌘J, 11-15) — 차례 줄의 순서와 한 번 누를 때마다 어디로 가는가.
import { afterEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({
  list: [] as unknown[],
  overview: [] as unknown[],
  open: [] as number[],
  attention: new Map<number, { project_id: number; waiting: number; failing: boolean }>(),
  asked: [] as number[][],
  openWindow: vi.fn(async (_id: number) => null),
}));

vi.mock("@/api/terminal", () => ({ terminalApi: { list: async () => fx.list, overview: async () => fx.overview } }));
vi.mock("@/api/window", () => ({
  windowApi: {
    openProjectIds: async () => fx.open,
    attention: async (ids: number[]) => {
      fx.asked.push(ids);
      return new Map([...fx.attention].filter(([id]) => ids.includes(id)));
    },
    openProjectWindow: fx.openWindow,
  },
}));

import { __resetJumpForTests, jumpToWaiting, nextWaiting, waitingOrder } from "@/features/shell/jumpWaiting";
import { onTermFocusRequested, takeTermFocus } from "@/features/terminal/focusRequest";
import { NAV_BUS } from "@/lib/navRegistry";
import { toast } from "@/lib/toast";
import { t } from "@/i18n";
import type { TermInfo } from "@/lib/bindings";

const at = (hhmm: string) => `2026-11-15T${hhmm}:00Z`;

function session(id: number, over: Partial<TermInfo> = {}): TermInfo {
  return {
    id,
    project_id: 1,
    label: "zsh",
    started_at: at("09:00"),
    alive: true,
    exit_code: null,
    status: null,
    busy: true,
    unseen: false,
    ...over,
  };
}

const blocked = (id: number, since: string) =>
  session(id, { status: { state: "blocked", kind: "permission", msg: null, since: at(since) } });

afterEach(() => {
  __resetJumpForTests();
  takeTermFocus();
  fx.list = [];
  fx.overview = [];
  fx.open = [];
  fx.attention = new Map();
  fx.asked = [];
  fx.openWindow.mockClear();
  vi.restoreAllMocks();
});

describe("nextWaiting", () => {
  it("walks the blocked sessions oldest first, then wraps to the first", () => {
    const list = [session(1), blocked(2, "10:05"), blocked(3, "10:00")];
    expect(nextWaiting(list, null)).toBe(3);
    expect(nextWaiting(list, 3)).toBe(2);
    expect(nextWaiting(list, 2)).toBe(3);
  });

  it("with nothing blocked, an unseen session that ended (errors first) is next", () => {
    const done = session(4, { unseen: true, status: { state: "done", kind: null, msg: null, since: at("09:30") } });
    const failed = session(5, { unseen: true, status: { state: "error", kind: null, msg: null, since: at("09:40") } });
    expect(nextWaiting([session(1), done, failed], null)).toBe(5);
    expect(waitingOrder([done, failed, blocked(6, "11:00")]).map((s) => s.id)).toEqual([6, 5, 4]);
  });

  it("returns null when nobody waits — a running or seen session is not a turn", () => {
    const working = session(7, { status: { state: "working", kind: null, msg: null, since: at("09:00") } });
    const seenDone = session(8, { status: { state: "done", kind: null, msg: null, since: at("09:00") } });
    expect(nextWaiting([working, seenDone], null)).toBeNull();
    expect(nextWaiting([], 3)).toBeNull();
  });

  it("a session that stopped waiting drops out — the next press starts from the top", () => {
    expect(nextWaiting([blocked(2, "10:05"), blocked(9, "10:10")], 3)).toBe(2);
  });
});

describe("jumpToWaiting", () => {
  it("asks for the oldest waiting session and moves on to the next one on the second press", async () => {
    fx.list = [blocked(2, "10:05"), blocked(3, "10:00")];
    const asked: number[] = [];
    const off = onTermFocusRequested((id) => asked.push(id));
    expect(await jumpToWaiting(1)).toBe("session");
    expect(await jumpToWaiting(1)).toBe("session");
    off();
    expect(asked).toEqual([3, 2]);
    expect(fx.openWindow).not.toHaveBeenCalled();
  });

  it("a question in this project goes to Today — not 「no session is waiting」", async () => {
    fx.open = [1];
    fx.attention = new Map([[1, { project_id: 1, waiting: 1, failing: false }]]);
    const views: string[] = [];
    const onView = (e: Event) => views.push((e as CustomEvent<string>).detail);
    window.addEventListener(NAV_BUS.setView, onView);
    const info = vi.spyOn(toast, "info");
    expect(await jumpToWaiting(1)).toBe("today");
    window.removeEventListener(NAV_BUS.setView, onView);
    expect(views).toEqual(["today"]);
    expect(info).not.toHaveBeenCalled();
  });

  it("another window's session waits by the same rule as this window's — the oldest one's window comes forward", async () => {
    fx.open = [1, 2, 3];
    fx.overview = [{ ...blocked(7, "10:05"), project_id: 2 }, { ...blocked(8, "10:00"), project_id: 3 }, blocked(9, "09:00")];
    // 다른 창의 질문이 더 많아도 세션 기다림이 먼저다.
    fx.attention = new Map([[2, { project_id: 2, waiting: 3, failing: false }]]);
    expect(await jumpToWaiting(1)).toBe("window");
    expect(fx.openWindow).toHaveBeenCalledWith(3);
  });

  it("falls back to the open window that waits most — never opens a window for a project without one", async () => {
    fx.open = [1, 2];
    fx.attention = new Map([
      [2, { project_id: 2, waiting: 1, failing: false }],
      [3, { project_id: 3, waiting: 2, failing: false }],
    ]);
    expect(await jumpToWaiting(1)).toBe("window");
    expect(fx.openWindow).toHaveBeenCalledWith(2);
    expect(fx.asked.flat()).not.toContain(3);
  });

  it("says so quietly when nothing waits anywhere", async () => {
    fx.open = [1];
    const info = vi.spyOn(toast, "info");
    expect(await jumpToWaiting(1)).toBe("none");
    expect(info).toHaveBeenCalledWith(t("nav.jumpWaitingNone"), expect.objectContaining({ dedupKey: expect.any(String) }));
    expect(takeTermFocus()).toBeNull();
  });
});
