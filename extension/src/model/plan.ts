// 계획 한 장 — `.oculpm/planner/*.md`. 확장은 제목 · 상태 · 확인 명령 · 갱신 로그만 본다.
//
// 「마지막 판정」은 로그 메모가 `판정 ✓|✗` (또는 `verdict ✓|✗`) 로 시작하는 가장 새 줄이다 — 앱
// `planner/judge.rs` 와 플러그인 시작 훅 `plan-context.sh` 와 같은 규칙.

import { scalar, splitFrontmatter } from "./frontmatter";

export interface PlanUpdate {
  ts: string;
  item: string;
  journal: string | null;
  note: string | null;
}

export interface Verdict {
  passed: boolean;
  summary: string;
  ts: string;
}

export interface Plan {
  /** `.oculpm/planner/` 기준 파일 이름. */
  file: string;
  id: string;
  title: string;
  status: string;
  check: string | null;
  updates: PlanUpdate[];
  verdict: Verdict | null;
}

export function parseNote(note: string): { passed: boolean; summary: string } | null {
  const s = note.trim();
  const rest = s.startsWith("판정 ") ? s.slice(3) : s.startsWith("verdict ") ? s.slice(8) : null;
  if (rest === null) return null;
  let passed: boolean;
  let tail: string;
  if (rest.startsWith("✓")) [passed, tail] = [true, rest.slice(1)];
  else if (rest.startsWith("✗")) [passed, tail] = [false, rest.slice(1)];
  else return null;
  if (!(tail === "" || tail.startsWith(" "))) return null;
  return { passed, summary: tail.trim() };
}

/** 가장 새 판정. 시각이 같으면 뒤의 것 (Rust `max_by` 와 같다). */
export function lastVerdict(updates: readonly PlanUpdate[]): Verdict | null {
  let best: Verdict | null = null;
  for (const u of updates) {
    const v = u.note === null ? null : parseNote(u.note);
    if (!v) continue;
    if (best === null || u.ts >= best.ts) best = { ...v, ts: u.ts };
  }
  return best;
}

const CHECK_MARKERS = ["**확인 명령:**", "**Check:**"];

export function checkCommand(md: string): string | null {
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    for (const m of CHECK_MARKERS) {
      if (!line.startsWith(m)) continue;
      const v = line.slice(m.length).trim();
      if (v) return v;
    }
  }
  return null;
}

/** 표 한 줄을 칸으로 — `\|` 는 글자 그대로의 `|` (`parse.rs::split_table_cells`). */
export function splitCells(line: string): string[] {
  const inner = line.replace(/^\|+|\|+$/g, "");
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "\\" && inner[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

export function parseLogRow(line: string): PlanUpdate | null {
  const s = line.trim();
  if (!s.startsWith("|")) return null;
  const cells = splitCells(s);
  // 데이터 줄은 늘 ISO 시각으로 시작한다 — 머리줄 · 구분줄은 여기서 걸러진다.
  if (!/^\d/.test(cells[0] ?? "") || cells.length < 3) return null;
  const nonEmpty = (v: string | undefined) => (v ? v : null);
  return {
    ts: cells[0],
    item: cells[1].replace(/^#+/, ""),
    journal: nonEmpty(cells[4]),
    note: nonEmpty(cells[5]),
  };
}

export function parsePlan(file: string, raw: string): Plan {
  const { fm, body } = splitFrontmatter(raw);
  const updates: PlanUpdate[] = [];
  let inLog = false;
  for (const line of body.split("\n")) {
    if (line.includes("<!-- oculpm:plan-log begin")) inLog = true;
    else if (line.includes("<!-- oculpm:plan-log end")) inLog = false;
    else if (inLog) {
      const u = parseLogRow(line);
      if (u) updates.push(u);
    }
  }
  return {
    file,
    id: scalar(fm, "id") ?? file.replace(/\.md$/, ""),
    title: scalar(fm, "title") ?? file,
    status: scalar(fm, "status") ?? "active",
    check: checkCommand(body),
    updates,
    verdict: lastVerdict(updates),
  };
}

/** 로그의 일지 칸(`.oculpm/journal/…` · `journal/…` · 날짜부터)을 일지 루트 기준으로 (앱 `normalizeJournalRef`). */
export function journalKey(ref: string): string {
  return ref.trim().replace(/^\.oculpm\//, "").replace(/^journal\//, "");
}
