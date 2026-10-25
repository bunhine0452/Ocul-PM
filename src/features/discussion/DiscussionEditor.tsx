import { useConfirm } from "@/hooks/useConfirm";
/**
 * 문제 해결 문서 편집기 — 리치(노션식) 편집 + Monaco 원문.
 *
 * 2026-10-25: 리치 편집이 기본이다. 예전 판은 "리치 에디터는 왕복마다 서식을 잃거나
 * 재배열해 남의 편집을 조용히 지운다" 며 WYSIWYG 을 거절했다 — 이 문서의 SSOT 는
 * 디스크의 `.md` 이고 외부 에이전트가 같은 파일을 고친다. 그 걱정은 코덱이 진다
 * (`features/code/richMarkdown/codec.ts`): 고치지 않은 블록은 원문 그대로 나가고,
 * 토의 로그 같은 관리 블록은 고칠 수 없는 원문 블록이다. 저장소의 .md 전부가 열고
 * 닫아도 바이트 단위로 같다는 것을 테스트가 지킨다. 「나란히」·「미리보기」 모드는
 * 리치 모드가 대신해 걷어냈다; 원문(Monaco)은 규격을 손으로 만질 때를 위해 남긴다.
 *
 * 규격(안정 id·managed block·인식되는 섹션 제목)은 여전히 **삽입 메뉴와 경고**가
 * 맡는다 — 손으로 `{#opt-c}` 를 세지 않아도 되게. 토의 메모는 관리 블록 안이라
 * 리치에서는 고칠 수 없어, 넣으면 원문 모드의 그 칸으로 데려간다.
 *
 * 마운트 후엔 언컨트롤드다 (`CodeEditor.tsx` 와 같은 원칙): 부모는 초깃값만
 * 주고, 문서를 바꿔 끼울 땐 `key` 로 재마운트한다.
 *
 * 화면 (2026-10-08 개편): 한 줄 툴바(서식 · 삽입 · 보기 · 저장) → 개요 · 원고 ·
 * 미리보기 → 상태줄(현재 섹션 · 분량 · 경로 · 단축키). 원고는 본문 글꼴로, 판
 * 가운데의 한 칼럼에 쓴다(`proseEditor.ts`). 자동 제안은 전부 꺼져 있다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type * as MonacoNs from "monaco-editor/editor/editor.api";
import monaco from "@/features/code/monaco/setup";
import {
  defineCodeTheme,
  isDarkTheme,
  readCodeTokens,
  THEME_NAME,
  watchThemeChanges,
} from "@/features/code/monaco/theme";

import type { Editor } from "@tiptap/core";
import { RichMarkdownEditor } from "@/features/code/richMarkdown/RichMarkdownEditor";
import {
  AlertTriangle,
  Bold,
  ChevronDown,
  Code2,
  FileText,
  Heading2,
  Italic,
  Link2,
  List,
  ListTodo,
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
import { DiscussionOutline } from "./DiscussionOutline";
import { outlineIndexAt, parseOutline, textStats, type OutlineItem } from "./outline";
import { keepProseCentered, PROSE_OPTIONS } from "./proseEditor";
import "./discussion-editor.css";

/** 경고·분량 재계산 지연 — 타이핑 중 문서 판독이 키 입력을 붙잡지 않게. */
const PREVIEW_DEBOUNCE_MS = 180;

/** 리치(기본) · 원문. 예전 판의 `split`·`preview` 는 부모가 리치로 읽는다. */
export type EditorMode = "write" | "rich";

interface Props {
  /** 마운트 시점에 편집기에 넣을 글 — 디스크 본문이거나, 붙들어 둔 초안이다. */
  initialText: string;
  /** 편집기를 열 때 디스크에 있던 본문. 「저장 안 됨」 은 이것과 비교한다. */
  baseText: string;
  /** 상태줄에 보이는 문서 경로. */
  filePath: string;
  mode: EditorMode;
  onModeChange: (m: EditorMode) => void;
  onSave: (text: string) => void;
  onCancel: () => void;
  /** 글이 바뀔 때마다 — 화면이 초안을 붙든다 (`draftStore`). */
  onTextChange?: (text: string) => void;
  busy: boolean;
  /** 토의 로그에 찍힐 작성자 (= 사용자 자신). */
  author: string;
}

/** 리치 판 안의 제목들 — 개요(`parseOutline`)와 같은 순서다. */
const RICH_HEADINGS = ".rich-md-doc h2, .rich-md-doc h3";

export function DiscussionEditor({
  initialText,
  baseText,
  filePath,
  mode,
  onModeChange,
  onSave,
  onCancel,
  onTextChange,
  busy,
  author,
}: Props) {
  const { t } = useT();
  const { confirm, confirmDialog } = useConfirm();
  const hostRef = useRef<HTMLDivElement>(null);
  const richHostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MonacoNs.editor.IStandaloneCodeEditor | null>(null);
  const richRef = useRef<Editor | null>(null);
  // 삽입 메뉴가 글을 바꾸면 리치 판을 그 글로 다시 연다 (원문 지도도 새로).
  const [richKey, setRichKey] = useState(0);
  // 원문 모드로 넘어가며 고를 자리 — 토의 메모의 본문 칸.
  const pendingSelRef = useRef<{ from: number; to: number } | null>(null);
  const [text, setText] = useState(initialText);
  const textRef = useRef(text);
  textRef.current = text;
  const [preview, setPreview] = useState(initialText);
  const [cursorLine, setCursorLine] = useState(1);
  const [insertOpen, setInsertOpen] = useState(false);
  const insertRef = useRef<HTMLDivElement>(null);

  // 편집기 배선은 마운트 1회라 최신 콜백은 ref 로 읽는다.
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const onTextChangeRef = useRef(onTextChange);
  onTextChangeRef.current = onTextChange;

  const dirty = text !== baseText;
  const unknown = useMemo(() => unknownSections(preview), [preview]);
  // 개요·현재 섹션·분량은 같은 판독(`outline.ts`) — 왼쪽 목차와 상태줄이 어긋나지 않게.
  const items = useMemo(() => parseOutline(text), [text]);
  const itemsRef = useRef<OutlineItem[]>(items);
  itemsRef.current = items;
  // 리치 판에서는 원문 줄 커서가 없다 — 그때의 「현재」 는 스크롤 위치다.
  const [richIndex, setRichIndex] = useState(-1);
  /** 개요에서 막 고른 항목 — 그 이동이 낳은 스크롤 한 번은 위치 대신 이 값을 쓴다. */
  const pinnedRef = useRef<number | null>(null);
  const current = mode === "rich" ? richIndex : outlineIndexAt(items, cursorLine);
  const stats = useMemo(() => textStats(preview), [preview]);

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
    if (mode === "write") editor.focus();

    const subs: MonacoNs.IDisposable[] = [
      keepProseCentered(editor, monaco),
      editor.onDidChangeModelContent(() => {
        const value = editor.getValue();
        setText(value);
        onTextChangeRef.current?.(value);
      }),
      editor.onDidChangeCursorPosition((e) => setCursorLine(e.position.lineNumber)),
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

  // 리치 판의 「현재 섹션」 — 스크롤 위치에서 읽는다.
  useEffect(() => {
    const pane = richHostRef.current?.querySelector<HTMLElement>(".rich-md");
    if (!pane || mode !== "rich") return;
    const onScroll = () => {
      if (pinnedRef.current !== null) {
        setRichIndex(pinnedRef.current);
        pinnedRef.current = null;
        return;
      }
      const heads = pane.querySelectorAll<HTMLElement>(RICH_HEADINGS);
      const base = pane.getBoundingClientRect().top;
      // 끝까지 내렸으면 마지막 섹션들은 맨 위로 올라올 수 없다 — 그때는 보이는 마지막 제목.
      const atEnd = pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 2;
      const line = atEnd ? pane.clientHeight - 48 : 24;
      let idx = -1;
      heads.forEach((h, i) => {
        if (h.getBoundingClientRect().top - base <= line) idx = i;
      });
      setRichIndex(idx);
    };
    onScroll();
    pane.addEventListener("scroll", onScroll, { passive: true });
    return () => pane.removeEventListener("scroll", onScroll);
  }, [mode, richKey]);

  // 원문 모드로 들어올 때 — Monaco 는 리치에서 고친 글을 모른다. 맞추고, 고를 자리가
  // 있으면(토의 메모) 거기로 간다.
  useEffect(() => {
    const editor = viewRef.current;
    const model = editor?.getModel();
    if (mode !== "write" || !editor || !model) return;
    if (model.getValue() !== textRef.current) editor.setValue(textRef.current);
    const sel = pendingSelRef.current;
    pendingSelRef.current = null;
    if (sel) {
      const range = monaco.Range.fromPositions(model.getPositionAt(sel.from), model.getPositionAt(sel.to));
      editor.setSelection(range);
      editor.revealRangeInCenterIfOutsideViewport(range);
    }
    editor.focus();
  }, [mode]);

  /**
   * 리치 판에서의 삽입 — 순수 모듈의 교체를 글에 바로 적용하고 판을 다시 연다.
   * 리치에는 원문 오프셋 커서가 없으므로 섹션 기준 삽입(옵션·단계·메모)만 이 길을 탄다.
   */
  const applyToText = (make: (doc: string, from: number, to: number) => EditOp): EditOp => {
    const doc = textRef.current;
    const op = make(doc, doc.length, doc.length);
    const next = doc.slice(0, op.from) + op.insert + doc.slice(op.to);
    textRef.current = next;
    setText(next);
    onTextChangeRef.current?.(next);
    return op;
  };

  /** 개요에서 고른 제목으로 간다 — 리치면 리치 판을, 아니면 원문을 옮긴다. */
  const jumpTo = (index: number) => {
    const item = items[index];
    if (!item) return;
    if (mode === "rich") {
      pinnedRef.current = index;
      setRichIndex(index);
      richHostRef.current?.querySelectorAll<HTMLElement>(RICH_HEADINGS)[index]?.scrollIntoView({ block: "start" });
      return;
    }
    const editor = viewRef.current;
    if (!editor) return;
    editor.revealLineNearTop(item.line);
    editor.setPosition({ lineNumber: item.line, column: 1 });
    editor.focus();
  };

  /** 섹션 기준 삽입 — 원문이면 Monaco 에, 리치면 글에 바로 넣고 판을 다시 연다. */
  const insertBySection = (make: (doc: string, from: number, to: number) => EditOp) => {
    if (mode === "write") return apply(make);
    applyToText(make);
    setRichKey((k) => k + 1);
  };

  const insertOption = () => {
    const ph = placeholders();
    insertBySection((doc) =>
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
    insertBySection((doc) =>
      insertInSectionOp(doc, "next", `- [ ] ${ph.step} {#${nextStepId(doc)}}`, {
        heading: sectionHeadings().next,
        selectText: ph.step,
      }),
    );
  };

  const insertNote = () => {
    const make = (doc: string) =>
      appendLogRowOp(doc, {
        author,
        ts: localIsoWithOffset(new Date()),
        body: "",
        heading: sectionHeadings().log,
        columns: logColumns(),
      });
    if (mode === "write") return apply(make);
    // 토의 로그는 관리 블록이라 리치에서 고칠 수 없다 — 줄을 넣고 원문의 그 칸으로 간다.
    const op = applyToText(make);
    pendingSelRef.current = { from: op.selFrom, to: op.selTo };
    onModeChange("write");
  };

  const insertCodeBlock = () =>
    mode === "rich"
      ? richRef.current?.chain().focus().toggleCodeBlock().run()
      : apply((doc, from, to) => wrapOp(doc, from, to, "```\n", "\n```"));

  const menuItems: { key: string; label: string; run: () => void }[] = [
    { key: "opt", label: t("disc.editor.insertOption"), run: insertOption },
    { key: "next", label: t("disc.editor.insertStep"), run: insertStep },
    { key: "note", label: t("disc.editor.insertNote"), run: insertNote },
    { key: "code", label: t("disc.editor.insertCode"), run: insertCodeBlock },
  ];

  /** 리치 판의 명령 — 편집기가 아직 없으면 아무것도 안 한다. */
  const rich = (run: (chain: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) => () => {
    const editor = richRef.current;
    if (editor) run(editor.chain().focus()).run();
  };
  /** 링크 — 원문과 같은 자리표 주소를 건다. 선택이 없으면 자리표 글을 링크로 넣는다. */
  const richLink = () => {
    const editor = richRef.current;
    if (!editor) return;
    const href = placeholders().url;
    if (editor.state.selection.empty) {
      editor.chain().focus().insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] }).run();
    } else {
      editor.chain().focus().setLink({ href }).run();
    }
  };
  const byMode = (onRich: () => void, onWrite: () => void) => () => (mode === "rich" ? onRich() : onWrite());

  const fmt: { key: string; label: string; icon: React.ReactNode; run: () => void }[] = [
    { key: "b", label: t("disc.editor.bold"), icon: <Bold size={15} />, run: byMode(rich((c) => c.toggleBold()), () => applyRef.current("**")) },
    { key: "i", label: t("disc.editor.italic"), icon: <Italic size={15} />, run: byMode(rich((c) => c.toggleItalic()), () => applyRef.current("_")) },
    {
      key: "code",
      label: t("disc.editor.code"),
      icon: <Code2 size={15} />,
      run: byMode(rich((c) => c.toggleCode()), () => apply((doc, from, to) => wrapOp(doc, from, to, "`"))),
    },
    { key: "link", label: t("disc.editor.link"), icon: <Link2 size={15} />, run: byMode(richLink, () => applyRef.current("link")) },
    {
      key: "h",
      label: t("disc.editor.heading"),
      icon: <Heading2 size={15} />,
      run: byMode(rich((c) => c.toggleHeading({ level: 4 })), () => apply((doc, from, to) => linePrefixOp(doc, from, to, "#### "))),
    },
    {
      key: "quote",
      label: t("disc.editor.quote"),
      icon: <Quote size={15} />,
      run: byMode(rich((c) => c.toggleBlockquote()), () => apply((doc, from, to) => linePrefixOp(doc, from, to, "> "))),
    },
    {
      key: "ul",
      label: t("disc.editor.bullet"),
      icon: <List size={15} />,
      run: byMode(rich((c) => c.toggleBulletList()), () => apply((doc, from, to) => linePrefixOp(doc, from, to, "- "))),
    },
    {
      key: "task",
      label: t("disc.editor.task"),
      icon: <ListTodo size={15} />,
      run: byMode(rich((c) => c.toggleTaskList()), () => apply((doc, from, to) => linePrefixOp(doc, from, to, "- [ ] "))),
    },
  ];

  const modes: { key: EditorMode; label: string; icon: React.ReactNode }[] = [
    { key: "rich", label: t("disc.editor.modeRich"), icon: <FileText size={13} /> },
    { key: "write", label: t("disc.editor.modeWrite"), icon: <Code2 size={13} /> },
  ];

  /** 리치 판의 저장·링크 단축키 — 원문은 Monaco 액션이 잡는다. */
  const onRichKeyDown = (e: React.KeyboardEvent) => {
    if (mode !== "rich" || !(e.metaKey || e.ctrlKey)) return;
    const key = e.key.toLowerCase();
    if (key === "s") {
      e.preventDefault();
      onSaveRef.current(textRef.current);
    } else if (key === "k") {
      e.preventDefault();
      richLink();
    }
  };

  const fmtNumber = (n: number) => n.toLocaleString();

  return (
    <div className="disc-edit">
      {confirmDialog}
      <div className="disc-edit-bar">
        <div className="disc-tool-group" role="toolbar" aria-label={t("disc.editor.toolbarAria")}>
          {fmt.map((b) => (
            <button
              key={b.key}
              type="button"
              className="iconbtn sm"
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
            className="btn ghost sm disc-insert"
            aria-haspopup="menu"
            aria-expanded={insertOpen}
            onClick={() => setInsertOpen((o) => !o)}
          >
            {t("disc.editor.insert")} <ChevronDown size={13} aria-hidden />
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

        <div className="seg disc-modes" role="tablist" aria-label={t("disc.editor.modeAria")}>
          {modes.map((m) => (
            <button
              key={m.key}
              type="button"
              role="tab"
              className="seg-item"
              aria-selected={mode === m.key}
              title={m.label}
              onClick={() => onModeChange(m.key)}
            >
              {m.icon}
              <span className="disc-mode-label">{m.label}</span>
            </button>
          ))}
        </div>

        <div className="disc-edit-right">
          <span className={`disc-dirty${dirty ? " on" : ""}`} aria-live="polite">
            {dirty ? t("disc.editor.unsaved") : t("disc.editor.savedState")}
          </span>
          <button
            type="button"
            className="btn sm"
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
            // 바뀐 것이 있을 때만 강조색 — 늘 초록이면 「누를 일이 있다」 는 신호가 사라진다.
            className={`btn sm${dirty ? " primary" : ""}`}
            {...blocked(dirty ? null : t("disc.blockedNoChanges"))}
            disabled={busy}
            onClick={() => onSave(mode === "write" ? (viewRef.current?.getValue() ?? text) : text)}
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

      <div className={`disc-edit-body ${mode}`} onKeyDown={onRichKeyDown}>
        <DiscussionOutline items={items} current={current} onJump={jumpTo} />
        {/* Monaco 는 리치 모드 동안 숨어서 산다 — 원문으로 돌아오면 리치에서 고친 글로 맞춘다. */}
        <div className="disc-edit-cm" ref={hostRef} />
        {mode === "rich" ? (
          <div className="disc-edit-rich" ref={richHostRef}>
            <RichMarkdownEditor
              key={richKey}
              initialText={text}
              placeholder={t("disc.editor.placeholder")}
              autoFocus
              onReady={(editor) => {
                richRef.current = editor;
              }}
              onChange={(value) => {
                textRef.current = value;
                setText(value);
                onTextChangeRef.current?.(value);
              }}
            />
          </div>
        ) : null}
      </div>

      <div className="disc-edit-status">
        <span className="disc-edit-status-section">
          {current >= 0 ? items[current].title : t("disc.editor.noSection")}
        </span>
        <span>{t("disc.editor.chars", { n: fmtNumber(stats.chars) })}</span>
        <span>{t("disc.editor.words", { n: fmtNumber(stats.words) })}</span>
        <span className="disc-edit-status-path" title={filePath}>
          {filePath}
        </span>
        <span className="disc-edit-status-keys">{t("disc.editor.shortcuts")}</span>
      </div>
    </div>
  );
}
