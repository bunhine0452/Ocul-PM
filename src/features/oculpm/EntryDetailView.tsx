import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toolbar } from "@/components/Toolbar";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  GitCompareArrows,
  Link2,
  Search,
  X,
} from "@/components/Icons";
import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import { toast } from "@/lib/toast";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { PatchView } from "@/features/diff/PatchView";
import { langFromPath } from "@/features/diff/diffParse";
import { Markdown } from "@/components/Markdown";
import { TriggerBadge } from "./triggerMeta";
import { agentLabelWithModel } from "@/features/today/agentColor";
import { mapFileOpToChangeOp } from "@/contexts/WorkspaceContext";
import { commonRoot, splitPath } from "@/lib/filePath";
import type { EntryFileDiff, JournalEntry, JournalEntrySummary } from "@/lib/bindings";
import { useT, getLang, type I18nKey } from "@/i18n";

// 작업 일지 항목의 풍부한 열람 — 전용 화면(마스터-디테일). Dogfooding 2026-06-07:
// 모달(오버레이) 대신 콘텐츠 영역을 가득 채우는 디테일 뷰로 교체. 좌 pane 은
// 메타 + 변경 파일 목록(op 배지·경로 구분) + 일지 서술(body_markdown), 우 pane 은
// 그 시점에 기록된 unified-diff(PatchView). 서술의 첫 줄(제목)은 헤더와 중복되므로
// 제거한다.

interface EntryDetailViewProps {
  projectId: number;
  entry: JournalEntrySummary;
  onBack: () => void;
  /** Jump to the LIVE 변경 diff 화면 for this entry. */
  onOpenDiff: (entry: JournalEntrySummary) => void;
  /**
   * Open another entry by its `.oculpm/journal/`-relative path — the target of a
   * frontmatter `related` link. Undefined → links render but don't navigate.
   */
  onOpenRelated?: (relativePath: string) => void;
}

/** i18n keys for the four spec'd `related.kind` values — unknown kinds render as-is. */
const RELATED_KIND_KEY: Record<string, I18nKey> = {
  blocks: "entry.relatedKind.blocks",
  blocked_by: "entry.relatedKind.blocked_by",
  followup: "entry.relatedKind.followup",
  duplicate: "entry.relatedKind.duplicate",
};

/** HH:MM from an ISO 8601 created_at string. */
function timeLabel(createdAt: string): string {
  const m = /T(\d{2}:\d{2})/.exec(createdAt);
  return m ? m[1] : "";
}

/** 요일 라벨 — 로케일 인식 (하드코딩 배열 대신 Intl, useTodayBrief 와 같은 방식). */
const weekdays = () => {
  const f = new Intl.DateTimeFormat(getLang(), { weekday: "short" });
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(1970, 0, 4 + i))));
};

/**
 * The entry's written date, e.g. "2026.06.15 (월)". Prefers the ISO `created_at`
 * (exact calendar day) and falls back to the YYYYMMDD `workday`. Returns "" when
 * neither parses.
 */
function dateLabel(createdAt: string, workday: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(createdAt);
  let y: string, mo: string, d: string;
  if (iso) {
    [, y, mo, d] = iso;
  } else {
    const wd = /^(\d{4})(\d{2})(\d{2})$/.exec(workday);
    if (!wd) return "";
    [, y, mo, d] = wd;
  }
  const dt = new Date(Number(y), Number(mo) - 1, Number(d));
  return `${y}.${mo}.${d} (${weekdays()[dt.getDay()] ?? ""})`;
}

/** A row of the changed-file list: the entry's `files_touched` ∪ recorded diffs. */
interface FileRow {
  path: string;
  op: ReturnType<typeof mapFileOpToChangeOp>;
  /** Whether a patch was recorded for this path (⇒ the row is selectable). */
  hasDiff: boolean;
  /** Short muted reason shown when there's no patch to open. */
  note: string | null;
}

/** Show the filter box / cap the list height only once the list is actually long. */
const FILTER_FROM = 8;
const SCROLL_FROM = 12;

/**
 * The journal body's first non-blank line is the entry title (with a `[ ]`/`[x]`
 * or `#` marker). The header already shows the title, so drop that line from the
 * narrative to avoid the duplicate. Only strips when it actually matches.
 */
function stripLeadingTitle(body: string, title: string): string {
  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i >= lines.length) return body;
  const first = lines[i]
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[-*]\s*/, "")
    .replace(/^\[[ xX]\]\s*/, "")
    .trim();
  if (first !== title.trim()) return body;
  const rest = lines.slice(i + 1);
  while (rest.length && rest[0].trim() === "") rest.shift();
  return rest.join("\n");
}

export function EntryDetailView({ projectId, entry, onBack, onOpenDiff, onOpenRelated }: EntryDetailViewProps) {
  const { t } = useT();
  const { state } = useWorkspace();
  const diffMode = state.diffMode;
  const [detail, setDetail] = useState<JournalEntry | null>(null);
  const [diffs, setDiffs] = useState<EntryFileDiff[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const filterRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // 검토 루프의 마지막 고리 — `verified_by_user` 는 AGENTS.md 가 에이전트에게
  // false 로 쓰라고 강제하는 필드인데, 사람이 true 로 바꾸는 자리가 앱 어디에도
  // 없었다(2026-08-30 감사: 백엔드·필터 칩만 있고 토글 0). 여기서 닫는다.
  const [verified, setVerified] = useState(entry.verified_by_user);
  const [verifying, setVerifying] = useState(false);
  useEffect(() => {
    setVerified(entry.verified_by_user);
  }, [entry.relative_path, entry.verified_by_user]);
  const toggleVerified = useCallback(async () => {
    if (verifying) return;
    setVerifying(true);
    try {
      await oculpmApi.setJournalVerified(projectId, entry.relative_path, !verified);
      setVerified(!verified);
    } catch (e) {
      toast.destructive(
        t("entry.verifyFailed", { error: e instanceof OculpmApiError ? e.message : String(e) }),
      );
    } finally {
      setVerifying(false);
    }
  }, [verifying, verified, projectId, entry.relative_path, t]);
  const related = detail?.frontmatter.related ?? [];

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    oculpmApi
      .getJournalEntry(projectId, entry.relative_path)
      .then((d) => {
        if (!cancelled && d) setDetail(d);
      })
      .catch(() => {
        /* narrative is best-effort */
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, entry.relative_path]);

  useEffect(() => {
    let cancelled = false;
    setDiffs(null);
    setError(null);
    setSelected(null);
    setFilter("");
    oculpmApi
      .getEntryDiffs(projectId, entry.relative_path)
      .then((d) => {
        if (!cancelled) setDiffs(d);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof OculpmApiError ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, entry.relative_path]);

  const files = detail?.frontmatter.files_touched ?? [];
  const recorded = useMemo(() => new Set((diffs ?? []).map((d) => d.path)), [diffs]);

  // One list, path-sorted, covering both sides: the entry's declared
  // `files_touched` plus any recorded patch whose path the frontmatter didn't
  // list (otherwise that patch would have no way to be opened at all).
  const rows = useMemo<FileRow[]>(() => {
    const seen = new Set<string>();
    const out: FileRow[] = [];
    for (const f of files) {
      seen.add(f.path);
      const hasDiff = recorded.has(f.path);
      out.push({
        path: f.path,
        op: mapFileOpToChangeOp(f.op),
        hasDiff,
        note: hasDiff ? null : f.op === "delete" ? t("entry.deleted") : t("entry.noRecord"),
      });
    }
    for (const d of diffs ?? []) {
      if (seen.has(d.path)) continue;
      out.push({ path: d.path, op: "M", hasDiff: true, note: null });
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }, [files, diffs, recorded, t]);

  const root = useMemo(() => commonRoot(rows.map((r) => r.path)), [rows]);
  const orderedPaths = useMemo(
    () => rows.filter((r) => r.hasDiff).map((r) => r.path),
    [rows],
  );

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? rows.filter((r) => r.path.toLowerCase().includes(q)) : rows;
  }, [rows, filter]);

  const active = useMemo(() => {
    if (!diffs || diffs.length === 0) return null;
    return (
      diffs.find((d) => d.path === selected) ??
      diffs.find((d) => d.path === orderedPaths[0]) ??
      diffs[0]
    );
  }, [diffs, selected, orderedPaths]);
  const activeIdx = active ? orderedPaths.indexOf(active.path) : -1;

  // Esc → back to the list. j/k step through the recorded files and `/` jumps
  // to the filter — same keys as the 변경 diff screen, so the two file lists
  // are driven identically.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const typing =
        !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "Escape") {
        if (!typing) onBack();
        return;
      }
      if (typing) return;
      if (e.key === "j" || e.key === "k") {
        if (orderedPaths.length === 0) return;
        e.preventDefault();
        const cur = Math.max(0, activeIdx);
        const next =
          e.key === "j" ? Math.min(cur + 1, orderedPaths.length - 1) : Math.max(cur - 1, 0);
        setSelected(orderedPaths[next]);
      } else if (e.key === "/" && filterRef.current) {
        e.preventDefault();
        filterRef.current.focus();
        filterRef.current.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack, orderedPaths, activeIdx]);

  // Keyboard stepping must not leave the active row outside the (now scrollable)
  // list viewport.
  useEffect(() => {
    listRef.current?.querySelector(".dfile.active")?.scrollIntoView?.({ block: "nearest" });
  }, [active?.path]);

  const narrative = useMemo(
    () => (detail ? stripLeadingTitle(detail.body_markdown, entry.title || entry.slug) : ""),
    [detail, entry.title, entry.slug],
  );

  // F7a — reliability badge. Defensive against optimistic-UI summaries / older
  // fixtures that predate the parse_ok / parse_warnings fields.
  // `parseFailed` = the frontmatter didn't parse (synthesized chore row).
  // Advisory warnings (F7a-B tz/slug coercion) keep parse_ok=true but still
  // carry notes — surfaced as a softer "보정됨" badge, not "malformed".
  // Warnings live in local state so the F7a-B Unit B "원본에 시간대 적용" action
  // can clear the tz note in place after rewriting the on-disk frontmatter
  // (the `entry` summary prop is owned by the parent and won't refresh until
  // the timeline refetches).
  const [warnings, setWarnings] = useState<string[]>(entry.parse_warnings ?? []);
  const [confirmCoerce, setConfirmCoerce] = useState(false);
  const [coercing, setCoercing] = useState(false);
  useEffect(() => {
    setWarnings(entry.parse_warnings ?? []);
    setConfirmCoerce(false);
  }, [entry.relative_path, entry.parse_warnings]);

  const parseWarnings = warnings;
  const parseFailed = entry.parse_ok === false;
  const hasNotice = parseFailed || parseWarnings.length > 0;
  // A "backfilled to" note means there's a concrete tz offset we can write to
  // the source file. (DST-gap "could not backfill" notes are not writable.)
  const canCoerceTz =
    !parseFailed && parseWarnings.some((w) => w.includes("backfilled to"));

  const applyTzToDisk = useCallback(async () => {
    if (coercing) return;
    setCoercing(true);
    try {
      const updated = await oculpmApi.coerceEntryOnDisk(projectId, entry.relative_path);
      setWarnings(updated.parse_warnings ?? []);
      setDetail(updated);
      setConfirmCoerce(false);
      toast.info(t("entry.tzApplied"));
    } catch (e) {
      toast.destructive(e instanceof OculpmApiError ? e.message : String(e));
    } finally {
      setCoercing(false);
    }
  }, [coercing, projectId, entry.relative_path]);

  return (
    <>
      <Toolbar
        leading={
          <button type="button" className="iconbtn" onClick={onBack} aria-label={t("entry.back")} title={t("entry.backTitle")}>
            <ArrowLeft size={17} />
          </button>
        }
        title={entry.title || entry.slug}
        sub={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <TriggerBadge type={entry.type} />
            {dateLabel(entry.created_at, entry.workday) ? (
              <span className="entry-date-chip">
                <Calendar size={12} /> {dateLabel(entry.created_at, entry.workday)}
                {timeLabel(entry.created_at) ? (
                  <span style={{ color: "var(--text-3)", fontWeight: 500 }}>
                    {timeLabel(entry.created_at)}
                  </span>
                ) : null}
              </span>
            ) : null}
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Bot size={12} /> {agentLabelWithModel(entry.agent_id, entry.agent_version)}
            </span>
            {hasNotice ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  color: "var(--warn, #c2810a)",
                  fontWeight: 600,
                }}
                title={
                  parseWarnings.length > 0
                    ? parseWarnings.join("\n")
                    : t("entry.parseWarn")
                }
              >
                <AlertTriangle size={12} /> {parseFailed ? t("entry.parseWarnShort") : t("entry.coerced")}
                {parseWarnings.length > 0 ? ` ${parseWarnings.length}` : ""}
              </span>
            ) : null}
          </span>
        }
      >
        <button
          type="button"
          className="btn sm"
          onClick={() => void toggleVerified()}
          disabled={verifying}
          aria-pressed={verified}
          title={verified ? t("entry.unverifyTitle") : t("entry.verifyTitle")}
          style={
            verified
              ? { color: "var(--ok, #12a06b)", borderColor: "var(--ok, #12a06b)" }
              : undefined
          }
        >
          <Check size={13} /> {verified ? t("entry.verified") : t("entry.verify")}
        </button>
      </Toolbar>

      <div className="entry-detail">
        {/* Left: meta + changed-file list + narrative */}
        <aside className="entry-detail-side">
          {parseWarnings.length > 0 ? (
            <div
              className="entry-detail-notice"
              style={{
                marginBottom: 14,
                padding: "8px 10px",
                borderRadius: 8,
                background: "var(--warn-bg, rgba(194,129,10,0.08))",
                border: "1px solid var(--warn-border, rgba(194,129,10,0.25))",
              }}
            >
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--warn, #c2810a)",
                  marginBottom: 4,
                }}
              >
                <AlertTriangle size={12} />{" "}
                {parseFailed ? t("entry.parseWarn") : t("entry.coercionTitle")}
              </div>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "var(--text-2)" }}>
                {parseWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
              {canCoerceTz ? (
                <div style={{ marginTop: 8 }}>
                  {confirmCoerce ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                      <span style={{ color: "var(--text-2)" }}>
                        {t("entry.editsOriginal")}
                      </span>
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => void applyTzToDisk()}
                        disabled={coercing}
                      >
                        {coercing ? t("entry.applying") : t("entry.apply")}
                      </button>
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => setConfirmCoerce(false)}
                        disabled={coercing}
                      >
                        {t("common.cancel")}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => setConfirmCoerce(true)}
                      title={t("entry.applyTzTitle")}
                    >
                      {t("entry.applyTz")}
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          {related.length > 0 ? (
            <div className="entry-detail-related" style={{ marginBottom: 14 }}>
              <div className="entry-filelist-title" style={{ marginBottom: 6 }}>
                {t("entry.related")}
              </div>
              <div className="flex flex-wrap gap-1">
                {related.map((r) => {
                  const kindKey = RELATED_KIND_KEY[r.kind];
                  const base = r.ref.split("/").pop() ?? r.ref;
                  return (
                    <button
                      key={`${r.kind}:${r.ref}`}
                      type="button"
                      className="tag"
                      title={r.ref}
                      onClick={() => onOpenRelated?.(r.ref)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        cursor: onOpenRelated ? "pointer" : "default",
                      }}
                    >
                      <Link2 size={11} /> {kindKey ? t(kindKey) : r.kind} · {base}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {entry.tags.length > 0 ? (
            <div className="entry-detail-tags flex flex-wrap gap-1" style={{ marginBottom: 14 }}>
              {entry.tags.map((t) => (
                <span className="tag" key={t}>
                  {t}
                </span>
              ))}
            </div>
          ) : null}

          {rows.length > 0 ? (
            <section className="entry-filelist-block">
              <div className="diff-files-head entry-filelist-head">
                <span className="entry-filelist-title">
                  {t("entry.filesChanged", { n: rows.length })}
                </span>
                {rows.length >= FILTER_FROM ? (
                  <span className="entry-filelist-filter">
                    <Search size={12} />
                    <input
                      ref={filterRef}
                      type="text"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== "Escape") return;
                        e.stopPropagation();
                        if (filter) setFilter("");
                        else e.currentTarget.blur();
                      }}
                      placeholder={t("entry.filterFiles")}
                      aria-label={t("entry.filterFiles")}
                      spellCheck={false}
                    />
                    {filter ? (
                      <button
                        type="button"
                        className="entry-filelist-clear"
                        onClick={() => setFilter("")}
                        aria-label={t("entry.filterClear")}
                      >
                        <X size={11} />
                      </button>
                    ) : null}
                  </span>
                ) : null}
              </div>
              <div
                ref={listRef}
                className={"entry-filelist" + (rows.length > SCROLL_FROM ? " capped" : "")}
              >
                {shown.map((r) => {
                  const { dir, base } = splitPath(r.path, root);
                  return (
                    <button
                      key={r.path}
                      type="button"
                      onClick={() => r.hasDiff && setSelected(r.path)}
                      disabled={!r.hasDiff}
                      title={r.path}
                      aria-current={active?.path === r.path ? "true" : undefined}
                      className={
                        "dfile" +
                        (active?.path === r.path ? " active" : "") +
                        (r.hasDiff ? "" : " muted")
                      }
                    >
                      <span className={"dstatus " + r.op}>{r.op}</span>
                      <span className="dfile-name">
                        {dir ? <span className="dfile-dir">{dir}</span> : null}
                        <span className="dfile-base">{base}</span>
                      </span>
                      {r.note ? <span className="dfile-note">{r.note}</span> : null}
                    </button>
                  );
                })}
                {shown.length === 0 ? (
                  <div className="entry-filelist-empty">{t("entry.noFileMatch")}</div>
                ) : null}
              </div>
            </section>
          ) : null}

          <div className="entry-narrative">
            {detail == null ? (
              <span className="text-muted-foreground" style={{ fontSize: 12 }}>
                {t("common.loading")}
              </span>
            ) : narrative.trim() ? (
              <Markdown>{narrative}</Markdown>
            ) : (
              <span className="text-muted-foreground" style={{ fontSize: 12 }}>
                {t("entry.noNarrative")}
              </span>
            )}
          </div>
        </aside>

        {/* Right: recorded diff. The file list lives entirely in the left pane —
            this bar only says which file is open and steps between them. */}
        <section className="entry-detail-main">
          {active ? (
            <div className="entry-file-bar">
              {orderedPaths.length > 1 ? (
                <div className="efb-steps">
                  <button
                    type="button"
                    className="efb-step"
                    onClick={() => setSelected(orderedPaths[activeIdx - 1])}
                    disabled={activeIdx <= 0}
                    aria-label={t("entry.prevFile")}
                    title={`${t("entry.prevFile")} (k)`}
                  >
                    <ChevronLeft size={15} />
                  </button>
                  <button
                    type="button"
                    className="efb-step"
                    onClick={() => setSelected(orderedPaths[activeIdx + 1])}
                    disabled={activeIdx < 0 || activeIdx >= orderedPaths.length - 1}
                    aria-label={t("entry.nextFile")}
                    title={`${t("entry.nextFile")} (j)`}
                  >
                    <ChevronRight size={15} />
                  </button>
                </div>
              ) : null}
              <div className="efb-path" title={active.path}>
                {(() => {
                  const { dir, base } = splitPath(active.path, "", Infinity);
                  return (
                    <>
                      {dir ? <span className="efb-dir">{dir}</span> : null}
                      <span className="efb-base">{base}</span>
                    </>
                  );
                })()}
              </div>
              {orderedPaths.length > 1 ? (
                <span className="efb-count">
                  {Math.max(activeIdx, 0) + 1}
                  <span className="efb-count-sep">/</span>
                  {orderedPaths.length}
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="diff-code">
            {error ? (
              <div className="empty-hint" style={{ textAlign: "left", padding: 16 }}>
                {t("entry.diffLoadFailed", { error })}
              </div>
            ) : diffs == null ? (
              <div className="empty-hint" style={{ textAlign: "left", padding: 16 }}>
                {t("common.loading")}
              </div>
            ) : diffs.length === 0 ? (
              <div className="empty-hint" style={{ textAlign: "left", padding: 16 }}>
                {t("entry.noDiff")}
                <br />
                <span className="text-muted-foreground" style={{ fontSize: 11 }}>
                  {t("entry.noDiffHint")}
                </span>
                <div style={{ marginTop: 12 }}>
                  <button className="btn sm" onClick={() => onOpenDiff(entry)}>
                    <GitCompareArrows size={14} /> {t("entry.openInDiff")}
                  </button>
                </div>
              </div>
            ) : active ? (
              <PatchView patch={active.patch} mode={diffMode} lang={langFromPath(active.path)} />
            ) : null}
          </div>
        </section>
      </div>
    </>
  );
}
