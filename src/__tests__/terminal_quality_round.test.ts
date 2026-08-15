import { describe, expect, test } from "vitest";
import { canAutoRename, shellTitleToTabLabel } from "@/features/terminal/tabTitle";
// 2026-08-15 — 터미널 본체가 `TerminalSurface` 로 분리되면서 함께 옮겨왔다
// (도크·분리 창이 같은 컴포넌트를 쓴다).
import { formatMatchCount } from "@/features/terminal/TerminalSurface";
import { readSearchDecorations, readTerminalTheme } from "@/features/terminal/termTheme";

// 2026-07-30 터미널 품질 라운드 — 순수 로직 회귀 방지.
// (IME 브리지/WebGL 렌더러는 실제 WKWebView 조합 이벤트·GPU 컨텍스트가 필요해
//  jsdom 에서 의미 있는 검증이 불가능하므로 여기서 다루지 않는다.)

describe("shellTitleToTabLabel", () => {
  test("user@host 프롬프트 제목에서 디렉터리 이름만 뽑는다", () => {
    expect(shellTitleToTabLabel("kim@mac: ~/src/ai-pm")).toBe("ai-pm");
  });

  test("경로만 있는 제목도 마지막 구성요소를 쓴다", () => {
    expect(shellTitleToTabLabel("~/src/ai-pm")).toBe("ai-pm");
    expect(shellTitleToTabLabel("/usr/local/bin")).toBe("bin");
  });

  test("홈 디렉터리는 ~ 그대로 남긴다", () => {
    expect(shellTitleToTabLabel("~")).toBe("~");
  });

  test("실행 중인 명령은 통째로 라벨이 된다", () => {
    expect(shellTitleToTabLabel("npm run dev")).toBe("npm run dev");
  });

  test("공백만 있는 제목은 라벨로 쓰지 않는다", () => {
    expect(shellTitleToTabLabel("   ")).toBeNull();
    expect(shellTitleToTabLabel("")).toBeNull();
  });

  test("연속 공백은 하나로 접는다", () => {
    expect(shellTitleToTabLabel("npm    run\tdev")).toBe("npm run dev");
  });

  test("긴 명령은 뒤를 자르고, 긴 경로는 앞을 자른다", () => {
    expect(shellTitleToTabLabel("git rebase --interactive origin/main", 12)).toBe("git rebase …");
    expect(shellTitleToTabLabel("~/very/deep/nested/directory-name", 12)).toBe("…ectory-name");
  });
});

describe("canAutoRename", () => {
  test("기본 라벨이면 자동 이름을 허용한다", () => {
    for (const label of ["zsh", "zsh 2", "bash", "fish 10"]) {
      expect(canAutoRename(label)).toBe(true);
    }
  });

  test("사용자가 직접 지은 이름은 덮어쓰지 않는다", () => {
    for (const label of ["배포", "claude code", "zshrc", "zsh dev"]) {
      expect(canAutoRename(label)).toBe(false);
    }
  });
});

describe("formatMatchCount", () => {
  test("검색어가 없으면 아무것도 표시하지 않는다", () => {
    expect(formatMatchCount("", { index: 0, count: 3 })).toBe("");
  });

  test("아직 결과가 안 온 상태도 빈 문자열", () => {
    expect(formatMatchCount("foo", null)).toBe("");
  });

  test("일치가 없으면 안내 문구", () => {
    expect(formatMatchCount("foo", { index: -1, count: 0 })).toBe("일치 없음");
  });

  test("활성 인덱스는 1-base 로 표시한다", () => {
    expect(formatMatchCount("foo", { index: 2, count: 17 })).toBe("3/17");
  });

  test("하이라이트 한계를 넘어 인덱스를 못 세면 총 개수만", () => {
    expect(formatMatchCount("foo", { index: -1, count: 4200 })).toBe("4200건");
  });
});

describe("termTheme", () => {
  test("토큰이 없어도 폴백으로 완전한 ITheme 을 만든다", () => {
    const theme = readTerminalTheme(document.documentElement);
    // 16 ANSI + background/foreground/cursor/cursorAccent/selectionBackground
    expect(Object.keys(theme)).toHaveLength(21);
    expect(Object.values(theme).every((v) => typeof v === "string" && v.length > 0)).toBe(true);
  });

  test("토큰이 있으면 그 값을 그대로 쓴다", () => {
    const root = document.documentElement;
    root.style.setProperty("--term-bg", "#fdf6e3");
    root.style.setProperty("--term-fg", "#586e75");
    try {
      const theme = readTerminalTheme(root);
      expect(theme.background).toBe("#fdf6e3");
      expect(theme.foreground).toBe("#586e75");
    } finally {
      root.style.removeProperty("--term-bg");
      root.style.removeProperty("--term-fg");
    }
  });

  test("검색 하이라이트는 #RRGGBB 만 통과시킨다 (xterm 제약)", () => {
    const root = document.documentElement;
    root.style.setProperty("--term-yellow", "rgba(1,2,3,0.4)"); // xterm 이 못 받는 형식
    try {
      const decorations = readSearchDecorations(root);
      expect(decorations.matchBackground).toMatch(/^#[0-9a-f]{6}$/i);
      expect(decorations.activeMatchBackground).toMatch(/^#[0-9a-f]{6}$/i);
    } finally {
      root.style.removeProperty("--term-yellow");
    }
  });
});
