import { useConfirm } from "@/hooks/useConfirm";
/**
 * 문제 해결 문서 편집기 — Monaco 마크다운 + 라이브 프리뷰.
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

import type * as MonacoNs from "monaco-editor/editor/editor.api";
import monaco from "@/features/code/monaco/setup";
import { PROSE_LANGUAGE_ID } from "@/features/code/monaco/langProse";
import {
  defineCodeTheme,
  isDarkTheme,
  readCodeTokens,
  THEME_NAME,
  watchThemeChanges,
} from "@/features/code/monaco/theme";

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
import { blocked } from "@/lib/blocked";
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

/**
 * 편집기 옵션 — 코드 화면과 **다른 물건**이다.
 *
 * 여기는 산문이라 줄 번호 · 미니맵 · 거터 · 접기가 전부 소음이고, 대신 줄바꿈이
 * 켜져 있어야 한다(코드는 가로 스크롤이 맞지만 문단은 아니다). 문법도 코드용
 * `markdown` 이 아니라 `markdown-prose` 다 — 제목 단계와 `{#id}` 를 갈라 칠한다.
 *
 * 색은 `monaco/theme.ts` 의 한 테마가 준다. Monaco 의 테마는 **전역**이라 두
 * 편집기가 서로 다른 테마를 동시에 쓸 수 없고(코드 화면과 이 화면이 다른 창
 * 탭에서 함께 살아 있을 수 있다), 그래서 규칙을 `.md-prose` 접미사로 갈랐다.
 */
const PROSE_OPTIONS: MonacoNs.editor.IStandaloneEditorConstructionOptions = {
  theme: THEME_NAME,
  language: PROSE_LANGUAGE_ID,
  automaticLayout: true,
  fontSize: 13.5,
  fontFamily: "var(--mono)",
  lineHeight: 1.75,
  wordWrap: "on",
  lineNumbers: "off",
  glyphMargin: false,
  folding: false,
  minimap: { enabled: false },
  renderLineHighlight: "none",
  lineDecorationsWidth: 0,
  lineNumbersMinChars: 0,
  overviewRulerLanes: 0,
  scrollBeyondLastLine: false,
  // 문단 끝에서도 화면 가운데로 올려 쓸 수 있게.
  padding: { top: 18, bottom: 400 },
  fixedOverflowWidgets: true,
  scrollbar: { useShadows: false, vertical: "auto", horizontal: "hidden" },
  // 산문에서 자동 괄호 닫기는 방해가 더 크다(`(그런데` 를 치면 닫는 괄호가 따라온다).
  // 대신 **선택 감싸기**는 남긴다 — 서식 단축키와 같은 손놀림이다.
  autoClosingBrackets: "never",
  autoClosingQuotes: "never",
  autoSurround: "languageDefined",
  matchBrackets: "never",
  occurrencesHighlight: "off",
  selectionHighlight: true,
  bracketPairColorization: { enabled: false },
  guides: { indentation: false, bracketPairs: false },
  // 다중 커서는 산문에서도 쓸모가 있다 (표의 같은 열을 한꺼번에 고친다).
  multiCursorModifier: "alt",
  contextmenu: false,
  tabSize: 2,
  insertSpaces: true,
  detectIndentation: false,
};

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
  const { confirm, confirmDialog } = useConfirm();
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MonacoNs.editor.IStandaloneCodeEditor | null>(null);
  const [text, setText] = useState(initialText);
  const [preview, setPreview] = useState(initialText);
  const [insertOpen, setInsertOpen] = useState(false);
  const insertRef = useRef<HTMLDivElement>(null);

  // 편집기 배선은 마운트 1회라 최신 콜백은 ref 로 읽는다.
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const dirty = text !== initialText;
  const unknown = useMemo(() => unknownSections(preview), [preview]);

  /**
   * 순수 모듈이 계산한 교체를 **한 번의 편집**으로 반영하고 포커스를 돌려준다.
   *
   * `mdEdit` 의 `EditOp` 는 문서 시작부터의 **오프셋**으로 말한다 (CodeMirror
   * 시절의 단위). Monaco 는 (줄, 열)이라 여기서만 환산한다 —
   * `getPositionAt`/`getOffsetAt` 이 그 다리고, 둘 다 UTF-16 코드 유닛이라
   * 인코딩 변환은 없다. 순수 모듈은 편집기를 여전히 모른다.
   *
   * `pushEditOperations` 로 한 번에 넣는 이유는 **실행 취소 한 칸**이다 —
   * `executeEdits` 를 여러 번 부르면 되돌리기가 조각조각 난다.
   */
  const apply = useCallback((make: (doc: string, from: number, to: number) => EditOp) => {
    const editor = viewRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    const sel = editor.getSelection();
    const from = sel ? model.getOffsetAt(sel.getStartPosition()) : 0;
    const to = sel ? model.getOffsetAt(sel.getEndPosition()) : 0;
    const op = make(model.getValue(), from, to);
    const range = monaco.Range.fromPositions(
      model.getPositionAt(op.from),
      model.getPositionAt(op.to),
    );
    editor.executeEdits("oculpm.mdEdit", [{ range, text: op.insert, forceMoveMarkers: true }]);
    // 선택 오프셋은 **교체가 반영된 뒤**의 문서 기준이라 여기서 환산한다.
    editor.setSelection(
      monaco.Range.fromPositions(
        model.getPositionAt(op.selFrom),
        model.getPositionAt(op.selTo),
      ),
    );
    editor.revealRangeInCenterIfOutsideViewport(editor.getSelection()!);
    editor.focus();
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
    const host = hostRef.current;
    if (!host) return;

    // 테마는 편집기를 만들기 **전에** 정의해야 첫 프레임부터 제 색으로 그린다.
    defineCodeTheme(monaco, readCodeTokens(host), isDarkTheme());
    const editor = monaco.editor.create(host, {
      ...PROSE_OPTIONS,
      value: initialText,
      placeholder: t("disc.editor.placeholder"),
    });
    viewRef.current = editor;
    editor.focus();

    const subs: MonacoNs.IDisposable[] = [
      editor.onDidChangeModelContent(() => setText(editor.getValue())),
      // ⌘S — Monaco 액션은 기본 동작을 삼키므로 화면 레벨 ⌘S 까지 버블돼
      // 저장이 두 번 나가지 않는다 (CodeMirror 의 `stopPropagation` 자리).
      editor.addAction({
        id: "oculpm.disc.save",
        label: t("common.save"),
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
        run: () => onSaveRef.current(editor.getValue()),
      }),
      // 서식 단축키 — 배선은 마운트 1회라 최신 `apply` 를 ref 로 읽는다.
      editor.addAction({
        id: "oculpm.disc.bold",
        label: t("disc.editor.bold"),
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB],
        run: () => applyRef.current("**"),
      }),
      editor.addAction({
        id: "oculpm.disc.italic",
        label: t("disc.editor.italic"),
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI],
        run: () => applyRef.current("_"),
      }),
      // ⌘K 는 Monaco 에서 화음(⌘K ⌘C …)의 앞 글자지만, 동적 키바인딩이
      // 기여 액션보다 무거워 여기서는 한 타로 링크 삽입이 된다.
      editor.addAction({
        id: "oculpm.disc.link",
        label: t("disc.editor.link"),
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
        run: () => applyRef.current("link"),
      }),
    ];

    const stopThemeWatch = watchThemeChanges(() => {
      defineCodeTheme(monaco, readCodeTokens(host), isDarkTheme());
      monaco.editor.setTheme(THEME_NAME);
    });

    return () => {
      stopThemeWatch();
      for (const sub of subs) sub.dispose();
      // 모델은 **편집기가 소유한다** — `value` 로 만들게 했으므로 Monaco 가
      // `_ownsModel` 로 표시해 두고 `dispose()` 때 함께 푼다. 여기서 먼저
      // 지우면 붙어 있는 모델을 떼면서 두 번 죽이는 셈이다.
      editor.dispose();
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
    { key: "b", label: t("disc.editor.bold"), icon: <Bold size={15} />, run: () => applyRef.current("**") },
    { key: "i", label: t("disc.editor.italic"), icon: <Italic size={15} />, run: () => applyRef.current("_") },
    {
      key: "code",
      label: t("disc.editor.code"),
      icon: <Code2 size={15} />,
      run: () => apply((doc, from, to) => wrapOp(doc, from, to, "`")),
    },
    { key: "link", label: t("disc.editor.link"), icon: <Link2 size={15} />, run: () => applyRef.current("link") },
    {
      key: "h",
      label: t("disc.editor.heading"),
      icon: <Heading2 size={15} />,
      run: () => apply((doc, from, to) => linePrefixOp(doc, from, to, "#### ")),
    },
    {
      key: "quote",
      label: t("disc.editor.quote"),
      icon: <Quote size={15} />,
      run: () => apply((doc, from, to) => linePrefixOp(doc, from, to, "> ")),
    },
    {
      key: "ul",
      label: t("disc.editor.bullet"),
      icon: <List size={15} />,
      run: () => apply((doc, from, to) => linePrefixOp(doc, from, to, "- ")),
    },
    {
      key: "task",
      label: t("disc.editor.task"),
      icon: <ListTodo size={15} />,
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
      {confirmDialog}
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
            <Plus size={15} /> {t("disc.editor.insert")}
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
            className="btn"
            disabled={busy}
            onClick={() => {
              // 저장 안 한 편집을 조용히 버리지 않는다.
              if (!dirty) {
                onCancel();
                return;
              }
              void confirm({
                title: t("disc.editor.discardConfirm"),
                confirmLabel: t("common.discard"),
                danger: true,
              }).then((ok) => {
                if (ok) onCancel();
              });
            }}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn primary"
            {...blocked(dirty ? null : t("disc.blockedNoChanges"))}
            disabled={busy}
            onClick={() => onSave(viewRef.current?.getValue() ?? text)}
          >
            <Save size={15} /> {t("common.save")}
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
