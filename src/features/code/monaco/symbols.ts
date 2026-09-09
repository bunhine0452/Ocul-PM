// LSP 문서 심볼 → Monaco 아웃라인 (Phase 2 `{#reclaim-sticky}`).
//
// CodeMirror 판은 스티키 스크롤을 손으로 만들었다 — `stickyScroll.ts`(229줄)가
// 뷰포트를 읽어 DOM 을 그리고 `stickyModel.ts`(152줄)가 "지금 줄을 감싸는
// 상위 스코프" 를 계산했다. Monaco 는 그 둘을 내장으로 갖고 있지만 **심볼을
// 스스로 알지는 못한다**: 아웃라인 모델은 `DocumentSymbolProvider` 에서 온다.
//
// 그래서 이 파일이 남는 전부다 — 백엔드가 준 `LspSymbol[]` 을 Monaco 가 아는
// 모양으로 옮기는 순수 변환 + 등록. 계산은 Monaco 가 한다.

import type * as MonacoNs from "monaco-editor/editor/editor.api";
import type { MutableRefObject } from "react";
import type { LspSymbol } from "@/lib/bindings";

type Monaco = typeof MonacoNs;
type Model = MonacoNs.editor.ITextModel;

/**
 * `"enum-member"` → `Kind.EnumMember`. 백엔드는 LSP `SymbolKind` 를 소문자
 * 하이픈 이름으로 내려보내고(`lsp/spec.rs::symbol_kind_name`), Monaco 는 같은
 * 목록을 파스칼 케이스 열거형으로 갖고 있다 — 이름이 겹치므로 표를 두 벌
 * 들지 않고 규칙 하나로 옮긴다. 모르는 값은 `Variable`(가장 무해한 아이콘).
 */
export function symbolKindOf(
  Kind: typeof MonacoNs.languages.SymbolKind,
  kind: string,
): MonacoNs.languages.SymbolKind {
  const pascal = kind.replace(/(^|-)([a-z])/g, (_m, _sep, c: string) => c.toUpperCase());
  const found = (Kind as unknown as Record<string, number | undefined>)[pascal];
  return typeof found === "number" ? (found as MonacoNs.languages.SymbolKind) : Kind.Variable;
}

/**
 * 평평한 `LspSymbol[]`(문서 순서 + `depth`) → 중첩된 `DocumentSymbol[]`.
 *
 * 두 가지를 지어낸다. 둘 다 백엔드가 시작 줄만 주기 때문이다.
 *
 * 1. **끝 줄** — 다음 형제(같거나 얕은 `depth`)의 시작 **앞 줄**, 없으면 문서 끝.
 *    CodeMirror 판 `stickyFromSymbols` 가 쓰던 것과 **같은 추정**이고 대가도
 *    같다: 함수 사이 빈 줄에서 앞 함수가 아직 감싸는 것처럼 보인다.
 * 2. **중첩** — `depth` 로 부모를 되찾는다. 평평하게 넘기면 스티키가 사슬이
 *    아니라 가장 안쪽 한 줄만 그린다 (Monaco 는 아웃라인 **트리**를 걷는다).
 *
 * `lineCount` 는 1-based 문서 줄 수. 심볼의 `line` 은 0-based 다.
 */
export function toDocumentSymbols(
  monaco: Monaco,
  symbols: readonly LspSymbol[],
  lineCount: number,
): MonacoNs.languages.DocumentSymbol[] {
  const Kind = monaco.languages.SymbolKind;
  const last = Math.max(lineCount, 1);
  const roots: MonacoNs.languages.DocumentSymbol[] = [];
  // depth → 그 깊이에서 가장 최근에 만든 노드. 부모는 `depth - 1` 에서 찾는다.
  const openAt: MonacoNs.languages.DocumentSymbol[] = [];

  for (let i = 0; i < symbols.length; i += 1) {
    const s = symbols[i];
    const startLine = Math.min(Math.max(s.line + 1, 1), last);
    // 다음 형제(또는 조상의 형제)가 나오는 자리까지가 이 심볼의 범위다.
    let endLine = last;
    for (let j = i + 1; j < symbols.length; j += 1) {
      if (symbols[j].depth <= s.depth) {
        endLine = Math.max(startLine, Math.min(symbols[j].line, last));
        break;
      }
    }
    const startColumn = Math.max(s.character + 1, 1);
    const node: MonacoNs.languages.DocumentSymbol = {
      name: s.name,
      detail: s.detail ?? "",
      kind: symbolKindOf(Kind, s.kind),
      tags: [],
      range: { startLineNumber: startLine, startColumn: 1, endLineNumber: endLine, endColumn: 1 },
      // 이름 자체 — 아웃라인에서 고르면 커서가 함수 위 빈 줄이 아니라 이름에 선다.
      selectionRange: {
        startLineNumber: startLine,
        startColumn,
        endLineNumber: startLine,
        endColumn: startColumn + Math.max(s.name.length, 1),
      },
      children: [],
    };

    // 깊이가 건너뛸 수 있다 (0 → 2). 서버가 중간 단계를 안 주는 경우라
    // **있는 조상 중 가장 가까운 것** 밑으로 붙인다 — 그러지 않으면 안쪽
    // 심볼이 뿌리로 튀어 스티키 사슬이 끊긴다.
    let parent: MonacoNs.languages.DocumentSymbol | undefined;
    for (let d = s.depth - 1; d >= 0 && !parent; d -= 1) parent = openAt[d];
    if (parent) parent.children!.push(node);
    else roots.push(node);
    // 더 깊은 자리에 남아 있던 옛 노드는 이제 부모가 될 수 없다.
    openAt.length = s.depth;
    openAt[s.depth] = node;
  }
  return roots;
}

/**
 * 이 모델 하나에 문서 심볼 공급자를 단다. 반환값은 해제 함수.
 *
 * `symbolsRef` 는 ref 지만 **값이 바뀌면 다시 등록해야 한다** — Monaco 는
 * 공급자 목록이 바뀔 때만(`documentSymbolProvider.onDidChange`) 아웃라인을
 * 다시 묻는다. ref 안의 값만 갈아끼우면 아무도 다시 묻지 않아 서버가 늦게 준
 * 심볼이 화면에 영영 안 나온다. 호출자(CodeEditor)가 `stickySymbols` 가 바뀔
 * 때마다 풀고 다시 건다.
 *
 * 다른 LSP 공급자와 같은 이유로 `model.uri` 를 대조한다 — 공급자는 언어 단위
 * 전역이라 안 걸면 같은 언어의 다른 편집기에도 붙는다.
 */
export function registerSymbolProvider(
  monaco: Monaco,
  model: Model,
  languageId: string,
  symbolsRef: MutableRefObject<readonly LspSymbol[] | null>,
): () => void {
  const sub = monaco.languages.registerDocumentSymbolProvider(languageId, {
    displayName: "ocul-pm",
    provideDocumentSymbols(m) {
      if (m.uri.toString() !== model.uri.toString()) return [];
      const symbols = symbolsRef.current;
      if (!symbols || symbols.length === 0) return [];
      return toDocumentSymbols(monaco, symbols, m.getLineCount());
    },
  });
  return () => sub.dispose();
}
