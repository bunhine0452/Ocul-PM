// 스킬 화면의 순수 헬퍼 — DOM/백엔드 없이 테스트 가능 (resolveDocsPath 패턴).

/** 신규 스킬 폴더명 규칙 — 백엔드 strict 검증(kebab-case)과 동일해야 한다. */
export function isValidSkillName(name: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(name);
}

/**
 * SKILL.md 원문을 frontmatter/본문으로 나눈다. 미리보기는 본문만 마크다운
 * 렌더하고 frontmatter 는 접이식 원문으로 보여주기 위함 (편집은 항상 전체 원문).
 */
export function splitFrontmatter(content: string): { meta: string | null; body: string } {
  if (!content.startsWith("---")) return { meta: null, body: content };
  const rest = content.slice(3);
  const end = rest.indexOf("\n---");
  if (end < 0) return { meta: null, body: content };
  const afterMeta = rest.slice(end + 4); // "\n---" 건너뜀
  const body = afterMeta.replace(/^[^\n]*\n?/, ""); // 닫는 --- 줄 잔여(개행 포함) 제거
  return { meta: rest.slice(0, end).trim(), body: body.replace(/^\n+/, "") };
}

/**
 * 쉼표로 친 키워드를 정규화한다 — trim · 빈 항목 제거 · 중복 제거 · 소문자화.
 *
 * 소문자로 접는 이유는 `context_discover` 가 소문자 비교로 색인하기 때문이다.
 * 한글은 대소문자가 없어 영향이 없다.
 */
export function parseKeywords(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const word = part.trim().toLowerCase();
    if (word) seen.add(word);
  }
  return [...seen];
}

/**
 * 새 스킬의 시드 SKILL.md. description 은 YAML 한 줄 문자열로 안전하게 인용한다.
 *
 * `keywords` 는 Osaurus 라운드 Phase 5 (`#skill-keywords`) 에서 더했다 — 능력
 * 검색은 이름·설명·키워드만 색인하므로(지시문 본문은 색인하지 않는다) 여기 적힌
 * 말이 곧 이 스킬의 도달 경로다. 비어 있으면 줄 자체를 넣지 않는다.
 */
export function skillTemplate(name: string, description: string, keywords: string[] = []): string {
  const desc = description.replace(/\s+/g, " ").trim().replace(/"/g, '\\"');
  const kw = keywords.length ? `keywords: [${keywords.map((k) => JSON.stringify(k)).join(", ")}]\n` : "";
  return `---
name: ${name}
description: "${desc}"
${kw}---

# ${name}

에이전트가 이 스킬을 발동했을 때 따를 지침을 여기에 적습니다.

## 언제 쓰는가

- ${desc || "이 스킬이 발동되는 상황을 적으세요."}

## 지침

1. 첫 번째 단계를 적으세요.
`;
}

// ── `#skill-invocation` — "이 스킬은 언제 쓰이지?" ──────────────────────────
//
// 발동 원장은 **사후**를 답한다 (걸린 적 있나, 몇 번). 사용자가 목록 앞에서
// 실제로 묻는 건 **사전**이다: 이게 언제 걸리나, 내가 불러야 하나.
//
// 앱이 새로 아는 사실은 없다 — 답은 이미 description 안에 있고, 산문이라 사람이
// 파싱해야 할 뿐이다. 그래서 여기서 하는 일은 문장을 **트리거 문장**과 나머지로
// 가르는 것뿐이다. 못 가르면 나누지 않는다 (아래 참고).

/** description 을 "무엇" 과 "언제" 로 가른 결과. */
export interface TriggerHints {
  /** 트리거로 읽히지 않는 문장들 — 이 스킬이 하는 일. */
  what: string;
  /** 트리거로 읽히는 문장들 — 언제 걸리는가. */
  when: string[];
}

/**
 * 트리거 문장의 표지. 이 저장소·플러그인 스킬의 description 은 거의 다
 * "…할 때 사용" / "Use when …" 꼴이라 표지 몇 개로 충분히 갈린다.
 *
 * 정밀하게 만들 유혹이 있지만 하지 않았다 — 잘못 가르면 사용자가 *스킬이 안 적은
 * 말*을 읽게 된다. 애매하면 안 가르는 쪽이 옳다.
 */
const TRIGGER_MARKS = [
  "때",
  "경우",
  "하거나",
  "요청",
  "사용",
  "쓴다",
  "use when",
  "use this skill",
  "triggers on",
  "when the user",
  "when you",
];

function isTriggerSentence(sentence: string): boolean {
  const lower = sentence.toLowerCase();
  return TRIGGER_MARKS.some((mark) => lower.includes(mark));
}

/**
 * 문장 나누기. 마침표 뒤에 공백(또는 끝)이 올 때만 경계로 본다 — `v2.44`,
 * `e.g.` 처럼 뒤가 붙어 오는 마침표는 문장 끝이 아니다. 정규식 lookbehind 는
 * 쓰지 않는다 (구형 WebKit 에서 조용히 깨지는 자리다).
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "\n") {
      out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
    const next = text[i + 1];
    if (".!?。".includes(ch) && (next === undefined || /\s/.test(next))) {
      out.push(buf);
      buf = "";
    }
  }
  out.push(buf);
  return out.map((s) => s.trim()).filter(Boolean);
}

/**
 * description 에서 "언제 걸리나" 를 뽑는다.
 *
 * 트리거 문장이 **하나도 없으면 나누지 않고** 전체를 `what` 으로 둔다. 그 자체가
 * 신호다 — 언제 걸리는지 안 적힌 description 은 에이전트에게도 안 걸린다.
 */
export function triggerHints(description: string): TriggerHints {
  const text = description.trim();
  if (!text) return { what: "", when: [] };
  const sentences = splitSentences(text);
  const when = sentences.filter(isTriggerSentence);
  if (when.length === 0) return { what: text, when: [] };
  return { what: sentences.filter((s) => !isTriggerSentence(s)).join(" "), when };
}
