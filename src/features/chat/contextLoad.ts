/**
 * 능력 검색·본문 로드 (Osaurus 라운드 Phase 5 `#context-tools`).
 *
 * ## 왜 도구가 아니라 텍스트 규약인가
 *
 * 설계 §1 은 이것을 `context_discover` / `context_load` **도구**로 적었다.
 * 그런데 이 저장소의 `LlmProvider` 트레이트에는 도구 호출이 없다 —
 * `chat`/`chat_stream` 은 메시지 목록과 `{model, temperature, max_tokens}` 만
 * 받고, `ChatEvent` 는 Delta·Done·Error 셋뿐이다. 네 어댑터(anthropic·openai·
 * gemini·nim) 전부에 함수 호출을 얹는 것은 이 Phase 보다 큰 작업이다.
 *
 * 대신 **이미 이 저장소가 쓰는 관용구**를 쓴다: `aiActions` 의
 * ```` ```json:action ```` 처럼 모델이 펜스 블록으로 요청하고 앱이 실행한다.
 * 다른 점 하나 — 플래너 액션은 **쓰기**라 사용자 승인 카드를 거치지만, 여기는
 * **읽기**라 자동으로 왕복한다. 규칙 본문을 읽는 데 허락을 받을 이유가 없다.
 *
 * 한계는 정직하게 적는다: 도구 호출이 아니므로 왕복마다 LLM 호출이 한 번 더
 * 든다. 그래서 `MAX_CONTEXT_HOPS` 로 막는다.
 */
import { contextRead } from "@/api/context";

import type { Manifest, ManifestEntry } from "./manifest";

/** 한 턴에서 허용하는 왕복 수. 넘으면 더 꺼내지 않고 그대로 답하게 둔다. */
export const MAX_CONTEXT_HOPS = 2;

export type ContextRequest =
  | { type: "discover"; query: string }
  | { type: "load"; kind: ManifestEntry["kind"] | "rules_master"; id: string };

/** 모델에게 꺼내는 법을 알려 주는 지시문. 매니페스트 바로 뒤에 붙는다. */
export function buildRetrievalInstruction(): string {
  return [
    "### 본문이 필요하면 꺼내세요", // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
    "위 목록은 이름과 설명뿐입니다. 규칙·스킬·계획·일지의 **본문**이 있어야 답할 수 있으면,", // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
    "답을 추측하지 말고 아래 블록 **하나만** 응답 끝에 붙이세요. 앱이 실행해 본문을 돌려주고,", // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
    "그다음 턴에서 이어서 답하면 됩니다.", // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
    "",
    "말로 찾기 (이름·설명·키워드만 검색합니다 — 본문은 검색되지 않습니다):", // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
    "```json:context",
    '{ "type": "discover", "query": "테마 토큰" }', // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
    "```",
    "",
    "본문 꺼내기 (`id` 는 위 목록의 값을 그대로):", // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
    "```json:context",
    '{ "type": "load", "kind": "rule", "id": "project:.claude/rules/api.md" }',
    "```",
    '`kind` 는 "rule" | "skill" | "plan" | "journal" | "rules_master" 입니다.', // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
    '"rules_master" 는 이 프로젝트의 작업 기록 규칙 전문이고 `id` 는 비워 둡니다.', // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
    "",
    "이미 아는 것으로 답할 수 있으면 꺼내지 마세요 — 왕복은 비쌉니다.", // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
  ].join("\n");
}

/**
 * 응답에서 `json:context` 요청을 찾는다. 없으면 `null`.
 *
 * 여러 개가 있으면 **첫 번째만** 쓴다 — 한 턴에 하나라고 지시문에 적었고,
 * 여러 개를 다 실행하면 왕복 예산이 순식간에 사라진다.
 */
export function parseContextRequest(text: string): ContextRequest | null {
  const fence = /```json:context\s*\n([\s\S]*?)```/m.exec(text);
  if (!fence) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(fence[1]);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.type === "discover" && typeof obj.query === "string" && obj.query.trim()) {
    return { type: "discover", query: obj.query.trim() };
  }
  if (obj.type === "load" && typeof obj.kind === "string") {
    const kind = obj.kind;
    const known = ["rule", "skill", "plan", "journal", "rules_master"];
    if (!known.includes(kind)) return null;
    return {
      type: "load",
      kind: kind as Extract<ContextRequest, { type: "load" }>["kind"],
      id: typeof obj.id === "string" ? obj.id : "",
    };
  }
  return null;
}

/** 응답 본문에서 요청 블록을 걷어낸다 — 사용자에게는 보일 이유가 없다. */
export function stripContextRequest(text: string): string {
  return text.replace(/```json:context\s*\n[\s\S]*?```/gm, "").trimEnd();
}

/**
 * 매니페스트 색인 검색. **이름·설명·키워드만** 본다 (설계 §1.3).
 *
 * 본문을 색인하지 않는 것이 핵심이다 — 본문까지 넣으면 색인이 곧 컨텍스트만큼
 * 커지고, 그러면 애초에 목록만 올린 이유가 사라진다.
 */
export function discover(manifest: Manifest, query: string, limit = 8): ManifestEntry[] {
  const needles = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!needles.length) return [];
  const scored = manifest.entries
    .map((entry) => {
      const hay = entry.terms.filter(Boolean).join(" ").toLowerCase();
      const hits = needles.filter((n) => hay.includes(n)).length;
      return { entry, hits };
    })
    .filter((r) => r.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  return scored.slice(0, limit).map((r) => r.entry);
}

/** `scope:rest` 로 인코딩된 id 를 가른다. 접두가 없으면 project 로 본다. */
function splitScoped(id: string): { scope: "project" | "global"; rest: string } {
  const at = id.indexOf(":");
  if (at < 0) return { scope: "project", rest: id };
  const head = id.slice(0, at);
  if (head !== "project" && head !== "global") return { scope: "project", rest: id };
  return { scope: head, rest: id.slice(at + 1) };
}

/**
 * 요청을 실행해 모델에게 돌려줄 텍스트를 만든다.
 *
 * 실패해도 **던지지 않는다** — 못 찾았다는 사실 자체가 모델에게 유용한 답이고,
 * 여기서 던지면 대화 전체가 끊긴다.
 */
export async function runContextRequest(
  projectId: number | null,
  request: ContextRequest,
  manifest: Manifest,
): Promise<string> {
  if (projectId == null) return "컨텍스트를 읽을 프로젝트가 없습니다."; // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)

  if (request.type === "discover") {
    const hits = discover(manifest, request.query);
    if (!hits.length) return `검색 결과 없음: "${request.query}"`; // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
    return [
      `검색 결과 (${hits.length}건) — 본문이 필요하면 kind 와 id 로 꺼내세요:`, // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
      ...hits.map((h) => `- kind: ${h.kind} · id: ${h.id} · ${h.label}${h.note ? ` — ${h.note}` : ""}`),
    ].join("\n");
  }

  try {
    switch (request.kind) {
      case "rules_master": {
        const master = await contextRead.rulesMaster(projectId);
        if (!master.trim()) return "작업 규칙을 읽지 못했습니다."; // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
        // **전문이다.** 여기가 `digestRules` 의 절단이 사라진 자리다.
        return `### 작업 규칙 (AGENTS) 전문\n\n${master.trim()}`; // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
      }
      case "rule": {
        const { scope, rest } = splitScoped(request.id);
        const body = await contextRead.ruleBody(projectId, scope, rest);
        if (body == null) return `규칙을 읽지 못했습니다: ${request.id}`; // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
        return `### 규칙 \`${rest}\` 전문\n\n${body}`; // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
      }
      case "skill": {
        const { scope, rest } = splitScoped(request.id);
        const body = await contextRead.skillBody(projectId, scope, rest);
        if (body == null) return `스킬을 읽지 못했습니다: ${request.id}`; // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
        return `### 스킬 \`${rest}\` 전문\n\n${body}`; // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
      }
      case "plan": {
        const detail = await contextRead.plan(projectId, request.id);
        if (!detail) return `계획을 읽지 못했습니다: ${request.id}`; // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
        const items = (detail.items ?? [])
          .map((it) => `- [${it.status}] (item_id: ${it.item_id}) ${it.phase ? `[${it.phase}] ` : ""}${it.title}`)
          .join("\n");
        return `### 계획 \`${detail.plan.title}\` (plan_id: ${request.id})\n\n${items}`; // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
      }
      case "journal": {
        const entry = await contextRead.journalEntry(projectId, request.id);
        if (!entry) return `일지를 읽지 못했습니다: ${request.id}`; // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
        return `### 일지 \`${entry.title}\`\n\n${entry.body_markdown}`; // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
      }
      default:
        return "알 수 없는 요청입니다."; // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
    }
  } catch {
    return `컨텍스트를 읽지 못했습니다: ${request.id}`; // i18n-ignore -- LLM 프롬프트 본문 (03-i18n.md §4.5)
  }
}
