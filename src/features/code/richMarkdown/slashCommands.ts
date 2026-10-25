// `/` 블록 메뉴의 항목과 판독 — 순수 모듈 (편집기 없이 테스트된다).
import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import type { I18nKey } from "@/i18n";

export type SlashId =
  | "h1"
  | "h2"
  | "h3"
  | "bullet"
  | "ordered"
  | "task"
  | "quote"
  | "code"
  | "table"
  | "rule";

export interface SlashItem {
  id: SlashId;
  /** i18n 키 — 이름과 한 줄 설명. */
  labelKey: I18nKey;
  hintKey: I18nKey;
  /** 영문 별칭 — `/todo`·`/h2` 처럼 손에 익은 말로도 찾게. */
  aliases: string[];
  /** 메뉴 칸의 글리프 — 아이콘 대신 마크다운이 실제로 쓰는 표기를 보여 준다. */
  glyph: string;
  run: (editor: Editor, range: { from: number; to: number }) => void;
}

const chain = (editor: Editor, range: { from: number; to: number }) =>
  editor.chain().focus().deleteRange(range);

export const SLASH_ITEMS: readonly SlashItem[] = [
  { id: "h1", labelKey: "rich.slash.h1", hintKey: "rich.slash.h1Hint", aliases: ["h1", "title", "heading"], glyph: "#", run: (e, r) => chain(e, r).toggleHeading({ level: 1 }).run() },
  { id: "h2", labelKey: "rich.slash.h2", hintKey: "rich.slash.h2Hint", aliases: ["h2", "heading"], glyph: "##", run: (e, r) => chain(e, r).toggleHeading({ level: 2 }).run() },
  { id: "h3", labelKey: "rich.slash.h3", hintKey: "rich.slash.h3Hint", aliases: ["h3", "heading"], glyph: "###", run: (e, r) => chain(e, r).toggleHeading({ level: 3 }).run() },
  { id: "task", labelKey: "rich.slash.task", hintKey: "rich.slash.taskHint", aliases: ["todo", "task", "check"], glyph: "[ ]", run: (e, r) => chain(e, r).toggleTaskList().run() },
  { id: "bullet", labelKey: "rich.slash.bullet", hintKey: "rich.slash.bulletHint", aliases: ["list", "bullet", "ul"], glyph: "-", run: (e, r) => chain(e, r).toggleBulletList().run() },
  { id: "ordered", labelKey: "rich.slash.ordered", hintKey: "rich.slash.orderedHint", aliases: ["number", "ordered", "ol"], glyph: "1.", run: (e, r) => chain(e, r).toggleOrderedList().run() },
  { id: "table", labelKey: "rich.slash.table", hintKey: "rich.slash.tableHint", aliases: ["table", "grid"], glyph: "|", run: (e, r) => chain(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { id: "code", labelKey: "rich.slash.code", hintKey: "rich.slash.codeHint", aliases: ["code", "pre", "fence"], glyph: "```", run: (e, r) => chain(e, r).toggleCodeBlock().run() },
  { id: "quote", labelKey: "rich.slash.quote", hintKey: "rich.slash.quoteHint", aliases: ["quote", "blockquote"], glyph: ">", run: (e, r) => chain(e, r).toggleBlockquote().run() },
  { id: "rule", labelKey: "rich.slash.rule", hintKey: "rich.slash.ruleHint", aliases: ["hr", "divider", "rule", "line"], glyph: "---", run: (e, r) => chain(e, r).setHorizontalRule().run() },
];

/** 커서 바로 앞의 `/검색어` — 없으면 `null`. 코드 블록 안과 선택 중에는 열지 않는다. */
export function readSlashQuery(state: EditorState): { from: number; to: number; query: string } | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const { $from } = selection;
  if ($from.parent.type.spec.code) return null;
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
  const m = /(?:^|\s)\/([^\s/]{0,24})$/.exec(before);
  if (!m) return null;
  return { from: $from.pos - m[1].length - 1, to: $from.pos, query: m[1] };
}

/** 검색어로 거른 항목 — 이름(번역된 것)이나 영문 별칭의 앞부분·포함 일치. */
export function filterSlashItems(query: string, label: (key: I18nKey) => string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...SLASH_ITEMS];
  return SLASH_ITEMS.filter(
    (item) => label(item.labelKey).toLowerCase().includes(q) || item.aliases.some((a) => a.startsWith(q)),
  );
}
