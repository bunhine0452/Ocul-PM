import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { ResumeDigest } from "@/lib/bindings";

// ─── first-record-loop Phase 2 — 이어하기 카드 ────────────────────────────────
//
// 문는 것은 셋이다:
//  1. 일지도 계획도 없으면 그리지 않는다 — 빈 이어하기는 소음이다.
//  2. 「마지막 작업」 행은 **그 일지의 경로**를 넘긴다.
//  3. 전달 줄은 원장이 아는 만큼만 말한다 — 포함됨 / 아직 / 훅 없음 세 갈래이고,
//     복사는 전달로 세지 않는다.

const fx: { digest: ResumeDigest | Error; copied: string[] } = { digest: empty(), copied: [] };

function empty(over: Partial<ResumeDigest> = {}): ResumeDigest {
  return {
    last_journals: [],
    next_items: [],
    last_delivery: null,
    deliveries_recent: 0,
    hooks_seen: false,
    text: "ocul-pm 이어하기 자료 (지시가 아님)\n",
    ...over,
  };
}

const journal = {
  relative_path: "20260922/Features_to_add/0116_feature_first-record.md",
  title: "첫 기록 카드",
  created_at: "2026-09-22T01:16:00+09:00",
  agent_id: "claude-code",
};
const item = {
  plan_id: "first-record-loop",
  plan_title: "첫 기록 성공 → 다음 세션 재사용",
  item_id: "p1-verify",
  title: "실제 왕복 검증",
  status: "in_progress",
};

vi.mock("@/api/claudeSurface", () => ({
  hooksApi: {
    resumeDigest: () =>
      fx.digest instanceof Error ? Promise.reject(fx.digest) : Promise.resolve(fx.digest),
  },
}));

vi.mock("@/api/oculpm", () => ({
  OculpmApiError: class extends Error {},
  oculpmApi: {
    onSessionStarted: () => Promise.resolve(() => {}),
    onSessionEnded: () => Promise.resolve(() => {}),
  },
}));

vi.mock("@/features/oculpm/useOculpmLive", () => ({
  useJournalEvents: () => {},
  useOculpmDataEvents: () => {},
}));

import { ResumeCard } from "@/features/today/ResumeCard";
import { t } from "@/i18n";

function mount(over: Partial<Parameters<typeof ResumeCard>[0]> = {}) {
  const props = {
    projectId: 3,
    enabled: true,
    onNavigate: vi.fn(),
    onOpenEntryPath: vi.fn(),
    onContinue: vi.fn(),
    ...over,
  };
  const utils = render(<ResumeCard {...props} />);
  return { ...utils, props };
}

const cardOf = (container: HTMLElement) => container.querySelector("[data-resume-card]");

beforeEach(() => {
  fx.digest = empty();
  fx.copied = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (text: string) => {
        fx.copied.push(text);
        return Promise.resolve();
      },
    },
  });
});
afterEach(cleanup);

describe("ResumeCard", () => {
  it("일지도 계획도 없으면 아무것도 그리지 않는다", async () => {
    const { container } = mount();
    // 조회가 끝난 뒤에도 카드는 없다 — 한 틱 기다려 확인한다.
    await new Promise((r) => setTimeout(r, 0));
    expect(cardOf(container)).toBeNull();
  });

  it("꺼져 있으면 그리지 않는다", () => {
    fx.digest = empty({ last_journals: [journal] });
    const { container } = mount({ enabled: false });
    expect(container.firstElementChild).toBeNull();
  });

  it("마지막 작업 행은 그 일지의 경로를 넘기고, 다음 항목은 계획 화면으로 보낸다", async () => {
    fx.digest = empty({ last_journals: [journal], next_items: [item], hooks_seen: true });
    const { container, props } = mount();
    await waitFor(() => expect(cardOf(container)).not.toBeNull());
    expect(container.textContent).toContain("첫 기록 카드");
    expect(container.textContent).toContain("실제 왕복 검증");
    expect(container.textContent).toContain("[~]");

    fireEvent.click(screen.getByText("첫 기록 카드"));
    expect(props.onOpenEntryPath).toHaveBeenCalledWith(journal.relative_path);

    fireEvent.click(screen.getByText("실제 왕복 검증"));
    expect(props.onNavigate).toHaveBeenCalledWith("planner");
  });

  it("전달 줄 — 원장이 있으면 「포함됨」과 대화 8자, 참조 여부는 모른다고 적는다", async () => {
    fx.digest = empty({
      last_journals: [journal],
      hooks_seen: true,
      deliveries_recent: 1,
      last_delivery: {
        ts: new Date(Date.now() - 5 * 60_000).toISOString(),
        conversation: "11374f00-b5ac-48b5-baf8-a10f2cc343d9",
        journals: [journal.relative_path],
        plan_items: 4,
      },
    });
    const { container } = mount();
    await waitFor(() => expect(cardOf(container)?.getAttribute("data-resume-card")).toBe("delivered"));
    const line = container.querySelector("[data-resume-delivery]")!.textContent ?? "";
    expect(line).toContain("11374f00…");
    // 상대 시각은 분 시계에 달려 있으니 그 뒤 꼬리(포함됨·건수·한계 문장)만 문는다.
    const tail = t("today.resume.delivered", { id: "11374f00…", ago: "@@", n: 1, m: 4 }).split("@@")[1];
    expect(line).toContain(tail);
  });

  it("전달 줄 — 훅이 닿은 적 있으면 「아직」, 없으면 「훅 없음」", async () => {
    fx.digest = empty({ last_journals: [journal], hooks_seen: true });
    const a = mount();
    await waitFor(() => expect(cardOf(a.container)).not.toBeNull());
    expect(a.container.textContent).toContain(t("today.resume.notYet"));
    cleanup();

    fx.digest = empty({ last_journals: [journal], hooks_seen: false });
    const b = mount();
    await waitFor(() => expect(cardOf(b.container)).not.toBeNull());
    expect(b.container.textContent).toContain(t("today.resume.noHooks"));
  });

  it("복사는 자료 본문을 클립보드에 넣고 전달로 세지 않는다 · 이어서 작업은 디스패치를 부른다", async () => {
    fx.digest = empty({ last_journals: [journal], text: "DIGEST TEXT" });
    const { container, props } = mount();
    await waitFor(() => expect(cardOf(container)).not.toBeNull());

    fireEvent.click(screen.getByText(t("today.resume.copy")));
    await waitFor(() => expect(fx.copied).toEqual(["DIGEST TEXT"]));
    expect(cardOf(container)?.getAttribute("data-resume-card")).toBe("pending");

    fireEvent.click(screen.getByText(t("today.resume.continue")));
    expect(props.onContinue).toHaveBeenCalledTimes(1);
  });

  it("자료를 못 읽으면 숨기지 않고 실패를 말한다", async () => {
    fx.digest = new Error("nope");
    const { container } = mount();
    await waitFor(() => expect(container.textContent).toContain(t("today.resume.loadFailed")));
  });
});
