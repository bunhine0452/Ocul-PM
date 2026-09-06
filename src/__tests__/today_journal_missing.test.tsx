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

    fireEvent.click(getByText("일지 초안 자동화 켜기 (모델 호출)"));
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

  /**
   * {#card-unhide} — 0건이어도 **숨지 않는다**. 자기은닉은 "정말 깨끗함"과
   * "판정에 가려짐"을 화면에서 똑같이 보이게 만든다 (백엔드는 프로젝트 전역
   * 최신 일지보다 오래된 신호를 해소로 걷고, 훅 없는 에이전트는 신호 자체가
   * 없다). 그렇다고 "0건 ✅" 로 안심시키면 그것도 거짓이라, 0건 상태는
   * 숫자와 함께 판정의 한계를 적는다.
   */
  it("신호가 0건이어도 카드가 뜨고, 0의 한계를 함께 말한다", async () => {
    fx.signals = [];
    const { findByText, queryByText } = render(
      <JournalMissingCard projectId={1} enabled onNavigate={vi.fn()} />,
    );
    await findByText("일지 없이 끝난 세션");
    expect(await findByText(/최근 7일 0건/)).toBeInTheDocument();
    // 판정의 한계가 그 자리에 함께 적혀 있다 — "0건 = 기록 완전" 이 아니라고.
    expect(await findByText(new RegExp(t("today.missing.zeroNote").slice(0, 24)))).toBeInTheDocument();
    // 소음이 되지 않게, 0건 상태에는 행 목록도 설정 유도 버튼도 없다.
    expect(queryByText("일지 초안 자동화 켜기 (모델 호출)")).toBeNull();
  });

  it("0건 → N건으로 바뀌면 같은 카드가 행 목록을 펼친다", async () => {
    fx.signals = [];
    const { findByText, rerender } = render(
      <JournalMissingCard projectId={1} enabled onNavigate={vi.fn()} />,
    );
    await findByText(/최근 7일 0건/);

    fx.signals = [{ ts: "2026-07-30T02:30:00Z", session_id: "abcd1234-5678-uuid" }];
    rerender(<JournalMissingCard projectId={2} enabled onNavigate={vi.fn()} />);
    await findByText(/최근 7일 1건/);
    await waitFor(() => expect(document.body.textContent).toContain("abcd1234…"));
  });
});
