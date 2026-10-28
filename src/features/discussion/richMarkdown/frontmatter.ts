// 머리 정보(frontmatter) 떼기·붙이기 — 리치 편집기는 본문만 만진다.
//
// 머리 정보는 YAML(`---`)이나 TOML(`+++`) 블록이고, 이 앱의 일지·플랜·논의 문서에서는
// 스키마가 정해진 기계용 영역이다. 리치 편집기가 그걸 문단으로 읽으면 `---` 가
// 구분선이 되고 키가 본문이 된다. 그래서 떼어 두었다가 저장할 때 **원문 그대로**
// 앞에 붙인다. 정규식은 Orca(stablyai/orca, MIT) `markdown-frontmatter.ts` 의 것이다.

const FRONTMATTER_RE = /^(---|\+\+\+)\r?\n(?:[\s\S]*?\r?\n)?\1(?:\r?\n|$)/;

export interface SplitDoc {
  /** 구분선과 끝 줄바꿈까지 포함한 머리 정보 원문 — 없으면 빈 문자열. */
  frontmatter: string;
  body: string;
}

export function splitFrontmatter(text: string): SplitDoc {
  const m = FRONTMATTER_RE.exec(text);
  if (!m) return { frontmatter: "", body: text };
  return { frontmatter: m[0], body: text.slice(m[0].length) };
}

/** 떼어 둔 머리 정보를 본문 앞에 되붙인다 — 머리 정보는 한 글자도 바뀌지 않는다. */
export function joinFrontmatter(frontmatter: string, body: string): string {
  if (!frontmatter) return body;
  return frontmatter.endsWith("\n") ? frontmatter + body : `${frontmatter}\n${body}`;
}

/** 칩에 보일 키 목록 — `title, status, tags` 처럼. 값은 보이지 않는다. */
export function frontmatterKeys(frontmatter: string): string[] {
  return frontmatter
    .split(/\r?\n/)
    .slice(1, -1)
    .map((line) => /^([A-Za-z_][\w-]*)\s*[:=]/.exec(line)?.[1])
    .filter((k): k is string => Boolean(k));
}
