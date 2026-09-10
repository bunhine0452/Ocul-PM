// LSP → Monaco 변환의 자물쇠 (Phase 2 — CodeMirror 판 `lsp_bridge.test.ts` 의
// "좌표 변환 · 진단 변환 · 완성 변환" 세 블록을 이어받는다).
//
// 좌표계가 바뀌었다. CodeMirror 는 진단을 문서 시작부터의 **오프셋**으로 받아
// 줄↔오프셋 환산이 필요했지만, Monaco 는 LSP 와 같은 (줄, 문자) 쌍을 쓰고
// 차이가 ±1 뿐이다. 그래도 잠그는 이유는 같다 — 여기서 ±1 이 어긋나면 진단이
// 옆 줄에 붙고 완성이 엉뚱한 자리를 지운다. 화면으로는 미묘해서 못 잡는다.
//
// Monaco 를 jsdom 에 올리지 않는다. 두 변환 함수가 monaco 에서 읽는 것은
// 열거형 두 개뿐이라 그것만 흉내 낸다 — 편집기를 통째로 로드하면 이 테스트가
// 배선 테스트가 되고, 그러면 규칙이 아니라 환경을 재게 된다.
import { describe, expect, it } from "vitest";

import {
  registerSemanticTokens,
  toMarkers,
  toMonacoCompletions,
} from "@/features/code/monaco/lsp";
import type { LspCompletionItem, LspDiagnostic } from "@/lib/bindings";

const MarkerSeverity = { Hint: 1, Info: 2, Warning: 4, Error: 8 } as const;
const CompletionItemKind = {
  Method: 0,
  Function: 1,
  Constructor: 2,
  Field: 3,
  Variable: 4,
  Class: 5,
  Interface: 7,
  Module: 8,
  Property: 9,
  Enum: 15,
  Keyword: 17,
  Snippet: 27,
  Text: 18,
  TypeParameter: 24,
  Constant: 14,
  Struct: 23,
} as const;
const monaco = { MarkerSeverity, languages: { CompletionItemKind } } as never;

/** `getLineCount` 만 쓰는 변환이라 모델도 그만큼만 흉내 낸다. */
const model = (lines: number) => ({ getLineCount: () => lines }) as never;

const diag = (over: Partial<LspDiagnostic> = {}): LspDiagnostic => ({
  start_line: 0,
  start_character: 0,
  end_line: 0,
  end_character: 1,
  severity: "error",
  message: "boom",
  source: null,
  ...over,
});

const item = (over: Partial<LspCompletionItem> = {}): LspCompletionItem => ({
  label: "push",
  detail: null,
  kind: null,
  insert_text: null,
  sort_text: null,
  ...over,
});

describe("toMarkers — 진단", () => {
  it("0-based 줄·문자를 1-based 로 옮긴다", () => {
    const [m] = toMarkers(monaco, model(3), [
      diag({ start_line: 1, start_character: 4, end_line: 1, end_character: 7, source: "rustc" }),
    ]);
    expect(m.startLineNumber).toBe(2);
    expect(m.startColumn).toBe(5);
    expect(m.endLineNumber).toBe(2);
    expect(m.endColumn).toBe(8);
    expect(m.source).toBe("rustc");
    expect(m.message).toBe("boom");
  });

  it("길이 0 범위를 한 글자로 넓힌다", () => {
    // 서버는 "이 지점" 을 start==end 로 표현한다. 그리면 밑줄이 0px 라
    // 진단이 조용히 사라진다 — 있는 오류가 안 보이는 게 최악이다.
    const [m] = toMarkers(monaco, model(3), [
      diag({ start_line: 1, start_character: 13, end_line: 1, end_character: 13 }),
    ]);
    expect(m.endColumn).toBeGreaterThan(m.startColumn);
  });

  it("네 심각도를 모두 옮긴다", () => {
    const items = (["error", "warning", "info", "hint"] as const).map((s) => diag({ severity: s }));
    expect(toMarkers(monaco, model(3), items).map((m) => m.severity)).toEqual([
      MarkerSeverity.Error,
      MarkerSeverity.Warning,
      MarkerSeverity.Info,
      MarkerSeverity.Hint,
    ]);
  });

  it("문서 밖을 가리키는 오래된 진단은 던지지 않고 접는다", () => {
    // 편집 직후 도착한 진단은 지워진 줄을 가리킬 수 있다.
    const [m] = toMarkers(monaco, model(3), [
      diag({ start_line: 999, start_character: 0, end_line: 999, end_character: 1 }),
    ]);
    expect(m.startLineNumber).toBe(3);
    expect(m.endLineNumber).toBe(3);
  });

  it("끝이 시작보다 앞이면 시작으로 되돌린다", () => {
    const [m] = toMarkers(monaco, model(9), [
      diag({ start_line: 4, start_character: 2, end_line: 1, end_character: 0 }),
    ]);
    expect(m.endLineNumber).toBe(m.startLineNumber);
    expect(m.endColumn).toBeGreaterThan(m.startColumn);
  });

  it("빈 목록은 빈 목록", () => {
    expect(toMarkers(monaco, model(3), [])).toEqual([]);
  });
});

describe("toMonacoCompletions — 완성", () => {
  const range = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 3 };

  it("서버 순서를 sortText 로 고정한다", () => {
    // rust-analyzer 는 타입이 맞는 후보를 앞으로 올린다 — 편집기가 알파벳순으로
    // 다시 섞으면 그 지능이 사라진다.
    const got = toMonacoCompletions(monaco, [item({ label: "zzz" }), item({ label: "aaa" })], range);
    expect(got.map((c) => c.label)).toEqual(["zzz", "aaa"]);
    expect(got[0].sortText! < got[1].sortText!).toBe(true);
  });

  it("sortText 는 문자열 비교라 자릿수를 0 으로 채운다", () => {
    // "10" < "9" 가 되면 열 번째 후보가 아홉 번째보다 앞으로 온다.
    const many = Array.from({ length: 12 }, (_, i) => item({ label: `i${i}` }));
    const sorted = toMonacoCompletions(monaco, many, range).map((c) => c.sortText!);
    expect([...sorted].sort()).toEqual(sorted);
  });

  it("insert_text 가 있으면 그것을, 없으면 label 을 넣는다", () => {
    expect(toMonacoCompletions(monaco, [item({ insert_text: "foo()" })], range)[0].insertText).toBe(
      "foo()",
    );
    expect(toMonacoCompletions(monaco, [item({ label: "bar" })], range)[0].insertText).toBe("bar");
  });

  it("모르는 종류는 Text 로 떨어뜨린다", () => {
    expect(toMonacoCompletions(monaco, [item({ kind: "method" })], range)[0].kind).toBe(
      CompletionItemKind.Method,
    );
    expect(toMonacoCompletions(monaco, [item({ kind: "무엇" })], range)[0].kind).toBe(
      CompletionItemKind.Text,
    );
    expect(toMonacoCompletions(monaco, [item()], range)[0].kind).toBe(CompletionItemKind.Text);
  });

  it("치환 범위는 호출자가 준 것을 그대로 쓴다", () => {
    expect(toMonacoCompletions(monaco, [item()], range)[0].range).toBe(range);
  });
});

describe("시맨틱 토큰 공급자", () => {
  const legend = { tokenTypes: ["keyword", "builtinType"], tokenModifiers: ["declaration"] };
  const model = (uri: string) =>
    ({ uri: { toString: () => uri }, isDisposed: () => false }) as never;

  /** 등록만 흉내 내는 최소 monaco — 공급자 객체를 그대로 돌려준다. */
  function fake() {
    let provider: {
      getLegend: () => typeof legend;
      provideDocumentSemanticTokens: (m: never) => Promise<{ data: Uint32Array } | null>;
    } | null = null;
    let disposed = false;
    const monaco = {
      languages: {
        registerDocumentSemanticTokensProvider: (_lang: string, p: typeof provider) => {
          provider = p;
          return { dispose: () => (disposed = true) };
        },
      },
    } as never;
    return {
      monaco,
      get provider() {
        return provider!;
      },
      get disposed() {
        return disposed;
      },
    };
  }

  // Monaco 는 공급자당 legend 를 **한 번만** 읽어 WeakMap 에 캐시한다. 등록
  // 시점에 받은 표를 그대로 들고 있어야 하는 이유가 그것이다.
  it("등록할 때 받은 legend 를 그대로 돌려준다", () => {
    const f = fake();
    registerSemanticTokens(f.monaco, model("file:///a.rs"), "rust", legend, async () => []);
    expect(f.provider.getLegend()).toEqual(legend);
  });

  it("데이터를 Uint32Array 로 넘긴다", async () => {
    const f = fake();
    registerSemanticTokens(f.monaco, model("file:///a.rs"), "rust", legend, async () => [
      0, 0, 3, 0, 0,
    ]);
    const got = await f.provider.provideDocumentSemanticTokens(model("file:///a.rs"));
    expect(got?.data).toEqual(new Uint32Array([0, 0, 3, 0, 0]));
  });

  // 공급자는 언어 단위 전역이라 같은 언어의 다른 편집기(논의 화면)에도 걸린다.
  it("자기 모델이 아니면 빠진다", async () => {
    const f = fake();
    let asked = 0;
    registerSemanticTokens(f.monaco, model("file:///a.rs"), "rust", legend, async () => {
      asked += 1;
      return [0, 0, 3, 0, 0];
    });
    expect(await f.provider.provideDocumentSemanticTokens(model("file:///b.rs"))).toBeNull();
    expect(asked).toBe(0);
  });

  // 빈 답을 토큰 0개로 넘기면 Monaco 가 Monarch 강조를 **지운다** — 무채색이
  // 되느니 아예 답을 안 하는 쪽이 맞다.
  it("서버가 아무것도 안 주면 null 이다 (Monarch 를 지우지 않는다)", async () => {
    const f = fake();
    registerSemanticTokens(f.monaco, model("file:///a.rs"), "rust", legend, async () => []);
    expect(await f.provider.provideDocumentSemanticTokens(model("file:///a.rs"))).toBeNull();
  });

  it("해제하면 공급자를 푼다", () => {
    const f = fake();
    const off = registerSemanticTokens(
      f.monaco,
      model("file:///a.rs"),
      "rust",
      legend,
      async () => [],
    );
    off();
    expect(f.disposed).toBe(true);
  });
});
