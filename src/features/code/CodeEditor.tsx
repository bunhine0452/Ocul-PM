// CodeMirror 6 마운트 래퍼. 마운트 후엔 **언컨트롤드**다 — 부모는 초깃값만
// 주고, 외부 갱신(디스크 리로드·파일 전환)은 key 재마운트로 처리한다. 양방향
// 동기화는 CM 트랜잭션과 React 상태가 서로를 되돌리는 고전적 버그의 근원이라
// 의도적으로 피한다.
import { useEffect, useMemo, useRef } from "react";
import { EditorView, hoverTooltip, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { basicSetup } from "codemirror";
import { indentWithTab } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { autocompletion, type CompletionContext } from "@codemirror/autocomplete";
import { lintGutter, setDiagnostics } from "@codemirror/lint";

import { langExtensionForPath } from "./codeLang";
import {
  completionStart,
  hasLanguageServer,
  parseHover,
  positionOf,
  wordAtColumn,
  toCmCompletions,
  toCmDiagnostics,
} from "./lspBridge";
import type { LspCompletionItem, LspDiagnostic, LspHover } from "@/lib/bindings";
import { t, useT } from "@/i18n";

// 테마 — 색은 전부 code.css 의 `--code-*` 변수를 참조한다. 클래스가 var() 를
// 들고 있으므로 data-theme/data-preset 전환이 리마운트 없이 즉시 반영된다.
const editorChrome = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13px",
    backgroundColor: "transparent",
    color: "var(--code-fg)",
  },
  ".cm-scroller": {
    fontFamily: "var(--mono)",
    lineHeight: "1.6",
    overflow: "auto",
  },
  ".cm-content": { caretColor: "var(--code-fg)", paddingBottom: "40vh" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--code-fg)" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--text-3)",
    border: "none",
    borderRight: "1px solid var(--sep)",
  },
  ".cm-activeLine": { backgroundColor: "var(--code-active-line)" },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--code-active-line)",
    color: "var(--text-2)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--code-selection) !important",
  },
  ".cm-selectionMatch": { backgroundColor: "var(--code-selection-match)" },
  "&.cm-focused": { outline: "none" },
  ".cm-panels": {
    backgroundColor: "var(--bg-inset)",
    color: "var(--text)",
    borderTop: "1px solid var(--sep)",
  },
  ".cm-searchMatch": { backgroundColor: "var(--code-search-match)" },
  ".cm-searchMatch-selected": { backgroundColor: "var(--code-search-current)" },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--bg-inset)",
    border: "1px solid var(--sep)",
    color: "var(--text-3)",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--bg-inset)",
    border: "1px solid var(--sep)",
    color: "var(--text)",
  },
});

const codeHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--code-kw)" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--code-str)" },
  { tag: [tags.comment, tags.blockComment, tags.lineComment], color: "var(--code-comment)", fontStyle: "italic" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--code-num)" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--code-fn)" },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.self], color: "var(--code-type)" },
  { tag: [tags.propertyName, tags.attributeName], color: "var(--code-prop)" },
  { tag: [tags.definition(tags.variableName), tags.local(tags.variableName)], color: "var(--code-def)" },
  { tag: [tags.operator, tags.punctuation, tags.bracket], color: "var(--code-op)" },
  { tag: [tags.meta, tags.processingInstruction], color: "var(--code-comment)" },
  { tag: tags.heading, fontWeight: "700", color: "var(--code-kw)" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: [tags.link, tags.url], color: "var(--accent-text)" },
  { tag: tags.invalid, color: "var(--t-bug, #e45649)" },
]);

/** CM 검색/이동 패널의 한국어 문구 — 키는 CM 이 쓰는 영어 원문이어야 한다. */
function koPhrases(): Record<string, string> {
  return {
    Find: t("code.cm.find"),
    Replace: t("code.cm.replace"),
    next: t("code.cm.next"),
    previous: t("code.cm.prev"),
    all: t("code.cm.all"),
    "match case": t("code.cm.matchCase"),
    regexp: t("code.cm.regexp"),
    "by word": t("code.cm.byWord"),
    replace: t("code.cm.replaceOne"),
    "replace all": t("code.cm.replaceAll"),
    close: t("code.cm.close"),
    "Go to line": t("code.cm.goToLine"),
    go: t("code.cm.go"),
  };
}

/**
 * CM6 완성 소스 — 커서 위치를 LSP 좌표로 옮겨 서버에 묻는다.
 *
 * `ref` 로 최신 콜백을 읽는 이유: 확장은 마운트 시 1회 구성되므로 클로저에
 * 콜백을 직접 가두면 첫 렌더의 것에 영원히 묶인다.
 */
function lspCompletionSource(
  onCompleteRef: React.MutableRefObject<CodeEditorProps["onComplete"]>,
) {
  return async (ctx: CompletionContext) => {
    const complete = onCompleteRef.current;
    if (!complete) return null;
    const line = ctx.state.doc.lineAt(ctx.pos);
    const from = completionStart(line.text.slice(0, ctx.pos - line.from), ctx.explicit);
    if (from == null) return null;

    const { line: lspLine, character } = positionOf(ctx.state.doc, ctx.pos);
    const items = await complete(lspLine, character);
    if (ctx.aborted || items.length === 0) return null;
    return {
      from: line.from + from,
      options: toCmCompletions(items),
      // 서버가 문맥으로 고른 목록이다 — CM6 가 접두사로 다시 거르면 `.` 직후처럼
      // 접두사가 빈 자리에서 후보가 통째로 사라진다.
      filter: false,
    };
  };
}

/** 호버 세그먼트를 툴팁 DOM 으로. CM6 툴팁은 React 밖이라 직접 만든다. */
function hoverDom(segments: ReturnType<typeof parseHover>): HTMLElement {
  const box = document.createElement("div");
  box.className = "cm-lsp-hover";
  for (const seg of segments) {
    if (seg.kind === "code") {
      const pre = document.createElement("pre");
      pre.textContent = seg.text;
      box.appendChild(pre);
    } else {
      const p = document.createElement("p");
      p.textContent = seg.text;
      box.appendChild(p);
    }
  }
  return box;
}

/**
 * 호버 툴팁 — 커서를 올린 자리의 타입·문서.
 *
 * `hoverTime` 을 기본(300ms)보다 늦춘다: 코드를 훑느라 마우스가 지나가는
 * 동안에도 서버에 요청이 나가면 rust-analyzer 가 그 요청들을 처리하느라
 * 진짜 필요한 완성이 밀린다.
 */
function lspHoverTooltip(onHoverRef: React.MutableRefObject<CodeEditorProps["onHover"]>) {
  return hoverTooltip(
    async (view, pos) => {
      const ask = onHoverRef.current;
      if (!ask) return null;
      const { line, character } = positionOf(view.state.doc, pos);
      const result = await ask(line, character);
      if (!result) return null;
      const segments = parseHover(result.contents);
      if (segments.length === 0) return null;
      return {
        pos,
        above: true,
        create: () => ({ dom: hoverDom(segments) }),
      };
    },
    { hoverTime: 500 },
  );
}

interface CodeEditorProps {
  /** 마운트 시점의 문서 텍스트 (이후엔 언컨트롤드 — 재마운트는 부모의 key). */
  initialText: string;
  /** 언어 선택용 상대 경로. */
  path: string;
  onChange: (text: string) => void;
  /** ⌘S. CM 이 포커스를 쥔 동안의 저장 경로 (화면 레벨 리스너와 이중). */
  onSave: () => void;
  onCursor?: (line: number, col: number) => void;
  /** 1-based 라인 점프 (one-shot) — 소비 후 onJumpConsumed 를 부른다. */
  jumpLine?: number | null;
  onJumpConsumed?: () => void;
  /** 언어 서버가 준 진단. 바뀔 때마다 트랜잭션으로 반영한다 (재구성 없음). */
  diagnostics?: readonly LspDiagnostic[];
  /** 커서 위치의 완성 후보. 없으면 자동완성을 아예 안 단다. */
  onComplete?: (line: number, character: number) => Promise<LspCompletionItem[]>;
  /** 커서를 올린 자리의 타입·문서. */
  onHover?: (line: number, character: number) => Promise<LspHover | null>;
  /** F12 · ⌘클릭 — 정의로 이동. 이동 자체는 부모(코드 화면)가 한다. */
  onGoToDefinition?: (line: number, character: number) => void;
  /** F2 — 이름 바꾸기. `word` 는 커서가 놓인 식별자(입력창 초깃값). */
  onRename?: (line: number, character: number, word: string) => void;
  /** ⌘. — 코드 액션. 선택이 있으면 그 범위, 없으면 커서 자리. */
  onCodeActions?: (
    startLine: number,
    startCharacter: number,
    endLine: number,
    endCharacter: number,
  ) => void;
}

export function CodeEditor({
  initialText,
  path,
  onChange,
  onSave,
  onCursor,
  jumpLine = null,
  onJumpConsumed,
  diagnostics,
  onComplete,
  onHover,
  onGoToDefinition,
  onRename,
  onCodeActions,
}: CodeEditorProps) {
  const { lang } = useT();
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  // 콜백은 ref 로 — CM 확장은 마운트 시 1회 구성되므로 최신 클로저를 참조한다.
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onCursorRef = useRef(onCursor);
  const onJumpConsumedRef = useRef(onJumpConsumed);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  onCursorRef.current = onCursor;
  onJumpConsumedRef.current = onJumpConsumed;
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;
  const onGoToDefRef = useRef(onGoToDefinition);
  onGoToDefRef.current = onGoToDefinition;
  const onRenameRef = useRef(onRename);
  onRenameRef.current = onRename;
  const onCodeActionsRef = useRef(onCodeActions);
  onCodeActionsRef.current = onCodeActions;
  // 확장을 달지 말지는 **마운트 시점**에만 정한다 (파일마다 재마운트되므로
  // 그 파일에 서버가 있는지와 일치한다). 도중에 켜고 끄면 재구성이 필요하고,
  // 그러면 커서가 튄다.
  //
  // 서버가 안 붙는 파일에 override 자동완성을 걸면 CM6 언어 모드의 기본 완성
  // (CSS 속성 등)이 통째로 사라진다 — 그래서 경로로 먼저 가른다.
  const hasLspRef = useRef(onComplete != null && hasLanguageServer(path));

  const phrases = useMemo(() => (lang === "ko" ? koPhrases() : null), [lang]);

  useEffect(() => {
    if (!hostRef.current) return;
    const state = EditorState.create({
      doc: initialText,
      extensions: [
        basicSetup,
        keymap.of([
          {
            key: "Mod-s",
            run: () => {
              onSaveRef.current();
              return true;
            },
            // 화면 레벨 ⌘S 리스너(window)까지 버블되면 저장이 두 번 나간다.
            stopPropagation: true,
          },
          indentWithTab,
        ]),
        ...langExtensionForPath(path),
        // 언어 서버가 있는 파일에만 인텔리전스를 단다. basicSetup 의 기본
        // 자동완성(문서 내 단어)을 덮어쓰기 위해 override 를 쓴다 — 서버가
        // 아는 심볼 옆에 같은 단어가 두 번 뜨는 것을 막는다.
        ...(hasLspRef.current
          ? [
              lintGutter(),
              autocompletion({ override: [lspCompletionSource(onCompleteRef)] }),
              lspHoverTooltip(onHoverRef),
              keymap.of([
                {
                  // VS Code 와 같은 키. ⌘클릭은 아래 domEventHandlers 가 받는다.
                  key: "F12",
                  run: (view) => {
                    const go = onGoToDefRef.current;
                    if (!go) return false;
                    const { line, character } = positionOf(
                      view.state.doc,
                      view.state.selection.main.head,
                    );
                    go(line, character);
                    return true;
                  },
                },
                {
                  // VS Code 와 같은 키. 선택이 있으면 그 범위로 물어야
                  // "이 블록을 함수로 빼기" 류 리팩터가 나온다.
                  key: "Mod-.",
                  run: (view) => {
                    const ask = onCodeActionsRef.current;
                    if (!ask) return false;
                    const sel = view.state.selection.main;
                    const from = positionOf(view.state.doc, sel.from);
                    const to = positionOf(view.state.doc, sel.to);
                    ask(from.line, from.character, to.line, to.character);
                    return true;
                  },
                },
                {
                  // VS Code 와 같은 키.
                  key: "F2",
                  run: (view) => {
                    const rename = onRenameRef.current;
                    if (!rename) return false;
                    const head = view.state.selection.main.head;
                    const { line, character } = positionOf(view.state.doc, head);
                    const l = view.state.doc.lineAt(head);
                    rename(line, character, wordAtColumn(l.text, head - l.from));
                    return true;
                  },
                },
              ]),
              EditorView.domEventHandlers({
                mousedown(event, view) {
                  const go = onGoToDefRef.current;
                  // macOS 는 ⌘, 그 밖은 Ctrl. 수식키가 없으면 평범한 클릭이다.
                  if (!go || !(event.metaKey || event.ctrlKey)) return false;
                  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
                  if (pos == null) return false;
                  const { line, character } = positionOf(view.state.doc, pos);
                  go(line, character);
                  // true = 기본 동작(선택 시작)을 막는다 — 안 막으면 이동과
                  // 동시에 엉뚱한 곳이 드래그 선택된다.
                  return true;
                },
              }),
            ]
          : []),
        editorChrome,
        syntaxHighlighting(codeHighlight, { fallback: true }),
        ...(phrases ? [EditorState.phrases.of(phrases)] : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          if (update.selectionSet || update.docChanged) {
            const head = update.state.selection.main.head;
            const line = update.state.doc.lineAt(head);
            onCursorRef.current?.(line.number, head - line.from + 1);
          }
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // 마운트 1회 — 파일 전환/리로드는 부모가 key 로 재마운트한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 진단 반영 — **재구성이 아니라 트랜잭션**이다. 확장을 갈아끼우면 실행 취소
  // 이력과 접힘 상태가 날아가는데, 진단은 타자 도중에도 계속 갱신된다.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !hasLspRef.current) return;
    view.dispatch(setDiagnostics(view.state, toCmDiagnostics(view.state.doc, diagnostics ?? [])));
  }, [diagnostics]);

  // 라인 점프 — 마운트 직후(위 effect 가 먼저 실행돼 view 가 있다)와 같은
  // 파일에서의 재점프(prop 변화) 둘 다 여기로 온다.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || jumpLine == null) return;
    const line = Math.max(1, Math.min(jumpLine, view.state.doc.lines));
    const pos = view.state.doc.line(line).from;
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: "center" }),
    });
    view.focus();
    onJumpConsumedRef.current?.();
  }, [jumpLine]);

  return <div ref={hostRef} className="code-editor-host" aria-label={t("code.editorAria")} />;
}
