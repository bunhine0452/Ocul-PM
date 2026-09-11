// URI 핸들러의 순수 부분 — vscode 를 임포트하지 않아 vitest 가 판정한다.
import * as path from "node:path";
import { parseJournalPath } from "./oculpm/journal";
import type { JournalFile } from "./oculpm/store";

export interface OpenTarget {
  root: string;
  file: JournalFile;
}

/** 순수 — 절대경로가 어느 폴더의 일지인지. 규격 밖·폴더 밖이면 null. */
export function resolveEntryTarget(entryAbs: string, roots: string[]): OpenTarget | null {
  const norm = path.normalize(entryAbs);
  for (const root of roots) {
    const journalDir = path.join(root, ".oculpm", "journal") + path.sep;
    if (!norm.startsWith(journalDir)) {
      continue;
    }
    const rel = norm.slice(journalDir.length).split(path.sep).join("/");
    const parsed = parseJournalPath(rel);
    if (parsed) {
      return { root, file: { ...parsed, rel, absPath: norm } };
    }
  }
  return null;
}
