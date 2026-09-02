// 파일 내 이동 (B4) — 순수 모델.
//
// 설계 SSOT: docs/20260902_vscode-borrows/03-goto.md
// 근거: vscode/src/vs/editor/contrib/quickAccess (gotoLine · gotoSymbol)
//
// 왜 순수 모듈인가: "지금 친 글자가 줄 번호인가 심볼 이름인가" 와 심볼 정렬은
// 오버레이의 렌더와 아무 상관이 없다. 컴포넌트 안에 있으면 jsdom 이 못 보는
// 자리에서 조용히 틀린다 (saveHygiene 과 같은 잣대).

import { scoreName } from "@/features/onboarding/home/homeMatch";
import type { LspSymbol } from "@/lib/bindings";

/**
 * 입력창 하나가 두 모드를 겸한다 (VS Code 와 같은 관례).
 *
 * `line: null` 은 "줄 모드로 들어왔지만 아직 숫자를 안 쳤다" — ⌃G 가 `:` 만
 * 채워 여는 상태다. 그때 심볼 목록을 대신 보여 주면 방금 누른 키가 무엇을
 * 하려던 것이었는지 화면이 거짓말을 한다.
 */
export type GotoQuery =
  | { kind: "empty" }
  | { kind: "symbol"; needle: string }
  | { kind: "line"; line: number | null; character: number | null };

/** 정렬된 심볼 한 줄. */
export interface RankedSymbol {
  symbol: LspSymbol;
  /** 원본 목록에서의 자리 — 동점이면 문서 순서를 지킨다. */
  index: number;
  score: number;
  /** `depth` 로 유추한 상위 심볼 이름들 (바깥→안쪽). */
  container: string[];
}

/** 카멜/구분자 약어 (`hM` → `handleMutate`). 접두(100)와 단어경계(80) 사이. */
const SCORE_ABBREV = 90;

/**
 * 입력 문자열 → 질의.
 *
 * - `""` → `empty` (지금 파일의 심볼 전체)
 * - `":12"` · `":12:3"` → 줄 모드. 앞뒤 공백은 버린다.
 * - `":"` → 줄 모드, 숫자는 아직 없음
 * - `"@foo"` → 심볼 모드 (VS Code 의 `@` 접두 습관)
 * - `":abc"` → 줄 번호가 아니므로 **심볼로 되받는다** (`abc` 를 찾는다).
 *   접두를 잘못 골랐다고 결과가 0건이 되면 다시 치게 만들 뿐이다.
 */
export function parseGoto(input: string): GotoQuery {
  const raw = input.trim();
  if (!raw) return { kind: "empty" };

  if (raw.startsWith(":")) {
    const rest = raw.slice(1).trim();
    if (!rest) return { kind: "line", line: null, character: null };
    const parsed = parseLineSpec(rest);
    if (parsed) return parsed;
    return needleQuery(rest);
  }
  if (raw.startsWith("@")) return needleQuery(raw.slice(1).trim());
  // 접두 없이 숫자만 친 것도 줄로 받는다 — VS Code 는 안 그러지만, 여기서는
  // 심볼 이름이 숫자로만 된 경우가 사실상 없고 "125 ⏎" 가 더 자주 나온다.
  const parsed = parseLineSpec(raw);
  if (parsed) return parsed;
  return needleQuery(raw);
}

function needleQuery(needle: string): GotoQuery {
  return needle ? { kind: "symbol", needle } : { kind: "empty" };
}

/** `12` · `12:3` — 전부 숫자일 때만. 음수·소수·`12:` 는 줄이 아니다. */
function parseLineSpec(spec: string): GotoQuery | null {
  const m = /^(\d+)(?::(\d+))?$/.exec(spec);
  if (!m) return null;
  return {
    kind: "line",
    line: Number(m[1]),
    character: m[2] === undefined ? null : Number(m[2]),
  };
}

/**
 * 심볼 정렬. `needle` 이 비면 문서 순서 그대로 전부 돌려준다.
 *
 * 점수는 `homeMatch.scoreName` 을 그대로 쓰고(DRY — 매칭 알고리즘을 또 쓰지
 * 않는다), 심볼 이름에만 있는 규칙 하나를 얹는다: 카멜/구분자 **약어**.
 * `scoreName` 의 퍼지 규칙만으로는 `hM`(약어)이 `andle`(부분문자열)보다
 * 낮게 나오는데, 식별자를 찾을 때 사람이 실제로 치는 것은 약어 쪽이다.
 */
export function rankSymbols(symbols: LspSymbol[], needle: string): RankedSymbol[] {
  const containers = containerChains(symbols);
  const q = needle.trim();
  if (!q) {
    return symbols.map((symbol, index) => ({ symbol, index, score: 0, container: containers[index] }));
  }

  const hits: RankedSymbol[] = [];
  for (let i = 0; i < symbols.length; i += 1) {
    const score = symbolScore(symbols[i].name, q);
    if (score === null) continue;
    hits.push({ symbol: symbols[i], index: i, score, container: containers[i] });
  }
  // 동점은 문서 순서 — 같은 질의에 목록이 매번 다르게 서면 근육 기억이 안 붙는다.
  return hits.sort((a, b) => b.score - a.score || a.index - b.index);
}

function symbolScore(name: string, needle: string): number | null {
  const base = scoreName(name, needle);
  const abbrev = needle.toLowerCase().replace(/[-_./\\\s]/g, "");
  // 구분자만 친 질의(`_`)는 약어가 아니다 — 빈 접두는 모든 이름에 맞는다.
  if (abbrev && initialsOf(name).startsWith(abbrev)) return Math.max(base ?? 0, SCORE_ABBREV);
  return base;
}

/**
 * 이름의 머리글자들 — 첫 글자 + 단어 시작마다 (`handleMutate` → `hm`,
 * `parse_goto_query` → `pgq`). 구분자 뒤와 소문자→대문자 전환을 단어로 본다
 * (`homeMatch.wordStarts` 와 같은 규칙이지만 여기서는 **글자**가 필요하다).
 */
function initialsOf(name: string): string {
  let out = name.slice(0, 1).toLowerCase();
  for (let i = 1; i < name.length; i += 1) {
    const prev = name[i - 1];
    const cur = name[i];
    const afterSep = /[-_./\\\s]/.test(prev);
    const camel = prev === prev.toLowerCase() && cur !== cur.toLowerCase();
    if (afterSep || camel) out += cur.toLowerCase();
  }
  return out;
}

/**
 * 각 심볼의 상위 이름 사슬 (바깥→안쪽).
 *
 * 백엔드가 계층을 평면 목록 + `depth` 로 펴서 주므로, 상위는 **앞쪽에서
 * 처음 만나는 더 얕은 심볼**이다 — 목록이 문서 순서라 이 추정이 성립한다
 * (`CodeOutline.indexOfEnclosing` 과 같은 근거).
 */
export function containerChains(symbols: LspSymbol[]): string[][] {
  const chains: string[][] = [];
  /** depth → 그 깊이에서 마지막으로 본 이름. */
  const stack: string[] = [];
  for (const sym of symbols) {
    const depth = Math.max(0, sym.depth);
    stack.length = Math.min(stack.length, depth);
    // depth 가 건너뛰면(0 → 2) 사이가 구멍으로 남는다 — 이름만 추린다.
    chains.push(stack.filter((name) => name != null));
    stack[depth] = sym.name;
  }
  return chains;
}

/**
 * 줄 번호를 문서 범위(1..lineCount)로 접는다.
 *
 * `lineCount` 가 0 이하면 "아직 모른다" 는 뜻이다 (버퍼가 안 실렸다) — 그때는
 * 하한만 건다. 모르는 상한을 1 로 접으면 언제나 첫 줄로 뛴다.
 */
export function clampLine(line: number, lineCount: number): number {
  const n = Math.trunc(line);
  if (!Number.isFinite(n) || n < 1) return 1;
  if (lineCount < 1) return n;
  return Math.min(n, lineCount);
}

/** 본문의 줄 수. 빈 문자열도 한 줄이다 (에디터가 그렇게 센다). */
export function countLines(text: string): number {
  let n = 1;
  for (let i = 0; i < text.length; i += 1) if (text[i] === "\n") n += 1;
  return n;
}
