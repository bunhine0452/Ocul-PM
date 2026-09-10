// LSP ↔ Monaco 배선. 좌표 변환의 순수 함수는 `lspBridge.ts` 가 계속 소유하고,
// 여기서는 Monaco 공급자 모양으로 감싸기만 한다.
//
// 좌표계: LSP 는 0-based 줄 + UTF-16 문자, Monaco 는 **1-based 줄 + 1-based 열**
// (열도 UTF-16 코드 유닛이라 인코딩 변환은 없다). 즉 양쪽 다 +1/-1 뿐이다.

import type * as MonacoNs from "monaco-editor/editor/editor.api";
import type { MutableRefObject } from "react";
import type {
  LspCompletionItem,
  LspDiagnostic,
  LspHover,
  LspSignatureHelp,
} from "@/lib/bindings";
import { completionStart, parseHover, wordAtColumn } from "../lspBridge";

type Monaco = typeof MonacoNs;
type Editor = MonacoNs.editor.IStandaloneCodeEditor;
type Model = MonacoNs.editor.ITextModel;

/** Monaco 위치(1-based) → LSP 위치(0-based). */
export function toLspPosition(p: MonacoNs.IPosition): { line: number; character: number } {
  return { line: p.lineNumber - 1, character: p.column - 1 };
}

const SEVERITY_KEY: Record<LspDiagnostic["severity"], "Error" | "Warning" | "Info" | "Hint"> = {
  error: "Error",
  warning: "Warning",
  info: "Info",
  hint: "Hint",
};

/**
 * LSP 진단 → Monaco 마커.
 *
 * 길이 0 범위를 한 글자로 넓히는 규칙은 CodeMirror 판에서 그대로 가져왔다 —
 * 서버는 "이 지점" 을 start==end 로 표현하는데 그리면 밑줄이 0px 라 사라진다.
 * 다만 Monaco 는 `endColumn` 이 줄 끝을 넘어도 알아서 죄므로 문서 길이 계산은
 * 필요 없다.
 */
export function toMarkers(
  monaco: Monaco,
  model: Model,
  items: readonly LspDiagnostic[],
): MonacoNs.editor.IMarkerData[] {
  return items.map((d) => {
    const startLineNumber = Math.min(Math.max(d.start_line + 1, 1), model.getLineCount());
    let endLineNumber = Math.min(Math.max(d.end_line + 1, 1), model.getLineCount());
    const startColumn = Math.max(d.start_character + 1, 1);
    let endColumn = Math.max(d.end_character + 1, 1);
    if (endLineNumber < startLineNumber) endLineNumber = startLineNumber;
    if (endLineNumber === startLineNumber && endColumn <= startColumn) {
      endColumn = startColumn + 1;
    }
    return {
      severity: monaco.MarkerSeverity[SEVERITY_KEY[d.severity] ?? "Warning"],
      message: d.message,
      source: d.source ?? undefined,
      startLineNumber,
      startColumn,
      endLineNumber,
      endColumn,
    };
  });
}

/**
 * 완성 항목 → Monaco 형태.
 *
 * `sortText` 를 배열 순서로 고정하는 뜻은 CodeMirror 판과 같다 — 서버가 문맥으로
 * 이미 정렬했는데 편집기가 알파벳순으로 다시 섞으면 그 지능이 사라진다.
 * Monaco 는 `sortText` 를 문자열로 비교하므로 0 채움 인덱스를 준다.
 */
export function toMonacoCompletions(
  monaco: Monaco,
  items: readonly LspCompletionItem[],
  range: MonacoNs.IRange,
): MonacoNs.languages.CompletionItem[] {
  const Kind = monaco.languages.CompletionItemKind;
  return items.map((item, i) => ({
    label: item.label,
    detail: item.detail ?? undefined,
    kind: kindOf(Kind, item.kind),
    insertText: item.insert_text ?? item.label,
    sortText: String(i).padStart(5, "0"),
    range,
  }));
}

/** LSP 종류 문자열 → Monaco 아이콘. 모르는 값은 텍스트로 떨어뜨린다. */
function kindOf(
  Kind: typeof MonacoNs.languages.CompletionItemKind,
  kind: string | null | undefined,
): MonacoNs.languages.CompletionItemKind {
  switch ((kind ?? "").toLowerCase()) {
    case "method":
      return Kind.Method;
    case "function":
      return Kind.Function;
    case "constructor":
      return Kind.Constructor;
    case "field":
      return Kind.Field;
    case "variable":
      return Kind.Variable;
    case "class":
      return Kind.Class;
    case "interface":
      return Kind.Interface;
    case "module":
      return Kind.Module;
    case "property":
      return Kind.Property;
    case "enum":
      return Kind.Enum;
    case "keyword":
      return Kind.Keyword;
    case "snippet":
      return Kind.Snippet;
    case "type":
    case "typeparameter":
      return Kind.TypeParameter;
    case "constant":
      return Kind.Constant;
    case "struct":
      return Kind.Struct;
    default:
      return Kind.Text;
  }
}

export interface LspHandlers {
  onComplete?: (line: number, character: number) => Promise<LspCompletionItem[]>;
  onHover?: (line: number, character: number) => Promise<LspHover | null>;
  onSignatureHelp?: (line: number, character: number) => Promise<LspSignatureHelp | null>;
}

/**
 * 이 모델 하나에만 붙는 공급자들을 등록한다.
 *
 * Monaco 의 공급자는 **언어 단위 전역**이라 그냥 등록하면 같은 언어의 다른
 * 편집기(논의 화면 등)에도 걸린다. 그래서 모든 공급자가 `model.uri` 를 대조해
 * 자기 모델이 아니면 즉시 빠진다.
 *
 * 반환값은 해제 함수 — 언마운트 때 반드시 부른다. 안 부르면 파일을 옮길 때마다
 * 공급자가 쌓여 완성 후보가 N 벌 뜬다.
 */
export function registerLspProviders(
  monaco: Monaco,
  model: Model,
  languageId: string,
  handlers: MutableRefObject<LspHandlers>,
): () => void {
  const mine = (m: Model) => m.uri.toString() === model.uri.toString();
  const disposables: MonacoNs.IDisposable[] = [];

  disposables.push(
    monaco.languages.registerCompletionItemProvider(languageId, {
      // `.` `::` `->` 뒤에서도 열려야 멤버 완성이 산다 — CodeMirror 판의
      // completionStart() 가 같은 판단을 했고, 그 함수를 그대로 쓴다.
      triggerCharacters: [".", ":", ">", "/", '"'],
      async provideCompletionItems(m, position, context) {
        if (!mine(m)) return { suggestions: [] };
        const ask = handlers.current.onComplete;
        if (!ask) return { suggestions: [] };
        const lineText = m.getLineContent(position.lineNumber).slice(0, position.column - 1);
        const explicit =
          context.triggerKind === monaco.languages.CompletionTriggerKind.Invoke;
        const start = completionStart(lineText, explicit);
        if (start == null) return { suggestions: [] };

        const { line, character } = toLspPosition(position);
        const items = await ask(line, character);
        if (items.length === 0) return { suggestions: [] };
        const range: MonacoNs.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: start + 1,
          endColumn: position.column,
        };
        return {
          suggestions: toMonacoCompletions(monaco, items, range),
          // 서버가 문맥으로 고른 목록이라 Monaco 가 접두사로 다시 거르면
          // `.` 직후처럼 접두사가 빈 자리에서 후보가 통째로 사라진다.
          incomplete: true,
        };
      },
    }),
  );

  disposables.push(
    monaco.languages.registerHoverProvider(languageId, {
      async provideHover(m, position) {
        if (!mine(m)) return null;
        const ask = handlers.current.onHover;
        if (!ask) return null;
        const { line, character } = toLspPosition(position);
        const result = await ask(line, character);
        if (!result) return null;
        const segments = parseHover(result.contents);
        if (segments.length === 0) return null;
        // Monaco 는 호버를 마크다운으로 받는다 — 코드 조각은 펜스로 되돌린다.
        return {
          contents: segments.map((seg) =>
            seg.kind === "code"
              ? { value: "```" + (seg.lang ?? "") + "\n" + seg.text + "\n```" }
              : { value: seg.text },
          ),
        };
      },
    }),
  );

  disposables.push(
    monaco.languages.registerSignatureHelpProvider(languageId, {
      signatureHelpTriggerCharacters: ["(", ","],
      signatureHelpRetriggerCharacters: [","],
      async provideSignatureHelp(m, position) {
        if (!mine(m)) return null;
        const ask = handlers.current.onSignatureHelp;
        if (!ask) return null;
        const { line, character } = toLspPosition(position);
        const help = await ask(line, character);
        if (!help || help.signatures.length === 0) return null;
        return {
          value: {
            signatures: help.signatures.map((s) => ({
              label: s.label,
              documentation: s.documentation ?? undefined,
              // LspParamSpan 은 label 안의 UTF-16 오프셋 [start, end) 이고,
              // Monaco 의 파라미터 라벨도 같은 튜플 형태를 받는다 — 문자열로
              // 자르지 않고 그대로 넘겨야 강조 위치가 정확하다.
              parameters: s.parameters.map((p) => ({ label: [p.start, p.end] as [number, number] })),
            })),
            activeSignature: help.active_signature,
            activeParameter: help.active_parameter,
          },
          dispose: () => {},
        };
      },
    }),
  );

  return () => {
    for (const d of disposables) d.dispose();
  };
}

/**
 * 시맨틱 토큰 공급자 — 서버가 아는 의미로 문법 강조를 덮는다.
 *
 * **legend 를 인자로 받는 것이 이 함수의 계약이다.** Monaco 는 공급자마다
 * `getLegend()` 를 **딱 한 번** 부르고 그 결과를 WeakMap 에 캐시한다
 * (`semanticTokensStylingService`). 그래서 빈 표로 등록해 두고 나중에 채우는
 * 방식은 통하지 않는다 — 그 편집기는 끝까지 무채색으로 남는다. 표를 손에 쥔
 * 뒤에 등록하는 것이 유일하게 되는 순서다.
 *
 * 다른 공급자들과 같은 이유로 `model.uri` 를 대조한다: Monaco 의 공급자는
 * 언어 단위 전역이라 같은 언어의 다른 편집기(논의 화면)에도 걸린다.
 */
export function registerSemanticTokens(
  monaco: Monaco,
  model: Model,
  languageId: string,
  legend: { tokenTypes: string[]; tokenModifiers: string[] },
  ask: () => Promise<number[]>,
): () => void {
  const mine = (m: Model) => m.uri.toString() === model.uri.toString();
  const sub = monaco.languages.registerDocumentSemanticTokensProvider(languageId, {
    getLegend: () => legend,
    async provideDocumentSemanticTokens(m) {
      if (!mine(m)) return null;
      const data = await ask();
      if (data.length === 0) return null;
      return { data: new Uint32Array(data) };
    },
    // 델타를 안 쓰므로 서버에 놓아 줄 `resultId` 도 없다.
    releaseDocumentSemanticTokens() {},
  });
  return () => sub.dispose();
}

/** F2·⇧F12 가 입력창·패널 제목에 채울 식별자. */
export function wordAt(model: Model, position: MonacoNs.IPosition): string {
  return wordAtColumn(model.getLineContent(position.lineNumber), position.column - 1);
}

/** 편집기의 현재 선택을 LSP 범위로. 선택이 없으면 `null`(= 커서 자리). */
export function selectionRange(editor: Editor): {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
} | null {
  const sel = editor.getSelection();
  if (!sel || sel.isEmpty()) return null;
  return {
    startLine: sel.startLineNumber - 1,
    startCharacter: sel.startColumn - 1,
    endLine: sel.endLineNumber - 1,
    endCharacter: sel.endColumn - 1,
  };
}
