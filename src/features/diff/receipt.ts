/**
 * PR 영수증 (11-02) — 이 가지의 일을 기록과 대조한 마크다운. 변경 · 오늘 화면의 「영수증 복사」(⇧⌘C)가 클립보드에 넣는다.
 *
 * 리뷰어가 Ocul 없이 PR 설명에서 본다: 계획의 확인 명령 결과 · 일지마다 돌린 명령의 끝 줄 · 어느 일지에도
 * 없는 변경. 만드는 것은 결정적이다(LLM 0) — 같은 기록이면 같은 영수증. 백엔드 `git::receipt` 가 재료를 준다.
 *
 * 일지 한 건의 영수증(11-23, 일지 상세의 「영수증 복사」)도 같은 줄 모양이다 — 계획 줄 · 일지 줄 · 파일 줄 · 꼬리.
 * 형식은 하나뿐이다: HTML 로 저장해도 이 마크다운을 그대로 옮긴다(`receiptHtml`).
 */
import { oculpmApi } from "@/api/oculpm";
import { planApi } from "@/api/plan";
import { raceApi } from "@/api/race";
import type { DigestPlan, JournalEntrySummary, JournalPlanLink, Receipt, TodayDigest } from "@/lib/bindings";
import type { t as tFn } from "@/i18n";
import { whenLabel } from "@/lib/whenLabel";
import { normalizeJournalRef } from "@/features/today/todayModel";
import { agentLabel } from "@/features/today/agentColor";
import { TRIGGER_META } from "@/features/oculpm/triggerMeta";
import { verificationLines } from "@/features/oculpm/verification";

/** 돌린 명령의 흔적이 있는 검증 칸 — `oculpm::evidence::COMMAND`. */
const COMMAND = 2;
const MAX_FILES = 20;
/** 끝 줄의 길이 상한 — `git::race::proof_line` 과 같다. */
const PROOF_MAX = 120;

const code = (s: string) => "`" + s.replace(/`/g, "'") + "`";

/** 계획의 마지막 확인 명령 결과 한 줄. */
function planLine(p: DigestPlan, t: typeof tFn): string {
  const v = p.last_verdict;
  if (!v) return `- · ${t("diff.receipt.plan", { plan: p.title })} — ${t("diff.receipt.noRun")}`;
  const parts = [p.check ? code(p.check) : "", v.summary || t("today.check.noSummary"), whenLabel(v.ts)].filter(Boolean);
  let line = `- ${v.passed ? "✓" : "✗"} ${t("diff.receipt.plan", { plan: p.title })} — ${parts.join(" → ")}`;
  if (v.passed && p.stale_files.length > 0) line += ` · ⚠ ${t("diff.receipt.stale", { n: p.stale_files.length })}`;
  return line;
}

/** 일지 묶음의 계획 칸 — 그 일지들이 걸린 계획만. 없으면 칸을 세우지 않는다. */
function planSection(out: string[], journalPaths: ReadonlySet<string>, digest: TodayDigest | null, t: typeof tFn) {
  const planIds = new Set(
    (digest?.journal_plan ?? []).filter((l) => journalPaths.has(normalizeJournalRef(l.journal_ref))).map((l) => l.plan_id),
  );
  const plans = (digest?.plans ?? []).filter((p) => planIds.has(p.plan_id));
  if (plans.length === 0) return;
  out.push("", `**${t("diff.receipt.plans")}**`);
  for (const p of plans) out.push(planLine(p, t));
}

interface JournalLine {
  title: string;
  path: string;
  evidence: number;
  proof: string | null;
}

/** 일지 칸 — 일지마다 돌린 명령의 끝 줄, 없으면 「돌린 명령 없음」. */
function journalSection(out: string[], journals: readonly JournalLine[], t: typeof tFn) {
  const ran = journals.filter((j) => j.evidence >= COMMAND).length;
  out.push("", `**${t("diff.receipt.journals", { n: journals.length, m: ran })}**`);
  if (journals.length === 0) out.push(`- ${t("diff.receipt.noJournals")}`);
  for (const j of journals) {
    const proof = j.evidence >= COMMAND && j.proof ? j.proof : t("diff.receipt.noProof");
    out.push(`- ${j.evidence >= COMMAND ? "✓" : "·"} ${j.title || j.path} — ${proof}`);
  }
}

/** 파일 칸 — 경로는 기계 글씨, `MAX_FILES` 넘으면 「외 N개」. */
function fileSection(out: string[], heading: string, files: readonly string[], t: typeof tFn) {
  if (files.length === 0) return;
  out.push("", `**${heading}**`);
  for (const f of files.slice(0, MAX_FILES)) out.push(`- ${code(f)}`);
  if (files.length > MAX_FILES) out.push(`- ${t("diff.receipt.more", { n: files.length - MAX_FILES })}`);
}

export function receiptMarkdown(r: Receipt, digest: TodayDigest | null, t: typeof tFn): string {
  const out: string[] = [];
  const head = [code(r.branch)];
  if (r.base_label) head.push("← " + code(r.base_label));
  out.push(`### ${t("diff.receipt.title")} · ${head.join(" ")}`);
  out.push(t("diff.receipt.meta", { commits: r.commits, files: r.files }));
  // 이 가지의 일지가 걸린 계획 — 그 계획의 마지막 확인 명령 결과.
  planSection(out, new Set(r.journals.map((j) => j.path)), digest, t);
  journalSection(out, r.journals, t);
  fileSection(out, t("diff.receipt.unrecorded", { n: r.unrecorded.length }), r.unrecorded, t);
  out.push("", `<sub>${t("diff.receipt.footer")}</sub>`);
  return out.join("\n");
}

/** 재료를 모아 마크다운을 만든다. 계획 집계를 못 읽어도 영수증은 만든다(계획 칸만 빠진다). */
export async function buildReceipt(projectId: number, t: typeof tFn): Promise<string> {
  const [r, digest] = await Promise.all([raceApi.receipt(projectId), planApi.todayDigest(projectId).catch(() => null)]);
  return receiptMarkdown(r, digest, t);
}

/**
 * 검증 칸의 끝 줄 — `git::race::proof_line` 과 같은 규칙(목록 표식 · 백틱을 걷고 120자). 결과는 보통 마지막 줄에 있다.
 * 본문은 캐시가 준 것이다 — 투영할 때 이미 시크릿이 가려졌다.
 */
export function proofLine(body: string): string | null {
  const lines = verificationLines(body, Number.MAX_SAFE_INTEGER).filter((l) => !l.startsWith("#"));
  const last = lines[lines.length - 1];
  if (!last) return null;
  return [...last].length > PROOF_MAX ? [...last].slice(0, PROOF_MAX).join("") + "…" : last;
}

export interface JournalReceiptInput {
  entry: Pick<JournalEntrySummary, "relative_path" | "title" | "type" | "agent_id" | "created_at" | "evidence">;
  /** 캐시의 본문(가려진 것) — 없으면 끝 줄 없이. */
  body: string | null;
  files: readonly string[];
}

/** 「2026-11-23 14:02」 — 붙여 넣은 곳에서 읽히게 절대 시각으로. */
function stampOf(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m ? `${m[1]} ${m[2]}` : iso;
}

/** 일지 한 건의 영수증 — PR 영수증과 같은 줄 모양(계획 · 일지 · 파일 · 꼬리). */
export function journalReceiptMarkdown(input: JournalReceiptInput, digest: TodayDigest | null, t: typeof tFn): string {
  const { entry, body, files } = input;
  const kind = TRIGGER_META[entry.type] ?? TRIGGER_META.chore;
  const out: string[] = [];
  out.push(`### ${t("diff.receipt.title")} · ${entry.title || entry.relative_path}`);
  out.push(t("diff.receipt.entryMeta", { kind: t(kind.labelKey), agent: agentLabel(entry.agent_id), when: stampOf(entry.created_at) }));
  planSection(out, new Set([normalizeJournalRef(entry.relative_path)]), digest, t);
  journalSection(
    out,
    [{ title: entry.title, path: entry.relative_path, evidence: entry.evidence, proof: body ? proofLine(body) : null }],
    t,
  );
  fileSection(out, t("diff.receipt.files", { n: files.length }), files, t);
  out.push("", `<sub>${t("diff.receipt.footer")}</sub>`);
  return out.join("\n");
}

/** 일지 한 건의 재료를 모은다 — 본문 · 파일은 캐시(가려진 것), 계획은 오늘 집계. 못 읽은 칸만 빠진다. */
export async function buildJournalReceipt(
  projectId: number,
  entry: JournalReceiptInput["entry"],
  t: typeof tFn,
  links: readonly JournalPlanLink[] = [],
): Promise<string> {
  const [detail, digest] = await Promise.all([
    oculpmApi.getJournalEntry(projectId, entry.relative_path).catch(() => null),
    planApi.todayDigest(projectId).catch(() => null),
  ]);
  // 오늘 집계에 이 일지의 연결이 아직 없으면(늦게 온 계획 갱신) 화면이 아는 연결을 더한다.
  const known = new Set((digest?.journal_plan ?? []).map((l) => `${normalizeJournalRef(l.journal_ref)}\0${l.plan_id}`));
  const extra = links.filter((l) => !known.has(`${normalizeJournalRef(l.journal_ref)}\0${l.plan_id}`));
  const merged = digest && extra.length > 0 ? { ...digest, journal_plan: [...digest.journal_plan, ...extra] } : digest;
  return journalReceiptMarkdown(
    {
      entry: { ...entry, title: detail?.title || entry.title, evidence: detail?.evidence ?? entry.evidence },
      body: detail?.body_markdown ?? null,
      files: (detail?.frontmatter.files_touched ?? []).map((f) => f.path),
    },
    merged,
    t,
  );
}
