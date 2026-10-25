// 리치 마크다운 편집의 코덱 — 마크다운 ⇄ TipTap 문서 (2026-10-25, Orca 벤치마크).
//
// 계약은 하나다: **사람이 고치지 않은 블록은 한 글자도 바꾸지 않는다.**
// 이 앱이 여는 마크다운은 에이전트가 같이 읽고 쓰는 파일이라(일지·논의·README),
// 서식 표기가 조용히 바뀌면 그게 곧 git diff 소음이고 남의 편집을 지운 것처럼 보인다.
// 직렬화기는 표 칸을 맞추고 빈 줄·목록 기호를 제 식으로 쓴다 — 저장소의 .md 425개를
// 통째로 왕복시켜 보니 원문과 같은 것이 하나뿐이었다(2026-10-25 실측).
//
// 그래서 문서를 통째로 직렬화하지 않는다. 열 때 최상위 블록마다 원문(`raw`)을
// 기억해 두고([`parseWithSource`]), 저장할 때 **처음과 같은 블록은 그 원문을**,
// 고친 블록만 직렬화기로 쓴다([`serializeWithSource`]). Orca 의
// `rich-markdown-source-reconcile` 과 같은 발상을 블록 단위로 단순하게 했다.
//
// TipTap 이 모르는 원문 — HTML 주석·HTML 블록, 그리고 `<!-- x begin -->` 부터
// `<!-- x end -->` 까지의 관리 블록(논의 문서의 토의 로그) — 은 `rawBlock` 하나에
// 원문 그대로 실어 나른다. 편집기에서는 고칠 수 없는 칩으로 보인다.
//
// 머리 정보(frontmatter)는 여기 오기 전에 떼어 둔다 (`frontmatter.ts`).
import { getSchema, Node, type AnyExtension, type JSONContent } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import { MarkdownManager } from "@tiptap/markdown";
import { Lexer } from "marked";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";

/** 관리 블록 — `<!-- name begin … -->` … `<!-- name end -->` 를 한 덩어리로. */
const MANAGED_BLOCK = /^<!--\s*([\w:.-]+)\s+begin\b[^\n]*-->\n[\s\S]*?^<!--\s*\1\s+end\b[^\n]*-->/gm;

/** 관리 블록을 갈아 끼운 자리표 — 렉서는 이걸 HTML 블록 하나로 읽는다. */
const slotOf = (i: number) => `<!--oculpm-raw:${i}-->`;
const SLOT_RE = /^<!--oculpm-raw:(\d+)-->/;

/**
 * 원문 블록 — TipTap 이 모르는 블록을 원문 그대로 들고 다닌다.
 *
 * `atom` 이라 커서가 안으로 들어가지 않는다. 지울 수는 있다(사람이 일부러 고른 것).
 */
export const RawBlock = Node.create({
  name: "rawBlock",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return { source: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "div[data-raw-block]" }];
  },
  renderHTML({ node }) {
    return ["div", { "data-raw-block": "", class: "rich-raw" }, node.attrs.source as string];
  },
  markdownTokenName: "html",
  parseMarkdown(token) {
    return { type: "rawBlock", attrs: { source: (token.raw ?? "").replace(/\n+$/, "") } };
  },
  renderMarkdown(node) {
    return (node.attrs?.source as string | undefined) ?? "";
  },
});

/** 편집기와 코덱이 같은 확장 목록을 쓴다 — 둘이 다르면 원문 대조가 어긋난다. */
export function richExtensions(extra: AnyExtension[] = []): AnyExtension[] {
  return [
    StarterKit.configure({
      // 마크다운에 밑줄 문법이 없다 — 켜 두면 저장할 때 비표준 표기가 나온다.
      underline: false,
      link: { openOnClick: false, autolink: true },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    RawBlock,
    ...extra,
  ];
}

let manager: MarkdownManager | null = null;
let schema: Schema | null = null;
function md(): MarkdownManager {
  manager ??= new MarkdownManager({ markedOptions: { gfm: true }, extensions: richExtensions() });
  return manager;
}
function sch(): Schema {
  schema ??= getSchema(richExtensions());
  return schema;
}

/** 노드의 대조 열쇠 — 스키마를 거쳐 기본 속성까지 채운 JSON. 편집기의 getJSON() 과 같은 꼴. */
function keyOf(node: JSONContent): string {
  return JSON.stringify(sch().nodeFromJSON(node).toJSON());
}

/** 원문 한 토막 — 렉서 토큰 하나가 낳은 최상위 노드들과 그 원문(뒤따르는 빈 줄 포함). */
interface Run {
  keys: string[];
  raw: string;
}

/** 열 때 기억해 둔 원문 지도 — [`serializeWithSource`] 가 고치지 않은 블록을 되찾는 데 쓴다. */
export interface SourceMap {
  /** 첫 블록 앞의 빈 줄. */
  lead: string;
  runs: Run[];
  /** 원문 끝의 줄바꿈 꼴. */
  tail: string;
}

/** 토큰 하나의 원문을 문서 노드로 — 아무 노드도 안 나오면(참조 정의 등) 원문 블록으로. */
function nodesOf(raw: string): JSONContent[] {
  const parsed = md().parse(raw).content ?? [];
  const nodes = parsed.filter((n) => !(n.type === "paragraph" && !n.content?.length));
  return nodes.length ? nodes : [{ type: "rawBlock", attrs: { source: raw.replace(/\n+$/, "") } }];
}

/**
 * 마크다운 본문 → TipTap 문서 + 원문 지도.
 *
 * 렉서의 최상위 토큰을 하나씩 따로 읽는다. 통째로 읽으면 노드와 원문 토막을 짝지을
 * 방법이 없다. 대가로 문서 전체에 걸친 것(참조 링크의 정의)은 그 토막 안에서만
 * 보인다 — 고치지 않은 블록은 원문으로 나가므로 저장에는 영향이 없다.
 */
export function parseWithSource(body: string): { doc: JSONContent; source: SourceMap } {
  const slots: string[] = [];
  const text = body.replace(MANAGED_BLOCK, (block) => {
    slots.push(block);
    return slotOf(slots.length - 1);
  });
  // 블록 나누기는 TipTap 이 손대지 않은 **표준** 렉서로 한다. TipTap 이 끼워 넣은
  // 표 토크나이저는 칸 수가 어긋난 표의 `raw` 를 글자마다 줄바꿈으로 망가뜨려
  // (docs/optimization/00-ledger.md, 2026-10-25) 원문 토막을 이어 붙여도 원문이 안 됐다.
  const tokens = new Lexer({ gfm: true }).lex(text);
  const runs: Run[] = [];
  const content: JSONContent[] = [];
  let lead = "";
  for (const token of tokens) {
    if (token.type === "space") {
      if (runs.length) runs[runs.length - 1].raw += token.raw;
      else lead += token.raw;
      continue;
    }
    const slot = SLOT_RE.exec(token.raw);
    // 자리표가 코드 펜스 같은 다른 토큰 **안**에 들었으면(규격 문서의 예시) 거기서도
    // 되돌린다 — 그 토큰은 평소처럼 읽힌다.
    const raw = token.raw.replace(/<!--oculpm-raw:(\d+)-->/g, (_, n: string) => slots[Number(n)]);
    const nodes = slot
      ? [{ type: "rawBlock", attrs: { source: slots[Number(slot[1])] } }]
      : nodesOf(raw);
    runs.push({ keys: nodes.map(keyOf), raw });
    content.push(...nodes);
  }
  const tail = /\n*$/.exec(body)?.[0] ?? "";
  return { doc: { type: "doc", content }, source: { lead, runs, tail } };
}

/**
 * TipTap 문서 → 마크다운 본문. 처음과 같은 블록은 기억해 둔 원문을, 나머지만
 * 직렬화한다. 같은 내용의 블록이 여럿이면 앞에서부터 차례로 짝짓는다.
 */
export function serializeWithSource(doc: JSONContent, source: SourceMap): string {
  const nodes = (doc.content ?? []).filter((n) => !(n.type === "paragraph" && !n.content?.length));
  const keys = nodes.map(keyOf);
  const pool = new Map<string, Run[]>();
  for (const run of source.runs) {
    const list = pool.get(run.keys[0]) ?? [];
    list.push(run);
    pool.set(run.keys[0], list);
  }
  let out = source.lead;
  let body = ""; // lead 뒤로 쓴 것 — 새 블록 앞에 빈 줄이 필요한지는 이것만 본다
  let i = 0;
  while (i < nodes.length) {
    const candidates = pool.get(keys[i]) ?? [];
    const hit = candidates.findIndex((run) => run.keys.every((k, j) => keys[i + j] === k));
    if (hit >= 0) {
      // 처음과 같은 블록 — 원문 그대로. 원문 토막끼리는 원문의 간격을 그대로 잇는다.
      const [run] = candidates.splice(hit, 1);
      body += run.raw;
      i += run.keys.length;
      continue;
    }
    const written = md().serialize({ type: "doc", content: [nodes[i]] }).replace(/\n+$/, "");
    body += gapBefore(body) + written + "\n\n";
    i += 1;
  }
  out += body;
  return body.trim() ? out.replace(/\n*$/, "") + source.tail : "";
}

/**
 * 새 블록 앞의 줄바꿈 — 빈 줄이 없으면 새 블록이 앞 문단에 이어 붙는다(마크다운의
 * lazy continuation). 앞 원문 토막이 줄 하나로만 끝났으면 하나를 더한다.
 */
function gapBefore(sofar: string): string {
  if (!sofar || sofar.endsWith("\n\n")) return "";
  return sofar.endsWith("\n") ? "\n" : "\n\n";
}

/** 열자마자 저장한 결과 — 원문 지도가 제 몫을 하면 언제나 원문과 같다 (테스트가 지킨다). */
export function roundTrip(body: string): string {
  const { doc, source } = parseWithSource(body);
  return serializeWithSource(doc, source);
}
