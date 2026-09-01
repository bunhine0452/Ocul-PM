/**
 * 능력 매니페스트 (Osaurus 라운드 Phase 5 `#capabilities-manifest` · `#manifest-freeze`).
 *
 * Osaurus 는 스킬 **본문**을 프롬프트에 싣지 않는다. 이름·설명·키워드만 올리고,
 * 모델이 필요하다고 판단하면 꺼내 온다. 여기서도 같다 — 이 블록은 **목록만**이다.
 *
 * 그래서 두 가지가 동시에 풀린다:
 *  - `digestRules` 의 절단이 사라진다. 규칙은 잘리지 않고, 필요할 때 **전문**이 온다.
 *  - `MAX_CTX_PLANS = 4` 상한도 사라진다 — 목록은 싸고 본문만 비싸다.
 *
 * ## 동결 (§1.1)
 *
 * 매니페스트는 대화 시작 시 1회 조립하고 그 대화 동안 **바이트 동일**로 유지한다.
 * 거의 안 바뀌는 블록이 매 턴 재조립되면 한 글자만 달라져도 그 뒤 전부가 프롬프트
 * 캐시 미스이기 때문이다. 대화 중 규칙·스킬이 바뀌어도 매니페스트는 안 바꾼다 —
 * `context_discover` 가 항상 디스크를 보므로 **즉시 도달은 가능하다**.
 */
import { contextRead } from "@/api/context";

/** 매니페스트에 나열할 상한 — 목록은 싸지만 무한하지는 않다. */
const MAX_LISTED = 40;

/**
 * 온디맨드로 미룰 수 없는 안전 조항 (설계 §5).
 *
 * `digestRules` 를 은퇴시키면 규칙이 더 이상 자동으로 안 들어간다. 모델이
 * 본문을 안 꺼내면 규칙 없이 답할 수 있다 — 대부분은 그래도 괜찮지만
 * **시크릿 금지** 같은 조항은 "안 꺼내 봐서 몰랐다" 가 성립하지 않는다.
 * 그래서 이 세 줄만은 매니페스트에 상주한다.
 */
export const SAFETY_CLAUSES = [
  "기록(일지·플랜·논의)에 API 키·토큰·비밀번호를 절대 적지 않는다.", // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
  "`.oculpm/index/**` 는 앱이 관리한다 — 직접 쓰지 않는다.", // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
  "기록은 사용자 저장소에 남는 파일이다. 확인하지 않은 사실을 지어내지 않는다.", // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
];

export interface ManifestEntry {
  kind: "rule" | "skill" | "plan" | "journal";
  /** `context_load` 에 그대로 넘길 식별자. */
  id: string;
  label: string;
  /** 검색 색인 대상 — 이름·설명·키워드만 (지시문 본문은 색인하지 않는다). */
  terms: string[];
  /** 매니페스트 한 줄로 렌더할 때의 부가 설명. */
  note: string;
}

export interface Manifest {
  /** system 에 실릴 원문. 대화 동안 이 문자열은 바이트 동일이다. */
  text: string;
  /** `context_discover` 가 검색하는 색인. */
  entries: ManifestEntry[];
}

const EMPTY: Manifest = { text: "", entries: [] };

/** 디스크를 읽어 매니페스트를 새로 조립한다. 실패한 소스는 조용히 빠진다. */
export async function buildManifest(projectId: number | null): Promise<Manifest> {
  if (projectId == null) return EMPTY;
  const entries: ManifestEntry[] = [];
  const lines: string[] = [];

  // ── 규칙 ────────────────────────────────────────────────────────────────
  const rulesData = await contextRead.rules(projectId);
  if (rulesData) {
    const all = [
      ...rulesData.claude_md.filter((r) => r.exists),
      ...rulesData.project_rules,
      ...rulesData.global_rules,
    ];
    for (const rule of all.slice(0, MAX_LISTED)) {
      // `paths` 가 비면 항상 로드되는 규칙이다 — 그 사실이 모델의 판단 재료다.
      const scope = rule.paths.length ? `paths: ${rule.paths.join(", ")}` : "항상"; // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
      entries.push({
        kind: "rule",
        // scope 를 id 에 실어야 `context_load` 가 어느 루트에서 읽을지 안다
        // (전역 규칙과 프로젝트 규칙이 같은 상대 경로를 가질 수 있다).
        id: `${rule.scope}:${rule.rel_path}`,
        label: rule.name,
        terms: [rule.name, rule.title, ...rule.paths],
        note: scope,
      });
    }
    if (all.length) {
      lines.push(
        `### 규칙 ${all.length}개`, // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
        ...entries
          .filter((e) => e.kind === "rule")
          .map((e) => `- ${e.label} — ${e.note}${e.terms[1] ? ` · ${e.terms[1]}` : ""}`),
      );
    }
  }

  // ── 스킬 ────────────────────────────────────────────────────────────────
  const skillsData = await contextRead.skills(projectId);
  if (skillsData) {
    const all = [...skillsData.project, ...skillsData.global].filter((s) => s.enabled);
    const listed = all.slice(0, MAX_LISTED);
    for (const skill of listed) {
      entries.push({
        kind: "skill",
        id: `${skill.scope}:${skill.dir_name}`,
        label: skill.name,
        terms: [skill.name, skill.description, ...skill.keywords],
        note: skill.description,
      });
    }
    if (listed.length) {
      lines.push(
        "",
        `### 스킬 ${all.length}개`, // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
        ...listed.map((s) => {
          const kw = s.keywords.length ? ` (키워드: ${s.keywords.join(", ")})` : ""; // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
          return `- ${s.name} — ${s.description || "설명 없음"}${kw}`; // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
        }),
      );
    }
  }

  // ── 활성 계획 ───────────────────────────────────────────────────────────
  const plans = await contextRead.plans(projectId);
  {
    const active = plans.filter((p) => p.status === "active");
    for (const plan of active.slice(0, MAX_LISTED)) {
      entries.push({
        kind: "plan",
        id: plan.plan_id,
        label: plan.title,
        terms: [plan.title, plan.plan_id],
        note: `${plan.done_count}/${plan.item_count}`,
      });
    }
    if (active.length) {
      lines.push(
        "",
        `### 활성 계획 ${active.length}개`, // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
        // 상한을 없앤 자리다 — 예전 `MAX_CTX_PLANS = 4` 는 본문까지 실었기 때문에
        // 필요했다. 제목 한 줄은 싸다.
        ...active
          .slice(0, MAX_LISTED)
          .map((p) => `- ${p.title} — ${p.done_count}/${p.item_count} (plan_id: ${p.plan_id})`),
      );
    }
  }

  // ── 최근 일지 (개수만) ──────────────────────────────────────────────────
  const journal = await contextRead.journalList(projectId);
  if (journal.length) {
    const recent = journal.slice(0, 30);
    const byDay = new Map<string, Map<string, number>>();
    for (const entry of recent) {
      const day = entry.created_at ? entry.created_at.slice(0, 10) : entry.workday;
      const types = byDay.get(day) ?? new Map<string, number>();
      types.set(entry.type, (types.get(entry.type) ?? 0) + 1);
      byDay.set(day, types);
    }
    lines.push("", "### 최근 일지"); // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
    for (const [day, types] of [...byDay].slice(0, 7)) {
      const total = [...types.values()].reduce((a, b) => a + b, 0);
      const detail = [...types].map(([type, n]) => `${type} ${n}`).join(" · ");
      lines.push(`- ${day}: ${total}건 (${detail})`); // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
    }
    for (const entry of recent.slice(0, MAX_LISTED)) {
      entries.push({
        kind: "journal",
        id: entry.relative_path,
        label: entry.title,
        terms: [entry.title, entry.type],
        note: entry.workday,
      });
    }
  }

  if (!lines.length) return EMPTY;

  const text = [
    "## 이 프로젝트에서 쓸 수 있는 것", // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
    "아래는 **목록**입니다 — 본문이 필요하면 꺼내 오세요 (꺼내는 방법은 다음 절).", // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
    "여기 없는 규칙·스킬·계획은 이 프로젝트에 없는 것입니다.", // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
    "",
    ...lines,
    "",
    "### 반드시 지키는 것", // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
    ...SAFETY_CLAUSES.map((c) => `- ${c}`),
  ].join("\n");

  return { text, entries };
}

// ─── 동결 (§1.1) ────────────────────────────────────────────────────────────

/**
 * 대화별 동결 캐시. 키는 `프로젝트:대화` 다 — 대화를 바꾸면 새 매니페스트를
 * 받고, 같은 대화 안에서는 몇 턴을 돌아도 **같은 바이트**가 나간다.
 */
const frozen = new Map<string, Manifest>();

function keyOf(projectId: number | null, conversationId: number | null): string {
  return `${projectId ?? "-"}:${conversationId ?? "new"}`;
}

/**
 * 이 대화의 매니페스트. 처음 물으면 조립하고, 그다음부터는 **얼려 둔 것**을
 * 그대로 돌려준다.
 *
 * 워처가 `.oculpm` 변경을 알려도 이 함수는 다시 읽지 않는다 — 그것이 동결의
 * 정의다. 즉시 도달이 필요하면 `context_discover` 가 디스크를 본다.
 */
export async function frozenManifest(
  projectId: number | null,
  conversationId: number | null,
): Promise<Manifest> {
  const key = keyOf(projectId, conversationId);
  const hit = frozen.get(key);
  if (hit) return hit;
  const built = await buildManifest(projectId);
  frozen.set(key, built);
  return built;
}

/** 대화가 끝났거나 새로 시작할 때 — 다음 조립에서 새 목록을 받는다. */
export function thawManifest(projectId: number | null, conversationId: number | null): void {
  frozen.delete(keyOf(projectId, conversationId));
}

/** 테스트 전용 — 동결 캐시를 통째로 비운다. */
export function resetManifestFreeze(): void {
  frozen.clear();
}
