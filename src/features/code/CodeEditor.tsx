// Monaco 마운트 래퍼. 마운트 후엔 **언컨트롤드**다 — 부모는 초깃값만 주고,
// 외부 갱신(디스크 리로드·파일 전환)은 key 재마운트로 처리한다. 양방향 동기화는
// 편집기 모델과 React 상태가 서로를 되돌리는 고전적 버그의 근원이라 의도적으로
// 피한다. **이 규약은 CodeMirror 판에서 그대로 가져왔다** — 편집기를 바꿔도
// 병리는 같기 때문이다.
//
// `CodeEditorProps` 는 이관(Phase 1) 때 **한 줄도 바뀌지 않았다** (D2). 그래서
// CodePane 위쪽이 무변경이었고 기존 코드 화면 테스트가 그대로 판정자였다.
// Phase 2 에서 `onGoToSymbol` 하나가 늘었다 — 스티키를 내장으로 넘기며 생긴
// 키 충돌을 되돌리는 자리다(아래 prop 주석). 그 외의 계약은 그대로다.
import { useEffect, useRef } from "react";

import type * as MonacoNs from "monaco-editor/editor/editor.api";
import monaco from "./monaco/setup";
import { defineCodeTheme, isDarkTheme, readCodeTokens, THEME_NAME, watchThemeChanges } from "./monaco/theme";
import {
  registerLspProviders,
  selectionRange,
  toLspPosition,
  toMarkers,
  wordAt,
  type LspHandlers,
} from "./monaco/lsp";
import { breakpointDecorations, gitDecorations, wireBreakpointClicks } from "./monaco/decorations";
import { registerSymbolProvider } from "./monaco/symbols";
import { baseEditorOptions, diffEditorOptions } from "./monaco/options";
import { monacoLangForPath } from "./codeLang";
import { hasLanguageServer } from "./lspBridge";
import type {
  LspCompletionItem,
  LspDiagnostic,
  LspHover,
  LspSignatureHelp,
  LspSymbol,
  GitLineChange,
} from "@/lib/bindings";
import { t } from "@/i18n";

/** ⇧⌥F 선택 범위 — 0-based UTF-16 (다른 LSP 좌표와 같은 규약). */
export interface FormatRange {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

interface CodeEditorProps {
  /** 마운트 시점의 문서 텍스트 (이후엔 언컨트롤드 — 재마운트는 부모의 key). */
  initialText: string;
  /** 언어 선택용 상대 경로. */
  path: string;
  onChange: (text: string) => void;
  /** ⌘S. 편집기가 포커스를 쥔 동안의 저장 경로 (화면 레벨 리스너와 이중). */
  onSave: () => void;
  onCursor?: (line: number, col: number) => void;
  /**
   * 1-based 라인 점프 (one-shot) — 소비 후 onJumpConsumed 를 부른다.
   * `ch`/`len` (UTF-16, 0-based) 이 있으면 그 범위를 선택한다 — 전역 검색이
   * 매치 자리를 하이라이트하는 창구. 매번 새 객체라 같은 줄 재점프도 발화한다.
   */
  /** `focus: false` 면 스크롤·선택만 하고 **포커스는 두고 온다** — 파일 안
   *  이동(⇧⌘O)의 미리 점프가 자기 입력창을 빼앗기지 않으려고 쓴다. */
  jump?: { line: number; ch?: number; len?: number; focus?: boolean } | null;
  onJumpConsumed?: () => void;
  /** 언어 서버가 준 진단. 바뀔 때마다 마커로 반영한다 (재구성 없음). */
  diagnostics?: readonly LspDiagnostic[];
  /** 커서 위치의 완성 후보. 없으면 자동완성을 아예 안 단다. */
  onComplete?: (line: number, character: number) => Promise<LspCompletionItem[]>;
  /** 커서를 올린 자리의 타입·문서. */
  onHover?: (line: number, character: number) => Promise<LspHover | null>;
  /** F12 · ⌘클릭 — 정의로 이동. 이동 자체는 부모(코드 화면)가 한다. */
  onGoToDefinition?: (line: number, character: number) => void;
  /** F2 — 이름 바꾸기. `word` 는 커서가 놓인 식별자(입력창 초깃값). */
  onRename?: (line: number, character: number, word: string) => void;
  /** ⌘. — 코드 액션. 선택이 있으면 그 범위, 없으면 커서 자리. */
  onCodeActions?: (
    startLine: number,
    startCharacter: number,
    endLine: number,
    endCharacter: number,
  ) => void;
  /** ⇧F12 — 참조 찾기. `word` 는 커서가 놓인 식별자(패널 제목). */
  onReferences?: (line: number, character: number, word: string) => void;
  /** ⇧⌥F — 포맷팅. 선택이 있으면 그 범위만 (`rangeFormatting`). 문서 치환도
   *  부모가 한다 (버퍼·dirty 계산이 거기 있다). */
  onFormat?: (range?: FormatRange) => void;
  /** 인자 입력 중의 시그니처. 없으면 확장을 아예 안 단다. */
  onSignatureHelp?: (line: number, character: number) => Promise<LspSignatureHelp | null>;
  /**
   * 스티키 스크롤에 겹쳐 고정할 줄 수. `0`(기본)이면 확장을 아예 안 단다.
   * 설정을 켜고 끄면 부모가 key 로 재마운트한다 (다른 확장들과 같은 규약).
   */
  stickyMaxLines?: number;
  /** 스티키가 쓸 문서 심볼. `null` 이면 들여쓰기 폴백으로 그린다. */
  stickySymbols?: LspSymbol[] | null;
  /**
   * ⇧⌘O — 파일 안에서 이동. **실행은 부모(CodeScreenV2 의 `CodeGoto`)** 다.
   *
   * 이 prop 이 필요한 이유는 스티키 때문이다. 심볼 공급자를 달면 Monaco 의
   * 내장 `quickOutline`(같은 키)이 켜져 우리 이동창을 가린다 — 그쪽은
   * `hasDocumentSymbolProvider` 를 전제로만 걸리는 키라 "스티키를 켜면
   * ⇧⌘O 가 다른 창을 연다" 는 들쭉날쭉함이 생긴다. 같은 키에 우리 액션을
   * 얹어(동적 키바인딩이 기여 액션보다 무겁다) 항상 부모로 되돌린다.
   */
  onGoToSymbol?: () => void;
  /** 탭 폭 (설정 `codeTabSize`). 저장 시 포맷이 쓰는 값과 **같아야** 한다. */
  tabSize?: number;
  /** Tab 키가 공백을 넣는가 (설정 `codeInsertSpaces`). 위와 같은 이유로 함께 온다. */
  insertSpaces?: boolean;
  /** 미니맵을 그리는가 (설정 `codeMinimap`). 좁은 분할에서 폭을 먹어 끌 수 있다. */
  minimap?: boolean;
  /** HEAD 대비 줄 변경 (거터). LSP 와 무관하므로 모든 파일에 단다. */
  gitChanges?: readonly GitLineChange[];
  /**
   * 인라인 비교 원본 (Cursor 식 diff-in-editor). null 이 아니면 이 텍스트와의
   * 차이를 본문 안에 그린다 — 지워진 줄은 빨간 블록으로 끼어들고, 청크마다
   * 되돌리기 버튼이 붙는다. **마운트 시점에만** 읽는다 (모드 전환 = 재마운트).
   */
  diffOriginal?: string | null;
  /** 이 파일의 중단점 줄들 (**1-based** — DAP·편집기 공통 규약). */
  breakpoints?: readonly number[];
  /** 어댑터가 못 건다고 답한 줄들 — 다르게 그린다. */
  unverifiedBreakpoints?: readonly number[];
  /** 거터를 눌렀다. 없으면 중단점 거터를 아예 안 단다 (디버그 불가 언어). */
  onToggleBreakpoint?: (line: number) => void;
}

export function CodeEditor({
  initialText,
  path,
  onChange,
  onSave,
  onCursor,
  jump = null,
  onJumpConsumed,
  diagnostics,
  onComplete,
  onHover,
  onGoToDefinition,
  onRename,
  onCodeActions,
  onReferences,
  onFormat,
  onSignatureHelp,
  stickyMaxLines = 0,
  stickySymbols = null,
  onGoToSymbol,
  tabSize = 2,
  insertSpaces = true,
  minimap = true,
  gitChanges,
  diffOriginal,
  breakpoints,
  unverifiedBreakpoints,
  onToggleBreakpoint,
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MonacoNs.editor.IStandaloneCodeEditor | null>(null);
  // git 과 중단점은 **따로** 모아 둔다 — 한 컬렉션이면 한쪽 갱신이 다른 쪽을 지운다.
  const gitDecoRef = useRef<MonacoNs.editor.IEditorDecorationsCollection | null>(null);
  const bpDecoRef = useRef<MonacoNs.editor.IEditorDecorationsCollection | null>(null);

  // 콜백은 ref 로 — 편집기 배선은 마운트 시 1회 구성되므로 최신 클로저를 참조한다.
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onCursorRef = useRef(onCursor);
  const onJumpConsumedRef = useRef(onJumpConsumed);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  onCursorRef.current = onCursor;
  onJumpConsumedRef.current = onJumpConsumed;
  const onGoToDefRef = useRef(onGoToDefinition);
  onGoToDefRef.current = onGoToDefinition;
  const onRenameRef = useRef(onRename);
  onRenameRef.current = onRename;
  const onCodeActionsRef = useRef(onCodeActions);
  onCodeActionsRef.current = onCodeActions;
  const onReferencesRef = useRef(onReferences);
  onReferencesRef.current = onReferences;
  const onFormatRef = useRef(onFormat);
  onFormatRef.current = onFormat;
  const onToggleBpRef = useRef(onToggleBreakpoint);
  onToggleBpRef.current = onToggleBreakpoint;
  const onGoToSymbolRef = useRef(onGoToSymbol);
  onGoToSymbolRef.current = onGoToSymbol;
  // 심볼 공급자는 등록/해제로만 다시 물어보게 되므로 값 자체도 ref 로 든다.
  const stickySymbolsRef = useRef<readonly LspSymbol[] | null>(stickySymbols);
  stickySymbolsRef.current = stickySymbols;
  // LSP 공급자 셋은 한 ref 로 묶는다 — 등록은 1회, 호출 때 최신 것을 읽는다.
  const lspRef = useRef<LspHandlers>({ onComplete, onHover, onSignatureHelp });
  lspRef.current = { onComplete, onHover, onSignatureHelp };

  // 무엇을 달지는 **마운트 시점**에 정한다 (CodeMirror 판과 같은 규칙) — 도중에
  // 켜고 끄면 재구성이 필요하고, 그러면 커서가 튄다. 파일마다 재마운트되므로
  // 그 파일의 사정과 일치한다.
  const hasBreakpointsRef = useRef(onToggleBreakpoint != null);
  const diffOriginalRef = useRef(diffOriginal);
  const hasLspRef = useRef(onComplete != null && hasLanguageServer(path));
  const stickyMaxRef = useRef(stickyMaxLines);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const languageId = monacoLangForPath(path);
    // 테마는 편집기를 만들기 **전에** 정의해야 첫 프레임부터 제 색으로 그린다.
    defineCodeTheme(monaco, readCodeTokens(host), isDarkTheme());

    const options = baseEditorOptions({
      theme: THEME_NAME,
      glyphMargin: hasBreakpointsRef.current,
      stickyMaxLines: stickyMaxRef.current,
      tabSize,
      insertSpaces,
      minimap,
    });

    const subs: MonacoNs.IDisposable[] = [];

    // 인라인 비교 — 지워진 줄이 본문 사이에 빨간 블록으로 끼어들고 청크마다
    // 되돌리기가 붙는다. Monaco 는 이것을 별도 위젯이 아니라 **diff 편집기**로
    // 표현하므로, 원본이 있으면 처음부터 diff 편집기로 만들고 그 **수정 쪽**을
    // 이 컴포넌트의 편집기로 삼는다.
    //
    // 평범한 편집기를 만들어 숨기고 diff 를 따로 얹는 방법은 쓰지 않는다 —
    // 그러면 커서 이벤트와 `jump` 가 숨은 편집기로 가서 상태줄이 멈추고
    // 점프가 아무 데도 안 간다. 부모는 모드 전환 때 key 로 재마운트하므로
    // 둘이 동시에 사는 시간은 없다.
    // ref 는 정리 시점에 달라져 있을 수 있으므로 이펙트 안에서 붙잡는다.
    const diffOriginalAtMount = diffOriginalRef.current;
    let editor: MonacoNs.editor.IStandaloneCodeEditor;
    let ownedModels: MonacoNs.editor.ITextModel[] = [];
    if (diffOriginalAtMount != null) {
      const diffEditor = monaco.editor.createDiffEditor(host, diffEditorOptions(options));
      const original = monaco.editor.createModel(diffOriginalAtMount, languageId);
      const modified = monaco.editor.createModel(initialText, languageId);
      diffEditor.setModel({ original, modified });
      ownedModels = [original, modified];
      editor = diffEditor.getModifiedEditor();
      subs.push({ dispose: () => diffEditor.dispose() });
    } else {
      editor = monaco.editor.create(host, {
        ...options,
        value: initialText,
        language: languageId,
      });
      // 여기서는 모델을 **편집기가 소유한다** (`value` 로 만들게 했으므로
      // Monaco 가 `_ownsModel` 로 표시해 두고 `dispose()` 때 함께 푼다).
      // 그래서 `ownedModels` 는 비워 둔다 — 넣으면 두 번 죽인다.
    }

    editorRef.current = editor;
    gitDecoRef.current = editor.createDecorationsCollection([]);
    bpDecoRef.current = editor.createDecorationsCollection([]);

    subs.push(
      editor.onDidChangeModelContent(() => {
        onChangeRef.current(editor.getValue());
      }),
    );
    subs.push(
      editor.onDidChangeCursorPosition((e) => {
        onCursorRef.current?.(e.position.lineNumber, e.position.column);
      }),
    );

    // ⌘S — 편집기가 포커스를 쥔 동안의 저장 경로. Monaco 액션은 기본 동작을
    // 삼키므로 화면 레벨 window 리스너까지 버블돼 저장이 두 번 나가지 않는다.
    subs.push(
      editor.addAction({
        id: "oculpm.save",
        label: t("code.editorAria"),
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
        run: () => {
          onSaveRef.current();
        },
      }),
    );

    // ⇧⌘O — Monaco 의 내장 `quickOutline` 을 가린다. 아래 스티키 이펙트가
    // 심볼 공급자를 다는 순간 그 키가 살아나는데, 이 화면의 "파일 안에서
    // 이동" 은 부모의 `CodeGoto`(미리 점프 + `:줄` 겸용)라 둘이 같은 키를
    // 다투면 안 된다. 동적 키바인딩(weight 1000)이 기여 액션(100)을 이긴다.
    subs.push(
      editor.addAction({
        id: "oculpm.goToSymbol",
        label: t("code.action.goToSymbol"),
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyO],
        run: () => {
          onGoToSymbolRef.current?.();
        },
      }),
    );

    if (hasLspRef.current) {
      // 공급자는 **언어 단위 전역**이라 언마운트 때 반드시 푼다 — 안 풀면
      // 파일을 옮길 때마다 쌓여 완성 후보가 N 벌 뜬다.
      subs.push({ dispose: registerLspProviders(monaco, editor.getModel()!, languageId, lspRef) });

      const at = () => {
        const pos = editor.getPosition()!;
        return { pos, ...toLspPosition(pos) };
      };

      // VS Code 와 같은 키. 실행은 여전히 부모(CodePane)가 한다.
      subs.push(
        editor.addAction({
          id: "oculpm.goToDefinition",
          label: t("code.action.goToDefinition"),
          keybindings: [monaco.KeyCode.F12],
          run: () => {
            const go = onGoToDefRef.current;
            if (!go) return;
            const { line, character } = at();
            go(line, character);
          },
        }),
      );
      subs.push(
        editor.addAction({
          id: "oculpm.references",
          label: t("code.action.references"),
          keybindings: [monaco.KeyMod.Shift | monaco.KeyCode.F12],
          run: () => {
            const ask = onReferencesRef.current;
            if (!ask) return;
            const { pos, line, character } = at();
            ask(line, character, wordAt(editor.getModel()!, pos));
          },
        }),
      );
      subs.push(
        editor.addAction({
          id: "oculpm.rename",
          label: t("code.action.rename"),
          keybindings: [monaco.KeyCode.F2],
          run: () => {
            const rename = onRenameRef.current;
            if (!rename) return;
            const { pos, line, character } = at();
            rename(line, character, wordAt(editor.getModel()!, pos));
          },
        }),
      );
      subs.push(
        editor.addAction({
          id: "oculpm.codeActions",
          label: t("code.action.codeActions"),
          keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Period],
          run: () => {
            const ask = onCodeActionsRef.current;
            if (!ask) return;
            // 선택이 있으면 그 범위로 물어야 "이 블록을 함수로 빼기" 류가 나온다.
            const sel = selectionRange(editor);
            if (sel) ask(sel.startLine, sel.startCharacter, sel.endLine, sel.endCharacter);
            else {
              const { line, character } = at();
              ask(line, character, line, character);
            }
          },
        }),
      );
      subs.push(
        editor.addAction({
          id: "oculpm.format",
          label: t("code.action.format"),
          keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF],
          run: () => {
            const format = onFormatRef.current;
            if (!format) return;
            // 선택이 있으면 그 범위만 — 남의 코드가 섞인 파일에서 전체 포맷은
            // diff 를 통째로 물들인다.
            const sel = selectionRange(editor);
            format(sel ?? undefined);
          },
        }),
      );

      // ⌘클릭 — Monaco 는 수식키 클릭을 자체 "정의로 이동" 링크로 쓰지만 그
      // 경로는 DefinitionProvider 를 요구한다. 우리는 부모가 이동을 하므로
      // 마우스 이벤트를 직접 받는다.
      subs.push(
        editor.onMouseDown((e) => {
          const go = onGoToDefRef.current;
          const ev = e.event;
          if (!go || !(ev.metaKey || ev.ctrlKey)) return;
          const pos = e.target.position;
          if (!pos) return;
          const { line, character } = toLspPosition(pos);
          go(line, character);
          // 이동과 동시에 엉뚱한 곳이 드래그 선택되는 것을 막는다.
          e.event.preventDefault();
          e.event.stopPropagation();
        }),
      );
    }

    if (hasBreakpointsRef.current) {
      subs.push({
        dispose: wireBreakpointClicks(monaco, editor, () => (line) =>
          onToggleBpRef.current?.(line),
        ),
      });
    }

    const stopThemeWatch = watchThemeChanges(() => {
      defineCodeTheme(monaco, readCodeTokens(host), isDarkTheme());
      // 같은 이름으로 다시 정의하면 그 이름을 쓰는 편집기가 즉시 다시 칠해진다.
      monaco.editor.setTheme(THEME_NAME);
    });

    return () => {
      stopThemeWatch();
      for (const s of subs) s.dispose();
      gitDecoRef.current = null;
      bpDecoRef.current = null;
      // diff 모드에서는 diffEditor 가 subs 로 해제된다 — 여기서 편집기를 또
      // dispose 하면 이미 죽은 것을 두 번 죽인다. 그리고 그쪽 모델 둘은
      // 우리가 만들었으므로(diff 편집기는 안 갖는다) 우리가 푼다. 평범한
      // 편집기는 반대로 자기 모델을 스스로 푼다 — 그래서 `ownedModels` 가 비었다.
      if (diffOriginalAtMount == null) editor.dispose();
      for (const m of ownedModels) m.dispose();
      editorRef.current = null;
    };
    // 마운트 1회 — 파일 전환/리로드는 부모가 key 로 재마운트한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 진단 반영 — **재구성이 아니라 마커 교체**다. 편집기를 다시 만들면 실행 취소
  // 이력과 접힘 상태가 날아가는데, 진단은 타자 도중에도 계속 갱신된다.
  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || !hasLspRef.current) return;
    monaco.editor.setModelMarkers(model, "lsp", toMarkers(monaco, model, diagnostics ?? []));
  }, [diagnostics]);

  // 중단점 반영 — 진단과 같은 이유로 데코레이션 교체다.
  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || !hasBreakpointsRef.current) return;
    bpDecoRef.current?.set(
      breakpointDecorations(
        monaco,
        breakpoints ?? [],
        unverifiedBreakpoints ?? [],
        model.getLineCount(),
      ),
    );
  }, [breakpoints, unverifiedBreakpoints]);

  // git 거터 반영 — 편집 도중에도 갱신된다.
  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    gitDecoRef.current?.set(gitDecorations(monaco, gitChanges ?? [], model.getLineCount()));
  }, [gitChanges]);

  // 들여쓰기 — 설정을 바꾸면 열려 있는 편집기에도 바로 먹어야 한다. 재마운트로
  // 하지 않는 이유는 다른 것들과 같다(실행 취소 이력·접힘 상태가 날아간다).
  useEffect(() => {
    editorRef.current?.updateOptions({ tabSize, insertSpaces });
  }, [tabSize, insertSpaces]);

  // 미니맵 — 좁은 분할에서 끄는 값이라 켜고 끈 것이 그 자리에서 보여야 한다.
  useEffect(() => {
    editorRef.current?.updateOptions({ minimap: { enabled: minimap } });
  }, [minimap]);

  // 스티키의 심볼 원천 — 서버가 늦게 답해도 도착하는 대로 갈아탄다.
  //
  // **등록/해제로 갱신하는 것이 핵심이다.** Monaco 는 공급자 목록이 바뀔 때만
  // (`documentSymbolProvider.onDidChange`) 아웃라인을 다시 묻는다. ref 안의
  // 값만 바꾸면 아무도 다시 안 물어 첫 답(보통 `null`)이 그대로 굳는다.
  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    // 스티키를 껐으면 공급자도 달지 않는다 — 지금 이것을 읽는 유일한 소비자다.
    if (!model || stickyMaxRef.current <= 0 || stickySymbols == null) return;
    return registerSymbolProvider(monaco, model, model.getLanguageId(), stickySymbolsRef);
  }, [stickySymbols]);

  // 라인 점프 — 마운트 직후(위 effect 가 먼저 실행돼 editor 가 있다)와 같은
  // 파일에서의 재점프(prop 변화) 둘 다 여기로 온다.
  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || jump == null) return;
    const line = Math.max(1, Math.min(jump.line, model.getLineCount()));
    // ch/len 은 UTF-16 단위 = Monaco 의 열 단위(1-based). 줄 길이로 죄어 파일이
    // 그 사이 바뀌었어도 범위 밖 selection 예외가 나지 않게 한다.
    const maxCol = model.getLineMaxColumn(line);
    const startColumn = Math.min(Math.max((jump.ch ?? 0) + 1, 1), maxCol);
    const endColumn = jump.len ? Math.min(startColumn + jump.len, maxCol) : startColumn;
    editor.setSelection({
      startLineNumber: line,
      startColumn,
      endLineNumber: line,
      endColumn,
    });
    editor.revealLineInCenter(line);
    if (jump.focus !== false) editor.focus();
    onJumpConsumedRef.current?.();
  }, [jump]);

  return <div ref={hostRef} className="code-editor-host" aria-label={t("code.editorAria")} />;
}
