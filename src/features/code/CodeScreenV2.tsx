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
import {
  commands,
  events,
  type CodeTree as CodeTreeData,
  type LspCodeAction,
} from "@/lib/bindings";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useSettings } from "@/contexts/SettingsContext";
import { safeUnlistenPromise } from "@/lib/unlisten";
import { toast } from "@/lib/toast";
import { t, useT } from "@/i18n";
import { tError } from "@/i18n/errors";

import { CodeTree } from "./CodeTree";
import { CodeEditor } from "./CodeEditor";
import { useLsp } from "./useLsp";
import { AppDialog } from "@/components/ui/AppDialog";
import { langIdForPath, langLabel } from "./codeLang";
import { ancestorDirs, collectDirs, collectFiles, filterTree, formatBytes } from "./treeUtils";
import {
  bufferKey,
  deleteBuffer,
  detectEol,
  getBuffer,
  isDirty as bufferIsDirty,
  listDirtyPaths,
  normalizeEol,
  putBuffer,
  restoreEol,
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

  // 언어 서버 — `editorEpoch` 를 같이 넘긴다. 파일을 고른 순간이 아니라 **내용이
  // 실제로 로드된 순간**에 didOpen 이 나가야 서버가 빈 문서를 보고 엉뚱한 진단을
  // 내지 않는다 (에디터 재마운트와 같은 신호를 쓴다).
  const lsp = useLsp(projectId, selected, bufferRef.current?.text ?? "", editorEpoch);
  // watcher 가 "파일이 사라졌다" 토스트를 같은 파일에 반복하지 않기 위한 부기.
  const goneNotifiedRef = useRef<string | null>(null);

  const refreshDirtyPaths = useCallback(() => {
    setDirtyPaths(listDirtyPaths(projectId));
  }, [projectId]);

  // putBuffer 가 dirty 버퍼를 밀어냈으면(상한 초과) 조용한 유실 대신 알린다.
  const notifyIfEvicted = useCallback((evictedKey: string | null) => {
    if (!evictedKey) return;
    const path = evictedKey.slice(evictedKey.indexOf(":") + 1);
    toast.warning(t("code.bufferEvicted", { path }));
  }, []);

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
        // CM 은 어떤 줄바꿈이든 LF 로 합치므로, 원본 줄바꿈을 기억해 두고
        // 버퍼는 LF 로 정규화한다 — CRLF 파일이 저장 한 번에 전부 LF 로
        // 바뀌는 것을 막는다.
        const eol = detectEol(data.content);
        const text = normalizeEol(data.content);
        const fresh: CodeBuffer = { text, baseText: text, baseHash: data.hash, eol };
        bufferRef.current = fresh;
        notifyIfEvicted(putBuffer(key, fresh));
        setDirty(false);
      }
      refreshDirtyPaths();
      setFileView({ kind: "editor", bytes: data.bytes });
      setEditorEpoch((n) => n + 1);
    },
    [projectId, refreshDirtyPaths, notifyIfEvicted],
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

  // ── 정의로 이동 (F12 · ⌘클릭) ──────────────────────────────────────────
  //
  // 세 갈래다. 셋 다 **말은 한다** — 조용히 아무 일도 안 하면 사용자는 기능이
  // 고장난 줄 안다.
  const goToDefinition = useCallback(
    (line: number, character: number) => {
      void (async () => {
        const loc = await lsp.definition(line, character);
        if (!loc) {
          toast.info(t("code.lsp.noDefinition"));
          return;
        }
        if (!loc.path) {
          // 표준 라이브러리·의존성 — 코드 화면은 프로젝트 안만 연다.
          toast.info(t("code.lsp.definitionOutside", { file: loc.display }));
          return;
        }
        // jumpLine 은 1-based, LSP 는 0-based.
        setPendingJump(loc.line + 1);
        setSelected(loc.path);
      })();
    },
    [lsp, t],
  );

  // ── 이름 바꾸기 (F2) ───────────────────────────────────────────────────
  //
  // 이 화면에서 유일하게 **여러 파일을 한꺼번에 고치는** 동작이다. 백엔드가
  // 전부-아니면-전무로 적용하지만, 그 전에 프런트가 막아야 하는 것이 하나 있다:
  // **미저장 버퍼**. 서버는 didChange 로 받은 버퍼 내용을 보고 편집을 계산하는데
  // 백엔드는 디스크에 적용하므로, 둘이 다르면 엉뚱한 자리를 덮어쓴다.
  const [renameAt, setRenameAt] = useState<{ line: number; character: number } | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const startRename = useCallback(
    (line: number, character: number, word: string) => {
      if (dirtyPaths.size > 0) {
        toast.warning(t("code.lsp.renameNeedsSave"));
        return;
      }
      setRenameName(word);
      setRenameAt({ line, character });
    },
    [dirtyPaths, t],
  );

  const submitRename = useCallback(() => {
    const at = renameAt;
    const next = renameName.trim();
    const path = selectedRef.current;
    if (!at || !next || !path || renaming) return;
    setRenaming(true);
    void (async () => {
      const res = await commands.lspRename(projectId, path, at.line, at.character, next);
      setRenaming(false);
      if (res.status === "error") {
        toast.destructive(tError(res.error));
        return;
      }
      setRenameAt(null);
      toast.info(
        t("code.lsp.renameDone", { files: res.data.files.length, edits: res.data.total_edits }),
      );
      // 열려 있는 파일도 디스크에서 바뀌었다 — 버퍼를 버리고 다시 읽는다.
      void loadFile(path, { discardBuffer: true });
      setEditorEpoch((n) => n + 1);
    })();
  }, [renameAt, renameName, renaming, projectId, t, loadFile]);

  // ── 코드 액션 (⌘.) ─────────────────────────────────────────────────────
  //
  // 이름 바꾸기와 같은 이유로 미저장 게이트를 건다 — 서버는 버퍼를, 백엔드는
  // 디스크를 본다.
  const [actions, setActions] = useState<LspCodeAction[] | null>(null);
  const [actionsBusy, setActionsBusy] = useState(false);

  const openCodeActions = useCallback(
    (sl: number, sc: number, el: number, ec: number) => {
      if (dirtyPaths.size > 0) {
        toast.warning(t("code.lsp.renameNeedsSave"));
        return;
      }
      setActionsBusy(true);
      setActions([]);
      void (async () => {
        const list = await lsp.codeActions(sl, sc, el, ec);
        setActionsBusy(false);
        if (list.length === 0) {
          setActions(null);
          toast.info(t("code.lsp.noActions"));
          return;
        }
        setActions(list);
      })();
    },
    [dirtyPaths, lsp, t],
  );

  const runCodeAction = useCallback(
    (index: number) => {
      const path = selectedRef.current;
      if (!path || actionsBusy) return;
      setActionsBusy(true);
      void (async () => {
        try {
          const res = await lsp.applyCodeAction(index);
          setActions(null);
          if (res) {
            toast.info(
              t("code.lsp.renameDone", { files: res.files.length, edits: res.total_edits }),
            );
            // 열려 있는 파일도 디스크에서 바뀌었다 — 버퍼를 버리고 다시 읽는다.
            void loadFile(path, { discardBuffer: true });
            setEditorEpoch((n) => n + 1);
          }
        } catch (e) {
          toast.destructive(tError(e instanceof Error ? e.message : String(e)));
        } finally {
          setActionsBusy(false);
        }
      })();
    },
    [actionsBusy, lsp, t, loadFile],
  );

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
      // 저장을 기다리지 않고 서버에 밀어 넣는다 — 진단은 미저장 상태에서
      // 가장 쓸모 있다 (내부에서 디바운스).
      lsp.pushText(text);
    },
    [projectId, dirtyPaths, refreshDirtyPaths, lsp],
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

  // ⌘S 는 CM 키맵과 화면 레벨 리스너 양쪽에 걸릴 수 있는데, `saving` state 는
  // 같은 틱의 두 번째 호출에 아직 낡은 값이라 재진입을 못 막는다 — 같은
  // base_hash 로 codeWrite 가 두 번 나가면 두 번째가 가짜 충돌 배너를 띄운다.
  const savingRef = useRef(false);
  const save = useCallback(
    async (baseHashOverride?: string) => {
      const buf = bufferRef.current;
      const path = selectedRef.current;
      if (!buf || !path || savingRef.current) return;
      if (buf.text === buf.baseText && !baseHashOverride) return; // no-op
      savingRef.current = true;
      setSaving(true);
      try {
        const res = await commands.codeWrite(
          projectId,
          path,
          restoreEol(buf.text, buf.eol),
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
        savingRef.current = false;
        setSaving(false);
      }
    },
    [projectId, applySaved],
  );
  const saveRef = useRef(save);
  saveRef.current = save;

  // 화면 레벨 ⌘S — 트리/필터에 포커스가 있어도 저장된다 (CM 포커스는 CM
  // 키맵이 먼저 먹는다). 검색 화면의 ⌘F 와 같은 화면-로컬 패턴.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // CM 키맵이 이미 처리한 ⌘S (preventDefault 됨) — 여기서 또 부르면
      // 같은 base_hash 로 저장이 두 번 나간다.
      if (e.defaultPrevented) return;
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
        if (selectedRef.current !== path) return;
        if (res.status !== "ok") {
          // 외부에서 파일이 지워지거나 이동됐다 — 조용히 삼키면 사용자는
          // 저장 실패에서야 알게 된다. 같은 파일에 한 번만 알린다.
          if (goneNotifiedRef.current !== path) {
            goneNotifiedRef.current = path;
            toast.warning(t("code.fileGone", { path }));
          }
          return;
        }
        goneNotifiedRef.current = null;
        const buf = bufferRef.current;
        if (!buf || res.data.binary || res.data.too_large) return;
        if (res.data.hash === buf.baseHash) return; // 자기 저장의 에코
        if (buf.text === buf.baseText) {
          // 깨끗한 버퍼 — 조용히 최신화하되 읽던 줄은 유지한다.
          const eol = detectEol(res.data.content);
          const text = normalizeEol(res.data.content);
          const fresh: CodeBuffer = { text, baseText: text, baseHash: res.data.hash, eol };
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

  // 서버 상태를 한 낱말로. **"인덱싱 중" 을 밝히는 것이 요점** — rust-analyzer 는
  // 첫 기동에 수십 초를 쓰는데, 그동안 진단이 안 오는 것을 "안 붙었다" 와
  // 구별할 수 없으면 사용자는 고장으로 읽는다.
  const lspLabel = ((): string | null => {
    switch (lsp.status.state) {
      case "indexing":
        return t("code.lsp.indexing");
      case "ready":
        return t("code.lsp.ready");
      case "starting":
        return t("code.lsp.starting");
      case "missing":
        return t("code.lsp.missing");
      case "failed":
        return t("code.lsp.failed");
      default:
        return null;
    }
  })();

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
                    diagnostics={lsp.diagnostics}
                    onComplete={lsp.complete}
                    onHover={lsp.hover}
                    onGoToDefinition={goToDefinition}
                    onRename={startRename}
                    onCodeActions={openCodeActions}
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
                    {lspLabel ? (
                      <span
                        className={"code-status-lsp " + (lsp.status.state ?? "")}
                        title={lsp.status.detail ?? undefined}
                      >
                        {lspLabel}
                      </span>
                    ) : null}
                    <span>{langLabel(langId)}</span>
                    <span>{formatBytes(fileView.bytes)}</span>
                  </span>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}

      <AppDialog
        open={renameAt != null}
        onClose={() => setRenameAt(null)}
        label={t("code.lsp.renameTitle")}
        width={420}
        initialFocusRef={renameInputRef}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitRename();
          }}
          style={{ padding: "18px 20px 16px" }}
        >
          <label
            htmlFor="code-rename-input"
            style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 8 }}
          >
            {t("code.lsp.renameTitle")}
          </label>
          <input
            id="code-rename-input"
            ref={renameInputRef}
            className="input"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            disabled={renaming}
            spellCheck={false}
            autoComplete="off"
            style={{ width: "100%", fontFamily: "var(--mono)" }}
          />
          <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--text-3)", lineHeight: 1.6 }}>
            {t("code.lsp.renameHint")}
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
            <button type="button" className="btn sm" onClick={() => setRenameAt(null)} disabled={renaming}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn sm primary" disabled={renaming || !renameName.trim()}>
              {renaming ? t("code.lsp.renaming") : t("code.lsp.renameApply")}
            </button>
          </div>
        </form>
      </AppDialog>

      <AppDialog
        open={actions != null && actions.length > 0}
        onClose={() => setActions(null)}
        label={t("code.lsp.actionsTitle")}
        width={460}
      >
        <div style={{ padding: "16px 20px 18px" }}>
          <h2 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700 }}>
            {t("code.lsp.actionsTitle")}
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(actions ?? []).map((a) => (
              <button
                key={a.index}
                type="button"
                className="btn sm"
                disabled={actionsBusy}
                onClick={() => runCodeAction(a.index)}
                style={{ justifyContent: "flex-start", textAlign: "left", gap: 8 }}
              >
                {/* 서버가 "이걸 먼저" 라고 표시한 것 — 대개 진짜 고치려던 fix 다. */}
                {a.preferred ? <span style={{ color: "var(--accent-text)" }}>★</span> : null}
                <span style={{ flex: 1 }}>{a.title}</span>
                {a.kind ? (
                  <span style={{ fontSize: 11, color: "var(--text-3)" }}>{a.kind}</span>
                ) : null}
              </button>
            ))}
          </div>
          <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--text-3)", lineHeight: 1.6 }}>
            {t("code.lsp.renameHint")}
          </p>
        </div>
      </AppDialog>
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
