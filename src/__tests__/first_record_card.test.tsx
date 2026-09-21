import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { ConversationTrace, FirstRecordLedger } from "@/lib/bindings";

// ─── first-record-loop {#p1-card} — 첫 기록 카드 ─────────────────────────────
//
// 문구가 아니라 **사실과 행동**을 문는다 (firstrun_honesty 와 같은 태도):
//  1. 원장이 말하는 상태마다 카드가 다른 자리(data-first-record)에 선다.
//  2. 성공 상태의 「일지 열기」는 **그 대화의 첫 일지 경로**를 넘긴다 — 최신
//     일지나 아무 일지가 아니다.
//  3. 원장을 못 읽으면 준비 상태로 접지 않고 실패를 말한다.
//  4. 준비 상태의 탐침은 실패를 「확인 못 함」으로 남긴다 — 「없음」으로 추측하지 않는다.

const fx: {
  ledger: FirstRecordLedger | Error;
  cli: { available: boolean } | null;
  plugin: { installed: boolean; path: string | null } | null;
  calls: number;
} = { ledger: emptyLedger(), cli: null, plugin: null, calls: 0 };

function emptyLedger(over: Partial<FirstRecordLedger> = {}): FirstRecordLedger {
  return { conversations: [], unattributed_recent: 0, hooks_seen: false, window_days: 30, ...over };
}

function trace(over: Partial<ConversationTrace> = {}): ConversationTrace {
  return {
    conversation: "11374f00-b5ac-48b5-baf8-a10f2cc343d9",
    segment_open: true,
    live: true,
    started_at: "2026-09-22T00:35:00Z",
    last_activity_at: "2026-09-22T00:40:00Z",
    first_journal: null,
    journal_count: 0,
    missing_signal: false,
    ...over,
  };
}

vi.mock("@/api/claudeSurface", () => ({
  hooksApi: {
    firstRecordLedger: () => {
      fx.calls += 1;
      return fx.ledger instanceof Error ? Promise.reject(fx.ledger) : Promise.resolve(fx.ledger);
    },
  },
  claudeInstallApi: {
    cli: () => Promise.resolve(fx.cli),
    pluginStatus: () => Promise.resolve(fx.plugin),
  },
}));

vi.mock("@/api/oculpm", () => ({
  OculpmApiError: class extends Error {},
  oculpmApi: {
    onA2aChanged: () => Promise.resolve(() => {}),
    onSessionStarted: () => Promise.resolve(() => {}),
    onSessionEnded: () => Promise.resolve(() => {}),
  },
}));

vi.mock("@/features/oculpm/useOculpmLive", () => ({
  useJournalEvents: () => {},
}));

import { FirstRecordCard } from "@/features/today/FirstRecordCard";
import { t } from "@/i18n";

function mount(over: Partial<Parameters<typeof FirstRecordCard>[0]> = {}) {
  const props = {
    projectId: 7,
    enabled: true,
    onNavigate: vi.fn(),
    onOpenEntryPath: vi.fn(),
    onRunAgent: vi.fn(),
    onDone: vi.fn(),
    ...over,
  };
  const utils = render(<FirstRecordCard {...props} />);
  return { ...utils, props };
}

const stateOf = (container: HTMLElement) =>
  container.querySelector("[data-first-record]")?.getAttribute("data-first-record") ?? null;

beforeEach(() => {
  fx.ledger = emptyLedger();
  fx.cli = null;
  fx.plugin = null;
  fx.calls = 0;
});
afterEach(cleanup);

describe("FirstRecordCard — 상태별 자리", () => {
  it("꺼져 있으면 아무것도 그리지 않고 원장도 읽지 않는다", () => {
    const { container } = mount({ enabled: false });
    expect(container.firstElementChild).toBeNull();
    expect(fx.calls).toBe(0);
  });

  it("준비 상태 — 탐침 실패는 「확인 못 함」이지 「못 찾음」이 아니고, 실행 버튼이 있다", async () => {
    fx.ledger = emptyLedger({ hooks_seen: false });
    const { container, props } = mount();
    await waitFor(() => expect(stateOf(container)).toBe("ready"));
    await waitFor(() =>
      expect(container.textContent).toContain(t("today.firstRecord.probe.unknown")),
    );
    expect(container.textContent).not.toContain(t("today.firstRecord.probe.no"));
    expect(container.textContent).toContain(t("today.firstRecord.probe.hooksNotYet"));

    fireEvent.click(screen.getByText(t("today.firstRecord.run")));
    expect(props.onRunAgent).toHaveBeenCalledTimes(1);
  });

  it("준비 상태 — 탐침이 답하면 있음/못 찾음을 갈라 적고, 훅 관측은 따로 말한다", async () => {
    fx.ledger = emptyLedger({ hooks_seen: true });
    fx.cli = { available: true };
    fx.plugin = { installed: false, path: null };
    const { container } = mount();
    await waitFor(() => expect(stateOf(container)).toBe("ready"));
    await waitFor(() => expect(container.textContent).toContain(t("today.firstRecord.probe.no")));
    expect(container.textContent).toContain(t("today.firstRecord.probe.yes"));
    expect(container.textContent).toContain(t("today.firstRecord.probe.hooksSeen"));
  });

  it("실행 중 — 대화 id 를 8자로 보여 주고 성공이라 말하지 않는다", async () => {
    fx.ledger = emptyLedger({ conversations: [trace()] });
    const { container } = mount();
    await waitFor(() => expect(stateOf(container)).toBe("running"));
    expect(container.textContent).toContain("11374f00…");
    expect(container.textContent).not.toContain(t("today.firstRecord.recorded.title"));
  });

  it("기록 확인 — 열기는 그 대화의 첫 일지 경로를 넘기고, 확인은 카드를 내린다", async () => {
    fx.ledger = emptyLedger({
      conversations: [
        trace({
          conversation: "aaaaaaaa-1111",
          live: false,
          segment_open: false,
          journal_count: 2,
          first_journal: {
            relative_path: "20260922/Bugs/0100_bug_first.md",
            title: "첫 번째 일지",
            created_at: "2026-09-22T01:00:00+09:00",
            agent_id: "claude-code",
          },
        }),
      ],
    });
    const { container, props } = mount();
    await waitFor(() => expect(stateOf(container)).toBe("recorded"));
    expect(container.textContent).toContain("첫 번째 일지");
    // 기록 ≠ 검증 — 성공 문장에 그 구분이 실려 있다.
    expect(container.textContent).toContain(t("today.firstRecord.recorded.body", { id: "aaaaaaaa…" }));

    fireEvent.click(screen.getByText(t("today.firstRecord.recorded.open")));
    expect(props.onOpenEntryPath).toHaveBeenCalledWith("20260922/Bugs/0100_bug_first.md");

    fireEvent.click(screen.getByText(t("today.firstRecord.recorded.review")));
    expect(props.onNavigate).toHaveBeenCalledWith("diff");

    fireEvent.click(screen.getByText(t("today.firstRecord.recorded.ack")));
    expect(props.onDone).toHaveBeenCalledTimes(1);
  });

  it("기록 없이 종료 — 다시 실행이 터미널을 연다", async () => {
    fx.ledger = emptyLedger({
      conversations: [trace({ live: false, segment_open: false, missing_signal: true })],
    });
    const { container, props } = mount();
    await waitFor(() => expect(stateOf(container)).toBe("missing"));
    fireEvent.click(screen.getByText(t("today.firstRecord.missing.retry")));
    expect(props.onRunAgent).toHaveBeenCalledTimes(1);
  });

  it("귀속 불명 — 건수를 말하고 일지 화면으로 보내되 성공으로 세지 않는다", async () => {
    fx.ledger = emptyLedger({ unattributed_recent: 4 });
    const { container, props } = mount();
    await waitFor(() => expect(stateOf(container)).toBe("unattributed"));
    expect(container.textContent).toContain(t("today.firstRecord.unattributed.body", { n: 4 }));
    fireEvent.click(screen.getByText(t("today.firstRecord.unattributed.open")));
    expect(props.onNavigate).toHaveBeenCalledWith("journal");
  });

  it("원장을 못 읽으면 준비 상태로 접지 않고 실패를 말한다", async () => {
    fx.ledger = new Error("boom");
    const { container } = mount();
    await waitFor(() => expect(container.textContent).toContain(t("today.firstRecord.loadFailed")));
    expect(stateOf(container)).toBeNull();
  });

  it("닫기는 어느 상태에서나 카드를 내린다", async () => {
    fx.ledger = emptyLedger({ conversations: [trace()] });
    const { container, props } = mount();
    await waitFor(() => expect(stateOf(container)).toBe("running"));
    fireEvent.click(screen.getByLabelText(t("common.dismiss")));
    expect(props.onDone).toHaveBeenCalledTimes(1);
  });
});
