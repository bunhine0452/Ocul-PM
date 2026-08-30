import type { ChangeGroup, ChangePlanRef } from "@/lib/bindings";
import type { RecentChange } from "@/lib/recentChangesStore";

// 변경 diff 왼쪽 목록의 순수 모델. 백엔드가 준 `ChangeGroup[]` 을 화면이 그대로
// 그릴 수 있는 형태(제목 정리 · 필터 · 접힘 · 진행도)로 옮긴다. 렌더와 분리해
// 두는 이유: 접힘/필터 규칙이 j/k 이동 순서와 같은 소스여야 하는데, 그 계약을
// 컴포넌트 안에 두면 테스트할 수가 없다.

export interface PlanChip {
  planId: string;
  title: string;
  items: string[];
}

/** Collapse plan refs to one chip per plan. The backend returns one
 *  ChangePlanRef per advanced *item*, so an entry that moved many items of the
 *  same plan would otherwise render the (identical) plan title once per item —
 *  e.g. 11 look-alike rows. We keep insertion order and stash the item titles
 *  for the chip's tooltip + a `·N` count. */
export function collapsePlanRefs(refs: ChangePlanRef[]): PlanChip[] {
  const byPlan = new Map<string, PlanChip>();
  for (const pr of refs) {
    const e = byPlan.get(pr.plan_id);
    if (e) e.items.push(pr.item_title);
    else
      byPlan.set(pr.plan_id, {
        planId: pr.plan_id,
        title: cleanTitle(pr.plan_title),
        items: [pr.item_title],
      });
  }
  return [...byPlan.values()];
}

/** Month/day for a change-group header (entries may span days). */
export function groupDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}

/**
 * 일지·플랜 제목에서 마크다운 마커를 걷어낸다. 제목은 파일에 적힌 그대로라
 * `# ◎ ACP 에이전트 패널` / `한 프로젝트에서 **대화 여러 개**` 처럼 문법 기호를
 * 달고 온다 — 한 줄로 줄여 놓으면 닫는 `**` 가 잘려 나가 더 지저분해진다.
 */
export function cleanTitle(raw: string): string {
  return raw
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\s*\[[ xX]\]\s*/, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*/g, "")
    .trim();
}

/** One entry-bucket of the file list, ready to render. */
export interface GroupView {
  /** Stable identity for the collapsed-set + React key. */
  key: string;
  entryPath: string | null;
  entryType: string | null;
  /** Cleaned entry title; empty when there's nothing to show. */
  title: string;
  /** Files with no journal entry behind them. */
  untracked: boolean;
  /** No grouping available at all (flat fallback) — render without a header. */
  headerless: boolean;
  /** 월·일 — 바로 위 그룹과 같은 날이면 빈 문자열(중복 제거). */
  date: string;
  plans: PlanChip[];
  /** Files to render — already filtered. */
  files: string[];
  /** File count before the filter (what the header badge reports). */
  total: number;
  /** How many of `total` are marked reviewed. */
  reviewed: number;
  collapsed: boolean;
  /** 일지의 `verified_by_user` — 미추적 묶음·평면 목록은 `null` (토글 없음). */
  verified: boolean | null;
}

/** 그룹이 이만큼보다 많아지면 처음 열 때 알아서 접는다 (하나만 펼친 채로). */
export const AUTO_FOLD_FROM = 2;

interface BuildArgs {
  groups: ChangeGroup[] | null;
  changes: RecentChange[];
  /** Raw filter text; matched case-insensitively against the whole path. */
  filter: string;
  collapsed: ReadonlySet<string>;
  reviewed: ReadonlySet<string>;
}

export function groupKey(g: ChangeGroup): string {
  return g.entry_path ?? "__untracked";
}

/**
 * `ChangeGroup[]` → 렌더 가능한 뷰. 규칙 둘:
 * - 필터가 걸려 있으면 접힘은 무시한다 (접힌 그룹 안의 일치 항목이 사라지면
 *   필터가 거짓말을 하는 셈이라). 일치가 0 인 그룹은 아예 빠진다.
 * - 그룹 정보가 없으면(`groups === null`) 헤더 없는 그룹 하나로 접는다 —
 *   기존 평면 목록과 같은 순서(최신 변경이 위).
 */
export function buildGroupViews({
  groups,
  changes,
  filter,
  collapsed,
  reviewed,
}: BuildArgs): GroupView[] {
  const q = filter.trim().toLowerCase();
  const match = (p: string) => (q ? p.toLowerCase().includes(q) : true);
  const countReviewed = (paths: string[]) => paths.filter((p) => reviewed.has(p)).length;

  if (!groups) {
    const all = changes
      .slice()
      .reverse()
      .map((c) => c.path);
    const files = all.filter(match);
    return [
      {
        key: "__flat",
        entryPath: null,
        entryType: null,
        title: "",
        untracked: false,
        headerless: true,
        date: "",
        plans: [],
        files,
        total: all.length,
        reviewed: countReviewed(all),
        collapsed: false,
        verified: null,
      },
    ];
  }

  const out: GroupView[] = [];
  // 같은 날짜가 연달아 반복되면 뒤쪽은 지운다 — 대부분의 일지가 오늘 것이라
  // `8. 20.` 이 그룹마다 붙어 좁은 제목 폭만 갉아먹는다.
  let lastDate = "";
  for (const g of groups) {
    const files = g.files.filter(match);
    if (q && files.length === 0) continue;
    const key = groupKey(g);
    const date = g.created_at ? groupDate(g.created_at) : "";
    const showDate = date && date !== lastDate ? date : "";
    if (date) lastDate = date;
    out.push({
      key,
      entryPath: g.entry_path,
      entryType: g.entry_type,
      title: g.entry_title ? cleanTitle(g.entry_title) : "",
      untracked: g.entry_path == null,
      headerless: false,
      date: showDate,
      plans: collapsePlanRefs(g.plan_refs),
      files,
      total: g.files.length,
      reviewed: countReviewed(g.files),
      collapsed: q ? false : collapsed.has(key),
      verified: g.verified_by_user ?? null,
    });
  }
  return out;
}

/** j/k 이동이 따르는 순서 — 화면에 실제로 보이는 행만, 위에서 아래로. */
export function visiblePathsOf(views: GroupView[]): string[] {
  return views.flatMap((v) => (v.collapsed ? [] : v.files));
}
