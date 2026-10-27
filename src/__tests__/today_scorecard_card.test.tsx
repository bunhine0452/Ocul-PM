import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

// ─── best-results-round {#scorecard-card} ───────────────────────────────────
//
// 「약속 성적표」 — PROMISE.md 측정 목표의 「지금」 열. 정의는 백엔드가 성적표
// 스크립트와 같은 계약으로 산다; 이 카드는 비율을 만들고 목표와 색으로 나란히
// 놓을 뿐이다. 0건이어도 카드는 남고, 분모 0 은 숫자 대신 「—」.

type JournalScore = {
  judged_entries: number;
  evidence_entries: number;
  bug_entries: number;
  rework_within_7d: number;
  hub_cut: number;
};
type PlanScore = { active_plans: number; with_done_when: number; with_check: number };
type PromiseScorecard = { window_days: number; journal: JournalScore; plans: PlanScore };

const fixtures: { card: PromiseScorecard | null; asked: Array<[number, number | null]> } = {
  card: null,
  asked: [],
};

vi.mock("@/api/oculpm", () => ({
  OculpmApiError: class extends Error {},
  oculpmApi: {
    promiseScorecard: (projectId: number, days: number | null) => {
      fixtures.asked.push([projectId, days]);
      return Promise.resolve(fixtures.card);
    },
  },
}));

import { PromiseScorecardCard } from "@/features/today/PromiseScorecardCard";
import { t } from "@/i18n";

const TITLE = t("today.scorecard.title");

beforeEach(() => {
  fixtures.card = null;
  fixtures.asked = [];
});
afterEach(cleanup);

describe("PromiseScorecardCard", () => {
  it("shows percentages against the PROMISE targets and asks for 30 days", async () => {
    fixtures.card = {
      window_days: 30,
      journal: { judged_entries: 40, evidence_entries: 34, bug_entries: 10, rework_within_7d: 2, hub_cut: 5 },
      plans: { active_plans: 4, with_done_when: 4, with_check: 1 },
    };
    render(<PromiseScorecardCard projectId={7} enabled />);
    await waitFor(() => expect(screen.getByText(TITLE)).toBeTruthy());
    expect(fixtures.asked).toEqual([[7, 30]]);
    // 34/40 = 85% (목표 97% 미달), 2/10 = 20% (목표 30% 이하 충족), 플랜 4 · 1 / 4.
    expect(screen.getByText("85%")).toBeTruthy();
    expect(screen.getByText("20%")).toBeTruthy();
    expect(screen.getByText("4 · 1 / 4")).toBeTruthy();
    expect(screen.getByText(t("today.scorecard.target", { target: "≥ 97%" }))).toBeTruthy();
    expect(screen.getByText(t("today.scorecard.foot", { judged: 40, bugs: 10, hub: 5 }))).toBeTruthy();
  });

  it("stays visible with the empty copy when there is nothing to measure", async () => {
    fixtures.card = {
      window_days: 30,
      journal: { judged_entries: 0, evidence_entries: 0, bug_entries: 0, rework_within_7d: 0, hub_cut: 3 },
      plans: { active_plans: 0, with_done_when: 0, with_check: 0 },
    };
    render(<PromiseScorecardCard projectId={1} enabled />);
    await waitFor(() => expect(screen.getByText(TITLE)).toBeTruthy());
    expect(screen.getByText(t("today.scorecard.empty"))).toBeTruthy();
    expect(screen.queryByText("0%")).toBeNull();
  });

  it("renders a dash for a zero denominator instead of NaN", async () => {
    fixtures.card = {
      window_days: 30,
      journal: { judged_entries: 3, evidence_entries: 3, bug_entries: 0, rework_within_7d: 0, hub_cut: 3 },
      plans: { active_plans: 1, with_done_when: 0, with_check: 0 },
    };
    render(<PromiseScorecardCard projectId={1} enabled />);
    await waitFor(() => expect(screen.getByText("100%")).toBeTruthy());
    expect(screen.getByText(t("today.scorecard.na"))).toBeTruthy();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it("renders nothing when disabled", () => {
    const { container } = render(<PromiseScorecardCard projectId={1} enabled={false} />);
    expect(container.innerHTML).toBe("");
    expect(fixtures.asked).toEqual([]);
  });
});
