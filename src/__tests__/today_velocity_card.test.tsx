import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

// ─── journal-scale-round {#velocity-card} ───────────────────────────────────
//
// 주당 일지 건수·유형 비율 + 플랜 완료 ETA. HotspotCard({#hotspot-card})와
// 같은 규율 — 0건이어도 카드는 남고, ETA 를 못 구하는 상태(최근 4주 완료
// 0건)는 숫자 대신 전용 문구로 갈린다.

type TypeCounts = {
  feature: number;
  bug: number;
  error: number;
  refactor: number;
  chore: number;
};
type WeekBucket = {
  iso_week: string;
  from_workday: string;
  to_workday: string;
  total: number;
  by_type: TypeCounts;
  by_agent: { agent_id: string; count: number }[];
};
type PlanVelocity = {
  open_items: number;
  done_last_4w: number;
  weekly_done_avg: number | null;
  eta_weeks: number | null;
  note: string | null;
};
type Velocity = { weeks: WeekBucket[]; plan: PlanVelocity };

const zeroTypes: TypeCounts = { feature: 0, bug: 0, error: 0, refactor: 0, chore: 0 };

function week(over: Partial<WeekBucket> = {}): WeekBucket {
  return {
    iso_week: "2026-W37",
    from_workday: "20260907",
    to_workday: "20260913",
    total: 0,
    by_type: zeroTypes,
    by_agent: [],
    ...over,
  };
}

const fixtures: {
  velocity: Velocity | null;
  /** 컴포넌트가 실제로 물은 (projectId, weeks). */
  asked: Array<[number, number | null]>;
} = { velocity: null, asked: [] };

vi.mock("@/api/oculpm", () => ({
  OculpmApiError: class extends Error {},
  oculpmApi: {
    velocity: (projectId: number, weeks: number | null) => {
      fixtures.asked.push([projectId, weeks]);
      return Promise.resolve(fixtures.velocity);
    },
  },
}));

import { VelocityCard } from "@/features/today/VelocityCard";
import { t } from "@/i18n";

const TITLE = t("today.velocity.title");

beforeEach(() => {
  fixtures.velocity = null;
  fixtures.asked = [];
});
afterEach(cleanup);

describe("VelocityCard", () => {
  /**
   * {#velocity-card-unhide} — 8주 모두 0건이어도 카드는 남는다: 빈 상태
   * 문구를 보여주고(desc 는 안 뜨고), ETA 가 없으니 전용 문구로 갈린다.
   */
  it("renders and does not hide when every week is empty, with no-eta copy", async () => {
    fixtures.velocity = {
      weeks: Array.from({ length: 8 }, (_, i) => week({ iso_week: `2026-W3${i}` })),
      plan: {
        open_items: 0,
        done_last_4w: 0,
        weekly_done_avg: 0,
        eta_weeks: null,
        // note 는 컴포넌트가 렌더하지 않는 백엔드 신호값이라 내용은 임의 — UI 문자열이 아니다.
        note: "no plan history",
      },
    };

    render(<VelocityCard projectId={1} enabled />);

    await waitFor(() => expect(fixtures.asked).toEqual([[1, 8]]));
    expect(await screen.findByText(TITLE)).toBeTruthy();
    expect(screen.getByText(t("today.velocity.zeroNote", { n: 8 }))).toBeTruthy();
    expect(screen.queryByText(t("today.velocity.desc"))).toBeNull();
    expect(screen.getByText(t("today.velocity.summaryNoEta"))).toBeTruthy();
  });

  /** 데이터가 있으면 유형 범례·주간 열을 그리고, ETA 문장은 값을 채워 보여준다. */
  it("renders week columns and the ETA sentence when data exists", async () => {
    fixtures.velocity = {
      weeks: [
        week({ iso_week: "2026-W36", from_workday: "20260831", total: 3 }),
        week({
          iso_week: "2026-W37",
          from_workday: "20260907",
          total: 5,
          by_type: { feature: 2, bug: 1, error: 0, refactor: 1, chore: 1 },
        }),
      ],
      plan: {
        open_items: 12,
        done_last_4w: 6,
        weekly_done_avg: 1.5,
        eta_weeks: 8,
        note: null,
      },
    };

    render(<VelocityCard projectId={1} enabled />);

    await screen.findByText(TITLE);
    expect(screen.getByText(t("today.velocity.desc"))).toBeTruthy();
    expect(screen.getByText(t("trigger.feature"))).toBeTruthy();
    expect(
      screen.getByText(t("today.velocity.summary", { open: 12, avg: "1.5", eta: 8 })),
    ).toBeTruthy();
  });
});
