import { describe, expect, it } from "vitest";
import {
  bucketOf,
  facetOf,
  facetsOf,
  groupPlans,
  latestActivityByPlan,
  parseTouched,
  relDay,
  searchPlans,
  sortPlans,
  STALE_DAYS,
  type PlanFacet,
} from "@/features/planner/planList";
import type { PlanSummary } from "@/lib/bindings";

const NOW = Date.parse("2026-07-30T12:00:00+09:00");
const DAY = 86_400_000;

/** ISO string for N days before NOW. */
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();

function plan(over: Partial<PlanSummary> & { plan_id: string }): PlanSummary {
  return {
    plan_id: over.plan_id,
    title: over.title ?? over.plan_id,
    status: over.status ?? "active",
    owner_agent: over.owner_agent ?? "claude-code",
    progress: over.progress ?? 0,
    file_path: over.file_path ?? `.oculpm/planner/${over.plan_id}.md`,
    updated_at: over.updated_at ?? daysAgo(1),
    item_count: over.item_count ?? 10,
    done_count: over.done_count ?? 0,
  };
}

describe("bucketOf", () => {
  it("접는다: active / done / 그 외는 전부 보관", () => {
    expect(bucketOf(plan({ plan_id: "a", status: "active" }))).toBe("active");
    expect(bucketOf(plan({ plan_id: "b", status: "done" }))).toBe("done");
    expect(bucketOf(plan({ plan_id: "c", status: "archived" }))).toBe("archived");
    expect(bucketOf(plan({ plan_id: "d", status: "무엇이든" }))).toBe("archived");
  });
});

describe("parseTouched", () => {
  it("빈 문자열·null·깨진 값은 전부 null 이다", () => {
    // 백엔드가 `unwrap_or_default()` 로 "" 를 줄 수 있다.
    expect(parseTouched("")).toBeNull();
    expect(parseTouched(null)).toBeNull();
    expect(parseTouched(undefined)).toBeNull();
    expect(parseTouched("아무것도 아님")).toBeNull();
  });

  it("날짜만 있는 값도 파싱한다", () => {
    expect(parseTouched("2026-06-07")).toBe(Date.parse("2026-06-07"));
  });
});

describe("facetOf — 멈춤 판정의 정직성", () => {
  it("plan-log 활동 기록이 있고 오래됐을 때만 멈춤으로 표시한다", () => {
    const f = facetOf(plan({ plan_id: "p" }), NOW, daysAgo(21));
    expect(f.touchedSource).toBe("activity");
    expect(f.staleDays).toBe(21);
  });

  it("활동 기록이 없으면 updated_at 이 아무리 오래돼도 멈춤이 아니다 (모름)", () => {
    // updated_at 은 항목 편집으로 갱신되지 않아 생성일에 고정돼 있을 수 있다.
    // 그 값으로 '멈춤' 을 주장하면 거짓 경고가 된다.
    const f = facetOf(plan({ plan_id: "p", updated_at: daysAgo(400) }), NOW);
    expect(f.touchedSource).toBe("frontmatter");
    expect(f.staleDays).toBeNull();
    expect(f.touchedAt).toBe(Date.parse(daysAgo(400)));
  });

  it("임계값 바로 아래는 멈춤이 아니다", () => {
    expect(facetOf(plan({ plan_id: "p" }), NOW, daysAgo(STALE_DAYS - 1)).staleDays).toBeNull();
    expect(facetOf(plan({ plan_id: "p" }), NOW, daysAgo(STALE_DAYS)).staleDays).toBe(STALE_DAYS);
  });

  it("완료·잠금된 계획과 100% 계획은 멈춤으로 표시하지 않는다", () => {
    const locked = facetOf(plan({ plan_id: "p", status: "done" }), NOW, daysAgo(90));
    expect(locked.staleDays).toBeNull();

    const complete = facetOf(
      plan({ plan_id: "q", progress: 1, done_count: 10 }),
      NOW,
      daysAgo(90),
    );
    expect(complete.staleDays).toBeNull();
  });

  it("남은 항목 수는 음수가 되지 않는다", () => {
    const f = facetOf(plan({ plan_id: "p", item_count: 3, done_count: 5 }), NOW);
    expect(f.remaining).toBe(0);
  });

  it("progress 가 null 이어도 0% 로 다룬다", () => {
    expect(facetOf(plan({ plan_id: "p", progress: null }), NOW).pct).toBe(0);
  });
});

describe("searchPlans", () => {
  const plans = [
    plan({ plan_id: "v2-release", title: "v2 릴리스" }),
    plan({ plan_id: "menubar-tray", title: "메뉴바 트레이" }),
    plan({ plan_id: "claude-integration", title: "Claude 직접 연동" }),
  ];

  it("한글 부분일치로 계획을 찾는다", () => {
    expect(searchPlans(plans, "메뉴바").map((p) => p.plan_id)).toEqual(["menubar-tray"]);
  });

  it("plan_id 로도 찾고 대소문자를 가리지 않는다", () => {
    expect(searchPlans(plans, "CLAUDE").map((p) => p.plan_id)).toEqual(["claude-integration"]);
  });

  it("빈 질의는 전부 원래 순서로 돌려준다", () => {
    expect(searchPlans(plans, "   ").map((p) => p.plan_id)).toEqual(plans.map((p) => p.plan_id));
  });

  it("입력 배열을 변형하지 않는다", () => {
    const before = [...plans];
    searchPlans(plans, "v2");
    expect(plans).toEqual(before);
  });
});

describe("sortPlans", () => {
  const a = plan({ plan_id: "a", title: "가", progress: 0.5, item_count: 10, done_count: 5 });
  const b = plan({ plan_id: "b", title: "나", progress: 0.1, item_count: 10, done_count: 1 });
  const c = plan({ plan_id: "c", title: "다", progress: 0.9, item_count: 10, done_count: 9 });
  const plans = [a, b, c];

  const facets = (over: Record<string, string> = {}) => facetsOf(plans, NOW, over);

  it("최근순은 활동이 최신인 계획을 먼저 놓는다", () => {
    const f = facets({ a: daysAgo(5), b: daysAgo(1), c: daysAgo(10) });
    expect(sortPlans(plans, "recent", f).map((p) => p.plan_id)).toEqual(["b", "a", "c"]);
  });

  it("시각을 모르는 계획은 최근순에서 항상 맨 뒤로 간다", () => {
    const unknown = plan({ plan_id: "z", updated_at: "" });
    const all = [unknown, ...plans];
    const f = facetsOf(all, NOW, { a: daysAgo(5), b: daysAgo(1), c: daysAgo(10) });
    expect(sortPlans(all, "recent", f).map((p) => p.plan_id)).toEqual(["b", "a", "c", "z"]);
  });

  it("진척순·남은일순·이름순", () => {
    const f = facets();
    expect(sortPlans(plans, "progress", f).map((p) => p.plan_id)).toEqual(["c", "a", "b"]);
    expect(sortPlans(plans, "remaining", f).map((p) => p.plan_id)).toEqual(["b", "a", "c"]);
    expect(sortPlans(plans, "title", f).map((p) => p.plan_id)).toEqual(["a", "b", "c"]);
  });

  it("같은 값이면 plan_id 순으로 결정적으로 정렬한다", () => {
    const tie = [
      plan({ plan_id: "z", progress: 0.5 }),
      plan({ plan_id: "m", progress: 0.5 }),
      plan({ plan_id: "a", progress: 0.5 }),
    ];
    const f = facetsOf(tie, NOW);
    expect(sortPlans(tie, "progress", f).map((p) => p.plan_id)).toEqual(["a", "m", "z"]);
  });

  it("입력 배열을 변형하지 않는다", () => {
    const before = plans.map((p) => p.plan_id);
    sortPlans(plans, "progress", facets());
    expect(plans.map((p) => p.plan_id)).toEqual(before);
  });
});

describe("groupPlans", () => {
  const plans = [
    plan({ plan_id: "act", status: "active" }),
    plan({ plan_id: "fin", status: "done" }),
    plan({ plan_id: "arc", status: "archived" }),
  ];
  const f = facetsOf(plans, NOW);

  it("상태별로 묶고 완료·보관은 기본으로 접어 둔다", () => {
    const secs = groupPlans(plans, "status", f, NOW);
    expect(secs.map((s) => s.key)).toEqual(["active", "done", "archived"]);
    expect(secs.map((s) => s.defaultOpen)).toEqual([true, false, false]);
    expect(secs[0].label).toBe("진행 중");
  });

  it("빈 섹션은 만들지 않는다", () => {
    const onlyActive = [plan({ plan_id: "a" })];
    const secs = groupPlans(onlyActive, "status", facetsOf(onlyActive, NOW), NOW);
    expect(secs.map((s) => s.key)).toEqual(["active"]);
  });

  it("최근활동별은 '멈춤' 버킷을 두지 않고, 시각 미상은 '기록 없음' 으로 분리한다", () => {
    const set = [
      plan({ plan_id: "t", updated_at: daysAgo(0) }),
      plan({ plan_id: "w", updated_at: daysAgo(3) }),
      plan({ plan_id: "o", updated_at: daysAgo(60) }),
      plan({ plan_id: "u", updated_at: "" }),
    ];
    const secs = groupPlans(set, "recency", facetsOf(set, NOW), NOW);
    expect(secs.map((s) => s.key)).toEqual(["today", "week", "older", "unknown"]);
    expect(secs.some((s) => s.label.includes("멈춤"))).toBe(false);
    expect(secs[secs.length - 1].label).toBe("기록 없음");
  });

  it("작성자별로 묶는다", () => {
    const set = [
      plan({ plan_id: "a", owner_agent: "claude-code" }),
      plan({ plan_id: "b", owner_agent: "cursor" }),
      plan({ plan_id: "c", owner_agent: "claude-code" }),
    ];
    const secs = groupPlans(set, "agent", facetsOf(set, NOW), NOW);
    expect(secs.map((s) => s.key)).toEqual(["agent:claude-code", "agent:cursor"]);
    expect(secs[0].plans.map((p) => p.plan_id)).toEqual(["a", "c"]);
  });

  it("'묶지 않음' 은 단일 섹션, 계획이 없으면 섹션도 없다", () => {
    expect(groupPlans(plans, "none", f, NOW)).toHaveLength(1);
    expect(groupPlans([], "none", new Map<string, PlanFacet>(), NOW)).toEqual([]);
    expect(groupPlans([], "status", new Map<string, PlanFacet>(), NOW)).toEqual([]);
  });
});

describe("relDay", () => {
  it("시각을 모르면 아무 주장도 하지 않는다", () => {
    expect(relDay(null, NOW)).toBe("");
  });

  it("오늘 / 어제 / N일 전", () => {
    expect(relDay(NOW - 60_000, NOW)).toBe("오늘");
    expect(relDay(NOW - DAY, NOW)).toBe("어제");
    expect(relDay(NOW - 5 * DAY, NOW)).toBe("5일 전");
    expect(relDay(NOW - 90 * DAY, NOW)).toBe("3개월 전");
  });
});

describe("latestActivityByPlan", () => {
  it("계획별로 가장 최근 시각만 남긴다", () => {
    const rows = [
      { plan_id: "a", ts: "2026-07-01T00:00:00+09:00" },
      { plan_id: "a", ts: "2026-07-20T00:00:00+09:00" },
      { plan_id: "b", ts: "2026-07-10T00:00:00+09:00" },
    ];
    expect(latestActivityByPlan(rows)).toEqual({
      a: "2026-07-20T00:00:00+09:00",
      b: "2026-07-10T00:00:00+09:00",
    });
  });

  it("배열이 아닌 응답에도 터지지 않는다", () => {
    // 테스트 목이나 구버전 백엔드가 null 을 돌려줄 수 있다.
    expect(latestActivityByPlan(null)).toEqual({});
    expect(latestActivityByPlan(undefined)).toEqual({});
    expect(latestActivityByPlan([{ plan_id: 1, ts: null } as never])).toEqual({});
  });
});
