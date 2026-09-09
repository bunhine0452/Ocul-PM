// LSP 응답의 **텍스트** 해석 — 편집기와 무관한 순수 함수들.
//
// 좌표 변환은 여기 없다. CodeMirror 는 진단을 "문서 시작부터의 오프셋" 으로
// 받아서 줄↔오프셋 환산이 필요했지만, Monaco 는 LSP 와 같은 (줄, 문자) 쌍을
// 쓰고 차이가 ±1 뿐이라 `monaco/lsp.ts` 가 그 자리에서 처리한다
// (Phase 2 `{#reclaim-lang}` — 죽은 CM 변환부와 그 타입 의존을 걷었다).
//
// 여기 남은 것은 좌표계와 무관한 판단들이다: 서버가 붙는 확장자, 호버
// 마크다운 가르기, 커서 위 식별자, 완성을 띄울 자리. 전부 **버그가 사는
// 곳**이라 순수 함수로 떼어 두고 테스트로 잠근다.

/**
 * 언어 서버가 붙는 확장자.
 *
 * **`src-tauri/src/lsp/registry.rs` 의 `spec_for_path` 와 같은 집합이어야 한다.**
 * 프런트가 이 목록을 따로 드는 이유는 편집기 배선이 **마운트 시점 1회**라
 * 서버 부착 여부를 그때 알아야 하기 때문이다 (나중에 알면 재마운트해야 하고,
 * 그러면 커서가 튄다). 양쪽 목록은 각자의 테스트가 이 상수와 대조해 잠근다 —
 * `lsp_bridge.test.ts` 와 `registry::tests::extension_coverage_matches_frontend`.
 *
 * 목록에 없는 파일에는 완성 공급자를 아예 안 단다.
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

export type HoverSegment =
  | { kind: "code"; text: string; lang: string | null }
  | { kind: "text"; text: string };

/**
 * 호버 마크다운을 코드 블록과 산문으로 가른다.
 *
 * 전체 마크다운 렌더러를 붙이지 않는 이유: 호버 내용은 **거의 전부 코드 펜스와
 * 짧은 산문**이고(rust-analyzer 는 시그니처 블록 + 문서), 편집기 툴팁 안에서
 * React 를 그리려면 포털이 필요하다. 여기서 필요한 구별은 "고정폭으로 그릴
 * 것인가" 하나뿐이라 그것만 판별한다 — Monaco 는 그것을 마크다운 펜스로 되받는다.
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
 * 편집기의 기본 접두사 판정만 쓰면 `.` 이나 `::` 직후(단어가 0글자)에 아무것도
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
