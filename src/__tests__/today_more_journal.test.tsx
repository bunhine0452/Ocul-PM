// 오늘의 「N건 더」 는 일지 화면의 「검증 없는 것만」 으로 (11-15 합류 G-11). 그 거르기는 일지 화면의 지역 상태라
// 오늘이 켤 길이 없어 남은 줄을 제자리에서 펼쳤다(오늘이 둘째 일지 목록이 됐다). 이제 요청을 실어 보내고
// (`onlyMissing.ts`), 셸이 일지 화면을 세우면 그 화면이 회수해 거르기를 켠다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/lib/bindings", async (orig) => (await import("./screenMux")).muxBindings(await orig<typeof import("@/lib/bindings")>()));
vi.mock("@/api/oculpm", async (orig) => (await import("./screenMux")).muxOculpm(await orig<typeof import("@/api/oculpm")>()));
vi.mock("@/api/plan", async (orig) => (await import("./screenMux")).muxPlan(await orig<typeof import("@/api/plan")>()));
vi.mock("@/features/terminal/runPrompt", () => ({ runPromptInTerminal: async () => {} }));
vi.mock("@/components/Markdown", () => ({ Markdown: ({ children }: { children: string }) => children }));

import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { JournalScreenV2, __resetJournalMemory } from "@/features/oculpm/JournalScreenV2";
import { resetOnlyMissing } from "@/features/oculpm/onlyMissing";
import { __resetTodayStoreForTests } from "@/features/today/useTodayExceptions";
import { t } from "@/i18n";
import { entry as journalEntry, jfx, resetJournalFixtures } from "./journalHarness";
import { mux } from "./screenMux";
import { entry as todayEntry, fx, resetFx } from "./todayFixture";
import { renderToday } from "./todayRender";

const ROWS = [
  journalEntry({ relative_path: "20260531/B/1300_m1.md", title: "Missing one", type: "bug", evidence: 0, created_at: "2026-05-31T13:00:00+09:00" }),
  journalEntry({ relative_path: "20260531/B/1200_m2.md", title: "Missing two", type: "bug", evidence: 0, created_at: "2026-05-31T12:00:00+09:00" }),
  journalEntry({ relative_path: "20260531/F/1100_ok.md", title: "Has a command", evidence: 2, created_at: "2026-05-31T11:00:00+09:00" }),
];

/** 셸이 하는 일 — 일지 화면을 새로 세운다(화면은 한 번에 하나). */
function standJournal() {
  mux.screen = "journal";
  jfx.byWorkday["20260531"] = ROWS;
  jfx.allPeriod = ROWS;
  return render(
    <WorkspaceProvider projectId={1}>
      <JournalScreenV2 projectId={1} todayKey="20260531" oculpmReady onOpenDiff={vi.fn()} focusPath={null} onFocusConsumed={vi.fn()} />
    </WorkspaceProvider>,
  );
}
const titles = (c: HTMLElement) => [...c.querySelectorAll(".jl-item .jl-ti")].map((e) => e.textContent);

beforeEach(() => {
  resetFx();
  resetJournalFixtures();
  __resetJournalMemory();
  resetOnlyMissing();
});
afterEach(() => {
  cleanup();
  __resetTodayStoreForTests();
});

describe("today's 'N more' → the journal's 'unverified only'", () => {
  it("pressing it moves to the journal, and the journal stands with the filter on", async () => {
    mux.screen = "today";
    fx.entries = Array.from({ length: 7 }, (_, i) => todayEntry(i + 1, { type: "bug", evidence: 0 }));
    const { onNavigate } = renderToday();
    const unread = await screen.findByRole("region", { name: t("today.unread.title") });
    await waitFor(() => expect(within(unread).getAllByRole("listitem")).toHaveLength(5));
    fireEvent.click(within(unread).getByRole("button", { name: t("today.unread.more", { n: 2 }) }));
    expect(onNavigate).toHaveBeenCalledWith("journal");
    cleanup();

    const { container } = standJournal();
    await waitFor(() => expect(container.querySelector(".jl-only")).toHaveAttribute("aria-pressed", "true"));
    await waitFor(() => expect(titles(container)).toEqual(["Missing one", "Missing two"]));
  });

  it("opened any other way, the journal starts on everything — the filter stays the screen's own state", async () => {
    const { container } = standJournal();
    await waitFor(() => expect(titles(container)).toEqual(["Missing one", "Missing two", "Has a command"]));
    expect(container.querySelector(".jl-only")).toHaveAttribute("aria-pressed", "false");
  });
});
