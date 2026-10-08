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

import { Markdown } from "@/components/Markdown";
import {
  AlertTriangle,
  Bold,
  ChevronDown,
  Code2,
  Columns2,
  Eye,
  Heading2,
  Italic,
  Link2,
  List,
  ListTodo,
  Pencil,
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
import { outlineIndexAt, parseOutline, previewText, textStats, type OutlineItem } from "./outline";
import { keepProseCentered, PROSE_OPTIONS } from "./proseEditor";
import "./discussion-editor.css";

/** 프리뷰 재렌더 지연 — 타이핑 중 마크다운 파싱이 키 입력을 붙잡지 않게. */
const PREVIEW_DEBOUNCE_MS = 180;

export type EditorMode = "write" | "split" | "preview";

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

/** 미리보기 안의 제목들 — 개요(`parseOutline`)와 같은 순서다. */
const PREVIEW_HEADINGS = ".disc-doc-prose h2, .disc-doc-prose h3";

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
  const previewRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MonacoNs.editor.IStandaloneCodeEditor | null>(null);
  const [text, setText] = useState(initialText);
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
  // 미리보기만 보일 땐 커서가 움직이지 않는다 — 그때의 「현재」 는 스크롤 위치다.
  const [previewIndex, setPreviewIndex] = useState(-1);
  /** 개요에서 막 고른 항목 — 그 이동이 낳은 스크롤 한 번은 위치 대신 이 값을 쓴다. */
  const pinnedRef = useRef<number | null>(null);
  const current = mode === "preview" ? previewIndex : outlineIndexAt(items, cursorLine);
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
    editor.focus();

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

  /**
   * 나란히 보기의 스크롤 맞춤 — 원문이 움직이면 미리보기가 따라온다.
   *
   * 비율(스크롤 위치 ÷ 전체 높이)로만 맞추면 표·목록이 긴 섹션에서 두 판이 크게
   * 어긋난다. 그래서 **섹션을 닻으로** 삼는다: 원문 맨 윗줄이 속한 제목을 찾고, 그
   * 제목 사이에서 얼마나 내려왔는지를 미리보기의 같은 두 제목 사이에 옮긴다. 제목
   * 수가 아직 안 맞으면(미리보기는 한 박자 늦다) 비율로 떨어진다.
   */
  useEffect(() => {
    const editor = viewRef.current;
    const pane = previewRef.current;
    if (!editor || !pane || mode !== "split") return;
    const sync = () => {
      const top = editor.getVisibleRanges()[0]?.startLineNumber ?? 1;
      const list = itemsRef.current;
      const heads = pane.querySelectorAll<HTMLElement>(PREVIEW_HEADINGS);
      const max = pane.scrollHeight - pane.clientHeight;
      const idx = outlineIndexAt(list, top);
      if (idx < 0 || heads.length !== list.length) {
        const room = editor.getScrollHeight() - editor.getLayoutInfo().height;
        pane.scrollTop = room > 0 ? (editor.getScrollTop() / room) * max : 0;
        return;
      }
      const from = list[idx].line;
      const to = list[idx + 1]?.line ?? (editor.getModel()?.getLineCount() ?? from) + 1;
      const frac = Math.min(1, Math.max(0, (top - from) / Math.max(1, to - from)));
      const a = heads[idx].offsetTop;
      const b = heads[idx + 1]?.offsetTop ?? pane.scrollHeight;
      pane.scrollTop = Math.min(max, Math.max(0, a + frac * (b - a) - 16));
    };
    const sub = editor.onDidScrollChange((e) => {
      if (e.scrollTopChanged) sync();
    });
    sync();
    return () => sub.dispose();
  }, [mode]);

  useEffect(() => {
    const pane = previewRef.current;
    if (!pane || mode !== "preview") return;
    const onScroll = () => {
      if (pinnedRef.current !== null) {
        setPreviewIndex(pinnedRef.current);
        pinnedRef.current = null;
        return;
      }
      const heads = pane.querySelectorAll<HTMLElement>(PREVIEW_HEADINGS);
      // 끝까지 내렸으면 마지막 섹션들은 맨 위로 올라올 수 없다 — 그때는 보이는 마지막 제목.
      const atEnd = pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 2;
      const line = atEnd ? pane.scrollTop + pane.clientHeight - 48 : pane.scrollTop + 24;
      let idx = -1;
      heads.forEach((h, i) => {
        if (h.offsetTop <= line) idx = i;
      });
      setPreviewIndex(idx);
    };
    onScroll();
    pane.addEventListener("scroll", onScroll, { passive: true });
    return () => pane.removeEventListener("scroll", onScroll);
  }, [mode, preview]);

  /** 개요에서 고른 제목으로 간다 — 미리보기만 보일 땐 미리보기를, 아니면 원문을 옮긴다. */
  const jumpTo = (index: number) => {
    const item = items[index];
    if (!item) return;
    if (mode === "preview") {
      pinnedRef.current = index;
      setPreviewIndex(index);
      previewRef.current?.querySelectorAll<HTMLElement>(PREVIEW_HEADINGS)[index]?.scrollIntoView({ block: "start" });
      return;
    }
    const editor = viewRef.current;
    if (!editor) return;
    editor.revealLineNearTop(item.line);
    editor.setPosition({ lineNumber: item.line, column: 1 });
    editor.focus();
  };

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

      <div className={`disc-edit-body ${mode}`}>
        {/* 나란히 보기에선 두 판이 폭을 나눠 쓴다 — 개요는 쓰기·미리보기에서만. */}
        {mode === "split" ? null : <DiscussionOutline items={items} current={current} onJump={jumpTo} />}
        <div className="disc-edit-cm" ref={hostRef} />
        {mode === "write" ? null : (
          <div className="disc-edit-preview" ref={previewRef}>
            <div className="disc-doc-prose">
              {/* `{#id}`·로그 경계 주석은 파서가 읽는 뼈대라 원문엔 두고, 읽는 판에선 걷는다. */}
              <Markdown>{previewText(preview) || t("disc.preview")}</Markdown>
            </div>
          </div>
        )}
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
