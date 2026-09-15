// 편집 창(pane) 하나 — 탭 바 + 편집기 + 상태줄. 분할하면 이것이 둘 뜬다.
//
// 왜 화면에서 떼어냈나: 좌우 분할은 "에디터를 두 번 그리는 것" 이 아니라
// **편집 상태를 두 벌 갖는 것**이다 (버퍼·커서·충돌·LSP 수명이 창마다 따로다).
// 화면이 그걸 배열로 들고 있으면 모든 상태가 인덱스로 갈라져 읽을 수 없게 된다.
// 창을 컴포넌트로 두면 React 가 그 갈래를 대신 들어 준다.
//
// 창이 소유하는 것: 활성 파일의 버퍼·저장·충돌·커서·LSP·watcher 반응.
// 부모가 소유하는 것: 탭 목록 자체(어떤 파일이 어느 창에 열렸는가)·트리·파일 조작.
//
// 책임별로 `codePane/` 에 나눠 두었다 — 거터·비교 모드·LSP 동작·버퍼 쓰기·저장
// 경로·외부 변경은 훅으로, 배너·팝오버·다이얼로그는 하위 컴포넌트로. 여기는
// 창의 공유 상태(버퍼 ref·커서·충돌·epoch)와 파일 로드, 그리고 조립만 남았다.
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import { commands, type FileJournalEntry, type LspSymbol } from "@/lib/bindings";
import { useSettings } from "@/contexts/SettingsContext";
import { clampStickyMax } from "@/lib/settings";
import { toast } from "@/lib/toast";
import { t, useT } from "@/i18n";
import { tError } from "@/i18n/errors";

import { CodeEditor } from "./CodeEditor";
import { useProblems } from "./problemsStore";
import { groupByFile, totalCounts } from "./problemsModel";
import { CodePreview } from "./CodePreview";
import { SvgPreview } from "./SvgPreview";
import type { ReferencesQuery } from "./CodeReferences";
import { CodeTabsBar } from "./CodeTabsBar";
import { CodeCrumbs } from "./CodeCrumbs";
import { CodeStatusBar } from "./CodeStatusBar";
import { previewKindFor } from "./previewKind";
import { CodeHistory } from "./CodeHistory";
import { useFileHistory } from "./useFileHistory";
import { useConfirm } from "@/hooks/useConfirm";
import { useLsp } from "./useLsp";
import { langIdForPath, langLabel } from "./codeLang";
import { useCodeAi } from "./inlineEdit/useCodeAi";
import { useCodeFormat } from "./useCodeFormat";
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
  type CodeBuffer,
} from "./codeBuffers";
import type { FileView, PendingJump } from "./codePane/types";
import { lspLabelFor } from "./codePane/lspLabel";
import { useGitGutter } from "./codePane/useGitGutter";
import { useDiffModes } from "./codePane/useDiffModes";
import { useLspActions } from "./codePane/useLspActions";
import { useBufferEdits } from "./codePane/useBufferEdits";
import { useSaveFlow } from "./codePane/useSaveFlow";
import { useExternalChanges } from "./codePane/useExternalChanges";
import { CodeEmptyState } from "./codePane/CodeEmptyState";
import { CrumbActions } from "./codePane/CrumbActions";
import { JournalEntriesPop } from "./codePane/JournalEntriesPop";
import { ConflictBanner, DiffBanner } from "./codePane/PaneBanners";
import { UnopenableHint } from "./codePane/UnopenableHint";
import { CodeActionsDialog, RenameDialog } from "./codePane/LspDialogs";

// 빈 상태는 화면(`CodeScreenV2`)도 쓴다 — import 경로를 지키려고 여기서 재수출한다.
export { CodeEmptyState };

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
  /** 스티키가 쓸 문서 심볼 (아웃라인과 **같은 값**). `null` 이면 Monaco 가
   *  들여쓰기로 떨어진다 — 언어 서버가 없는 파일도 맥락은 보여야 한다. */
  stickySymbols: LspSymbol[] | null;
  /** ⇧⌘O — 파일 안에서 이동. 편집기가 그 키를 먹으므로 여기로 되돌린다. */
  onGoToSymbol: () => void;
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
  /** 상태줄의 커서 조각 클릭 — ⌃G 와 같은 줄 이동 위젯. */
  onGoToLine: () => void;
  /** 줄바꿈 (화면 상태 `codeWordWrap` 을 이 파일 종류로 푼 값) + 뒤집기. */
  wordWrap: boolean;
  onToggleWordWrap: () => void;
  /** git 상태 · 진단 표식 — 탭 이름 색 (트리와 같은 규칙, `gitDecor`). */
  gitMarks: ReadonlyMap<string, "A" | "M" | "D">;
  problemMarks: ReadonlyMap<string, "error" | "warning">;
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
    onGoToSymbol,
    onOpenProblems,
    breakpointsFor,
    unverifiedFor,
    onToggleBreakpoint,
    onRevealDir,
    onGoToLine,
    wordWrap,
    onToggleWordWrap,
    gitMarks,
    problemMarks,
  },
  ref,
) {
  useT();
  const { settings } = useSettings();

  // 스티키 스크롤 — 꺼져 있으면 0 이고, 0 이면 CodeEditor 가 아예 안 켠다.
  const stickyMax = settings.codeStickyScroll ? clampStickyMax(settings.codeStickyMaxLines) : 0;

  // ⌘K 인라인 편집 — 모델 호출과 귀속은 이 훅이 든다 (#agent-cmdk).
  const codeAi = useCodeAi({ projectId, settings, activePath });
  // 저장 콜백들은 마운트 시 묶여 최신 클로저를 못 본다 — 다른 콜백들과 같은 ref 규약.
  const codeAiRef = useRef(codeAi);
  codeAiRef.current = codeAi;

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
  const [selection, setSelection] = useState<{ lines: number; chars: number } | null>(null);
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
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
  // 타자 경로(handleChange)는 ref 로 읽는다 — state 를 의존성에 넣으면 타자마다 새 콜백이다.
  const svgOpenRef = useRef(false);
  svgOpenRef.current = svgOpen;
  const svgTimerRef = useRef<number | null>(null);
  // 자동 저장의 타자 트리거 — 훅이 저장 경로보다 아래에서 만들어지므로 ref 로 잇는다.
  const onEditRef = useRef<() => void>(() => {});
  // 이 파일을 files_touched 로 만진 일지들 — 브레드크럼의 일지 칩.
  const [fileEntries, setFileEntries] = useState<FileJournalEntry[]>([]);
  const [entriesOpen, setEntriesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const { confirm, confirmDialog } = useConfirm();
  // 로컬 히스토리 — 캡처는 워처가 한다. 여기는 목록을 읽고 지우기만 한다.
  // 훅이 돌려주는 함수 셋은 신원이 안정적이라 그대로 의존성에 넣는다 (객체째
  // 넣으면 매 렌더가 새 객체라 워처 구독이 렌더마다 다시 걸린다).
  const {
    versions: historyVersions,
    refresh: refreshHistory,
    refreshSoon: refreshHistorySoon,
    forget: forgetVersions,
  } = useFileHistory(projectId, activePath, settings.codeLocalHistory);
  const [pendingJump, setPendingJump] = useState<PendingJump | null>(null);

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

  // putBuffer 가 dirty 버퍼를 밀어냈으면(상한 초과) 조용한 유실 대신 알린다.
  const notifyIfEvicted = useCallback((evictedKey: string | null) => {
    if (!evictedKey) return;
    const path = evictedKey.slice(evictedKey.indexOf(":") + 1);
    toast.warning(t("code.bufferEvicted", { path }));
  }, []);

  // ── git 거터 (#git-gutter) ─────────────────────────────────────────────
  const { gitChanges, setGitChanges, refreshGutter } = useGitGutter(projectId, pathRef);

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

  // ── 인라인 비교 (Cursor 식) ─────────────────────────────────────────────
  const {
    diffMode,
    setDiffMode,
    diffOriginal,
    setDiffOriginal,
    enterHeadDiff,
    enterEntryDiff,
    enterHistoryDiff,
    restoreVersion,
    forgetHistory,
    exitDiff,
    openJournal,
  } = useDiffModes({
    projectId,
    pathRef,
    bufferRef,
    cursorRef,
    setPendingJump,
    setEditorEpoch,
    setConflict,
    setHistoryOpen,
    loadFile,
    confirm,
    refreshHistory,
    refreshHistorySoon,
    forgetVersions,
  });

  useEffect(() => {
    setDiffMode(null);
    setDiffOriginal(null);
    setEntriesOpen(false);
    setHistoryOpen(false);
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
  }, [activePath, loadFile, projectId, setDiffMode, setDiffOriginal, setGitChanges]);

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

  // 부모가 지시한 줄 점프. 같은 파일·같은 줄의 연속 점프도 다시 돌도록 nonce 로 건다.
  useEffect(() => {
    if (jump) setPendingJump({ line: jump.line, ch: jump.ch, len: jump.len, focus: jump.focus });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump?.nonce]);

  // ── 언어 서버 동작 (F12 · F2 · ⌘. · ⇧F12) ──────────────────────────────
  const {
    goToDefinition,
    renameAt,
    setRenameAt,
    renameName,
    setRenameName,
    renaming,
    renameInputRef,
    startRename,
    submitRename,
    actions,
    setActions,
    actionsBusy,
    openCodeActions,
    runCodeAction,
    findReferences,
  } = useLspActions({
    projectId,
    lsp,
    dirtyPaths,
    pathRef,
    setPendingJump,
    setEditorEpoch,
    loadFile,
    onOpenPath,
    onReferences,
  });

  // ── 편집·저장 ──────────────────────────────────────────────────────────
  const { handleChange, replaceBufferText, applySaved } = useBufferEdits({
    projectId,
    dirtyPaths,
    onBuffersChanged,
    onPinTab,
    lsp,
    refreshGutter,
    bufferRef,
    pathRef,
    cursorRef,
    setDirty,
    setConflict,
    setPendingJump,
    setEditorEpoch,
    onEditRef,
    svgOpenRef,
    svgTimerRef,
    setSvgText,
  });

  // ⇧⌥F 포맷팅 — 훅이 든다 (`useCodeFormat.ts` 에 왜 여기가 아닌지 적었다).
  // 호출은 전부 `formatRef` 를 지난다 — 저장 타이머와 편집기 액션이 마운트
  // 시점의 클로저를 들고 있어서다.
  const { ref: formatRef } = useCodeFormat({
    format: lsp.format,
    tabSize: settings.codeTabSize,
    insertSpaces: settings.codeInsertSpaces,
    currentText: useCallback(() => bufferRef.current?.text ?? null, []),
    replaceBufferText,
  });

  // ── 저장 위생 · ⌘S · 자동 저장 · 충돌 해소 ─────────────────────────────
  const { saving, saveRef, autoSave, autoSaveOn, reloadFromDisk, overwriteDisk } = useSaveFlow({
    projectId,
    settings,
    activePath,
    isFocused,
    formatRef,
    replaceBufferText,
    applySaved,
    loadFile,
    onBuffersChanged,
    bufferRef,
    pathRef,
    cursorRef,
    codeAiRef,
    conflict,
    setConflict,
    diffMode,
    fileView,
    onEditRef,
  });

  const externalRef = useRef<() => void>(() => {});
  useImperativeHandle(
    ref,
    () => ({
      save: () => void saveRef.current(),
      openExternal: () => externalRef.current(),
      format: () => void formatRef.current(),
    }),
    [formatRef, saveRef],
  );

  // ── 열린 파일의 외부 변경 감지 (watcher) ───────────────────────────────
  useExternalChanges({
    projectId,
    pathRef,
    bufferRef,
    cursorRef,
    refreshHistorySoon,
    setPreviewEpoch,
    setPendingJump,
    setEditorEpoch,
    setConflict,
  });

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

  // 서버 상태를 한 낱말로 (`codePane/lspLabel.ts`).
  const lspLabel = useMemo((): string | null => lspLabelFor(lsp.status.state), [lsp.status.state]);

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
        gitMarks={gitMarks}
        problemMarks={problemMarks}
      />

      {/* 브레드크럼 — 폴더 › 파일 › 커서가 든 심볼 (`CodeCrumbs`). 오른쪽 액션은
          창의 상태(일지·판·svg·HEAD 비교)라 여기서 만들어 넣는다. */}
      {activePath ? (
        <CodeCrumbs
          path={activePath}
          symbols={stickySymbols}
          cursorLine={cursor.line}
          onRevealDir={onRevealDir}
          onJumpToSymbol={(line, character) => setPendingJump({ line, ch: character })}
          actions={
            <CrumbActions
              activePath={activePath}
              editorShown={fileView.kind === "editor"}
              entriesCount={fileEntries.length}
              entriesOpen={entriesOpen}
              setEntriesOpen={setEntriesOpen}
              historyCount={historyVersions.length}
              historyOpen={historyOpen}
              setHistoryOpen={setHistoryOpen}
              refreshHistory={refreshHistory}
              svgOpen={svgOpen}
              setSvgOpen={setSvgOpen}
              diffMode={diffMode}
              exitDiff={exitDiff}
              enterHeadDiff={enterHeadDiff}
            />
          }
        />
      ) : null}

      {/* 일지 팝오버 — 항목 클릭은 일지 화면으로, diff 버튼은 인라인 비교로. */}
      {entriesOpen ? (
        <JournalEntriesPop
          entries={fileEntries}
          setEntriesOpen={setEntriesOpen}
          openJournal={openJournal}
          enterEntryDiff={enterEntryDiff}
        />
      ) : null}

      {historyOpen ? (
        <CodeHistory
          versions={historyVersions}
          onPick={(v) => {
            setHistoryOpen(false);
            void enterHistoryDiff(v);
          }}
          onForget={() => void forgetHistory()}
        />
      ) : null}

      {/* 비교 모드 배너 — 지금 무엇과 비교 중인지, 나가는 길. */}
      {diffMode ? (
        <DiffBanner
          diffMode={diffMode}
          openJournal={openJournal}
          restoreVersion={restoreVersion}
          exitDiff={exitDiff}
        />
      ) : null}

      {conflict ? (
        <ConflictBanner reloadFromDisk={reloadFromDisk} overwriteDisk={overwriteDisk} saving={saving} />
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
        <UnopenableHint
          kind={fileView.kind}
          bytes={fileView.bytes}
          projectRoot={projectRoot}
          openExternal={openExternal}
        />
      ) : buf ? (
        <>
          <div
            className={"code-editor-wrap" + (svgOpen ? " with-svg" : "")}
            onBlur={autoSave.onEditorBlur}
          >
            <CodeEditor
              // 스티키 설정이 key 에 있는 이유: 편집기 배선은 마운트 시점에
              // 정해지므로 켜고 끈 것이 그 자리에서 보이려면 재마운트해야 한다.
              // 본문은 버퍼가 들고 있어 미저장 편집은 살아남는다 (실행 취소
              // 이력만 잃는다 — 파일을 바꿀 때와 같은 대가).
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
              // 서버가 안 붙은 창에는 공급자를 아예 안 단다 (CodeEditor 가 prop
              // 유무로 판단하므로 undefined 여야 한다).
              onSignatureHelp={lspEnabled ? lsp.signatureHelp : undefined}
              // 시맨틱 강조 — 서버 문서를 **먼저 맞춘 뒤** 묻는다. 편집은
              // 디바운스로 밀려 들어가는데 Monaco 는 타자 직후에 토큰을
              // 물어서, 안 맞추면 옛 문서 좌표로 칠해져 색이 한 칸씩 밀린다
              // (포맷팅이 flushText 를 먼저 부르는 것과 같은 이유).
              onSemanticLegend={lspEnabled ? lsp.semanticLegend : undefined}
              onSemanticTokens={
                lspEnabled
                  ? async () => {
                      await lsp.flushText(bufferRef.current?.text ?? "");
                      return lsp.semanticTokens();
                    }
                  : undefined
              }
              stickyMaxLines={stickyMax}
              stickySymbols={stickySymbols}
              onGoToSymbol={onGoToSymbol}
              tabSize={settings.codeTabSize}
              insertSpaces={settings.codeInsertSpaces}
              minimap={settings.codeMinimap}
              onInlineEdit={codeAi.run}
              onInlineEditAccepted={(info) => codeAi.onAccepted(activePath, info)}
              onSave={() => void saveRef.current()}
              onCursor={(line, col, sel) => {
                setCursor({ line, col });
                setSelection(sel ?? null);
                onCursorLine(line);
              }}
              wordWrap={wordWrap}
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
          <CodeStatusBar
            dirty={dirty}
            saving={saving}
            autoSaveOn={autoSaveOn}
            cursor={cursor}
            selection={selection}
            problemTotals={problemTotals}
            lspState={lsp.status.state ?? null}
            lspLabel={lspLabel}
            lspDetail={lsp.status.detail ?? null}
            eolLabel={buf.eol === "\r\n" ? "CRLF" : "LF"}
            langLabel={langLabel(langId)}
            bytesLabel={formatBytes(fileView.bytes)}
            wordWrap={wordWrap}
            aiChip={codeAi.chip}
            onGoToLine={onGoToLine}
            onToggleWordWrap={onToggleWordWrap}
            onOpenProblems={onOpenProblems}
          />
        </>
      ) : null}

      <RenameDialog
        renameAt={renameAt}
        setRenameAt={setRenameAt}
        renameName={renameName}
        setRenameName={setRenameName}
        renaming={renaming}
        submitRename={submitRename}
        renameInputRef={renameInputRef}
      />

      <CodeActionsDialog
        actions={actions}
        setActions={setActions}
        actionsBusy={actionsBusy}
        runCodeAction={runCodeAction}
      />

      {confirmDialog}
    </div>
  );
});
