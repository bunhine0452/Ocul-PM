import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// @ts-expect-error — 빌드 대상이 아닌 zero-dep 생성 스크립트 (.mjs, 타입 없음).
import { buildBuiltinThemes } from "../../scripts/gen-builtin-themes.mjs";
import { BUILTIN_THEMES } from "@/features/theme/builtins";
import { ALLOWED_TOKENS, ACCENT_TOKENS, ownsAccent, TOKEN_GROUPS } from "@/features/theme/schema";
import { applyThemeAttrs, resolveThemeAttrs } from "@/features/theme/apply";
import { deriveAccentTokens, parseHex } from "@/features/theme/accent";
import type { ThemeFile } from "@/lib/bindings";

// ─── Osaurus 라운드 Phase 4 — 테마 스키마 계약 ────────────────────────────
//
// 지키는 것 넷: (1) 내장 JSON 이 tokens.css 와 한 글자도 다르지 않다,
// (2) 프런트 편집기와 백엔드 검증이 같은 토큰 목록을 본다, (3) 적용이 왕복에서
// 손실 없다, (4) 부분 지정·프로젝트 바인딩·강조 소유 규칙이 설계대로다.

const theme = (over: Partial<ThemeFile> = {}): ThemeFile => ({
  oculpm_theme: "v1",
  metadata: { id: "t1", name: "테마", version: "1.0", author: null, created_at: "", updated_at: "" },
  family: "dark",
  is_built_in: false,
  follows_system_accent: false,
  tokens: {},
  ...over,
});

const base = {
  themeSetting: "system",
  colorTheme: "green",
  customThemes: [] as ThemeFile[],
  systemAccent: null as string | null,
  prefersDark: false,
};

describe("내장 5종은 tokens.css 에서 생성된다", () => {
  it("체크인된 JSON 이 [data-preset] 블록과 정확히 같다", () => {
    // 어긋나면 고치는 방법은 하나다: `node scripts/gen-builtin-themes.mjs`.
    // 생성기의 `readTokensCss` 를 쓰지 않는다 — Vite 아래서 `import.meta.url`
    // 이 `/@fs/…` 로 오므로 경로가 어긋난다. 파서만 빌려 쓰고 읽기는 여기서.
    const css = readFileSync(join(__dirname, "../styles/tokens.css"), "utf8");
    expect(BUILTIN_THEMES).toEqual(buildBuiltinThemes(css));
  });

  it("내장이 곧 예제다 — 전부 화이트리스트 안의 토큰만 쓴다", () => {
    for (const t of BUILTIN_THEMES) {
      for (const token of Object.keys(t.tokens ?? {})) {
        expect(ALLOWED_TOKENS, `${t.metadata.name}: ${token}`).toContain(token);
      }
      expect(["light", "dark"]).toContain(t.family);
      expect(t.is_built_in).toBe(true);
      // 프리셋은 자기 강조색을 갖고 온다 — 그래서 data-accent 를 제거한다.
      expect(ownsAccent(t)).toBe(true);
    }
  });
});

describe("화이트리스트는 백엔드와 한 목록이다", () => {
  it("프런트 편집기 그룹 == Rust ALLOWED_TOKENS", () => {
    const rust = readFileSync(
      join(__dirname, "../../src-tauri/src/themes/mod.rs"),
      "utf8",
    );
    const block = rust.slice(
      rust.indexOf("pub const ALLOWED_TOKENS"),
      rust.indexOf("];", rust.indexOf("pub const ALLOWED_TOKENS")),
    );
    const backend = [...block.matchAll(/"(--[a-z0-9-]+)"/g)].map((m) => m[1]);
    expect([...backend].sort()).toEqual([...ALLOWED_TOKENS].sort());
  });

  it("그룹은 다섯이고 토큰이 겹치지 않는다", () => {
    expect(TOKEN_GROUPS).toHaveLength(5);
    expect(new Set(ALLOWED_TOKENS).size).toBe(ALLOWED_TOKENS.length);
    for (const token of ACCENT_TOKENS) expect(ALLOWED_TOKENS).toContain(token);
  });
});

describe("적용 — 인라인 변수 왕복", () => {
  it("JSON → 인라인 스타일 → JSON, 손실 0", () => {
    const tokens = {
      "--bg-window": "#141416",
      "--accent": "#ff7a66",
      "--accent-soft": "rgba(255,122,102,0.16)",
    };
    const root = document.createElement("html");
    applyThemeAttrs(root, resolveThemeAttrs({
      ...base,
      themeSetting: "custom:t1",
      customThemes: [theme({ tokens })],
    }));

    const readBack = Object.fromEntries(
      ALLOWED_TOKENS.map((k) => [k, root.style.getPropertyValue(k)]).filter(([, v]) => v !== ""),
    );
    expect(readBack).toEqual(tokens);
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(root.getAttribute("data-preset")).toBe("custom");
  });

  it("부분 지정 — 적은 토큰만 얹고 나머지는 가족 기본값을 상속한다", () => {
    const root = document.createElement("html");
    applyThemeAttrs(root, resolveThemeAttrs({
      ...base,
      themeSetting: "custom:t1",
      customThemes: [theme({ tokens: { "--bg-window": "#141416" } })],
    }));
    expect(root.style.getPropertyValue("--bg-window")).toBe("#141416");
    for (const token of ALLOWED_TOKENS.filter((t) => t !== "--bg-window")) {
      expect(root.style.getPropertyValue(token)).toBe("");
    }
  });

  it("테마를 갈아타면 이전 테마의 토큰이 남지 않는다", () => {
    const root = document.createElement("html");
    applyThemeAttrs(root, resolveThemeAttrs({
      ...base,
      themeSetting: "custom:t1",
      customThemes: [theme({ tokens: { "--bg-window": "#141416", "--accent": "#ff7a66" } })],
    }));
    applyThemeAttrs(root, resolveThemeAttrs({ ...base, themeSetting: "light" }));
    expect(root.style.getPropertyValue("--bg-window")).toBe("");
    expect(root.style.getPropertyValue("--accent")).toBe("");
    expect(root.getAttribute("data-preset")).toBeNull();
  });

  it("화이트리스트 밖 토큰은 인라인으로 새지 않는다", () => {
    const root = document.createElement("html");
    applyThemeAttrs(root, resolveThemeAttrs({
      ...base,
      themeSetting: "custom:t1",
      customThemes: [theme({ tokens: { "--evil": "red", "--accent": "#ff7a66" } })],
    }));
    expect(root.style.getPropertyValue("--evil")).toBe("");
    expect(root.style.getPropertyValue("--accent")).toBe("#ff7a66");
  });
});

describe("강조 소유 규칙", () => {
  it("강조를 하나도 지정하지 않은 테마는 data-accent 를 유지한다", () => {
    const attrs = resolveThemeAttrs({
      ...base,
      colorTheme: "purple",
      themeSetting: "custom:t1",
      customThemes: [theme({ tokens: { "--bg-window": "#141416" } })],
    });
    expect(attrs.accent).toBe("purple");
  });

  it("하나라도 지정하면 테마가 강조를 소유한다", () => {
    const attrs = resolveThemeAttrs({
      ...base,
      colorTheme: "purple",
      themeSetting: "custom:t1",
      customThemes: [theme({ tokens: { "--accent-soft": "rgba(0,0,0,0.1)" } })],
    });
    expect(attrs.accent).toBeNull();
  });

  it("내장 프리셋도 강조를 소유하고, 값은 CSS 가 칠한다", () => {
    const attrs = resolveThemeAttrs({ ...base, themeSetting: "nord" });
    expect(attrs.preset).toBe("nord");
    expect(attrs.accent).toBeNull();
    expect(attrs.vars).toEqual({});
  });
});

describe("시스템 강조색", () => {
  it("follows_system_accent 는 강조 5토큰을 유도한다", () => {
    const attrs = resolveThemeAttrs({
      ...base,
      themeSetting: "custom:t1",
      systemAccent: "#007aff",
      customThemes: [theme({ follows_system_accent: true })],
    });
    for (const token of ACCENT_TOKENS) expect(attrs.vars[token]).toBeTruthy();
    expect(attrs.accent).toBeNull();
  });

  it("시스템 강조색을 못 읽으면 테마가 자기 색으로 산다", () => {
    const attrs = resolveThemeAttrs({
      ...base,
      themeSetting: "custom:t1",
      systemAccent: null,
      customThemes: [theme({ follows_system_accent: true, tokens: { "--accent": "#123456" } })],
    });
    expect(attrs.vars).toEqual({ "--accent": "#123456" });
  });

  it("가족에 따라 다르게 유도한다 — 다크는 밝히고 라이트는 어둡게", () => {
    expect(parseHex("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    const light = deriveAccentTokens("#007aff", "light");
    const dark = deriveAccentTokens("#007aff", "dark");
    expect(light["--accent"]).toBe("#007aff");
    expect(dark["--accent"]).not.toBe("#007aff");
    expect(light["--accent-soft"]).toMatch(/^rgba\(/);
    expect(deriveAccentTokens("not-a-color", "dark")).toEqual({});
  });
});

describe("프로젝트 바인딩 — 창마다 다른 색", () => {
  const custom = theme({ tokens: { "--bg-window": "#141416" } });

  it("창 A(바인딩)와 창 B(무바인딩)가 서로를 덮지 않는다", () => {
    const windowA = resolveThemeAttrs({
      ...base,
      themeSetting: "custom:t1", // 프로젝트 바인딩이 이긴 값
      customThemes: [custom],
    });
    const windowB = resolveThemeAttrs({ ...base, themeSetting: "light", customThemes: [custom] });

    expect(windowA.family).toBe("dark");
    expect(windowA.vars["--bg-window"]).toBe("#141416");
    expect(windowB.family).toBe("light");
    expect(windowB.vars).toEqual({});
  });

  it("가리키는 테마가 사라졌으면 조용히 전역 기본으로 떨어진다", () => {
    const attrs = resolveThemeAttrs({ ...base, themeSetting: "custom:gone", prefersDark: true });
    expect(attrs.family).toBe("dark"); // system → OS 선호
    expect(attrs.preset).toBeNull();
    expect(attrs.resolved).toBe("system");
  });

  it("편집 중 초안은 저장된 무엇보다도 이긴다 (앱이 곧 미리보기)", () => {
    const attrs = resolveThemeAttrs({
      ...base,
      themeSetting: "nord",
      draft: theme({ family: "light", tokens: { "--accent": "#ff7a66" } }),
    });
    expect(attrs.family).toBe("light");
    expect(attrs.preset).toBe("custom");
    expect(attrs.vars["--accent"]).toBe("#ff7a66");
  });
});

// ─── 대비 (a11y) ─────────────────────────────────────────────────────────
//
// jsdom 에는 레이아웃이 없어 axe 의 color-contrast 규칙을 켤 수 없다
// (`a11y_screens.test.tsx` 가 그래서 끈다). 대신 **토큰 값 자체**로 계산한다 —
// 내장 테마의 본문 대비는 순수 산술이라 레이아웃이 필요 없다.

function luminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) throw new Error(`not a hex color: ${hex}`);
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("내장 테마의 본문 대비", () => {
  it("모든 내장 테마가 WCAG AA(4.5:1) 를 넘는다", () => {
    for (const t of BUILTIN_THEMES) {
      const tokens = t.tokens ?? {};
      for (const bg of ["--bg-window", "--bg-content", "--bg-card"]) {
        const ratio = contrast(tokens["--text"], tokens[bg]);
        expect(ratio, `${t.metadata.name} ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("high-contrast 는 AAA(7:1) 기준을 지킨다 — 이 테마의 존재 이유다", () => {
    const hc = BUILTIN_THEMES.find((t) => t.metadata.id === "high-contrast")!;
    const tokens = hc.tokens ?? {};
    expect(contrast(tokens["--text"], tokens["--bg-window"])).toBeGreaterThanOrEqual(7);
    expect(contrast(tokens["--accent"], tokens["--bg-window"])).toBeGreaterThanOrEqual(7);
  });
});
