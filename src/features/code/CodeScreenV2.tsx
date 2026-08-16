// 코드 화면 (13번째 ui_v2 화면) — 프로젝트 파일을 앱 안에서 열어 보고 가볍게
// 고친다 (docs/code-editor/00-master-plan.md). 좌: 필터 가능한 파일 트리 /
// 우: CodeMirror 에디터 + 상태줄.
//
// 편집 모델: SSOT 는 디스크. 버퍼는 모듈 캐시(codeBuffers)에 살아 화면·파일
// 전환에도 미저장 편집이 유지된다. 저장은 blake3 낙관적 잠금(code_write) —
// 디스크가 그 사이 바뀌면 충돌 배너로 병합 선택지를 준다. 열린 파일의 watcher
// 이벤트는 dirty 아니면 조용히 리로드, dirty 면 충돌 배너다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Toolbar } from "@/components/Toolbar";
import {
  RefreshCw,
  ExternalLink,
  Save,
  FileCode,
  AlertTriangle,
  Search,
} from "@/components/Icons";
import { commands, events, type CodeTree as CodeTreeData } from "@/lib/bindings";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useSettings } from "@/contexts/SettingsContext";
import { safeUnlistenPromise } from "@/lib/unlisten";
import { toast } from "@/lib/toast";
import { t, useT } from "@/i18n";
import { tError } from "@/i18n/errors";

import { CodeTree } from "./CodeTree";
import { CodeEditor } from "./CodeEditor";
import { langIdForPath, langLabel } from "./codeLang";
import { ancestorDirs, collectDirs, collectFiles, filterTree, formatBytes } from "./treeUtils";
import {
  bufferKey,
  deleteBuffer,
  getBuffer,
  isDirty as bufferIsDirty,
  listDirtyPaths,
  putBuffer,
  type CodeBuffer,
} from "./codeBuffers";
import "./code.css";

/** 다른 화면(검색·코드맵)에서 넘어온 열기 목표 — one-shot 핸드오프. */
export interface CodeOpenTarget {
  path: string;
  /** 1-based. null 이면 파일만 연다. */
  line: number | null;
  /** 같은 파일·같은 라인의 연속 점프도 effect 가 다시 돌도록 하는 구분자. */
  nonce: number;
}

interface CodeScreenV2Props {
  projectId: number;
  projectRoot: string | null;
  openTarget: CodeOpenTarget | null;
  onOpenTargetConsumed: () => void;
}

type FileView =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "binary"; bytes: number }
  | { kind: "tooLarge"; bytes: number }
  | { kind: "editor"; bytes: number };

export function CodeScreenV2({
  projectId,
  projectRoot,
  openTarget,
  onOpenTargetConsumed,
}: CodeScreenV2Props) {
  useT();
  const { state, setState } = useWorkspace();
  const { settings } = useSettings();

  const [tree, setTree] = useState<CodeTreeData | null>(null);
  const [treeStatus, setTreeStatus] = useState<"loading" | "ready" | "error">("loading");
  const [treeError, setTreeError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [fileView, setFileView] = useState<FileView>({ kind: "idle" });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  // 버퍼는 ref — 키 입력마다 화면 state 를 바꾸면 트리까지 리렌더된다.
  // 화면에 보여야 하는 파생값(dirty·커서)만 state 로 승격한다.
  const bufferRef = useRef<CodeBuffer | null>(null);
  const [dirty, setDirty] = useState(false);
  const [dirtyPaths, setDirtyPaths] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<{ line: number; col: number }>({ line: 1, col: 1 });
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<{ diskHash: string } | null>(null);
  // 에디터 재마운트 스위치 — 파일 전환·디스크 리로드가 올린다.
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [pendingJump, setPendingJump] = useState<number | null>(null);

  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const refreshDirtyPaths = useCallback(() => {
    setDirtyPaths(listDirtyPaths(projectId));
  }, [projectId]);

  // ── 트리 ────────────────────────────────────────────────────────────────
  const loadTree = useCallback(() => {
    setTreeStatus("loading");
    setTreeError(null);
    void commands.codeTree(projectId).then((res) => {
      if (res.status === "ok") {
        setTree(res.data);
        setTreeStatus("ready");
      } else {
        setTreeError(tError(res.error));
        setTreeStatus("error");
      }
    });
  }, [projectId]);

  useEffect(() => {
    loadTree();
    refreshDirtyPaths();
  }, [loadTree, refreshDirtyPaths]);

  const fileSet = useMemo(() => new Set(collectFiles(tree?.nodes ?? [])), [tree]);

  // 트리 로드 후: 현재 선택이 유효하면 유지, 아니면 영속 경로 복원.
  // docs 와 달리 첫 파일 자동 열기는 하지 않는다 — 임의 파일이 열리는 것보다
  // 안내 있는 빈 상태가 낫다.
  useEffect(() => {
    if (treeStatus !== "ready") return;
    setSelected((prev) => {
      if (prev && fileSet.has(prev)) return prev;
      const persisted = state.codeActivePath;
      if (persisted && fileSet.has(persisted)) return persisted;
      return null;
    });
  }, [treeStatus, fileSet, state.codeActivePath]);

  // ── 파일 로드 ──────────────────────────────────────────────────────────
  const loadFile = useCallback(
    async (path: string, opts?: { discardBuffer?: boolean }) => {
      setFileView({ kind: "loading" });
      setConflict(null);
      const key = bufferKey(projectId, path);
      if (opts?.discardBuffer) deleteBuffer(key);
      const res = await commands.codeRead(projectId, path);
      if (selectedRef.current !== path) return; // 그 사이 다른 파일로 이동
      if (res.status === "error") {
        setFileView({ kind: "error", message: tError(res.error) });
        return;
      }
      const data = res.data;
      if (data.too_large) {
        setFileView({ kind: "tooLarge", bytes: data.bytes });
        return;
      }
      if (data.binary) {
        setFileView({ kind: "binary", bytes: data.bytes });
        return;
      }
      const cached = getBuffer(key);
      if (cached && bufferIsDirty(cached)) {
        // 미저장 편집이 살아 있다 — 버퍼를 유지하고, 그 사이 디스크가 더
        // 나아갔는지만 확인한다.
        bufferRef.current = cached;
        setDirty(true);
        if (data.hash !== cached.baseHash) setConflict({ diskHash: data.hash });
      } else {
        const fresh: CodeBuffer = { text: data.content, baseText: data.content, baseHash: data.hash };
        bufferRef.current = fresh;
        putBuffer(key, fresh);
        setDirty(false);
      }
      refreshDirtyPaths();
      setFileView({ kind: "editor", bytes: data.bytes });
      setEditorEpoch((n) => n + 1);
    },
    [projectId, refreshDirtyPaths],
  );

  useEffect(() => {
    if (!selected) {
      setFileView({ kind: "idle" });
      bufferRef.current = null;
      setDirty(false);
      setConflict(null);
      return;
    }
    void loadFile(selected);
  }, [selected, loadFile]);

  // 선택 변경: 영속화 + 조상 폴더 펼침 (docs 와 같은 계약).
  useEffect(() => {
    if (!selected) return;
    setState((prev) =>
      prev.codeActivePath === selected ? prev : { ...prev, codeActivePath: selected },
    );
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const dir of ancestorDirs(selected)) next.add(dir);
      return next;
    });
  }, [selected, setState]);

  // ── 다른 화면에서 온 열기 목표 ─────────────────────────────────────────
  useEffect(() => {
    if (!openTarget) return;
    setPendingJump(openTarget.line);
    setSelected(openTarget.path);
    // 같은 파일이면 로드가 다시 돌지 않으므로 점프만 남는다 — CodeEditor 의
    // jumpLine effect 가 prop 변화로 실행된다.
    onOpenTargetConsumed();
  }, [openTarget, onOpenTargetConsumed]);

  // ── 편집·저장 ──────────────────────────────────────────────────────────
  const handleChange = useCallback(
    (text: string) => {
      const buf = bufferRef.current;
      const path = selectedRef.current;
      if (!buf || !path) return;
      const next = { ...buf, text };
      bufferRef.current = next;
      putBuffer(bufferKey(projectId, path), next);
      const nowDirty = text !== next.baseText;
      setDirty((prev) => (prev === nowDirty ? prev : nowDirty));
      if (nowDirty !== dirtyPaths.has(path)) refreshDirtyPaths();
    },
    [projectId, dirtyPaths, refreshDirtyPaths],
  );

  const applySaved = useCallback(
    (path: string, hash: string) => {
      const buf = bufferRef.current;
      if (!buf) return;
      const next = { ...buf, baseText: buf.text, baseHash: hash };
      bufferRef.current = next;
      putBuffer(bufferKey(projectId, path), next);
      setDirty(false);
      setConflict(null);
      refreshDirtyPaths();
    },
    [projectId, refreshDirtyPaths],
  );

  const save = useCallback(
    async (baseHashOverride?: string) => {
      const buf = bufferRef.current;
      const path = selectedRef.current;
      if (!buf || !path || saving) return;
      if (buf.text === buf.baseText && !baseHashOverride) return; // no-op
      setSaving(true);
      try {
        const res = await commands.codeWrite(
          projectId,
          path,
          buf.text,
          baseHashOverride ?? buf.baseHash,
        );
        if (res.status === "error") {
          toast.destructive(t("code.saveFailed", { error: tError(res.error) }));
          return;
        }
        if (res.data.kind === "saved") {
          applySaved(path, res.data.hash);
        } else {
          setConflict({ diskHash: res.data.disk_hash });
        }
      } finally {
        setSaving(false);
      }
    },
    [projectId, saving, applySaved],
  );
  const saveRef = useRef(save);
  saveRef.current = save;

  // 화면 레벨 ⌘S — 트리/필터에 포커스가 있어도 저장된다 (CM 포커스는 CM
  // 키맵이 먼저 먹는다). 검색 화면의 ⌘F 와 같은 화면-로컬 패턴.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        e.stopPropagation();
        void saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── 충돌 해소 ──────────────────────────────────────────────────────────
  const reloadFromDisk = useCallback(() => {
    const path = selectedRef.current;
    if (!path) return;
    void loadFile(path, { discardBuffer: true });
  }, [loadFile]);

  const overwriteDisk = useCallback(() => {
    if (!conflict) return;
    void save(conflict.diskHash);
  }, [conflict, save]);

  // ── 열린 파일의 외부 변경 감지 (watcher) ───────────────────────────────
  useEffect(() => {
    const un = events.oculpmFileChanged.listen(({ payload }) => {
      if (payload.project_id !== projectId) return;
      const path = selectedRef.current;
      if (!path || payload.event.path !== path) return;
      void (async () => {
        const res = await commands.codeRead(projectId, path);
        if (res.status !== "ok" || selectedRef.current !== path) return;
        const buf = bufferRef.current;
        if (!buf || res.data.binary || res.data.too_large) return;
        if (res.data.hash === buf.baseHash) return; // 자기 저장의 에코
        if (buf.text === buf.baseText) {
          // 깨끗한 버퍼 — 조용히 최신화하되 읽던 줄은 유지한다.
          const fresh: CodeBuffer = {
            text: res.data.content,
            baseText: res.data.content,
            baseHash: res.data.hash,
          };
          bufferRef.current = fresh;
          putBuffer(bufferKey(projectId, path), fresh);
          setPendingJump(cursorRef.current.line);
          setEditorEpoch((n) => n + 1);
        } else {
          setConflict({ diskHash: res.data.hash });
        }
      })();
    });
    return () => safeUnlistenPromise(un);
  }, [projectId]);

  // ── 외부 에디터 ────────────────────────────────────────────────────────
  const openExternal = useCallback(async () => {
    const path = selectedRef.current;
    if (!projectRoot || !path) return;
    const res = await commands.openInEditor(
      projectRoot,
      path,
      settings.externalEditorCommand,
      cursorRef.current.line,
    );
    if (res.status === "error") toast.destructive(t("diff.editorFailed", { error: res.error }));
  }, [projectRoot, settings.externalEditorCommand]);

  // ── 트리 파생값 ────────────────────────────────────────────────────────
  const visibleNodes = useMemo(() => {
    if (!tree) return [];
    return filter.trim() ? filterTree(tree.nodes, filter) : tree.nodes;
  }, [tree, filter]);

  // 필터 중엔 매치가 보이도록 전부 펼친다 (사용자 펼침 상태는 건드리지 않음).
  const expandedForRender = useMemo(() => {
    if (!filter.trim()) return expanded;
    return new Set(collectDirs(visibleNodes));
  }, [filter, expanded, visibleNodes]);

  const toggleDir = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const langId = selected ? langIdForPath(selected) : null;
  const buf = bufferRef.current;

  return (
    <>
      <Toolbar
        title={t("nav.code")}
        sub={selected ? selected + (dirty ? " ●" : "") : undefined}
      >
        {selected && projectRoot ? (
          <button
            type="button"
            className="code-tool-btn"
            onClick={() => void openExternal()}
            title={t("code.openExternal")}
            aria-label={t("code.openExternal")}
          >
            <ExternalLink size={15} />
          </button>
        ) : null}
        {selected && fileView.kind === "editor" ? (
          <button
            type="button"
            className={"code-tool-btn code-save-btn" + (dirty ? " on" : "")}
            onClick={() => void save()}
            disabled={!dirty || saving}
            title={t("code.save") + " (⌘S)"}
            aria-label={t("code.save")}
          >
            <Save size={15} />
          </button>
        ) : null}
        <button
          type="button"
          className="code-tool-btn"
          onClick={loadTree}
          title={t("code.refresh")}
          aria-label={t("code.refresh")}
        >
          <RefreshCw size={15} />
        </button>
      </Toolbar>

      {treeStatus === "loading" ? (
        <div className="scroll">
          <div className="page">
            <div className="empty-hint">{t("code.loading")}</div>
          </div>
        </div>
      ) : treeStatus === "error" ? (
        <div className="scroll">
          <div className="page">
            <div className="empty-hint">
              {t("code.listFailed")}
              <br />
              {treeError}
            </div>
          </div>
        </div>
      ) : (
        <div className="code-body">
          <aside className="code-sidebar">
            <div className="code-filter">
              <Search size={13} className="code-filter-ico" />
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t("code.filter")}
                aria-label={t("code.filter")}
                spellCheck={false}
              />
            </div>
            {tree?.truncated ? (
              <div className="code-truncated">{t("code.truncated")}</div>
            ) : null}
            {visibleNodes.length === 0 ? (
              <div className="code-tree-empty">{t("code.noMatch")}</div>
            ) : (
              <CodeTree
                nodes={visibleNodes}
                selected={selected}
                expanded={expandedForRender}
                dirtyPaths={dirtyPaths}
                onToggle={toggleDir}
                onSelect={setSelected}
              />
            )}
          </aside>

          <div className="code-main">
            {conflict ? (
              <div className="code-conflict" role="alert">
                <AlertTriangle size={15} className="code-conflict-ico" />
                <div className="code-conflict-text">
                  <strong>{t("code.conflict.title")}</strong>
                  <span>{t("code.conflict.desc")}</span>
                </div>
                <button type="button" className="btn ghost sm" onClick={reloadFromDisk}>
                  {t("code.conflict.reload")}
                </button>
                <button
                  type="button"
                  className="btn sm code-conflict-overwrite"
                  onClick={overwriteDisk}
                  disabled={saving}
                >
                  {t("code.conflict.overwrite")}
                </button>
              </div>
            ) : null}

            {fileView.kind === "idle" ? (
              <CodeEmptyState />
            ) : fileView.kind === "loading" ? (
              <div className="code-center-hint">{t("common.loading")}</div>
            ) : fileView.kind === "error" ? (
              <div className="code-center-hint">
                {t("code.readFailed")}
                <br />
                {fileView.message}
              </div>
            ) : fileView.kind === "binary" || fileView.kind === "tooLarge" ? (
              <div className="code-center-hint code-unopenable">
                <FileCode size={30} strokeWidth={1.5} />
                <div className="code-unopenable-title">
                  {fileView.kind === "binary" ? t("code.binary") : t("code.tooLarge")}
                </div>
                <div className="code-unopenable-desc">{formatBytes(fileView.bytes)}</div>
                {projectRoot ? (
                  <button type="button" className="btn sm" onClick={() => void openExternal()}>
                    <ExternalLink size={13} /> {t("code.openExternal")}
                  </button>
                ) : null}
              </div>
            ) : buf ? (
              <>
                <div className="code-editor-wrap">
                  <CodeEditor
                    key={`${selected}:${editorEpoch}`}
                    initialText={buf.text}
                    path={selected ?? ""}
                    onChange={handleChange}
                    onSave={() => void saveRef.current()}
                    onCursor={(line, col) => setCursor({ line, col })}
                    jumpLine={pendingJump}
                    onJumpConsumed={() => setPendingJump(null)}
                  />
                </div>
                <div className="code-statusbar">
                  <span className={"code-status-dirty" + (dirty ? " on" : "")}>
                    {dirty ? t("code.dirty") : t("code.savedState")}
                  </span>
                  <span className="code-status-sep" />
                  <span>
                    Ln {cursor.line}, Col {cursor.col}
                  </span>
                  <span className="code-status-right">
                    <span>{langLabel(langId)}</span>
                    <span>{formatBytes(fileView.bytes)}</span>
                  </span>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}

function CodeEmptyState() {
  useT();
  return (
    <div className="code-center-hint code-empty">
      <FileCode size={32} strokeWidth={1.5} className="code-empty-ico" />
      <div className="code-empty-title">{t("code.empty.title")}</div>
      <p className="code-empty-desc">{t("code.empty.desc")}</p>
    </div>
  );
}
