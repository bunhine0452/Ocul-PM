import { forwardRef, useCallback, useEffect, useMemo, useState } from "react";
import { LoadingState } from "@/components/LoadingState";
import { Markdown } from "@/components/Markdown";
import { ChevronLeft } from "@/components/Icons";
import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { PatchView } from "@/features/diff/PatchView";
import { countPatchStats, langFromPath } from "@/features/diff/diffParse";
import { agentLabel } from "@/features/today/agentColor";
import { useT } from "@/i18n";
import type { EntryFileDiff, JournalEntry, JournalEntrySummary, JournalPlanLink } from "@/lib/bindings";
import { toast } from "@/lib/toast";
import { EvidenceMark, plainTitle } from "./JournalRow";
import { JournalRelated } from "./JournalRelated";
import { evidenceStateOf } from "./evidenceState";
import { TriggerBadge } from "./triggerMeta";
import { summaryOf, verificationLines, withoutTitle } from "./verification";
import { isConfirmed, isStaleVerified } from "./verified";
import { useJournalEvents } from "./useOculpmLive";

// 작업 일지 상세 (4.0) — 한 건을 한 장에. 위에서 아래로: 무엇이었나(종류·증거·메타 → 제목 → 요약)
// → 믿을 근거(검증 상자: 돌린 명령과 결과 끝 줄) → 실제로 바뀐 것(인라인 diff) → 관련 일지.
// 에이전트의 말보다 증거가 먼저 읽히도록 검증 상자를 diff 앞에 둔다.

/** "2026-10-28T14:02:11+09:00" → "10월 28일 14:02". */
function whenLabel(createdAt: string, t: ReturnType<typeof useT>["t"]): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(createdAt);
  if (!m) return createdAt;
  return `${t("journal.dayMd", { m: String(Number(m[2])), d: String(Number(m[3])) })} ${m[4]}`;
}

interface JournalDetailProps {
  projectId: number;
  entry: JournalEntrySummary;
  planLinks: readonly JournalPlanLink[];
  /** 변경 화면으로 건너가 이 일지의 파일을 연다 (기록된 diff 가 없을 때의 탈출구). */
  onOpenDiff: (entry: JournalEntrySummary) => void;
  onOpenRelated: (relativePath: string) => void;
}

export const JournalDetail = forwardRef<HTMLDivElement, JournalDetailProps>(function JournalDetail(
  { projectId, entry, planLinks, onOpenDiff, onOpenRelated },
  ref,
) {
  const { t } = useT();
  const { state } = useWorkspace();
  const [detail, setDetail] = useState<JournalEntry | null>(null);
  const [diffs, setDiffs] = useState<EntryFileDiff[] | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [fileIdx, setFileIdx] = useState(0);
  const [fullOpen, setFullOpen] = useState(false);

  // 사람 확인 — 목록 요약이 늦게 따라오므로 화면 지역 상태로 먼저 그린다.
  const [verified, setVerified] = useState(entry.verified_by_user);
  const [stale, setStale] = useState(entry.verified_stale);
  const [verifying, setVerifying] = useState(false);
  useEffect(() => {
    setVerified(entry.verified_by_user);
    setStale(entry.verified_stale);
  }, [entry.relative_path, entry.verified_by_user, entry.verified_stale]);

  // 디스크가 SSOT 다 — 열어 둔 일지를 에이전트가 고치거나 diff 사이드카가 뒤늦게 기록되면 따라온다.
  const [reloadTick, setReloadTick] = useState(0);
  const reload = useCallback(() => setReloadTick((n) => n + 1), []);
  useJournalEvents(projectId, true, reload);

  // 다른 일지로 옮길 때만 화면 지역 상태를 비운다 — 라이브 갱신이 읽던 파일 선택을 풀면 방해다.
  useEffect(() => {
    setDetail(null);
    setDiffs(null);
    setDiffError(null);
    setFileIdx(0);
    setFullOpen(false);
  }, [entry.relative_path]);

  useEffect(() => {
    let cancelled = false;
    oculpmApi
      .getJournalEntry(projectId, entry.relative_path)
      .then((d) => {
        if (!cancelled && d) setDetail(d);
      })
      .catch(() => {
        /* 본문은 최선 노력이다 — 요약 행의 정보만으로도 상세는 선다. */
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, entry.relative_path, reloadTick]);

  useEffect(() => {
    let cancelled = false;
    oculpmApi
      .getEntryDiffs(projectId, entry.relative_path)
      .then((d) => {
        if (cancelled) return;
        setDiffs(d);
        setDiffError(null);
      })
      .catch((e) => {
        if (!cancelled) setDiffError(e instanceof OculpmApiError ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, entry.relative_path, reloadTick]);

  const toggleVerified = useCallback(async () => {
    if (verifying) return;
    setVerifying(true);
    // 확인 뒤 본문이 바뀐 일지는 누르면 「다시 묶기」(true) 다 — 해시가 지금 본문으로 다시 묶인다.
    const next = stale ? true : !verified;
    try {
      await oculpmApi.setJournalVerified(projectId, entry.relative_path, next);
      setVerified(next);
      setStale(false);
    } catch (e) {
      toast.destructive(t("entry.verifyFailed", { error: e instanceof OculpmApiError ? e.message : String(e) }));
    } finally {
      setVerifying(false);
    }
  }, [verifying, verified, stale, projectId, entry.relative_path, t]);

  const openInEditor = useCallback(async () => {
    try {
      await oculpmApi.openEntryInEditor(projectId, entry.relative_path);
    } catch (e) {
      toast.destructive(t("entry.openInEditorFailed", { error: e instanceof OculpmApiError ? e.message : String(e) }));
    }
  }, [projectId, entry.relative_path, t]);

  const body = detail?.body_markdown ?? "";
  const level = detail?.evidence ?? entry.evidence;
  const judged = entry.type === "bug" || entry.type === "feature" || entry.type === "refactor";
  const lines = useMemo(() => verificationLines(body, 12), [body]);
  const summary = useMemo(() => summaryOf(body, entry.title), [body, entry.title]);
  const confirmed = isConfirmed({ verified_by_user: verified, verified_stale: stale });
  const evState = evidenceStateOf({ ...entry, evidence: level, verified_by_user: verified, verified_stale: stale });

  // 기록된 diff 가 있는 파일만 오간다. frontmatter 에는 있는데 패치가 없는 파일은 개수로만 말한다.
  const files = useMemo(() => diffs ?? [], [diffs]);
  const active = files.length > 0 ? files[Math.min(fileIdx, files.length - 1)] : null;
  const stats = active ? countPatchStats(active.patch) : null;
  const recorded = useMemo(() => new Set(files.map((f) => f.path)), [files]);
  const unrecordedFiles = (detail?.frontmatter.files_touched ?? []).filter((f) => !recorded.has(f.path)).length;

  const planText =
    planLinks.length > 0
      ? `${t("journal.planLink", { plan: planLinks[0].plan_title, item: `#${planLinks[0].item_id}` })}${
          planLinks.length > 1 ? ` +${planLinks.length - 1}` : ""
        }`
      : null;
  const model = detail?.frontmatter.agent.version ?? entry.agent_version;
  const metaText = [
    whenLabel(entry.created_at, t),
    agentLabel(entry.agent_id),
    model,
    planText,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="jd" ref={ref} tabIndex={-1} aria-label={plainTitle(entry.title) || entry.slug}>
      <header className="jd-head">
        <div className="jd-chips">
          <TriggerBadge type={entry.type} />
          <EvidenceMark state={evState} />
          {entry.status !== "done" ? (
            <span className="chip sm">
              {entry.status === "abandoned" ? t("entry.status.abandoned") : t("entry.status.open")}
            </span>
          ) : null}
          {entry.parse_ok === false ? <span className="chip sm warn">{t("entry.parseWarnShort")}</span> : null}
          <span className="jd-meta">{metaText}</span>
        </div>
        <h2 className="jd-title">{plainTitle(entry.title) || entry.slug}</h2>
        {summary ? <p className="jd-summary">{summary}</p> : null}
        <div className="jd-actions">
          <button type="button" className="btn ghost sm" onClick={() => void openInEditor()} title={t("entry.openInEditorTitle")}>
            {t("entry.openInEditor")}
          </button>
        </div>
      </header>

      {judged || level > 0 ? (
        <section className="jd-verify" aria-label={t("journal.verify.aria")}>
          <div className="jd-verify-hd">
            <b>{t("journal.verify.title")}</b>
            {level >= 2 ? (
              <span className="chip sm ok">{t("journal.verify.hasCommand")}</span>
            ) : (
              <span className="chip sm warn">
                {level === 1 ? t("journal.verify.noCommand") : t("journal.verify.noSection")}
              </span>
            )}
            <span className="jd-verify-sp" />
            <button
              type="button"
              className="btn sm"
              aria-pressed={confirmed}
              disabled={verifying}
              onClick={() => void toggleVerified()}
              title={isStaleVerified({ verified_by_user: verified, verified_stale: stale }) ? t("entry.reverifyTitle") : t("entry.verifyTitle")}
            >
              {stale ? t("entry.reverify") : t("journal.verify.confirmed")}
            </button>
          </div>
          {level < 2 ? <p className="jd-verify-note">{t("journal.verify.claimOnly")}</p> : null}
          {lines.length > 0 ? <pre className="jd-term">{lines.join("\n")}</pre> : null}
        </section>
      ) : null}

      <section className="jd-diff" aria-label={t("journal.diff.aria")}>
        {diffError ? (
          <p className="jd-diff-note">{t("entry.diffLoadFailed", { error: diffError })}</p>
        ) : diffs == null ? (
          <LoadingState align="start" density="compact" />
        ) : active ? (
          <>
            <div className="jd-diff-fh">
              <b className="jd-diff-name" title={active.path}>
                {active.path}
              </b>
              {stats ? (
                <span className="diff-stat" title={t("diff.statsTitle")}>
                  <span className="add">+{stats.add}</span>
                  <span className="del">−{stats.del}</span>
                </span>
              ) : null}
              <span className="jd-diff-sp" />
              <span className="jd-diff-pos">{t("journal.diff.position", { n: files.length, i: Math.min(fileIdx, files.length - 1) + 1 })}</span>
              {files.length > 1 ? (
                <>
                  <button
                    type="button"
                    className="iconbtn"
                    aria-label={t("entry.prevFile")}
                    onClick={() => setFileIdx((i) => (i - 1 + files.length) % files.length)}
                  >
                    <ChevronLeft size={15} />
                  </button>
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() => setFileIdx((i) => (i + 1) % files.length)}
                  >
                    {t("entry.nextFile")}
                  </button>
                </>
              ) : null}
            </div>
            <div className="jd-diff-body">
              <PatchView patch={active.patch} mode={state.diffMode} lang={langFromPath(active.path)} />
            </div>
            {unrecordedFiles > 0 ? (
              <p className="jd-diff-note">{t("journal.diff.unrecorded", { n: unrecordedFiles })}</p>
            ) : null}
          </>
        ) : (
          <>
            <p className="jd-diff-note">{t("entry.noDiff")}</p>
            <p className="jd-diff-note">
              <button type="button" className="btn sm" onClick={() => onOpenDiff(entry)}>
                {t("entry.openInDiff")}
              </button>
            </p>
          </>
        )}
      </section>

      <JournalRelated
        projectId={projectId}
        relativePath={entry.relative_path}
        explicit={detail?.frontmatter.related ?? []}
        onOpen={onOpenRelated}
      />

      {body.trim() ? (
        <details className="jd-full" open={fullOpen} onToggle={(e) => setFullOpen((e.currentTarget as HTMLDetailsElement).open)}>
          <summary>{t("journal.fullBody")}</summary>
          {fullOpen ? (
            <div className="jd-prose">
              <Markdown>{withoutTitle(body, entry.title)}</Markdown>
            </div>
          ) : null}
        </details>
      ) : null}
    </article>
  );
});
