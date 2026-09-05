import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";

// ─── {#retro-standing-line} — 회고의 상시 한 줄 ──────────────────────────────
//
// 회고 화면은 "이번 주에 무슨 일이 있었나"를 말한다. 그 화면이 기록 누락에
// 대해 침묵하면 가려진 주와 깨끗한 주가 똑같이 보인다 — 그래서 이 줄은
// **0건이어도, 기간이 비어 있어도, 조회가 실패해도** 사라지지 않는다.
// 아래 단언 넷이 그 계약이다.
//
// 단언 문자열은 전부 `t()` 로 만든다. 이 파일이 i18n 게이트의 TESTS 예외
// 목록(scripts/check-no-hardcoded-korean.mjs)에 없기 때문이고, 어차피 여기서
// 재는 것은 **숫자와 줄의 존재**이지 카피의 철자가 아니다.

type Dict = Record<string, unknown>;

const fx = {
  /** journal_missing_signals 응답 행 (프런트는 개수만 읽는다). */
  missing: [] as Array<Dict>,
  missingOk: true,
  totalEntries: 3,
};

const signals = (): Dict => ({
  since: "20260714",
  until: "20260720",
  range_key: "20260714..20260720",
  signature: "sig",
  total_entries: fx.totalEntries,
  shipped: [],
  resistance: [],
  repeated_files: [],
  effort_hotspots: [],
  agent_breakdown: [],
  difficulty_mix: { verylow: 0, low: 0, medium: 0, high: 0, superhigh: 0, null_count: 0 },
});

vi.mock("@/components/Markdown", () => ({
  Markdown: ({ children }: { children: string }) => children,
}));

// 회고 화면이 마운트하는 DeferLedgerPanel 이 워크스페이스·설정 컨텍스트를 쓴다
// (notion_export_v2.test.tsx 와 같은 하네스).
vi.mock("@/contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({ state: { currentProjectRoot: "/proj" } }),
  useTerminalSessions: () => ({ terminalTabs: [], terminalActiveId: null }),
}));
vi.mock("@/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: { externalEditorCommand: "code %path" } }),
}));

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  const err = (error: string) => Promise.resolve({ status: "error" as const, error });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          switch (prop) {
            case "retroSignals":
              return () => ok(signals());
            case "getRetro":
              return () => ok(null);
            case "journalMissingSignals":
              return () => (fx.missingOk ? ok(fx.missing) : err("hook ledger unreadable"));
            case "evalSignals":
              return () => ok(null);
            case "ruleCandidates":
              return () => ok([]);
            case "skillCandidates":
              return () => ok([]);
            case "notionStatus":
              return () => ok({ has_token: false, parent_page_id: null });
            default:
              return () => ok(null);
          }
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

import { RetroScreenV2 } from "@/features/retro/RetroScreenV2";
import { t } from "@/i18n";

const sig = (n: number) => ({ ts: `2026-07-2${n}T02:30:00Z`, session_id: `sid-${n}` });
/** 화면 기본 범위는 7일 — 회고의 "이번 주". */
const count = (n: number) => t("retro.missing.count", { days: 7, n });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 6, 20, 12, 0, 0));
  fx.missing = [];
  fx.missingOk = true;
  fx.totalEntries = 3;
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("{#retro-standing-line} weekly missing-session line", () => {
  it("stays on screen at zero, and says what the zero does not cover", async () => {
    const { findByText, queryByText } = render(<RetroScreenV2 projectId={1} />);

    await findByText(t("retro.missing.label"));
    expect(await findByText(count(0))).toBeInTheDocument();
    // 「0건 = 기록 완전」이 아니라는 것을 그 자리에서 말한다.
    expect(await findByText(t("retro.missing.zeroNote"))).toBeInTheDocument();
    // 0건은 조용해야 한다 — 행동 유도를 붙이지 않는다.
    expect(queryByText(t("retro.missing.goToday"))).toBeNull();
  });

  it("counts N signals and offers the jump to the Today card", async () => {
    fx.missing = [sig(0), sig(1), sig(2)];
    const onNavigate = vi.fn();
    const { findByText } = render(<RetroScreenV2 projectId={1} onNavigate={onNavigate} />);

    expect(await findByText(count(3))).toBeInTheDocument();
    expect(await findByText(t("retro.missing.someNote"))).toBeInTheDocument();

    fireEvent.click(await findByText(t("retro.missing.goToday")));
    expect(onNavigate).toHaveBeenCalledWith("today");
  });

  it("survives the empty-period branch", async () => {
    fx.totalEntries = 0;
    fx.missing = [sig(1)];
    const { findByText } = render(<RetroScreenV2 projectId={1} />);

    // 빈 기간 안내가 뜬 화면에서도 살아 있어야 한다 — 오히려 이 조합
    // ("일지 0건 + 무기록 세션 1건")이 가장 말해야 하는 상태다.
    await findByText(t("retro.emptyPeriod"));
    expect(await findByText(count(1))).toBeInTheDocument();
  });

  it("does not pass a failed lookup off as zero", async () => {
    fx.missingOk = false;
    const { findByText } = render(<RetroScreenV2 projectId={1} />);

    await findByText(t("retro.missing.failed"));
    fx.missingOk = true;
    fx.missing = [sig(2), sig(3)];
    fireEvent.click(await findByText(t("common.retry")));
    await waitFor(() => expect(document.body.textContent).toContain(count(2)));
  });
});
