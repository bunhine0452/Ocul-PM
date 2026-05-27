/**
 * JournalEntryDetail — right-side pane of TimelineView once a card is
 * selected.
 *
 * W4 dogfooding (2026-05-27) — full layout overhaul:
 *  - The card is a fixed-height flex column (`max-h-[calc(100vh-2rem)]`)
 *    with a sticky header on top, a scrollable middle region, and a sticky
 *    action bar at the bottom. Long bodies no longer push the grid row
 *    taller than the viewport and dwarf the timeline column.
 *  - Adds an inline body editor (was missing entirely — users could only
 *    open the file in an external editor, which itself was broken).
 *  - "원본 열기" now goes through `oculpmApi.openEntryInEditor` which shells
 *    out from the backend, bypassing the opener plugin's path-glob scope
 *    that has regressed three times during dogfooding.
 *  - "index 비교" is a tab in the middle region instead of a panel that
 *    stacks below the actions, so it never grows the card past viewport.
 */

import { useCallback, useEffect, useRef, useState } from "react";

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
  Pencil,
  Save,
  X,
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
  /** Optional — header difficulty/status selects forward updates here so
   *  TimelineView can splice the hydrated row into its `entries` state. */
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

type DetailTab = "body" | "compare";

export function JournalEntryDetail({
  projectId,
  projectRoot: _projectRoot,
  summary,
  onToggleVerified,
  onMetaUpdated,
}: JournalEntryDetailProps) {
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [tab, setTab] = useState<DetailTab>("body");
  const [editing, setEditing] = useState(false);
  const [draftBody, setDraftBody] = useState("");
  const [savingBody, setSavingBody] = useState(false);
  const copyTimer = useRef<number | null>(null);

  const path = summary?.relative_path ?? null;
  const updatedAt = summary?.updated_at ?? null;

  // Reset the active tab + editing mode when navigating to a different entry.
  useEffect(() => {
    setTab("body");
    setEditing(false);
    setActionError(null);
  }, [path]);

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

  const handleOpenOriginal = useCallback(async () => {
    if (!path) return;
    try {
      setActionError(null);
      await oculpmApi.openEntryInEditor(projectId, path);
    } catch (err) {
      const msg =
        err instanceof OculpmApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      setActionError(`에디터를 열 수 없습니다: ${msg}`);
    }
  }, [projectId, path]);

  const handleCopyMarkdown = useCallback(async () => {
    if (!entry) return;
    const text = serializeEntryAsMarkdown(entry.frontmatter, entry.body_markdown);
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

  const handleStartEdit = useCallback(() => {
    if (!entry) return;
    setDraftBody(entry.body_markdown);
    setEditing(true);
    setTab("body");
    setActionError(null);
  }, [entry]);

  const handleCancelEdit = useCallback(() => {
    setEditing(false);
    setDraftBody("");
  }, []);

  const handleSaveBody = useCallback(async () => {
    if (!path || !entry) return;
    setSavingBody(true);
    setActionError(null);
    try {
      const hydrated = await oculpmApi.updateEntryBody(
        projectId,
        path,
        draftBody,
      );
      setEntry(hydrated);
      onMetaUpdated?.(hydrated);
      setEditing(false);
      setDraftBody("");
    } catch (err) {
      const msg =
        err instanceof OculpmApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      setActionError(`본문 저장 실패: ${msg}`);
    } finally {
      setSavingBody(false);
    }
  }, [projectId, path, entry, draftBody, onMetaUpdated]);

  // ── inline-edit handlers (difficulty / status) ────────────────────────
  const handleDifficultyChange = useCallback(
    async (value: Difficulty | "_none") => {
      if (!path || !entry) return;
      const previous = entry;
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
  const sessionId = entry?.frontmatter.session_id ?? summary.session_id;

  return (
    <div className="sticky top-4 flex flex-col max-h-[calc(100vh-2rem)] rounded-2xl border border-border bg-card overflow-hidden">
      <DetailHeader
        summary={summary}
        entry={entry}
        canEdit={canEditMeta}
        onDifficultyChange={handleDifficultyChange}
        onStatusChange={handleStatusChange}
      />

      <DetailTabs
        tab={tab}
        onChange={setTab}
        canCompare={!!sessionId}
        compactPathLabel={summary.relative_path}
      />

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {tab === "body" ? (
          <BodyRegion
            loading={loading}
            entry={entry}
            fetchError={fetchError}
            relativePath={summary.relative_path}
            editing={editing}
            draftBody={draftBody}
            saving={savingBody}
            onDraftChange={setDraftBody}
            onSave={handleSaveBody}
            onCancel={handleCancelEdit}
          />
        ) : (
          <CompareRegion projectId={projectId} sessionId={sessionId} />
        )}
      </div>

      <DetailActions
        verified={verified}
        canVerify={!!entry}
        editing={editing}
        canEditBody={!!entry}
        copyState={copyState}
        actionError={actionError}
        onVerifyToggle={handleVerifyToggle}
        onOpenOriginal={handleOpenOriginal}
        onCopyMarkdown={handleCopyMarkdown}
        onStartEdit={handleStartEdit}
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
    <header className="shrink-0 px-4 pt-4 pb-3 border-b border-border space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <TypeBadge type={type} />
        <StatusSelect value={status} disabled={!canEdit} onChange={onStatusChange} />
        <DifficultySelect
          value={difficulty ?? null}
          disabled={!canEdit}
          onChange={onDifficultyChange}
        />
        {language && <LanguageBadge language={language} />}
        <VerifiedBadge verified={verified} />
      </div>

      <h2 className="text-[15px] font-semibold leading-snug">
        {summary.checkbox != null && (
          <span className="mr-1.5 text-muted-foreground font-normal">
            {summary.checkbox ? "[x]" : "[ ]"}
          </span>
        )}
        {title}
      </h2>

      <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <MessageCircle className="w-3 h-3" />
          <span className="font-mono">{agentId}</span>
        </span>
        <span className="font-mono tabular-nums">{formatCreatedAt(createdAt)}</span>
        <span className="font-mono opacity-70 truncate" title={sessionId}>
          {sessionId}
        </span>
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-[10px]">
          {tags.slice(0, 10).map((tag) => (
            <span
              key={tag}
              className="rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground"
            >
              #{tag}
            </span>
          ))}
          {tags.length > 10 && (
            <span className="text-muted-foreground tabular-nums">
              +{tags.length - 10}
            </span>
          )}
        </div>
      )}
    </header>
  );
}

// ─── DetailTabs ───────────────────────────────────────────────────────────

function DetailTabs({
  tab,
  onChange,
  canCompare,
  compactPathLabel,
}: {
  tab: DetailTab;
  onChange: (next: DetailTab) => void;
  canCompare: boolean;
  compactPathLabel: string;
}) {
  return (
    <div className="shrink-0 flex items-center border-b border-border bg-muted/30">
      <TabButton active={tab === "body"} onClick={() => onChange("body")}>
        본문
      </TabButton>
      <TabButton
        active={tab === "compare"}
        onClick={() => onChange("compare")}
        disabled={!canCompare}
        title={canCompare ? "index ↔ journal 비교" : "session_id 없음"}
      >
        <FileDiff className="w-3 h-3 mr-1" />
        index 비교
      </TabButton>
      <span
        className="ml-auto pr-3 text-[10px] text-muted-foreground font-mono truncate max-w-[55%]"
        title={compactPathLabel}
      >
        {compactPathLabel}
      </span>
    </div>
  );
}

function TabButton({
  active,
  disabled,
  onClick,
  title,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center px-3 py-2 text-xs font-medium border-b-2 transition-colors disabled:cursor-not-allowed disabled:opacity-40
        ${active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
        }`}
    >
      {children}
    </button>
  );
}

// ─── BodyRegion (view + edit) ─────────────────────────────────────────────

function BodyRegion({
  loading,
  entry,
  fetchError,
  relativePath,
  editing,
  draftBody,
  saving,
  onDraftChange,
  onSave,
  onCancel,
}: {
  loading: boolean;
  entry: JournalEntry | null;
  fetchError: string | null;
  relativePath: string;
  editing: boolean;
  draftBody: string;
  saving: boolean;
  onDraftChange: (next: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  if (loading && !entry && !fetchError) {
    return (
      <div className="text-xs text-muted-foreground flex items-center gap-2 px-4 py-6">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> 본문 불러오는 중…
      </div>
    );
  }
  if (fetchError) {
    return (
      <div className="m-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive flex gap-2">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <div className="space-y-1 min-w-0">
          <div className="font-medium">frontmatter 파싱 실패</div>
          <div className="text-destructive/80">{fetchError}</div>
          <div className="text-[10px] opacity-70 font-mono break-all">
            {relativePath}
          </div>
        </div>
      </div>
    );
  }
  if (!entry) return null;

  if (editing) {
    return (
      <div className="flex flex-col h-full">
        <textarea
          value={draftBody}
          onChange={(e) => onDraftChange(e.target.value)}
          disabled={saving}
          spellCheck={false}
          className="flex-1 min-h-[40vh] w-full resize-none border-0 bg-background px-4 py-3 text-sm font-mono leading-relaxed outline-none focus:ring-0"
          placeholder="본문 markdown…"
        />
        <div className="shrink-0 flex items-center justify-end gap-2 border-t border-border bg-muted/30 px-3 py-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs border border-border bg-background hover:bg-muted disabled:opacity-50"
          >
            <X className="w-3 h-3" /> 취소
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Save className="w-3 h-3" />
            )}
            저장
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-3">
      {entry.body_markdown.trim().length > 0 ? (
        <Markdown>{entry.body_markdown}</Markdown>
      ) : (
        <p className="text-xs italic text-muted-foreground py-3">
          본문 비어 있음. 프론트매터만 있는 entry 입니다.
        </p>
      )}
    </div>
  );
}

// ─── CompareRegion ────────────────────────────────────────────────────────

function CompareRegion({
  projectId,
  sessionId,
}: {
  projectId: number;
  sessionId: string;
}) {
  return (
    <div className="p-3">
      <DiffVsNarrative
        projectId={projectId}
        sessionId={sessionId}
        onClose={() => { /* tab switch handles close */ }}
        variant="compact"
      />
    </div>
  );
}

// ─── DetailActions ────────────────────────────────────────────────────────

function DetailActions({
  verified,
  canVerify,
  editing,
  canEditBody,
  copyState,
  actionError,
  onVerifyToggle,
  onOpenOriginal,
  onCopyMarkdown,
  onStartEdit,
}: {
  verified: boolean;
  canVerify: boolean;
  editing: boolean;
  canEditBody: boolean;
  copyState: "idle" | "copied";
  actionError: string | null;
  onVerifyToggle: () => void;
  onOpenOriginal: () => void;
  onCopyMarkdown: () => void;
  onStartEdit: () => void;
}) {
  if (editing) {
    // Save/Cancel live inside the editor; the action bar collapses to just
    // the error surface (if any) so it doesn't compete for clicks.
    return actionError ? (
      <div className="shrink-0 border-t border-border bg-card px-3 py-2 text-[11px] text-destructive flex gap-1.5 items-start">
        <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
        <span>{actionError}</span>
      </div>
    ) : null;
  }
  return (
    <div className="shrink-0 border-t border-border bg-card">
      <div className="flex items-center gap-1 px-2 py-2 overflow-x-auto scrollbar-thin">
        <ActionButton
          onClick={onVerifyToggle}
          disabled={!canVerify}
          tone={verified ? "success" : "primary"}
          title={
            canVerify
              ? verified
                ? "검증 표시를 해제합니다"
                : "이 entry 를 검증됨으로 표시합니다"
              : "frontmatter 가 깨져 있어 토글할 수 없습니다"
          }
          icon={<Check className="w-3 h-3" />}
        >
          {verified ? "검증됨" : "검증"}
        </ActionButton>
        <ActionButton
          onClick={onStartEdit}
          disabled={!canEditBody}
          tone="neutral"
          title="본문 편집"
          icon={<Pencil className="w-3 h-3" />}
        >
          편집
        </ActionButton>
        <ActionButton
          onClick={onOpenOriginal}
          tone="neutral"
          title="OS 기본 에디터에서 .md 원본을 엽니다"
          icon={<ExternalLink className="w-3 h-3" />}
        >
          원본
        </ActionButton>
        <ActionButton
          onClick={onCopyMarkdown}
          disabled={!canVerify}
          tone="neutral"
          title="frontmatter + 본문 마크다운 전체를 클립보드에 복사"
          icon={
            copyState === "copied" ? (
              <ClipboardCheck className="w-3 h-3 text-emerald-600" />
            ) : (
              <Clipboard className="w-3 h-3" />
            )
          }
        >
          {copyState === "copied" ? "복사됨" : "복사"}
        </ActionButton>
      </div>
      {actionError && (
        <div className="border-t border-border px-3 py-1.5 text-[11px] text-destructive flex gap-1.5 items-start">
          <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
          <span>{actionError}</span>
        </div>
      )}
    </div>
  );
}

function ActionButton({
  children,
  icon,
  onClick,
  disabled,
  tone,
  title,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone: "primary" | "success" | "neutral";
  title?: string;
}) {
  const toneClass =
    tone === "success"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 border-emerald-500/30"
      : tone === "primary"
        ? "bg-primary/10 text-primary hover:bg-primary/20 border-primary/30"
        : "bg-background text-foreground hover:bg-muted border-border";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`shrink-0 inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${toneClass}`}
    >
      {icon}
      {children}
    </button>
  );
}

// ─── Badges ──────────────────────────────────────────────────────────────

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
      onChange={(e) => onChange(e.target.value as Difficulty | "_none")}
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

const TYPE_COLOR: Record<EntryType, string> = {
  bug: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  feature: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300",
  error: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  refactor: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  chore: "bg-zinc-100 text-zinc-800 dark:bg-zinc-800/60 dark:text-zinc-300",
};

// ─── helpers ──────────────────────────────────────────────────────────────

function formatCreatedAt(rfc3339: string): string {
  const m = rfc3339.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})([+-]\d{2}:\d{2}|Z)?/);
  if (!m) return rfc3339;
  const [, date, hh, mm] = m;
  return `${date} ${hh}:${mm}`;
}

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

