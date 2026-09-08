// 거터 두 벌 — HEAD 대비 줄 변경(git)과 중단점(DAP).
//
// CodeMirror 판은 `gitGutter.ts`(86) + `breakpointGutter.ts`(99) 두 확장이었다.
// Monaco 는 둘 다 **데코레이션**으로 표현한다: git 은 `linesDecorationsClassName`
// (줄번호 왼쪽 얇은 띠), 중단점은 `glyphMarginClassName` (줄번호 왼쪽 넓은 칸).
//
// 둘을 한 `deltaDecorations` 컬렉션에 섞지 않는다 — git 은 편집 도중에도 계속
// 갱신되고 중단점은 사용자 클릭으로만 바뀌는데, 한 컬렉션이면 한쪽 갱신이
// 다른 쪽을 지운다.

import type * as MonacoNs from "monaco-editor/editor/editor.api";
import type { GitLineChange } from "@/lib/bindings";

type Monaco = typeof MonacoNs;
type Editor = MonacoNs.editor.IStandaloneCodeEditor;

/** git 줄 변경 → 줄 데코레이션. 색은 `code.css` 의 `.mo-git-*` 가 준다. */
export function gitDecorations(
  monaco: Monaco,
  changes: readonly GitLineChange[],
  lineCount: number,
): MonacoNs.editor.IModelDeltaDecoration[] {
  const clamp = (n: number) => Math.min(Math.max(n, 1), Math.max(lineCount, 1));
  return changes.map((c) => {
    const start = clamp(c.start_line);
    // `deleted` 는 start==end 이고 "그 줄 **다음에** 지워졌다"는 뜻이다 —
    // 지워진 줄은 화면에 없으므로 한 줄짜리 표식으로 그린다.
    const end = clamp(c.kind === "deleted" ? c.start_line : c.end_line);
    return {
      range: new monaco.Range(start, 1, Math.max(end, start), 1),
      options: {
        isWholeLine: true,
        linesDecorationsClassName: `mo-git mo-git-${c.kind}`,
        // 파일을 훑을 때 어디가 바뀌었는지 미니맵에서도 보이게 한다.
        minimap: {
          position: monaco.editor.MinimapPosition.Gutter,
          color: { id: "editorGutter.modifiedBackground" },
        },
      },
    };
  });
}

/**
 * 중단점 → glyph margin 데코레이션.
 *
 * 줄 번호는 **1-based** 다 — DAP 규약이자 CodeMirror 판이 쓰던 규약과 같다.
 * 어댑터가 "못 건다"고 답한 줄은 다르게 그려서, 찍었는데 안 멈추는 이유가
 * 화면에 보이게 한다.
 */
export function breakpointDecorations(
  monaco: Monaco,
  lines: readonly number[],
  unverified: readonly number[],
  lineCount: number,
): MonacoNs.editor.IModelDeltaDecoration[] {
  const unset = new Set(unverified);
  return lines
    .filter((ln) => ln >= 1 && ln <= Math.max(lineCount, 1))
    .map((ln) => ({
      range: new monaco.Range(ln, 1, ln, 1),
      options: {
        isWholeLine: false,
        glyphMarginClassName: unset.has(ln) ? "mo-bp mo-bp-unverified" : "mo-bp",
      },
    }));
}

/**
 * glyph margin 클릭 → 중단점 토글.
 *
 * `GUTTER_GLYPH_MARGIN` 만 받는다 — 줄번호나 폴딩 화살표를 눌렀을 때도 토글되면
 * 접으려다 중단점이 찍힌다. 반환값은 해제 함수.
 */
export function wireBreakpointClicks(
  monaco: Monaco,
  editor: Editor,
  onToggle: () => (line: number) => void,
): () => void {
  const sub = editor.onMouseDown((e) => {
    if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
    const line = e.target.position?.lineNumber;
    if (line == null) return;
    onToggle()(line);
  });
  return () => sub.dispose();
}
