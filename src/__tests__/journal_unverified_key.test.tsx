// 일지: 「검증 없는 것만」 을 키로 — u → v → v … (11-22).
//
// 검증 없는 일지를 차례로 읽는 흐름(j → v → j)은 키보드로 되는데, 그 흐름에 들어가는 문(「검증 없는 것만」 단추)만
// 마우스였다. 하루 300건인 날 검증 없는 일지는 목록 곳곳에 흩어져 있어 거르지 않으면 j 로 수백 줄을 지나야 한다.
// 그리고 다 읽어 목록이 비면 「조건에 맞는 일지가 없어요」 가 아니라 볼 것이 없다는 말이 선다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

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
import { buildShortcutGroups } from "@/lib/shortcutRegistry";
import { entry, jfx, resetJournalFixtures } from "./journalHarness";

function renderJournal() {
  return render(
    <WorkspaceProvider projectId={1}>
      <JournalScreenV2 projectId={1} todayKey="20260531" oculpmReady onOpenDiff={vi.fn()} focusPath={null} onFocusConsumed={vi.fn()} />
    </WorkspaceProvider>,
  );
}

const split = (c: HTMLElement) => c.querySelector(".jl-split")!;
const titles = (c: HTMLElement) => [...c.querySelectorAll(".jl-item .jl-ti")].map((n) => n.textContent);
const selectedTitle = (c: HTMLElement) => c.querySelector('.jl-item[aria-selected="true"] .jl-ti')?.textContent;
const toggle = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>(".jl-only")].find((b) => b.textContent?.startsWith(t("journal.filterNoEvidence")))!;

/** 하루 30건 — 그중 둘만 검증이 없다(11번째 · 23번째). */
function seed() {
  const day = Array.from({ length: 30 }, (_, i) => {
    const mm = String(59 - i).padStart(2, "0");
    const missing = i === 10 || i === 22;
    return entry({
      relative_path: `20260531/F/10${mm}_e${i}.md`,
      title: missing ? `Unverified ${i}` : `Verified ${i}`,
      type: missing ? "bug" : "feature",
      evidence: missing ? 0 : 2,
      created_at: `2026-05-31T10:${mm}:00+09:00`,
    });
  });
  jfx.byWorkday["20260531"] = day;
  jfx.allPeriod = day;
}

beforeEach(() => {
  __resetJournalMemory();
  resetJournalFixtures();
});
afterEach(() => cleanup());

describe("journal — unverified only from the keyboard", () => {
  it("u turns the filter on, v reads each one, and the empty list says nothing needs you — 3 keys for 2 entries", async () => {
    seed();
    const { container } = renderJournal();
    await waitFor(() => expect(titles(container)).toHaveLength(30));
    expect(toggle(container).getAttribute("aria-pressed")).toBe("false");

    // 1 — u: 검증 없는 둘만 서고 첫 줄이 골라진다. (거르지 않으면 첫 검증 없는 일지까지 j 열 번이다.)
    fireEvent.keyDown(split(container), { key: "u" });
    await waitFor(() => expect(titles(container)).toEqual(["Unverified 10", "Unverified 22"]));
    expect(toggle(container).getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(selectedTitle(container)).toBe("Unverified 10"));

    // 2 — v: 읽은 줄이 빠지고 다음 줄이 골라진다.
    fireEvent.keyDown(split(container), { key: "v" });
    await waitFor(() => expect(titles(container)).toEqual(["Unverified 22"]));
    await waitFor(() => expect(selectedTitle(container)).toBe("Unverified 22"));

    // 3 — v: 목록이 비고, 찾다 못 찾은 말이 아니라 볼 것이 없다는 말이 선다.
    fireEvent.keyDown(split(container), { key: "v" });
    await waitFor(() => expect(container.querySelector(".jl-empty")?.textContent).toBe(t("journal.noneMissing")));
    expect(jfx.verified).toEqual([
      { relativePath: "20260531/F/1049_e10.md", verified: true },
      { relativePath: "20260531/F/1037_e22.md", verified: true },
    ]);

    // u 를 다시 누르면 꺼지고 전부가 돌아온다.
    fireEvent.keyDown(split(container), { key: "u" });
    await waitFor(() => expect(titles(container)).toHaveLength(30));
    expect(toggle(container).getAttribute("aria-pressed")).toBe("false");
  });

  it("u typed in the search box is a letter, a held key does not flicker the filter, and ⌘U is not ours", async () => {
    seed();
    const { container } = renderJournal();
    await waitFor(() => expect(titles(container)).toHaveLength(30));
    const input = container.querySelector<HTMLInputElement>(".jl-head input")!;
    fireEvent.keyDown(input, { key: "u" });
    fireEvent.keyDown(split(container), { key: "u", repeat: true });
    fireEvent.keyDown(split(container), { key: "u", metaKey: true });
    fireEvent.keyDown(split(container), { key: "u", ctrlKey: true });
    expect(toggle(container).getAttribute("aria-pressed")).toBe("false");
  });

  it("with a type filter on, an empty list still says no entries match", async () => {
    seed();
    jfx.allPeriod = jfx.allPeriod.filter((e) => e.evidence === 2);
    const { container, getByRole } = renderJournal();
    await waitFor(() => expect(titles(container)).toHaveLength(30));
    fireEvent.keyDown(split(container), { key: "u" });
    await waitFor(() => expect(container.querySelector(".jl-empty")?.textContent).toBe(t("journal.noneMissing")));
    fireEvent.click(getByRole("radio", { name: t("journal.filter.fix") }));
    await waitFor(() => expect(container.querySelector(".jl-empty")?.textContent).toBe(t("journal.noMatch")));
  });

  it("the cheatsheet and the button's tooltip announce the key the screen hears", () => {
    const journal = buildShortcutGroups().find((g) => g.id === "journal")!;
    expect(journal.rows.find((r) => r.labelKey === "keys.entryOnlyMissing")?.keys).toBe("u");
    seed();
    const { container } = renderJournal();
    expect(toggle(container).getAttribute("title")).toBe(`${t("journal.filterNoEvidenceTitle")} (u)`);
  });
});
