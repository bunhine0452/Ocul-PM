import { ErrorCard } from "@/components/ErrorCard";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useSecondTick } from "@/hooks/useSecondTick";
import { Toolbar } from "@/components/Toolbar";
import { Markdown } from "@/components/Markdown";
import { AppDialog } from "@/components/ui/AppDialog";
import { OculSpinner } from "@/components/OculSpinner";
import { ClaudeMark } from "@/components/ClaudeMark";
import {
  History, TriangleAlert, FileText, NotebookPen, RotateCcw, Download,
} from "@/components/Icons";
import { toast } from "@/lib/toast";
import { resolveLlmTarget } from "@/lib/llmTarget";
import {
  commands, type RetroSignals, type RetroInsight, type GeneratedSummary, type SummaryStyle,
} from "@/lib/bindings";
import { RuleCandidatesPanel } from "./RuleCandidates";
import { SkillCandidatesPanel } from "./SkillCandidates";
import { EvalTrendPanel } from "./EvalTrend";
import { DeferLedgerPanel } from "./DeferLedger";
import { MissingSessionsLine } from "./MissingSessions";
// 결정적 신호 패널은 제 파일로 나갔다 — `wd`(YYYYMMDD → M/D)도 거기 산다.
import { SignalsPanel, wd } from "./SignalsPanel";
import { handoffDispatch, terminalOnScreen } from "@/features/terminal/dispatchTarget";
import { useTerminalSessions, useWorkspace, type UiV2View } from "@/contexts/WorkspaceContext";
import {
  consumeRetroGenDone,
  getRetroGenRunning,
  retroGenKey,
  retroGenVersion,
  startRetroGen,
  subscribeRetroGen,
} from "./retroGen";
import { useT, type I18nKey } from "@/i18n";
import { useOculpmDataEvents } from "@/features/oculpm/useOculpmLive";

// F4 — 회고/인사이트 화면. 기간을 고르면 백엔드가 결정적 신호(출시·저항·노력
// 집중·에이전트 기여)를 모아 보여주고, "회고 생성"으로 그 신호 위에 LLM 한국어
// 회고를 덧씌운다. 회고는 기간별로 캐시되며, 신호의 signature 가 바뀌면(=그 사이
// 일지/코드그래프가 변함) "오래됨" 배지를 띄워 재생성을 권한다. 모든 신호는 이미
// 시크릿 마스킹된 SQLite 캐시에서 나오므로 추가 정제가 필요 없다.

type Preset = { days: number; labelKey: I18nKey };
const PRESETS: Preset[] = [
  { days: 7, labelKey: "retro.range.7" },
  { days: 14, labelKey: "retro.range.14" },
  { days: 30, labelKey: "retro.range.30" },
];

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export function RetroScreenV2({
  projectId,
  onNavigate,
}: {
  projectId: number;
  /**
   * #retro-cc-generate — 디스패치 후 터미널 화면으로 이동 (플래너와 동일 결).
   * 터미널이 이미 보이고 있으면 부르지 않는다.
   */
  onNavigate?: (view: UiV2View) => void;
}) {
  const { t } = useT();
  // 디스패치를 어느 셸에 꽂을지 알아야 한다 (활성 탭·포커스 페인).
  const { state } = useWorkspace();
  const sessions = useTerminalSessions();
  const [days, setDays] = useState(7);
  const { since, until, rangeKey } = useMemo(() => {
    const u = new Date();
    const s = new Date();
    s.setDate(s.getDate() - (days - 1));
    const since = ymd(s);
    const until = ymd(u);
    return { since, until, rangeKey: `${since}..${until}` };
  }, [days]);

  const [signals, setSignals] = useState<RetroSignals | null>(null);
  const [cached, setCached] = useState<RetroInsight | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 생성 상태는 전역 버스가 소유 — 화면을 떠났다 와도 "생성 중…"이 이어지고,
  // 부재 중 끝난 결과는 아래 useEffect 가 입양한다.
  const genVersion = useSyncExternalStore(subscribeRetroGen, retroGenVersion);
  const myGenKey = retroGenKey(projectId, rangeKey);
  // 단일 비행은 키 단위다 — 남의 프로젝트/기간이 도는 것은 이 화면과 무관하다.
  const runningGen = getRetroGenRunning(myGenKey);
  const generating = runningGen != null;

  useEffect(() => {
    const done = consumeRetroGenDone(myGenKey);
    if (done?.insight) setCached(done.insight);
  }, [genVersion, myGenKey]);

  // 경과 초 표시 — 생성 중일 때만 공유 1초 시계를 듣는다.
  const now = useSecondTick(generating);
  const elapsedSec =
    generating && runningGen ? Math.max(0, Math.round((now - runningGen.startedAt) / 1000)) : 0;
  const generatingLabel = generating
    ? t("retro.generating", { sec: elapsedSec, provider: runningGen!.provider, model: runningGen!.model })
    : null;

  // 오류 카드의 「다시 시도」 — 같은 범위를 다시 읽게 하는 유일한 손잡이.
  const [reloadNonce, setReloadNonce] = useState(0);
  // `.oculpm/retro/*.md` 가 디스크에서 바뀌면(에이전트가 회고를 씀) 다시 읽는다
  // (Phase 4 #events-over-polling). 이전엔 오류 카드의 재시도만이 재조회였다.
  const bumpReload = useCallback(() => setReloadNonce((n) => n + 1), []);
  useOculpmDataEvents("retro", projectId, true, bumpReload);

  // Refetch deterministic signals + cached narrative whenever the range (or
  // project) changes. The two are independent reads, run in parallel.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    void Promise.all([
      commands.retroSignals(projectId, since, until),
      commands.getRetro(projectId, rangeKey),
    ])
      .then(([sigRes, retroRes]) => {
        if (!alive) return;
        if (sigRes.status === "ok") setSignals(sigRes.data);
        else {
          setSignals(null);
          setError(sigRes.error);
        }
        // 재마운트 refetch 가 (생성 완료 직전에 읽은) null 로, 방금 입양한 같은
        // 기간의 완료 결과를 덮지 않게 — 같은 range 의 기존 값은 유지한다.
        // 다른 range 로 전환한 경우엔 prev.range_key 가 달라 정상적으로 비운다.
        setCached((prev) => {
          const next = retroRes.status === "ok" ? retroRes.data : null;
          if (!next && prev && prev.range_key === rangeKey) return prev;
          return next;
        });
      })
      // `.catch` 가 없어 전송 계층 실패·창 teardown 이 진짜 `Error` 로 튀면
      // `setLoading(false)` 를 못 지나 화면이 스피너로 굳었다 (재시도 버튼도
      // 로딩 분기 뒤에 있다). 실패도 로딩을 반드시 내린다.
      .catch((e) => {
        if (!alive) return;
        setSignals(null);
        setError(String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [projectId, since, until, rangeKey, reloadNonce]);

  const stale =
    !!cached && !!signals && cached.signature !== signals.signature;

  const generate = useCallback(async () => {
    if (generating || !signals || signals.total_entries === 0) return;
    const provR = await commands.settingsGet("default_provider");
    const provider = provR.status === "ok" ? provR.data : null;
    if (!provider) {
      toast.warning(t("retro.needProvider"));
      return;
    }
    const mR = await commands.settingsGet(`model_${provider}`);
    let model = mR.status === "ok" ? mR.data : null;
    if (!model) {
      const dm = await commands.settingsGet("default_model");
      model = dm.status === "ok" ? dm.data : null;
    }
    if (!model) {
      toast.warning(t("retro.needModel"));
      return;
    }
    // 실제 호출·완료 처리는 전역 버스가 맡는다 — 이 컴포넌트가 언마운트돼도
    // 생성은 이어지고, 결과 입양은 genVersion effect 가 한다.
    const started = startRetroGen(
      projectId,
      since,
      until,
      rangeKey,
      provider,
      model,
      state.currentProjectName,
    );
    if (!started) toast.warning(t("retro.alreadyRunning"));
  }, [generating, signals, projectId, since, until, rangeKey, state.currentProjectName]);

  // #retro-cc-generate — 회고 생성을 터미널의 Claude Code 세션으로 디스패치.
  // API 키·과금 없이 동작하고, 진행 과정이 터미널에 그대로 보인다.
  const [dispatchBusy, setDispatchBusy] = useState(false);
  const dispatchRetro = useCallback(async () => {
    if (dispatchBusy) return;
    setDispatchBusy(true);
    try {
      const res = await commands.retroDispatchPrompt(projectId, since, until);
      if (res.status !== "ok") {
        toast.destructive(t("retro.dispatchFailed", { error: res.error }));
        return;
      }
      // 플래너 ▶실행과 같은 핸드오프 — 돌고 있는 에이전트가 있으면 본문을
      // 붙여넣고, 터미널이 이미 보이면 화면을 빼앗지 않는다.
      const onScreen = terminalOnScreen(state);
      const done = await handoffDispatch(
        { projectId, command: res.data.command, prompt: res.data.prompt },
        sessions.terminalTabs,
        sessions.terminalActiveId,
      );
      toast.info(
        done.kind === "pasted"
          ? t("retro.dispatchPasted", { title: res.data.item_title, agent: done.agent })
          : t("retro.dispatchReady", { title: res.data.item_title }),
      );
      if (!onScreen) onNavigate?.("terminal");
    } finally {
      setDispatchBusy(false);
    }
  }, [dispatchBusy, projectId, since, until, onNavigate, state]);

  // C2 — export the range's journal entries to a shareable .md (native save
  // dialog + write happen in the backend; we just toast the result).
  const exportDigest = useCallback(async () => {
    if (exporting || !signals || signals.total_entries === 0) return;
    setExporting(true);
    const res = await commands.oculpmExportDigest(projectId, since, until);
    setExporting(false);
    if (res.status === "ok") {
      if (res.data) toast.info(t("retro.exported", { path: res.data }));
      // null = 사용자가 취소 → 조용히 무시
    } else {
      toast.destructive(t("retro.exportFailed", { error: res.error }));
    }
  }, [exporting, signals, projectId, since, until]);

  const hasWork = !!signals && signals.total_entries > 0;

  // ── PR-CI7 — Notion 내보내기 (토큰 없으면 버튼 자체 비노출) ────────────────
  const [notionReady, setNotionReady] = useState(false);
  const [notionBusy, setNotionBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void commands.notionStatus().then((res) => {
      if (alive && res.status === "ok") setNotionReady(res.data.has_token);
    });
    return () => {
      alive = false;
    };
  }, []);

  const exportToNotion = useCallback(
    async (title: string, markdown: string) => {
      if (notionBusy) return;
      setNotionBusy(true);
      // projectId — 백엔드가 프로젝트 redact 패턴으로 한 번 더 마스킹한다
      // (외부 반출 심층 방어, 2026-07-20 리뷰).
      const res = await commands.notionExport(projectId, title, markdown);
      setNotionBusy(false);
      if (res.status === "ok") {
        toast.info(t("retro.notionDone"));
        void commands.openUrl(res.data);
      } else {
        toast.destructive(t("retro.notionFailed", { error: res.error }));
      }
    },
    [notionBusy, projectId],
  );

  // ── v2 U10 (C1) — 스탠드업·PR 본문·주간 보고 생성 ─────────────────────────
  const [summaryMenuOpen, setSummaryMenuOpen] = useState(false);
  const [summaryBusy, setSummaryBusy] = useState<SummaryStyle | null>(null);
  const [summaryResult, setSummaryResult] = useState<GeneratedSummary | null>(null);
  const summaryMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!summaryMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (summaryMenuRef.current && !summaryMenuRef.current.contains(e.target as Node)) {
        setSummaryMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [summaryMenuOpen]);

  const runSummary = useCallback(
    async (style: SummaryStyle) => {
      if (summaryBusy) return;
      setSummaryMenuOpen(false);
      setSummaryBusy(style);
      // LLM 미설정/실패여도 백엔드가 결정적 마크다운으로 폴백 — 항상 성공 경로.
      const target = await resolveLlmTarget();
      const res = await commands.oculpmGenerateSummary(
        projectId,
        since,
        until,
        style,
        target?.provider ?? null,
        target?.model ?? null,
      );
      setSummaryBusy(null);
      if (res.status === "ok") {
        setSummaryResult(res.data);
        if (res.data.note) toast.warning(res.data.note);
      } else {
        toast.destructive(t("retro.genFailed", { error: res.error }));
      }
    },
    [summaryBusy, projectId, since, until],
  );

  const copySummary = useCallback(async () => {
    if (!summaryResult) return;
    try {
      await navigator.clipboard.writeText(summaryResult.markdown);
      toast.info(t("retro.copied"));
    } catch {
      toast.destructive(t("retro.copyFailed"));
    }
  }, [summaryResult]);

  const SUMMARY_STYLES: { style: SummaryStyle; labelKey: I18nKey }[] = [
    { style: "standup", labelKey: "retro.summary.standup" },
    { style: "pr_description", labelKey: "retro.summary.pr" },
    { style: "weekly_status", labelKey: "retro.summary.weekly" },
  ];
  const summaryLabel = (s: SummaryStyle) =>
    (() => {
      const found = SUMMARY_STYLES.find((x) => x.style === s);
      return found ? t(found.labelKey) : s;
    })();

  return (
    <>
      <Toolbar title={t("nav.retro")} sub={t("retro.toolbarSub", { since: wd(since), until: wd(until), days })}>
        <div className="flex items-center gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.days}
              type="button"
              className={
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " +
                (days === p.days
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground")
              }
              aria-pressed={days === p.days}
              onClick={() => setDays(p.days)}
            >
              {t(p.labelKey)}
            </button>
          ))}
          <button
            className="btn sm"
            style={{ marginLeft: 8 }}
            onClick={() => void exportDigest()}
            disabled={exporting || loading || !hasWork}
            title={hasWork ? t("retro.exportTitle") : t("retro.noWork")}
          >
            <Download size={14} /> {exporting ? t("retro.exporting") : t("retro.export")}
          </button>
          {/* v2 U10 (C1) — 이 기간을 스탠드업/PR 본문/주간 보고로 */}
          <div className="relative" ref={summaryMenuRef}>
            <button
              className="btn sm"
              onClick={() => setSummaryMenuOpen((o) => !o)}
              disabled={loading || !hasWork || summaryBusy != null}
              aria-haspopup="menu"
              aria-expanded={summaryMenuOpen}
              title={hasWork ? t("retro.summaryTitle") : t("retro.noWork")}
            >
              <FileText size={14} /> {summaryBusy ? t("retro.summaryBusy", { label: summaryLabel(summaryBusy) }) : t("retro.summary")}
            </button>
            {summaryMenuOpen ? (
              <div
                role="menu"
                aria-label={t("retro.summaryKindAria")}
                className="absolute right-0 top-full z-30 mt-1 w-36 rounded-lg border border-border bg-card p-1 shadow-lg"
              >
                {SUMMARY_STYLES.map((s) => (
                  <button
                    key={s.style}
                    type="button"
                    role="menuitem"
                    className="w-full rounded-md px-2.5 py-1.5 text-left text-xs text-foreground/85 hover:bg-accent"
                    onClick={() => void runSummary(s.style)}
                  >
                    {t(s.labelKey)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button
            className="btn sm"
            onClick={() => void dispatchRetro()}
            disabled={loading || !hasWork || dispatchBusy}
            title={
              hasWork
                ? t("retro.claudeTitle")
                : t("retro.noWork")
            }
          >
            <ClaudeMark size={14} /> {t("retro.viaClaude")}
          </button>
          <button
            className="btn primary"
            onClick={() => void generate()}
            disabled={generating || loading || !hasWork}
            title={
              generating
                ? generatingLabel!
                : hasWork
                  ? undefined
                  : t("retro.noWork")
            }
          >
            {generating ? (
              <>
                <OculSpinner size={14} /> {generatingLabel}
              </>
            ) : cached ? (
              <>
                <RotateCcw size={14} /> {t("retro.regen")}
              </>
            ) : (
              <>
                <NotebookPen size={14} /> {t("retro.generate")}
              </>
            )}
          </button>
        </div>
      </Toolbar>

      <div className="scroll">
        <div className="page fade-in">
          {/* {#retro-standing-line} — 로딩·오류·빈 기간을 가리지 않고 **항상**
              그린다. 이 줄이 조건부가 되는 순간 Today 카드와 같은 자기은닉이
              되어, 가려진 주와 깨끗한 주가 화면에서 구별되지 않는다. */}
          <div className="mb-5 max-w-3xl">
            <MissingSessionsLine projectId={projectId} days={days} onNavigate={onNavigate} />
          </div>
          {loading ? (
            <div className="grid place-items-center py-20">
              <OculSpinner size={28} label={t("retro.gatheringSignals")} />
            </div>
          ) : error ? (
            <ErrorCard
              title={t("retro.signalsFailedTitle")}
              error={error}
              onRetry={() => setReloadNonce((n) => n + 1)}
              style={{ maxWidth: 640 }}
            />
          ) : !hasWork ? (
            <div className="empty-hint">
              {t("retro.emptyPeriod")}
            </div>
          ) : (
            <div className="flex flex-col gap-5 max-w-3xl">
              <SignalsPanel signals={signals!} />
              {/* PR-CI6 — EVALS.md 점수 추이 (파일 없으면 스스로 숨음). */}
              <EvalTrendPanel projectId={projectId} />
              {/* defer 원장 — 코드 주석의 미룬 지름길 (마커 없으면 스스로 숨음). */}
              <DeferLedgerPanel projectId={projectId} />
              {/* PR-CI4 — 반복 실패의 규칙 승격 제안 (후보 없으면 스스로 숨음). */}
              <RuleCandidatesPanel projectId={projectId} since={since} until={until} />
              {/* CI4 미러 — 반복 태그의 스킬 승격 제안 (후보 없으면 스스로 숨음). */}
              <SkillCandidatesPanel projectId={projectId} since={since} until={until} />
              <NarrativePanel
                cached={cached}
                stale={stale}
                generating={generating}
                generatingLabel={generatingLabel}
                onGenerate={() => void generate()}
                onDispatch={() => void dispatchRetro()}
                notionReady={notionReady}
                notionBusy={notionBusy}
                onExportNotion={(md) =>
                  void exportToNotion(t("retro.notionTitle", { since: wd(since), until: wd(until) }), md)
                }
              />
            </div>
          )}
        </div>
      </div>

      {/* v2 U10+U13 — 산출물 결과 모달: AppDialog 셸 (포커스 트랩·복원·Esc 내장) */}
      <AppDialog
        open={summaryResult != null}
        onClose={() => setSummaryResult(null)}
        label={t("retro.artifactLabel")}
        width={672}
      >
        {summaryResult ? (
          <>
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <FileText size={15} />
              <span className="text-sm font-semibold">{summaryLabel(summaryResult.style)}</span>
              <span className="text-xs text-muted-foreground">
                {t("retro.artifactMeta", { n: summaryResult.entry_count, mode: summaryResult.used_llm ? t("retro.byAi") : t("retro.byTemplate") })}
              </span>
              <span className="flex-1" />
              {notionReady ? (
                <button
                  className="btn sm"
                  disabled={notionBusy}
                  onClick={() =>
                    void exportToNotion(
                      `${summaryLabel(summaryResult.style)} ${wd(since)}–${wd(until)}`,
                      summaryResult.markdown,
                    )
                  }
                >
                  {notionBusy ? t("retro.notionBusy") : t("retro.toNotion")}
                </button>
              ) : null}
              <button className="btn primary sm" onClick={() => void copySummary()}>
                {t("retro.copyClipboard")}
              </button>
              <button className="btn ghost sm" onClick={() => setSummaryResult(null)}>
                {t("common.close")}
              </button>
            </div>
            <div className="overflow-y-auto p-5">
              <Markdown>{summaryResult.markdown}</Markdown>
            </div>
          </>
        ) : null}
      </AppDialog>
    </>
  );
}


// ─── LLM narrative ───────────────────────────────────────────────────────────

function NarrativePanel({
  cached,
  stale,
  generating,
  generatingLabel,
  onGenerate,
  onDispatch,
  notionReady,
  notionBusy,
  onExportNotion,
}: {
  cached: RetroInsight | null;
  stale: boolean;
  generating: boolean;
  /** 생성 중일 때 경과·모델 표기 (예: "생성 중… 12초 · anthropic/claude-…"). */
  generatingLabel: string | null;
  onGenerate: () => void;
  /** #retro-cc-generate — 터미널 Claude Code 세션으로 생성. */
  onDispatch: () => void;
  /** PR-CI7 — 토큰이 있을 때만 true; false 면 내보내기 버튼을 아예 그리지 않는다. */
  notionReady: boolean;
  notionBusy: boolean;
  onExportNotion: (markdown: string) => void;
}) {
  const { t } = useT();
  if (!cached) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/50 p-6 text-center">
        <History size={22} className="mx-auto mb-2 text-muted-foreground" />
        <div className="text-sm text-muted-foreground">
          {t("retro.genHint")}
        </div>
        <div className="mt-3 flex items-center justify-center gap-2">
          <button className="btn primary" onClick={onGenerate} disabled={generating}>
            {generating ? (
              <>
                <OculSpinner size={14} /> {generatingLabel ?? t("retro.busy")}
              </>
            ) : (
              <>
                <NotebookPen size={14} /> {t("retro.generate")}
              </>
            )}
          </button>
          <button
            className="btn"
            onClick={onDispatch}
            title={t("retro.claudeTitle")}
          >
            <ClaudeMark size={14} /> {t("retro.viaClaude")}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border/60 bg-card p-5">
      <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <History size={13} />
        <span>
          {new Date(cached.generated_at * 1000).toLocaleString("ko-KR")}
          {cached.generated_by_model ? ` · ${cached.generated_by_model}` : ""}
        </span>
        {stale && (
          <span
            className="inline-flex items-center gap-1 rounded bg-(--warn-soft) px-1.5 py-0.5 font-medium text-(--warn-text)"
            title={t("retro.staleTitle")}
          >
            <TriangleAlert size={12} /> {t("retro.stale")}
          </span>
        )}
        <span className="flex-1" />
        {notionReady ? (
          <button
            className="btn sm"
            disabled={notionBusy}
            onClick={() => onExportNotion(cached.retro_md)}
            title={t("retro.notionExportTitle")}
          >
            {notionBusy ? t("retro.notionBusy") : t("retro.toNotion")}
          </button>
        ) : null}
      </div>
      <Markdown>{cached.retro_md}</Markdown>
    </div>
  );
}
