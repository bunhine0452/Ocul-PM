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

const fx: { signals: Array<{ ts: string; session_id: string }> } = {
  signals: [],
};

vi.mock("@/lib/bindings", () => ({
  commands: {
    journalMissingSignals: () =>
      Promise.resolve({ status: "ok", data: fx.signals }),
  },
  events: new Proxy(
    {},
    { get: () => ({ listen: () => Promise.resolve(() => {}) }) },
  ),
}));

import { JournalMissingCard } from "@/features/today/JournalMissingCard";

afterEach(() => {
  cleanup();
  fx.signals = [];
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

  it("self-hides when there are no signals", async () => {
    fx.signals = [];
    const { container } = render(
      <JournalMissingCard projectId={1} enabled onNavigate={vi.fn()} />,
    );
    // The fetch resolves to [] → the card must render nothing at all.
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });
});
