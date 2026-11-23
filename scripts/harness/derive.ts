// 픽스처에서 응답의 재료를 만드는 순수 함수들 — handlers.ts 가 쓴다. 개발 전용.
import type {
  ChangeGroup,
  DigestPlan,
  FileOp,
  JournalEntrySummary,
  PlanItemDto,
  TodayDigest,
} from "@/lib/bindings";
import type { FixtureJournal, FixturePlan } from "./types";

type Item = { plan_id: string; plan_title: string; item_id: string; title: string; status: PlanItemDto["status"] };

export function summaryOf(j: FixtureJournal): JournalEntrySummary {
  return {
    relative_path: j.relative_path,
    workday: j.workday,
    type: j.type,
    slug: j.slug,
    status: j.status,
    difficulty: j.difficulty,
    title: j.title,
    checkbox: j.checkbox,
    session_id: j.session_id,
    agent_id: j.agent_id,
    agent_version: j.agent_version,
    verified_by_user: j.verified_by_user,
    verified_stale: j.verified_stale,
    evidence: j.evidence,
    created_at: j.created_at,
    updated_at: j.updated_at,
    tags: j.tags,
    files_count: j.files_count,
    parse_ok: true,
    parse_warnings: [],
  };
}

/** 사람 몫 항목 — 제목이 `[사용자` · `[user` 로 열린다(오늘 digest 의 규칙과 같다). */
export function isUserItem(title: string): boolean {
  return title.startsWith("[사용자") || title.slice(0, 5).toLowerCase() === "[user";
}

/** 자식이 없는 항목(리프). */
export function leaves(p: FixturePlan): PlanItemDto[] {
  const parents = new Set(p.items.map((i) => i.parent_item).filter(Boolean));
  return p.items.filter((i) => !parents.has(i.item_id));
}

function digestPlan(p: FixturePlan): DigestPlan {
  const ls = leaves(p);
  const nx = ls.find((i) => i.status === "todo" && !isUserItem(i.title));
  const s = p.summary;
  return {
    plan_id: s.plan_id,
    title: s.title,
    progress: s.progress,
    done_count: s.done_count,
    item_count: s.item_count,
    closable: ls.length > 0 && !ls.some((i) => ["todo", "in_progress", "blocked"].includes(i.status)),
    updated_at: s.updated_at,
    done_when: p.done_when,
    check: p.check,
    last_verdict: s.last_verdict ?? null,
    stale_files: [],
    verdict_from: null,
    next: nx ? { plan_id: s.plan_id, plan_title: s.title, item_id: nx.item_id, title: nx.title, status: nx.status } : null,
  };
}

export function digestOf(plans: FixturePlan[]): TodayDigest {
  const needs_user: Item[] = [];
  const blocked: Item[] = [];
  const journal_plan: TodayDigest["journal_plan"] = [];
  for (const p of plans) {
    for (const i of leaves(p)) {
      const it = { plan_id: p.summary.plan_id, plan_title: p.summary.title, item_id: i.item_id, title: i.title, status: i.status };
      if (["todo", "in_progress"].includes(i.status) && isUserItem(i.title)) needs_user.push(it);
      else if (i.status === "blocked") blocked.push(it);
    }
    for (const i of p.items)
      for (const r of i.journal_refs)
        journal_plan.push({ journal_ref: r, plan_id: p.summary.plan_id, plan_title: p.summary.title, item_id: i.item_id });
  }
  return { plans: plans.map(digestPlan), needs_user, blocked, journal_plan };
}

/**
 * 변경 묶음 — 일지가 `files_touched` 로 적은 파일은 그 일지 아래, 어느 일지에도 없는 파일(`unrecorded`)은
 * 「일지 없음」 묶음으로. `oculpm_compare_workday` 가 같은 `unrecorded` 를 말해야 탭 배지 · 오늘 · 변경 화면이
 * 같은 수를 말한다(어긋나면 가짜 소견).
 */
export function groupChanges(journals: FixtureJournal[], unrecorded: string[], paths: string[]): ChangeGroup[] {
  const rest = new Set(paths.filter((p) => !unrecorded.includes(p)));
  const unrec = paths.filter((p) => unrecorded.includes(p));
  const out: ChangeGroup[] = [];
  for (const j of journals) {
    const hit = j.files.map((f) => f.path).filter((p) => rest.has(p));
    if (!hit.length) continue;
    hit.forEach((p) => rest.delete(p));
    out.push({
      entry_path: j.relative_path,
      entry_title: j.title,
      entry_type: j.type,
      created_at: j.created_at,
      verified_by_user: j.verified_by_user,
      verified_stale: false,
      plan_refs: [],
      files: hit,
    });
  }
  const none = [...unrec, ...rest];
  if (none.length)
    out.push({
      entry_path: null,
      entry_title: null,
      entry_type: null,
      created_at: null,
      verified_by_user: null,
      verified_stale: null,
      plan_refs: [],
      files: none,
    });
  return out;
}

const FILE_OPS: readonly FileOp[] = ["create", "update", "delete", "rename", "correct"];

/** 프런트매터의 `op:` 글자를 `FileOp` 으로 — 모르는 값은 `update`(파서가 경고만 내고 쓰는 것과 같다). */
export function toFileOp(op: string): FileOp {
  return FILE_OPS.find((o) => o === op) ?? "update";
}
