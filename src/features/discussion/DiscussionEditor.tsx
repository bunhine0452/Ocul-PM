/**
 * 문제 해결 문서 편집기 — CodeMirror 6 마크다운 + 라이브 프리뷰.
 *
 * 왜 WYSIWYG 이 아닌가: 이 문서의 SSOT 는 디스크의 `.md` 이고 **외부
 * 에이전트가 같은 파일을 동시에 고친다**. 리치 에디터는 왕복마다 서식을
 * 잃거나 재배열해 남의 편집을 조용히 지운다. 그래서 원문을 그대로 두되,
 * 규격(안정 id·managed block·인식되는 섹션 제목)을 **삽입 메뉴와 경고**로
 * 대신 맡는다 — 손으로 `{#opt-c}` 를 세지 않아도 되게.
 *
 * 마운트 후엔 언컨트롤드다 (`CodeEditor.tsx` 와 같은 원칙): 부모는 초깃값만
 * 주고, 문서를 바꿔 끼울 땐 `key` 로 재마운트한다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, drawSelection, placeholder as cmPlaceholder } from "@codemirror/view";
import { history, historyKeymap, defaultKeymap } from "@codemirror/commands";
import { search, searchKeymap } from "@codemirror/search";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { tags } from "@lezer/highlight";

import { Markdown } from "@/components/Markdown";
import {
  AlertTriangle,
  Bold,
  Code2,
  Columns2,
  Eye,
  Heading2,
  Italic,
  Link2,
  List,
  ListTodo,
  Pencil,
  Plus,
  Quote,
  Save,
} from "@/components/Icons";
import { useT } from "@/i18n";
import {
  appendLogRowOp,
  insertInSectionOp,
  linePrefixOp,
  linkOp,
  localIsoWithOffset,
  nextOptionId,
  nextStepId,
  unknownSections,
  wrapOp,
  type EditOp,
} from "./mdEdit";
import { logColumns, placeholders, sectionHeadings } from "./discussionTemplates";

/** 프리뷰 재렌더 지연 — 타이핑 중 마크다운 파싱이 키 입력을 붙잡지 않게. */
const PREVIEW_DEBOUNCE_MS = 180;

export type EditorMode = "write" | "split" | "preview";

interface Props {
  /** 마운트 시점의 원문 (이후 외부 변경은 `key` 재마운트로). */
  initialText: string;
  mode: EditorMode;
  onModeChange: (m: EditorMode) => void;
  onSave: (text: string) => void;
  onCancel: () => void;
  busy: boolean;
  /** 토의 로그에 찍힐 작성자 (= 사용자 자신). */
  author: string;
}

const chrome = EditorView.theme({
  "&": { height: "100%", fontSize: "13.5px", backgroundColor: "transparent", color: "var(--text)" },
  ".cm-scroller": {
    fontFamily: "var(--mono)",
    lineHeight: "1.75",
    overflow: "auto",
    padding: "18px 4px 40vh",
  },
  ".cm-content": { caretColor: "var(--accent)", maxWidth: "78ch", margin: "0 auto" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--accent-soft) !important",
  },
  ".cm-panels": {
    backgroundColor: "var(--bg-inset)",
    color: "var(--text)",
    borderTop: "1px solid var(--sep)",
  },
  ".cm-placeholder": { color: "var(--text-3)" },
});

/** 산문용 하이라이트 — 코드 화면보다 대비를 낮춰 읽는 데 방해가 없게. */
const mdHighlight = HighlightStyle.define([
  { tag: tags.heading1, color: "var(--text)", fontWeight: "700" },
  { tag: tags.heading2, color: "var(--accent-text)", fontWeight: "700" },
  { tag: tags.heading3, color: "var(--text)", fontWeight: "700" },
  { tag: tags.heading4, color: "var(--text-2)", fontWeight: "700" },
  { tag: tags.strong, color: "var(--text)", fontWeight: "700" },
  { tag: tags.emphasis, color: "var(--text)", fontStyle: "italic" },
  { tag: tags.link, color: "var(--accent-text)" },
  { tag: tags.url, color: "var(--text-3)" },
  { tag: tags.monospace, color: "var(--accent-text)" },
  { tag: tags.list, color: "var(--text-3)" },
  { tag: tags.quote, color: "var(--text-2)", fontStyle: "italic" },
  { tag: tags.comment, color: "var(--text-3)" },
  { tag: tags.contentSeparator, color: "var(--text-3)" },
]);

export function DiscussionEditor({
  initialText,
  mode,
  onModeChange,
  onSave,
  onCancel,
  busy,
  author,
}: Props) {
  const { t } = useT();
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [text, setText] = useState(initialText);
  const [preview, setPreview] = useState(initialText);
  const [insertOpen, setInsertOpen] = useState(false);
  const insertRef = useRef<HTMLDivElement>(null);

  // CM 확장은 마운트 1회 구성이라 최신 콜백은 ref 로 읽는다.
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const dirty = text !== initialText;
  const unknown = useMemo(() => unknownSections(preview), [preview]);

  /** 순수 모듈이 계산한 교체를 트랜잭션 하나로 반영하고 포커스를 돌려준다. */
  const apply = useCallback((make: (doc: string, from: number, to: number) => EditOp) => {
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const op = make(view.state.doc.toString(), from, to);
    view.dispatch({
      changes: { from: op.from, to: op.to, insert: op.insert },
      selection: { anchor: op.selFrom, head: op.selTo },
      scrollIntoView: true,
    });
    view.focus();
  }, []);

  // 키맵은 마운트 시점에 굳는다 — 서식 단축키가 최신 `apply` 를 보도록 ref 경유.
  const applyRef = useRef<(kind: "**" | "_" | "link") => void>(() => {});
  applyRef.current = (kind) => {
    if (kind === "link") {
      apply((doc, from, to) => linkOp(doc, from, to, placeholders().url));
      return;
    }
    apply((doc, from, to) => wrapOp(doc, from, to, kind));
  };

  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initialText,
        extensions: [
          history(),
          drawSelection(),
          search({ top: true }),
          EditorView.lineWrapping,
          markdown(),
          syntaxHighlighting(mdHighlight),
          chrome,
          cmPlaceholder(t("disc.editor.placeholder")),
          keymap.of([
            {
              key: "Mod-s",
              run: (v) => {
                onSaveRef.current(v.state.doc.toString());
                return true;
              },
              // 화면 레벨 ⌘S 까지 버블되면 저장이 두 번 나간다.
              stopPropagation: true,
            },
            { key: "Mod-b", run: () => (applyRef.current("**"), true) },
            { key: "Mod-i", run: () => (applyRef.current("_"), true) },
            { key: "Mod-k", run: () => (applyRef.current("link"), true) },
            ...historyKeymap,
            ...searchKeymap,
            ...defaultKeymap,
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) setText(u.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // 마운트 1회 — 문서 교체는 부모의 `key` 가 담당한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 프리뷰는 한 박자 늦게 — 타이핑 중 마크다운 파싱이 입력을 붙잡지 않게.
  useEffect(() => {
    const id = window.setTimeout(() => setPreview(text), PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [text]);

  // 삽입 메뉴 — 바깥 클릭 / Esc 로 닫는다.
  useEffect(() => {
    if (!insertOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!insertRef.current?.contains(e.target as Node)) setInsertOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setInsertOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [insertOpen]);

  const insertOption = () => {
    const ph = placeholders();
    apply((doc) =>
      insertInSectionOp(
        doc,
        "options",
        `### ${ph.option} {#${nextOptionId(doc)}}\n\n- \n`,
        { heading: sectionHeadings().options, selectText: ph.option },
      ),
    );
  };

  const insertStep = () => {
    const ph = placeholders();
    apply((doc) =>
      insertInSectionOp(doc, "next", `- [ ] ${ph.step} {#${nextStepId(doc)}}`, {
        heading: sectionHeadings().next,
        selectText: ph.step,
      }),
    );
  };

  const insertNote = () => {
    apply((doc) =>
      appendLogRowOp(doc, {
        author,
        ts: localIsoWithOffset(new Date()),
        body: "",
        heading: sectionHeadings().log,
        columns: logColumns(),
      }),
    );
  };

  const insertCodeBlock = () => apply((doc, from, to) => wrapOp(doc, from, to, "```\n", "\n```"));

  const menuItems: { key: string; label: string; run: () => void }[] = [
    { key: "opt", label: t("disc.editor.insertOption"), run: insertOption },
    { key: "next", label: t("disc.editor.insertStep"), run: insertStep },
    { key: "note", label: t("disc.editor.insertNote"), run: insertNote },
    { key: "code", label: t("disc.editor.insertCode"), run: insertCodeBlock },
  ];

  const fmt: { key: string; label: string; icon: React.ReactNode; run: () => void }[] = [
    { key: "b", label: t("disc.editor.bold"), icon: <Bold size={14} />, run: () => applyRef.current("**") },
    { key: "i", label: t("disc.editor.italic"), icon: <Italic size={14} />, run: () => applyRef.current("_") },
    {
      key: "code",
      label: t("disc.editor.code"),
      icon: <Code2 size={14} />,
      run: () => apply((doc, from, to) => wrapOp(doc, from, to, "`")),
    },
    { key: "link", label: t("disc.editor.link"), icon: <Link2 size={14} />, run: () => applyRef.current("link") },
    {
      key: "h",
      label: t("disc.editor.heading"),
      icon: <Heading2 size={14} />,
      run: () => apply((doc, from, to) => linePrefixOp(doc, from, to, "#### ")),
    },
    {
      key: "quote",
      label: t("disc.editor.quote"),
      icon: <Quote size={14} />,
      run: () => apply((doc, from, to) => linePrefixOp(doc, from, to, "> ")),
    },
    {
      key: "ul",
      label: t("disc.editor.bullet"),
      icon: <List size={14} />,
      run: () => apply((doc, from, to) => linePrefixOp(doc, from, to, "- ")),
    },
    {
      key: "task",
      label: t("disc.editor.task"),
      icon: <ListTodo size={14} />,
      run: () => apply((doc, from, to) => linePrefixOp(doc, from, to, "- [ ] ")),
    },
  ];

  const modes: { key: EditorMode; label: string; icon: React.ReactNode }[] = [
    { key: "write", label: t("disc.editor.modeWrite"), icon: <Pencil size={13} /> },
    { key: "split", label: t("disc.editor.modeSplit"), icon: <Columns2 size={13} /> },
    { key: "preview", label: t("disc.editor.modePreview"), icon: <Eye size={13} /> },
  ];

  return (
    <div className="disc-edit">
      <div className="disc-edit-bar">
        <div className="disc-tool-group">
          {fmt.map((b) => (
            <button
              key={b.key}
              type="button"
              className="disc-tool"
              title={b.label}
              aria-label={b.label}
              onClick={b.run}
            >
              {b.icon}
            </button>
          ))}
        </div>

        <div className="disc-tool-group" ref={insertRef}>
          <button
            type="button"
            className="disc-tool wide"
            aria-haspopup="menu"
            aria-expanded={insertOpen}
            onClick={() => setInsertOpen((o) => !o)}
          >
            <Plus size={14} /> {t("disc.editor.insert")}
          </button>
          {insertOpen ? (
            <div className="disc-menu" role="menu" aria-label={t("disc.editor.insert")}>
              {menuItems.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  role="menuitem"
                  className="disc-menu-item"
                  onClick={() => {
                    setInsertOpen(false);
                    m.run();
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="disc-seg" role="group" aria-label={t("disc.editor.modeAria")}>
          {modes.map((m) => (
            <button
              key={m.key}
              type="button"
              className={`disc-seg-btn${mode === m.key ? " on" : ""}`}
              aria-pressed={mode === m.key}
              title={m.label}
              onClick={() => onModeChange(m.key)}
            >
              {m.icon}
              <span>{m.label}</span>
            </button>
          ))}
        </div>

        <div className="disc-edit-right">
          <span className={`disc-dirty${dirty ? " on" : ""}`}>
            {dirty ? t("disc.editor.unsaved") : t("disc.editor.savedState")}
          </span>
          <button
            type="button"
            className="disc-btn"
            disabled={busy}
            onClick={() => {
              // 저장 안 한 편집을 조용히 버리지 않는다.
              if (dirty && !window.confirm(t("disc.editor.discardConfirm"))) return;
              onCancel();
            }}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="disc-btn primary"
            disabled={busy || !dirty}
            onClick={() => onSave(viewRef.current?.state.doc.toString() ?? text)}
          >
            <Save size={14} /> {t("common.save")}
          </button>
        </div>
      </div>

      {unknown.length > 0 ? (
        <div className="disc-edit-warn">
          <AlertTriangle size={13} />
          <span>{t("disc.editor.unknownSections", { list: unknown.join(" · ") })}</span>
        </div>
      ) : null}

      <div className={`disc-edit-panes ${mode}`}>
        <div className="disc-edit-cm" ref={hostRef} />
        {mode === "write" ? null : (
          <div className="disc-edit-preview">
            <div className="disc-doc-prose">
              <Markdown>{preview || t("disc.preview")}</Markdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
