import { Text } from "@codemirror/state";
import type { Diagnostic as CmDiagnostic } from "@codemirror/lint";
import type { LspDiagnostic, LspCompletionItem } from "@/lib/bindings";

// LSP ↔ CodeMirror 좌표 변환. **버그가 사는 곳이라 순수 함수로 떼어 둔다.**
//
// 두 좌표계의 차이는 딱 두 가지다:
//   - LSP: 0-based 줄 + UTF-16 코드 유닛 문자 위치
//   - CM6: 1-based 줄, 그리고 진단은 문서 시작부터의 **오프셋**
//
// 다행히 단위는 같다 — CM6 의 Text 는 JS 문자열이라 오프셋이 UTF-16 코드
// 유닛이고, LSP 의 기본 인코딩도 UTF-16 이다. 그래서 줄 번호 ±1 과 오프셋
// 환산만 하면 되고, 인코딩 변환은 **하지 않는다** (백엔드도 통과만 시킨다 —
// docs/lsp/00-master-plan.md §위치 인코딩).

/**
 * 언어 서버가 붙는 확장자.
 *
 * **`src-tauri/src/lsp/registry.rs` 의 `spec_for_path` 와 같은 집합이어야 한다.**
 * 프런트가 이 목록을 따로 드는 이유는 CM6 확장 구성이 **마운트 시점 1회**라
 * 서버 부착 여부를 그때 알아야 하기 때문이다 (나중에 알면 재마운트해야 하고,
 * 그러면 커서가 튄다). 양쪽 목록은 각자의 테스트가 이 상수와 대조해 잠근다 —
 * `lsp_bridge.test.ts` 와 `registry::tests::extension_coverage_matches_frontend`.
 *
 * 목록에 없는 파일은 CM6 언어 모드의 기본 자동완성을 그대로 쓴다 (CSS 속성
 * 완성 등) — override 를 걸면 그게 사라진다.
 */
export const LSP_EXTENSIONS: readonly string[] = [
  "rs",
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "pyi",
  "go",
];

/** 이 경로에 언어 서버가 붙는가. */
export function hasLanguageServer(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  // 확장자가 없는 파일(`Makefile`)은 `pop()` 이 파일명 전체를 준다 — `.` 이
  // 없으면 대상이 아니다.
  if (!path.includes(".")) return false;
  return LSP_EXTENSIONS.includes(ext);
}

/** LSP 위치(0-based) → 문서 오프셋. 범위를 벗어나면 가장 가까운 곳으로 접는다. */
export function offsetOf(doc: Text, line: number, character: number): number {
  // 편집 직후 도착한 오래된 진단은 문서 밖을 가리킬 수 있다 — 던지는 대신 접는다.
  const lineNo = Math.min(Math.max(line + 1, 1), doc.lines);
  const l = doc.line(lineNo);
  return Math.min(l.from + Math.max(character, 0), l.to);
}

/** 문서 오프셋 → LSP 위치(0-based). 커서에서 완성을 요청할 때 쓴다. */
export function positionOf(doc: Text, offset: number): { line: number; character: number } {
  const clamped = Math.min(Math.max(offset, 0), doc.length);
  const l = doc.lineAt(clamped);
  return { line: l.number - 1, character: clamped - l.from };
}

const SEVERITY: Record<LspDiagnostic["severity"], CmDiagnostic["severity"]> = {
  error: "error",
  warning: "warning",
  info: "info",
  hint: "hint",
};

/**
 * LSP 진단 → CM6 진단.
 *
 * 길이 0 짜리 범위는 **한 글자로 넓힌다**. 서버는 "이 지점" 을 start==end 로
 * 표현하는데, CM6 는 from==to 면 그릴 밑줄이 없어 진단이 조용히 사라진다.
 */
export function toCmDiagnostics(doc: Text, items: readonly LspDiagnostic[]): CmDiagnostic[] {
  return items.map((d) => {
    const from = offsetOf(doc, d.start_line, d.start_character);
    let to = offsetOf(doc, d.end_line, d.end_character);
    if (to <= from) to = Math.min(from + 1, doc.length);
    return {
      from,
      to,
      severity: SEVERITY[d.severity] ?? "warning",
      message: d.message,
      source: d.source ?? undefined,
    };
  });
}

/**
 * 완성 항목 → CM6 형태.
 *
 * `sortText` 를 `boost` 로 옮기지 않고 **배열 순서를 그대로 존중**한다. 서버가
 * 이미 문맥으로 정렬해 줬는데(rust-analyzer 는 타입이 맞는 후보를 앞으로 올린다)
 * CM6 가 알파벳순으로 다시 섞으면 그 지능이 사라진다. 앞에서부터 감소하는
 * boost 를 주어 원래 순서를 고정한다.
 */
export function toCmCompletions(items: readonly LspCompletionItem[]) {
  return items.map((item, i) => ({
    label: item.label,
    detail: item.detail ?? undefined,
    type: item.kind ?? undefined,
    apply: item.insert_text ?? undefined,
    // CM6 boost 는 -99..99 — 상한을 넘기면 무시되므로 앞 199개까지만 순서가 산다.
    boost: Math.max(99 - i, -99),
  }));
}

export type HoverSegment =
  | { kind: "code"; text: string; lang: string | null }
  | { kind: "text"; text: string };

/**
 * 호버 마크다운을 코드 블록과 산문으로 가른다.
 *
 * 전체 마크다운 렌더러를 붙이지 않는 이유: 호버 내용은 **거의 전부 코드 펜스와
 * 짧은 산문**이고(rust-analyzer 는 시그니처 블록 + 문서), CM6 툴팁 안에서
 * React 를 그리려면 포털이 필요하다. 여기서 필요한 구별은 "고정폭으로 그릴
 * 것인가" 하나뿐이라 그것만 판별한다.
 *
 * `---` 구분선은 버린다 — 툴팁 안에서 가로줄은 자리만 먹는다.
 */
export function parseHover(markdown: string): HoverSegment[] {
  const out: HoverSegment[] = [];
  let buf: string[] = [];
  let code: string[] | null = null;
  let lang: string | null = null;

  const flushText = () => {
    const text = buf.join("\n").trim();
    // `---` 만 남은 덩어리는 버린다.
    if (text && !/^-{3,}$/.test(text)) out.push({ kind: "text", text });
    buf = [];
  };

  for (const line of markdown.split("\n")) {
    const fence = /^\s*```(.*)$/.exec(line);
    if (fence) {
      if (code == null) {
        flushText();
        lang = fence[1].trim() || null;
        code = [];
      } else {
        const text = code.join("\n").trim();
        if (text) out.push({ kind: "code", text, lang });
        code = null;
        lang = null;
      }
      continue;
    }
    if (code != null) code.push(line);
    else if (/^\s*-{3,}\s*$/.test(line)) flushText(); // 구분선 = 문단 경계
    else buf.push(line);
  }
  // 닫히지 않은 펜스 — 서버가 잘린 내용을 줬어도 보여준다.
  if (code != null) {
    const text = code.join("\n").trim();
    if (text) out.push({ kind: "code", text, lang });
  } else {
    flushText();
  }
  return out;
}

/**
 * 커서가 놓인 식별자 (줄 텍스트 + 열 기준).
 *
 * 이름 바꾸기 입력창의 초깃값이 된다 — 빈 칸에서 시작하면 사용자가 옛 이름을
 * 다시 타이핑해야 한다. 커서가 식별자 **바로 뒤**(`foo|`)여도 잡는다: F2 를
 * 누르는 가장 흔한 자리다.
 */
export function wordAtColumn(lineText: string, column: number): string {
  const col = Math.min(Math.max(column, 0), lineText.length);
  let start = col;
  let end = col;
  while (start > 0 && /[\w$]/.test(lineText[start - 1])) start--;
  while (end < lineText.length && /[\w$]/.test(lineText[end])) end++;
  return lineText.slice(start, end);
}

/**
 * 완성을 띄울 자리인가.
 *
 * CM6 의 기본 `matchBefore` 만 쓰면 `.` 이나 `::` 직후(단어가 0글자)에 아무것도
 * 안 뜬다 — 멤버 완성이 가장 필요한 순간이 바로 거기다. 단어 문자 또는 트리거
 * 문자 뒤라면 연다.
 */
export function completionStart(textBefore: string, explicit: boolean): number | null {
  if (explicit) return textBefore.length;
  const word = /[\w$]+$/.exec(textBefore);
  if (word) return textBefore.length - word[0].length;
  // 트리거 문자 — `.` `::` `->` 는 멤버/경로 완성의 신호다.
  if (/(\.|::|->)$/.test(textBefore)) return textBefore.length;
  return null;
}
