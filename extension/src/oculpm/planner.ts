// 플랜 파일 파서 — `src-tauri/src/oculpm/planner/parse.rs` 의 `parse_plan` 을
// 읽기 전용으로 옮긴 것. 글리프 6종·`{#id}` 앵커(`anchor_span` — 메모 앞의 마지막)·
// ⟶/-> 메모·끝의 `@…` 귀속·2칸(또는 탭) 들여쓰기 = 하위·줄바꿈된 항목 접기·
// 부모 롤업·plan-log 블록 파싱만 하고 **아무것도 쓰지 않는다**(쓰기는 oculpm-mcp
// 의 plan_update). 앵커·결정 헤딩 규칙은 Rust 와 같은 사례표
// (`src-tauri/src/oculpm/planner/parser_parity_cases.json`)로 대조된다.
import { scalar, splitFrontmatter } from "./frontmatter";

export type PlanStatus = "active" | "done" | "archived";
export type ItemStatus = "todo" | "in_progress" | "done" | "blocked" | "deferred" | "dropped";

/** 글리프 ↔ 상태. Rust `ItemStatus::from_token`. */
export const GLYPHS: Record<string, ItemStatus> = {
  "": "todo",
  " ": "todo",
  "~": "in_progress",
  x: "done",
  X: "done",
  "!": "blocked",
  ">": "deferred",
  "-": "dropped",
};

export interface PlanItem {
  itemId: string;
  phase?: string;
  title: string;
  /** 하위가 있는 부모는 롤업 파생값(파일 글리프가 아니라). */
  status: ItemStatus;
  orderIdx: number;
  parentItem?: string;
  note?: string;
}

export interface PlanPhase {
  id?: string;
  name: string;
  orderIdx: number;
}

export interface PlanLogRow {
  ts: string;
  itemId: string;
  agentId: string;
  change: string;
  journal: string;
  note: string;
}

export interface ParsedPlan {
  id: string;
  title: string;
  status: PlanStatus;
  owner: string;
  created?: string;
  updated?: string;
  items: PlanItem[];
  phases: PlanPhase[];
  log: PlanLogRow[];
  warnings: string[];
}

const DECISIONS_HEADINGS = new Set([
  "결정", "결정사항", "결정 사항", "주요 결정", "결정 기록", "결정 로그",
  "decision", "decisions", "decision log", "decision records",
]);

export function parsePlan(markdown: string, fallbackId: string): ParsedPlan {
  const warnings: string[] = [];
  // 윈도우 체크아웃(`core.autocrlf`)의 CRLF 도 LF 로 편 뒤 읽는다 — Rust
  // `eol::to_lf`. 안 펴면 접힌 항목 제목 가운데에 `\r` 이 박힌다.
  const { parsed, body: rawBody } = splitFrontmatter(markdown.replace(/\r\n/g, "\n"));
  const body = foldWrappedItems(rawBody);
  const fm = parsed ?? {};
  const status = scalar(fm.status);
  const plan: ParsedPlan = {
    id: scalar(fm.id) ?? fallbackId,
    title: scalar(fm.title) ?? "",
    status: status === "done" || status === "archived" ? status : "active",
    owner: scalar(fm.owner) ?? "unknown",
    created: scalar(fm.created),
    updated: scalar(fm.updated),
    items: [],
    phases: [],
    log: [],
    warnings,
  };
  if (status !== undefined && plan.status !== status) {
    warnings.push(`unknown plan status '${status}'; defaulting to active`);
  }

  const seen = new Set<string>();
  let section: "phases" | "decisions" = "phases";
  let curPhase: string | undefined;
  let lastTop: string | undefined;
  let inLog = false;
  let firstH1: string | undefined;
  let order = 0;

  for (const line of body.split("\n")) {
    const t = line.trimStart();
    if (t.startsWith("<!-- oculpm:plan-log begin")) {
      inLog = true;
      continue;
    }
    if (t.startsWith("<!-- oculpm:plan-log end")) {
      inLog = false;
      continue;
    }
    if (inLog) {
      const row = parseLogRow(t);
      if (row) {
        plan.log.push(row);
      }
      continue;
    }
    if (t.startsWith("## ")) {
      const { text, id } = extractBraceId(t.slice(3).trim());
      const h = text.trim();
      if (isDecisionsHeading(h)) {
        section = "decisions";
        curPhase = undefined;
      } else {
        section = "phases";
        curPhase = h;
        plan.phases.push({ id, name: h, orderIdx: plan.phases.length });
      }
      lastTop = undefined;
      continue;
    }
    if (t.startsWith("### ")) {
      lastTop = undefined;
      continue;
    }
    if (t.startsWith("# ")) {
      firstH1 ??= t.slice(2).trim();
      continue;
    }
    if (section !== "phases") {
      continue;
    }
    const item = parseItemLine(line, curPhase, order, lastTop, seen, warnings);
    if (!item) {
      continue;
    }
    if (item.parentItem === undefined) {
      lastTop = item.itemId;
    }
    plan.items.push(item);
    order += 1;
  }

  if (plan.title === "") {
    if (firstH1 !== undefined) {
      plan.title = stripPlanPrefix(firstH1);
    } else {
      warnings.push("plan title missing; using id");
      plan.title = plan.id;
    }
  }

  const kids = new Map<string, ItemStatus[]>();
  for (const it of plan.items) {
    if (it.parentItem !== undefined) {
      const arr = kids.get(it.parentItem) ?? [];
      arr.push(it.status);
      kids.set(it.parentItem, arr);
    }
  }
  for (const it of plan.items) {
    const k = kids.get(it.itemId);
    if (k) {
      it.status = rollupStatus(k);
    }
  }
  return plan;
}

/** Rust `rollup_status` 와 동일: dropped 제외 → 빈 집합이면 dropped, blocked 우선, 균일값, 그 외 in_progress. */
export function rollupStatus(children: ItemStatus[]): ItemStatus {
  const live = children.filter((s) => s !== "dropped");
  if (live.length === 0) {
    return "dropped";
  }
  if (live.includes("blocked")) {
    return "blocked";
  }
  for (const uniform of ["done", "todo", "deferred"] as const) {
    if (live.every((s) => s === uniform)) {
      return uniform;
    }
  }
  return "in_progress";
}

function parseItemLine(
  line: string,
  phase: string | undefined,
  order: number,
  lastTop: string | undefined,
  seen: Set<string>,
  warnings: string[],
): PlanItem | null {
  const t = line.trimStart();
  const ws = line.slice(0, line.length - t.length);
  const indent = ws.includes("\t") ? 2 : ws.length;
  let rest: string;
  if (t.startsWith("- ")) {
    rest = t.slice(2).trimStart();
  } else if (t.startsWith("* ")) {
    rest = t.slice(2).trimStart();
  } else {
    return null;
  }
  if (!rest.startsWith("[")) {
    return null;
  }
  const close = rest.indexOf("]");
  if (close < 0) {
    return null;
  }
  const token = rest.slice(1, close).trim();
  let status = GLYPHS[token];
  if (status === undefined) {
    warnings.push(`unknown item glyph '[${token}]'; defaulting to todo`);
    status = "todo";
  }
  const afterId = extractBraceId(rest.slice(close + 1).trim());
  const afterNote = extractNote(afterId.text);
  const title = stripTrailingAttr(afterNote.text).trim();

  let itemId: string;
  if (afterId.id !== undefined) {
    itemId = dedupId(afterId.id, seen);
  } else {
    warnings.push(`item '${title}' has no {#id}; generated one`);
    const s = slugify(title);
    itemId = dedupId(s === "" ? `item-${order}` : s, seen);
  }
  return {
    itemId,
    phase,
    title,
    status,
    orderIdx: order,
    parentItem: indent >= 2 ? lastTop : undefined,
    note: afterNote.note,
  };
}

/** 앵커 `{#…}` 를 떼어낸다 — Rust `extract_brace_id`. 어느 것이 앵커인지는
 *  {@link anchorSpan} 이 정하고, 나머지 `{#…}` 글자는 제목에 남는다. */
export function extractBraceId(s: string): { text: string; id?: string } {
  const span = anchorSpan(s);
  if (span === undefined) {
    return { text: s };
  }
  const [start, end] = span;
  const id = s.slice(start + 2, end).trim();
  const text = s.slice(0, start) + s.slice(end + 1);
  return id === "" ? { text } : { text, id };
}

/**
 * 앵커 자리 `[{ 의 위치, } 의 위치]` — Rust `anchor_span`. 규격상 앵커는 줄 **끝**
 * (뒤에는 `⟶ 메모`·`@귀속` 만 온다)이라 메모 앞의 **마지막** `{#…}` 를 읽고, 메모
 * 앞에 없으면(`제목 ⟶ 메모 {#id}`) 줄 전체의 마지막을 읽는다. 첫 것을 읽던 동안
 * 제목 본문의 `` `{#id}` `` 같은 글자가 항목 id 를 가로챘다.
 */
function anchorSpan(s: string): [number, number] | undefined {
  const marker = noteMarker(s);
  const head = marker === undefined ? s : s.slice(0, marker[0]);
  return lastBrace(head) ?? lastBrace(s);
}

/** `s` 안의 마지막 닫힌 `{#…}` — 닫는 `}` 도 `s` 안에 있어야 한다. */
function lastBrace(s: string): [number, number] | undefined {
  let hay = s;
  for (;;) {
    const start = hay.lastIndexOf("{#");
    if (start < 0) {
      return undefined;
    }
    const end = s.indexOf("}", start);
    if (end >= 0) {
      return [start, end];
    }
    hay = hay.slice(0, start);
  }
}

/** 메모 표시(`⟶`, 없으면 `->`)의 자리와 길이 — Rust `note_marker`. */
function noteMarker(s: string): [number, number] | undefined {
  const arrow = s.indexOf("⟶");
  if (arrow >= 0) {
    return [arrow, "⟶".length];
  }
  const ascii = s.indexOf("->");
  return ascii >= 0 ? [ascii, 2] : undefined;
}

function extractNote(s: string): { text: string; note?: string } {
  const marker = noteMarker(s);
  if (marker === undefined) {
    return { text: s };
  }
  const [idx, len] = marker;
  const note = s.slice(idx + len).trim();
  return { text: s.slice(0, idx), note: note === "" ? undefined : note };
}

function stripTrailingAttr(s: string): string {
  const trimmed = s.trimEnd();
  const at = trimmed.lastIndexOf(" @");
  if (at < 0) {
    return s;
  }
  const tail = trimmed.slice(at + 2);
  if (tail === "" || /\s/.test(tail)) {
    return s;
  }
  return trimmed.slice(0, at);
}

function dedupId(base: string, seen: Set<string>): string {
  if (!seen.has(base)) {
    seen.add(base);
    return base;
  }
  for (let n = 2; ; n += 1) {
    const c = `${base}-${n}`;
    if (!seen.has(c)) {
      seen.add(c);
      return c;
    }
  }
}

/** 앵커 없는 항목의 생성 id. **Rust `slugify` 와 다르다** — 여기만 40자에서 자른다.
 *  그래서 긴 제목의 앵커 없는 항목은 앱과 확장에서 id 가 갈릴 수 있고, 대조 사례표
 *  (`parser_parity_cases.json`)에는 앵커 없는 줄을 넣지 않았다. 통일은 별도 작업. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** 결정 섹션 헤딩(이름 **전체**) — Rust `heading::is_decisions_heading`: 끝의 괄호
 *  주석(`(…)`·`（…）`)을 떼고, 끝의 `: . · — -` 를 다듬은 뒤 표와 비교한다. */
function isDecisionsHeading(h: string): boolean {
  let s = h.trim();
  if (s.endsWith(")") || s.endsWith("）")) {
    const open = Math.max(s.lastIndexOf("("), s.lastIndexOf("（"));
    if (open >= 0) {
      s = s.slice(0, open).trimEnd();
    }
  }
  const norm = s.replace(/[:.·—-]+$/u, "").trim().toLowerCase();
  return DECISIONS_HEADINGS.has(norm);
}

function stripPlanPrefix(h1: string): string {
  return h1.replace(/^(plan|계획)\s*[—:-]\s*/i, "").trim();
}

/** 이어진 줄(들여쓴 비-항목 텍스트)을 앞 항목에 붙인다 — Rust `fold_wrapped_items`. */
export function foldWrappedItems(body: string): string {
  const out: string[] = [];
  let prevWasItem = false;
  for (const line of body.split("\n")) {
    const t = line.trimStart();
    const isItem = t.startsWith("- [") || t.startsWith("* [");
    const indented = line.startsWith(" ") || line.startsWith("\t");
    const cont =
      prevWasItem && indented && t !== "" &&
      !t.startsWith("- ") && !t.startsWith("* ") && !t.startsWith("#") &&
      !t.startsWith("|") && !t.startsWith("<!--") && !t.startsWith(">");
    if (cont && out.length > 0) {
      out[out.length - 1] += ` ${t}`;
    } else {
      out.push(line);
      prevWasItem = isItem;
    }
  }
  return out.join("\n");
}

function parseLogRow(line: string): PlanLogRow | null {
  if (!line.startsWith("|")) {
    return null;
  }
  const cells = line.split("|").slice(1, -1).map((c) => c.trim());
  if (cells.length < 4 || cells.every((c) => /^-*$/.test(c))) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(cells[0])) {
    return null; // 헤더 행
  }
  return {
    ts: cells[0],
    itemId: cells[1].replace(/^#/, ""),
    agentId: cells[2],
    change: cells[3],
    journal: cells[4] ?? "",
    note: cells[5] ?? "",
  };
}
