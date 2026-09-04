import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";

// ─── H3b — 일지 없이 끝난 세션 카드 ─────────────────────────────────────────
//
// JournalMissingCard renders the plugin SessionEnd hook's journal-missing
// signals (journal_missing_signals command). Smoke coverage mirrors
// today_v2.test.tsx conventions: mutable fixtures the bindings mock reads,
// events stubbed as no-op listeners. Asserts the self-hiding contract
// (0 signals → nothing) and the populated card (count, truncated sid,
// settings navigation).

const fx: {
  signals: Array<{ ts: string; session_id: string }>;
  /** 봉투 오류 (백엔드가 원장을 못 읽었다). */
  error: string | null;
  /** 봉투가 아닌 **진짜 Error** (전송 계층 실패·창 teardown). */
  throws: boolean;
  calls: number;
} = { signals: [], error: null, throws: false, calls: 0 };

vi.mock("@/lib/bindings", () => ({
  commands: {
    journalMissingSignals: () => {
      fx.calls += 1;
      if (fx.throws) return Promise.reject(new Error("전송 계층 실패"));
      if (fx.error) return Promise.resolve({ status: "error", error: fx.error });
      return Promise.resolve({ status: "ok", data: fx.signals });
    },
  },
  events: new Proxy(
    {},
    { get: () => ({ listen: () => Promise.resolve(() => {}) }) },
  ),
}));

import { JournalMissingCard } from "@/features/today/JournalMissingCard";
import { t } from "@/i18n";

afterEach(() => {
  cleanup();
  fx.signals = [];
  fx.error = null;
  fx.throws = false;
  fx.calls = 0;
});

describe("H3b — 일지 없이 끝난 세션 카드", () => {
  it("renders count, local rows with truncated session ids, and navigates to settings", async () => {
    fx.signals = [
      { ts: "2026-07-30T02:30:00Z", session_id: "abcd1234-5678-uuid" },
      { ts: "2026-07-29T01:00:00Z", session_id: "short" },
    ];
    const onNavigate = vi.fn();
    const { findByText, getByText } = render(
      <JournalMissingCard projectId={1} enabled onNavigate={onNavigate} />,
    );

    expect(await findByText("일지 없이 끝난 세션")).toBeInTheDocument();
    expect(getByText(/최근 7일 2건/)).toBeInTheDocument();
    // UUID gets truncated to its first 8 chars; short ids stay whole.
    expect(getByText("abcd1234…")).toBeInTheDocument();
    expect(getByText("short")).toBeInTheDocument();
    // Guidance mentions the draft opt-in by its config key.
    expect(getByText(/auto_journal_draft/)).toBeInTheDocument();

    fireEvent.click(getByText("설정에서 일지 초안 켜기"));
    expect(onNavigate).toHaveBeenCalledWith("settings");
  });

  /**
   * {#honesty-catch} — 조회 **실패**는 신호 0건과 다르다. 예전에는 봉투 오류도
   * throw 도 `setSignals([])` 로 접어, 훅 원장을 못 읽었는데도 화면은 "일지 없이
   * 끝난 세션 없음"과 똑같이 아무것도 그리지 않았다. 이 카드의 존재 이유가
   * "기록되지 않은 것을 말해 주는 것"이라 그 침묵은 특히 나쁘다.
   */
  it.each([
    ["봉투 오류", () => (fx.error = "hooks 원장을 읽지 못했습니다")],
    ["진짜 Error", () => (fx.throws = true)],
  ])("조회가 실패하면(%s) 숨지 않고 사유와 재시도를 보여 준다", async (_label, arm) => {
    arm();
    const { findByText, getByRole } = render(
      <JournalMissingCard projectId={1} enabled onNavigate={vi.fn()} />,
    );
    await findByText(t("today.missing.failed"));

    fx.error = null;
    fx.throws = false;
    fx.signals = [{ ts: "2026-07-30T02:30:00Z", session_id: "abcd1234-5678-uuid" }];
    fireEvent.click(getByRole("button", { name: t("common.retry") }));
    await findByText("일지 없이 끝난 세션");
    expect(fx.calls).toBe(2);
  });

  it("self-hides when there are no signals", async () => {
    fx.signals = [];
    const { container } = render(
      <JournalMissingCard projectId={1} enabled onNavigate={vi.fn()} />,
    );
    // The fetch resolves to [] → the card must render nothing at all.
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });
});
