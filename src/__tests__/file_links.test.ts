import { describe, expect, it } from "vitest";
import {
  readLineColumns,
  scanFileRefs,
  type BufferLineLike,
} from "@/features/terminal/fileLinks";
import { createFileRefLinkProvider } from "@/features/terminal/fileRefLinks";
import type { LinkUnderline } from "@/features/terminal/linkUnderline";
import type { ILink } from "@xterm/xterm";

describe("scanFileRefs", () => {
  it("컴파일러 출력의 파일:줄:열을 잡는다", () => {
    const refs = scanFileRefs("src/lib/foo.ts:42:7 - error TS2345: 인자 타입 불일치");
    expect(refs).toHaveLength(1);
    expect(refs[0].path).toBe("src/lib/foo.ts");
    expect(refs[0].line).toBe(42);
  });

  it("줄 번호가 없어도 파일은 잡는다", () => {
    const refs = scanFileRefs("수정됨: src/App.tsx");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ path: "src/App.tsx", line: null });
  });

  it("범위가 파일명+줄 전체를 덮는다 (클릭 대상)", () => {
    const text = "at src/a.ts:12";
    const [ref] = scanFileRefs(text);
    expect(text.slice(ref.start, ref.end)).toBe("src/a.ts:12");
  });

  it("./ 접두사를 벗긴다", () => {
    expect(scanFileRefs("./src/x.rs:3")[0].path).toBe("src/x.rs");
  });

  it("한 줄에 여러 개도 전부 잡는다", () => {
    const refs = scanFileRefs("a/b.ts:1 와 c/d.rs:2 둘 다");
    expect(refs.map((r) => `${r.path}:${r.line}`)).toEqual(["a/b.ts:1", "c/d.rs:2"]);
  });

  it("괄호·따옴표 안도 잡는다 (스택트레이스 형태)", () => {
    expect(scanFileRefs("  at fn (src/x.js:9:3)")[0]).toMatchObject({
      path: "src/x.js",
      line: 9,
    });
    expect(scanFileRefs('입력 "src/y.ts:5" 확인')[0].path).toBe("src/y.ts");
  });

  // --- 신뢰 경계: 클릭해도 백엔드가 거절할 것은 링크로 만들지 않는다 ---

  it("절대경로는 링크로 만들지 않는다", () => {
    expect(scanFileRefs("/etc/passwd.bak:1")).toEqual([]);
    expect(scanFileRefs("~/.ssh/config.d:2")).toEqual([]);
  });

  it("상위 탈출 경로는 링크로 만들지 않는다", () => {
    expect(scanFileRefs("../../.ssh/id_rsa.pub:1")).toEqual([]);
    expect(scanFileRefs("src/../../etc/hosts.txt")).toEqual([]);
  });

  it("Windows 드라이브 절대경로도 막는다", () => {
    expect(scanFileRefs("C:/Windows/system.ini:1")).toEqual([]);
  });

  it("URL 은 WebLinks 애드온 몫이라 가로채지 않는다", () => {
    expect(scanFileRefs("https://example.com/app.js:12")).toEqual([]);
    expect(scanFileRefs("http://cdn.test/a/b.css")).toEqual([]);
  });

  // --- 오탐 방어 ---

  it("확장자가 없으면 링크가 아니다", () => {
    expect(scanFileRefs("Makefile:12")).toEqual([]);
    expect(scanFileRefs("warning:42 무언가")).toEqual([]);
    expect(scanFileRefs("localhost:3000")).toEqual([]);
  });

  it("줄 번호 0 은 줄 없음으로 낮춘다 (편집기가 해석 못 함)", () => {
    expect(scanFileRefs("src/a.ts:0")[0].line).toBeNull();
  });

  it("빈 줄은 빈 배열", () => {
    expect(scanFileRefs("")).toEqual([]);
    expect(scanFileRefs("   ")).toEqual([]);
  });

  it("여러 번 호출해도 결과가 같다 (정규식 lastIndex 누수 없음)", () => {
    const text = "src/a.ts:1 src/b.ts:2";
    expect(scanFileRefs(text)).toEqual(scanFileRefs(text));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 문자열 인덱스 → 버퍼 열 (2026-09-07)
// ─────────────────────────────────────────────────────────────────────────────
//
// 한글이 섞인 줄에서 링크 상자가 왼쪽으로 밀리던 회귀를 막는다. 원인은 문자
// 인덱스를 그대로 셀 열로 쓴 것 — 한글은 한 문자가 두 셀이다.

/** 폭 표를 흉내 낸 가짜 버퍼 줄. 한글·이모지는 2, 나머지는 1. */
function fakeLine(text: string): BufferLineLike {
  const cells: { chars: string; width: number }[] = [];
  for (const ch of text) {
    const wide = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿＀-｠]/.test(ch);
    cells.push({ chars: ch, width: wide ? 2 : 1 });
    // 넓은 문자는 오른쪽 반쪽(폭 0)을 한 칸 더 차지한다 — xterm 과 같은 배치.
    if (wide) cells.push({ chars: "", width: 0 });
  }
  return {
    length: cells.length,
    getCell: (x: number) => {
      const cell = cells[x];
      if (!cell) return undefined;
      return { getChars: () => cell.chars, getWidth: () => cell.width };
    },
  };
}

describe("readLineColumns", () => {
  it("ASCII 만 있으면 인덱스와 열이 같다", () => {
    const { text, startCol, endCol } = readLineColumns(fakeLine("at src/a.ts:12"));
    expect(text).toBe("at src/a.ts:12");
    expect(startCol[3]).toBe(3);
    expect(endCol[3]).toBe(3);
  });

  it("한글 앞에 있는 경로의 열이 문자 인덱스보다 크다", () => {
    // "정본: " 은 한글 2자(4셀) + ':'(1) + ' '(1) = 6셀, 문자로는 4개.
    const line = fakeLine("정본: docs/a.md");
    const { text, startCol } = readLineColumns(line);
    const idx = text.indexOf("docs/a.md");
    expect(idx).toBe(4);
    expect(startCol[idx]).toBe(6);
  });

  it("넓은 문자는 두 열을 차지한다 (끝 열 = 시작 열 + 1)", () => {
    const { startCol, endCol } = readLineColumns(fakeLine("가나"));
    expect(startCol).toEqual([0, 2]);
    expect(endCol).toEqual([1, 3]);
  });

  it("오른쪽 공백은 잘라 낸다 (translateToString(true) 와 같은 결과)", () => {
    expect(readLineColumns(fakeLine("src/a.ts   ")).text).toBe("src/a.ts");
  });

  it("한글 줄의 링크 범위가 실제 경로 위에 놓인다", () => {
    // 회귀의 정확한 모양: 이 줄에서 예전 코드는 열 8~16 을 칠했고
    // (문자 인덱스 그대로), 진짜 경로는 열 12~20 에 있었다.
    const line = fakeLine("만들었습니다 docs/a.md:3");
    const { text, startCol, endCol } = readLineColumns(line);
    const [ref] = scanFileRefs(text);
    expect(ref.path).toBe("docs/a.md");
    // "만들었습니다"(6자) = 12셀, 공백 1셀 → 경로는 13번째 열(0-based 13).
    expect(startCol[ref.start]).toBe(13);
    expect(endCol[ref.end - 1]).toBe(13 + "docs/a.md:3".length - 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 링크 프로바이더 — 범위가 실제 셀 위에 놓이는가
// ─────────────────────────────────────────────────────────────────────────────

/** provideLinks 가 만지는 것만 갖춘 가짜 터미널. */
function fakeTerm(lines: string[]) {
  return {
    buffer: {
      active: {
        getNullCell: () => ({ getChars: () => "", getWidth: () => 1 }),
        getLine: (n: number) => (lines[n] === undefined ? undefined : fakeLine(lines[n])),
      },
    },
  } as unknown as Parameters<typeof createFileRefLinkProvider>[0]["term"];
}

function provide(term: ReturnType<typeof fakeTerm>, y: number, underline?: LinkUnderline) {
  const provider = createFileRefLinkProvider({
    term,
    getActivate: () => () => {},
    underline: underline ?? { show: () => {}, hide: () => {}, dispose: () => {} },
    onError: (e) => {
      throw e;
    },
  });
  let out: ILink[] | undefined;
  provider.provideLinks(y, (links) => {
    out = links;
  });
  return out;
}

describe("createFileRefLinkProvider", () => {
  it("한글 줄에서도 범위가 경로의 실제 열을 가리킨다", () => {
    // "만들었습니다 " = 12셀 + 공백 1 → 경로는 0-based 열 13 부터.
    const links = provide(fakeTerm(["만들었습니다 docs/a.md:3"]), 1);
    expect(links).toHaveLength(1);
    // xterm 은 1-based, end 는 포함.
    expect(links![0].range).toEqual({
      start: { x: 14, y: 1 },
      end: { x: 14 + "docs/a.md:3".length - 1, y: 1 },
    });
    expect(links![0].text).toBe("docs/a.md:3");
  });

  it("ASCII 만 있으면 예전과 같은 범위를 낸다 (회귀 아님)", () => {
    const links = provide(fakeTerm(["at src/a.ts:12"]), 1);
    expect(links![0].range).toEqual({ start: { x: 4, y: 1 }, end: { x: 14, y: 1 } });
  });

  it("호버는 밑줄을 켜고, 벗어나면 끈다", () => {
    const events: string[] = [];
    const links = provide(fakeTerm(["src/a.ts:1"]), 1, {
      show: () => events.push("show"),
      hide: () => events.push("hide"),
      dispose: () => {},
    });
    links![0].hover?.(new MouseEvent("mousemove"), "src/a.ts:1");
    links![0].leave?.(new MouseEvent("mouseout"), "src/a.ts:1");
    expect(events).toEqual(["show", "hide"]);
  });

  it("열 곳이 없으면 링크를 아예 만들지 않는다", () => {
    const provider = createFileRefLinkProvider({
      term: fakeTerm(["src/a.ts:1"]),
      getActivate: () => undefined,
      underline: { show: () => {}, hide: () => {}, dispose: () => {} },
      onError: () => {},
    });
    let out: ILink[] | undefined = [];
    provider.provideLinks(1, (links) => {
      out = links;
    });
    expect(out).toBeUndefined();
  });

  it("없는 줄은 조용히 빈손 (스크롤 경계)", () => {
    expect(provide(fakeTerm(["src/a.ts:1"]), 9)).toBeUndefined();
  });
});
