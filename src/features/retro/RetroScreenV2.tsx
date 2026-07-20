import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toolbar } from "@/components/Toolbar";
import { Markdown } from "@/components/Markdown";
import { AppDialog } from "@/components/ui/AppDialog";
import { OculSpinner } from "@/components/OculSpinner";
import {
  History,
  TrendingUp,
  Bug,
  Wrench,
  Bot,
  TriangleAlert,
  SparklesIcon,
  RotateCcw,
  Download,
} from "@/components/Icons";
import { toast } from "@/lib/toast";
import { resolveLlmTarget } from "@/lib/llmTarget";
import {
  commands,
  type RetroSignals,
  type RetroInsight,
  type GeneratedSummary,
  type SummaryStyle,
} from "@/lib/bindings";
import { RuleCandidatesPanel } from "./RuleCandidates";
import { EvalTrendPanel } from "./EvalTrend";

// F4 — 회고/인사이트 화면. 기간을 고르면 백엔드가 결정적 신호(출시·저항·노력
// 집중·에이전트 기여)를 모아 보여주고, "회고 생성"으로 그 신호 위에 LLM 한국어
// 회고를 덧씌운다. 회고는 기간별로 캐시되며, 신호의 signature 가 바뀌면(=그 사이
// 일지/코드그래프가 변함) "오래됨" 배지를 띄워 재생성을 권한다. 모든 신호는 이미
// 시크릿 마스킹된 SQLite 캐시에서 나오므로 추가 정제가 필요 없다.

type Preset = { days: number; label: string };
const PRESETS: Preset[] = [
  { days: 7, label: "최근 7일" },
  { days: 14, label: "최근 14일" },
  { days: 30, label: "최근 30일" },
];

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/** "YYYYMMDD" → "M/D" for compact display. */
function wd(s: string): string {
  if (s.length !== 8) return s;
  return `${Number(s.slice(4, 6))}/${Number(s.slice(6, 8))}`;
}

const KIND_LABEL: Record<string, string> = {
  feature: "기능",
  refactor: "리팩토링",
  error: "에러",
  bug: "버그",
};

export function RetroScreenV2({ projectId }: { projectId: number }) {
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
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tracks the currently-displayed range so a slow generate() that resolves
  // after the user switched ranges doesn't write its (now-wrong) narrative over
  // the new range's view.
  const latestRange = useRef(rangeKey);
  useEffect(() => {
    latestRange.current = rangeKey;
  }, [rangeKey]);

  // Refetch deterministic signals + cached narrative whenever the range (or
  // project) changes. The two are independent reads, run in parallel.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    void Promise.all([
      commands.retroSignals(projectId, since, until),
      commands.getRetro(projectId, rangeKey),
    ]).then(([sigRes, retroRes]) => {
      if (!alive) return;
      if (sigRes.status === "ok") setSignals(sigRes.data);
      else {
        setSignals(null);
        setError(sigRes.error);
      }
      setCached(retroRes.status === "ok" ? retroRes.data : null);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [projectId, since, until, rangeKey]);

  const stale =
    !!cached && !!signals && cached.signature !== signals.signature;

  const generate = useCallback(async () => {
    if (generating || !signals || signals.total_entries === 0) return;
    const provR = await commands.settingsGet("default_provider");
    const provider = provR.status === "ok" ? provR.data : null;
    if (!provider) {
      toast.warning("설정에서 기본 AI 제공자/모델을 먼저 지정하세요.");
      return;
    }
    const mR = await commands.settingsGet(`model_${provider}`);
    let model = mR.status === "ok" ? mR.data : null;
    if (!model) {
      const dm = await commands.settingsGet("default_model");
      model = dm.status === "ok" ? dm.data : null;
    }
    if (!model) {
      toast.warning("설정에서 기본 모델을 먼저 지정하세요.");
      return;
    }
    const rk = rangeKey;
    setGenerating(true);
    const res = await commands.generateRetro(projectId, since, until, provider, model);
    setGenerating(false);
    // Range switched mid-flight — drop this result; the new range owns the view.
    if (latestRange.current !== rk) return;
    if (res.status === "ok") {
      setCached(res.data);
      toast.info("회고를 생성했어요");
    } else {
      toast.destructive(`회고 생성 실패: ${res.error}`);
    }
  }, [generating, signals, projectId, since, until, rangeKey]);

  // C2 — export the range's journal entries to a shareable .md (native save
  // dialog + write happen in the backend; we just toast the result).
  const exportDigest = useCallback(async () => {
    if (exporting || !signals || signals.total_entries === 0) return;
    setExporting(true);
    const res = await commands.oculpmExportDigest(projectId, since, until);
    setExporting(false);
    if (res.status === "ok") {
      if (res.data) toast.info(`내보냈어요: ${res.data}`);
      // null = 사용자가 취소 → 조용히 무시
    } else {
      toast.destructive(`내보내기 실패: ${res.error}`);
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
        toast.info("Notion 페이지를 만들었어요 — 새 창에서 엽니다");
        void commands.openUrl(res.data);
      } else {
        toast.destructive(`Notion 내보내기 실패: ${res.error}`);
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
        toast.destructive(`생성 실패: ${res.error}`);
      }
    },
    [summaryBusy, projectId, since, until],
  );

  const copySummary = useCallback(async () => {
    if (!summaryResult) return;
    try {
      await navigator.clipboard.writeText(summaryResult.markdown);
      toast.info("클립보드에 복사했어요");
    } catch {
      toast.destructive("클립보드 복사에 실패했어요");
    }
  }, [summaryResult]);

  const SUMMARY_STYLES: { style: SummaryStyle; label: string }[] = [
    { style: "standup", label: "스탠드업" },
    { style: "pr_description", label: "PR 본문" },
    { style: "weekly_status", label: "주간 보고" },
  ];
  const summaryLabel = (s: SummaryStyle) =>
    SUMMARY_STYLES.find((x) => x.style === s)?.label ?? s;

  return (
    <>
      <Toolbar title="회고" sub={`${wd(since)} – ${wd(until)} · ${days}일`}>
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
              {p.label}
            </button>
          ))}
          <button
            className="btn sm"
            style={{ marginLeft: 8 }}
            onClick={() => void exportDigest()}
            disabled={exporting || loading || !hasWork}
            title={hasWork ? "이 기간 일지를 .md 로 내보내기" : "이 기간에 기록된 작업이 없습니다"}
          >
            <Download size={14} /> {exporting ? "내보내는 중…" : "내보내기"}
          </button>
          {/* v2 U10 (C1) — 이 기간을 스탠드업/PR 본문/주간 보고로 */}
          <div className="relative" ref={summaryMenuRef}>
            <button
              className="btn sm"
              onClick={() => setSummaryMenuOpen((o) => !o)}
              disabled={loading || !hasWork || summaryBusy != null}
              aria-haspopup="menu"
              aria-expanded={summaryMenuOpen}
              title={hasWork ? "일지를 공유용 산출물로 생성" : "이 기간에 기록된 작업이 없습니다"}
            >
              <SparklesIcon size={14} /> {summaryBusy ? `${summaryLabel(summaryBusy)} 생성 중…` : "산출물"}
            </button>
            {summaryMenuOpen ? (
              <div
                role="menu"
                aria-label="산출물 종류"
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
                    {s.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button
            className="btn primary"
            onClick={() => void generate()}
            disabled={generating || loading || !hasWork}
            title={hasWork ? undefined : "이 기간에 기록된 작업이 없습니다"}
          >
            {generating ? (
              <>
                <OculSpinner size={14} /> 생성 중…
              </>
            ) : cached ? (
              <>
                <RotateCcw size={14} /> 다시 생성
              </>
            ) : (
              <>
                <SparklesIcon size={14} /> 회고 생성
              </>
            )}
          </button>
        </div>
      </Toolbar>

      <div className="scroll">
        <div className="page fade-in">
          {loading ? (
            <div className="grid place-items-center py-20">
              <OculSpinner size={28} label="신호 모으는 중…" />
            </div>
          ) : error ? (
            <div className="empty-hint">신호를 불러오지 못했어요: {error}</div>
          ) : !hasWork ? (
            <div className="empty-hint">
              이 기간에 기록된 작업이 없습니다. 다른 기간을 골라보세요.
            </div>
          ) : (
            <div className="flex flex-col gap-5 max-w-3xl">
              <SignalsPanel signals={signals!} />
              {/* PR-CI6 — EVALS.md 점수 추이 (파일 없으면 스스로 숨음). */}
              <EvalTrendPanel projectId={projectId} />
              {/* PR-CI4 — 반복 실패의 규칙 승격 제안 (후보 없으면 스스로 숨음). */}
              <RuleCandidatesPanel projectId={projectId} since={since} until={until} />
              <NarrativePanel
                cached={cached}
                stale={stale}
                generating={generating}
                onGenerate={() => void generate()}
                notionReady={notionReady}
                notionBusy={notionBusy}
                onExportNotion={(md) =>
                  void exportToNotion(`회고 ${wd(since)}–${wd(until)}`, md)
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
        label="생성된 산출물"
        width={672}
      >
        {summaryResult ? (
          <>
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <SparklesIcon size={15} />
              <span className="text-sm font-semibold">{summaryLabel(summaryResult.style)}</span>
              <span className="text-xs text-muted-foreground">
                일지 {summaryResult.entry_count}건 · {summaryResult.used_llm ? "AI 생성" : "기본 형식"}
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
                  {notionBusy ? "내보내는 중…" : "Notion 으로"}
                </button>
              ) : null}
              <button className="btn primary sm" onClick={() => void copySummary()}>
                클립보드 복사
              </button>
              <button className="btn ghost sm" onClick={() => setSummaryResult(null)}>
                닫기
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

// ─── deterministic signals ───────────────────────────────────────────────────

function SignalsPanel({ signals }: { signals: RetroSignals }) {
  const s = signals;
  return (
    <section className="flex flex-col gap-4">
      {/* stat row */}
      <div className="grid grid-cols-4 gap-2">
        <Stat label="총 일지" value={s.total_entries} />
        <Stat label="출시" value={s.shipped.length} accent="text-emerald-500" />
        <Stat label="저항" value={s.resistance.length} accent="text-amber-500" />
        <Stat label="에이전트" value={s.agent_breakdown.length} />
      </div>

      {s.shipped.length > 0 && (
        <Card icon={<TrendingUp size={15} />} title="출시한 것">
          <ul className="flex flex-col gap-1.5">
            {s.shipped.map((it, i) => (
              <li key={i} className="flex items-baseline gap-2 text-sm">
                <span className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  {KIND_LABEL[it.kind] ?? it.kind}
                </span>
                <span className="flex-1 text-foreground">{it.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {it.agent_id} · {wd(it.workday)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {(s.resistance.length > 0 || s.repeated_files.length > 0) && (
        <Card icon={<Bug size={15} />} title="저항한 것">
          {s.resistance.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {s.resistance.map((it, i) => (
                <li key={i} className="flex items-baseline gap-2 text-sm">
                  <span className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400">
                    {KIND_LABEL[it.kind] ?? it.kind}
                  </span>
                  <span className="flex-1 text-foreground">{it.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {it.status} · {wd(it.workday)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {s.repeated_files.length > 0 && (
            <div className="mt-3 border-t border-border/60 pt-2.5">
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                반복 등장한 문제 파일
              </div>
              <div className="flex flex-wrap gap-1.5">
                {s.repeated_files.map((rf) => (
                  <span
                    key={rf.path}
                    className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs font-mono"
                  >
                    {rf.path}
                    <span className="text-amber-500">×{rf.count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {s.effort_hotspots.length > 0 && (
        <Card icon={<Wrench size={15} />} title="노력이 몰린 곳">
          <ul className="flex flex-col gap-1.5">
            {s.effort_hotspots.map((h) => (
              <li key={h.path} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate font-mono text-xs text-foreground">
                  {h.path}
                </span>
                {h.is_hub && (
                  <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                    코어 허브
                  </span>
                )}
                <span className="shrink-0 text-xs text-muted-foreground">
                  {h.touch_count}회 · 의존 {h.impact_fan_out}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card icon={<Bot size={15} />} title="에이전트 기여">
        <div className="flex flex-col gap-2">
          {s.agent_breakdown.map((a) => (
            <div key={a.agent_id} className="flex items-center gap-2">
              <span className="w-28 shrink-0 truncate text-sm">{a.agent_id}</span>
              <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-primary"
                  style={{ width: `${Math.round((a.share ?? 0) * 100)}%` }}
                />
              </div>
              <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
                {a.entry_count}개 · {Math.round((a.share ?? 0) * 100)}%
              </span>
            </div>
          ))}
          <DifficultyRow mix={s.difficulty_mix} total={s.total_entries} />
        </div>
      </Card>
    </section>
  );
}

function DifficultyRow({
  mix,
  total,
}: {
  mix: RetroSignals["difficulty_mix"];
  total: number;
}) {
  const buckets: { label: string; n: number }[] = [
    { label: "매우낮음", n: mix.verylow },
    { label: "낮음", n: mix.low },
    { label: "보통", n: mix.medium },
    { label: "높음", n: mix.high },
    { label: "매우높음", n: mix.superhigh },
    { label: "미지정", n: mix.null_count },
  ].filter((b) => b.n > 0);
  if (buckets.length === 0 || total === 0) return null;
  return (
    <div className="mt-2 border-t border-border/60 pt-2.5">
      <div className="mb-1.5 text-xs font-medium text-muted-foreground">난이도 분포</div>
      <div className="flex flex-wrap gap-1.5">
        {buckets.map((b) => (
          <span key={b.label} className="rounded bg-muted px-2 py-0.5 text-xs">
            {b.label} {b.n}
          </span>
        ))}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card px-3 py-2.5">
      <div className={`text-2xl font-semibold tabular-nums ${accent ?? "text-foreground"}`}>
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Card({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-4">
      <div className="mb-2.5 flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <span className="text-muted-foreground">{icon}</span>
        {title}
      </div>
      {children}
    </div>
  );
}

// ─── LLM narrative ───────────────────────────────────────────────────────────

function NarrativePanel({
  cached,
  stale,
  generating,
  onGenerate,
  notionReady,
  notionBusy,
  onExportNotion,
}: {
  cached: RetroInsight | null;
  stale: boolean;
  generating: boolean;
  onGenerate: () => void;
  /** PR-CI7 — 토큰이 있을 때만 true; false 면 내보내기 버튼을 아예 그리지 않는다. */
  notionReady: boolean;
  notionBusy: boolean;
  onExportNotion: (markdown: string) => void;
}) {
  if (!cached) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/50 p-6 text-center">
        <History size={22} className="mx-auto mb-2 text-muted-foreground" />
        <div className="text-sm text-muted-foreground">
          위 신호를 바탕으로 한국어 회고를 생성할 수 있어요.
        </div>
        <button
          className="btn primary"
          style={{ marginTop: 12 }}
          onClick={onGenerate}
          disabled={generating}
        >
          {generating ? (
            <>
              <OculSpinner size={14} /> 생성 중…
            </>
          ) : (
            <>
              <SparklesIcon size={14} /> 회고 생성
            </>
          )}
        </button>
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
            className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 font-medium text-amber-600 dark:text-amber-400"
            title="이 회고 이후 일지·코드가 바뀌었어요. 다시 생성하면 최신 상태를 반영합니다."
          >
            <TriangleAlert size={12} /> 오래됨
          </span>
        )}
        <span className="flex-1" />
        {notionReady ? (
          <button
            className="btn sm"
            disabled={notionBusy}
            onClick={() => onExportNotion(cached.retro_md)}
            title="이 회고를 Notion 부모 페이지 아래 새 페이지로 내보냅니다"
          >
            {notionBusy ? "내보내는 중…" : "Notion 으로"}
          </button>
        ) : null}
      </div>
      <Markdown>{cached.retro_md}</Markdown>
    </div>
  );
}
