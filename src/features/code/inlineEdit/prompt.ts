// ⌘K 인라인 편집 — **순수** 프롬프트 조립 · 응답 해석 (Phase 5 `{#agent-cmdk}`).
//
// 편집기도 프로바이더도 모르는 문자열 함수만 둔다. 이 자리가 순수해야 하는
// 이유는 `mdEdit.ts` 와 같다: 여기서 틀리면 **사용자 코드가 망가진다**. 모델이
// 펜스를 붙였는지, 들여쓰기를 흘렸는지, 끝 개행이 늘었는지 — 전부 화면으로는
// 미묘하고 diff 로는 시끄러운 종류라 단위 테스트가 계약서가 된다.

/** 선택 앞뒤로 함께 보낼 줄 수. 모델이 문맥을 보되 토큰을 삼키지 않는 선. */
export const CONTEXT_LINES = 40;

export interface InlineEditRequest {
  /** 프로젝트 상대 경로 — 모델에게 "무슨 파일인가" 를 준다. */
  path: string;
  /** `codeLang.ts` 의 언어 id (`plaintext` 이면 안 적는다). */
  languageId: string;
  /** 고쳐야 할 원문 (선택 범위). */
  selection: string;
  /** 선택 앞의 문맥 (이미 잘려 옴). */
  before: string;
  /** 선택 뒤의 문맥. */
  after: string;
  /** 사용자가 친 지시. */
  instruction: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const SYSTEM = [
  "You rewrite one selected region of a source file.",
  "",
  "Rules:",
  "1. Reply with the replacement text for the SELECTION only. Nothing else.",
  "2. No prose, no explanation, no markdown code fences.",
  "3. Keep the indentation the selection already has — the text is spliced back",
  "   verbatim at the same position.",
  "4. Keep the surrounding context compiling: do not rename or remove things the",
  "   context still refers to unless the instruction asks for it.",
  "5. If the instruction cannot be satisfied, reply with the selection unchanged.",
].join("\n");

/**
 * 프로바이더에 보낼 메시지 둘.
 *
 * 문맥을 시스템이 아니라 **사용자 메시지**에 넣는 이유: 시스템은 규칙이고
 * 문맥은 자료다. 섞으면 프롬프트 캐시가 파일마다 깨지고, 규칙이 자료에 밀려
 * 무시되는 것도 흔하다.
 */
export function buildMessages(req: InlineEditRequest): ChatMessage[] {
  const lang = req.languageId && req.languageId !== "plaintext" ? req.languageId : "";
  const parts = [
    `File: ${req.path}`,
    lang ? `Language: ${lang}` : "",
    "",
    "--- context before ---",
    req.before,
    "--- selection (replace this) ---",
    req.selection,
    "--- context after ---",
    req.after,
    "",
    `Instruction: ${req.instruction}`,
  ].filter((p) => p !== "");
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: parts.join("\n") },
  ];
}

/**
 * 응답에서 실제 코드만 꺼낸다.
 *
 * "펜스를 붙이지 말라" 고 시켜도 모델은 **붙인다**. 그대로 끼워 넣으면 코드에
 * ``` 세 줄이 박히고, 그건 사용자가 손으로 지워야 하는 종류의 오염이다.
 * 그래서 규칙에 기대지 않고 여기서 걷는다.
 *
 * - 응답 전체가 펜스 하나로 감싸였으면 그 안쪽만 쓴다 (언어 태그도 버린다).
 * - 펜스가 여러 개면 **건드리지 않는다**: 코드 안에 진짜 펜스가 있는 경우
 *   (마크다운 파일·문서 문자열)를 지워 버리는 것이 더 나쁘다.
 * - 앞뒤 빈 줄은 걷되 **들여쓰기는 안 건드린다** — 첫 줄의 공백이 곧 위치다.
 */
export function extractCode(raw: string): string {
  const text = raw.replace(/\r\n/g, "\n");
  const trimmed = text.replace(/^\n+/, "").replace(/\s+$/, "");
  const fenceCount = (trimmed.match(/^\s*```/gm) ?? []).length;
  if (fenceCount === 2) {
    const open = /^[ \t]*```[^\n]*\n/.exec(trimmed);
    const close = /\n[ \t]*```[ \t]*$/.exec(trimmed);
    if (open && close && open[0].length <= close.index) {
      return trimmed.slice(open[0].length, close.index);
    }
  }
  return trimmed;
}

/**
 * 원문의 **끝 개행 유무**에 제안을 맞춘다.
 *
 * 선택이 개행으로 끝나지 않는데 제안이 끝나면 빈 줄이 하나 생기고, 반대면 다음
 * 줄이 붙어 올라온다. 둘 다 모델의 실수지 사용자의 뜻이 아니다.
 */
export function matchTrailingNewline(original: string, proposal: string): string {
  const originalEndsWithNewline = original.endsWith("\n");
  const body = proposal.replace(/\n+$/, "");
  return originalEndsWithNewline ? body + "\n" : body;
}

/** 잘라 낸 앞 문맥 — 선택 **직전** `CONTEXT_LINES` 줄. */
export function contextBefore(text: string, lines = CONTEXT_LINES): string {
  return text.split("\n").slice(-lines).join("\n");
}

/** 잘라 낸 뒤 문맥 — 선택 **직후** `CONTEXT_LINES` 줄. */
export function contextAfter(text: string, lines = CONTEXT_LINES): string {
  return text.split("\n").slice(0, lines).join("\n");
}
