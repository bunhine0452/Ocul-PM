// 계획 기록: 펼쳐도 한 번에 50줄까지만 (11-22).
//
// 끝까지 맡긴 긴 실행은 항목마다 잡음 · 판정 · 닫음을 적어 계획 기록이 수백 줄이 된다. 접힌 한 줄(「계획 기록
// N줄」)을 펼치는 한 번이 그 전부를 그렸다. 최신부터 `LOG_LIMIT` 줄, 나머지는 「N줄 더 보기」 가 그만큼씩.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("@/api/plan", () => ({ planApi: { log: () => Promise.resolve(h.rows) } }));

import { LOG_LIMIT, PlanLog } from "@/features/planner/PlanLog";
import { t } from "@/i18n";

function row(i: number) {
  const mm = String(i % 60).padStart(2, "0");
  const hh = String(Math.floor(i / 60)).padStart(2, "0");
  return {
    ts: `2026-11-22T${hh}:${mm}:00+09:00`,
    item_id: `item-${i % 40}`,
    agent_id: "claude-code",
    from_status: "todo",
    to_status: "done",
    note: `note ${i}`,
    journal_ref: null,
  };
}

const logRows = (el: HTMLElement) => el.querySelectorAll(".plv-log-row");
const renderLog = () => render(<PlanLog projectId={1} planId="p" revision="r1" decisions={[]} items={[]} />);

beforeEach(() => {
  h.rows = Array.from({ length: 400 }, (_, i) => row(i));
});
afterEach(cleanup);

describe("plan log — 400 rows from a long run", () => {
  it("opens to the newest 50 and the handle adds 50 at a time — the head still counts all 400", async () => {
    const { container } = renderLog();
    const head = await screen.findByRole("button", { name: t("plan.log.rows", { n: 400 }) });
    expect(logRows(container)).toHaveLength(0);
    fireEvent.click(head);
    expect(logRows(container)).toHaveLength(LOG_LIMIT); // 예전엔 400
    // 최신이 위 — 가장 늦게 적힌 줄부터.
    expect(logRows(container)[0].textContent).toContain("note 399");
    expect(logRows(container)[LOG_LIMIT - 1].textContent).toContain(`note ${400 - LOG_LIMIT}`);
    fireEvent.click(screen.getByRole("button", { name: t("plan.log.more", { n: LOG_LIMIT }) }));
    expect(logRows(container)).toHaveLength(LOG_LIMIT * 2);
    expect(screen.getByRole("button", { name: t("plan.log.rows", { n: 400 }) })).toBe(head);
  });

  it("a short log shows whole, with no handle", async () => {
    h.rows = Array.from({ length: 12 }, (_, i) => row(i));
    const { container } = renderLog();
    fireEvent.click(await screen.findByRole("button", { name: t("plan.log.rows", { n: 12 }) }));
    await waitFor(() => expect(logRows(container)).toHaveLength(12));
    expect(container.querySelector(".plv-log-more")).toBeNull();
  });

  it("the last page says how many are left, then the handle goes away", async () => {
    h.rows = Array.from({ length: LOG_LIMIT + 7 }, (_, i) => row(i));
    const { container } = renderLog();
    fireEvent.click(await screen.findByRole("button", { name: t("plan.log.rows", { n: LOG_LIMIT + 7 }) }));
    fireEvent.click(screen.getByRole("button", { name: t("plan.log.more", { n: 7 }) }));
    expect(logRows(container)).toHaveLength(LOG_LIMIT + 7);
    expect(container.querySelector(".plv-log-more")).toBeNull();
  });
});
