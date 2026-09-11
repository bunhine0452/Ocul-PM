import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { Toolbar } from "@/components/Toolbar";
import { AlertTriangle, ArrowLeft, Check, ExternalLink, GitCompareArrows, ShieldCheck } from "@/components/Icons";
import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import { toast } from "@/lib/toast";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { PatchView } from "@/features/diff/PatchView";
import { langFromPath } from "@/features/diff/diffParse";
import { Markdown } from "@/components/Markdown";
import { useJournalEvents } from "./useOculpmLive";
import { TRIGGER_META } from "./triggerMeta";
import { EntryMasthead } from "./EntryMasthead";
import { EntryFileList, type FileRow } from "./EntryFileList";
import { EntryFileBar } from "./EntryFileBar";
import { mapFileOpToChangeOp } from "@/contexts/WorkspaceContext";
import { commonRoot } from "@/lib/filePath";
import type { EntryFileDiff, JournalEntry, JournalEntrySummary } from "@/lib/bindings";
import { useT } from "@/i18n";
import { requestAgentContext } from "@/lib/agentContextNav";
import { firstSlug, ruleGlobsFromPaths } from "@/lib/promoteSeed";
import "./entry.css";

// 작업 일지 항목의 열람 — 원장의 한 장 (2026-09-11 리디자인; 처음은 Dogfooding
// 2026-06-07 의 모달 대체). 왼쪽은 **읽는 칸**: 마스트헤드(EntryMasthead) ·
// 서술(body_markdown) · 부록(EntryFileList, 변경된 파일). 오른쪽은 그 시점에
// 기록된 unified-diff(PatchView) 와 파일 바(EntryFileBar). 둘 사이 경계는
// 끌어서 옮기고 워크스페이스에 남는다(entryReadWidth). 서술의 첫 줄(제목)은
// 마스트헤드와 중복되므로 제거한다.

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

/** 읽는 칸 폭의 허용 범위 — 아래로는 한국어 한 줄 30자, 위로는 산문 폭. */
export const READ_MIN_W = 380;
export const READ_MAX_W = 860;
export const READ_DEFAULT_W = 520;
/** diff 칸은 이보다 좁아지지 않는다 — 끌어서 없앨 수 있는 칸이 아니다. */
const DIFF_MIN_W = 320;

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
  const { state, setState } = useWorkspace();
  const diffMode = state.diffMode;
  const [detail, setDetail] = useState<JournalEntry | null>(null);
  const [diffs, setDiffs] = useState<EntryFileDiff[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const filterRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLElement | null>(null);
  const readRef = useRef<HTMLDivElement | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);

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

  // {#entry-open-affordance} — 일지 .md 를 OS 기본 편집기로. `openEntryInEditor`
  // 는 opener-scope 회귀를 세 번 겪고 백엔드가 절대경로를 직접 셸아웃해 여는
  // 전용 경로로 만든 것이라, 여기서도 **반드시 이 래퍼**를 쓴다 — plugin-opener
  // 직접 호출이나 일반 파일용 커맨드로 우회하면 그 회귀가 네 번째로 재발한다.
  const [opening, setOpening] = useState(false);
  const openInEditor = useCallback(async () => {
    if (opening) return;
    setOpening(true);
    try {
      await oculpmApi.openEntryInEditor(projectId, entry.relative_path);
    } catch (e) {
      toast.destructive(
        t("entry.openInEditorFailed", {
          error: e instanceof OculpmApiError ? e.message : String(e),
        }),
      );
    } finally {
      setOpening(false);
    }
  }, [opening, projectId, entry.relative_path, t]);

  const related = detail?.frontmatter.related ?? [];

  /**
   * 디스크가 SSOT다 — 이 화면을 열어 둔 채 에이전트가 같은 일지를 고치거나
   * (본문 보강·상태 변경) 인덱서가 diff 사이드카를 뒤늦게 기록하면 여기도
   * 따라와야 한다. 예전엔 `relative_path` 가 바뀔 때만 다시 읽어서, 열어 둔
   * 일지는 **연 순간에 멈춰** 있었다.
   */
  const [reloadTick, setReloadTick] = useState(0);
  const reload = useCallback(() => setReloadTick((n) => n + 1), []);
  useJournalEvents(projectId, true, reload);

  // 화면 지역 상태(선택·필터)는 **다른 일지로 옮길 때만** 비운다. 라이브
  // 갱신에서까지 비우면 읽던 파일 선택이 풀려 갱신이 방해가 된다.
  useEffect(() => {
    setDetail(null);
    setDiffs(null);
    setError(null);
    setSelected(null);
    setFilter("");
    readRef.current?.scrollTo?.({ top: 0 });
  }, [entry.relative_path]);

  useEffect(() => {
    let cancelled = false;
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
  }, [projectId, entry.relative_path, reloadTick]);

  useEffect(() => {
    let cancelled = false;
    oculpmApi
      .getEntryDiffs(projectId, entry.relative_path)
      .then((d) => {
        if (cancelled) return;
        setDiffs(d);
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof OculpmApiError ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, entry.relative_path, reloadTick]);

  const files = useMemo(() => detail?.frontmatter.files_touched ?? [], [detail]);
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
  const orderedPaths = useMemo(() => rows.filter((r) => r.hasDiff).map((r) => r.path), [rows]);

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

  // 부록의 활성 행을 따라가되, **부록이 보일 때만**. 목록이 화면 밖(본문을 읽는
  // 중)이면 j/k 가 독자를 아래로 끌고 내려가면 안 된다 — 파일 바가 위치를 이미
  // 말한다.
  useEffect(() => {
    const list = listRef.current;
    const view = readRef.current;
    if (!list || !view) return;
    const a = list.getBoundingClientRect();
    const b = view.getBoundingClientRect();
    if (a.bottom < b.top || a.top > b.bottom) return;
    list.querySelector(".dfile.active")?.scrollIntoView?.({ block: "nearest" });
  }, [active?.path]);

  const jumpToFiles = useCallback(() => {
    listRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, []);

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

  const parseFailed = entry.parse_ok === false;
  const hasNotice = parseFailed || warnings.length > 0;
  // A "backfilled to" note means there's a concrete tz offset we can write to
  // the source file. (DST-gap "could not backfill" notes are not writable.)
  const canCoerceTz = !parseFailed && warnings.some((w) => w.includes("backfilled to"));

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
  }, [coercing, projectId, entry.relative_path, t]);

  // AD-4 — 실패를 본 직후가 규칙이 태어나는 자연 시점이다. 여기서 누르면
  // 스킬·규칙 화면의 "새 규칙" 이 **이 일지에서 뽑은 씨앗**으로 열린다:
  // 바뀐 파일의 디렉터리가 `paths`, 일지 제목·경로가 본문의 근거. 파일은
  // 그 모달에서 사용자가 만들기를 눌러야 쓰인다.
  const promotable = entry.type === "bug" || entry.type === "error";
  const promoteToRule = useCallback(() => {
    requestAgentContext({
      kind: "createRule",
      seed: {
        name: firstSlug(entry.slug, entry.title),
        paths: ruleGlobsFromPaths(rows.map((r) => r.path)),
        body: t("ctx.promote.seedFrom", {
          source: `${entry.title || entry.slug} (\`${entry.relative_path}\`)`,
        }),
      },
    });
  }, [entry.slug, entry.title, entry.relative_path, rows, t]);

  // ── 읽는 칸 폭 — 끌어서 옮기고 워크스페이스에 남긴다 (플래너 레일과 같은
  // 손잡이). 드래그 중에는 지역 상태로만 그려 창 전체 리렌더를 피한다.
  const persistedW = state.entryReadWidth;
  const [liveW, setLiveW] = useState<number | null>(null);
  const readW = liveW ?? persistedW;
  const drag = useRef<{ startX: number; startW: number } | null>(null);
  const clampW = useCallback((w: number) => {
    const total = detailRef.current?.clientWidth ?? 0;
    const max = total > 0 ? Math.min(READ_MAX_W, total - DIFF_MIN_W) : READ_MAX_W;
    return Math.min(Math.max(READ_MIN_W, max), Math.max(READ_MIN_W, Math.round(w)));
  }, []);
  const commitW = useCallback(
    (w: number) => {
      setLiveW(null);
      setState((prev) => (prev.entryReadWidth === w ? prev : { ...prev, entryReadWidth: w }));
    },
    [setState],
  );

  const kind = TRIGGER_META[entry.type] ?? TRIGGER_META.chore;

  return (
    <>
      <Toolbar
        leading={
          <button type="button" className="iconbtn" onClick={onBack} aria-label={t("entry.back")} title={t("entry.backTitle")}>
            {/* 뒤로가기 화살표는 15 다 — 앱의 일곱 자리 중 여섯이 그렇고,
                이 하나만 18 이었다 (2026-09-10 {#unify-drilldown}). */}
            <ArrowLeft size={15} />
          </button>
        }
        title={entry.title || entry.slug}
        sub={
          hasNotice ? (
            <span
              className="entry-warn"
              title={warnings.length > 0 ? warnings.join("\n") : t("entry.parseWarn")}
            >
              <AlertTriangle size={13} /> {parseFailed ? t("entry.parseWarnShort") : t("entry.coerced")}
              {warnings.length > 0 ? ` ${warnings.length}` : ""}
            </span>
          ) : undefined
        }
      >
        {promotable ? (
          <button type="button" className="btn sm" onClick={promoteToRule} title={t("ctx.promote.ruleTitle")}>
            <ShieldCheck size={13} /> {t("ctx.promote.rule")}
          </button>
        ) : null}
        <button
          type="button"
          className="btn sm"
          onClick={() => void openInEditor()}
          disabled={opening}
          title={t("entry.openInEditorTitle")}
        >
          <ExternalLink size={13} /> {t("entry.openInEditor")}
        </button>
        <button
          type="button"
          className="btn sm"
          onClick={() => void toggleVerified()}
          disabled={verifying}
          aria-pressed={verified}
          title={verified ? t("entry.unverifyTitle") : t("entry.verifyTitle")}
          style={verified ? { color: "var(--ok)", borderColor: "var(--ok)" } : undefined}
        >
          <Check size={13} /> {verified ? t("entry.verified") : t("entry.verify")}
        </button>
      </Toolbar>

      <div
        ref={detailRef}
        className="entry-detail"
        style={{ "--entry-read-w": `${readW}px`, "--c": `var(--t-${kind.cssVar})` } as CSSProperties}
      >
        {/* Left: the reading column — masthead · narrative · files appendix. */}
        <div className="entry-read" ref={readRef}>
          <div className="entry-read-inner">
            <EntryMasthead
              entry={entry}
              related={related}
              filesCount={rows.length}
              onJumpToFiles={jumpToFiles}
              onOpenRelated={onOpenRelated}
              warnings={warnings}
              parseFailed={parseFailed}
              canCoerceTz={canCoerceTz}
              confirmCoerce={confirmCoerce}
              onConfirmCoerce={setConfirmCoerce}
              coercing={coercing}
              onApplyTz={() => void applyTzToDisk()}
            />

            <div className="entry-narrative">
              {detail == null ? (
                <span className="text-muted-foreground" style={{ fontSize: "var(--fs-3)" }}>
                  {t("common.loading")}
                </span>
              ) : narrative.trim() ? (
                <Markdown>{narrative}</Markdown>
              ) : (
                <span className="text-muted-foreground" style={{ fontSize: "var(--fs-3)" }}>
                  {t("entry.noNarrative")}
                </span>
              )}
            </div>

            {rows.length > 0 ? (
              <EntryFileList
                ref={listRef}
                rows={rows}
                shown={shown}
                root={root}
                filter={filter}
                onFilter={setFilter}
                filterRef={filterRef}
                activePath={active?.path ?? null}
                onSelect={setSelected}
              />
            ) : null}
          </div>
        </div>

        <div
          className="entry-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label={t("entry.readResize")}
          aria-valuenow={readW}
          aria-valuemin={READ_MIN_W}
          aria-valuemax={READ_MAX_W}
          tabIndex={0}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { startX: e.clientX, startW: readW };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (d) setLiveW(clampW(d.startW + (e.clientX - d.startX)));
          }}
          onPointerUp={(e) => {
            const d = drag.current;
            if (!d) return;
            drag.current = null;
            commitW(clampW(d.startW + (e.clientX - d.startX)));
          }}
          // 더블클릭으로 기본 폭 — 끌다가 망친 폭을 되돌릴 길이 있어야 한다.
          onDoubleClick={() => commitW(READ_DEFAULT_W)}
          onKeyDown={(e) => {
            // 키보드로도 조절된다 — 드래그만 있으면 separator 는 장식이다.
            const step = e.key === "ArrowLeft" ? -16 : e.key === "ArrowRight" ? 16 : 0;
            if (step === 0) return;
            e.preventDefault();
            commitW(clampW(readW + step));
          }}
        />

        {/* Right: recorded diff. The file bar says which file is open, steps
            between them, and drops the whole list as a menu. */}
        <section className="entry-detail-main">
          {active ? (
            <EntryFileBar
              rows={rows}
              orderedPaths={orderedPaths}
              activePath={active.path}
              activeIdx={activeIdx}
              onSelect={setSelected}
            />
          ) : null}
          <div className="diff-code">
            {error ? (
              <EmptyState align="start" density="compact">
                {t("entry.diffLoadFailed", { error })}
              </EmptyState>
            ) : diffs == null ? (
              <LoadingState align="start" density="compact" />
            ) : diffs.length === 0 ? (
              <EmptyState align="start" density="compact">
                {t("entry.noDiff")}
                <br />
                <span className="text-muted-foreground" style={{ fontSize: "var(--fs-2)" }}>
                  {t("entry.noDiffHint")}
                </span>
                <div style={{ marginTop: 12 }}>
                  <button className="btn sm" onClick={() => onOpenDiff(entry)}>
                    <GitCompareArrows size={15} /> {t("entry.openInDiff")}
                  </button>
                </div>
              </EmptyState>
            ) : active ? (
              <PatchView patch={active.patch} mode={diffMode} lang={langFromPath(active.path)} />
            ) : null}
          </div>
        </section>
      </div>
    </>
  );
}
