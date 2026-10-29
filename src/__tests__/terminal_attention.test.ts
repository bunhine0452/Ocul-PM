// 「Claude 가 기다려요」 OS 알림 (ocul-next #waiting-alert · #orca-attention) — 기다림으로 막
// 들어섰고 그 창이 앞에 없을 때만, 권한은 처음 한 번.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TermInfo, TermStatus } from "@/api/terminal";

const os = vi.hoisted(() => ({
  granted: false,
  asked: 0,
  sent: [] as Array<{ title: string; body?: string }>,
}));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: async () => os.granted,
  requestPermission: async () => {
    os.asked += 1;
    return "granted";
  },
  sendNotification: (n: { title: string; body?: string }) => void os.sent.push(n),
}));

import { alertIfWaiting, newQuestions, newWaitings, setAlertProjectName, shouldAlert } from "@/features/terminal/attention";
import { t } from "@/i18n";

const st = (state: string, kind: string | null = null, msg: string | null = null): TermStatus => ({
  state,
  kind,
  msg,
  since: "2026-10-29T10:00:00Z",
});

function info(status: TermStatus | null): TermInfo {
  return {
    id: 1,
    project_id: 1,
    label: "claude",
    started_at: "2026-10-29T10:00:00Z",
    alive: true,
    exit_code: null,
    status,
    busy: true,
    unseen: false,
  };
}

let focused = false;
beforeEach(() => {
  focused = false;
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  os.granted = false;
  os.asked = 0;
  os.sent.length = 0;
  setAlertProjectName("ai-pm");
});
afterEach(() => vi.restoreAllMocks());

describe("알림감", () => {
  it("기다림으로 들어설 때만 — 이어지는 기다림 · 다른 상태 · 앞에 있는 창은 아니다", () => {
    expect(shouldAlert(st("working"), st("blocked", "permission"), false)).toBe(true);
    expect(shouldAlert(null, st("blocked", "question"), false)).toBe(true);
    expect(shouldAlert(st("blocked", "question"), st("blocked", "question", "다른 줄"), false)).toBe(false);
    expect(shouldAlert(st("working"), st("done"), false)).toBe(false);
    expect(shouldAlert(st("working"), st("blocked"), true)).toBe(false);
  });

  it("창이 뒤에 있으면 프로젝트 이름과 그 한 줄로 울리고, 권한은 처음 한 번만 묻는다", async () => {
    alertIfWaiting(st("working"), info(st("blocked", "permission", "approve Write: a.ts")));
    await vi.waitFor(() => expect(os.sent).toHaveLength(1));
    expect(os.sent[0]).toEqual({
      title: t("terminal.notify.titleIn", { project: "ai-pm" }),
      body: "claude · approve Write: a.ts",
    });
    alertIfWaiting(st("idle"), info(st("blocked", "question")));
    await vi.waitFor(() => expect(os.sent).toHaveLength(2));
    expect(os.sent[1].body).toBe(`claude · ${t("terminal.state.question")}`);
    expect(os.asked).toBe(1);
  });

  it("창이 앞에 있으면 울리지 않는다 — 화면 표시로 충분하다", async () => {
    focused = true;
    alertIfWaiting(st("working"), info(st("blocked", "permission")));
    await new Promise((r) => setTimeout(r, 10));
    expect(os.sent).toHaveLength(0);
  });
});

describe("바깥 터미널 기다림 알림 (#notify-hook)", () => {
  it("처음 보는 기다림만 — 같은 세션 · 같은 시작 시각은 한 번", () => {
    const seen = new Set<string>();
    const a = { session_id: "s1", kind: "permission", message: null, since: "2026-10-29T14:00:00Z" };
    expect(newWaitings(seen, [a])).toEqual([a]);
    expect(newWaitings(seen, [a])).toEqual([]);
    const again = { ...a, since: "2026-10-29T14:10:00Z" };
    expect(newWaitings(seen, [again])).toEqual([again]);
  });
});

describe("질문 알림 (#ask-user)", () => {
  it("처음 보는 질문만 — 같은 id 는 한 번", () => {
    const seen = new Set<string>();
    const q = { id: "q1", question: "배포할까요?", options: [], asked_at: "2026-10-29T14:00:00Z" };
    expect(newQuestions(seen, [q])).toEqual([q]);
    expect(newQuestions(seen, [q])).toEqual([]);
  });
});
