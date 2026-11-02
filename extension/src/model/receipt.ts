// PR 영수증 — 앱 변경 화면의 「영수증 복사」(`src/features/diff/receipt.ts`)와 같은 모양의 마크다운.
//
// 리뷰어가 Ocul 없이 PR 설명에서 본다: 계획의 확인 명령 결과 · 일지마다 돌린 명령의 끝 줄 · 어느 일지에도
// 없는 변경. 결정적이다(LLM 0). 앱과 다른 점 하나: 「통과 뒤 바뀐 파일 N개」 꼬리는 싣지 않는다 — 앱은
// 저장 시각을 지켜보는 감시기로 그 수를 세고, 확장은 그 기록을 갖지 않는다.

import { COMMAND } from "./evidence";
import type { Journal } from "./journal";
import { journalKey, type Plan } from "./plan";

export interface ReceiptInput {
  branch: string;
  /** `origin/main` 같은 기준 — 못 찾았으면 빈 글자. */
  baseLabel: string;
  commits: number;
  /** 기록 폴더 밖에서 바뀐 파일 수. */
  files: number;
  /** 이 가지에서 더하거나 고친 일지 — 경로 순. */
  journals: Journal[];
  unrecorded: string[];
  /** 살아 있는 계획 전부 — 이 가지의 일지가 걸린 것만 싣는다. */
  plans: Plan[];
}

export interface ReceiptText {
  title: string;
  meta: (commits: number, files: number) => string;
  plans: string;
  plan: (title: string) => string;
  noRun: string;
  noSummary: string;
  journals: (n: number, m: number) => string;
  noJournals: string;
  noProof: string;
  unrecorded: (n: number) => string;
  more: (n: number) => string;
  footer: string;
  when: (iso: string) => string;
}

const MAX_FILES = 20;
const code = (s: string) => "`" + s.replace(/`/g, "'") + "`";

export function receiptMarkdown(r: ReceiptInput, t: ReceiptText): string {
  const out: string[] = [];
  const head = [code(r.branch)];
  if (r.baseLabel) head.push("← " + code(r.baseLabel));
  out.push(`### ${t.title} · ${head.join(" ")}`);
  out.push(t.meta(r.commits, r.files));

  const mine = new Set(r.journals.map((j) => j.path));
  const plans = r.plans.filter((p) => p.updates.some((u) => u.journal !== null && mine.has(journalKey(u.journal))));
  if (plans.length > 0) {
    out.push("", `**${t.plans}**`);
    for (const p of plans) {
      const v = p.verdict;
      if (!v) {
        out.push(`- · ${t.plan(p.title)} — ${t.noRun}`);
        continue;
      }
      const parts = [p.check ? code(p.check) : "", v.summary || t.noSummary, t.when(v.ts)].filter(Boolean);
      out.push(`- ${v.passed ? "✓" : "✗"} ${t.plan(p.title)} — ${parts.join(" → ")}`);
    }
  }

  const ran = r.journals.filter((j) => j.evidence >= COMMAND).length;
  out.push("", `**${t.journals(r.journals.length, ran)}**`);
  if (r.journals.length === 0) out.push(`- ${t.noJournals}`);
  for (const j of r.journals) {
    const proof = j.evidence >= COMMAND && j.proof ? j.proof : t.noProof;
    out.push(`- ${j.evidence >= COMMAND ? "✓" : "·"} ${j.title || j.path} — ${proof}`);
  }

  if (r.unrecorded.length > 0) {
    out.push("", `**${t.unrecorded(r.unrecorded.length)}**`);
    for (const f of r.unrecorded.slice(0, MAX_FILES)) out.push(`- ${code(f)}`);
    if (r.unrecorded.length > MAX_FILES) out.push(`- ${t.more(r.unrecorded.length - MAX_FILES)}`);
  }
  out.push("", `<sub>${t.footer}</sub>`);
  return out.join("\n");
}
