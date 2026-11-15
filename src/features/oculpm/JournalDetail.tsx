import { forwardRef, useCallback, useEffect, useMemo, useState, type MutableRefObject } from "react";
import { LoadingState } from "@/components/LoadingState";
import { MachineText } from "@/components/MachineText";
import { Markdown } from "@/components/Markdown";
import { CheckMark, ChevronLeft, ChevronRight } from "@/components/Icons";
import { oculpmApi } from "@/api/oculpm";
import { toAppError } from "@/api/invoke";
import { tError } from "@/i18n/errors";
import { useOptionalSettings } from "@/contexts/SettingsContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { PatchView } from "@/features/diff/PatchView";
import { countPatchStats, langFromPath } from "@/features/diff/diffParse";
import { agentLabel } from "@/features/today/agentColor";
import { useT, type Lang } from "@/i18n";
import type { EntryFileDiff, JournalEntry, JournalEntrySummary, JournalPlanLink } from "@/lib/bindings";
import { splitPath } from "@/lib/filePath";
import { toast } from "@/lib/toast";
import { localWorkdayKey } from "@/lib/workday";
import { workdayDate } from "@/lib/workdayLabel";
import { EvidenceMark, plainTitle } from "./JournalRow";
import { JournalRelated } from "./JournalRelated";
import { evidenceStateOf } from "./evidenceState";
import { TriggerBadge } from "./triggerMeta";
import { verificationLines, withoutTitle, withoutVerification } from "./verification";
import { isConfirmed, isStaleVerified } from "./verified";
import { useJournalEvents } from "./useOculpmLive";
import { useOpenInEditor } from "@/features/shell/useOpenInEditor";
import { requestSendToClaude } from "@/features/terminal/sendToClaude";
import { NAV_BUS, type OpenEntityDetail } from "@/lib/navRegistry";

// 작업 일지 상세 (4.0 → 화면 검사 {#journal-body} → 11-15) — 한 건을 한 장에. 위에서 아래로: 무엇이었나
// (종류·검증·메타 → 제목) → 믿을 근거(검증 상자: 돌린 명령과 결과 끝 줄) → 사람이 읽는 본문(검증 칸만 뺀
// 그대로) → 실제로 바뀐 것(인라인 diff) → 관련 일지. 근거가 본문 앞이다 — 본문이 긴 일지(대부분)에서 검증
// 상자가 800px 본문 뒤에 서 있었다(계획 문서가 판정 카드를 제목 아래 두는 이유와 같다).
//
// 화면이 `key={경로}` 로 그린다 — 다른 일지로 옮기면 이 컴포넌트가 새로 선다. 옮긴 직후 새 제목 아래
// 옛 본문 · diff 가 한 프레임 서던 것, 늦게 온 읽음 응답이 옮긴 일지에 붙던 것이 그렇게 사라진다.

/**
 * "2026-10-28T14:02:11+09:00" → 날짜 「10월 28일」 · 「October 28」 + 시각 「14:02」. 날짜 말은 같은 화면 목록의 날짜
 * 머리와 같은 함수(`workdayDate`)다 (11-15 RC-23) — 영어에서 왼쪽은 「November 15」, 오른쪽 머리는 「11/15」 였다.
 */
function whenParts(createdAt: string, lang: Lang): { date: string; time: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(createdAt);
  if (!m) return null;
  return { date: workdayDate(`${m[1]}${m[2]}${m[3]}`, lang), time: m[4] };
}

/** 화면이 키로 부르는 상세의 동작 — v(읽음) · [ ](이전 · 다음 파일). */
export interface JournalDetailActions {
  toggleVerified: () => void;
  stepFile: (delta: number) => void;
}

interface JournalDetailProps {
  projectId: number;
  entry: JournalEntrySummary;
  planLinks: readonly JournalPlanLink[];
  /** 변경 화면으로 건너가 이 일지의 파일을 연다 (기록된 diff 가 없을 때의 탈출구). */
  onOpenDiff: (entry: JournalEntrySummary) => void;
  onOpenRelated: (relativePath: string) => void;
  /** 키(v · [ ])가 부를 동작 — 화면이 쥔다. */
  actionsRef?: MutableRefObject<JournalDetailActions | null>;
  /** 읽음이 바뀌었다 — 화면이 목록(「검증 없는 것만」)에 바로 반영한다. */
  onVerifiedChange?: (relativePath: string, verified: boolean) => void;
}

export const JournalDetail = forwardRef<HTMLDivElement, JournalDetailProps>(function JournalDetail(
  { projectId, entry, planLinks, onOpenDiff, onOpenRelated, actionsRef, onVerifiedChange },
  ref,
) {
  const { t, lang } = useT();
  const { state } = useWorkspace();
  const [detail, setDetail] = useState<JournalEntry | null>(null);
  const [diffs, setDiffs] = useState<EntryFileDiff[] | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [fileIdx, setFileIdx] = useState(0);
  const [warnsOpen, setWarnsOpen] = useState(false);

  // 사람 확인 — 목록 요약이 늦게 따라오므로 화면 지역 상태로 먼저 그린다.
  const [verified, setVerified] = useState(entry.verified_by_user);
  const [stale, setStale] = useState(entry.verified_stale);
  const [verifying, setVerifying] = useState(false);
  // 방금 이 화면에서 읽음을 눌렀다 — 그때만 그 날을 머리에 적는다. 디스크에는 읽은 시각이 없다: 파일 mtime 은
  // pull · checkout · 에이전트의 다른 고침에도 바뀌어, 읽지 않은 날을 읽은 날로 적었다(11-15).
  const [readNow, setReadNow] = useState(false);
  useEffect(() => {
    setVerified(entry.verified_by_user);
    setStale(entry.verified_stale);
  }, [entry.verified_by_user, entry.verified_stale]);

  // 디스크가 SSOT 다 — 열어 둔 일지를 에이전트가 고치거나 diff 사이드카가 뒤늦게 기록되면 따라온다.
  const [reloadTick, setReloadTick] = useState(0);
  const reload = useCallback(() => setReloadTick((n) => n + 1), []);
  useJournalEvents(projectId, true, reload);

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
        if (!cancelled) setDiffError(tError(toAppError(e)));
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
    const path = entry.relative_path;
    try {
      await oculpmApi.setJournalVerified(projectId, path, next);
      setVerified(next);
      setStale(false);
      setReadNow(next);
      onVerifiedChange?.(path, next);
    } catch (e) {
      toast.destructive(t("entry.verifyFailed", { error: tError(toAppError(e)) }));
    } finally {
      setVerifying(false);
    }
  }, [verifying, verified, stale, projectId, entry.relative_path, onVerifiedChange, t]);

  const editorCmd = useOptionalSettings()?.settings.externalEditorCommand ?? null;
  const openInEditor = useCallback(async () => {
    try {
      await oculpmApi.openEntryInEditor(projectId, entry.relative_path, editorCmd);
    } catch (e) {
      toast.destructive(t("entry.openInEditorFailed", { error: tError(toAppError(e)) }));
    }
  }, [projectId, entry.relative_path, editorCmd, t]);

  const body = detail?.body_markdown ?? "";
  const level = detail?.evidence ?? entry.evidence;
  const judged = entry.type === "bug" || entry.type === "feature" || entry.type === "refactor";
  // 머리는 디스크의 제목이 먼저다 — 에이전트가 제목을 고치면 목록 요약은 한 박자 늦는다.
  const title = plainTitle(detail?.title || entry.title) || entry.slug;
  // 백틱을 남긴 줄 — 그릴 때 코드 조각을 기계 글씨로 읽는다(`MachineText`).
  const lines = useMemo(() => verificationLines(body, 12, true), [body]);
  const prose = useMemo(() => withoutVerification(withoutTitle(body, detail?.title || entry.title)), [body, detail?.title, entry.title]);
  const confirmed = isConfirmed({ verified_by_user: verified, verified_stale: stale });
  const evState = evidenceStateOf({ ...entry, evidence: level, verified_by_user: verified, verified_stale: stale });
  const warnings = detail?.parse_warnings ?? entry.parse_warnings;
  // 목록 줄(`JournalRow`)과 같은 판정 — 못 읽은 파일만 예외다. 비치명 경고(빠진 칸을 기본값으로 채움)까지
  // warn 칩으로 세우면 목록과 상세가 다른 말을 했다.
  const parseWarn = (detail?.parse_ok ?? entry.parse_ok) === false;
  // 검증 상자가 서는 일지 — 「읽음」 단추가 여기 있다. 없는 일지에서 v 는 아무것도 쓰지 않는다.
  const showVerify = judged || level > 0;

  // 기록된 diff 가 있는 파일만 오간다. frontmatter 에는 있는데 패치가 없는 파일은 개수로만 말한다.
  const editor = useOpenInEditor(state.currentProjectRoot);
  const files = useMemo(() => diffs ?? [], [diffs]);
  const fileAt = files.length > 0 ? Math.min(fileIdx, files.length - 1) : 0;
  const active = files.length > 0 ? files[fileAt] : null;
  const stats = active ? countPatchStats(active.patch) : null;
  const recorded = useMemo(() => new Set(files.map((f) => f.path)), [files]);
  const unrecordedFiles = (detail?.frontmatter.files_touched ?? []).filter((f) => !recorded.has(f.path)).length;
  const stepFile = useCallback(
    (delta: number) => {
      if (files.length < 2) return;
      setFileIdx((i) => (Math.min(i, files.length - 1) + delta + files.length) % files.length);
    },
    [files.length],
  );

  // 화면의 키(v · [ ])가 부를 동작. 렌더마다 갈아 끼운다 — 늘 지금 상태의 함수다. 「읽음」 단추가 없는
  // 일지(잡일 · 증거 0)에서 v 는 아무것도 하지 않는다 — 단추도 없이 디스크에 읽음을 쓰지 않게.
  useEffect(() => {
    if (!actionsRef) return;
    actionsRef.current = { toggleVerified: showVerify ? () => void toggleVerified() : () => {}, stepFile };
    return () => {
      actionsRef.current = null;
    };
  }, [actionsRef, toggleVerified, stepFile, showVerify]);

  const planText =
    planLinks.length > 0
      ? `${t("journal.planLink", { plan: planLinks[0].plan_title, item: `#${planLinks[0].item_id}` })}${
          planLinks.length > 1 ? ` +${planLinks.length - 1}` : ""
        }`
      : null;
  const model = detail?.frontmatter.agent.version ?? entry.agent_version;
  const readText = confirmed ? (readNow ? t("journal.readOn", { date: workdayDate(localWorkdayKey(), lang) }) : t("entry.verified")) : null;
  const when = whenParts(entry.created_at, lang);
  // 시각만 기계 글씨다(영수증 규칙 2) — 날짜는 사람 말이라 본문 서체.
  const metaText = [agentLabel(entry.agent_id), model, readText].filter(Boolean).join(" · ");
  // 이 일지가 갱신한 계획 — 누르면 그 계획으로 건너간다 (ocul-next #nav-links).
  const openPlan = () =>
    planLinks[0] &&
    window.dispatchEvent(
      new CustomEvent<OpenEntityDetail>(NAV_BUS.openEntity, {
        detail: { kind: "plan_item", id: `${planLinks[0].plan_id}#${planLinks[0].item_id}` },
      }),
    );

  const staleRead = isStaleVerified({ verified_by_user: verified, verified_stale: stale });
  const readTitle = staleRead ? t("entry.reverifyTitle") : confirmed ? t("entry.unverifyTitle") : t("entry.verifyTitle");
  const readLabel = stale ? t("entry.reverify") : confirmed ? t("entry.verified") : t("entry.verify");
  const { dir, base } = active ? splitPath(active.path, "", Infinity) : { dir: "", base: "" };

  return (
    <article className="jd" ref={ref} tabIndex={-1} aria-label={title}>
      <header className="jd-head">
        <div className="jd-chips">
          <TriggerBadge type={entry.type} />
          <EvidenceMark state={evState} />
          {entry.status !== "done" ? (
            <span className="chip sm hairline">
              {entry.status === "abandoned" ? t("entry.status.abandoned") : t("entry.status.open")}
            </span>
          ) : null}
          {parseWarn ? (
            // 파싱 경고 — 누르면 읽지 못한 줄과 파일로 여는 길 (계획의 「읽지 못한 줄」 과 같은 꼴).
            <button
              type="button"
              className="chip sm warn jd-warn-btn"
              aria-expanded={warnsOpen}
              onClick={() => setWarnsOpen((v) => !v)}
            >
              {warnings.length > 0 ? t("journal.parseWarnCount", { n: warnings.length }) : t("entry.parseWarnShort")}
            </button>
          ) : null}
          <span className="jd-meta">
            {when ? (
              <>
                {when.date} <span className="mono">{when.time}</span>
              </>
            ) : (
              entry.created_at
            )}
            {metaText ? ` · ${metaText}` : null}
            {planText ? (
              <>
                {" · "}
                <button type="button" className="text-link jd-plan-link" onClick={openPlan} title={t("journal.planLinkTitle")}>
                  {planText}
                </button>
              </>
            ) : null}
          </span>
        </div>
        <h2 className="jd-title">{title}</h2>
        <div className="jd-actions">
          <button type="button" className="btn sm" onClick={() => void openInEditor()} title={t("entry.openInEditorTitle")}>
            {t("journal.openFile")}
          </button>
          <button
            type="button"
            className="btn sm"
            onClick={() =>
              requestSendToClaude({
                kind: "journal",
                label: title,
                ref: `.oculpm/journal/${entry.relative_path}`,
                note: level === 0 ? t("today.check.kind.evidence") : undefined,
              })
            }
          >
            {t("send.title")}
          </button>
        </div>
      </header>

      {parseWarn && warnsOpen ? (
        <div className="jd-warns">
          {warnings.length > 0 ? (
            <ul>
              {warnings.map((w, i) => (
                <li key={`${i}-${w}`}>{w}</li>
              ))}
            </ul>
          ) : null}
          <button type="button" className="btn sm" onClick={() => void openInEditor()}>
            {t("journal.openFile")}
          </button>
        </div>
      ) : null}

      {showVerify ? (
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
            {/* 「읽음」 — 눌렸는지 눈으로 안다: ✓ + 상태 글자, 눌리면 면 + 테(눌린 단추 한 벌, screens-overflow.css), 툴팁은
                그때 할 일(해제). 키 v 는 오늘의 「읽음 표시 v」 와 같은 표기다(알린 키 = 듣는 키, V-06). */}
            <button
              type="button"
              className="btn sm jd-read"
              aria-pressed={confirmed}
              disabled={verifying}
              onClick={() => void toggleVerified()}
              title={readTitle}
            >
              {confirmed ? <CheckMark size={13} aria-hidden="true" /> : null}
              {readLabel}
              <span className="kbd" aria-hidden="true">
                v
              </span>
            </button>
          </div>
          {level < 2 ? <p className="jd-verify-note">{t("journal.verify.claimOnly")}</p> : null}
          {/* 본문 서체에 명령 · 결과 토큰만 기계 글씨 — 에이전트가 쓴 한국어 문장까지 고정폭으로 그리지 않는다(V-08). */}
          {lines.length > 0 ? (
            <div className="jd-term">
              {lines.map((line, i) => (
                <span key={i}>
                  {i > 0 ? "\n" : null}
                  <MachineText text={line} />
                </span>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {prose ? (
        <div className="jd-prose">
          <Markdown>{prose}</Markdown>
        </div>
      ) : null}

      <section className="jd-diff" aria-label={t("journal.diff.aria")}>
        {diffError ? (
          <p className="jd-diff-note">{t("entry.diffLoadFailed", { error: diffError })}</p>
        ) : diffs == null ? (
          <LoadingState align="start" density="compact" />
        ) : active ? (
          <>
            <div className="jd-diff-fh">
              <span className="jd-diff-name" title={active.path}>
                {dir ? (
                  <span className="jd-diff-dir">
                    <bdi>{dir}</bdi>
                  </span>
                ) : null}
                <span className="jd-diff-base">{base}</span>
              </span>
              {stats ? (
                <span className="diff-stat" title={t("diff.statsTitle")}>
                  <span className="add">+{stats.add}</span>
                  <span className="del">−{stats.del}</span>
                </span>
              ) : null}
              <span className="jd-diff-sp" />
              {/* 이 파일을 편집기(VS Code)에서 — 일지에서 코드로 바로 (2026-11-03). */}
              <button type="button" className="btn ghost sm" onClick={() => editor.open(active.path)}>
                {editor.label}
              </button>
              <span className="jd-diff-pos">{t("journal.diff.position", { n: files.length, i: fileAt + 1 })}</span>
              {files.length > 1 ? (
                <>
                  <button
                    type="button"
                    className="iconbtn sm"
                    aria-label={t("entry.prevFile")}
                    title={`${t("entry.prevFile")} ([)`}
                    onClick={() => stepFile(-1)}
                  >
                    <ChevronLeft size={15} />
                  </button>
                  <button
                    type="button"
                    className="iconbtn sm"
                    aria-label={t("entry.nextFile")}
                    title={`${t("entry.nextFile")} (])`}
                    onClick={() => stepFile(1)}
                  >
                    <ChevronRight size={15} />
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

      {/* 본문을 읽은 뒤에 — 적어 둔 링크(frontmatter)를 모른 채 추천부터 세웠다가 다시 늘어놓지 않게. */}
      {detail ? (
        <JournalRelated
          projectId={projectId}
          relativePath={entry.relative_path}
          explicit={detail.frontmatter.related ?? []}
          onOpen={onOpenRelated}
        />
      ) : null}
    </article>
  );
});
