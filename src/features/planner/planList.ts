/**
 * Planner 계획 목록의 파생 로직 (검색·정렬·묶기·패싯) — 순수 모듈.
 *
 * React·Tauri 를 import 하지 않는다. 계획이 늘어날수록 '정리가 안 되는' 문제를
 * 푸는 규칙이 전부 여기 모여 있고, 레일 UI 는 이 결과를 그리기만 한다.
 * 입력 배열은 절대 변형하지 않으며 모든 함수가 새 배열을 반환한다.
 *
 * ## '마지막 활동' 의 출처에 관한 주의 (2026-07-30)
 * `PlanSummary.updated_at` 은 frontmatter `updated:` 에서 오는데, 이 값을
 * 갱신하는 곳은 `set_plan_status`/`set_plan_title` **둘뿐** 이다 — 항목 상태를
 * 바꾸는 7개 `PlanEditOp` 도, `plan_ai_refresh` 도, MCP `plan_update` 도
 * 건드리지 않는다. 즉 이름을 바꾼 적 없는 계획의 `updated_at` 은 사실상
 * **생성일에 고정** 되어 있다.
 *
 * 그래서 '멈춤(stale)' 판정은 plan-log 기반 실제 활동 기록
 * (`plan_recent_updates`) 이 있을 때만 내린다. 활동 기록이 없으면
 * `staleDays = null` — *오래됐다* 가 아니라 *모른다* 이며, UI 는 아무 주장도
 * 하지 않는다. 거짓 경고를 화면에서 가장 눈에 띄는 자리에 두느니 침묵이 낫다.
 */

import type { PlanSummary } from "@/lib/bindings";

/** 계획 묶음 — 백엔드 status 를 3개 버킷으로 접는다 (기존 판정 그대로). */
export type PlanBucket = "active" | "done" | "archived";

export type PlanSort = "recent" | "progress" | "remaining" | "title";
export type PlanGroup = "status" | "recency" | "agent" | "none";

/** 활성·미완 계획이 이 일수 이상 실제 활동이 없으면 '멈춤'. */
export const STALE_DAYS = 14;

const DAY_MS = 86_400_000;

/** `touchedAt` 을 어디서 얻었는지 — 멈춤 판정 가능 여부가 여기서 갈린다. */
export type TouchedSource = "activity" | "frontmatter" | "none";

export interface PlanFacet {
  bucket: PlanBucket;
  /** 0..100 반올림. */
  pct: number;
  /** 남은 항목 수 (음수 방지). */
  remaining: number;
  /** 마지막으로 손댄 시각 (epoch ms). 알 수 없으면 null. */
  touchedAt: number | null;
  touchedSource: TouchedSource;
  /**
   * 멈춘 일수. `touchedSource === "activity"` 인 활성·미완 계획이
   * STALE_DAYS 이상 조용할 때만 값이 있다. 그 외에는 null (= 모름).
   */
  staleDays: number | null;
}

/** active / done / 그 외 전부 archived — 기존 UI 의 3분류를 그대로 옮긴 것. */
export function bucketOf(p: PlanSummary): PlanBucket {
  if (p.status === "active") return "active";
  if (p.status === "done") return "done";
  return "archived";
}

/**
 * ISO 문자열 → epoch ms. 빈 문자열·깨진 값·undefined 는 전부 null.
 * (`updated_at` 은 백엔드에서 `unwrap_or_default()` 라 "" 로 올 수 있다.)
 *
 * 참고: `Date.parse("2026-07-20")` 는 UTC 자정으로 해석돼 KST 기준 최대 9시간
 * 어긋나지만, 일 단위 임계값(STALE_DAYS)에는 영향이 없다.
 */
export function parseTouched(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/**
 * 한 계획의 파생 값을 계산한다.
 *
 * @param activityIso plan-log 에서 얻은 실제 마지막 활동 시각. 이 값이 있을
 *   때만 멈춤 판정을 내린다 (모듈 상단 주의 참고).
 */
export function facetOf(
  p: PlanSummary,
  now: number,
  activityIso?: string | null,
): PlanFacet {
  const bucket = bucketOf(p);
  const pct = Math.round((p.progress ?? 0) * 100);
  const remaining = Math.max(0, p.item_count - p.done_count);

  const fromActivity = parseTouched(activityIso);
  const touchedAt = fromActivity ?? parseTouched(p.updated_at);
  const touchedSource: TouchedSource =
    fromActivity != null ? "activity" : touchedAt != null ? "frontmatter" : "none";

  // 멈춤은 '실제 활동 기록이 있고, 그 기록이 오래된' 경우에만 참이다.
  let staleDays: number | null = null;
  if (fromActivity != null && bucket === "active" && pct < 100) {
    const days = Math.floor((now - fromActivity) / DAY_MS);
    if (days >= STALE_DAYS) staleDays = days;
  }

  return { bucket, pct, remaining, touchedAt, touchedSource, staleDays };
}

/** 계획 id → 패싯. 레일·툴바 카운트가 같은 계산을 공유하도록 한 번만 만든다. */
export function facetsOf(
  plans: readonly PlanSummary[],
  now: number,
  activity: Readonly<Record<string, string>> = {},
): Map<string, PlanFacet> {
  const m = new Map<string, PlanFacet>();
  for (const p of plans) m.set(p.plan_id, facetOf(p, now, activity[p.plan_id]));
  return m;
}

/**
 * 제목·id 부분일치. 한국어라 토크나이저·퍼지 매칭은 쓰지 않는다 (KISS).
 * 빈 질의는 원본 순서 그대로 돌려준다.
 */
export function searchPlans(plans: readonly PlanSummary[], q: string): PlanSummary[] {
  const needle = q.trim().normalize("NFC").toLowerCase();
  if (!needle) return [...plans];
  return plans.filter((p) => {
    const hay = `${p.title} ${p.plan_id}`.normalize("NFC").toLowerCase();
    return hay.includes(needle);
  });
}

/**
 * 정렬. 동점은 항상 `plan_id` 오름차순으로 깨서 결정적이다 (백엔드
 * `load_all_plans` 와 같은 기준이라 목록이 흔들리지 않는다).
 * `recent` 에서 시각을 모르는 계획(null)은 언제나 맨 뒤로 간다.
 */
export function sortPlans(
  plans: readonly PlanSummary[],
  sort: PlanSort,
  facets: ReadonlyMap<string, PlanFacet>,
): PlanSummary[] {
  const f = (p: PlanSummary) => facets.get(p.plan_id);
  return [...plans].sort((a, b) => {
    let d = 0;
    switch (sort) {
      case "recent": {
        const ta = f(a)?.touchedAt ?? null;
        const tb = f(b)?.touchedAt ?? null;
        if (ta == null && tb == null) d = 0;
        else if (ta == null) d = 1; // 모르는 건 항상 뒤
        else if (tb == null) d = -1;
        else d = tb - ta;
        break;
      }
      case "progress":
        d = (f(b)?.pct ?? 0) - (f(a)?.pct ?? 0);
        break;
      case "remaining":
        d = (f(b)?.remaining ?? 0) - (f(a)?.remaining ?? 0);
        break;
      case "title":
        d = a.title.localeCompare(b.title, "ko");
        break;
    }
    return d !== 0 ? d : a.plan_id.localeCompare(b.plan_id);
  });
}

export interface PlanSection {
  key: string;
  label: string;
  plans: PlanSummary[];
  /** 사용자가 접힘을 저장하지 않았을 때의 기본값. */
  defaultOpen: boolean;
}

const RECENCY_BUCKETS: { key: string; label: string; maxDays: number }[] = [
  { key: "today", label: "오늘", maxDays: 1 },
  { key: "week", label: "이번 주", maxDays: 7 },
  { key: "fortnight", label: "2주 내", maxDays: 14 },
];

const SECTION_ORDER = [
  "active",
  "done",
  "archived",
  "today",
  "week",
  "fortnight",
  "older",
  "unknown",
];

/**
 * 묶기. 빈 섹션은 만들지 않는다.
 *
 * `recency` 축에는 '멈춤' 버킷을 두지 않는다 — 멈춤은 활동 기록이 있는
 * 계획에만 내릴 수 있는 판정이라 묶기 축으로 쓰면 판정할 수 없는 계획이
 * 조용히 섞인다. 대신 시각을 모르는 계획을 '기록 없음' 으로 분리한다.
 */
export function groupPlans(
  plans: readonly PlanSummary[],
  group: PlanGroup,
  facets: ReadonlyMap<string, PlanFacet>,
  now: number,
): PlanSection[] {
  if (group === "none") {
    return plans.length ? [{ key: "all", label: "전체", plans: [...plans], defaultOpen: true }] : [];
  }

  const order: string[] = [];
  const byKey = new Map<string, { label: string; plans: PlanSummary[]; defaultOpen: boolean }>();
  const push = (key: string, label: string, defaultOpen: boolean, p: PlanSummary) => {
    let slot = byKey.get(key);
    if (!slot) {
      slot = { label, plans: [], defaultOpen };
      byKey.set(key, slot);
      order.push(key);
    }
    slot.plans.push(p);
  };

  for (const p of plans) {
    const f = facets.get(p.plan_id);
    if (group === "status") {
      const b = f?.bucket ?? bucketOf(p);
      if (b === "active") push("active", "진행 중", true, p);
      else if (b === "done") push("done", "완료", false, p);
      else push("archived", "보관", false, p);
    } else if (group === "agent") {
      const owner = p.owner_agent || "unknown";
      push(`agent:${owner}`, owner, true, p);
    } else {
      const t = f?.touchedAt ?? null;
      if (t == null) {
        push("unknown", "기록 없음", false, p);
        continue;
      }
      const days = Math.floor((now - t) / DAY_MS);
      const b = RECENCY_BUCKETS.find((x) => days < x.maxDays);
      if (b) push(b.key, b.label, true, p);
      else push("older", "그 이전", false, p);
    }
  }

  // 상태별·최근활동별은 의미 순서가 정해져 있고, 작성자별은 등장 순서를 따른다.
  const rank = (key: string) => {
    const i = SECTION_ORDER.indexOf(key);
    return i === -1 ? SECTION_ORDER.length + order.indexOf(key) : i;
  };

  return [...order]
    .sort((a, b) => rank(a) - rank(b))
    .map((key) => {
      const slot = byKey.get(key)!;
      return { key, label: slot.label, plans: slot.plans, defaultOpen: slot.defaultOpen };
    });
}

/** "오늘 / 어제 / N일 전" — 시각을 모르면 빈 문자열 (아무 주장도 하지 않는다). */
export function relDay(touchedAt: number | null, now: number): string {
  if (touchedAt == null) return "";
  const days = Math.floor((now - touchedAt) / DAY_MS);
  if (days <= 0) return "오늘";
  if (days === 1) return "어제";
  if (days < 30) return `${days}일 전`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months}개월 전` : `${Math.floor(days / 365)}년 전`;
}

/**
 * `plan_recent_updates` 응답을 계획별 마지막 활동 시각으로 접는다.
 * 응답 모양을 신뢰하지 않는다 — 테스트 목이나 구버전 백엔드가 null 을 줄 수 있다.
 */
export function latestActivityByPlan(
  rows: readonly { plan_id?: unknown; ts?: unknown }[] | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(rows)) return out;
  for (const r of rows) {
    if (typeof r?.plan_id !== "string" || typeof r?.ts !== "string") continue;
    const cur = out[r.plan_id];
    if (!cur || r.ts > cur) out[r.plan_id] = r.ts;
  }
  return out;
}
