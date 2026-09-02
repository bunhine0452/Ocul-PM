// 편집 창(pane) 하나 — 탭 바 + CodeMirror + 상태줄. 분할하면 이것이 둘 뜬다.
//
// 왜 화면에서 떼어냈나: 좌우 분할은 "에디터를 두 번 그리는 것" 이 아니라
// **편집 상태를 두 벌 갖는 것**이다 (버퍼·커서·충돌·LSP 수명이 창마다 따로다).
// 화면이 그걸 배열로 들고 있으면 모든 상태가 인덱스로 갈라져 읽을 수 없게 된다.
// 창을 컴포넌트로 두면 React 가 그 갈래를 대신 들어 준다.
//
// 창이 소유하는 것: 활성 파일의 버퍼·저장·충돌·커서·LSP·watcher 반응.
// 부모가 소유하는 것: 탭 목록 자체(어떤 파일이 어느 창에 열렸는가)·트리·파일 조작.
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  commands,
  events,
  type FileJournalEntry,
  type GitLineChange,
  type LspCodeAction,
  type LspSymbol,
} from "@/lib/bindings";
import { NAV_BUS } from "@/lib/navRegistry";
import { reverseApplyPatch } from "./patchReverse";
import { useSettings } from "@/contexts/SettingsContext";
import { safeUnlistenPromise } from "@/lib/unlisten";
import { toast } from "@/lib/toast";
import { t, useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import { AppDialog } from "@/components/ui/AppDialog";
import {
  AlertTriangle,
  ChevronRight,
  CircleX,
  ExternalLink,
  FileCode,
  GitCompareArrows,
  ImageFileIcon,
  NotebookText,
  TriangleAlert,
  X,
} from "@/components/Icons";
import { FileIcon } from "./FileIcon";

import { CodeEditor } from "./CodeEditor";
import { clampStickyMax } from "./stickyModel";
import { useProblems } from "./problemsStore";
import { groupByFile, totalCounts } from "./problemsModel";
import { CodePreview } from "./CodePreview";
import { SvgPreview } from "./SvgPreview";
import type { ReferencesQuery } from "./CodeReferences";
import { CodeTabsBar } from "./CodeTabsBar";
import { isSvgPath, previewKindFor, type PreviewKind } from "./previewKind";
import { applyHygiene, hygieneForPath, type HygieneOptions } from "./saveHygiene";
import { useAutoSave } from "./autoSave";
import { useLsp } from "./useLsp";
import { langIdForPath, langLabel } from "./codeLang";
import { adapterLanguageFor } from "./debugConfig";
import { baseName } from "./fileOps";
import { formatBytes } from "./treeUtils";
import {
  bufferKey,
  deleteBuffer,
  detectEol,
  getBuffer,
  isDirty as bufferIsDirty,
  normalizeEol,
  putBuffer,
  restoreEol,
  type CodeBuffer,
} from "./codeBuffers";

/** 거터 갱신 디바운스. 타자마다 `git show` 를 부를 수는 없다. */
const GUTTER_DEBOUNCE_MS = 500;

/** svg 미리보기 갱신 디바운스 — 타자마다 blob 을 새로 굽지 않는다. */
const SVG_DEBOUNCE_MS = 250;

type FileView =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "binary"; bytes: number }
  | { kind: "tooLarge"; bytes: number }
  /** 이미지·PDF — 편집은 못 하지만 볼 수는 있다. 크기는 미리보기가 직접 알린다. */
  | { kind: "preview"; preview: PreviewKind }
  | { kind: "editor"; bytes: number };

/** 부모(툴바)가 이 창에 지시하는 창구 — 툴바는 포커스된 창 하나만 겨눈다. */
export interface CodePaneHandle {
  save: () => void;
  openExternal: () => void;
  format: () => void;
}

export interface CodePaneProps {
  projectId: number;
  projectRoot: string | null;
  paneIndex: number;
  tabs: string[];
  activePath: string | null;
  isFocused: boolean;
  isSplit: boolean;
  /**
   * 이 창이 언어 서버를 몰아도 되는가.
   *
   * 백엔드는 (프로젝트, 파일) 로 문서를 하나만 연다 — 같은 파일이 양쪽 창에
   * 열리면 didOpen 이 두 번 나가고, 한쪽을 닫을 때 아직 보고 있는 쪽의 문서까지
   * 닫힌다. 그래서 **같은 파일일 때는 왼쪽 창만** 서버를 붙인다.
   */
  lspEnabled: boolean;
  /** 부모가 지시한 줄 점프 (검색·코드맵·정의로 이동). nonce 로 재발화.
   *  `ch`/`len` (UTF-16) 이 있으면 그 범위를 선택한다 — 전역 검색의 매치 표시. */
  jump: { line: number; ch?: number; len?: number; focus?: boolean; nonce: number } | null;
  /** 이 프로젝트에서 미저장인 경로들 — 탭 배지 + LSP 쓰기 동작의 게이트. */
  dirtyPaths: Set<string>;
  /** 이 창의 미리보기 탭 (훑어보려고 연 한 자리). 없으면 null. */
  previewPath: string | null;
  /**
   * 미리보기 탭을 보통 탭으로 승격한다.
   *
   * 여기서 부르는 계기는 **첫 편집**과 탭 더블클릭이다. 미리보기로 연 파일을
   * 고치기 시작했는데 다음 클릭에 사라지면 그건 데이터 손실처럼 느껴진다
   * (버퍼는 남지만 화면에서 사라진다).
   */
  onPinTab: (path: string) => void;
  onFocus: () => void;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  onCloseOthers: (path: string) => void;
  /** ⇧⌘T — 마지막으로 닫은 탭을 되살린다 (탭 우클릭 메뉴에도 있다). */
  onReopenClosed: () => void;
  /** 되살릴 닫은 탭이 있는가 — 메뉴 항목의 disabled 게이트. */
  canReopen: boolean;
  onSplit: () => void;
  onUnsplit: () => void;
  onMoveToOtherPane: (path: string) => void;
  /** 탭을 다른 창에서 이 창으로 끌어다 놓았다. */
  onDropTab: (fromPane: number, path: string) => void;
  /** 버퍼 캐시가 바뀌었다 — 부모가 dirty 배지를 다시 계산한다. */
  onBuffersChanged: () => void;
  /** 정의가 다른 파일에 있다 — 부모가 탭을 열어 준다. */
  onOpenPath: (path: string, line: number | null) => void;
  /**
   * ⇧F12 결과. 패널은 **화면**이 그린다 — 편집 영역 전체 폭에 걸쳐야 하고,
   * 분할 중에도 하나만 떠야 한다.
   */
  onReferences: (query: ReferencesQuery) => void;
  /** 커서가 있는 줄(1-based). 사이드바 아웃라인이 지금 위치를 표시한다. */
  onCursorLine: (line: number) => void;
  /**
   * 스티키 스크롤이 쓸 문서 심볼 (아웃라인과 **같은 값**). `null` 이면 확장이
   * 들여쓰기 폴백으로 그린다 — 언어 서버가 없는 파일도 맥락은 보여야 한다.
   */
  stickySymbols: LspSymbol[] | null;
  /** 상태줄의 문제 뱃지를 눌렀다 — 화면이 패널을 연다. */
  onOpenProblems: () => void;
  /** 이 파일의 중단점 줄들 (1-based). */
  breakpointsFor: (path: string) => number[];
  /** 어댑터가 못 건다고 답한 줄들. */
  unverifiedFor: (path: string) => number[];
  /** 거터 클릭 — 디버그 가능한 파일에만 거터가 붙는다. */
  onToggleBreakpoint: (path: string, line: number) => void;
  /** 브레드크럼의 폴더 조각 클릭 — 트리에서 그 폴더를 펼쳐 보여 준다. */
  onRevealDir: (dir: string) => void;
}

export const CodePane = forwardRef<CodePaneHandle, CodePaneProps>(function CodePane(
  {
    projectId,
    projectRoot,
    paneIndex,
    tabs,
    activePath,
    isFocused,
    isSplit,
    lspEnabled,
    jump,
    dirtyPaths,
    previewPath,
    onPinTab,
    onFocus,
    onActivate,
    onClose,
    onCloseOthers,
    onReopenClosed,
    canReopen,
    onSplit,
    onUnsplit,
    onMoveToOtherPane,
    onDropTab,
    onBuffersChanged,
    onOpenPath,
    onReferences,
    onCursorLine,
    stickySymbols,
    onOpenProblems,
    breakpointsFor,
    unverifiedFor,
    onToggleBreakpoint,
    onRevealDir,
  },
  ref,
) {
  useT();
  const { settings } = useSettings();

  // 스티키 스크롤 — 꺼져 있으면 0 이고, 0 이면 CodeEditor 가 확장을 안 단다.
  const stickyMax = settings.codeStickyScroll ? clampStickyMax(settings.codeStickyMaxLines) : 0;

  // 문제 총계 — 스토어를 직접 구독한다 (화면에서 내려보내면 진단이 올 때마다
  // 코드 화면 전체가 다시 그려진다. `indexProgressStore` 와 같은 잣대).
  const problems = useProblems(projectId);
  const problemTotals = useMemo(() => totalCounts(groupByFile(problems)), [problems]);

  const [fileView, setFileView] = useState<FileView>({ kind: "idle" });
  // 버퍼는 ref — 키 입력마다 화면 state 를 바꾸면 트리까지 리렌더된다.
  // 화면에 보여야 하는 파생값(dirty·커서)만 state 로 승격한다.
  const bufferRef = useRef<CodeBuffer | null>(null);
  const [dirty, setDirty] = useState(false);
  const [cursor, setCursor] = useState<{ line: number; col: number }>({ line: 1, col: 1 });
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<{ diskHash: string } | null>(null);
  // 에디터 재마운트 스위치 — 파일 전환·디스크 리로드가 올린다.
  const [editorEpoch, setEditorEpoch] = useState(0);
  // 같은 것의 미리보기 판(版) — 워처가 자산을 다시 읽게 만드는 유일한 손잡이다.
  const [previewEpoch, setPreviewEpoch] = useState(0);
  // ── svg 인라인 미리보기 ─────────────────────────────────────────────────
  // svg 는 에디터로 열되(코드니까) 옆에 그림을 띄울 수 있다. 그림의 원본은
  // 디스크가 아니라 **버퍼**라, 저장하기 전의 편집이 그대로 보인다.
  const [svgOpen, setSvgOpen] = useState(false);
  const [svgText, setSvgText] = useState("");
  // 타자 경로(handleChange)는 ref 로 읽는다 — state 를 의존성에 넣으면 콜백
  // 신원이 바뀌고, 그게 곧 에디터 확장 재설정으로 번진다.
  const svgOpenRef = useRef(false);
  svgOpenRef.current = svgOpen;
  const svgTimerRef = useRef<number | null>(null);
  // 자동 저장의 타자 트리거 — 훅이 저장 경로보다 아래에서 만들어지므로 ref 로 잇는다.
  const onEditRef = useRef<() => void>(() => {});
  // ── 인라인 비교 (Cursor 식) ─────────────────────────────────────────────
  // original 이 있으면 에디터가 그 텍스트와의 차이를 본문 안에 그린다.
  // 두 원본이 있다: HEAD(마지막 커밋 이후 = 지금 에이전트가 한 일 전부)와
  // 특정 일지(그 작업 단위가 바꾼 것만 — 사이드카 패치를 거꾸로 물려 얻는다).
  const [diffMode, setDiffMode] = useState<
    | { kind: "head" }
    | { kind: "entry"; title: string; journalPath: string }
    | null
  >(null);
  const [diffOriginal, setDiffOriginal] = useState<string | null>(null);
  // 이 파일을 files_touched 로 만진 일지들 — 브레드크럼의 일지 칩.
  const [fileEntries, setFileEntries] = useState<FileJournalEntry[]>([]);
  const [entriesOpen, setEntriesOpen] = useState(false);
  const [pendingJump, setPendingJump] = useState<{
    line: number;
    ch?: number;
    len?: number;
    /** false 면 에디터가 포커스를 가져가지 않는다 (파일 안 이동의 미리 점프). */
    focus?: boolean;
  } | null>(null);

  const pathRef = useRef(activePath);
  pathRef.current = activePath;

  // 언어 서버 — `editorEpoch` 를 같이 넘긴다. 파일을 고른 순간이 아니라 **내용이
  // 실제로 로드된 순간**에 didOpen 이 나가야 서버가 빈 문서를 보고 엉뚱한 진단을
  // 내지 않는다 (에디터 재마운트와 같은 신호를 쓴다).
  const lsp = useLsp(
    projectId,
    lspEnabled ? activePath : null,
    bufferRef.current?.text ?? "",
    editorEpoch,
  );
  // watcher 가 "파일이 사라졌다" 토스트를 같은 파일에 반복하지 않기 위한 부기.
  const goneNotifiedRef = useRef<string | null>(null);

  // putBuffer 가 dirty 버퍼를 밀어냈으면(상한 초과) 조용한 유실 대신 알린다.
  const notifyIfEvicted = useCallback((evictedKey: string | null) => {
    if (!evictedKey) return;
    const path = evictedKey.slice(evictedKey.indexOf(":") + 1);
    toast.warning(t("code.bufferEvicted", { path }));
  }, []);

  // ── git 거터 (#git-gutter) ─────────────────────────────────────────────
  //
  // 저장이 아니라 **버퍼**를 기준으로 본다 — 고치는 즉시 거터가 따라와야
  // 쓸모가 있다. 타자마다 git 을 부를 수는 없으므로 디바운스한다.
  const [gitChanges, setGitChanges] = useState<GitLineChange[]>([]);
  const gutterTimerRef = useRef<number | null>(null);
  const refreshGutter = useCallback(
    (text: string, immediate = false) => {
      const path = pathRef.current;
      if (!path) return;
      if (gutterTimerRef.current != null) window.clearTimeout(gutterTimerRef.current);
      const run = () => {
        gutterTimerRef.current = null;
        void commands.gitLineChanges(projectId, path, text).then((res) => {
          // 그 사이 다른 파일로 옮겼으면 버린다 — 늦게 온 응답이 남의 파일
          // 거터를 그리면 줄이 통째로 어긋나 보인다.
          if (pathRef.current !== path) return;
          setGitChanges(res.status === "ok" ? res.data : []);
        });
      };
      if (immediate) run();
      else gutterTimerRef.current = window.setTimeout(run, GUTTER_DEBOUNCE_MS);
    },
    [projectId],
  );
  useEffect(
    () => () => {
      if (gutterTimerRef.current != null) window.clearTimeout(gutterTimerRef.current);
    },
    [],
  );

  // ── 파일 로드 ──────────────────────────────────────────────────────────
  const loadFile = useCallback(
    async (path: string, opts?: { discardBuffer?: boolean }) => {
      setFileView({ kind: "loading" });
      setConflict(null);
      const key = bufferKey(projectId, path);
      if (opts?.discardBuffer) deleteBuffer(key);
      // 편집할 수 없는 파일로 넘어갈 때는 **앞 파일의 버퍼를 반드시 놓는다**.
      // 들고 있으면 이 상태에서 누른 ⌘S 가 남의 본문을 이 경로에 쓰려 들고,
      // 해시가 안 맞아 애먼 "충돌" 배너로 위장된다.
      const showUneditable = (view: FileView) => {
        bufferRef.current = null;
        setDirty(false);
        setFileView(view);
      };
      // 이미지·PDF 는 텍스트 창구를 아예 타지 않는다. 태웠자 2MB 편집 상한과
      // 바이너리 판정에 걸려 "열 수 없음" 이 될 뿐이다.
      const preview = previewKindFor(path);
      if (preview) {
        showUneditable({ kind: "preview", preview });
        return;
      }
      const res = await commands.codeRead(projectId, path);
      if (pathRef.current !== path) return; // 그 사이 다른 파일로 이동
      if (res.status === "error") {
        setFileView({ kind: "error", message: tError(res.error) });
        return;
      }
      const data = res.data;
      if (data.too_large) {
        showUneditable({ kind: "tooLarge", bytes: data.bytes });
        return;
      }
      if (data.binary) {
        showUneditable({ kind: "binary", bytes: data.bytes });
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
      onBuffersChanged();
      setFileView({ kind: "editor", bytes: data.bytes });
      setEditorEpoch((n) => n + 1);
      // 파일을 연 순간은 기다릴 이유가 없다 — 거터가 늦게 뜨면 깜빡인다.
      refreshGutter(bufferRef.current?.text ?? "", true);
    },
    [projectId, onBuffersChanged, notifyIfEvicted, refreshGutter],
  );

  useEffect(() => {
    setDiffMode(null);
    setDiffOriginal(null);
    setEntriesOpen(false);
    // 미리보기는 파일에 붙는다 — 다음 파일이 svg 가 아닐 수 있으므로 접고 간다.
    setSvgOpen(false);
    if (!activePath) {
      setFileView({ kind: "idle" });
      bufferRef.current = null;
      setDirty(false);
      setConflict(null);
      setGitChanges([]);
      setFileEntries([]);
      return;
    }
    void loadFile(activePath);
    // 이 파일을 만진 일지들 — 실패는 빈 목록으로 접는다 (칩이 안 뜰 뿐).
    void commands.codeFileEntries(projectId, activePath).then((res) => {
      if (pathRef.current !== activePath) return;
      setFileEntries(res.status === "ok" && Array.isArray(res.data) ? res.data : []);
    });
  }, [activePath, loadFile, projectId]);

  // ── 비교 모드 들고 나기 — 에디터는 key 재마운트로 갈아탄다 ──────────────
  const enterHeadDiff = useCallback(async () => {
    const path = pathRef.current;
    const buf = bufferRef.current;
    if (!path || !buf) return;
    const res = await commands.codeHeadContent(projectId, path);
    if (pathRef.current !== path) return;
    if (res.status !== "ok" || res.data == null) {
      toast.info(t("code.diff.noHead"));
      return;
    }
    setDiffOriginal(normalizeEol(res.data));
    setDiffMode({ kind: "head" });
    setPendingJump({ line: cursorRef.current.line });
    setEditorEpoch((n) => n + 1);
  }, [projectId]);

  const enterEntryDiff = useCallback(
    async (entry: FileJournalEntry) => {
      const path = pathRef.current;
      const buf = bufferRef.current;
      if (!path || !buf) return;
      const res = await commands.oculpmGetEntryDiffs(projectId, entry.journal_path);
      if (pathRef.current !== path) return;
      const filePatch =
        res.status === "ok" ? res.data.find((d) => d.path === path)?.patch : undefined;
      const before = filePatch ? reverseApplyPatch(buf.text, filePatch) : null;
      if (before == null) {
        // 파일이 그 일지 이후로 더 바뀌어 문맥이 안 맞는다 — 거짓 비교 대신
        // 일지 화면의 diff 모달로 안내한다.
        toast.info(t("code.diff.entryStale"));
        return;
      }
      setDiffOriginal(before);
      setDiffMode({ kind: "entry", title: entry.title, journalPath: entry.journal_path });
      setPendingJump({ line: cursorRef.current.line });
      setEditorEpoch((n) => n + 1);
    },
    [projectId],
  );

  /**
   * 미리보기 본문을 버퍼에서 다시 뜬다.
   *
   * `editorEpoch` 는 "에디터에 실린 본문이 통째로 갈렸다" 는 신호다 — 열기,
   * 워처 리로드, 포맷팅, 비교 모드 진입/이탈이 전부 이걸 올린다. 타자는
   * `handleChange` 가 디바운스로 따로 민다.
   */
  useEffect(() => {
    if (!svgOpen) return;
    setSvgText(bufferRef.current?.text ?? "");
  }, [svgOpen, editorEpoch]);

  // 디바운스 타이머는 창이 사라질 때 반드시 끈다.
  useEffect(
    () => () => {
      if (svgTimerRef.current != null) window.clearTimeout(svgTimerRef.current);
    },
    [],
  );

  const exitDiff = useCallback(() => {
    setDiffMode(null);
    setDiffOriginal(null);
    setPendingJump({ line: cursorRef.current.line });
    setEditorEpoch((n) => n + 1);
  }, []);

  /** 일지 화면으로 점프 — 팔레트와 같은 전역 버스를 쓴다 (화면 결합 없음). */
  const openJournal = useCallback((journalPath: string) => {
    window.dispatchEvent(
      new CustomEvent(NAV_BUS.openEntity, { detail: { kind: "journal", id: journalPath } }),
    );
  }, []);

  // 부모가 지시한 줄 점프. 같은 파일·같은 줄의 연속 점프도 다시 돌도록 nonce 로 건다.
  useEffect(() => {
    if (jump) setPendingJump({ line: jump.line, ch: jump.ch, len: jump.len, focus: jump.focus });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump?.nonce]);

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
        if (loc.path === pathRef.current) setPendingJump({ line: loc.line + 1 });
        else onOpenPath(loc.path, loc.line + 1);
      })();
    },
    [lsp, onOpenPath],
  );

  // ── 이름 바꾸기 (F2) ───────────────────────────────────────────────────
  //
  // 이 창에서 유일하게 **여러 파일을 한꺼번에 고치는** 동작이다. 백엔드가
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
    [dirtyPaths],
  );

  const submitRename = useCallback(() => {
    const at = renameAt;
    const next = renameName.trim();
    const path = pathRef.current;
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
  }, [renameAt, renameName, renaming, projectId, loadFile]);

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
    [dirtyPaths, lsp],
  );

  const runCodeAction = useCallback(
    (index: number) => {
      const path = pathRef.current;
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
    [actionsBusy, lsp, loadFile],
  );

  // ── 참조 찾기 (⇧F12) ───────────────────────────────────────────────────
  //
  // 결과는 창이 아니라 **화면**이 그린다 — 편집 영역 전체 폭이 필요하고,
  // 분할 중에도 패널은 하나여야 한다.
  const findReferences = useCallback(
    (line: number, character: number, word: string) => {
      const symbol = word || (pathRef.current ?? "");
      onReferences({ symbol, status: "loading", files: [] });
      void lsp.references(line, character).then((files) => {
        onReferences({ symbol, status: "ready", files });
      });
    },
    [lsp, onReferences],
  );

  // ── 편집·저장 ──────────────────────────────────────────────────────────
  const handleChange = useCallback(
    (text: string) => {
      const buf = bufferRef.current;
      const path = pathRef.current;
      if (!buf || !path) return;
      const next = { ...buf, text };
      bufferRef.current = next;
      putBuffer(bufferKey(projectId, path), next);
      const nowDirty = text !== next.baseText;
      setDirty((prev) => (prev === nowDirty ? prev : nowDirty));
      if (nowDirty !== dirtyPaths.has(path)) onBuffersChanged();
      // 고치기 시작한 파일은 더 이상 "훑어보는 중" 이 아니다 — 미리보기가 아니면
      // `pinTab` 이 같은 상태를 돌려주므로 타자마다 불러도 리렌더가 없다.
      if (nowDirty) onPinTab(path);
      // 저장을 기다리지 않고 서버에 밀어 넣는다 — 진단은 미저장 상태에서
      // 가장 쓸모 있다 (내부에서 디바운스).
      lsp.pushText(text);
      refreshGutter(text);
      onEditRef.current();
      if (svgOpenRef.current) {
        if (svgTimerRef.current != null) window.clearTimeout(svgTimerRef.current);
        svgTimerRef.current = window.setTimeout(() => {
          svgTimerRef.current = null;
          setSvgText(text);
        }, SVG_DEBOUNCE_MS);
      }
    },
    [projectId, dirtyPaths, onBuffersChanged, onPinTab, lsp, refreshGutter],
  );

  /**
   * 버퍼 본문을 통째로 갈아끼운다 (포맷팅). 에디터는 언컨트롤드라 `key` 로
   * 재마운트해야 새 본문이 실리고, 그러면 커서가 맨 위로 가므로 보던 줄을
   * 점프로 복원한다 — watcher 리로드가 쓰는 것과 같은 수법.
   */
  const replaceBufferText = useCallback(
    (text: string) => {
      const buf = bufferRef.current;
      const path = pathRef.current;
      if (!buf || !path) return;
      const next = { ...buf, text };
      bufferRef.current = next;
      putBuffer(bufferKey(projectId, path), next);
      setDirty(text !== next.baseText);
      onBuffersChanged();
      lsp.pushText(text);
      refreshGutter(text);
      setPendingJump({ line: cursorRef.current.line });
      setEditorEpoch((n) => n + 1);
    },
    [projectId, onBuffersChanged, lsp, refreshGutter],
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
      onBuffersChanged();
    },
    [projectId, onBuffersChanged],
  );

  // ── 포맷팅 (⇧⌥F) ──────────────────────────────────────────────────────
  //
  // 이름 바꾸기·코드 액션과 정반대다: 그것들은 디스크를 고치므로 미저장을
  // 금지했지만, 포맷은 **지금 버퍼**를 다듬어 돌려받아 그대로 실는다. 저장을
  // 강요하지 않고, 결과를 저장할지는 여전히 사용자가 정한다.
  const [formatting, setFormatting] = useState(false);
  const format = useCallback(
    async (silent = false, range?: import("./CodeEditor").FormatRange): Promise<boolean> => {
      const buf = bufferRef.current;
      if (!buf || formatting) return false;
      setFormatting(true);
      try {
        const next = await lsp.format(
          buf.text,
          settings.codeTabSize,
          settings.codeInsertSpaces,
          range
            ? {
                start_line: range.startLine,
                start_character: range.startCharacter,
                end_line: range.endLine,
                end_character: range.endCharacter,
              }
            : null,
        );
        if (next == null) {
          // 서버가 없거나·지원하지 않거나·이미 정돈됐다. 저장 시 포맷처럼
          // 사람이 부르지 않은 호출은 조용히 지나간다.
          if (!silent) toast.info(t("code.format.noChange"));
          return false;
        }
        replaceBufferText(next);
        if (!silent) toast.info(t("code.format.done"));
        return true;
      } catch (e) {
        toast.destructive(
          t("code.format.failed", { error: tError(e instanceof Error ? e.message : String(e)) }),
        );
        return false;
      } finally {
        setFormatting(false);
      }
    },
    [formatting, lsp, settings.codeTabSize, settings.codeInsertSpaces, replaceBufferText],
  );
  const formatRef = useRef(format);
  formatRef.current = format;

  // ── 저장 위생 ──────────────────────────────────────────────────────────
  // 설정을 ref 로 잡는 이유: 저장은 타이머·cleanup 안에서도 돌고, 그때 필요한
  // 것은 "저장을 부른 순간의 설정" 이다.
  const hygieneOptions = useMemo<HygieneOptions>(
    () => ({
      trimTrailingWhitespace: settings.codeTrimTrailingWhitespace,
      insertFinalNewline: settings.codeInsertFinalNewline,
      trimFinalNewlines: settings.codeTrimFinalNewlines,
      protectedLines: [],
    }),
    [
      settings.codeTrimTrailingWhitespace,
      settings.codeInsertFinalNewline,
      settings.codeTrimFinalNewlines,
    ],
  );
  const hygieneRef = useRef(hygieneOptions);
  hygieneRef.current = hygieneOptions;

  // ⌘S 는 CM 키맵과 화면 레벨 리스너 양쪽에 걸릴 수 있는데, `saving` state 는
  // 같은 틱의 두 번째 호출에 아직 낡은 값이라 재진입을 못 막는다 — 같은
  // base_hash 로 codeWrite 가 두 번 나가면 두 번째가 가짜 충돌 배너를 띄운다.
  const savingRef = useRef(false);
  // 자동 저장이 반복 실패하는 경로 — 토스트를 한 번만 낸다. 사용자가 부르지
  // 않은 동작이 1초마다 같은 말을 하면 그건 알림이 아니라 소음이다.
  const autoFailedRef = useRef<Set<string>>(new Set());
  const save = useCallback(
    async (opts?: { baseHash?: string; auto?: boolean }) => {
      const path = pathRef.current;
      const auto = opts?.auto === true;
      if (!bufferRef.current || !path || savingRef.current) return;
      if (bufferRef.current.text === bufferRef.current.baseText && !opts?.baseHash) return; // no-op
      savingRef.current = true;
      setSaving(true);
      try {
        // 저장 시 포맷 — **쓰기 전에** 다듬는다. 쓴 뒤에 고치면 저장 직후 다시
        // dirty 가 되어 무엇이 디스크에 있는지 알 수 없다. 조용히(silent) 돌려
        // 서버가 없거나 이미 정돈된 경우에 토스트를 내지 않는다.
        //
        // 자동 저장은 포맷을 **건너뛴다** — VS Code 가 정확히 그렇게 한다
        // (`saveParticipants.ts` 의 `if (context.reason === SaveReason.AUTO) return`).
        // 타자 도중 1초마다 포매터가 도는 것은 편집기가 아니라 방해다.
        if (settings.codeFormatOnSave && !auto) await formatRef.current(true);
        // 포맷이 본문을 갈아끼웠을 수 있으므로 **여기서 다시 읽는다**.
        const buf = bufferRef.current;
        if (!buf) return;
        // 저장 시 정리 — 자동 저장이면 커서 줄을 보호한다(커서가 튀지 않게).
        const tidied = applyHygiene(
          buf.text,
          hygieneForPath(path, {
            ...hygieneRef.current,
            protectedLines: auto ? [cursorRef.current.line] : [],
          }),
        );
        if (tidied !== buf.text) replaceBufferText(tidied);
        const target = bufferRef.current;
        if (!target) return;
        const res = await commands.codeWrite(
          projectId,
          path,
          restoreEol(target.text, target.eol),
          opts?.baseHash ?? target.baseHash,
        );
        if (res.status === "error") {
          // 자동 저장의 쓰기 실패(권한 등)는 경로당 한 번만 알린다.
          if (auto && autoFailedRef.current.has(path)) return;
          if (auto) autoFailedRef.current.add(path);
          toast.destructive(t("code.saveFailed", { error: tError(res.error) }));
          return;
        }
        autoFailedRef.current.delete(path);
        if (res.data.kind === "saved") {
          applySaved(path, res.data.hash);
        } else {
          // 충돌은 배너만 — 자동 저장이 토스트를 쏘지 않는다 (D7: 남의 작업을
          // 덮는 경로는 없고, 사용자는 배너에서 고르면 된다).
          setConflict({ diskHash: res.data.disk_hash });
        }
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [projectId, applySaved, replaceBufferText, settings.codeFormatOnSave],
  );
  const saveRef = useRef(save);
  saveRef.current = save;

  const externalRef = useRef<() => void>(() => {});
  useImperativeHandle(
    ref,
    () => ({
      save: () => void saveRef.current(),
      openExternal: () => externalRef.current(),
      format: () => void formatRef.current(),
    }),
    [],
  );

  // 창 레벨 ⌘S — 트리/필터에 포커스가 있어도 저장된다 (CM 포커스는 CM 키맵이
  // 먼저 먹는다). 분할 중이면 **포커스된 창만** 반응한다 — 안 그러면 한 번의
  // ⌘S 가 양쪽에서 저장을 쏜다.
  const focusedRef = useRef(isFocused);
  focusedRef.current = isFocused;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // CM 키맵이 이미 처리한 ⌘S (preventDefault 됨) — 여기서 또 부르면
      // 같은 base_hash 로 저장이 두 번 나간다.
      if (e.defaultPrevented || !focusedRef.current) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        e.stopPropagation();
        void saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── 자동 저장 ──────────────────────────────────────────────────────────
  /**
   * 화면을 떠난 경로를 조용히 저장한다 (탭 전환·창 정리).
   *
   * 이 창의 state 를 건드리지 않는다 — 충돌 배너·저장 중 표시는 **지금 보이는
   * 파일**의 것이다. 충돌하면 버퍼를 그대로 두고 지나간다: 탭 배지가 미저장으로
   * 남아, 사용자가 그 파일로 돌아오면 평소의 배너로 만난다.
   */
  const flushPath = useCallback(
    (path: string) => {
      const key = bufferKey(projectId, path);
      const buf = getBuffer(key);
      if (!buf || buf.text === buf.baseText) return;
      // 떠난 파일에는 커서가 없다 — 보호할 줄도 없다.
      const text = applyHygiene(buf.text, hygieneForPath(path, hygieneRef.current));
      void (async () => {
        const res = await commands.codeWrite(projectId, path, restoreEol(text, buf.eol), buf.baseHash);
        if (res.status !== "ok" || res.data.kind !== "saved") return;
        // 쓰는 사이에 그 버퍼가 또 바뀌었으면(다시 열어 고쳤다) 덮지 않는다.
        const latest = getBuffer(key);
        if (!latest || latest.text !== buf.text) return;
        putBuffer(key, { ...latest, text, baseText: text, baseHash: res.data.hash });
        onBuffersChanged();
      })();
    },
    [projectId, onBuffersChanged],
  );

  const autoSave = useAutoSave({
    mode: settings.codeAutoSave,
    delayMs: settings.codeAutoSaveDelay,
    activePath,
    isFocused,
    // 하나라도 걸리면 조용히 건너뛴다. 충돌 배너가 떠 있는 동안 자동으로
    // 덮어쓰지 않고(D7), 인라인 비교 중에는 사용자가 읽는 중이다.
    canAutoSave: () =>
      bufferRef.current != null &&
      bufferRef.current.text !== bufferRef.current.baseText &&
      !savingRef.current &&
      conflict == null &&
      diffMode == null &&
      fileView.kind === "editor",
    saveActive: () => void saveRef.current({ auto: true }),
    flushPath,
  });
  onEditRef.current = autoSave.onEdit;
  const autoSaveOn = settings.codeAutoSave !== "off";

  // ── 충돌 해소 ──────────────────────────────────────────────────────────
  const reloadFromDisk = useCallback(() => {
    const path = pathRef.current;
    if (!path) return;
    void loadFile(path, { discardBuffer: true });
  }, [loadFile]);

  const overwriteDisk = useCallback(() => {
    if (!conflict) return;
    void save({ baseHash: conflict.diskHash });
  }, [conflict, save]);

  // ── 열린 파일의 외부 변경 감지 (watcher) ───────────────────────────────
  useEffect(() => {
    const un = events.oculpmFileChanged.listen(({ payload }) => {
      if (payload.project_id !== projectId) return;
      const path = pathRef.current;
      if (!path || payload.event.path !== path) return;
      void (async () => {
        // 미리보기 파일은 본문이 아니라 자산을 다시 읽는다 — 에이전트가 스크린샷을
        // 갈아 끼우면 화면도 따라가야 한다.
        if (previewKindFor(path)) {
          setPreviewEpoch((n) => n + 1);
          return;
        }
        const res = await commands.codeRead(projectId, path);
        if (pathRef.current !== path) return;
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
          setPendingJump({ line: cursorRef.current.line });
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
    const path = pathRef.current;
    if (!projectRoot || !path) return;
    const res = await commands.openInEditor(
      projectRoot,
      path,
      settings.externalEditorCommand,
      cursorRef.current.line,
    );
    if (res.status === "error") toast.destructive(t("diff.editorFailed", { error: res.error }));
  }, [projectRoot, settings.externalEditorCommand]);
  externalRef.current = () => void openExternal();

  const langId = activePath ? langIdForPath(activePath) : null;
  // 디버그 어댑터가 있는 언어인가 — 중단점 거터를 달지 정한다.
  const debuggable = adapterLanguageFor(activePath) != null;
  const buf = bufferRef.current;

  // 서버 상태를 한 낱말로. **"인덱싱 중" 을 밝히는 것이 요점** — rust-analyzer 는
  // 첫 기동에 수십 초를 쓰는데, 그동안 진단이 안 오는 것을 "안 붙었다" 와
  // 구별할 수 없으면 사용자는 고장으로 읽는다.
  const lspLabel = useMemo((): string | null => {
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
  }, [lsp.status.state]);

  return (
    <div
      className={"code-pane" + (isFocused && isSplit ? " focused" : "")}
      // 캡처 단계 — 탭·에디터 어디를 눌러도 이 창이 먼저 포커스를 가져간다.
      onMouseDownCapture={onFocus}
      onFocusCapture={onFocus}
      data-pane={paneIndex}
    >
      <CodeTabsBar
        paneIndex={paneIndex}
        tabs={tabs}
        active={activePath}
        preview={previewPath}
        dirtyPaths={dirtyPaths}
        isSplit={isSplit}
        onActivate={onActivate}
        onClose={onClose}
        onCloseOthers={onCloseOthers}
        onPin={onPinTab}
        onReopenClosed={onReopenClosed}
        canReopen={canReopen}
        onSplit={onSplit}
        onUnsplit={onUnsplit}
        onMoveToOtherPane={onMoveToOtherPane}
        onDropTab={onDropTab}
      />

      {/* 브레드크럼 — 어느 폴더의 파일인지 탭 이름만으로는 모른다 (같은 이름의
          파일이 흔하다: mod.rs·index.ts). 폴더 조각을 누르면 트리에서 펼친다. */}
      {activePath ? (
        <nav className="code-crumbs" aria-label={t("code.crumbs.aria")}>
          {activePath.split("/").map((seg, i, all) => {
            const isLast = i === all.length - 1;
            const dir = all.slice(0, i + 1).join("/");
            return (
              <span key={dir} className="code-crumb-seg">
                {i > 0 ? <ChevronRight size={11} className="code-crumb-sep" aria-hidden /> : null}
                {isLast ? (
                  <span className="code-crumb current">
                    <FileIcon name={seg} size={13} />
                    {seg}
                  </span>
                ) : (
                  <button type="button" className="code-crumb" onClick={() => onRevealDir(dir)}>
                    {seg}
                  </button>
                )}
              </span>
            );
          })}
          <span className="code-crumbs-actions">
            {/* 이 파일을 만진 일지 — 에이전트가 여기에 무슨 일을 했는지. */}
            {fileEntries.length > 0 ? (
              <button
                type="button"
                className={"code-crumb-act" + (entriesOpen ? " on" : "")}
                onClick={() => setEntriesOpen((v) => !v)}
                title={t("code.jrnl.chipTitle", { count: fileEntries.length })}
                aria-label={t("code.jrnl.chipTitle", { count: fileEntries.length })}
                aria-expanded={entriesOpen}
              >
                <NotebookText size={13} />
                <span className="code-crumb-act-n">{fileEntries.length}</span>
              </button>
            ) : null}
            {/* svg — 코드로 열되 그림도 옆에 띄운다 (VS Code 의 Open Preview 자리). */}
            {fileView.kind === "editor" && activePath && isSvgPath(activePath) ? (
              <button
                type="button"
                className={"code-crumb-act" + (svgOpen ? " on" : "")}
                onClick={() => setSvgOpen((v) => !v)}
                title={t("code.svg.toggle")}
                aria-label={t("code.svg.toggle")}
                aria-pressed={svgOpen}
              >
                <ImageFileIcon size={13} />
              </button>
            ) : null}
            {fileView.kind === "editor" ? (
              <button
                type="button"
                className={"code-crumb-act" + (diffMode?.kind === "head" ? " on" : "")}
                onClick={() => (diffMode ? exitDiff() : void enterHeadDiff())}
                title={t("code.diff.head")}
                aria-label={t("code.diff.head")}
              >
                <GitCompareArrows size={13} />
              </button>
            ) : null}
          </span>
        </nav>
      ) : null}

      {/* 일지 팝오버 — 항목 클릭은 일지 화면으로, diff 버튼은 인라인 비교로. */}
      {entriesOpen ? (
        <div className="code-jrnl-pop" role="menu" aria-label={t("code.jrnl.title")}>
          <div className="code-jrnl-pop-head">{t("code.jrnl.title")}</div>
          {fileEntries.map((entry) => (
            <div key={entry.journal_path} className="code-jrnl-row">
              <button
                type="button"
                className="code-jrnl-open"
                onClick={() => {
                  setEntriesOpen(false);
                  openJournal(entry.journal_path);
                }}
                title={t("code.jrnl.open")}
              >
                <span className={"code-jrnl-type t-" + entry.entry_type} aria-hidden />
                <span className="code-jrnl-title">{entry.title}</span>
                <span className="code-jrnl-meta">
                  {entry.agent_id} · {entry.created_at.slice(5, 16).replace("T", " ")} · {entry.op}
                </span>
              </button>
              <button
                type="button"
                className="code-jrnl-diff"
                onClick={() => {
                  setEntriesOpen(false);
                  void enterEntryDiff(entry);
                }}
                title={t("code.jrnl.diff")}
                aria-label={t("code.jrnl.diff")}
              >
                <GitCompareArrows size={13} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {/* 비교 모드 배너 — 지금 무엇과 비교 중인지, 나가는 길. */}
      {diffMode ? (
        <div className="code-diffbar" role="status">
          <GitCompareArrows size={13} className="code-diffbar-ico" />
          <span className="code-diffbar-label">
            {diffMode.kind === "head"
              ? t("code.diff.banner.head")
              : t("code.diff.banner.entry", { title: diffMode.title })}
          </span>
          {diffMode.kind === "entry" ? (
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => openJournal(diffMode.journalPath)}
            >
              {t("code.jrnl.open")}
            </button>
          ) : null}
          <button type="button" className="code-diffbar-exit" onClick={exitDiff} aria-label={t("code.diff.exit")} title={t("code.diff.exit")}>
            <X size={13} strokeWidth={2.5} />
          </button>
        </div>
      ) : null}

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
      ) : fileView.kind === "preview" ? (
        <CodePreview
          projectId={projectId}
          path={activePath ?? ""}
          kind={fileView.preview}
          epoch={previewEpoch}
          canOpenExternal={Boolean(projectRoot)}
          onOpenExternal={() => void openExternal()}
        />
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
          <div
            className={"code-editor-wrap" + (svgOpen ? " with-svg" : "")}
            onBlur={autoSave.onEditorBlur}
          >
            <CodeEditor
              // 스티키 설정이 key 에 있는 이유: 확장은 마운트 시점에 결정되므로
              // 켜고 끈 것이 그 자리에서 보이려면 재마운트해야 한다. 본문은
              // 버퍼가 갖고 있어 미저장 편집은 살아남는다 (실행 취소 이력만
              // 잃는다 — 파일을 바꿀 때와 같은 대가).
              key={`${activePath}:${editorEpoch}:${stickyMax}`}
              initialText={buf.text}
              path={activePath ?? ""}
              onChange={handleChange}
              diagnostics={lsp.diagnostics}
              onComplete={lsp.complete}
              onHover={lsp.hover}
              onGoToDefinition={goToDefinition}
              onRename={startRename}
              onCodeActions={openCodeActions}
              onReferences={findReferences}
              onFormat={(range) => void formatRef.current(false, range)}
              // 서버가 안 붙은 창에는 확장을 아예 달지 않는다 (CodeEditor 가
              // prop 유무로 판단하므로 undefined 여야 한다).
              onSignatureHelp={lspEnabled ? lsp.signatureHelp : undefined}
              stickyMaxLines={stickyMax}
              stickySymbols={stickySymbols}
              tabSize={settings.codeTabSize}
              onSave={() => void saveRef.current()}
              onCursor={(line, col) => {
                setCursor({ line, col });
                onCursorLine(line);
              }}
              gitChanges={gitChanges}
              diffOriginal={diffOriginal}
              breakpoints={activePath ? breakpointsFor(activePath) : undefined}
              unverifiedBreakpoints={activePath ? unverifiedFor(activePath) : undefined}
              // 디버그 못 하는 파일에는 거터를 아예 안 단다 — 눌러도 안 찍히는
              // 이유를 그 자리에서 설명할 수 없다 (CodeEditor 가 prop 유무로 판단).
              onToggleBreakpoint={
                debuggable ? (line) => onToggleBreakpoint(activePath ?? "", line) : undefined
              }
              jump={pendingJump}
              onJumpConsumed={() => setPendingJump(null)}
            />
            {svgOpen ? (
              <SvgPreview
                text={svgText}
                name={activePath ? baseName(activePath) : ""}
                onClose={() => setSvgOpen(false)}
              />
            ) : null}
          </div>
          <div className="code-statusbar">
            {/* 자동 저장을 켰으면 그 사실이 여기 있어야 한다 — ⌘S 습관을 버려도
                되는지 사용자가 알 방법이 이것뿐이다. */}
            <span className={"code-status-item code-status-dirty" + (dirty ? " on" : "")}>
              <span aria-hidden>{dirty ? "●" : "○"}</span>
              <span>
                {saving
                  ? t("code.savingState")
                  : dirty
                    ? t("code.dirty")
                    : autoSaveOn
                      ? t("code.autoSaveOn")
                      : t("code.savedState")}
              </span>
            </span>
            <span className="code-status-item">
              Ln {cursor.line}, Col {cursor.col}
            </span>
            <span className="code-status-right">
              {/* 문제 패널이 있다는 것을 알리는 **유일한 신호**다. 0 일 때도
                  남긴다 — 감추면 빈 상태(= "아직 아는 문제 없음")를 읽을 길이
                  없어진다. */}
              <button
                type="button"
                className={
                  "code-status-item code-status-problems" +
                  (problemTotals.error > 0 ? " has-error" : problemTotals.warning > 0 ? " has-warn" : "")
                }
                onClick={onOpenProblems}
                title={t("code.problems.badge", {
                  errors: problemTotals.error,
                  warnings: problemTotals.warning,
                })}
                aria-label={t("code.problems.badge", {
                  errors: problemTotals.error,
                  warnings: problemTotals.warning,
                })}
              >
                <CircleX size={11} aria-hidden />
                <span>{problemTotals.error}</span>
                <TriangleAlert size={11} aria-hidden />
                <span>{problemTotals.warning}</span>
              </button>
              {lspLabel ? (
                <span
                  className={"code-status-item code-status-lsp " + (lsp.status.state ?? "")}
                  title={lsp.status.detail ?? undefined}
                >
                  {/* 상태를 색점으로 — 낱말을 읽기 전에 색이 먼저 답한다. */}
                  <span className="code-status-led" aria-hidden />
                  {lspLabel}
                </span>
              ) : null}
              {/* 줄바꿈 종류 — CRLF 파일을 모르고 고치면 diff 가 전체 줄로 물든다. */}
              <span className="code-status-item">{buf.eol === "\r\n" ? "CRLF" : "LF"}</span>
              <span className="code-status-item">{langLabel(langId)}</span>
              <span className="code-status-item">{formatBytes(fileView.bytes)}</span>
            </span>
          </div>
        </>
      ) : null}

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
    </div>
  );
});

/** 빈 상태 — 화면(모든 탭 닫힘)과 창(파일 미선택)이 공유한다. */
export function CodeEmptyState() {
  useT();
  const keys: Array<[string, string]> = [
    ["⌘K", t("code.empty.kPalette")],
    ["F12", t("code.empty.kDef")],
    ["⇧F12", t("code.empty.kRefs")],
    ["⇧⌥F", t("code.empty.kFormat")],
    ["⌘N", t("code.empty.kNewFile")],
    ["⌘W", t("code.empty.kClose")],
    ["⇧⌘T", t("code.empty.kReopen")],
    ["⌃Tab", t("code.empty.kCycle")],
  ];
  return (
    <div className="code-center-hint code-empty">
      <FileCode size={32} strokeWidth={1.5} className="code-empty-ico" />
      <div className="code-empty-title">{t("code.empty.title")}</div>
      <p className="code-empty-desc">{t("code.empty.desc")}</p>
      {/* 단축키 표 — 빈 화면이 곧 치트시트다 (VS Code 와 같은 관례). */}
      <div className="code-empty-keys">
        {keys.map(([combo, label]) => (
          <span key={combo} className="code-empty-key">
            <kbd>{combo}</kbd>
            <span>{label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
