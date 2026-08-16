import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toolbar } from "@/components/Toolbar";
import {
  FileCode2,
  ExternalLinkIcon,
  GitBranchIcon,
  CheckMark,
  Loader,
  TriangleAlert,
  TargetIcon,
} from "@/components/Icons";
import { commands, type DiffResult, type ChangeGroup, type ChangePlanRef, type ImpactReport } from "@/lib/bindings";
import { useWorkspace, type DiffMode } from "@/contexts/WorkspaceContext";
import {
  recentChangesStore,
  useRecentChanges,
  type ChangeOp,
  type RecentChange,
} from "@/lib/recentChangesStore";
import { useSettings } from "@/contexts/SettingsContext";
import { toast } from "@/lib/toast";
import { PatchView } from "./PatchView";
import { BinaryFileView } from "./BinaryFileView";
import { langFromPath } from "./diffParse";
import { useT } from "@/i18n";
import { tError } from "@/i18n/errors";

// Final UI Update (ui_v2) — 변경 diff 전용 화면 (02-screen-specs §3). Wraps the
// EXISTING diff pipeline: file list = git uncommitted changes (persistent,
// commands.gitUncommittedChanges) merged with WorkspaceContext.recentChanges
// (the live Watcher buffer) — Bug 1 fix so the list survives app restarts /
// project switches instead of depending on the session-only watcher. body =
// commands.computeDiff, rendering = PatchView (which owns the markup over
// diffParse's pure classifyDiffLines/groupIntoHunks/pairDiffLines, so the
// Lite-W6 PR6.x safety-net tests keep covering the parsers). The mockup
// .diff-screen 2-pane shell replaces the side-panel layout. flag-off
// LocalDiffView untouched.

const DIFF_MAX_BYTES = 64 * 1024;

// Which baseline the screen diffs against. "working" = uncommitted (git status +
// live watcher); "last_commit" = the most recent commit (HEAD~1..HEAD), shown
// when the working tree is clean so the screen isn't empty after an agent commits.
type DiffBaseline = "working" | "last_commit";

interface LastCommit {
  sha: string;
  short_sha: string;
  subject: string;
  changes: { path: string; op: string }[];
}

function badgeLetter(op: ChangeOp): "A" | "M" | "D" {
  return op;
}

/** Merge the persistent git-uncommitted list (survives app restarts / project
 *  switches) with the live file-watcher buffer. Deduped by path; the watcher
 *  entry wins since it carries the freshest op + a real timestamp. git entries
 *  (ts=0) sort first so they read as the pre-existing baseline while live edits
 *  surface as newest. */
function mergeChanges(git: RecentChange[], watcher: RecentChange[]): RecentChange[] {
  const byPath = new Map<string, RecentChange>();
  for (const c of git) byPath.set(c.path, c);
  for (const c of watcher) byPath.set(c.path, c);
  return [...byPath.values()].sort((a, b) => a.ts - b.ts || a.path.localeCompare(b.path));
}

/** Month/day for a change-group header (entries may span days). */
function groupDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}

/** Collapse plan refs to one chip per plan. The backend returns one
 *  ChangePlanRef per advanced *item*, so an entry that moved many items of the
 *  same plan would otherwise render the (identical) plan title once per item —
 *  e.g. 11 look-alike rows. We keep insertion order and stash the item titles
 *  for the chip's tooltip + a `·N` count. */
export function collapsePlanRefs(
  refs: ChangePlanRef[],
): { planId: string; title: string; items: string[] }[] {
  const byPlan = new Map<string, { planId: string; title: string; items: string[] }>();
  for (const pr of refs) {
    const e = byPlan.get(pr.plan_id);
    if (e) e.items.push(pr.item_title);
    else byPlan.set(pr.plan_id, { planId: pr.plan_id, title: pr.plan_title, items: [pr.item_title] });
  }
  return [...byPlan.values()];
}

interface DiffScreenV2Props {
  projectId: number;
  /** Absolute project root — required by commands.openInEditor. */
  projectRoot: string | null;
  branch: string | null;
  /** Jump to a journal entry (path relative to the journal root). Dogfooding #3. */
  onOpenEntry?: (relativePath: string) => void;
}

export function DiffScreenV2({ projectId, projectRoot, branch, onOpenEntry }: DiffScreenV2Props) {
  const { t } = useT();
  const { state, setState } = useWorkspace();
  const { diffActivePath, diffReadPaths, diffMode } = state;
  // v2 U3 — watcher 버퍼는 전용 스토어 구독. 이 화면만 파일 이벤트에 리렌더한다.
  const recentChanges = useRecentChanges();
  const { settings } = useSettings();

  // Bug 1 fix — persistent change source. The live `recentChanges` watcher
  // buffer is wiped on project switch and never populated while the app was
  // closed, so it loses any change not observed live in the current session.
  // `git status` gives us the full uncommitted set regardless of uptime /
  // active project; we seed the file list from it and merge live edits on top.
  const [gitChanges, setGitChanges] = useState<RecentChange[]>([]);
  const watcherPathKey = recentChanges.map((c) => c.path).join("\n");
  useEffect(() => {
    let cancelled = false;
    commands
      .gitUncommittedChanges(projectId)
      .then((res) => {
        if (cancelled) return;
        setGitChanges(
          res.status === "ok"
            ? res.data.map((c) => ({ path: c.path, op: c.op as ChangeOp, ts: 0, read: true }))
            : [],
        );
      })
      .catch(() => {
        if (!cancelled) setGitChanges([]);
      });
    return () => {
      cancelled = true;
    };
    // Re-seed on project switch and whenever the watcher reports a new edit (a
    // commit / stage / new file changes `git status`); non-git projects yield
    // an empty list and the watcher buffer carries the screen on its own.
  }, [projectId, watcherPathKey]);

  // The 변경 diff screen is uncommitted-only by nature: once work is committed
  // `git status` goes clean and the screen would read "변경 없음" even though the
  // change is real (the journal still shows it via its sidecar). So we also fetch
  // the most recent commit and fall back to it when the working tree is clean.
  const [lastCommit, setLastCommit] = useState<LastCommit | null>(null);
  useEffect(() => {
    let cancelled = false;
    commands
      .gitLastCommitChanges(projectId)
      .then((res) => {
        if (!cancelled) setLastCommit(res.status === "ok" ? res.data : null);
      })
      .catch(() => {
        if (!cancelled) setLastCommit(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, watcherPathKey]);

  // Working-tree changes: persistent git baseline + live edits.
  const workingChanges = useMemo(
    () => mergeChanges(gitChanges, recentChanges),
    [gitChanges, recentChanges],
  );
  const lastCommitChanges = useMemo<RecentChange[]>(
    () =>
      (lastCommit?.changes ?? []).map((c) => ({
        path: c.path,
        op: c.op as ChangeOp,
        ts: 0,
        read: true,
      })),
    [lastCommit],
  );

  // Auto-pick the baseline: working tree when it has changes (or there's no
  // commit to fall back to), else the last commit. The user can pin a choice.
  const [baselinePinned, setBaselinePinned] = useState<DiffBaseline | null>(null);
  const autoBaseline: DiffBaseline =
    workingChanges.length > 0 || lastCommitChanges.length === 0 ? "working" : "last_commit";
  const baseline = baselinePinned ?? autoBaseline;
  const changes = baseline === "last_commit" ? lastCommitChanges : workingChanges;

  // Selected file. Seed from diffActivePath (the journal-card → diff handoff
  // parked by PR-UI 3), else the most recent change.
  const [selected, setSelected] = useState<string | null>(diffActivePath);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  // For a file with no git/snapshot baseline (untracked/new), the whole file
  // content rendered as an all-additions patch — so changes show immediately
  // instead of the "no baseline" prompt.
  const [newFilePatch, setNewFilePatch] = useState<string | null>(null);
  // readProjectFile 실패 사유 — 이게 없으면 읽기 실패 시 "파일을 읽는 중…" 에
  // 영원히 갇힌다 (예: 권한 문제. 바이너리는 이제 백엔드가 미리 걸러준다).
  const [newFileError, setNewFileError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const consumedHandoff = useRef(false);
  // Latest merged change list for use inside the fetch effect (which only
  // depends on projectId/selected) — lets us know a file's op (e.g. "D" =
  // deleted) without re-running the fetch on every watcher push.
  const changesRef = useRef(changes);
  changesRef.current = changes;

  // Dogfooding #3 — group the changed files by the journal entry (and linked
  // plan items) that recorded them. `null` until loaded / on error → the file
  // list falls back to the flat view.
  const [groups, setGroups] = useState<ChangeGroup[] | null>(null);
  const pathKey = changes.map((c) => c.path).join("\n");
  useEffect(() => {
    if (changesRef.current.length === 0) {
      setGroups(null);
      return;
    }
    let cancelled = false;
    const paths = changesRef.current.map((c) => c.path);
    commands
      .oculpmGroupChanges(projectId, paths)
      .then((res) => {
        if (!cancelled) setGroups(res.status === "ok" ? res.data : null);
      })
      .catch(() => {
        if (!cancelled) setGroups(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, pathKey]);

  // Consume the one-shot diffActivePath handoff once, then clear it so a
  // later manual pick doesn't snap back. Mirrors LocalDiffView's diffTarget.
  useEffect(() => {
    if (consumedHandoff.current) return;
    consumedHandoff.current = true;
    if (diffActivePath) {
      setSelected(diffActivePath);
      setState((prev) => ({ ...prev, diffActivePath: null }));
    }
  }, [diffActivePath, setState]);

  // Default selection → most recent change; keep the pick if still present.
  useEffect(() => {
    if (changes.length === 0) {
      setSelected(null);
      return;
    }
    setSelected((prev) => {
      if (prev && changes.some((c) => c.path === prev)) return prev;
      return changes[changes.length - 1].path;
    });
  }, [changes]);

  // Fetch diff for the selected file (cancel-safe).
  useEffect(() => {
    if (!selected) {
      setDiff(null);
      setNewFilePatch(null);
      setNewFileError(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNewFilePatch(null);
    setNewFileError(null);
    commands
      .computeDiff(projectId, selected, DIFF_MAX_BYTES, baseline === "last_commit" ? "last_commit" : null)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status !== "ok") {
          setDiff(null);
          setError(tError(res.error));
          return;
        }
        setDiff(res.data);
        // No git/snapshot baseline (untracked or never-indexed file). Read the
        // file and show its whole content as additions, so the change is
        // visible right away instead of the "no baseline" prompt. A *deleted*
        // file has no disk content to read (and no baseline) — skip the read so
        // we don't trip "Failed to read … No such file"; DiffBody renders a
        // deleted-file notice instead.
        if (res.data.source.source === "snapshots_unavailable") {
          const op = changesRef.current.find((c) => c.path === selected)?.op;
          if (op === "D") {
            setNewFilePatch(null);
          } else {
            const fileRes = await commands.readProjectFile(projectId, selected);
            if (cancelled) return;
            if (fileRes.status === "ok") {
              setNewFilePatch(
                fileRes.data.split("\n").map((l) => "+" + l).join("\n"),
              );
            } else {
              // 읽기 실패를 상태로 남겨 "읽는 중…" 무한 대기 대신 안내를 띄운다.
              setNewFileError(tError(fileRes.error));
            }
          }
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setDiff(null);
          setError(String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, selected, baseline]);

  // Mark the change read once its body renders (mirrors LocalDiffView).
  useEffect(() => {
    if (!selected || loading || error || !diff) return;
    recentChangesStore.markRead(selected);
  }, [selected, diff, loading, error]);

  const setMode = (mode: DiffMode) =>
    setState((prev) => ({ ...prev, diffMode: mode }));

  // "검토 완료" — push the current file into diffReadPaths (deduped).
  const onMarkReviewed = useCallback(() => {
    if (!selected) return;
    setState((prev) =>
      prev.diffReadPaths.includes(selected)
        ? prev
        : { ...prev, diffReadPaths: [...prev.diffReadPaths, selected] },
    );
  }, [selected, setState]);

  // "모두 검토 완료" — mark every changed file reviewed at once (dogfooding #4).
  const onMarkAllReviewed = useCallback(() => {
    setState((prev) => {
      const merged = new Set(prev.diffReadPaths);
      for (const c of changes) merged.add(c.path);
      return merged.size === prev.diffReadPaths.length
        ? prev
        : { ...prev, diffReadPaths: [...merged] };
    });
  }, [setState, changes]);

  const onOpenEditor = useCallback(async () => {
    if (!selected || !projectRoot) return;
    const res = await commands.openInEditor(
      projectRoot,
      selected,
      settings.externalEditorCommand,
      null,
    );
    if (res.status === "error") toast.destructive(t("diff.editorFailed", { error: res.error }));
  }, [projectRoot, selected, settings.externalEditorCommand]);

  // GR4 — change impact: files that (transitively) import a changed file, found
  // by reverse-dependency BFS. Flags review-worthy files the diff doesn't show.
  const [impact, setImpact] = useState<ImpactReport | null>(null);
  const [impactOpen, setImpactOpen] = useState(true);
  useEffect(() => {
    if (changesRef.current.length === 0) {
      setImpact(null);
      return;
    }
    let cancelled = false;
    const paths = changesRef.current.map((c) => c.path);
    commands
      .getChangeImpact(projectId, paths)
      .then((res) => {
        if (!cancelled) setImpact(res.status === "ok" ? res.data : null);
      })
      .catch(() => {
        if (!cancelled) setImpact(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, pathKey]);

  const onOpenAffected = useCallback(
    async (path: string) => {
      if (!projectRoot) return;
      const res = await commands.openInEditor(projectRoot, path, settings.externalEditorCommand, null);
      if (res.status === "error") toast.destructive(t("diff.editorFailed", { error: res.error }));
    },
    [projectRoot, settings.externalEditorCommand],
  );

  // ── v2 U8 (docs/20260706_v2/01-ux-spec.md §3) — 키보드 diff 검토 ──────────
  // j/k = 파일 이동(선택 즉시 diff 로드), `/` = in-diff 검색, n/N = 매치 이동.
  // 입력 필드 포커스 중엔 무시. 리스트 표시 순서(그룹/평면)를 그대로 따른다.
  const orderedPaths = useMemo(
    () =>
      groups
        ? groups.flatMap((g) => g.files)
        : changes
            .slice()
            .reverse()
            .map((c) => c.path),
    [groups, changes],
  );

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const diffCodeRef = useRef<HTMLDivElement | null>(null);
  const [diffQuery, setDiffQuery] = useState("");
  const [matchPos, setMatchPos] = useState<{ idx: number; total: number } | null>(null);
  const matchIdxRef = useRef(-1);

  // 프로젝트 전환 시 화면-로컬 상태 리셋. 사이드바 인라인 전환은 이 컴포넌트를
  // 리마운트하지 않으므로, 이전 프로젝트의 baseline pin·검색어·직전 커밋
  // 정보가 새 프로젝트 위에 그대로 남는 누수를 막는다.
  useEffect(() => {
    setBaselinePinned(null);
    setDiffQuery("");
    setGitChanges([]);
    setLastCommit(null);
  }, [projectId]);

  // 매치는 렌더된 diff 라인(.dl)의 textContent 로 그때그때 수집한다 — PatchView
  // 내부(하이라이트된 HTML)를 건드리지 않는 최소 침습 접점.
  const jumpMatch = useCallback(
    (dir: 1 | -1) => {
      const root = diffCodeRef.current;
      const q = diffQuery.trim().toLowerCase();
      if (!root || !q) return;
      root.querySelectorAll(".dl-hit").forEach((el) => el.classList.remove("dl-hit"));
      const matches = Array.from(root.querySelectorAll<HTMLElement>(".dl")).filter((el) =>
        (el.textContent ?? "").toLowerCase().includes(q),
      );
      if (matches.length === 0) {
        matchIdxRef.current = -1;
        setMatchPos({ idx: 0, total: 0 });
        return;
      }
      const next = (((matchIdxRef.current + dir) % matches.length) + matches.length) % matches.length;
      matchIdxRef.current = next;
      const el = matches[next];
      el.classList.add("dl-hit");
      el.scrollIntoView?.({ block: "center" });
      setMatchPos({ idx: next + 1, total: matches.length });
    },
    [diffQuery],
  );

  // 쿼리/파일/모드가 바뀌면 매치 커서 리셋.
  useEffect(() => {
    matchIdxRef.current = -1;
    setMatchPos(null);
    diffCodeRef.current
      ?.querySelectorAll(".dl-hit")
      .forEach((el) => el.classList.remove("dl-hit"));
  }, [diffQuery, selected, diffMode, diff]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        if (orderedPaths.length === 0) return;
        const cur = selected ? orderedPaths.indexOf(selected) : -1;
        const next =
          e.key === "j"
            ? Math.min(cur + 1, orderedPaths.length - 1)
            : Math.max(cur - 1, 0);
        setSelected(orderedPaths[next]);
      } else if (e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if ((e.key === "n" || e.key === "N") && diffQuery.trim()) {
        e.preventDefault();
        jumpMatch(e.key === "n" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [orderedPaths, selected, diffQuery, jumpMatch]);

  // 키보드 이동 시 활성 행이 리스트 뷰포트를 벗어나지 않게.
  useEffect(() => {
    if (!selected) return;
    document
      .querySelector(".diff-files .dfile.active")
      ?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);

  const cur = changes.find((c) => c.path === selected) ?? null;
  const reviewed = selected ? diffReadPaths.includes(selected) : false;

  // 현재 파일의 +N/−M 요약 — 패치 텍스트에서 직접 센다 (바이너리는 패치가
  // 없으므로 자연히 숨는다). +++/--- 파일 헤더는 제외.
  const stats = useMemo(() => {
    const src = diff?.source;
    const patch =
      src?.source === "git" || src?.source === "snapshot" ? src.patch : newFilePatch;
    if (!patch) return null;
    let add = 0;
    let del = 0;
    for (const line of patch.split("\n")) {
      if (line.startsWith("+++") || line.startsWith("---")) continue;
      if (line.startsWith("+")) add++;
      else if (line.startsWith("-")) del++;
    }
    return add === 0 && del === 0 ? null : { add, del };
  }, [diff, newFilePatch]);
  const allReviewed =
    changes.length > 0 && changes.every((c) => diffReadPaths.includes(c.path));

  // One file row in the left list (shared by the grouped + flat renders).
  const renderFile = (path: string) => {
    const op: ChangeOp = changes.find((c) => c.path === path)?.op ?? "M";
    const isReviewed = diffReadPaths.includes(path);
    return (
      <button
        type="button"
        key={path}
        className={"dfile" + (path === selected ? " active" : "")}
        onClick={() => setSelected(path)}
        aria-current={path === selected ? "true" : undefined}
      >
        <span className={"dstatus " + badgeLetter(op)}>{op}</span>
        <span className="dfile-name">{path}</span>
        {isReviewed ? (
          <span className="dfile-read" title={t("diff.reviewed")}>
            <CheckMark size={12} />
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <>
      <Toolbar
        title={t("diff.title")}
        sub={
          <span>
            {baseline === "last_commit" ? (
              <>
                {t("diff.lastCommit")} <span className="mono">{lastCommit?.short_sha}</span>
                {lastCommit?.subject ? ` · ${lastCommit.subject}` : ""}
              </>
            ) : (
              <>
                {branch ? <span className="mono">{branch}</span> : null}
                {branch ? " · " : ""}
                {t("diff.uncommittedFiles", { n: changes.length })}
              </>
            )}
          </span>
        }
      >
        {lastCommitChanges.length > 0 ? (
          <div className="diff-mode-toggle" title={t("diff.modeTitle")}>
            {(
              [
                ["working", `${t("diff.modeWorking")}${workingChanges.length ? ` ${workingChanges.length}` : ""}`],
                ["last_commit", t("diff.lastCommit")],
              ] as [DiffBaseline, string][]
            ).map(([b, label]) => (
              <button
                key={b}
                type="button"
                className="btn ghost sm"
                style={{
                  background: baseline === b ? "var(--accent-soft)" : "transparent",
                  color: baseline === b ? "var(--accent-text)" : "var(--text-2)",
                }}
                onClick={() => setBaselinePinned(b)}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="diff-mode-toggle">
          {(["unified", "split"] as DiffMode[]).map((m) => (
            <button
              key={m}
              type="button"
              className="btn ghost sm"
              style={{
                background: diffMode === m ? "var(--accent-soft)" : "transparent",
                color: diffMode === m ? "var(--accent-text)" : "var(--text-2)",
              }}
              onClick={() => setMode(m)}
            >
              {m === "unified" ? t("diff.viewUnified") : t("diff.viewSplit")}
            </button>
          ))}
        </div>
        <button
          className="btn ghost"
          onClick={onMarkAllReviewed}
          disabled={changes.length === 0 || allReviewed}
          title={t("diff.markAllTitle")}
        >
          <CheckMark size={15} /> {t("diff.markAll")}
        </button>
        <button
          className="btn primary"
          onClick={onMarkReviewed}
          disabled={!selected || reviewed}
        >
          <CheckMark size={15} /> {reviewed ? t("diff.isReviewed") : t("diff.reviewed")}
        </button>
      </Toolbar>

      {changes.length === 0 ? (
        <div className="scroll">
          <div className="page fade-in">
            <div className="empty-hint">
              {baseline === "working" && lastCommitChanges.length > 0
                ? t("diff.emptyWorking")
                : t("diff.emptyBranch")}
            </div>
          </div>
        </div>
      ) : (
        <div className="diff-screen">
          {/* Left: file list — grouped by the journal entry / plan that
              recorded each change (Dogfooding #3), with a flat fallback. */}
          <div className="diff-files">
            <div className="diff-files-head">
              {t("diff.changedFiles")}
              <span className="diff-kbd-hint" aria-hidden="true">
                <kbd>j</kbd>
                <kbd>k</kbd> {t("diff.navHint")} <kbd>/</kbd> {t("diff.searchHint")}
              </span>
            </div>
            {groups
              ? groups.map((g) => (
                  <div className="diff-group" key={g.entry_path ?? "__untracked"}>
                    <div className="diff-group-head">
                      {g.entry_path ? (
                        <button
                          type="button"
                          className="diff-group-title"
                          onClick={() => onOpenEntry?.(g.entry_path!)}
                          disabled={!onOpenEntry}
                          title={g.entry_title ?? g.entry_path}
                        >
                          {g.entry_title || g.entry_path}
                        </button>
                      ) : (
                        <span className="diff-group-title muted">{t("diff.untracked")}</span>
                      )}
                      {g.created_at ? (
                        <span className="diff-group-time">{groupDate(g.created_at)}</span>
                      ) : null}
                    </div>
                    {g.plan_refs.length > 0 ? (
                      <div className="diff-group-plans">
                        {collapsePlanRefs(g.plan_refs).map((p) => (
                          <span
                            className="tag"
                            key={p.planId}
                            title={
                              p.items.length > 1
                                ? `${p.title}\n· ${p.items.join("\n· ")}`
                                : `${p.title} · ${p.items[0]}`
                            }
                          >
                            <TargetIcon size={10} /> {p.title}
                            {p.items.length > 1 ? (
                              <span style={{ opacity: 0.6 }}> ·{p.items.length}</span>
                            ) : null}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {g.files.map((p) => renderFile(p))}
                  </div>
                ))
              : changes
                  .slice()
                  .reverse()
                  .map((c) => renderFile(c.path))}

            {impact && impact.affected.length > 0 ? (
              <div style={{ borderTop: "1px solid var(--sep)", marginTop: 8, paddingTop: 6 }}>
                <button
                  type="button"
                  onClick={() => setImpactOpen((o) => !o)}
                  title={t("diff.impactTitle")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    width: "100%",
                    padding: "4px 10px",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--text-2)",
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  <GitBranchIcon size={11} />
                  {t("diff.impact")}
                  <span style={{ marginLeft: "auto", color: "var(--text-3)" }}>
                    {impact.affected.length}
                  </span>
                </button>
                {impactOpen ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 1, padding: "2px 6px 6px" }}>
                    {impact.affected.slice(0, 60).map((n) => (
                      <button
                        key={n.file_id}
                        type="button"
                        className="dfile"
                        onClick={() => onOpenAffected(n.path)}
                        title={t("diff.impactHop", { path: n.path, n: n.depth })}
                      >
                        <span
                          className="dstatus"
                          style={{
                            background: "transparent",
                            color: n.depth === 1 ? "var(--accent-uncommitted, #c4922f)" : "var(--text-3)",
                            border: "1px solid var(--sep)",
                            minWidth: 16,
                            fontSize: 9,
                            fontWeight: 700,
                          }}
                        >
                          {n.depth}
                        </span>
                        <span className="dfile-name">{n.path}</span>
                      </button>
                    ))}
                    {impact.affected.length > 60 ? (
                      <span style={{ padding: "3px 6px", fontSize: 11, color: "var(--text-3)" }}>
                        {t("diff.impactMore", { n: impact.affected.length - 60 })}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Right: diff body */}
          <div className="diff-main">
            <div className="diff-bar">
              <FileCode2 size={15} color="var(--text-2)" />
              <span className="fname">{selected ?? "—"}</span>
              {cur ? (
                <span className="chip" style={{ height: 20 }}>
                  {cur.op === "A" ? t("diff.opAdded") : cur.op === "D" ? t("diff.opDeleted") : t("diff.opModified")}
                </span>
              ) : null}
              {stats ? (
                <span className="diff-stat" title={t("diff.statsTitle")}>
                  <span className="add">+{stats.add}</span>
                  <span className="del">−{stats.del}</span>
                </span>
              ) : null}
              <span style={{ flex: 1 }} />
              {/* v2 U8 — in-diff 검색. Enter/n=다음, Shift+Enter/N=이전, Esc=해제 */}
              <div className="diff-search">
                <input
                  ref={searchInputRef}
                  value={diffQuery}
                  onChange={(e) => setDiffQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      jumpMatch(e.shiftKey ? -1 : 1);
                    } else if (e.key === "Escape") {
                      setDiffQuery("");
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  placeholder={t("diff.searchPlaceholder")}
                  aria-label={t("diff.searchAria")}
                  spellCheck={false}
                />
                {matchPos ? (
                  <span className="diff-search-count">
                    {matchPos.total === 0 ? t("diff.noMatches") : `${matchPos.idx}/${matchPos.total}`}
                  </span>
                ) : null}
              </div>
              <button
                className="iconbtn"
                title={t("diff.openEditor")}
                onClick={onOpenEditor}
                disabled={!selected}
                aria-label={t("diff.openEditor")}
              >
                <ExternalLinkIcon size={15} />
              </button>
            </div>

            <div className="diff-code" ref={diffCodeRef}>
              {loading ? (
                <div className="empty-hint">
                  <Loader size={14} /> {t("diff.computing")}
                </div>
              ) : error ? (
                <div
                  className="empty-hint"
                  style={{ color: "var(--t-bug)", textAlign: "left", padding: 16 }}
                >
                  <TriangleAlert size={14} /> {error}
                </div>
              ) : diff ? (
                <DiffBody
                  result={diff}
                  mode={diffMode}
                  newFilePatch={newFilePatch}
                  newFileError={newFileError}
                  deleted={cur?.op === "D"}
                  baseline={baseline}
                  projectId={projectId}
                />
              ) : (
                <div className="empty-hint">{t("diff.pickFile")}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── diff body — reuses LocalDiffView's pure parsers, renders mockup .dl rows ──

function DiffBody({
  result,
  mode,
  newFilePatch,
  newFileError,
  deleted,
  baseline,
  projectId,
}: {
  result: DiffResult;
  mode: DiffMode;
  newFilePatch: string | null;
  newFileError: string | null;
  deleted: boolean;
  baseline: DiffBaseline;
  projectId: number;
}) {
  const { t } = useT();
  // 이미지/기타 바이너리 — 텍스트 diff 대신 파일 카드(+이미지 프리뷰).
  if (result.source.source === "binary") {
    return (
      <BinaryFileView
        projectId={projectId}
        path={result.path}
        isImage={result.source.is_image}
        oldSize={result.source.old_size}
        newSize={result.source.new_size}
        baseline={baseline}
      />
    );
  }
  if (result.source.source === "snapshots_unavailable") {
    // A deleted file with no baseline — nothing to diff, but don't error.
    if (deleted) {
      return (
        <div className="empty-hint" style={{ textAlign: "left", padding: 16 }}>
          {t("diff.fileDeleted")}
          <br />
          <span className="text-muted-foreground" style={{ fontSize: 11 }}>
            {t("diff.noBaseline")}
          </span>
        </div>
      );
    }
    // No baseline yet — render the file's whole content as additions so the
    // user sees the change immediately (untracked / never-indexed file).
    if (newFilePatch == null) {
      return (
        <div className="empty-hint" style={{ textAlign: "left", padding: 16 }}>
          {newFileError ? (
            <>
              {t("diff.readFailed")}
              <br />
              <span className="text-muted-foreground" style={{ fontSize: 11 }}>
                {newFileError}
              </span>
            </>
          ) : (
            t("diff.readingFile")
          )}
        </div>
      );
    }
    return (
      <div>
        <PatchView patch={newFilePatch} mode={mode} lang={langFromPath(result.path)} />
        <div className="diff-foot">
          <GitBranchIcon size={13} />
          {t("diff.newFileNote")}
        </div>
      </div>
    );
  }
  const patch = result.source.patch;
  const isSnapshot = result.source.source === "snapshot";
  if (!patch.trim()) {
    return (
      <div className="empty-hint" style={{ textAlign: "left", padding: 16 }}>
        {t("diff.noChanges", { base: isSnapshot ? t("diff.baseSnapshot") : t("diff.baseHead") })}
      </div>
    );
  }
  return (
    <div>
      <PatchView patch={patch} mode={mode} lang={langFromPath(result.path)} />
      <div className="diff-foot">
        <GitBranchIcon size={13} />
        {baseline === "last_commit"
          ? t("diff.footerLastCommit")
          : t("diff.footerWorking", { base: isSnapshot ? t("diff.baseSnapshotLong") : t("diff.baseHeadLong") })}
      </div>
    </div>
  );
}
