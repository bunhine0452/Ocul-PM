// 편집기 기본기의 자물쇠 (Phase 3 `{#cap-basics}` · `{#cap-multicursor}` ·
// `{#cap-minimap}`).
//
// 이 라운드가 켠 것들은 **옵션 몇 줄**이 전부다. 누가 리팩터링하다 한 줄을
// 지워도 아무것도 안 깨지고 화면만 조용히 옛날로 돌아간다 — CodeMirror 판이
// 정확히 그 상태였다(폴딩·괄호매칭·자동닫기·다중커서가 전부 0). 그래서 옵션을
// 값으로 만들고 여기서 문다.
import { describe, expect, it } from "vitest";

import { baseEditorOptions, diffEditorOptions, minimapOptions } from "@/features/code/monaco/options";

const opts = (over: Partial<Parameters<typeof baseEditorOptions>[0]> = {}) =>
  baseEditorOptions({
    theme: "oculpm",
    glyphMargin: false,
    stickyMaxLines: 0,
    tabSize: 2,
    insertSpaces: true,
    minimap: true,
    wordWrap: false,
    ...over,
  });

describe("기본기 — 실측으로 0 이던 것들", () => {
  it("코드 폴딩", () => {
    expect(opts().folding).toBe(true);
  });

  it("괄호 매칭 — 커서가 괄호 밖에 있어도 감싸는 쌍을 표시한다", () => {
    expect(opts().matchBrackets).toBe("always");
  });

  it("자동 괄호 닫기 · 따옴표 닫기 · 선택 감싸기", () => {
    const o = opts();
    expect(o.autoClosingBrackets).toBe("languageDefined");
    expect(o.autoClosingQuotes).toBe("languageDefined");
    expect(o.autoSurround).toBe("languageDefined");
  });

  it("입력 시 들여쓰기는 `full` — 언어 설정의 들여쓰기 규칙까지 쓴다", () => {
    // `advanced` 는 onEnter 규칙만 본다. `}` 를 쳤을 때 도로 나오는 것은
    // indentationRules 라 거기까지 켜야 CodeMirror 에 없던 것이 채워진다.
    expect(opts().autoIndent).toBe("full");
  });

  it("선택 일치 강조 · 같은 낱말 강조", () => {
    const o = opts();
    expect(o.selectionHighlight).toBe(true);
    expect(o.occurrencesHighlight).toBe("singleFile");
  });
});

describe("기여는 실렸는데 옵션이 꺼져 있던 것 (2026-09-09)", () => {
  it("태그 동시 편집 — `setup.ts` 가 싣는 기여가 옵션 없이는 죽은 임포트다", () => {
    expect(opts().linkedEditing).toBe(true);
  });

  it("커서 위아래 여유 줄 (scrolloff) — 맨 아랫줄에서 다음 줄이 보인다", () => {
    expect(opts().cursorSurroundingLines).toBeGreaterThanOrEqual(3);
  });

  it("탭 들여쓰기에서 ←/→ 가 탭 한 칸씩 움직인다", () => {
    expect(opts().stickyTabStops).toBe(true);
  });

  it("자동완성은 넣기 전에 보여 준다 — 고스트 미리보기 + 상태줄", () => {
    expect(opts().suggest).toEqual({ preview: true, showStatusBar: true });
  });
});

describe("다중 커서 · 열 선택", () => {
  it("⌥ 가 커서를 더한다 (⌥⇧드래그가 열 선택이 되는 것도 이 값에서 온다)", () => {
    expect(opts().multiCursorModifier).toBe("alt");
  });

  it("겹친 커서는 합친다 — 안 합치면 한 글자에 커서가 여러 벌 선다", () => {
    expect(opts().multiCursorMergeOverlapping).toBe(true);
  });
});

describe("들여쓰기는 설정이 정한다 — 추정하지 않는다", () => {
  it("detectIndentation 을 끈다", () => {
    // 켜 두면 파일 내용에서 추정해 설정을 덮는다. 저장 시 포맷은 설정값으로
    // 가므로, 4로 그려 놓고 2로 저장해 파일 전체가 diff 로 물든다.
    expect(opts().detectIndentation).toBe(false);
  });

  it("설정값을 그대로 싣는다", () => {
    const o = opts({ tabSize: 8, insertSpaces: false });
    expect(o.tabSize).toBe(8);
    expect(o.insertSpaces).toBe(false);
  });
});

describe("미니맵 · 브래킷 색칠 · 들여쓰기 가이드", () => {
  it("미니맵은 설정이 켜고 끈다 (좁은 분할에서 폭을 먹는다)", () => {
    expect(opts({ minimap: true }).minimap).toMatchObject({ enabled: true });
    expect(opts({ minimap: false }).minimap).toMatchObject({ enabled: false });
  });

  it("미니맵은 글자가 아니라 덩어리로, 손잡이는 늘 보인다 (2026-09-11 디자인 라운드)", () => {
    // 1px 축소 글자는 못 읽는데 읽으려 드는 순간 눈이 샌다 — 덩어리는 밀도만 말한다.
    expect(opts().minimap).toMatchObject({ renderCharacters: false, showSlider: "always" });
    // 켜고 끄는 자리(`CodeEditor` 의 updateOptions)도 같은 벌이어야 한다 —
    // `{ enabled }` 만 넘기면 Monaco 가 나머지를 기본값으로 되돌린다.
    expect(minimapOptions(false)).toEqual({ ...opts().minimap, enabled: false });
  });

  it("줄바꿈은 화면이 파일 종류로 정해 내려보낸다 (⌥Z 가 뒤집는다)", () => {
    expect(opts({ wordWrap: true }).wordWrap).toBe("on");
    expect(opts({ wordWrap: false }).wordWrap).toBe("off");
  });

  it("자리를 안 먹는 둘은 설정 없이 항상 켠다", () => {
    const o = opts();
    expect(o.bracketPairColorization).toEqual({ enabled: true });
    expect(o.guides?.indentation).toBe(true);
  });
});

describe("스티키", () => {
  it("0 이면 끈다", () => {
    expect(opts({ stickyMaxLines: 0 }).stickyScroll?.enabled).toBe(false);
  });

  it("켜면 줄 수를 그대로 쓰고 아웃라인 모델로 시작한다", () => {
    const sticky = opts({ stickyMaxLines: 3 }).stickyScroll;
    expect(sticky?.enabled).toBe(true);
    expect(sticky?.maxLineCount).toBe(3);
    // 사슬이라 심볼 공급자가 없으면 폴딩 → 들여쓰기로 스스로 떨어진다.
    expect(sticky?.defaultModel).toBe("outlineModel");
  });
});

describe("시맨틱 강조", () => {
  // standalone 테마는 `semanticHighlighting` 을 항상 false 로 들고 있어서
  // (StandaloneTheme 생성자), 이 한 줄이 빠지면 공급자를 등록해도 Monaco 가
  // 묻지조차 않는다. 화면으로는 "LSP 색이 원래 저런가 보다" 로 보인다.
  it("옵션으로 켜 둔다 — 테마에 맡기면 꺼진 채로 남는다", () => {
    const o = opts() as Record<string, unknown>;
    expect(o["semanticHighlighting.enabled"]).toBe(true);
  });
});

describe("인라인 비교", () => {
  it("한 열로 그리고 원본은 못 고친다", () => {
    const d = diffEditorOptions(opts());
    expect(d.renderSideBySide).toBe(false);
    expect(d.originalEditable).toBe(false);
  });

  it("미니맵·개요 눈금자는 끈다 — diff 에서 자리만 먹는다", () => {
    const d = diffEditorOptions(opts({ minimap: true }));
    expect(d.minimap).toEqual({ enabled: false });
    expect(d.renderOverviewRuler).toBe(false);
  });

  it("그 밖의 기본기는 본편과 같다", () => {
    const d = diffEditorOptions(opts());
    expect(d.folding).toBe(true);
    expect(d.multiCursorModifier).toBe("alt");
    // 들여쓰기 셋은 diff 편집기의 **타입**에 없지만 런타임에는 먹는다 —
    // `StandaloneDiffEditor2` 도 같은 `updateConfigurationService` 를 통과시킨다.
    // 그래서 값이 실려 가는지만 본다.
    expect((d as Record<string, unknown>).detectIndentation).toBe(false);
    expect((d as Record<string, unknown>).tabSize).toBe(2);
  });
});
