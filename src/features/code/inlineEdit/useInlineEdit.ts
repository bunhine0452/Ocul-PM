// ⌘K 인라인 편집의 **배선** — Monaco 위젯 · 편집 반영 · 데코레이션.
//
// 계산은 전부 옆의 순수 모듈(`prompt.ts` · `hunks.ts`)이 한다. 여기 있는 것은
// "그 결과를 편집기에 놓는 일" 뿐이다.
//
// 모델 호출은 **부모가 한다** (`onRun`). `onComplete`·`onHover`·`onFormat` 과
// 같은 규약이다 — 프로바이더·모델·폴백 체인·설정은 CodePane 위쪽의 사정이고,
// 편집기가 그걸 알기 시작하면 이 컴포넌트가 화면 절반을 알게 된다.

import { useCallback, useMemo, useRef, useState } from "react";

import type * as MonacoNs from "monaco-editor/editor/editor.api";
import monaco from "../monaco/setup";
import {
  buildMessages,
  contextAfter,
  contextBefore,
  extractCode,
  matchTrailingNewline,
  type ChatMessage,
} from "./prompt";
import { compose, joinLines, prepare, type Hunk } from "./hunks";
import type { DiffLine } from "@/features/chat/lineDiff";

type Editor = MonacoNs.editor.IStandaloneCodeEditor;

/** 부모가 모델을 부르는 자리. 실패는 던진다 (화면이 문구를 만든다). */
export type RunInlineEdit = (messages: ChatMessage[]) => Promise<string>;

export interface InlineEditAccepted {
  added: number;
  removed: number;
}

export type InlinePhase =
  | { kind: "closed" }
  | { kind: "prompt" }
  | { kind: "running" }
  | { kind: "error"; message: string }
  | { kind: "review"; hunks: Hunk[]; accepted: boolean[] }
  | { kind: "same" };

interface Options {
  path: string;
  languageId: string;
  onRun?: RunInlineEdit;
  onAccepted?: (info: InlineEditAccepted) => void;
}

/** 되돌리기에 필요한 것 전부 — 원문과 그것이 놓였던 자리. */
interface Session {
  editor: Editor;
  /** 1-based 시작 줄 (열은 늘 1 — 줄 단위로만 다룬다). */
  startLine: number;
  /** 지금 본문이 차지한 마지막 줄 (조각을 켜고 끌 때마다 갱신). */
  endLine: number;
  original: string;
  diff: DiffLine[];
  /** 조각 수 — 되돌릴 때 "전부 끔" 배열의 길이가 이것이어야 뜻이 분명하다. */
  hunkCount: number;
}

export function useInlineEdit({ path, languageId, onRun, onAccepted }: Options) {
  const [phase, setPhase] = useState<InlinePhase>({ kind: "closed" });
  const sessionRef = useRef<Session | null>(null);
  const decoRef = useRef<MonacoNs.editor.IEditorDecorationsCollection | null>(null);
  const widgetRef = useRef<MonacoNs.editor.IContentWidget | null>(null);
  // 위젯의 DOM 은 React 밖에서 살아야 한다 — Monaco 가 직접 붙였다 뗀다.
  const nodeRef = useRef<HTMLDivElement | null>(null);
  if (!nodeRef.current && typeof document !== "undefined") {
    nodeRef.current = document.createElement("div");
    nodeRef.current.className = "code-ai-widget";
  }

  const detach = useCallback(() => {
    const session = sessionRef.current;
    if (session && widgetRef.current) session.editor.removeContentWidget(widgetRef.current);
    widgetRef.current = null;
    decoRef.current?.clear();
    decoRef.current = null;
    sessionRef.current = null;
  }, []);

  const close = useCallback(() => {
    detach();
    setPhase({ kind: "closed" });
  }, [detach]);

  /** 지금 본문을 조각 상태대로 다시 써 넣고, 받은 조각을 칠한다. */
  const render = useCallback((accepted: boolean[]) => {
    const session = sessionRef.current;
    const model = session?.editor.getModel();
    if (!session || !model) return;
    const { lines, spans } = compose(session.diff, accepted);
    const text = joinLines(lines, session.original);
    const range = new monaco.Range(
      session.startLine,
      1,
      session.endLine,
      model.getLineMaxColumn(session.endLine),
    );
    session.editor.executeEdits("oculpm.inlineEdit", [{ range, text, forceMoveMarkers: true }]);
    session.endLine = session.startLine + Math.max(lines.length, 1) - 1;

    decoRef.current?.set(
      spans
        .filter((s): s is { start: number; end: number } => s != null)
        .map((s) => ({
          range: new monaco.Range(session.startLine + s.start, 1, session.startLine + s.end, 1),
          options: { isWholeLine: true, className: "code-ai-line" },
        })),
    );
  }, []);

  /** ⌘K — 선택(없으면 커서 줄)을 잡고 입력창을 연다. */
  const open = useCallback(
    (editor: Editor) => {
      const model = editor.getModel();
      if (!model || !onRun) return;
      const sel = editor.getSelection();
      // 선택이 없으면 **커서 줄**이 대상이다. 빈 선택으로 물어봐야 모델이 답할
      // 것이 없고, 그렇다고 아무 일도 안 하면 키가 죽은 것처럼 보인다.
      const startLine = sel?.startLineNumber ?? 1;
      // 끝이 **열 1** 이면 그 줄은 선택에 안 들어간다 (아래로 드래그하면 늘
      // 다음 줄 머리에서 멈춘다 — VS Code 의 줄 단위 연산과 같은 판정).
      const endLine =
        sel && !sel.isEmpty()
          ? sel.endColumn === 1 && sel.endLineNumber > sel.startLineNumber
            ? sel.endLineNumber - 1
            : sel.endLineNumber
          : startLine;

      detach();
      sessionRef.current = {
        editor,
        startLine,
        endLine,
        original: model.getValueInRange(
          new monaco.Range(startLine, 1, endLine, model.getLineMaxColumn(endLine)),
        ),
        diff: [],
        hunkCount: 0,
      };
      decoRef.current = editor.createDecorationsCollection([]);

      const node = nodeRef.current!;
      const widget: MonacoNs.editor.IContentWidget = {
        getId: () => "oculpm.inlineEdit.widget",
        getDomNode: () => node,
        // 선택 **위**를 먼저 노린다 — 아래에 붙으면 고쳐질 코드를 가린다.
        getPosition: () => ({
          position: { lineNumber: sessionRef.current?.startLine ?? startLine, column: 1 },
          preference: [
            monaco.editor.ContentWidgetPositionPreference.ABOVE,
            monaco.editor.ContentWidgetPositionPreference.BELOW,
          ],
        }),
      };
      widgetRef.current = widget;
      editor.addContentWidget(widget);
      setPhase({ kind: "prompt" });
    },
    [detach, onRun],
  );

  /** 지시를 보내고 제안을 본문에 앉힌다. */
  const submit = useCallback(
    async (instruction: string) => {
      const session = sessionRef.current;
      const model = session?.editor.getModel();
      if (!session || !model || !onRun || !instruction.trim()) return;
      setPhase({ kind: "running" });

      const before = model.getValueInRange(
        new monaco.Range(1, 1, session.startLine, 1),
      );
      const lastLine = model.getLineCount();
      // 선택이 문서 끝이면 뒤 문맥은 **없다**. 클램프해서 마지막 줄을 다시
      // 집으면 선택된 줄이 문맥으로 한 번 더 실린다.
      const after =
        session.endLine >= lastLine
          ? ""
          : model.getValueInRange(
              new monaco.Range(session.endLine + 1, 1, lastLine, model.getLineMaxColumn(lastLine)),
            );

      let raw: string;
      try {
        raw = await onRun(
          buildMessages({
            path,
            languageId,
            selection: session.original,
            before: contextBefore(before),
            after: contextAfter(after),
            instruction,
          }),
        );
      } catch (e) {
        setPhase({ kind: "error", message: e instanceof Error ? e.message : String(e) });
        return;
      }
      // 도중에 닫혔으면(Esc·파일 전환) 결과를 버린다 — 늦게 온 답이 남의
      // 문서를 고치면 안 된다.
      if (sessionRef.current !== session) return;

      const proposal = matchTrailingNewline(session.original, extractCode(raw));
      const { diff, hunks, accepted } = prepare(session.original, proposal);
      if (hunks.length === 0) {
        setPhase({ kind: "same" });
        return;
      }
      session.diff = diff;
      session.hunkCount = hunks.length;
      render(accepted);
      setPhase({ kind: "review", hunks, accepted });
    },
    [languageId, onRun, path, render],
  );

  /** 조각 하나를 켜고 끈다 — 본문이 즉시 다시 계산된다. */
  const toggle = useCallback(
    (index: number) => {
      // 업데이터 안에서 편집기를 고치지 않는다 — React 가 그 함수를 두 번 부를
      // 수 있고, 그러면 같은 편집이 두 번 나간다.
      if (phase.kind !== "review") return;
      const accepted = phase.accepted.map((v, i) => (i === index ? !v : v));
      render(accepted);
      setPhase({ ...phase, accepted });
    },
    [phase, render],
  );

  /** 받는다 — 데코레이션만 걷고 본문은 그대로 둔다. */
  const accept = useCallback(() => {
    if (phase.kind === "review") {
      const taken = phase.hunks.filter((_, i) => phase.accepted[i]);
      onAccepted?.({
        added: taken.reduce((n, h) => n + h.added.length, 0),
        removed: taken.reduce((n, h) => n + h.removed.length, 0),
      });
    }
    detach();
    setPhase({ kind: "closed" });
  }, [detach, onAccepted, phase]);

  /** 버린다 — 조각을 전부 끄고 원문을 되돌린 뒤 닫는다. */
  const discard = useCallback(() => {
    const session = sessionRef.current;
    if (session && session.hunkCount > 0) {
      render(new Array<boolean>(session.hunkCount).fill(false));
    }
    close();
  }, [close, render]);

  return useMemo(
    () => ({
      phase,
      node: nodeRef.current,
      enabled: onRun != null,
      open,
      submit,
      toggle,
      accept,
      discard,
      close,
    }),
    [accept, close, discard, onRun, open, phase, submit, toggle],
  );
}

export type InlineEditHandle = ReturnType<typeof useInlineEdit>;
