/**
 * JournalEntryDetail — right-side pane of TimelineView once a card is
 * selected. Replaces the PR6 DetailPaneStub.
 *
 * Three sections:
 *   1. DetailHeader   — frontmatter badges (type/status/difficulty/agent/
 *                       language/session) + title + relative_path mono.
 *   2. DetailBody     — reuses `src/components/Markdown.tsx` for the
 *                       `body_markdown`. No prop extension (per PR7 §3).
 *   3. DetailActions  — verify toggle, open original (tauri-plugin-opener),
 *                       copy markdown, compare-with-index (W4 stub).
 *
 * Data flow:
 *   - Summary comes from the parent (TimelineView's optimistic state) so the
 *     verify badge and title stay in sync with the card without a refetch.
 *   - Full entry (body + frontmatter) is fetched via `oculpmApi.getJournalEntry`
 *     on selection change. The summary's `updated_at` is included in the
 *     effect deps so cache invalidations propagate without a second listener.
 *   - Verify toggle delegates to the parent so optimistic UI lives in one
 *     place (TimelineView.handleToggleVerified). Detail just calls back.
 *
 * Frontmatter parse failure: `getJournalEntry` returns `null` for rows the
 * cache stores with `parse_ok=0` (PR3 fallback). We surface a destructive
 * card + the "open original" action so the user can fix the YAML by hand.
 * Full `raw_yaml` exposure waits on a backend prop extension (see §3).
 *
 * See `docs/major_update/oculpm/W3/PR7-entry-detail.md`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";

import { Markdown } from "@/components/Markdown";
import {
  AlertTriangle,
  Check,
  Clipboard,
  ClipboardCheck,
  ExternalLink,
  FileCode,
  FileDiff,
  Loader2,
  MessageCircle,
} from "@/components/Icons";
import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import { DiffVsNarrative } from "./DiffVsNarrative";
import type {
  Difficulty,
  EntryStatus,
  EntryType,
  JournalEntry,
  JournalEntrySummary,
} from "@/lib/bindings";

interface JournalEntryDetailProps {
  projectId: number;
  projectRoot: string | null;
  /** Summary from TimelineView's optimistic list. `null` → empty placeholder. */
  summary: JournalEntrySummary | null;
  /** Delegate to TimelineView so optimistic state stays in one place. */
  onToggleVerified: (relativePath: string) => void;
  /** Optional — when wired, the header's difficulty/status badges become
   *  Select dropdowns that call this with the updated entry. TimelineView
   *  swaps the row in its `entries` state so the list card re-renders. */
  onMetaUpdated?: (entry: JournalEntry) => void;
}

const DIFFICULTY_OPTIONS: Difficulty[] = [
  "verylow",
  "low",
  "medium",
  "high",
  "superhigh",
];
const STATUS_OPTIONS: EntryStatus[] = [
  "planned",
  "in_progress",
  "done",
  "abandoned",
];

export function JournalEntryDetail({
  projectId,
  projectRoot,
  summary,
  onToggleVerified,
  onMetaUpdated,
}: JournalEntryDetailProps) {
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const copyTimer = useRef<number | null>(null);

  const path = summary?.relative_path ?? null;
  // `updated_at` is the cheapest cache-invalidation signal: PR2 bumps it on
  // every upsert, so this effect re-runs whenever the watcher detects a write.
  const updatedAt = summary?.updated_at ?? null;

  useEffect(() => {
    if (!path) {
      setEntry(null);
      setFetchError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFetchError(null);
    oculpmApi
      .getJournalEntry(projectId, path)
      .then((e) => {
        if (cancelled) return;
        setEntry(e);
        if (e == null) {
          setFetchError(
            "이 entry 의 frontmatter 를 파싱할 수 없습니다. 원본 파일을 수정하세요.",
          );
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setEntry(null);
        setFetchError(
          err instanceof OculpmApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "entry 를 불러오는 데 실패했습니다.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, path, updatedAt]);

  // ── actions ────────────────────────────────────────────────────────────

  const absolutePath = useMemo(() => {
    if (!projectRoot || !path) return null;
    const trimmedRoot = projectRoot.replace(/[\\/]+$/, "");
    return `${trimmedRoot}/.oculpm/journal/${path}`;
  }, [projectRoot, path]);

  const handleOpenOriginal = useCallback(async () => {
    if (!absolutePath) {
      setActionError("프로젝트 루트를 알 수 없어 파일을 열 수 없습니다.");
      return;
    }
    try {
      setActionError(null);
      await openPath(absolutePath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        await navigator.clipboard.writeText(absolutePath);
        setActionError(
          `에디터를 열 수 없습니다. 경로를 클립보드에 복사했습니다. (${msg})`,
        );
      } catch {
        setActionError(`에디터를 열 수 없습니다: ${msg}`);
      }
    }
  }, [absolutePath]);

  const handleCopyMarkdown = useCallback(async () => {
    if (!entry) return;
    const fm = entry.frontmatter;
    const text = serializeEntryAsMarkdown(fm, entry.body_markdown);
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopyState("idle"), 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(`클립보드 복사 실패: ${msg}`);
    }
  }, [entry]);

  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const handleVerifyToggle = useCallback(() => {
    if (!path) return;
    setActionError(null);
    onToggleVerified(path);
  }, [path, onToggleVerified]);

  // ── inline-edit handlers (W3 follow-up — difficulty / status) ─────────
  const handleDifficultyChange = useCallback(
    async (value: Difficulty | "_none") => {
      if (!path || !entry) return;
      const previous = entry;
      // Optimistic local update so the dropdown's "selected" state lands
      // immediately even before the round-trip completes.
      setEntry({
        ...entry,
        frontmatter: {
          ...entry.frontmatter,
          difficulty: value === "_none" ? null : value,
        },
      });
      setActionError(null);
      try {
        const hydrated = await oculpmApi.updateEntryMeta(projectId, path, {
          difficulty:
            value === "_none"
              ? { kind: "clear" }
              : { kind: "set", value },
        });
        setEntry(hydrated);
        onMetaUpdated?.(hydrated);
      } catch (e) {
        setEntry(previous);
        const msg =
          e instanceof OculpmApiError
            ? e.message
            : e instanceof Error
              ? e.message
              : String(e);
        setActionError(`difficulty 변경 실패: ${msg}`);
      }
    },
    [path, entry, projectId, onMetaUpdated],
  );

  const handleStatusChange = useCallback(
    async (value: EntryStatus) => {
      if (!path || !entry) return;
      const previous = entry;
      setEntry({
        ...entry,
        frontmatter: { ...entry.frontmatter, status: value },
      });
      setActionError(null);
      try {
        const hydrated = await oculpmApi.updateEntryMeta(projectId, path, {
          status: value,
        });
        setEntry(hydrated);
        onMetaUpdated?.(hydrated);
      } catch (e) {
        setEntry(previous);
        const msg =
          e instanceof OculpmApiError
            ? e.message
            : e instanceof Error
              ? e.message
              : String(e);
        setActionError(`status 변경 실패: ${msg}`);
      }
    },
    [path, entry, projectId, onMetaUpdated],
  );

  // ── render ────────────────────────────────────────────────────────────

  if (!summary) {
    return (
      <div className="sticky top-4 rounded-2xl border border-dashed border-border bg-card/30 p-6 text-center text-xs text-muted-foreground">
        <FileCode className="w-5 h-5 mx-auto mb-2 opacity-60" />
        entry 를 선택하면 디테일이 여기에 표시됩니다.
      </div>
    );
  }

  const verified = summary.verified_by_user;

  const canEditMeta = entry != null;

  return (
    <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-auto rounded-2xl border border-border bg-card">
      <DetailHeader
        summary={summary}
        entry={entry}
        canEdit={canEditMeta}
        onDifficultyChange={handleDifficultyChange}
        onStatusChange={handleStatusChange}
      />

      <div className="px-5 pb-3">
        {loading && entry == null && !fetchError && (
          <div className="text-xs text-muted-foreground flex items-center gap-2 py-4">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> 본문 불러오는 중…
          </div>
        )}

        {fetchError && (
          <div className="my-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive flex gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-medium">frontmatter 파싱 실패</div>
              <div className="text-destructive/80">{fetchError}</div>
              <div className="text-[10px] opacity-70 font-mono break-all">
                {summary.relative_path}
              </div>
            </div>
          </div>
        )}

        {entry && (
          <div className="pt-2">
            {entry.body_markdown.trim().length > 0 ? (
              <Markdown>{entry.body_markdown}</Markdown>
            ) : (
              <p className="text-xs italic text-muted-foreground py-3">
                본문 비어 있음. 프론트매터만 있는 entry 입니다.
              </p>
            )}
          </div>
        )}
      </div>

      <DetailActions
        verified={verified}
        canVerify={!!entry}
        copyState={copyState}
        canOpen={!!absolutePath}
        actionError={actionError}
        onVerifyToggle={handleVerifyToggle}
        onOpenOriginal={handleOpenOriginal}
        onCopyMarkdown={handleCopyMarkdown}
        projectId={projectId}
        sessionId={entry?.frontmatter.session_id ?? null}
      />
    </div>
  );
}

// ─── DetailHeader ─────────────────────────────────────────────────────────

function DetailHeader({
  summary,
  entry,
  canEdit,
  onDifficultyChange,
  onStatusChange,
}: {
  summary: JournalEntrySummary;
  entry: JournalEntry | null;
  canEdit: boolean;
  onDifficultyChange: (value: Difficulty | "_none") => void;
  onStatusChange: (value: EntryStatus) => void;
}) {
  // Prefer the live entry (fresh from disk) but fall back to the summary so
  // the header renders even while loading or after a parse failure.
  const type = entry?.frontmatter.type ?? summary.type;
  const status = entry?.frontmatter.status ?? summary.status;
  const difficulty = entry?.frontmatter.difficulty ?? summary.difficulty;
  const agentId = entry?.frontmatter.agent.id ?? summary.agent_id;
  const sessionId = entry?.frontmatter.session_id ?? summary.session_id;
  const language = entry?.frontmatter.language ?? null;
  const verified = summary.verified_by_user;
  const createdAt = entry?.frontmatter.created_at ?? summary.created_at;
  const tags = entry?.frontmatter.tags ?? summary.tags;
  const title = entry?.title || summary.title || summary.slug;

  return (
    <header className="px-5 pt-5 pb-3 border-b border-border space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <TypeBadge type={type} />
        <StatusSelect
          value={status}
          disabled={!canEdit}
          onChange={onStatusChange}
        />
        <DifficultySelect
          value={difficulty ?? null}
          disabled={!canEdit}
          onChange={onDifficultyChange}
        />
        <AgentBadge agentId={agentId} />
        {language && <LanguageBadge language={language} />}
        <VerifiedBadge verified={verified} />
      </div>

      <h2 className="text-base font-semibold leading-snug">
        {summary.checkbox != null && (
          <span className="mr-1.5 text-muted-foreground font-normal">
            {summary.checkbox ? "[x]" : "[ ]"}
          </span>
        )}
        {title}
      </h2>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <dt>session</dt>
        <dd className="font-mono text-foreground/80 truncate">{sessionId}</dd>
        <dt>created</dt>
        <dd className="font-mono tabular-nums text-foreground/80">
          {formatCreatedAt(createdAt)}
        </dd>
        <dt>path</dt>
        <dd className="font-mono text-foreground/70 break-all">
          {summary.relative_path}
        </dd>
      </dl>

      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-[10px]">
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}
    </header>
  );
}

// ─── DetailActions ────────────────────────────────────────────────────────

function DetailActions({
  verified,
  canVerify,
  copyState,
  canOpen,
  actionError,
  onVerifyToggle,
  onOpenOriginal,
  onCopyMarkdown,
  projectId,
  sessionId,
}: {
  verified: boolean;
  canVerify: boolean;
  copyState: "idle" | "copied";
  canOpen: boolean;
  actionError: string | null;
  onVerifyToggle: () => void;
  onOpenOriginal: () => void;
  onCopyMarkdown: () => void;
  projectId: number;
  sessionId: string | null;
}) {
  const [compareOpen, setCompareOpen] = useState(false);
  const canCompare = !!sessionId;
  return (
    <div className="px-5 pt-3 pb-5 border-t border-border space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onVerifyToggle}
          disabled={!canVerify}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            verified
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 border border-emerald-500/30"
              : "bg-primary/10 text-primary hover:bg-primary/20 border border-primary/30"
          }`}
          title={
            canVerify
              ? verified
                ? "이 entry 의 검증 마크를 해제합니다"
                : "이 entry 를 검증됨으로 표시합니다"
              : "frontmatter 가 깨져 있어 토글할 수 없습니다"
          }
        >
          <Check className="w-3.5 h-3.5" />
          {verified ? "검증됨 ✓ — 되돌리기" : "검증됨으로 표시"}
        </button>

        <button
          type="button"
          onClick={onOpenOriginal}
          disabled={!canOpen}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border border-border bg-background hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title={canOpen ? "OS 기본 에디터에서 .md 원본을 엽니다" : "프로젝트 루트가 없습니다"}
        >
          <ExternalLink className="w-3.5 h-3.5" />
          원본 열기
        </button>

        <button
          type="button"
          onClick={onCopyMarkdown}
          disabled={!canVerify}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border border-border bg-background hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="frontmatter + 본문 마크다운 전체를 클립보드에 복사"
        >
          {copyState === "copied" ? (
            <>
              <ClipboardCheck className="w-3.5 h-3.5 text-emerald-600" />
              복사됨
            </>
          ) : (
            <>
              <Clipboard className="w-3.5 h-3.5" />
              마크다운 복사
            </>
          )}
        </button>

        <button
          type="button"
          onClick={() => setCompareOpen(true)}
          disabled={!canCompare}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border border-border bg-background hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title={canCompare ? "이 entry 의 session ↔ index 비교" : "session_id 가 없어 비교할 수 없습니다"}
        >
          <FileDiff className="w-3.5 h-3.5" />
          ⚖ index 비교
        </button>
      </div>

      {actionError && (
        <div className="text-[11px] text-destructive flex gap-1.5 items-start">
          <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
          <span>{actionError}</span>
        </div>
      )}

      {compareOpen && sessionId && (
        <DiffVsNarrative
          projectId={projectId}
          sessionId={sessionId}
          onClose={() => setCompareOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Badges (header-only variants; card badges live in JournalEntryCard) ─

function TypeBadge({ type }: { type: EntryType }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 font-semibold uppercase tracking-wider text-[10px] ${TYPE_COLOR[type]}`}
    >
      {type}
    </span>
  );
}

function StatusSelect({
  value,
  disabled,
  onChange,
}: {
  value: EntryStatus;
  disabled: boolean;
  onChange: (next: EntryStatus) => void;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as EntryStatus)}
      title={
        disabled
          ? "frontmatter 가 깨져 있어 변경할 수 없습니다"
          : "status 변경 — 저장 시 .md 파일의 frontmatter 가 갱신됩니다"
      }
      className={`inline-flex items-center rounded px-1.5 py-0.5 font-medium text-[10px] border bg-transparent outline-none disabled:cursor-not-allowed disabled:opacity-50 ${STATUS_SELECT_TONE[value]}`}
    >
      {STATUS_OPTIONS.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}

function DifficultySelect({
  value,
  disabled,
  onChange,
}: {
  value: Difficulty | null;
  disabled: boolean;
  onChange: (next: Difficulty | "_none") => void;
}) {
  return (
    <select
      value={value ?? "_none"}
      disabled={disabled}
      onChange={(e) =>
        onChange(e.target.value as Difficulty | "_none")
      }
      title={
        disabled
          ? "frontmatter 가 깨져 있어 변경할 수 없습니다"
          : "difficulty 변경 — 저장 시 .md 파일의 frontmatter 가 갱신됩니다"
      }
      className="inline-flex items-center rounded px-1.5 py-0.5 font-medium text-[10px] border border-border bg-transparent text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-50"
    >
      <option value="_none">— 없음</option>
      {DIFFICULTY_OPTIONS.map((d) => (
        <option key={d} value={d}>
          {d}
        </option>
      ))}
    </select>
  );
}

const STATUS_SELECT_TONE: Record<EntryStatus, string> = {
  planned: "border-border text-muted-foreground",
  in_progress: "border-blue-500/40 text-blue-700 dark:text-blue-300",
  done: "border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
  abandoned: "border-border text-muted-foreground line-through",
};

function AgentBadge({ agentId }: { agentId: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 bg-muted text-muted-foreground font-mono text-[10px]"
      title={`agent: ${agentId}`}
    >
      <MessageCircle className="w-2.5 h-2.5" />
      {agentId}
    </span>
  );
}

function LanguageBadge({ language }: { language: string }) {
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 bg-muted/60 text-muted-foreground font-mono text-[10px] uppercase"
      title={`language: ${language}`}
    >
      {language}
    </span>
  );
}

function VerifiedBadge({ verified }: { verified: boolean }) {
  if (verified) {
    return (
      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-medium text-[10px]">
        <Check className="w-2.5 h-2.5" /> 검증됨
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 bg-amber-500/10 text-amber-700 dark:text-amber-300 font-medium text-[10px]">
      <AlertTriangle className="w-2.5 h-2.5" /> 미검증
    </span>
  );
}

// ─── tokens (mirrored from JournalEntryCard) ──────────────────────────────

const TYPE_COLOR: Record<EntryType, string> = {
  bug: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  feature: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300",
  error: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  refactor: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  chore: "bg-zinc-100 text-zinc-800 dark:bg-zinc-800/60 dark:text-zinc-300",
};

// ─── helpers ──────────────────────────────────────────────────────────────

function formatCreatedAt(rfc3339: string): string {
  // Cache `created_at` is stored as RFC3339 with the frontmatter's textual
  // offset. Avoid `new Date()` to keep the displayed offset (e.g. +09:00).
  const m = rfc3339.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})([+-]\d{2}:\d{2}|Z)?/);
  if (!m) return rfc3339;
  const [, date, hh, mm, ss, tz] = m;
  return `${date} ${hh}:${mm}:${ss}${tz ?? ""}`;
}

/**
 * Reconstructs a "good enough" `.md` representation for clipboard copy. The
 * cache does not retain the original raw bytes (PR2 only stores parsed
 * fields + body_markdown), so this is best-effort YAML serialization, not a
 * byte-for-byte clone. For a true raw copy the user can hit `원본 열기` and
 * copy from their editor.
 */
function serializeEntryAsMarkdown(
  fm: JournalEntry["frontmatter"],
  body: string,
): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push(`schema_version: ${fm.schema_version}`);
  lines.push(`type: ${fm.type}`);
  lines.push(`slug: ${fm.slug}`);
  lines.push(`status: ${fm.status}`);
  if (fm.difficulty != null) lines.push(`difficulty: ${fm.difficulty}`);
  lines.push(`created_at: ${fm.created_at}`);
  if (fm.updated_at) lines.push(`updated_at: ${fm.updated_at}`);
  lines.push(`session_id: ${fm.session_id}`);
  lines.push(
    `agent: { id: ${fm.agent.id}${fm.agent.version ? `, version: ${fm.agent.version}` : ""} }`,
  );
  lines.push(`language: ${fm.language}`);
  lines.push(`verified_by_user: ${fm.verified_by_user}`);
  if (fm.tags.length > 0) lines.push(`tags: [${fm.tags.join(", ")}]`);
  lines.push("---");
  lines.push("");
  lines.push(body);
  return lines.join("\n");
}
