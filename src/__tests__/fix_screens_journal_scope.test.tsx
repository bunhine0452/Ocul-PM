// 최종 검수 고침 리뷰 (11-15 fix-screens) — 오늘의 「N건 더」 가 실어 온 날로 좁힌 일지 화면(SCR-05). 날 좁힘은 일지마다
// 본다: 관련도 순 검색은 날 머리 없는 한 묶음이라 묶음의 날로 거르면 맞는 일지가 있어도 0줄이었다. 「오늘만」 은
// 사라지지 않는 전환 단추다: 누르면 사라지던 때 키보드로 누르면 포커스가 body 로 떨어져 j/k/v 가 먹지 않았다. 좁힌
// 동안은 기간 라디오가 서지 않는다: 목록은 하루치인데 「전체 기간」 이 고른 채 서 있었다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/lib/toast", () => ({ toast: { info: vi.fn(), warning: vi.fn(), destructive: vi.fn() } }));
vi.mock("@/api/oculpm", async () => (await import("./journalHarness")).oculpmModule());
vi.mock("@/api/plan", async () => (await import("./journalHarness")).planModule());
vi.mock("@/lib/bindings", async (importOriginal) =>
  (await import("./journalHarness")).bindingsModule(await importOriginal<typeof import("@/lib/bindings")>()),
);
vi.mock("@/components/Markdown", () => ({ Markdown: ({ children }: { children: string }) => children }));

import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { JournalScreenV2, __resetJournalMemory } from "@/features/oculpm/JournalScreenV2";
import { requestOnlyMissing, resetOnlyMissing } from "@/features/oculpm/onlyMissing";
import { t } from "@/i18n";
import { entry, jfx, resetJournalFixtures } from "./journalHarness";

const DAY = "20260531";
const todayRows = [0, 1, 2].map((i) =>
  entry({ relative_path: `${DAY}/B/1${i}00_t${i}.md`, workday: DAY, title: `alpha ${i}`, type: "bug", evidence: 0, created_at: `2026-05-31T1${i}:00:00+09:00` }),
);
const olderRows = [0, 1].map((i) =>
  entry({ relative_path: `20260101/B/090${i}_o${i}.md`, workday: "20260101", title: `alpha old ${i}`, type: "bug", evidence: 0, created_at: "2026-01-01T09:00:00+09:00" }),
);
const paths = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>(".jl-item")].map((r) => r.dataset.path);

/** 오늘의 「N건 더」 가 그날을 실어 보낸 뒤 선 일지 화면. */
async function renderScoped() {
  jfx.byWorkday[DAY] = todayRows;
  jfx.allPeriod = [...todayRows, ...olderRows];
  requestOnlyMissing(DAY);
  const view = render(
    <WorkspaceProvider projectId={1}>
      <JournalScreenV2 projectId={1} todayKey={DAY} oculpmReady onOpenDiff={vi.fn()} focusPath={null} onFocusConsumed={vi.fn()} />
    </WorkspaceProvider>,
  );
  await waitFor(() => expect(paths(view.container)).toHaveLength(3));
  const toggle = screen.getByRole("button", { name: t("journal.dayScope", { day: t("journal.day.today") }) });
  return { ...view, toggle };
}

beforeEach(() => {
  resetJournalFixtures();
  __resetJournalMemory();
  resetOnlyMissing();
});
afterEach(() => cleanup());

describe("SCR-05 — the day scope filters entries, not day groups", () => {
  it("a search in the default relevance order keeps that day's matches and drops the other days'", async () => {
    const { container, toggle } = await renderScoped();
    jfx.hits = [...olderRows, ...todayRows].map((e) => ({ relative_path: e.relative_path, workday: e.workday }));
    fireEvent.change(screen.getByLabelText(t("journal.searchAria")), { target: { value: "alpha" } });
    await waitFor(() => expect(jfx.searches).toContain("alpha"));
    // 관련도 순(기본)은 날 머리 없는 한 묶음 — 그 안에서 그날 것만, 관련도 순서 그대로 남는다.
    await waitFor(() => expect(paths(container)).toEqual(todayRows.map((e) => e.relative_path)));
    expect(screen.getByRole("radio", { name: t("journal.order.rank") })).toHaveAttribute("aria-checked", "true");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector(".jl-only .jl-warn-n")?.textContent).toBe("3");
  });
});

describe("SCR-05 — 'today only' is a toggle that stays put", () => {
  it("pressed from the keyboard it keeps focus inside the screen, so j still moves; pressing again narrows back", async () => {
    const { container, toggle } = await renderScoped();
    const split = container.querySelector(".jl-split") as HTMLElement;
    toggle.focus();
    fireEvent.click(toggle);
    await waitFor(() => expect(paths(container)).toHaveLength(5));
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle.title).toBe(t("journal.dayScopeOffTitle"));
    expect(toggle.isConnected).toBe(true);
    expect(split.contains(document.activeElement)).toBe(true);
    // 키를 듣는 컨테이너 안이라 j 가 그대로 먹는다.
    const before = container.querySelector(".jl-item[aria-selected='true']")?.getAttribute("data-path");
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "j" });
    await waitFor(() =>
      expect(container.querySelector(".jl-item[aria-selected='true']")?.getAttribute("data-path")).not.toBe(before),
    );

    fireEvent.click(toggle);
    await waitFor(() => expect(paths(container)).toHaveLength(3));
    expect(toggle).toHaveAttribute("aria-pressed", "true");
  });

  it("while narrowed to the day the period radio is not drawn; widened, it is back with 'last 14 days' blocked", async () => {
    const { toggle } = await renderScoped();
    expect(screen.queryByRole("radiogroup", { name: t("journal.periodAria") })).toBeNull();
    fireEvent.click(toggle);
    const period = await screen.findByRole("radiogroup", { name: t("journal.periodAria") });
    expect(within(period).getByRole("radio", { name: t("journal.period.all") })).toHaveAttribute("aria-checked", "true");
    expect(within(period).getByRole("radio", { name: t("journal.period.recent") })).toHaveAttribute("aria-disabled", "true");
  });

  it("turning 'unverified only' off drops the carried day too", async () => {
    const { container } = await renderScoped();
    fireEvent.click(container.querySelector(".jl-only") as HTMLElement);
    await waitFor(() => expect(container.querySelectorAll(".jl-only")).toHaveLength(1));
    expect(container.querySelector(".jl-only")).toHaveAttribute("aria-pressed", "false");
  });
});
