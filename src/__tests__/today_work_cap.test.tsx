// 오늘 「오늘 한 일」 — 편 목록도 한 번에 그리는 줄 수에 상한이 있다 (11-22).
//
// 묶음은 접혀 서지만(하루 60건 규칙), 묶음을 펴거나 「시간순」 을 고르면 그날 일지 전부를 한 번에 그렸다 — 하루
// 300건인 날 「시간순」 한 번이 300줄 · DOM 3,009개였다. 이제 `WORK_LIMIT` 줄까지 그리고 「N건 더 보기」 가 그만큼씩
// 더 그린다. 머리의 수는 늘 전부다.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { TodayWork, WORK_LIMIT } from "@/features/today/TodayWork";
import { t } from "@/i18n";
import type { JournalEntrySummary, TodayDigest } from "@/lib/bindings";

afterEach(cleanup);

function entry(i: number, over: Partial<JournalEntrySummary> = {}): JournalEntrySummary {
  const hh = String(Math.floor(i / 60)).padStart(2, "0");
  const mm = String(i % 60).padStart(2, "0");
  return {
    relative_path: `20261122/Features_to_add/${hh}${mm}_feature_e${i}.md`,
    workday: "20261122",
    type: "feature",
    slug: `e${i}`,
    status: "done",
    difficulty: null,
    title: `entry ${i}`,
    checkbox: null,
    session_id: "20261122-001",
    agent_id: "claude-code",
    agent_version: null,
    verified_by_user: false,
    verified_stale: false,
    evidence: 2,
    created_at: `2026-11-22T${hh}:${mm}:00+09:00`,
    updated_at: null,
    tags: [],
    files_count: 2,
    parse_ok: true,
    parse_warnings: [],
    ...over,
  };
}

describe("Done today — 300 entries in a day", () => {
  const all = Array.from({ length: 300 }, (_, i) => entry(i));
  const digest: TodayDigest = {
    plans: [
      { plan_id: "big", title: "big plan" } as TodayDigest["plans"][number],
      { plan_id: "small", title: "small plan" } as TodayDigest["plans"][number],
    ],
    needs_user: [],
    blocked: [],
    journal_plan: [
      ...all.slice(0, 200).map((e) => ({ journal_ref: `journal/${e.relative_path}`, plan_id: "big", plan_title: "big plan", item_id: "x" })),
      ...all.slice(200, 212).map((e) => ({ journal_ref: `journal/${e.relative_path}`, plan_id: "small", plan_title: "small plan", item_id: "y" })),
    ],
  };
  const ents = (el: HTMLElement) => el.querySelectorAll(".tdy-ent");

  it("By time draws up to the limit and Show more adds a page — DOM does not grow with the day", () => {
    const { container } = render(<TodayWork entries={all} digest={digest} onOpenEntry={vi.fn()} />);
    const card = screen.getByRole("region", { name: t("today.work.title") });
    // 접힌 채로는 묶음 머리 셋뿐이다.
    expect(ents(container)).toHaveLength(0);
    fireEvent.click(within(card).getByRole("radio", { name: t("today.work.byTime") }));
    expect(ents(container)).toHaveLength(WORK_LIMIT); // 예전엔 300
    expect(container.querySelectorAll("*").length).toBeLessThan(400); // 예전엔 3,009
    // 머리의 수는 그대로 전부다.
    expect(card.querySelector(".tdy-cnt")?.textContent).toBe("300");
    const more = within(card).getByRole("button", { name: t("journal.rowMore", { n: WORK_LIMIT }) });
    fireEvent.click(more);
    expect(ents(container)).toHaveLength(WORK_LIMIT * 2);
  });

  it("an opened group is capped too — a small group shows whole, with no handle", () => {
    const { container } = render(<TodayWork entries={all} digest={digest} onOpenEntry={vi.fn()} />);
    const card = screen.getByRole("region", { name: t("today.work.title") });
    fireEvent.click(within(card).getByRole("button", { name: /small plan/ }));
    expect(ents(container)).toHaveLength(12);
    expect(card.querySelector(".tdy-more")).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: /big plan/ }));
    expect(ents(container)).toHaveLength(12 + WORK_LIMIT); // 예전엔 212
    // 남은 수가 상한보다 적으면 그 수를 말한다.
    for (let i = 0; i < 5; i++) fireEvent.click(within(card).getByRole("button", { name: t("journal.rowMore", { n: WORK_LIMIT }) }));
    expect(ents(container)).toHaveLength(12 + WORK_LIMIT * 6);
    fireEvent.click(within(card).getByRole("button", { name: t("journal.rowMore", { n: 200 - WORK_LIMIT * 6 }) }));
    expect(ents(container)).toHaveLength(212);
    expect(card.querySelector(".tdy-more")).toBeNull();
  });

  it("closing and reopening a group goes back to the first page", () => {
    const { container } = render(<TodayWork entries={all} digest={digest} onOpenEntry={vi.fn()} />);
    const head = screen.getByRole("button", { name: /big plan/ });
    fireEvent.click(head);
    fireEvent.click(screen.getByRole("button", { name: t("journal.rowMore", { n: WORK_LIMIT }) }));
    expect(ents(container)).toHaveLength(WORK_LIMIT * 2);
    fireEvent.click(head);
    expect(ents(container)).toHaveLength(0);
    fireEvent.click(head);
    expect(ents(container)).toHaveLength(WORK_LIMIT);
  });

  it("moves focus to the first new row — the keyboard is not lost when the handle goes away", () => {
    const few = all.slice(0, WORK_LIMIT + 3);
    const { container } = render(<TodayWork entries={few} digest={{ ...digest, journal_plan: [] }} onOpenEntry={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("today.work.outside")) }));
    const more = screen.getByRole("button", { name: t("journal.rowMore", { n: 3 }) });
    more.focus();
    fireEvent.click(more);
    expect(ents(container)).toHaveLength(WORK_LIMIT + 3);
    expect(document.activeElement).toBe(ents(container)[WORK_LIMIT]);
  });

  it("a row opens its entry — rows drawn later too", () => {
    const onOpen = vi.fn();
    const { container } = render(<TodayWork entries={all} digest={digest} onOpenEntry={onOpen} />);
    fireEvent.click(screen.getByRole("radio", { name: t("today.work.byTime") }));
    fireEvent.click(screen.getByRole("button", { name: t("journal.rowMore", { n: WORK_LIMIT }) }));
    fireEvent.click(ents(container)[WORK_LIMIT + 1]);
    expect(onOpen).toHaveBeenCalledWith(all[WORK_LIMIT + 1]);
  });
});
