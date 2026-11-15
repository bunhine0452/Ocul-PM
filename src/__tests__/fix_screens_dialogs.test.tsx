// 최종 검수 고침 (11-15 fix-screens) — 터미널의 두 창. 나란히 시작의 개수는 앱의 라디오 묶음이고(RC-19, 딸린 패널
// 없는 탭이던 것), 두 창의 발은 대화상자 한 벌의 약속(취소 = 테 없는 단추 + Esc, 키 표기는 `DialogKey`)을 따른다
// (RC-10). 시도 diff 창의 머리 × 는 걷었다 — 발의 「닫기」 하나(terminal_race_strip 이 문다).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/api/race", () => ({
  raceApi: { start: async () => [], lanes: async () => [], patch: async () => "", take: async () => {}, clear: async () => 0 },
}));
vi.mock("@/features/terminal/termStore", () => {
  const none: never[] = [];
  return {
    subscribeTerms: () => () => {},
    termsSnapshot: () => none,
    openTerm: async () => 1,
    closeTerm: () => {},
    hasWorked: () => false,
  };
});
vi.mock("@/api/terminal", () => ({
  terminalApi: { list: async () => [], write: async () => {}, onSessionsChanged: () => Promise.resolve(() => {}) },
}));
vi.mock("@/features/terminal/runPrompt", () => ({ runPromptInTerminal: async () => {} }));

import { RaceStartDialog } from "@/features/terminal/RacePanel";
import { __resetRaceForTests } from "@/features/terminal/race";
import { SendToClaudeHost, __resetSendDraftsForTests } from "@/features/terminal/SendToClaudeHost";
import { requestSendToClaude } from "@/features/terminal/sendToClaude";
import { setLangSetting, t } from "@/i18n";
import { kbd } from "@/lib/kbd";

beforeEach(() => {
  setLangSetting("ko");
  __resetRaceForTests();
  __resetSendDraftsForTests();
});
afterEach(() => cleanup());

describe("RC-19 — 'how many runs' is a radio group, not tabs without panels", () => {
  it("radios 2 · 3 · 4, three picked; arrows move the choice and the start button follows", () => {
    render(<RaceStartDialog projectId={1} onClose={vi.fn()} />);
    const group = screen.getByRole("radiogroup", { name: t("race.count") });
    expect(within(group).getAllByRole("radio").map((r) => r.textContent)).toEqual(["2", "3", "4"]);
    expect(within(group).getByRole("radio", { name: "3" })).toHaveAttribute("aria-checked", "true");
    expect(document.querySelector('[role="tab"], [role="tablist"]')).toBeNull();
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(within(group).getByRole("radio", { name: "4" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: t("race.start", { n: 4 }) })).toBeInTheDocument();
  });
});

describe("RC-10 — the terminal's dialogs keep the dialog set's foot", () => {
  it("parallel start: cancel is a ghost button that says Esc, start says ⌘↩ with the shared key mark", () => {
    render(<RaceStartDialog projectId={1} onClose={vi.fn()} />);
    const cancel = screen.getByRole("button", { name: t("common.cancel") });
    expect(cancel.className).toContain("ghost");
    expect(cancel.querySelector(".dlg-key")?.textContent).toBe("Esc");
    expect(screen.getByRole("button", { name: t("race.start", { n: 3 }) }).querySelector(".dlg-key")?.textContent).toBe(kbd("⌘↩"));
  });

  it("send to Claude: the same foot", async () => {
    render(<SendToClaudeHost projectId={1} />);
    act(() => requestSendToClaude({ kind: "plan", label: "Fix the cache", ref: "cache-plan#ttl" }));
    const cancel = await screen.findByRole("button", { name: t("common.cancel") });
    expect(cancel.className).toContain("ghost");
    expect(cancel.querySelector(".dlg-key")?.textContent).toBe("Esc");
    await waitFor(() => expect(document.querySelectorAll(".send-foot .dlg-key").length).toBeGreaterThanOrEqual(2));
    expect(document.querySelector(".send-foot kbd:not(.dlg-key)")).toBeNull();
  });
});
