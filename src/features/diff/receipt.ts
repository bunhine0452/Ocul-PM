/**
 * PR 영수증 (11-02) — 이 가지의 일을 기록과 대조한 마크다운. 변경 화면의 「영수증 복사」가 클립보드에 넣는다.
 *
 * 리뷰어가 Ocul 없이 PR 설명에서 본다: 계획의 확인 명령 결과 · 일지마다 돌린 명령의 끝 줄 · 어느 일지에도
 * 없는 변경. 만드는 것은 결정적이다(LLM 0) — 같은 기록이면 같은 영수증. 백엔드 `git::receipt` 가 재료를 준다.
 */
import { planApi } from "@/api/plan";
import { raceApi } from "@/api/race";
import type { Receipt, TodayDigest } from "@/lib/bindings";
import type { t as tFn } from "@/i18n";
import { whenLabel } from "@/lib/whenLabel";
import { normalizeJournalRef } from "@/features/today/todayModel";

/** 돌린 명령의 흔적이 있는 검증 칸 — `oculpm::evidence::COMMAND`. */
const COMMAND = 2;
const MAX_FILES = 20;

const code = (s: string) => "`" + s.replace(/`/g, "'") + "`";

export function receiptMarkdown(r: Receipt, digest: TodayDigest | null, t: typeof tFn): string {
  const out: string[] = [];
  const head = [code(r.branch)];
  if (r.base_label) head.push("← " + code(r.base_label));
  out.push(`### ${t("diff.receipt.title")} · ${head.join(" ")}`);
  out.push(t("diff.receipt.meta", { commits: r.commits, files: r.files }));

  // 이 가지의 일지가 걸린 계획 — 그 계획의 마지막 확인 명령 결과.
  const mine = new Set(r.journals.map((j) => j.path));
  const planIds = new Set(
    (digest?.journal_plan ?? []).filter((l) => mine.has(normalizeJournalRef(l.journal_ref))).map((l) => l.plan_id),
  );
  const plans = (digest?.plans ?? []).filter((p) => planIds.has(p.plan_id));
  if (plans.length > 0) {
    out.push("", `**${t("diff.receipt.plans")}**`);
    for (const p of plans) {
      const v = p.last_verdict;
      if (!v) {
        out.push(`- · ${t("diff.receipt.plan", { plan: p.title })} — ${t("diff.receipt.noRun")}`);
        continue;
      }
      const parts = [p.check ? code(p.check) : "", v.summary || t("today.check.noSummary"), whenLabel(v.ts)].filter(Boolean);
      let line = `- ${v.passed ? "✓" : "✗"} ${t("diff.receipt.plan", { plan: p.title })} — ${parts.join(" → ")}`;
      if (v.passed && p.stale_files.length > 0) line += ` · ⚠ ${t("diff.receipt.stale", { n: p.stale_files.length })}`;
      out.push(line);
    }
  }

  const ran = r.journals.filter((j) => j.evidence >= COMMAND).length;
  out.push("", `**${t("diff.receipt.journals", { n: r.journals.length, m: ran })}**`);
  if (r.journals.length === 0) out.push(`- ${t("diff.receipt.noJournals")}`);
  for (const j of r.journals) {
    const proof = j.evidence >= COMMAND && j.proof ? j.proof : t("diff.receipt.noProof");
    out.push(`- ${j.evidence >= COMMAND ? "✓" : "·"} ${j.title || j.path} — ${proof}`);
  }

  if (r.unrecorded.length > 0) {
    out.push("", `**${t("diff.receipt.unrecorded", { n: r.unrecorded.length })}**`);
    for (const f of r.unrecorded.slice(0, MAX_FILES)) out.push(`- ${code(f)}`);
    if (r.unrecorded.length > MAX_FILES) out.push(`- ${t("diff.receipt.more", { n: r.unrecorded.length - MAX_FILES })}`);
  }
  out.push("", `<sub>${t("diff.receipt.footer")}</sub>`);
  return out.join("\n");
}

/** 재료를 모아 마크다운을 만든다. 계획 집계를 못 읽어도 영수증은 만든다(계획 칸만 빠진다). */
export async function buildReceipt(projectId: number, t: typeof tFn): Promise<string> {
  const [r, digest] = await Promise.all([raceApi.receipt(projectId), planApi.todayDigest(projectId).catch(() => null)]);
  return receiptMarkdown(r, digest, t);
}
