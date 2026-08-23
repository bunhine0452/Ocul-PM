/**
 * 문제 해결 문서 편집기의 **순수** 마크다운 수술 모듈.
 *
 * CodeMirror 는 여기서 나온 `EditOp` 를 트랜잭션 하나로 반영만 한다 — 에디터
 * 인스턴스를 모르는 순수 함수라 단위 테스트가 그대로 계약서가 된다.
 *
 * ## 왜 섹션 판별이 여기 또 있나
 *
 * 파서(`src-tauri/src/oculpm/discussion/parse.rs::section_of`)가 인식하는
 * `## ` 제목은 여섯 종뿐이고, **그 밖의 제목 아래 본문은 읽기 화면 투영에서
 * 통째로 버려진다**. 편집 중에 그걸 모르면 사용자는 열심히 쓴 문단이 저장 후
 * 사라지는 걸 본다. 그래서 같은 키워드 표를 프런트에도 두고 편집기에서 미리
 * 경고한다 (`unknownSections`). 두 벌이 갈리면 경고가 틀려질 뿐 데이터는 안
 * 깨진다 — 파서가 진실이다.
 */

/** 한 번의 트랜잭션으로 반영할 교체 + 반영 후 선택 범위. */
export interface EditOp {
  from: number;
  to: number;
  insert: string;
  selFrom: number;
  selTo: number;
}

export type SectionKind =
  | "problem"
  | "background"
  | "options"
  | "log"
  | "conclusion"
  | "next"
  | "unknown";

/**
 * `parse.rs::section_of` 의 키워드 표 — **판정 순서까지** 같아야 한다.
 *
 * 여기 한글은 화면에 그리는 문구가 아니라 디스크 문서의 제목을 **판별**하는
 * 검색어다 (03-i18n.md §5 의 "검색 별칭" 예외).
 */
// i18n-ignore-next-line -- 파서 키워드(검색 별칭), 표시 문자열 아님
const PROBLEM_WORDS = ["문제", "problem"];
// i18n-ignore-next-line -- 위 사유
const BACKGROUND_WORDS = ["배경", "조사", "자료", "background", "research"];
// i18n-ignore-next-line -- 위 사유
const OPTION_WORDS = ["방안", "후보", "option", "solution"];
// i18n-ignore-next-line -- 위 사유
const LOG_WORDS = ["토의", "메모", "discussion", "memo", "log"];
// i18n-ignore-next-line -- 위 사유
const CONCLUSION_WORDS = ["결론", "conclusion"];
// i18n-ignore-next-line -- 위 사유
const NEXT_WORDS = ["다음", "next"];

const ORDER: [SectionKind, string[]][] = [
  ["problem", PROBLEM_WORDS],
  ["background", BACKGROUND_WORDS],
  ["options", OPTION_WORDS],
  ["log", LOG_WORDS],
  ["conclusion", CONCLUSION_WORDS],
  ["next", NEXT_WORDS],
];

export const LOG_BEGIN = "<!-- oculpm:discussion-log begin v1 -->";
export const LOG_END = "<!-- oculpm:discussion-log end -->";

/** `## ` 제목 텍스트 → 섹션 종류. 인식 못 하면 `"unknown"`. */
export function sectionOf(heading: string): SectionKind {
  const h = heading.trim();
  const lower = h.toLowerCase();
  for (const [kind, words] of ORDER) {
    if (words.some((w) => (/[a-z]/.test(w) ? lower.includes(w) : h.includes(w)))) return kind;
  }
  return "unknown";
}

interface HeadingRef {
  /** 줄 번호 (0-base). */
  line: number;
  /** `## ` 를 뗀 제목 텍스트. */
  text: string;
  kind: SectionKind;
}

function lineStarts(doc: string): number[] {
  const starts = [0];
  for (let i = 0; i < doc.length; i++) if (doc[i] === "\n") starts.push(i + 1);
  return starts;
}

function headings(lines: string[]): HeadingRef[] {
  const out: HeadingRef[] = [];
  lines.forEach((raw, line) => {
    const trimmed = raw.trim();
    // `### ` 는 후보안 제목이라 여기 걸리면 안 된다.
    if (!trimmed.startsWith("## ") || trimmed.startsWith("### ")) return;
    out.push({ line, text: trimmed.slice(3).trim(), kind: sectionOf(trimmed.slice(3)) });
  });
  return out;
}

/**
 * 파서가 못 알아보는 `## ` 제목들 — 이 아래 본문은 읽기 화면에 안 나온다.
 * 편집기가 이 목록을 경고 띠로 보여 준다.
 */
export function unknownSections(doc: string): string[] {
  return headings(doc.split("\n"))
    .filter((h) => h.kind === "unknown" && h.text.length > 0)
    .map((h) => h.text);
}

/** 문서에 실제로 있는 섹션 제목 (편집기 섹션 이동용). */
export function outlineOf(doc: string): { text: string; line: number; kind: SectionKind }[] {
  return headings(doc.split("\n")).filter((h) => h.text.length > 0);
}

/** 이미 쓰인 `{#opt-…}` 다음의 빈 알파벳 id (`opt-a` → `opt-b` → …). */
export function nextOptionId(doc: string): string {
  const taken = new Set<string>();
  for (const m of doc.matchAll(/\{#(opt-[a-z0-9-]+)\}/gi)) taken.add(m[1].toLowerCase());
  for (let i = 0; i < 26; i++) {
    const id = `opt-${String.fromCharCode(97 + i)}`;
    if (!taken.has(id)) return id;
  }
  for (let n = 1; ; n++) {
    const id = `opt-${n}`;
    if (!taken.has(id)) return id;
  }
}

/** 이미 쓰인 `{#next-N}` 다음 번호. */
export function nextStepId(doc: string): string {
  let max = 0;
  for (const m of doc.matchAll(/\{#next-(\d+)\}/g)) max = Math.max(max, Number(m[1]));
  return `next-${max + 1}`;
}

/** `2026-06-29T14:03:00+09:00` — 문서 로그 표가 쓰는 로컬 ISO(오프셋 포함). */
export function localIsoWithOffset(d: Date): string {
  const p = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` +
    `${sign}${p(off / 60)}:${p(off % 60)}`
  );
}

// ── 선택 영역 조작 ────────────────────────────────────────────────────────

/**
 * 선택을 `left…right` 로 감싼다. 이미 감싸여 있으면 벗긴다(토글). 선택이
 * 비어 있으면 마커만 넣고 커서를 그 사이에 둔다.
 */
export function wrapOp(doc: string, from: number, to: number, left: string, right = left): EditOp {
  const sel = doc.slice(from, to);
  // 안쪽이 이미 마커인 경우(`**굵게**` 를 통째로 선택) → 벗긴다.
  if (sel.startsWith(left) && sel.endsWith(right) && sel.length >= left.length + right.length) {
    const inner = sel.slice(left.length, sel.length - right.length);
    return { from, to, insert: inner, selFrom: from, selTo: from + inner.length };
  }
  // 바깥이 마커인 경우(마커 안쪽 텍스트만 선택) → 마커째 지운다.
  const outerFrom = from - left.length;
  const outerTo = to + right.length;
  if (
    outerFrom >= 0 &&
    outerTo <= doc.length &&
    doc.slice(outerFrom, from) === left &&
    doc.slice(to, outerTo) === right
  ) {
    return {
      from: outerFrom,
      to: outerTo,
      insert: sel,
      selFrom: outerFrom,
      selTo: outerFrom + sel.length,
    };
  }
  const insert = `${left}${sel}${right}`;
  return { from, to, insert, selFrom: from + left.length, selTo: from + left.length + sel.length };
}

/**
 * 선택이 걸친 모든 줄 앞에 접두사를 붙인다(전부 붙어 있으면 뗀다).
 * `prefix` 가 함수면 줄 순번(0-base)을 받아 번호 목록을 만들 수 있다.
 */
export function linePrefixOp(
  doc: string,
  from: number,
  to: number,
  prefix: string | ((i: number) => string),
): EditOp {
  const starts = lineStarts(doc);
  const lines = doc.split("\n");
  const lineAt = (pos: number) => {
    let idx = 0;
    for (let i = 0; i < starts.length; i++) if (starts[i] <= pos) idx = i;
    return idx;
  };
  const firstLine = lineAt(from);
  const lastLine = Math.max(firstLine, lineAt(to));
  const blockFrom = starts[firstLine];
  const blockTo = starts[lastLine] + lines[lastLine].length;
  const target = lines.slice(firstLine, lastLine + 1);
  const at = (i: number) => (typeof prefix === "string" ? prefix : prefix(i));
  const allPrefixed = target.every((l, i) => l.startsWith(at(i)));
  const next = target.map((l, i) => (allPrefixed ? l.slice(at(i).length) : `${at(i)}${l}`));
  const insert = next.join("\n");
  return {
    from: blockFrom,
    to: blockTo,
    insert,
    selFrom: blockFrom,
    selTo: blockFrom + insert.length,
  };
}

/** `[선택](url)` — url 자리를 선택 상태로 남겨 바로 타이핑하게 한다. */
export function linkOp(doc: string, from: number, to: number, urlPlaceholder: string): EditOp {
  const sel = doc.slice(from, to);
  const insert = `[${sel}](${urlPlaceholder})`;
  const urlFrom = from + sel.length + 3;
  return { from, to, insert, selFrom: urlFrom, selTo: urlFrom + urlPlaceholder.length };
}

// ── 섹션에 블록 넣기 ──────────────────────────────────────────────────────

/** 섹션 본문이 끝나는 지점(다음 `## ` 직전, 뒤쪽 빈 줄 제외)의 오프셋. */
function sectionEnd(doc: string, kind: SectionKind): number | null {
  const lines = doc.split("\n");
  const starts = lineStarts(doc);
  const hs = headings(lines);
  const idx = hs.findIndex((h) => h.kind === kind);
  if (idx < 0) return null;
  const from = hs[idx].line;
  const until = idx + 1 < hs.length ? hs[idx + 1].line : lines.length;
  let last = from;
  for (let i = from + 1; i < until; i++) if (lines[i].trim() !== "") last = i;
  return starts[last] + lines[last].length;
}

interface InsertOpts {
  /** 섹션이 없을 때 문서 끝에 새로 만들 `## ` 제목. */
  heading: string;
  /** 삽입 후 선택해 둘 스니펫 내부 문자열 (자리표시자). */
  selectText?: string;
}

/**
 * 스니펫을 해당 섹션 끝에 붙인다. 섹션이 없으면 문서 끝에 제목과 함께 만든다
 * (파서가 알아보는 제목이어야 하므로 호출자가 사전에서 가져와 넘긴다).
 */
export function insertInSectionOp(
  doc: string,
  kind: SectionKind,
  snippet: string,
  { heading, selectText }: InsertOpts,
): EditOp {
  const end = sectionEnd(doc, kind);
  const pos = end ?? doc.length;
  const insert =
    end == null
      ? `${doc.endsWith("\n") || doc.length === 0 ? "" : "\n"}\n## ${heading}\n\n${snippet}\n`
      : `\n\n${snippet}`;
  const rel = selectText ? insert.indexOf(selectText) : -1;
  const selFrom = rel >= 0 ? pos + rel : pos + insert.length;
  return {
    from: pos,
    to: pos,
    insert,
    selFrom,
    selTo: rel >= 0 ? selFrom + selectText!.length : selFrom,
  };
}

interface LogRowInput {
  author: string;
  ts: string;
  body: string;
  /** 로그 섹션이 없을 때 만들 `## ` 제목. */
  heading: string;
  /** 표 헤더 3열 (시각/작성자/내용) — 빈 블록에 처음 쓸 때만 쓰인다. */
  columns: readonly [string, string, string];
}

/**
 * 토의 로그 managed block 에 한 줄 append. 규격상 **기존 행은 건드리지 않는다**.
 * 블록이 없으면 로그 섹션에(그것도 없으면 문서 끝에) 블록째 만든다.
 */
export function appendLogRowOp(doc: string, input: LogRowInput): EditOp {
  // 표 셀 구분자와 줄바꿈은 한 행을 깨뜨린다 — 쓰기 측에서 순화한다.
  const body = input.body.replace(/\|/g, "\\|").replace(/\s*\n+\s*/g, " ").trim();
  // 앞부분을 따로 두는 이유: 편집기에서 빈 메모를 꽂을 때 커서가 **내용 칸**에
  // 놓여야 바로 타이핑이 된다 (행 끝에 두면 파이프 뒤에서 시작한다).
  const prefix = `| ${input.ts} | ${input.author} | `;
  const row = `${prefix}${body} |`;
  const [c0, c1, c2] = input.columns;
  const endIdx = doc.indexOf(LOG_END);
  if (endIdx < 0) {
    const block = `${LOG_BEGIN}\n| ${c0} | ${c1} | ${c2} |\n|---|---|---|\n${row}\n${LOG_END}`;
    return insertInSectionOp(doc, "log", block, { heading: input.heading });
  }
  // 블록에 표 헤더가 아직 없으면 함께 넣는다 (골격은 빈 블록으로 생성된다).
  const beginIdx = doc.indexOf(LOG_BEGIN);
  const inner = beginIdx >= 0 ? doc.slice(beginIdx + LOG_BEGIN.length, endIdx) : "";
  const header = /\|\s*-{2,}/.test(inner) ? "" : `| ${c0} | ${c1} | ${c2} |\n|---|---|---|\n`;
  const insert = `${header}${row}\n`;
  const caret = endIdx + header.length + prefix.length + body.length;
  return { from: endIdx, to: endIdx, insert, selFrom: caret, selTo: caret };
}
