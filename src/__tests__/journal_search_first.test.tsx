import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

// JN-04 (11-15) — ↓ / Enter in the search box lands on the first result *of the words in the box*. When the
// words were edited and Enter came before the debounce, the first commit after it still held the previous
// search's results with `loading` false (the hook set it in an effect), so the screen picked the old first
// row — and kept it when the new results contained that entry too. The hook now derives `loading` from
// which query its result belongs to, and the screen waits for a result of that query.

vi.mock("@/lib/toast", () => ({ toast: { info: vi.fn(), warning: vi.fn(), destructive: vi.fn() } }));
vi.mock("@/api/oculpm", async () => (await import("./journalHarness")).oculpmModule());
vi.mock("@/api/plan", async () => (await import("./journalHarness")).planModule());
vi.mock("@/lib/bindings", async (importOriginal) =>
  (await import("./journalHarness")).bindingsModule(await importOriginal<typeof import("@/lib/bindings")>()),
);
vi.mock("@/components/Markdown", () => ({ Markdown: ({ children }: { children: string }) => children }));

import { JournalScreenV2, __resetJournalMemory } from "@/features/oculpm/JournalScreenV2";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { t } from "@/i18n";
import { entry, jfx, resetJournalFixtures } from "./journalHarness";

function renderJournal() {
  return render(
    <WorkspaceProvider projectId={1}>
      <JournalScreenV2 projectId={1} todayKey="20260531" oculpmReady onOpenDiff={vi.fn()} focusPath={null} onFocusConsumed={vi.fn()} />
    </WorkspaceProvider>,
  );
}

const selectedTitle = (c: HTMLElement) => c.querySelector('.jl-item[aria-selected="true"] .jl-ti')?.textContent;
const titles = (c: HTMLElement) => Array.from(c.querySelectorAll(".jl-item .jl-ti")).map((e) => e.textContent);
const hit = (e: ReturnType<typeof entry>) => ({ relative_path: e.relative_path, workday: e.workday, snippet: e.title });

beforeEach(() => {
  __resetJournalMemory();
  resetJournalFixtures();
});
afterEach(() => cleanup());

describe("journal search — the first result belongs to the words in the box", () => {
  const one = entry({ relative_path: "20260531/F/1000_one.md", title: "Watcher one", created_at: "2026-05-31T10:00:00+09:00" });
  const race = entry({ relative_path: "20260531/F/1100_race.md", title: "Watcher race", created_at: "2026-05-31T11:00:00+09:00" });
  const other = entry({ relative_path: "20260531/F/1200_other.md", title: "Other", created_at: "2026-05-31T12:00:00+09:00" });

  it("edited words + Enter before the debounce picks the new search's first row, not the old one's", async () => {
    jfx.byWorkday["20260531"] = [other, race, one];
    jfx.hits = [hit(one), hit(race)];
    const { container, getByLabelText } = renderJournal();
    await waitFor(() => expect(selectedTitle(container)).toBe("Other"));
    const input = getByLabelText(t("journal.searchAria")) as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "watcher" } });
    await waitFor(() => expect(titles(container)).toEqual(["Watcher one", "Watcher race"]), { timeout: 2000 });

    // 백엔드는 고친 검색어에 다른 순서를 준다 — 그 첫 줄이 「Watcher race」 다.
    jfx.hits = [hit(race), hit(one)];
    fireEvent.change(input, { target: { value: "watcher race" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(jfx.searches).toContain("watcher race"));
    await waitFor(() => expect(titles(container)).toEqual(["Watcher race", "Watcher one"]));
    await waitFor(() => expect(selectedTitle(container)).toBe("Watcher race"));
    await waitFor(() => expect((document.activeElement as HTMLElement).dataset.path).toBe(race.relative_path));
  });

  it("clearing the box and pressing ↓ at once lands on the first row of the list that comes back", async () => {
    jfx.byWorkday["20260531"] = [other, race, one];
    jfx.hits = [hit(race)];
    const { container, getByLabelText } = renderJournal();
    await waitFor(() => expect(selectedTitle(container)).toBe("Other"));
    const input = getByLabelText(t("journal.searchAria")) as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "race" } });
    await waitFor(() => expect(titles(container)).toEqual(["Watcher race"]), { timeout: 2000 });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    await waitFor(() => expect(selectedTitle(container)).toBe("Watcher race"));

    input.focus();
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    await waitFor(() => expect(titles(container)).toEqual(["Other", "Watcher race", "Watcher one"]));
    await waitFor(() => expect(selectedTitle(container)).toBe("Other"));
    await waitFor(() => expect((document.activeElement as HTMLElement).dataset.path).toBe(other.relative_path));
  });
});
