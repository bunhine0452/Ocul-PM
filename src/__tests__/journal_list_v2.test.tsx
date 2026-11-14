import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

// JN-03 (11-15) — the journal list shows only the exceptions in two lines. A row whose verification
// stands (a command, or the person's read) is one 36px line: title + a fixed mono time column. Only an
// exception (no verification · unfinished · stopped · parse warning) takes a second line with its reason
// chip. Day headers count the day and its unverified rows; search keeps the backend's relevance order
// and its excerpt; one numbers line; typing in the search box does not redraw the rows.

const renders = vi.hoisted(() => ({ rows: 0 }));
vi.mock("@/lib/toast", () => ({ toast: { info: vi.fn(), warning: vi.fn(), destructive: vi.fn() } }));
vi.mock("@/api/oculpm", async () => (await import("./journalHarness")).oculpmModule());
vi.mock("@/api/plan", async () => (await import("./journalHarness")).planModule());
vi.mock("@/lib/bindings", async (importOriginal) =>
  (await import("./journalHarness")).bindingsModule(await importOriginal<typeof import("@/lib/bindings")>()),
);
vi.mock("@/components/Markdown", () => ({ Markdown: ({ children }: { children: string }) => children }));
// 줄이 몇 번 그려지는지 센다 — 원래 줄(memo)을 같은 memo 로 감싼다.
vi.mock("@/features/oculpm/JournalRow", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/features/oculpm/JournalRow")>();
  const React = await import("react");
  const Counted = React.memo((props: React.ComponentProps<typeof mod.JournalRow>) => {
    renders.rows += 1;
    return React.createElement(mod.JournalRow, props);
  });
  return { ...mod, JournalRow: Counted };
});

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

const titles = (c: HTMLElement) => Array.from(c.querySelectorAll(".jl-item .jl-ti")).map((e) => e.textContent);
const rowOf = (c: HTMLElement, title: string) =>
  Array.from(c.querySelectorAll<HTMLElement>(".jl-item")).find((r) => r.querySelector(".jl-ti")?.textContent === title)!;

beforeEach(() => {
  __resetJournalMemory();
  resetJournalFixtures();
  renders.rows = 0;
});
afterEach(() => cleanup());

describe("journal list — exceptions take two lines", () => {
  it("a row with a command is one line; an unverified row is two lines with a warn chip", async () => {
    jfx.byWorkday["20260531"] = [
      entry({ relative_path: "20260531/F/1100_c.md", title: "Has a command", evidence: 2, created_at: "2026-05-31T11:00:00+09:00" }),
      entry({ relative_path: "20260531/F/1000_m.md", title: "No verification", evidence: 0 }),
      entry({ relative_path: "20260531/F/0900_r.md", title: "Read by me", evidence: 0, verified_by_user: true, created_at: "2026-05-31T09:00:00+09:00" }),
      entry({ relative_path: "20260531/F/0800_o.md", title: "Unfinished", evidence: 2, status: "in_progress", created_at: "2026-05-31T08:00:00+09:00" }),
    ];
    const { container, findByText } = renderJournal();
    await findByText("Has a command");
    const command = rowOf(container, "Has a command");
    expect(command.classList.contains("is-one")).toBe(true);
    expect(command.querySelector(".jl-r2")).toBeNull();
    expect(command.querySelector(".jl-when")?.textContent).toBe("11:00");
    expect(rowOf(container, "Read by me").classList.contains("is-one")).toBe(true);
    const missing = rowOf(container, "No verification");
    expect(missing.classList.contains("is-two")).toBe(true);
    expect(missing.querySelector(".chip.warn")?.textContent).toBe(t("journal.evidence.missing"));
    // 미완료는 상태 이름 — 머리카락 선 칩, 그리고 검증은 섰으니 회색 ✓ 가 같이 선다(예외 줄에만).
    const open = rowOf(container, "Unfinished");
    expect(open.querySelector(".chip.sm.hairline")?.textContent).toBe(t("entry.status.open"));
    expect(open.querySelector('[role="img"]')).not.toBeNull();
  });

  it("the day header counts the day and its unverified rows (only the number is warn)", async () => {
    jfx.byWorkday["20260531"] = [
      entry({ relative_path: "20260531/F/1200_a.md", title: "A", evidence: 0, created_at: "2026-05-31T12:00:00+09:00" }),
      entry({ relative_path: "20260531/F/1100_b.md", title: "B", evidence: 0, created_at: "2026-05-31T11:00:00+09:00" }),
      entry({ relative_path: "20260531/F/1000_c.md", title: "C", evidence: 2 }),
    ];
    const { container, findByText } = renderJournal();
    await findByText("A");
    const head = container.querySelector(".jl-dayn")!;
    expect(head.textContent).toBe(`3 · ${t("journal.evidence.missing")} 2`);
    expect(head.querySelector(".jl-warn-n")?.textContent).toBe("2");
  });
});

describe("journal list — search keeps why and order", () => {
  const seed = () => {
    const older = entry({ relative_path: "20260401/F/0900_old.md", workday: "20260401", title: "Older best match", created_at: "2026-04-01T09:00:00+09:00" });
    const newer = entry({ relative_path: "20260531/F/1000_new.md", title: "Newer weaker match" });
    jfx.byWorkday["20260531"] = [newer];
    jfx.allPeriod = [older];
    jfx.hits = [
      { relative_path: older.relative_path, workday: "20260401", snippet: "the watcher raced the scanner", matched_field: "body" },
      { relative_path: newer.relative_path, workday: "20260531", snippet: "a later watcher note", matched_field: "body" },
    ];
  };

  it("relevance (default) is the backend order, with an excerpt whose matched word is bold", async () => {
    seed();
    const { container, getByLabelText, findByText } = renderJournal();
    await findByText("Newer weaker match");
    fireEvent.change(getByLabelText(t("journal.searchAria")), { target: { value: "watcher" } });
    await waitFor(() => expect(titles(container)).toEqual(["Older best match", "Newer weaker match"]), { timeout: 2000 });
    expect(container.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe(t("journal.order.rank"));
    const first = rowOf(container, "Older best match");
    expect(first.querySelector(".jl-excerpt")?.textContent).toBe("the watcher raced the scanner");
    expect(first.querySelector(".jl-excerpt b")?.textContent).toBe("watcher");
    expect(first.querySelector(".jl-when")?.textContent).toBe("4/1");
    // 「최신」 은 날짜 묶음 — 새 일지가 먼저.
    fireEvent.click(container.querySelector(`[role="radio"][aria-checked="false"]`)!);
    await waitFor(() => expect(titles(container)).toEqual(["Newer weaker match", "Older best match"]));
  });

  it("one numbers line — and a nudge to narrow the search at the cap", async () => {
    seed();
    jfx.hitsTotal = 312;
    const { container, getByLabelText, findByText } = renderJournal();
    await findByText("Newer weaker match");
    fireEvent.change(getByLabelText(t("journal.searchAria")), { target: { value: "watcher" } });
    const want = `${t("journal.countShown", { total: 312, shown: 2 })} · ${t("journal.narrowSearch")}`;
    await waitFor(() => expect(container.querySelector(".jl-count")?.textContent).toBe(want), { timeout: 2000 });
    expect(container.querySelectorAll(".jl-count")).toHaveLength(1);
  });

  it("typing five characters in the search box does not redraw the rows", async () => {
    jfx.byWorkday["20260531"] = [
      entry({ relative_path: "20260531/F/1200_a.md", title: "A", created_at: "2026-05-31T12:00:00+09:00" }),
      entry({ relative_path: "20260531/F/1100_b.md", title: "B", created_at: "2026-05-31T11:00:00+09:00" }),
      entry({ relative_path: "20260531/F/1000_c.md", title: "C" }),
    ];
    const { container, getByLabelText, findByText } = renderJournal();
    await findByText("A");
    await waitFor(() => expect(container.querySelector(".jd-prose")).not.toBeNull());
    const before = renders.rows;
    const input = getByLabelText(t("journal.searchAria"));
    for (const value of ["w", "wa", "wat", "watc", "watch"]) fireEvent.change(input, { target: { value } });
    expect((input as HTMLInputElement).value).toBe("watch");
    expect(renders.rows).toBe(before);
    expect(jfx.searches).toEqual([]);
  });
});
