// `.oculpm/` 디스크 읽기 — 파서(journal.ts·planner.ts)를 파일시스템에 잇는 얇은
// 층. `index/**` 는 앱이 관리하는 파생 캐시라 **절대 걷지 않는다**.
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { parseJournalEntry, parseJournalPath, type JournalEntry, type JournalPath } from "./journal";
import { parsePlan, type ParsedPlan } from "./planner";

export const OCULPM_DIR = ".oculpm";

export interface JournalFile extends JournalPath {
  /** 절대경로 */
  absPath: string;
  /** `.oculpm/journal/` 기준 상대경로 */
  rel: string;
}

/** 프로젝트 루트가 ocul-pm 추적 대상인가 (`.oculpm/journal` 존재). */
export async function isTracked(projectRoot: string): Promise<boolean> {
  try {
    const st = await fs.stat(path.join(projectRoot, OCULPM_DIR, "journal"));
    return st.isDirectory();
  } catch {
    return false;
  }
}

/** 규격에 맞는 일지 파일 목록. 규격 밖 파일·폴더는 조용히 건너뛴다. */
export async function listJournalFiles(
  projectRoot: string,
  opts: { workday?: string } = {},
): Promise<JournalFile[]> {
  const journalDir = path.join(projectRoot, OCULPM_DIR, "journal");
  const days = await readDirNames(journalDir);
  const out: JournalFile[] = [];
  for (const day of days) {
    if (!/^\d{8}$/.test(day) || (opts.workday !== undefined && day !== opts.workday)) {
      continue;
    }
    for (const folder of await readDirNames(path.join(journalDir, day))) {
      for (const file of await readDirNames(path.join(journalDir, day, folder))) {
        const rel = `${day}/${folder}/${file}`;
        const parsed = parseJournalPath(rel);
        if (parsed) {
          out.push({ ...parsed, rel, absPath: path.join(journalDir, rel) });
        }
      }
    }
  }
  out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return out;
}

export async function readJournalEntry(file: JournalFile): Promise<JournalEntry> {
  return parseJournalEntry(await fs.readFile(file.absPath, "utf8"), file);
}

export interface PlanFile {
  absPath: string;
  plan: ParsedPlan;
}

/** `.oculpm/planner/*.md` 전부 (활성만 원하면 `status === "active"` 로 거른다). */
export async function listPlans(projectRoot: string): Promise<PlanFile[]> {
  const dir = path.join(projectRoot, OCULPM_DIR, "planner");
  const out: PlanFile[] = [];
  for (const name of await readDirNames(dir)) {
    if (!name.endsWith(".md") || name.startsWith("_")) {
      continue;
    }
    const absPath = path.join(dir, name);
    const md = await fs.readFile(absPath, "utf8");
    out.push({ absPath, plan: parsePlan(md, name.slice(0, -3)) });
  }
  out.sort((a, b) => (a.plan.id < b.plan.id ? -1 : a.plan.id > b.plan.id ? 1 : 0));
  return out;
}

/** OS 로컬 날짜의 YYYYMMDD — AGENTS.md §2 "workday 는 OS 로컬 그대로". */
export function localWorkday(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

async function readDirNames(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).sort();
  } catch {
    return [];
  }
}
