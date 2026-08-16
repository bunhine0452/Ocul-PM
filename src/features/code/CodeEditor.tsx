// CodeMirror 6 마운트 래퍼. 마운트 후엔 **언컨트롤드**다 — 부모는 초깃값만
// 주고, 외부 갱신(디스크 리로드·파일 전환)은 key 재마운트로 처리한다. 양방향
// 동기화는 CM 트랜잭션과 React 상태가 서로를 되돌리는 고전적 버그의 근원이라
// 의도적으로 피한다.
import { useEffect, useMemo, useRef } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { basicSetup } from "codemirror";
import { indentWithTab } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

import { langExtensionForPath } from "./codeLang";
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
}

export function CodeEditor({
  initialText,
  path,
  onChange,
  onSave,
  onCursor,
  jumpLine = null,
  onJumpConsumed,
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
          },
          indentWithTab,
        ]),
        ...langExtensionForPath(path),
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
