/**
 * MigrationModal — W5-PR4.
 *
 * Five-step modal that walks a user through migrating their legacy SQLite
 * `changelog_entries` rows into `.oculpm/journal/*.md` files. Mounted from
 * TodayScreen right after `OculpmOnboardingModal` reports `completed` (or
 * via re-entry through Settings — see `useShouldOfferMigration` below).
 *
 * Steps:
 *   1. Summary    — `MigrationPlan` totals + TZ warning + forbidden hits.
 *   2. Options    — per-entry `will_skip` toggle, workday collapse, forbidden
 *                   files shown inline + auto-unchecked.
 *   3. Backup     — backup dir path + estimated size + "백업 없이 진행 옵션
 *                   없음" guard.
 *   4. Progress   — listens to `events.oculpmMigrationProgress` and renders
 *                   a progress bar. Closing the modal is disabled here.
 *   5. Result     — final report (success / `MigrationCommandError`) +
 *                   actions: navigate to Today, open backup folder, dismiss.
 *
 * State: held entirely in this component (no zustand). The mutable plan in
 * step 2 lives in `planRef.current` so toggle updates don't re-fetch the
 * dry-run. localStorage `oculpm.migration.dismissed.${projectId}` records
 * the user choosing "나중에" so the modal doesn't auto-appear next session;
 * Settings can clear this flag.
 */

import { useEffect, useRef, useState } from "react";

import { commands, events } from "@/lib/bindings";
import type {
  MigrationCommandError,
  MigrationEntryPlan,
  MigrationPlan,
  MigrationReport,
  MigrationWorkdayPlan,
  RollbackReport,
} from "@/lib/bindings";
import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Database,
  FolderOpen,
  Loader2,
  Trash2,
  X,
} from "@/components/Icons";

import {
  countForbiddenEntries,
  countSkipped,
  countToWrite,
  extractHHMMFromPath,
  formatBytes,
  formatWorkdayDate,
  setWorkdayWillSkip,
  sortedEntries,
  sortedWorkdays,
  togglePlanEntry,
  totalSyntheticSessionCount,
} from "./migrationLogic";

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export type MigrationCloseReason =
  | "completed"
  | "completed_with_failures"
  | "partial_failure"
  | "aborted"
  | "dismissed"
  | "nothing_to_migrate";

export interface MigrationModalProps {
  projectId: number;
  /** When provided, called when the user clicks "Today 로 이동" so the
   *  parent screen can navigate. */
  onNavigateToToday?: () => void;
  /** When provided, called when the user clicks "구 데이터 삭제하기" on a
   *  successful result — PR7's `LegacyDeleteModal` mounts in response. */
  onOpenLegacyDelete?: (lastReport: MigrationReport) => void;
  onClose: (reason: MigrationCloseReason, report?: MigrationReport) => void;
}

/** localStorage key controlling the auto-trigger from TodayScreen. */
export const MIGRATION_DISMISS_KEY = (projectId: number) =>
  `oculpm.migration.dismissed.${projectId}`;

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

type Step = "summary" | "options" | "backup" | "progress" | "result";

interface ProgressState {
  processed: number;
  total: number;
  currentEntry: string;
}

interface ResultState {
  kind: "ok" | "partial_failure" | "aborted";
  report?: MigrationReport;
  rollback?: RollbackReport;
  errorMessage?: string;
}

export function MigrationModal({
  projectId,
  onNavigateToToday,
  onOpenLegacyDelete,
  onClose,
}: MigrationModalProps) {
  const [step, setStep] = useState<Step>("summary");
  const [plan, setPlan] = useState<MigrationPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressState>({
    processed: 0,
    total: 0,
    currentEntry: "",
  });
  const [result, setResult] = useState<ResultState | null>(null);
  // Live mutable plan during step 2's toggles. Kept in a ref so the parent
  // render doesn't recreate child callbacks on every click.
  const planRef = useRef<MigrationPlan | null>(null);

  // ── Step 1 mount: run dry_run. ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    void oculpmApi
      .migrationDryRun(projectId)
      .then((p) => {
        if (cancelled) return;
        if (p.source_entry_count === 0) {
          onClose("nothing_to_migrate");
          return;
        }
        setPlan(p);
        planRef.current = p;
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setPlanError(
          e instanceof OculpmApiError
            ? e.message
            : e instanceof Error
              ? e.message
              : String(e),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, onClose]);

  // ── Step 4: subscribe to progress events. ─────────────────────────────────
  useEffect(() => {
    if (step !== "progress") return;
    let off: (() => void) | null = null;
    let cancelled = false;
    void events.oculpmMigrationProgress
      .listen((e) => {
        if (cancelled || e.payload.project_id !== projectId) return;
        setProgress({
          processed: e.payload.processed,
          total: e.payload.total,
          currentEntry: e.payload.current_entry,
        });
      })
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
          return;
        }
        off = unlisten;
      });
    return () => {
      cancelled = true;
      off?.();
    };
  }, [step, projectId]);

  // ── Step 4 → 5: kick off the migration when entering progress step. ──────
  useEffect(() => {
    if (step !== "progress") return;
    const current = planRef.current;
    if (!current) {
      setResult({ kind: "aborted", errorMessage: "no plan" });
      setStep("result");
      return;
    }
    void (async () => {
      try {
        const report = await oculpmApi.migrateFromSqlite(projectId, current);
        setResult({ kind: "ok", report });
        setStep("result");
      } catch (err) {
        const envelope =
          err instanceof OculpmApiError
            ? ((err as OculpmApiError & { envelope?: MigrationCommandError })
                .envelope ?? null)
            : null;
        if (envelope?.kind === "partial_failure") {
          setResult({
            kind: "partial_failure",
            rollback: envelope.rollback,
            errorMessage: envelope.error,
          });
        } else if (envelope?.kind === "aborted") {
          setResult({
            kind: "aborted",
            errorMessage: envelope.error,
          });
        } else {
          setResult({
            kind: "aborted",
            errorMessage: err instanceof Error ? err.message : String(err),
          });
        }
        setStep("result");
      }
    })();
    // We intentionally depend on `step` only — entering the step is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, projectId]);

  // ── Esc — disabled during progress so the user can't bail mid-write. ─────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && step !== "progress") {
        onClose(step === "result" ? mapResultClose(result) : "dismissed", result?.report);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, result, onClose]);

  // ── Helpers ──────────────────────────────────────────────────────────────
  const handleToggleEntry = (sourceEntryId: number) => {
    const current = planRef.current;
    if (!current) return;
    const next = togglePlanEntry(current, sourceEntryId);
    planRef.current = next;
    setPlan(next);
  };

  const handleWorkdayToggleAll = (workday: string, willSkip: boolean) => {
    const current = planRef.current;
    if (!current) return;
    const next = setWorkdayWillSkip(current, workday, willSkip);
    planRef.current = next;
    setPlan(next);
  };

  const handleDismissBeforeStart = () => {
    try {
      localStorage.setItem(MIGRATION_DISMISS_KEY(projectId), "1");
    } catch {
      /* private-mode / quota — non-fatal */
    }
    onClose("dismissed");
  };

  const stepIndex: Record<Step, number> = {
    summary: 0,
    options: 1,
    backup: 2,
    progress: 3,
    result: 4,
  };

  const isProgressLocked = step === "progress";

  return (
    <div
      className="fixed inset-0 z-[95] bg-background/70 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isProgressLocked) {
          onClose(step === "result" ? mapResultClose(result) : "dismissed", result?.report);
        }
      }}
    >
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-150">
        {/* Header */}
        <header className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <Database className="w-5 h-5 text-primary" />
            <h2 className="text-base font-bold">구 changelog 마이그레이션</h2>
            <span className="text-xs text-muted-foreground font-medium">
              {stepIndex[step] + 1} / 5
            </span>
          </div>
          <button
            onClick={() => {
              if (isProgressLocked) return;
              onClose(step === "result" ? mapResultClose(result) : "dismissed", result?.report);
            }}
            className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:opacity-50"
            aria-label="닫기 (Esc)"
            disabled={isProgressLocked}
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Step indicator */}
        <div className="px-6 pt-3 pb-1 flex gap-1.5">
          {(["summary", "options", "backup", "progress", "result"] as Step[]).map(
            (s) => (
              <div
                key={s}
                className={`h-1 flex-1 rounded-full transition-all duration-200 ${
                  stepIndex[s] <= stepIndex[step] ? "bg-primary" : "bg-border"
                }`}
              />
            ),
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
          {step === "summary" && (
            <Step1Summary plan={plan} planError={planError} />
          )}
          {step === "options" && plan && (
            <Step2Options
              plan={plan}
              onToggleEntry={handleToggleEntry}
              onWorkdayToggleAll={handleWorkdayToggleAll}
            />
          )}
          {step === "backup" && plan && <Step3BackupConfirm plan={plan} />}
          {step === "progress" && (
            <Step4Progress progress={progress} />
          )}
          {step === "result" && result && (
            <Step5Result
              result={result}
              projectId={projectId}
              onOpenLegacyDelete={onOpenLegacyDelete}
              onNavigateToToday={onNavigateToToday}
              onClose={onClose}
            />
          )}
        </div>

        {/* Footer — actions */}
        <footer className="px-6 py-4 border-t border-border flex items-center justify-between shrink-0 gap-3">
          <FooterActions
            step={step}
            plan={plan}
            isProgressLocked={isProgressLocked}
            onBack={() => setStep(prevStep(step))}
            onNext={() => setStep(nextStep(step))}
            onDismiss={handleDismissBeforeStart}
            onConfirmStart={() => setStep("progress")}
            onCloseResult={() => {
              onClose(step === "result" ? mapResultClose(result) : "dismissed", result?.report);
            }}
          />
        </footer>
      </div>
    </div>
  );
}

function mapResultClose(result: ResultState | null): MigrationCloseReason {
  if (!result) return "dismissed";
  if (result.kind === "partial_failure") return "partial_failure";
  if (result.kind === "aborted") return "aborted";
  if (result.report && result.report.failure_count > 0) {
    return "completed_with_failures";
  }
  return "completed";
}

function prevStep(step: Step): Step {
  if (step === "options") return "summary";
  if (step === "backup") return "options";
  return step;
}

function nextStep(step: Step): Step {
  if (step === "summary") return "options";
  if (step === "options") return "backup";
  return step;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — Summary
// ─────────────────────────────────────────────────────────────────────────────

function Step1Summary({
  plan,
  planError,
}: {
  plan: MigrationPlan | null;
  planError: string | null;
}) {
  if (planError) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
        <div className="font-semibold mb-1">마이그레이션 계획 실패</div>
        <code className="text-xs break-all">{planError}</code>
      </div>
    );
  }
  if (!plan) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        구 changelog 검사 중…
      </div>
    );
  }

  const conflicts = plan.conflicts.length;
  const forbiddenEntries = countForbiddenEntries(plan);
  const sessions = totalSyntheticSessionCount(plan);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="전체 entries" value={plan.source_entry_count} />
        <Stat label="대상 workday" value={plan.by_workday.length} />
        <Stat label="합성 세션" value={sessions} />
        <Stat label="민감 경로 entries" value={forbiddenEntries} tone={forbiddenEntries > 0 ? "warning" : "default"} />
      </div>

      <div>
        <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
          워크데이별 카운트
        </div>
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs text-muted-foreground">
              <tr>
                <th className="text-left py-2 px-3 font-medium">날짜</th>
                <th className="text-right py-2 px-3 font-medium">entries</th>
                <th className="text-right py-2 px-3 font-medium">세션</th>
              </tr>
            </thead>
            <tbody>
              {sortedWorkdays(plan).map((w) => (
                <tr key={w.workday} className="border-t border-border">
                  <td className="py-1.5 px-3 font-mono">
                    {formatWorkdayDate(w.workday)}
                  </td>
                  <td className="py-1.5 px-3 text-right tabular-nums">
                    {w.entries.length}
                  </td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-muted-foreground">
                    {w.synthetic_session_count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {conflicts > 0 && (
        <Callout tone="info">
          <strong>{conflicts}개 충돌</strong> 발견됨 — 같은 시각·같은 제목인
          entries 가 있어 자동으로 <code className="text-xs">__2</code>,{" "}
          <code className="text-xs">__3</code> suffix 를 붙입니다.
        </Callout>
      )}

      {forbiddenEntries > 0 && (
        <Callout tone="warning">
          <strong>{forbiddenEntries}개 entries</strong> 가 민감 경로 (`.env`,
          credentials 등) 를 포함합니다. 다음 단계에서 자동으로 체크 해제되며,
          사용자가 검토 후 다시 켤 수 있습니다.
        </Callout>
      )}

      <Callout tone="info">
        현재 TZ <code className="text-xs">자동</code> 기준으로 workday 가
        결정됩니다. 과거 entries 가 다른 TZ 에서 작성됐다면 ±1 시간 오차가
        있을 수 있어요.
      </Callout>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — Options
// ─────────────────────────────────────────────────────────────────────────────

function Step2Options({
  plan,
  onToggleEntry,
  onWorkdayToggleAll,
}: {
  plan: MigrationPlan;
  onToggleEntry: (sourceEntryId: number) => void;
  onWorkdayToggleAll: (workday: string, willSkip: boolean) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapsed = (workday: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(workday)) next.delete(workday);
      else next.add(workday);
      return next;
    });
  };

  const writeCount = countToWrite(plan);
  const skipCount = countSkipped(plan);

  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground">
        체크된 항목만 변환합니다. 민감 경로를 포함한 entries 는 기본 체크
        해제. 필요하면 직접 켜세요 — 해당 파일 경로는 frontmatter / body
        에서 자동 제거됩니다.
        <span className="ml-2 inline-flex items-center gap-2">
          <span className="px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium">
            {writeCount} 작성
          </span>
          <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
            {skipCount} 건너뜀
          </span>
        </span>
      </div>

      <div className="space-y-2">
        {sortedWorkdays(plan).map((w) => (
          <WorkdayBlock
            key={w.workday}
            workday={w}
            collapsed={collapsed.has(w.workday)}
            onToggleCollapse={() => toggleCollapsed(w.workday)}
            onToggleEntry={onToggleEntry}
            onWorkdayToggleAll={onWorkdayToggleAll}
          />
        ))}
      </div>
    </div>
  );
}

function WorkdayBlock({
  workday,
  collapsed,
  onToggleCollapse,
  onToggleEntry,
  onWorkdayToggleAll,
}: {
  workday: MigrationWorkdayPlan;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onToggleEntry: (sourceEntryId: number) => void;
  onWorkdayToggleAll: (workday: string, willSkip: boolean) => void;
}) {
  const allChecked = workday.entries.every((e) => !e.will_skip);
  const allUnchecked = workday.entries.every((e) => e.will_skip);

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-muted/30">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="text-sm font-semibold tabular-nums hover:underline"
        >
          {collapsed ? "▶" : "▼"} {formatWorkdayDate(workday.workday)}{" "}
          <span className="text-xs font-normal text-muted-foreground">
            ({workday.entries.length} entries · {workday.synthetic_session_count} 세션)
          </span>
        </button>
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={allChecked}
            onClick={() => onWorkdayToggleAll(workday.workday, false)}
            className="text-xs px-2 py-1 rounded border border-border hover:bg-accent disabled:opacity-40"
          >
            전부 선택
          </button>
          <button
            type="button"
            disabled={allUnchecked}
            onClick={() => onWorkdayToggleAll(workday.workday, true)}
            className="text-xs px-2 py-1 rounded border border-border hover:bg-accent disabled:opacity-40"
          >
            전부 해제
          </button>
        </div>
      </div>
      {!collapsed && (
        <ul className="divide-y divide-border">
          {sortedEntries(workday).map((entry) => (
            <EntryRow
              key={entry.source_entry_id}
              entry={entry}
              onToggle={() => onToggleEntry(entry.source_entry_id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function EntryRow({
  entry,
  onToggle,
}: {
  entry: MigrationEntryPlan;
  onToggle: () => void;
}) {
  const hasForbidden = entry.forbidden_files.length > 0;
  return (
    <li className="px-3 py-2 hover:bg-muted/20">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={!entry.will_skip}
          onChange={onToggle}
          className="mt-0.5 size-4 accent-primary"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              {extractHHMMFromPath(entry.target_relative_path)}
            </span>
            <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-muted/60 uppercase">
              {entry.type_inferred}
            </span>
            <span className="font-medium truncate">{entry.slug}</span>
          </div>
          {hasForbidden && (
            <div className="mt-1 text-xs flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              <span>
                민감 경로: {entry.forbidden_files.join(", ")}
              </span>
            </div>
          )}
        </div>
      </label>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 — Backup confirm
// ─────────────────────────────────────────────────────────────────────────────

function Step3BackupConfirm({ plan }: { plan: MigrationPlan }) {
  const bytes = plan.estimated_bytes_written;
  const large = bytes > 100 * 1024 * 1024;
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border p-4 space-y-3">
        <div className="text-xs uppercase tracking-wide font-semibold text-muted-foreground">
          백업
        </div>
        <div className="text-sm">
          마이그레이션 전에 다음 폴더가 생성됩니다 (롤백 시 사용).
        </div>
        <code className="block text-xs bg-muted/30 px-2 py-1.5 rounded break-all">
          &lt;project_root&gt;/{plan.backup_dir}
        </code>
        <div className="text-xs text-muted-foreground">
          예상 작성 크기: {formatBytes(bytes)}
        </div>
      </div>

      {large && (
        <Callout tone="warning">
          작성 크기가 100 MB 를 넘습니다. 디스크 여유 공간을 확인하세요.
        </Callout>
      )}

      <Callout tone="info">
        백업 없이 진행하는 옵션은 제공되지 않습니다. 실패하더라도{" "}
        <code className="text-xs">manifest.json</code> 기반으로 자동 롤백되고
        backup 폴더는 보존됩니다.
      </Callout>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 4 — Progress
// ─────────────────────────────────────────────────────────────────────────────

function Step4Progress({ progress }: { progress: ProgressState }) {
  const total = progress.total;
  const pct = total > 0 ? Math.min(100, (progress.processed / total) * 100) : 0;
  return (
    <div className="space-y-5">
      <div className="text-sm flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-primary" />
        마이그레이션 진행 중…
      </div>

      <div className="space-y-1.5">
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-150"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
          <span>
            {progress.processed} / {total > 0 ? total : "?"}
          </span>
          <span>{pct.toFixed(0)}%</span>
        </div>
      </div>

      {progress.currentEntry && (
        <div className="text-xs text-muted-foreground">
          현재 처리: <code className="text-xs">{progress.currentEntry}</code>
        </div>
      )}

      <Callout tone="info">
        진행 중에는 모달을 닫을 수 없습니다. 완료까지 잠시만 기다려주세요.
      </Callout>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 5 — Result
// ─────────────────────────────────────────────────────────────────────────────

function Step5Result({
  result,
  projectId,
  onOpenLegacyDelete,
  onNavigateToToday,
  onClose,
}: {
  result: ResultState;
  projectId: number;
  onOpenLegacyDelete?: (lastReport: MigrationReport) => void;
  onNavigateToToday?: () => void;
  onClose: (reason: MigrationCloseReason, report?: MigrationReport) => void;
}) {
  if (result.kind === "ok" && result.report) {
    const report = result.report;
    const hasFailures = report.failure_count > 0;
    return (
      <div className="space-y-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
            <Check className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <div className="text-base font-semibold">마이그레이션 완료</div>
            <div className="text-sm text-muted-foreground">
              성공 {report.success_count} · 건너뜀 {report.skip_count} · 실패{" "}
              {report.failure_count}
            </div>
          </div>
        </div>

        {hasFailures && report.failures.length > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-1.5">
            <div className="text-xs font-semibold text-amber-700 dark:text-amber-400">
              실패한 entries
            </div>
            <ul className="text-xs space-y-1">
              {report.failures.slice(0, 10).map((f) => (
                <li key={f.source_entry_id} className="text-muted-foreground">
                  #{f.source_entry_id} — {f.reason}
                </li>
              ))}
              {report.failures.length > 10 && (
                <li className="text-muted-foreground italic">
                  외 {report.failures.length - 10}건 — 로그 확인
                </li>
              )}
            </ul>
          </div>
        )}

        <ResultActions
          projectId={projectId}
          backupDir={report.backup_dir}
          showLegacyDelete={!hasFailures}
          onLegacyDelete={() => onOpenLegacyDelete?.(report)}
          onNavigateToToday={() => {
            onNavigateToToday?.();
            onClose("completed", report);
          }}
          onClose={() =>
            onClose(hasFailures ? "completed_with_failures" : "completed", report)
          }
        />
      </div>
    );
  }

  if (result.kind === "partial_failure" && result.rollback) {
    const rb = result.rollback;
    return (
      <div className="space-y-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-destructive/15 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-destructive" />
          </div>
          <div className="flex-1">
            <div className="text-base font-semibold">마이그레이션 실패</div>
            <div className="text-sm text-muted-foreground">
              부분 작성된 파일을 자동으로 정리했습니다. 백업은 보존됩니다.
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border p-3 space-y-1.5 text-sm">
          <Row label="자동 정리" value={`${rb.removed_paths.length} 파일`} />
          <Row label="이미 없던 파일" value={`${rb.manifest_entries_missing_on_disk} 건`} />
          <Row label="캐시 행 삭제" value={`${rb.deleted_cache_rows} 건`} />
          <Row label="합성 세션 정리" value={`${rb.stripped_session_count} 건`} />
          <Row label="백업 폴더" value={rb.backup_dir} mono />
        </div>

        {result.errorMessage && (
          <div className="text-xs text-muted-foreground">
            원인: <code className="break-all">{result.errorMessage}</code>
          </div>
        )}

        <ResultActions
          projectId={projectId}
          backupDir={rb.backup_dir}
          showLegacyDelete={false}
          onNavigateToToday={() => {
            onNavigateToToday?.();
            onClose("partial_failure");
          }}
          onClose={() => onClose("partial_failure")}
        />
      </div>
    );
  }

  // Aborted (or no rollback report)
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-destructive/15 flex items-center justify-center shrink-0">
          <AlertTriangle className="w-5 h-5 text-destructive" />
        </div>
        <div className="flex-1">
          <div className="text-base font-semibold">마이그레이션 중단</div>
          <div className="text-sm text-muted-foreground">
            자동 정리가 실패했거나 시작 단계에서 중단되었습니다. 백업 폴더가
            남아있다면 수동으로 확인해주세요.
          </div>
        </div>
      </div>
      {result.errorMessage && (
        <div className="text-xs">
          <div className="font-semibold mb-1">오류 메시지</div>
          <code className="block bg-muted/30 px-2 py-1.5 rounded text-xs break-all">
            {result.errorMessage}
          </code>
        </div>
      )}
      <ResultActions
        projectId={projectId}
        backupDir={null}
        showLegacyDelete={false}
        onNavigateToToday={() => {
          onNavigateToToday?.();
          onClose("aborted");
        }}
        onClose={() => onClose("aborted")}
      />
    </div>
  );
}

function ResultActions({
  projectId,
  backupDir,
  showLegacyDelete,
  onLegacyDelete,
  onNavigateToToday,
  onClose,
}: {
  projectId: number;
  backupDir: string | null;
  showLegacyDelete: boolean;
  onLegacyDelete?: () => void;
  onNavigateToToday: () => void;
  onClose: () => void;
}) {
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  const handleOpenBackup = async () => {
    if (!backupDir) return;
    setOpening(true);
    setOpenError(null);
    try {
      const res = await commands.oculpmOpenBackupDir(projectId, backupDir);
      if (res.status === "error") {
        setOpenError(res.error);
      }
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button onClick={onNavigateToToday}>Today 로 이동</Button>
        {backupDir && (
          <Button variant="outline" onClick={handleOpenBackup} disabled={opening}>
            <FolderOpen className="w-3.5 h-3.5" />
            백업 폴더 열기
          </Button>
        )}
        {showLegacyDelete && onLegacyDelete && (
          <Button variant="outline" onClick={onLegacyDelete}>
            <Trash2 className="w-3.5 h-3.5" />
            구 데이터 삭제하기…
          </Button>
        )}
        <Button variant="ghost" onClick={onClose}>
          닫기
        </Button>
      </div>
      {openError && (
        <div className="text-xs text-destructive">
          열기 실패: {openError}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Footer
// ─────────────────────────────────────────────────────────────────────────────

function FooterActions({
  step,
  plan,
  isProgressLocked,
  onBack,
  onNext,
  onDismiss,
  onConfirmStart,
  onCloseResult,
}: {
  step: Step;
  plan: MigrationPlan | null;
  isProgressLocked: boolean;
  onBack: () => void;
  onNext: () => void;
  onDismiss: () => void;
  onConfirmStart: () => void;
  onCloseResult: () => void;
}) {
  if (step === "summary") {
    return (
      <>
        <Button variant="ghost" onClick={onDismiss}>
          나중에
        </Button>
        <Button onClick={onNext} disabled={!plan || plan.source_entry_count === 0}>
          다음 <ArrowRight className="w-3.5 h-3.5" />
        </Button>
      </>
    );
  }
  if (step === "options") {
    const writable = plan ? countToWrite(plan) : 0;
    return (
      <>
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="w-3.5 h-3.5" /> 이전
        </Button>
        <Button onClick={onNext} disabled={writable === 0}>
          다음 <ArrowRight className="w-3.5 h-3.5" />
        </Button>
      </>
    );
  }
  if (step === "backup") {
    return (
      <>
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="w-3.5 h-3.5" /> 이전
        </Button>
        <Button onClick={onConfirmStart}>실행</Button>
      </>
    );
  }
  if (step === "progress") {
    return (
      <Button variant="outline" disabled>
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        진행 중…
      </Button>
    );
  }
  // result
  return (
    <Button variant="ghost" onClick={onCloseResult} disabled={isProgressLocked}>
      닫기
    </Button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Small UI primitives
// ─────────────────────────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number | string;
  tone?: "default" | "warning";
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-xl font-bold tabular-nums ${
          tone === "warning" ? "text-amber-600 dark:text-amber-400" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function Callout({
  tone,
  children,
}: {
  tone: "info" | "warning";
  children: React.ReactNode;
}) {
  const cls =
    tone === "warning"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200"
      : "border-border bg-muted/30 text-muted-foreground";
  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${cls}`}>{children}</div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-xs break-all text-right" : "tabular-nums"}>
        {value}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-trigger helper for TodayScreen
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hook a parent screen calls right after `OculpmOnboardingModal` completes —
 * resolves whether a migration is needed. The hook caches the answer in
 * memory; the caller mounts `MigrationModal` when the result is `"yes"`.
 *
 * Returns:
 *   - `"unknown"` while the dry_run hasn't completed yet.
 *   - `"yes"` when source_entry_count > 0 AND not dismissed.
 *   - `"no"` otherwise.
 */
export function useShouldOfferMigration(
  projectId: number | null,
  enabled: boolean,
): "unknown" | "yes" | "no" {
  const [answer, setAnswer] = useState<"unknown" | "yes" | "no">("unknown");
  useEffect(() => {
    if (!enabled || projectId == null) {
      setAnswer("no");
      return;
    }
    let cancelled = false;
    if (readDismissed(projectId)) {
      setAnswer("no");
      return;
    }
    void oculpmApi
      .migrationDryRun(projectId)
      .then((plan) => {
        if (cancelled) return;
        setAnswer(plan.source_entry_count > 0 ? "yes" : "no");
      })
      .catch(() => {
        if (cancelled) return;
        // Treat failure as "don't offer" — the user can re-trigger from Settings.
        setAnswer("no");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, enabled]);
  return answer;
}

/** Read-only check — safe to call from event handlers. */
export function readDismissed(projectId: number): boolean {
  try {
    return localStorage.getItem(MIGRATION_DISMISS_KEY(projectId)) === "1";
  } catch {
    return false;
  }
}

/** Clear the dismiss flag — Settings should call this when the user clicks
 *  "다시 보기". */
export function clearDismissed(projectId: number): void {
  try {
    localStorage.removeItem(MIGRATION_DISMISS_KEY(projectId));
  } catch {
    /* non-fatal */
  }
}

