/**
 * LegacyDeleteModal — W5-PR7.
 *
 * Confirms a destructive truncate of `changelog_entries` + `changelog_files`
 * for the project. Multiple safety gates:
 *   1. Migration history must exist (caller hides the CTA otherwise).
 *   2. User must type the slug `delete-legacy-changelog` exactly.
 *   3. `confirm_token` is constructed from the chosen history row and
 *      validated server-side (rejects tampered values).
 *
 * The destructive call writes a JSON safety dump to
 * `.oculpm.backup-legacy-deletion-<ISO>` first, so even after this succeeds
 * the user can recover via the backup folder.
 */

import { useEffect, useMemo, useState } from "react";

import { commands } from "@/lib/bindings";
import type {
  LegacyDeletionReport,
  MigrationHistoryEntry,
  MigrationReport,
} from "@/lib/bindings";
import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle,
  Check,
  FolderOpen,
  Loader2,
  Trash2,
  X,
} from "@/components/Icons";

const REQUIRED_SLUG = "delete-legacy-changelog";

export interface LegacyDeleteModalProps {
  projectId: number;
  /** Pre-selected migration report — usually `MigrationModal` 의 step 5 에서
   *  넘긴 last-completed report. `null` ⇒ 모달이 자체적으로 history를 fetch
   *  해서 가장 최근 항목을 사용. */
  lastReport?: MigrationReport | null;
  onClose: (deleted: LegacyDeletionReport | null) => void;
}

export function LegacyDeleteModal({
  projectId,
  lastReport,
  onClose,
}: LegacyDeleteModalProps) {
  const [history, setHistory] = useState<MigrationHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slugInput, setSlugInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [report, setReport] = useState<LegacyDeletionReport | null>(null);

  // Fetch history on mount so the modal sees the persisted record even if
  // the parent didn't have a `MigrationReport` cached (e.g., Settings entry).
  useEffect(() => {
    let cancelled = false;
    void oculpmApi
      .getMigrationHistory(projectId)
      .then((h) => {
        if (cancelled) return;
        setHistory(h);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Pick the history row to act on — prefer the prop, else the most recent
  // un-deleted row. Re-derives whenever history loads.
  const target = useMemo<MigrationHistoryEntry | null>(() => {
    if (!history) return null;
    // If lastReport's backup_dir matches one of the history rows, pick that.
    if (lastReport) {
      const match = history.find((h) => h.backup_dir === lastReport.backup_dir);
      if (match && !match.legacy_deleted_at) return match;
    }
    return history.find((h) => !h.legacy_deleted_at) ?? null;
  }, [history, lastReport]);

  const slugOk = slugInput === REQUIRED_SLUG;
  const canSubmit = target != null && slugOk && !submitting && report == null;

  const handleDelete = async () => {
    if (!target) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = `migrated:${target.report_timestamp}:${target.source_entry_count}`;
      const r = await oculpmApi.deleteLegacyChangelog(projectId, token);
      setReport(r);
    } catch (e) {
      setError(
        e instanceof OculpmApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ── Esc to close (disabled mid-submit). ──────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose(report);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submitting, onClose, report]);

  return (
    <div
      className="fixed inset-0 z-[97] bg-background/70 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose(report);
      }}
    >
      <div className="bg-card border border-destructive/40 rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-150">
        <header className="px-5 py-3 border-b border-destructive/30 flex items-center justify-between shrink-0 bg-destructive/5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-destructive" />
            <h2 className="text-sm font-bold text-destructive">
              구 changelog 데이터 삭제
            </h2>
          </div>
          <button
            onClick={() => !submitting && onClose(report)}
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:opacity-50"
            aria-label="닫기 (Esc)"
            disabled={submitting}
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="p-5 space-y-4">
          {report ? (
            <SuccessPanel
              projectId={projectId}
              report={report}
              onClose={() => onClose(report)}
            />
          ) : (
            <ConfirmPanel
              history={history}
              target={target}
              error={error}
              slugInput={slugInput}
              setSlugInput={setSlugInput}
              submitting={submitting}
              canSubmit={canSubmit}
              onSubmit={handleDelete}
              onCancel={() => onClose(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Confirm panel ───────────────────────────────────────────────────────────

function ConfirmPanel({
  history,
  target,
  error,
  slugInput,
  setSlugInput,
  submitting,
  canSubmit,
  onSubmit,
  onCancel,
}: {
  history: MigrationHistoryEntry[] | null;
  target: MigrationHistoryEntry | null;
  error: string | null;
  slugInput: string;
  setSlugInput: (s: string) => void;
  submitting: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  if (!history) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> 마이그레이션 이력 확인 중…
      </div>
    );
  }
  if (!target) {
    return (
      <>
        <p className="text-sm">
          삭제 가능한 마이그레이션 이력이 없습니다. 먼저{" "}
          <strong>구 changelog 마이그레이션</strong>을 1회 이상 성공시켜야
          합니다.
        </p>
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onCancel}>
            닫기
          </Button>
        </div>
      </>
    );
  }
  return (
    <>
      <p className="text-sm">
        이 동작은 SQLite 의 <code>changelog_entries</code> +{" "}
        <code>changelog_files</code> 의 모든 행을 삭제합니다. 마이그레이션
        이력에 자동 백업이 기록되지만,{" "}
        <strong>ChangelogScreen 의 기존 데이터는 더 이상 보이지 않습니다.</strong>
      </p>

      <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-1">
        <div className="font-semibold text-foreground">대상 마이그레이션</div>
        <Row label="기록 시각" value={fmtUnix(target.report_timestamp)} mono />
        <Row label="대상 entries" value={`${target.source_entry_count}`} />
        <Row label="성공 / 스킵 / 실패" value={`${target.success_count} / ${target.skip_count} / ${target.failure_count}`} />
        <Row label="백업 폴더" value={target.backup_dir} mono />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium">
          확인하려면 아래 슬러그를{" "}
          <code className="px-1 py-0.5 rounded bg-muted">{REQUIRED_SLUG}</code>
          {" "}로 정확히 입력하세요:
        </label>
        <Input
          autoFocus
          value={slugInput}
          onChange={(e) => setSlugInput(e.target.value)}
          placeholder={REQUIRED_SLUG}
          className="font-mono text-xs"
          disabled={submitting}
        />
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive break-all">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onCancel} disabled={submitting}>
          취소
        </Button>
        <Button
          variant="destructive"
          onClick={onSubmit}
          disabled={!canSubmit}
        >
          {submitting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              삭제 중…
            </>
          ) : (
            <>
              <Trash2 className="w-3.5 h-3.5" />
              영구 삭제
            </>
          )}
        </Button>
      </div>
    </>
  );
}

// ─── Success panel ───────────────────────────────────────────────────────────

function SuccessPanel({
  projectId,
  report,
  onClose,
}: {
  projectId: number;
  report: LegacyDeletionReport;
  onClose: () => void;
}) {
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const openBackup = async () => {
    setOpening(true);
    setOpenError(null);
    try {
      const r = await commands.oculpmOpenBackupDir(
        projectId,
        report.safety_backup_dir,
      );
      if (r.status === "error") setOpenError(r.error);
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(false);
    }
  };
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0">
          <Check className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <div className="text-base font-semibold">구 changelog 삭제 완료</div>
          <div className="text-sm text-muted-foreground">
            entries {report.deleted_entries}건 · files {report.deleted_files}건
            제거되었습니다.
          </div>
        </div>
      </div>
      <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-1">
        <Row label="삭제 시각" value={fmtUnix(report.deleted_at)} mono />
        <Row
          label="안전 백업"
          value={report.safety_backup_dir}
          mono
        />
      </div>
      {openError && (
        <div className="text-xs text-destructive break-all">
          백업 폴더 열기 실패: {openError}
        </div>
      )}
      <div className="flex flex-wrap gap-2 justify-end">
        <Button variant="outline" onClick={openBackup} disabled={opening}>
          <FolderOpen className="w-3.5 h-3.5" />
          백업 폴더 열기
        </Button>
        <Button onClick={onClose}>닫기</Button>
      </div>
    </div>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-[11px] break-all text-right" : "tabular-nums"}>
        {value}
      </span>
    </div>
  );
}

function fmtUnix(unix: number): string {
  if (!Number.isFinite(unix) || unix <= 0) return "—";
  return new Date(unix * 1000).toLocaleString();
}
