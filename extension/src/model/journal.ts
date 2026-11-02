// 일지 한 건 — `.oculpm/journal/{날짜}/{폴더}/{시각}_{종류}_{slug}.md`.

import { evidenceLevel, proofLine, verificationSection, type Evidence } from "./evidence";
import { filesTouched, scalar, splitFrontmatter } from "./frontmatter";

export interface Journal {
  /** 일지 루트 기준 (`20261102/Bugs/2023_bug_x.md`) — 계획 로그의 일지 칸과 대조하는 열쇠. */
  path: string;
  title: string;
  type: string;
  createdAt: string;
  files: string[];
  evidence: Evidence;
  proof: string | null;
}

/** 본문 첫 줄의 제목 — `[x] 제목` · `# 제목` · 맨 첫 줄 (`oculpm::markdown::extract_title`). */
export function journalTitle(body: string): string {
  const line = body.split("\n").find((l) => l.trim() !== "");
  if (line === undefined) return "";
  const s = line.trimStart();
  const box = s.match(/^\[( |x|X)\] /);
  if (box) return s.slice(box[0].length).trimStart().trimEnd();
  const heading = s.match(/^#{1,6}(?:\s+|$)/);
  if (heading) return s.slice(heading[0].length).trimEnd();
  return s.trimEnd();
}

export function parseJournal(path: string, raw: string): Journal {
  const { fm, body } = splitFrontmatter(raw);
  const section = verificationSection(body);
  return {
    path,
    title: journalTitle(body),
    type: scalar(fm, "type") ?? "",
    createdAt: scalar(fm, "created_at") ?? "",
    files: filesTouched(fm),
    evidence: evidenceLevel(body),
    proof: section === null ? null : proofLine(section),
  };
}
