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
