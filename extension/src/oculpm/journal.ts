// 일지 읽기 — AGENTS.md §2 의 경로·frontmatter 규격만 읽는다(쓰지 않는다).
// 경로 `journal/{YYYYMMDD}/{TypeFolder}/{HHMM}_{type}_{slug}.md`.
import { scalar, splitFrontmatter } from "./frontmatter";

export const TYPE_FOLDERS = {
  Bugs: "bug",
  Features_to_add: "feature",
  Errors: "error",
  Refactors: "refactor",
  Chores: "chore",
} as const;
export type TypeFolder = keyof typeof TYPE_FOLDERS;
export type EntryType = (typeof TYPE_FOLDERS)[TypeFolder];

export interface JournalPath {
  workday: string; // YYYYMMDD
  typeFolder: TypeFolder;
  hhmm: string;
  type: EntryType;
  slug: string;
  fileName: string;
}

const FILE_RE = /^(\d{4})_(bug|feature|error|refactor|chore)_([A-Za-z0-9-]+)\.md$/;

/** `.oculpm/journal/` 기준 상대경로를 해석. 규격 밖이면 null. */
export function parseJournalPath(rel: string): JournalPath | null {
  const parts = rel.split("/");
  if (parts.length !== 3) {
    return null;
  }
  const [workday, folder, fileName] = parts;
  if (!/^\d{8}$/.test(workday) || !(folder in TYPE_FOLDERS)) {
    return null;
  }
  const m = FILE_RE.exec(fileName);
  if (!m) {
    return null;
  }
  return {
    workday,
    typeFolder: folder as TypeFolder,
    hhmm: m[1],
    type: m[2] as EntryType,
    slug: m[3],
    fileName,
  };
}

export interface JournalEntry {
  /** frontmatter 가 있고 잘 읽혔는가. 아니면 아래 필드는 경로에서 유도한 값. */
  parsed: boolean;
  type: string;
  slug: string;
  status: string;
  createdAt: string;
  sessionId: string;
  agentId: string;
  agentVersion?: string;
  language: string;
  tags: string[];
  filesTouched: { path: string; op: string }[];
  /** 본문 첫 줄 `[x] 제목` 의 제목. 없으면 slug. */
  title: string;
  body: string;
  warnings: string[];
}

export function parseJournalEntry(markdown: string, fallback?: JournalPath | null): JournalEntry {
  const { parsed, body, warnings } = splitFrontmatter(markdown);
  const fm = parsed ?? {};
  const agent = isRecord(fm.agent) ? fm.agent : {};
  const entry: JournalEntry = {
    parsed: parsed !== null,
    type: scalar(fm.type) ?? fallback?.type ?? "",
    slug: scalar(fm.slug) ?? fallback?.slug ?? "",
    status: scalar(fm.status) ?? "",
    createdAt: scalar(fm.created_at) ?? "",
    sessionId: scalar(fm.session_id) ?? "",
    agentId: scalar(agent.id) ?? (typeof fm.agent === "string" ? fm.agent : ""),
    agentVersion: scalar(agent.version),
    language: scalar(fm.language) ?? "",
    tags: stringList(fm.tags),
    filesTouched: Array.isArray(fm.files_touched)
      ? fm.files_touched.filter(isRecord).map((f) => ({
          path: scalar(f.path) ?? "",
          op: scalar(f.op) ?? "",
        }))
      : [],
    title: titleFromBody(body) ?? scalar(fm.slug) ?? fallback?.slug ?? "",
    body,
    warnings,
  };
  return entry;
}

function titleFromBody(body: string): string | undefined {
  const first = body.split("\n").find((l) => l.trim() !== "")?.trim();
  if (!first) {
    return undefined;
  }
  const m = /^\[[ xX~!>-]?\]\s*(.+)$/.exec(first);
  return m ? m[1].trim() : undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(scalar).filter((s): s is string => s !== undefined) : [];
}
