// 규칙 탭의 순수 헬퍼 — DOM/백엔드 없이 테스트 가능 (skillsModel 패턴).
//
// Claude Code 규칙 파일(.claude/rules/*.md)의 공식 frontmatter 스키마는
// `paths: [glob…]` 하나뿐이다 (없으면 항상 로드 — 스펙: docs/claude-integration/
// 03-rules-hub-ui-spec.md §1). 편집기는 draft 원문이 SSOT 이므로, 여기 헬퍼는
// frontmatter 를 파싱해 다시 직렬화하는 대신 **paths 엔트리 행만** 치환한다 —
// 다른 키·주석·본문은 바이트 그대로 보존된다.

/** 신규 규칙 파일명 규칙 — 백엔드 strict 검증(kebab-case)과 동일해야 한다. */
export function isValidRuleName(name: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(name);
}

/** frontmatter 블록의 행 범위 (양끝 `---` 행 인덱스). 없으면 null. */
function frontmatterLineRange(lines: string[]): { open: number; close: number } | null {
  if (lines[0]?.trimEnd() !== "---") return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trimEnd() === "---") return { open: 0, close: i };
  }
  return null;
}

/** frontmatter 안 paths 엔트리의 행 범위 [start, end). 없으면 null. */
function pathsEntryRange(
  lines: string[],
  open: number,
  close: number,
): { start: number; end: number } | null {
  for (let i = open + 1; i < close; i++) {
    if (/^paths\s*:/.test(lines[i])) {
      let end = i + 1;
      while (end < close && /^\s+-/.test(lines[end])) end++;
      return { start: i, end };
    }
  }
  return null;
}

function unquote(s: string): string {
  const t = s.trim();
  if (
    (t.startsWith('"') && t.endsWith('"') && t.length >= 2) ||
    (t.startsWith("'") && t.endsWith("'") && t.length >= 2)
  ) {
    return t.slice(1, -1).replace(/\\"/g, '"').trim();
  }
  return t;
}

/**
 * draft 원문에서 `paths` 를 관대하게 읽는다 — 블록 리스트(문서 예시 형태)·
 * 인라인 배열·단일 문자열 전부 수용. frontmatter 가 없으면 빈 배열(=항상 로드).
 */
export function parseRulePaths(content: string): string[] {
  const lines = content.split("\n");
  const fm = frontmatterLineRange(lines);
  if (!fm) return [];
  const entry = pathsEntryRange(lines, fm.open, fm.close);
  if (!entry) return [];
  const out: string[] = [];
  const push = (raw: string) => {
    const v = unquote(raw);
    if (v) out.push(v);
  };
  const head = lines[entry.start].replace(/^paths\s*:\s*/, "").trim();
  if (head.startsWith("[")) {
    head
      .replace(/^\[/, "")
      .replace(/\]\s*$/, "")
      .split(",")
      .forEach(push);
  } else if (head) {
    push(head);
  }
  for (let i = entry.start + 1; i < entry.end; i++) {
    push(lines[i].replace(/^\s+-\s*/, ""));
  }
  return out;
}

/**
 * draft 의 paths 를 통째로 교체한다. 빈 배열이면 엔트리를 제거하고,
 * 그 결과 frontmatter 가 완전히 비면 블록째 걷어낸다 (항상-로드 규칙은
 * frontmatter 없는 파일이 정본 형태).
 */
export function setRulePaths(content: string, paths: string[]): string {
  const entryLines = paths.length
    ? ["paths:", ...paths.map((p) => `  - ${JSON.stringify(p)}`)]
    : [];
  const lines = content.split("\n");
  const fm = frontmatterLineRange(lines);
  if (!fm) {
    if (!entryLines.length) return content;
    return ["---", ...entryLines, "---", "", ...lines].join("\n");
  }
  const next = [...lines];
  const entry = pathsEntryRange(lines, fm.open, fm.close);
  if (entry) {
    next.splice(entry.start, entry.end - entry.start, ...entryLines);
  } else if (entryLines.length) {
    next.splice(fm.close, 0, ...entryLines);
  }
  const nfm = frontmatterLineRange(next);
  if (nfm && next.slice(nfm.open + 1, nfm.close).every((l) => l.trim() === "")) {
    next.splice(nfm.open, nfm.close - nfm.open + 1);
    if (next[0]?.trim() === "") next.shift();
  }
  return next.join("\n");
}

/** 새 규칙 시드 — paths 없으면 frontmatter 없이 생성(=항상 로드). */
export function ruleTemplate(name: string, paths: string[]): string {
  const fm = paths.length
    ? ["---", "paths:", ...paths.map((p) => `  - ${JSON.stringify(p)}`), "---", "", ""].join("\n")
    : "";
  return `${fm}# ${name}

에이전트가 지켜야 할 규칙을 여기에 적습니다.

- 첫 번째 규칙을 적으세요.
`;
}

/** CLAUDE.md 계열 슬롯의 시드 본문 (rel_path 별 안내가 다르다). */
export function claudeMdTemplate(relPath: string, global: boolean): string {
  if (global) {
    return `# 내 전역 지침

모든 프로젝트에서 Claude Code 가 세션 시작 시 항상 읽는 개인 지침입니다.

- 선호하는 코딩 스타일·언어·응답 방식을 적으세요.
`;
  }
  if (relPath === "CLAUDE.local.md") {
    return `# 개인 로컬 지침

이 프로젝트에서 나만 쓰는 지침입니다 — git 에 커밋하지 마세요 (.gitignore 권장).

- 개인 환경 경로·비공유 메모를 적으세요.
`;
  }
  return `# 프로젝트 지침

Claude Code 가 이 프로젝트에서 세션을 시작할 때 항상 읽는 파일입니다.

- 빌드/테스트 명령, 아키텍처, 컨벤션을 적으세요.
- 파일별 규칙은 .claude/rules/ 에 paths frontmatter 로 나누는 게 좋습니다.
`;
}
