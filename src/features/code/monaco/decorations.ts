// 거터 — HEAD 대비 줄 변경(git).
//
// CodeMirror 판은 `gitGutter.ts` 확장이었다. Monaco 는 **데코레이션**으로
// 표현한다: `linesDecorationsClassName` (줄번호 왼쪽 얇은 띠).
// (중단점 거터는 2026-10-24 디버거와 함께 걷었다.)

import type * as MonacoNs from "monaco-editor/editor/editor.api";
import type { GitLineChange } from "@/lib/bindings";

type Monaco = typeof MonacoNs;

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

