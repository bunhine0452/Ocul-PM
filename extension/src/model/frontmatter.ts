// `.oculpm/` 마크다운의 머리말(---) — 확장이 읽는 칸만 줄 단위로 읽는다.
//
// YAML 파서를 싣지 않는 이유: 머리말은 MCP 서버(`journal_write` · `plan_create`)가 정해진 모양으로 쓰고,
// 확장은 스칼라 몇 개와 `files_touched` 목록만 본다. 의존성 0 이 마켓 확장의 공급망 표면을 가장 작게 둔다.

export interface Split {
  /** 머리말 본문 (--- 사이). 없으면 null. */
  fm: string | null;
  body: string;
}

export function splitFrontmatter(raw: string): Split {
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!text.startsWith("---\n")) return { fm: null, body: text };
  const end = text.indexOf("\n---", 4);
  if (end < 0) return { fm: null, body: text };
  const after = text.indexOf("\n", end + 4);
  return { fm: text.slice(4, end), body: after < 0 ? "" : text.slice(after + 1) };
}

/** `"…"` · `'…'` · 맨글자를 값으로. 큰따옴표 안의 `\"` · `\\` 는 푼다. */
export function unquote(v: string): string {
  const s = v.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\(["\\])/g, "$1");
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

/** 최상위 `key: value` 하나. 들여쓴 줄(중첩)은 보지 않는다. */
export function scalar(fm: string | null, key: string): string | null {
  if (!fm) return null;
  for (const line of fm.split("\n")) {
    if (!line.startsWith(`${key}:`)) continue;
    const v = unquote(line.slice(key.length + 1));
    return v === "" ? null : v;
  }
  return null;
}

/**
 * `files_touched:` 목록의 경로들. 서버가 쓰는 `- path: "x"` 와 사람이 쓰는 `- x` 둘 다 읽는다.
 * 목록은 다음 최상위 키(들여쓰기 없는 `key:`)에서 끝난다.
 */
export function filesTouched(fm: string | null): string[] {
  if (!fm) return [];
  const out: string[] = [];
  let inside = false;
  for (const line of fm.split("\n")) {
    if (!inside) {
      if (/^files_touched:\s*$/.test(line)) inside = true;
      continue;
    }
    if (/^[A-Za-z_][\w-]*:/.test(line)) break;
    const item = line.match(/^\s*-\s+(.*)$/);
    if (!item) continue;
    const rest = item[1];
    const path = rest.match(/^path:\s*(.+)$/);
    const value = unquote(path ? path[1] : rest);
    if (value && !/^op:/.test(value)) out.push(value);
  }
  return out;
}
