/**
 * DiffVsNarrative — side-by-side comparison of a session's index ndjson
 * (ground truth, watcher-captured) vs the union of `files_touched` paths in
 * the journal entries that name the same `session_id`. Backs the four W4-PR6
 * triggers (SessionCard / EmptyTodayV3 / JournalEntryDetail / CommandPalette).
 *
 * W4 dogfooding finding (2026-05-25) — modal form made 3-way comparison hard:
 * users had to mentally diff index ↔ journal across a small modal viewport.
 * The component now renders as an **inline panel** (no overlay, no fixed
 * positioning). Each caller chooses where to mount it — SessionCard puts it
 * below the entries list, TodayScreen / EmptyTodayV3 mount it as a top-level
 * panel, JournalEntryDetail keeps it in the detail pane.
 *
 * Caching: `oculpmApi.compareLayers` is cheap (read-only joins) but the panel
 * can re-mount on every trigger click. A per-session sessionStorage cache
 * (60s TTL, key `oculpm.compare.${projectId}.${sessionId}`) absorbs the dup
 * loads when the user reopens the same panel in quick succession.
 *
 * Actions (W4 dogfooding follow-up 2026-05-26 — split file-sync from prompt-copy):
 *  - [AGENTS.md 재동기화] → `oculpmApi.syncAgents`. Idempotent file write that
 *    re-renders the managed block. Does NOT push anything into a running LLM
 *    session — that's a different concern handled by the next button.
 *  - [프롬프트 복사] → fetch the master template via `oculpmApi.getMasterTemplate`
 *    and write it to the clipboard so the user can paste it once into a live
 *    chat. Warns "여러 번 붙이면 LLM 컨텍스트가 부풀어요" to discourage repeat
 *    pastes — the previous single-button design ("규칙 다시 보내기") read as
 *    "send again" and invited duplicate prompt context in the agent's window.
 *  - [수동 narrative 작성 (N 누락 prefill)] → `onActionManualEntry` callback to
 *    the parent (TodayScreen), which opens `ManualEntryModal` with the
 *    `only_in_index` paths pre-selected.
 *  - [코드 스니펫] toggle — placeholder for future snippet rendering once we
 *    can join ndjson bytes_before/after with the journal narrative. Default
 *    off; turning it on currently shows a "TODO" hint per row.
 *
 * See `docs/major_update/oculpm/W4/PR6-diff-vs-narrative.md`.
 */

import { useCallback, useEffect, useState } from "react";
import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import { toast } from "@/lib/toast";
import type { LayerComparison, Severity } from "@/lib/bindings";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  Check,
  Clipboard,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from "@/components/Icons";

interface DiffVsNarrativeProps {
  projectId: number;
  sessionId: string;
  onClose: () => void;
  /** Fire when the user clicks "수동 narrative 작성"; parent opens the modal. */
  onActionManualEntry?: (prefill: { sessionId: string; files: string[] }) => void;
  /** Visual presentation. `compact` shrinks paddings + drops the close button
   *  for callers (SessionCard) where the surrounding card already provides
   *  collapse affordance. Default `panel` shows the standalone panel chrome. */
  variant?: "panel" | "compact";
}

const CACHE_TTL_MS = 60_000;

function cacheKey(projectId: number, sessionId: string) {
  return `oculpm.compare.${projectId}.${sessionId}`;
}

function readCache(projectId: number, sessionId: string): LayerComparison | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(projectId, sessionId));
    if (!raw) return null;
    const { at, data } = JSON.parse(raw) as { at: number; data: LayerComparison };
    if (Date.now() - at > CACHE_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

function writeCache(projectId: number, sessionId: string, data: LayerComparison) {
  try {
    sessionStorage.setItem(
      cacheKey(projectId, sessionId),
      JSON.stringify({ at: Date.now(), data }),
    );
  } catch {
    // sessionStorage quota / private mode — silently degrade.
  }
}

export function DiffVsNarrative({
  projectId,
  sessionId,
  onClose,
  onActionManualEntry,
  variant = "panel",
}: DiffVsNarrativeProps) {
  const [comparison, setComparison] = useState<LayerComparison | null>(() =>
    readCache(projectId, sessionId),
  );
  const [loading, setLoading] = useState(comparison == null);
  const [error, setError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<
    null | { kind: "pending" } | { kind: "ok"; updated: number } | { kind: "error"; message: string }
  >(null);
  const [copyStatus, setCopyStatus] = useState<
    null | { kind: "pending" } | { kind: "ok" } | { kind: "error"; message: string }
  >(null);
  const [showSnippets, setShowSnippets] = useState(false);

  const load = useCallback(
    async (skipCache = false) => {
      if (!skipCache) {
        const cached = readCache(projectId, sessionId);
        if (cached) {
          setComparison(cached);
          setLoading(false);
          return;
        }
      }
      setLoading(true);
      setError(null);
      try {
        const data = await oculpmApi.compareLayers(projectId, sessionId);
        writeCache(projectId, sessionId, data);
        setComparison(data);
      } catch (e) {
        const msg = e instanceof OculpmApiError ? e.message : String(e);
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [projectId, sessionId],
  );

  useEffect(() => {
    if (comparison == null) void load();
  }, [comparison, load]);

  const handleResync = useCallback(async () => {
    setSyncStatus({ kind: "pending" });
    try {
      const report = await oculpmApi.syncAgents(projectId);
      const updated = report.results.filter(
        (r) => r.action === "inserted" || r.action === "updated",
      ).length;
      setSyncStatus({ kind: "ok", updated });
    } catch (e) {
      const msg = e instanceof OculpmApiError ? e.message : String(e);
      setSyncStatus({ kind: "error", message: msg });
    }
  }, [projectId]);

  const handleCopyPrompt = useCallback(async () => {
    setCopyStatus({ kind: "pending" });
    try {
      const text = await oculpmApi.getMasterTemplate(projectId);
      await navigator.clipboard.writeText(text);
      setCopyStatus({ kind: "ok" });
      toast.warning(
        "프롬프트가 클립보드에 복사됐어요. 한 번만 붙여넣으세요 — 여러 번 붙이면 LLM 컨텍스트가 부풀어 같은 규칙이 중복 적용될 수 있어요.",
        { title: "프롬프트 복사 완료" },
      );
    } catch (e) {
      const msg =
        e instanceof OculpmApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e);
      setCopyStatus({ kind: "error", message: msg });
    }
  }, [projectId]);

  const handleManualEntry = useCallback(() => {
    if (!comparison || !onActionManualEntry) return;
    onActionManualEntry({
      sessionId: comparison.session_id,
      files: comparison.only_in_index,
    });
    onClose();
  }, [comparison, onActionManualEntry, onClose]);

  const isCompact = variant === "compact";
  const panelClasses = isCompact
    ? "rounded-lg border border-border bg-muted/30 text-foreground"
    : "rounded-lg border border-border bg-card text-foreground shadow-sm";
  const padding = isCompact ? "p-2.5" : "px-5 py-4";

  return (
    <section
      className={panelClasses}
      aria-label={`Session ${sessionId} index ↔ journal 비교`}
    >
      {/* W4 dogfooding follow-up (2026-05-26) — header now wraps onto a second
        * row in narrow containers (JournalEntryDetail right column). The title
        * row truncates the session_id and the controls row keeps the snippet
        * toggle on one line via whitespace-nowrap + shrink-0. Previously the
        * "코드 스니펫" label rendered glyph-per-glyph vertically because the
        * single-row flex was over-constrained. */}
      <header className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border ${isCompact ? "px-3 py-2" : "px-5 py-3"}`}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className={`shrink-0 ${isCompact ? "text-sm" : "text-lg"}`}>⚖</span>
          <h3 className={`min-w-0 ${isCompact ? "text-xs" : "text-sm"} font-semibold flex items-baseline gap-1.5`}>
            <span className="shrink-0">index ↔ journal 비교</span>
            <span className="min-w-0 truncate font-mono text-muted-foreground" title={sessionId}>
              · {sessionId}
            </span>
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showSnippets}
              onChange={(e) => setShowSnippets(e.currentTarget.checked)}
              className="h-3 w-3"
            />
            코드 스니펫
          </label>
          {!isCompact && (
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      <div className={padding}>
        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            비교 중…
          </div>
        )}
        {error && (
          <div className="rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
            비교 실패: {error}
            <Button
              size="sm"
              variant="outline"
              onClick={() => void load(true)}
              className="ml-3"
            >
              다시 시도
            </Button>
          </div>
        )}
        {comparison && !loading && !error && (
          <ComparisonBody
            comparison={comparison}
            onActionResync={handleResync}
            syncStatus={syncStatus}
            onActionCopyPrompt={handleCopyPrompt}
            copyStatus={copyStatus}
            onActionManualEntry={onActionManualEntry ? handleManualEntry : undefined}
            showSnippets={showSnippets}
            compact={isCompact}
          />
        )}
      </div>
    </section>
  );
}

interface ComparisonBodyProps {
  comparison: LayerComparison;
  onActionResync: () => void;
  syncStatus:
    | null
    | { kind: "pending" }
    | { kind: "ok"; updated: number }
    | { kind: "error"; message: string };
  onActionCopyPrompt: () => void;
  copyStatus:
    | null
    | { kind: "pending" }
    | { kind: "ok" }
    | { kind: "error"; message: string };
  onActionManualEntry?: () => void;
  showSnippets: boolean;
}

function ComparisonBody({
  comparison,
  onActionResync,
  syncStatus,
  onActionCopyPrompt,
  copyStatus,
  onActionManualEntry,
  showSnippets,
  compact,
}: ComparisonBodyProps & { compact: boolean }) {
  const matched = new Set(comparison.matched);
  // Narrow callers (the JournalEntryDetail tab, ~22rem wide) get a single
  // column with a tight list height. Wide callers keep the side-by-side
  // ground-truth ↔ narrative columns.
  const gridClass = compact
    ? "grid grid-cols-1 gap-2"
    : "grid grid-cols-1 gap-3 md:grid-cols-2";
  const listMaxH = compact ? "max-h-40" : "max-h-72";
  return (
    <>
      <div className={gridClass}>
        <Column
          title={`index · ${comparison.index_files.length}`}
          paths={comparison.index_files}
          maxHClass={listMaxH}
          render={(p) =>
            matched.has(p) ? (
              <PathRow icon="match" label={p} showSnippets={showSnippets} />
            ) : (
              <PathRow icon="missing" label={p} hint="누락" showSnippets={showSnippets} />
            )
          }
        />
        <Column
          title={`journal · ${comparison.journal_files.length}`}
          paths={comparison.journal_files}
          maxHClass={listMaxH}
          render={(p) =>
            matched.has(p) ? (
              <PathRow icon="match" label={p} showSnippets={showSnippets} />
            ) : (
              <PathRow icon="hallucinated" label={p} hint="환각" showSnippets={showSnippets} />
            )
          }
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-[11px] text-muted-foreground">
        <span className="tabular-nums">
          일치 <strong className="text-foreground">{comparison.matched.length}</strong>
          {" · "}누락 <strong className="text-foreground">{comparison.only_in_index.length}</strong>
          {" · "}환각 <strong className="text-foreground">{comparison.only_in_journal.length}</strong>
        </span>
        <SeverityBadge severity={comparison.mismatch_severity} jaccard={comparison.jaccard_index} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          onClick={onActionResync}
          disabled={syncStatus?.kind === "pending"}
          title="AGENTS.md + 활성화된 어댑터 파일의 관리 블록을 다시 렌더링합니다."
        >
          {syncStatus?.kind === "pending" ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
          )}
          {compact ? "재동기화" : "AGENTS.md 재동기화"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onActionCopyPrompt}
          disabled={copyStatus?.kind === "pending"}
          title="마스터 프롬프트를 클립보드에 복사 (1회용)."
        >
          {copyStatus?.kind === "pending" ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Clipboard className="mr-1 h-3.5 w-3.5" />
          )}
          프롬프트 복사
        </Button>
        {onActionManualEntry && comparison.only_in_index.length > 0 && (
          <Button size="sm" onClick={onActionManualEntry}>
            <Sparkles className="mr-1 h-3.5 w-3.5" />
            narrative 작성 ({comparison.only_in_index.length})
          </Button>
        )}
        {syncStatus?.kind === "ok" && (
          <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
            동기화 완료 ({syncStatus.updated})
          </span>
        )}
        {syncStatus?.kind === "error" && (
          <span className="text-[11px] text-red-600 dark:text-red-400">실패: {syncStatus.message}</span>
        )}
        {copyStatus?.kind === "error" && (
          <span className="text-[11px] text-red-600 dark:text-red-400">복사 실패: {copyStatus.message}</span>
        )}
      </div>
    </>
  );
}

interface ColumnProps {
  title: string;
  paths: string[];
  render: (path: string) => React.ReactNode;
  maxHClass?: string;
}

function Column({ title, paths, render, maxHClass = "max-h-72" }: ColumnProps) {
  return (
    <div className="rounded border border-border bg-background/50">
      <div className="border-b border-border px-2 py-1.5 text-[11px] font-medium text-foreground/80">{title}</div>
      <ul className={`${maxHClass} overflow-y-auto scrollbar-thin p-1 text-[11px]`}>
        {paths.length === 0 && (
          <li className="px-2 py-3 text-center text-muted-foreground">(빈 목록)</li>
        )}
        {paths.map((p) => (
          <li key={p}>{render(p)}</li>
        ))}
      </ul>
    </div>
  );
}

type RowIcon = "match" | "missing" | "hallucinated";

function PathRow({
  icon,
  label,
  hint,
  showSnippets,
}: {
  icon: RowIcon;
  label: string;
  hint?: string;
  showSnippets: boolean;
}) {
  const tone =
    icon === "match"
      ? "text-emerald-600 dark:text-emerald-400"
      : icon === "missing"
        ? "text-red-600 dark:text-red-400"
        : "text-amber-600 dark:text-amber-400";
  const Icon = icon === "match" ? Check : AlertTriangle;
  return (
    <div className="rounded px-2 py-1 hover:bg-muted/40">
      <div className="flex items-center gap-2">
        <Icon className={`h-3.5 w-3.5 shrink-0 ${tone}`} />
        <span className="truncate font-mono">{label}</span>
        {hint && <span className={`ml-auto shrink-0 text-[10px] ${tone}`}>{hint}</span>}
      </div>
      {showSnippets && (
        <div className="ml-5 mt-0.5 text-[10px] text-muted-foreground italic">
          {/* Snippet rendering is a future enhancement (needs ndjson before/after bytes joined with diff). */}
          코드 스니펫 미구현 — git diff 로 확인하세요
        </div>
      )}
    </div>
  );
}

function SeverityBadge({ severity, jaccard }: { severity: Severity; jaccard: number | null }) {
  const tone =
    severity === "ok"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : severity === "warning"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300";
  const label = severity === "ok" ? "Ok" : severity === "warning" ? "Warning" : "Critical";
  const jaccardLabel =
    typeof jaccard === "number" ? `jaccard ${(jaccard * 100).toFixed(0)}%` : "";
  return (
    <span className={`ml-auto inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] ${tone}`}>
      severity: {label}
      {jaccardLabel && <span className="opacity-70">· {jaccardLabel}</span>}
    </span>
  );
}
