// 스티키 스크롤 (B7) — 순수 모델.
//
// 설계 SSOT: docs/20260902_vscode-borrows/04-sticky-scroll.md
// 근거: vscode/src/vs/editor/contrib/stickyScroll
//
// 뷰포트 첫 줄을 감싸는 상위 스코프의 **시작 줄**을 바깥→안쪽으로 모은다.
// VS Code 는 3단 폴백(심볼 → 폴딩 제공자 → 들여쓰기)이지만 우리는 2단만 쓴다:
// CM6 의 폴딩은 언어 확장마다 제각각이라 심볼과 들여쓰기 사이에서 값이 겹친다.
//
// 왜 순수 모듈인가: jsdom 에는 레이아웃이 없어 CM6 뷰포트를 흉내낼 수 없다.
// 계산을 전부 여기로 빼야 확장(`stickyScroll.ts`)이 테스트 밖에서 얇게 남는다.

/** 모델이 심볼에 대해 아는 것 전부 — `LspSymbol` 이 그대로 들어맞는다. */
export interface StickySymbol {
  /** 0-based 시작 줄. */
  line: number;
  /** 0-based 중첩 깊이. */
  depth: number;
  /** `function` · `struct` … 아이콘 색. */
  kind: string;
}

/** 겹쳐 그릴 한 줄. 본문은 **문서에서** 읽는다 (편집 뒤에도 지금 글자여야 한다). */
export interface StickyLine {
  /** 0-based 줄. */
  line: number;
  /** 심볼 종류. 들여쓰기 폴백이면 null. */
  kind: string | null;
}

/** 겹쳐 고정할 줄 수의 범위 (VS Code 의 `maxLineCount` 와 같은 기본 5). */
export const STICKY_MIN_LINES = 1;
export const STICKY_MAX_LINES = 10;

/** 설정값을 쓸 수 있는 줄 수로 접는다. 쓰레기 값은 기본 5. */
export function clampStickyMax(raw: number): number {
  if (!Number.isFinite(raw)) return 5;
  return Math.min(STICKY_MAX_LINES, Math.max(STICKY_MIN_LINES, Math.trunc(raw)));
}

/** 앵커가 될 수 없는 줄 — 빈 줄. */
function isBlank(text: string): boolean {
  return text.trim() === "";
}

/**
 * 주석만 있는 줄 — 들여쓰기 폴백에서 앵커가 되지 않는다.
 *
 * `#` 와 `--` 는 일부러 뺐다: CSS 의 `#main {`, SQL 의 `--` 처럼 언어에 따라
 * 주석이 아닌 것이 있고, 언어를 모르는 자리에서 그걸 주석으로 단정하면
 * 진짜 앵커를 버린다. 확실한 것만 건너뛴다.
 */
function isCommentOnly(text: string): boolean {
  return /^\s*(\/\/|\/\*|\*|<!--)/.test(text);
}

/** 앞쪽 공백의 시각적 폭. 탭은 다음 탭 스톱까지 (CM6·에디터 관례와 같다). */
export function indentWidth(text: string, tabSize: number): number {
  const unit = tabSize > 0 ? tabSize : 1;
  let width = 0;
  for (const ch of text) {
    if (ch === " ") width += 1;
    else if (ch === "\t") width += unit - (width % unit);
    else break;
  }
  return width;
}

/**
 * LSP 심볼 기반. `line`(0-based 뷰포트 첫 줄)을 감싸는 심볼들의 시작 줄.
 *
 * 백엔드는 시작 줄만 주므로 심볼의 범위는 **다음 형제(같거나 얕은 depth)의
 * 시작**까지로 추정한다 — 목록이 문서 순서라 이 추정이 성립한다
 * (`CodeOutline.indexOfEnclosing` 과 같은 근거). 함수 사이의 빈 줄에서
 * 앞 함수가 아직 붙어 보이는 것이 이 추정의 대가다.
 */
export function stickyFromSymbols(
  symbols: readonly StickySymbol[],
  line: number,
  max: number,
): StickyLine[] {
  if (max <= 0) return [];

  // 시작 줄이 `line` 이하인 마지막 심볼 = 가장 안쪽.
  let inner = -1;
  for (let i = 0; i < symbols.length; i += 1) {
    if (symbols[i].line > line) break;
    inner = i;
  }
  if (inner < 0) return [];

  // 거기서 depth 를 낮춰 가며 조상을 모은다 (안쪽→바깥).
  const chain: StickyLine[] = [{ line: symbols[inner].line, kind: symbols[inner].kind }];
  let depth = symbols[inner].depth;
  for (let i = inner - 1; i >= 0 && depth > 0; i -= 1) {
    if (symbols[i].depth >= depth) continue;
    depth = symbols[i].depth;
    chain.push({ line: symbols[i].line, kind: symbols[i].kind });
  }
  chain.reverse();

  // 뷰포트 첫 줄 자신은 화면에 이미 있다 — 겹쳐 그리면 같은 줄이 두 번 보인다.
  // 절단은 **안쪽부터** 버린다: 바깥 맥락(무슨 클래스인가)이 더 크다.
  return chain.filter((row) => row.line !== line).slice(0, max);
}

/**
 * 들여쓰기 기반 폴백 — 언어 서버가 없는 파일(css·md·json …).
 *
 * `lines[i]` 는 문서의 i 번째 줄(0-based). 위쪽만 훑으므로 호출자는 `line`
 * 까지만 채워 넘겨도 된다.
 */
export function stickyFromIndent(
  lines: readonly string[],
  line: number,
  max: number,
  tabSize: number,
): StickyLine[] {
  if (max <= 0 || line <= 0) return [];

  // 뷰포트 첫 줄이 비어 있으면 그 **아래** 첫 내용 줄을 기준으로 삼는다.
  // 빈 줄의 들여쓰기는 0 이라, 그걸 기준으로 쓰면 사슬이 통째로 사라진다.
  let ref = line;
  while (ref < lines.length && isBlank(lines[ref])) ref += 1;
  const refText = lines[ref] ?? lines[line] ?? "";
  let indent = indentWidth(refText, tabSize);

  const chain: StickyLine[] = [];
  for (let i = line - 1; i >= 0 && indent > 0; i -= 1) {
    const text = lines[i];
    if (text === undefined || isBlank(text) || isCommentOnly(text)) continue;
    const width = indentWidth(text, tabSize);
    // 같은 들여쓰기의 형제는 감싸지 않는다 — 더 얕아야 앵커다.
    if (width >= indent) continue;
    chain.push({ line: i, kind: null });
    indent = width;
  }
  chain.reverse();
  return chain.slice(0, max);
}
