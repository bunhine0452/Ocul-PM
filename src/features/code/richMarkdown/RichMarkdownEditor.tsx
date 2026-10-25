import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import { EditorContent, useEditor } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";

import { useT } from "@/i18n";
import { AnchorMarks } from "./anchorMarks";
import { parseWithSource, richExtensions, serializeWithSource } from "./codec";
import { frontmatterKeys, joinFrontmatter, splitFrontmatter } from "./frontmatter";
import { filterSlashItems, readSlashQuery, type SlashItem } from "./slashCommands";
import "./rich-markdown.css";

// 노션식 마크다운 편집기 (2026-10-25, Orca 벤치마크) — 코드 화면의 .md 와 논의 편집기가 쓴다.
//
// 마운트 후엔 언컨트롤드다 (`CodeEditor.tsx` 와 같은 원칙): 부모는 초깃값만 주고,
// 문서를 바꿔 끼울 땐 `key` 로 재마운트한다. 바뀔 때마다 **파일 전체 글**을 올린다 —
// 머리 정보는 원문 그대로 앞에 붙고, 고치지 않은 블록은 원문 그대로다 (`codec.ts`).
//
// 저장 단축키는 여기서 잡지 않는다. 두 부모 모두 창 레벨 ⌘S 를 이미 듣는다.

interface Props {
  initialText: string;
  onChange: (text: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** 편집기 인스턴스 — 바깥 도구 막대(논의 편집기의 서식 버튼)가 명령을 부른다. */
  onReady?: (editor: Editor | null) => void;
}

/** 커서 아래 화면 좌표 — 레이아웃이 없는 곳(테스트)에서는 0. */
function caretBelow(view: EditorView, pos: number): { top: number; left: number } {
  try {
    const at = view.coordsAtPos(pos);
    return { top: at.bottom + 4, left: at.left };
  } catch {
    return { top: 0, left: 0 };
  }
}

interface SlashState {
  from: number;
  to: number;
  query: string;
  top: number;
  left: number;
}

export function RichMarkdownEditor({ initialText, onChange, placeholder, autoFocus, onReady }: Props) {
  const { t } = useT();
  // 마운트 1회 — 원문 지도는 이 판의 것이다. 바깥 판으로 바꿀 땐 부모가 재마운트한다.
  const opened = useMemo(() => {
    const { frontmatter, body } = splitFrontmatter(initialText);
    return { frontmatter, ...parseWithSource(body) };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 시점의 글만 읽는다
  }, []);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [slash, setSlash] = useState<SlashState | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  // Escape 로 닫은 자리 — 같은 `/` 위에서 다시 열지 않는다.
  const dismissedAt = useRef<number | null>(null);
  const lastQuery = useRef<string | null>(null);
  const slashRef = useRef<{ items: SlashItem[]; state: SlashState | null; index: number }>({
    items: [],
    state: null,
    index: 0,
  });

  const editor = useEditor({
    extensions: richExtensions([AnchorMarks, Placeholder.configure({ placeholder: placeholder ?? t("rich.placeholder") })]),
    content: opened.doc,
    autofocus: autoFocus ? "start" : false,
    // 첫 렌더를 동기로 — 재마운트 때 빈 판이 한 프레임 비치지 않게.
    immediatelyRender: true,
    editorProps: {
      attributes: { class: "rich-md-doc", spellcheck: "false" },
      handleKeyDown: (_view, event) => {
        const { items, state, index } = slashRef.current;
        if (!state || !items.length) return false;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          const step = event.key === "ArrowDown" ? 1 : -1;
          setSlashIndex((index + step + items.length) % items.length);
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          pick(items[index]);
          return true;
        }
        if (event.key === "Escape") {
          dismissedAt.current = state.from;
          setSlash(null);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      onChangeRef.current(
        joinFrontmatter(opened.frontmatter, serializeWithSource(ed.getJSON(), opened.source)),
      );
    },
    onTransaction: ({ editor: ed }) => {
      const q = readSlashQuery(ed.state);
      if (!q) dismissedAt.current = null;
      if (!q || q.from === dismissedAt.current) {
        lastQuery.current = null;
        setSlash(null);
        return;
      }
      if (lastQuery.current !== q.query) {
        lastQuery.current = q.query;
        setSlashIndex(0);
      }
      setSlash({ ...q, ...caretBelow(ed.view, q.to) });
    },
  });

  const items = useMemo(() => (slash ? filterSlashItems(slash.query, t) : []), [slash, t]);
  slashRef.current = { items, state: slash, index: Math.min(slashIndex, Math.max(0, items.length - 1)) };

  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => {
    onReadyRef.current?.(editor);
    return () => onReadyRef.current?.(null);
  }, [editor]);

  // 키 처리기는 편집기를 만들 때 한 번 굳는다 — 편집기는 ref 로 읽는다.
  const editorRef = useRef(editor);
  editorRef.current = editor;
  function pick(item: SlashItem | undefined) {
    const state = slashRef.current.state;
    const ed = editorRef.current;
    if (!ed || !item || !state) return;
    item.run(ed, { from: state.from, to: state.to });
    setSlash(null);
  }

  const keys = useMemo(() => frontmatterKeys(opened.frontmatter), [opened.frontmatter]);
  const [fmOpen, setFmOpen] = useState(false);

  return (
    <div className="rich-md">
      <div className="rich-md-page">
        {opened.frontmatter ? (
          <div className="rich-md-fm">
            <button
              type="button"
              className="rich-md-fm-chip"
              aria-expanded={fmOpen}
              onClick={() => setFmOpen((v) => !v)}
              title={t("rich.frontmatterHint")}
            >
              <span aria-hidden="true">{fmOpen ? "▾" : "▸"}</span>
              {t("rich.frontmatter")}
              {keys.length ? <span className="rich-md-fm-keys">{keys.join(", ")}</span> : null}
            </button>
            {fmOpen ? <pre className="rich-md-fm-raw">{opened.frontmatter.trimEnd()}</pre> : null}
          </div>
        ) : null}
        <EditorContent editor={editor} />
      </div>
      {slash && items.length ? (
        <div
          className="rich-slash"
          role="listbox"
          aria-label={t("rich.slash.title")}
          style={{ top: slash.top, left: slash.left }}
          // 메뉴를 누르는 순간 편집기가 포커스를 잃어 선택이 사라지지 않게.
          onMouseDown={(e) => e.preventDefault()}
        >
          {items.map((item, i) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={i === slashRef.current.index}
              className="rich-slash-item"
              onMouseEnter={() => setSlashIndex(i)}
              onClick={() => pick(item)}
            >
              <span className="rich-slash-glyph" aria-hidden="true">
                {item.glyph}
              </span>
              <span className="rich-slash-text">
                <span className="rich-slash-label">{t(item.labelKey)}</span>
                <span className="rich-slash-hint">{t(item.hintKey)}</span>
              </span>
            </button>
          ))}
          <span className="rich-slash-foot">{t("rich.slash.foot")}</span>
        </div>
      ) : null}
    </div>
  );
}
