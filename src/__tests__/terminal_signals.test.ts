// TE-06 — terminal OS alerts are for exceptions only: entering "waiting" or "error", or a long run (60s+)
// that ended with no journal since the session started; plus bells and program notices (OSC 9 / 777) at most
// once per 30s per session and the same text once per 10 minutes — all only while the window is in the back.
// The title is "project · session name". A focus within 10s of an alert lands on that session.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TermInfo, TermStatus } from "@/api/terminal";

const h = vi.hoisted(() => ({
  sent: [] as Array<{ title: string; body?: string }>,
  entries: [] as Array<{ created_at: string }>,
  landed: [] as number[],
}));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: async () => true,
  requestPermission: async () => "granted",
  sendNotification: (n: { title: string; body?: string }) => void h.sent.push(n),
}));
vi.mock("@/api/oculpm", () => ({
  oculpmApi: {
    getStatus: async () => ({ current_workday: "20261115" }),
    listJournalEntries: async () => h.entries,
  },
}));
vi.mock("@/features/terminal/focusRequest", () => ({
  requestTermFocus: (id: number) => void h.landed.push(id),
}));

import {
  LANDING_MS,
  SIGNAL_GAP_MS,
  alertIfWaiting,
  alertOnSignal,
  forgetAlerts,
  setAlertProjectName,
  shouldAlert,
} from "@/features/terminal/attention";
import { t } from "@/i18n";

const T0 = Date.UTC(2026, 10, 15, 3, 0, 0);
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();
const st = (state: string, since: string, msg: string | null = null): TermStatus => ({ state, kind: null, msg, since });

function info(id: number, status: TermStatus | null, title: string | null = null): TermInfo {
  return {
    id,
    project_id: 1,
    label: "claude",
    started_at: at(0),
    alive: true,
    exit_code: null,
    status,
    busy: true,
    unseen: false,
    title,
  };
}

let focused = false;
beforeEach(() => {
  focused = false;
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0 + 120_000);
  setAlertProjectName("ai-pm");
  h.sent = [];
  h.entries = [];
  h.landed = [];
});
afterEach(() => {
  for (let id = 1; id <= 9; id++) forgetAlerts(id);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("which status changes alert", () => {
  const working = st("working", at(0));
  const idleAfter70s = st("idle", at(70));

  it("a long run that ended with no journal, waiting, and error — only while the window is in the back", () => {
    expect(shouldAlert(working, idleAfter70s, false, 0)).toBe(true);
    expect(shouldAlert(working, st("done", at(70)), false, 0)).toBe(true);
    expect(shouldAlert(working, idleAfter70s, false, 1)).toBe(false);
    expect(shouldAlert(working, idleAfter70s, true, 0)).toBe(false);
    expect(shouldAlert(working, idleAfter70s, false, null)).toBe(false);
    expect(shouldAlert(working, st("idle", at(30)), false, 0)).toBe(false);
    expect(shouldAlert(working, st("error", at(10)), false)).toBe(true);
    expect(shouldAlert(st("error", at(0)), st("error", at(10)), false)).toBe(false);
    expect(shouldAlert(working, st("blocked", at(10)), false)).toBe(true);
  });

  it("counts this session's journals before alerting about a run that ended without one", async () => {
    alertIfWaiting(working, info(1, idleAfter70s, "Fix login"));
    await vi.waitFor(() => expect(h.sent).toHaveLength(1));
    expect(h.sent[0]).toEqual({ title: "ai-pm · Fix login", body: t("terminal.notify.noRecord") });

    // A journal written during the session — the run was recorded, so it is not an exception.
    h.entries = [{ created_at: at(40) }];
    alertIfWaiting(working, info(2, idleAfter70s));
    await new Promise((r) => setTimeout(r, 10));
    expect(h.sent).toHaveLength(1);
    // Only an older journal, from before the session started — still nothing since.
    h.entries = [{ created_at: at(-600) }];
    alertIfWaiting(working, info(3, idleAfter70s));
    await vi.waitFor(() => expect(h.sent).toHaveLength(2));
    expect(h.sent[1].title).toBe("ai-pm · claude");
  });
});

describe("bells and program notices", () => {
  it("one per session per 30 seconds, and the same text not again for a while", async () => {
    const s = info(4, st("working", at(0)));
    alertOnSignal(s, { kind: "bell" });
    alertOnSignal(s, { kind: "bell" });
    await vi.waitFor(() => expect(h.sent).toHaveLength(1));
    expect(h.sent[0].body).toBe(t("terminal.notify.bell"));

    // Past the gap: the same bell text is still held back, a different notice goes out.
    vi.setSystemTime(Date.now() + SIGNAL_GAP_MS + 1);
    alertOnSignal(s, { kind: "bell" });
    await new Promise((r) => setTimeout(r, 10));
    expect(h.sent).toHaveLength(1);
    alertOnSignal(s, { kind: "notice", title: "Codex", body: "needs input" });
    await vi.waitFor(() => expect(h.sent).toHaveLength(2));
    expect(h.sent[1]).toEqual({ title: "ai-pm · claude", body: "Codex · needs input" });
    // And the gap starts over.
    alertOnSignal(s, { kind: "notice", title: "Codex", body: "done" });
    await new Promise((r) => setTimeout(r, 10));
    expect(h.sent).toHaveLength(2);
    alertOnSignal(info(5, null), { kind: "notice", title: "Codex", body: "done" });
    await vi.waitFor(() => expect(h.sent).toHaveLength(3));
  });

  it("a bell right after a waiting alert of the same session stays quiet", async () => {
    alertIfWaiting(st("working", at(0)), info(6, st("blocked", at(5), "approve Write: a.ts")));
    alertOnSignal(info(6, null), { kind: "bell" });
    await vi.waitFor(() => expect(h.sent).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 10));
    expect(h.sent).toEqual([{ title: "ai-pm · claude", body: "approve Write: a.ts" }]);
  });

  it("nothing while the window is in front", async () => {
    focused = true;
    alertOnSignal(info(7, null), { kind: "bell" });
    alertIfWaiting(null, info(7, st("error", at(1))));
    await new Promise((r) => setTimeout(r, 10));
    expect(h.sent).toEqual([]);
  });
});

describe("landing on the session after an alert", () => {
  it("a focus within 10 seconds picks the alerted session; a later one does not", async () => {
    alertOnSignal(info(8, null), { kind: "bell" });
    await vi.waitFor(() => expect(h.sent).toHaveLength(1));
    vi.setSystemTime(Date.now() + 5_000);
    window.dispatchEvent(new Event("focus"));
    expect(h.landed).toEqual([8]);

    alertOnSignal(info(9, null), { kind: "bell" });
    await vi.waitFor(() => expect(h.sent).toHaveLength(2));
    vi.setSystemTime(Date.now() + LANDING_MS + 5_000);
    window.dispatchEvent(new Event("focus"));
    expect(h.landed).toEqual([8]);
  });
});
