// 빈 작업 일지 화면 · 좁은 목록 머리 (11-23 love-round G2).
//
// 처음인 프로젝트에서 작업 일지 탭을 먼저 연 사람에게도 오늘 화면과 같은 첫걸음(터미널에서 첫 작업 맡기기)이 채운
// 단추다 — 같은 프롬프트로. 「커밋에서 일지 만들기」 는 곁의 보통 단추.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const runs = vi.hoisted(() => [] as Array<[number, string]>);
vi.mock("@/features/terminal/runPrompt", () => ({
  runPromptInTerminal: (pid: number, prompt: string) => {
    runs.push([pid, prompt]);
    return Promise.resolve();
  },
}));

import { JournalFirstDay } from "@/features/oculpm/JournalFirstDay";
import { t } from "@/i18n";

afterEach(() => {
  cleanup();
  runs.length = 0;
});

describe("JournalFirstDay", () => {
  it("fills the first-task button, runs Today's step-2 prompt, and keeps backfill as a regular button", async () => {
    const onBackfill = vi.fn();
    const { container, getByText } = render(
      <JournalFirstDay projectId={7} hasOlder={false} onShowAll={() => {}} backfilling={false} onBackfill={onBackfill} />,
    );
    expect(container.textContent).toContain(t("today.first.step3Body"));
    const primaries = [...container.querySelectorAll(".btn.primary")].map((b) => b.textContent);
    expect(primaries).toEqual([t("journal.firstTask")]);
    fireEvent.click(getByText(t("journal.firstTask")));
    await waitFor(() => expect(runs).toEqual([[7, t("today.first.step2Prompt")]]));
    fireEvent.click(getByText(t("journal.backfill.action")));
    expect(onBackfill).toHaveBeenCalledTimes(1);
  });

  it("points at older entries when only the recent window is empty", () => {
    const onShowAll = vi.fn();
    const { container, getByText } = render(
      <JournalFirstDay projectId={7} hasOlder onShowAll={onShowAll} backfilling={false} onBackfill={() => {}} />,
    );
    expect(container.textContent).toContain(t("journal.emptyRecent"));
    expect(container.textContent).not.toContain(t("journal.firstTask"));
    fireEvent.click(getByText(t("journal.loadMore")));
    expect(onShowAll).toHaveBeenCalled();
  });
});

describe("narrow list column", () => {
  const css = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");

  it("the shared list width shrinks with the window and stops at 232", () => {
    expect(css("styles/tokens.css")).toMatch(/--panel-w:\s*clamp\(232px, 30vw, 320px\)/);
  });

  it("the search row wraps the period switch before the search box drops under 140px", () => {
    const journal = css("features/oculpm/journal.css");
    expect(journal).toMatch(/\.jl-head-row:first-child\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(journal).toMatch(/\.jl-search\s*\{[^}]*flex:\s*1 1 140px/);
  });
});
