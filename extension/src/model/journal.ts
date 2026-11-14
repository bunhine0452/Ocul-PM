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
  if (box) return cleanTitle(s.slice(box[0].length).trimStart());
  const heading = s.match(/^#{1,6}(?:\s+|$)/);
  if (heading) return cleanTitle(s.slice(heading[0].length));
  return cleanTitle(s);
}

/**
 * 제어 문자를 걷고(탭은 빈칸으로) 끝 공백을 자른다 — 앱의 `markdown::clean_title` 과 같은 규칙. 동료가
 * 커밋한 제목의 `ESC[201~` 같은 바이트를 앱은 목록 · PR 영수증에서 걷는데 확장만 남기면 같은 일지가
 * 다른 영수증이 된다(사례표 `receipt_cases.json` 의 title 이 둘을 함께 문다).
 */
function cleanTitle(raw: string): string {
  return raw.replace(/\t/g, " ").replace(/\p{Cc}/gu, "").trimEnd();
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
