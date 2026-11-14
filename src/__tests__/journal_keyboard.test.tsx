import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";

// JN-04 (11-15) — the journal keyboard flow: j → v → j. One screen order (`visibleOrder`) drives drawing,
// moving and auto-selection, so j never zig-zags in and out of the "code that is gone" fold; a fold the
// person opened stays open; a row that drops out of the list hands the selection to the row that takes
// its place; ↓ in the search box lands on the first result; one row is in the tab order; the screen
// remembers its entry while the app runs.

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

const AXE = { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } } as const;
const summarize = (r: AxeResults) => r.violations.map((v: Result) => ({ id: v.id, help: v.help, nodes: v.nodes.length }));

function renderJournal() {
  return render(
    <WorkspaceProvider projectId={1}>
      <JournalScreenV2 projectId={1} todayKey="20260531" oculpmReady onOpenDiff={vi.fn()} focusPath={null} onFocusConsumed={vi.fn()} />
    </WorkspaceProvider>,
  );
}

const selectedTitle = (c: HTMLElement) => c.querySelector('.jl-item[aria-selected="true"] .jl-ti')?.textContent;
const split = (c: HTMLElement) => c.querySelector(".jl-split")!;

beforeEach(() => {
  __resetJournalMemory();
  resetJournalFixtures();
});
afterEach(() => cleanup());

describe("journal keyboard — one screen order", () => {
  const seed = () => {
    jfx.byWorkday["20260531"] = [
      entry({ relative_path: "20260531/F/1200_a.md", title: "Alpha", created_at: "2026-05-31T12:00:00+09:00" }),
      entry({ relative_path: "20260531/F/1100_b.md", title: "Bravo gone", created_at: "2026-05-31T11:00:00+09:00" }),
      entry({ relative_path: "20260531/F/1000_c.md", title: "Charlie", created_at: "2026-05-31T10:00:00+09:00" }),
    ];
    jfx.gone = ["20260531/F/1100_b.md"];
  };

  it("j walks the rows in the order they are drawn — a closed fold is skipped, an opened one is walked last", async () => {
    seed();
    const { container, findByRole } = renderJournal();
    const fold = await findByRole("button", { name: `${t("journal.goneFoldLabel")} 1` });
    await waitFor(() => expect(selectedTitle(container)).toBe("Alpha"));
    fireEvent.keyDown(split(container), { key: "j" });
    await waitFor(() => expect(selectedTitle(container)).toBe("Charlie"));
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(fold);
    fireEvent.keyDown(split(container), { key: "j" });
    await waitFor(() => expect(selectedTitle(container)).toBe("Bravo gone"));
  });

  it("a fold the person opened stays open after the selection leaves it", async () => {
    seed();
    const { container, findByRole } = renderJournal();
    const fold = await findByRole("button", { name: `${t("journal.goneFoldLabel")} 1` });
    fireEvent.click(fold);
    fireEvent.keyDown(split(container), { key: "End" });
    await waitFor(() => expect(selectedTitle(container)).toBe("Bravo gone"));
    fireEvent.keyDown(split(container), { key: "k" });
    await waitFor(() => expect(selectedTitle(container)).toBe("Charlie"));
    expect(fold.getAttribute("aria-expanded")).toBe("true");
  });

  it("ArrowDown / ArrowUp move like j / k while the list has focus, and only the selected row is tabbable", async () => {
    seed();
    const { container } = renderJournal();
    await waitFor(() => expect(selectedTitle(container)).toBe("Alpha"));
    fireEvent.keyDown(container.querySelector(".jl-item")!, { key: "ArrowDown" });
    await waitFor(() => expect(selectedTitle(container)).toBe("Charlie"));
    expect(container.querySelectorAll('[role="option"][tabindex="0"]')).toHaveLength(1);
    expect(container.querySelector('[role="option"][tabindex="0"] .jl-ti')?.textContent).toBe("Charlie");
  });
});

describe("journal keyboard — v keeps the place", () => {
  it("with 'unverified only' on, v on the second row hands the selection to the new second row", async () => {
    const rows = [
      entry({ relative_path: "20260531/F/1300_m1.md", title: "Missing one", evidence: 0, created_at: "2026-05-31T13:00:00+09:00" }),
      entry({ relative_path: "20260531/F/1200_m2.md", title: "Missing two", evidence: 0, created_at: "2026-05-31T12:00:00+09:00" }),
      entry({ relative_path: "20260531/F/1100_m3.md", title: "Missing three", evidence: 0, created_at: "2026-05-31T11:00:00+09:00" }),
      entry({ relative_path: "20260531/F/1000_ok.md", title: "Has a command", evidence: 2, created_at: "2026-05-31T10:00:00+09:00" }),
    ];
    jfx.byWorkday["20260531"] = rows;
    jfx.allPeriod = rows;
    const { container, getByRole } = renderJournal();
    await waitFor(() => expect(selectedTitle(container)).toBe("Missing one"));
    fireEvent.click(getByRole("button", { name: t("journal.filterNoEvidence") }));
    await waitFor(() => expect(container.querySelectorAll(".jl-item")).toHaveLength(3));
    fireEvent.keyDown(split(container), { key: "j" });
    await waitFor(() => expect(selectedTitle(container)).toBe("Missing two"));
    fireEvent.keyDown(split(container), { key: "v" });
    await waitFor(() => expect(jfx.verified).toEqual([{ relativePath: "20260531/F/1200_m2.md", verified: true }]));
    await waitFor(() => expect(container.querySelectorAll(".jl-item")).toHaveLength(2));
    expect(selectedTitle(container)).toBe("Missing three");
  });

  it("j → v → j: the focused row drops out, focus moves to the row in its place, and the next j still lands", async () => {
    const rows = ["one", "two", "three", "four"].map((n, i) =>
      entry({ relative_path: `20260531/F/130${i}_${n}.md`, title: `Missing ${n}`, evidence: 0, created_at: `2026-05-31T1${3 - i}:00:00+09:00` }),
    );
    jfx.byWorkday["20260531"] = rows;
    jfx.allPeriod = rows;
    const { container, getByRole } = renderJournal();
    fireEvent.click(getByRole("button", { name: t("journal.filterNoEvidence") }));
    await waitFor(() => expect(container.querySelectorAll(".jl-item")).toHaveLength(4));
    await waitFor(() => expect(selectedTitle(container)).toBe("Missing one"));
    fireEvent.keyDown(split(container), { key: "j" });
    await waitFor(() => expect((document.activeElement as HTMLElement).dataset.path).toBe(rows[1].relative_path));
    // 실제처럼 포커스를 쥔 줄에서 v — 그 줄이 목록에서 빠지면 포커스가 body 로 떨어지던 자리.
    fireEvent.keyDown(document.activeElement!, { key: "v" });
    await waitFor(() => expect(container.querySelectorAll(".jl-item")).toHaveLength(3));
    await waitFor(() => expect((document.activeElement as HTMLElement).dataset.path).toBe(rows[2].relative_path));
    expect(selectedTitle(container)).toBe("Missing three");
    fireEvent.keyDown(document.activeElement!, { key: "j" });
    await waitFor(() => expect(selectedTitle(container)).toBe("Missing four"));
  });

  it("v writes nothing on an entry that has no read button (a chore without evidence)", async () => {
    jfx.byWorkday["20260531"] = [entry({ relative_path: "20260531/C/1000_c.md", title: "Chore", type: "chore", evidence: 0 })];
    const { container } = renderJournal();
    await waitFor(() => expect(container.querySelector(".jd-title")?.textContent).toBe("Chore"));
    expect(container.querySelector(".jd-read")).toBeNull();
    fireEvent.keyDown(split(container), { key: "v" });
    await act(async () => {});
    expect(jfx.verified).toEqual([]);
  });
});

describe("journal keyboard — search box and memory", () => {
  it("ArrowDown in the search box lands on the first result", async () => {
    const a = entry({ relative_path: "20260531/F/1000_a.md", title: "Watcher race" });
    const b = entry({ relative_path: "20260531/F/1100_b.md", title: "Other", created_at: "2026-05-31T11:00:00+09:00" });
    jfx.byWorkday["20260531"] = [b, a];
    jfx.hits = [{ relative_path: a.relative_path, workday: "20260531", snippet: "watcher" }];
    const { container, getByLabelText } = renderJournal();
    await waitFor(() => expect(selectedTitle(container)).toBe("Other"));
    const input = getByLabelText(t("journal.searchAria")) as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "watcher" } });
    await waitFor(() => expect(container.querySelectorAll(".jl-item")).toHaveLength(1), { timeout: 2000 });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    await waitFor(() => expect(selectedTitle(container)).toBe("Watcher race"));
    await waitFor(() => expect((document.activeElement as HTMLElement).classList.contains("jl-item")).toBe(true));
  });

  it("the cheatsheet names the journal keys for what they move", () => {
    const journal = buildShortcutGroups().find((g) => g.id === "journal")!;
    const move = journal.rows.find((r) => r.keys.startsWith("j / k"))!;
    expect(t(move.labelKey)).toContain(t("nav.journal").split(" ").pop()!);
    expect(journal.rows.some((r) => r.keys === "v" && r.labelKey === "keys.entryRead")).toBe(true);
    expect(journal.rows.some((r) => r.keys.startsWith("/") && r.labelKey === "keys.entryFilter")).toBe(true);
  });

  it("leaving the screen and coming back keeps the same entry selected", async () => {
    jfx.byWorkday["20260531"] = [
      entry({ relative_path: "20260531/F/1200_a.md", title: "First", created_at: "2026-05-31T12:00:00+09:00" }),
      entry({ relative_path: "20260531/F/1100_b.md", title: "Second", created_at: "2026-05-31T11:00:00+09:00" }),
    ];
    const first = renderJournal();
    await waitFor(() => expect(selectedTitle(first.container)).toBe("First"));
    fireEvent.keyDown(split(first.container), { key: "j" });
    await waitFor(() => expect(selectedTitle(first.container)).toBe("Second"));
    first.unmount();
    const again = renderJournal();
    await waitFor(() => expect(again.container.querySelector(".jd-title")?.textContent).toBe("Second"));
    expect(selectedTitle(again.container)).toBe("Second");
  });

  it("the list and detail have no axe violations", async () => {
    jfx.byWorkday["20260531"] = [
      entry({ relative_path: "20260531/F/1200_a.md", title: "Alpha", evidence: 0 }),
      entry({ relative_path: "20260531/F/1100_b.md", title: "Bravo", status: "in_progress", created_at: "2026-05-31T11:00:00+09:00" }),
    ];
    const { container } = renderJournal();
    await waitFor(() => expect(container.querySelector(".jd-prose")).not.toBeNull());
    await act(async () => {});
    expect(summarize(await axe(container, AXE))).toEqual([]);
  });
});
