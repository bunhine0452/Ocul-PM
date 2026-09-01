// Osaurus 라운드 Phase 8 `#landing-themes` — oculpm.com/themes 에 실리는
// 테마 파일의 게이트.
//
// 이 파일들은 **PR 로 들어온다.** 사람이 눈으로 보는 리뷰만으로는 (a) 앱이
// 거부할 토큰, (b) 읽을 수 없는 대비, (c) 갤러리에 실리지 않는 파일을 놓친다.
// 셋 다 여기서 막는다 — 통과하면 다음 배포에 그대로 실린다.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// @ts-expect-error — 빌드 대상이 아닌 zero-dep 생성 스크립트 (.mjs, 타입 없음).
import { familyDefaults } from "../../landing/wiki-src/pages.mjs";
import { ALLOWED_TOKENS } from "@/features/theme/schema";
import type { ThemeFile } from "@/lib/bindings";

const themesDir = join(process.cwd(), "landing", "themes");
const files = readdirSync(themesDir)
  .filter((f) => f.endsWith(".json"))
  .sort();

const themes: Array<[string, ThemeFile]> = files.map((f) => [
  f,
  JSON.parse(readFileSync(join(themesDir, f), "utf8")) as ThemeFile,
]);

/** 백엔드 `is_color_value` 와 같은 규칙 — 통과 못 하면 앱이 임포트를 거부한다. */
function isColorValue(raw: string): boolean {
  const v = raw.trim();
  if (!v || v.length > 64) return false;
  if (v.startsWith("#")) {
    const hex = v.slice(1);
    return [3, 4, 6, 8].includes(hex.length) && /^[0-9a-fA-F]+$/.test(hex);
  }
  const m = v.match(/^(rgb|rgba|hsl|hsla)\((.+)\)$/);
  return !!m && m[2].length > 0 && /^[\d.,%/ +-]+$/.test(m[2]);
}

/** WCAG 상대 휘도. 대비 검사는 불투명 색(hex / rgb)만 대상으로 한다. */
function luminance(color: string): number | null {
  let r: number, g: number, b: number;
  const hex = color.trim().match(/^#([0-9a-fA-F]{6})$/);
  const rgb = color.trim().match(/^rgb\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*\)$/);
  if (hex) {
    const n = parseInt(hex[1], 16);
    [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  } else if (rgb) {
    [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  } else {
    return null; // 반투명(rgba)·hsl 은 배경에 얹혀야 정해진다 — 검사 대상 밖.
  }
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(fg: string, bg: string): number | null {
  const a = luminance(fg);
  const b = luminance(bg);
  if (a === null || b === null) return null;
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

const defaults = familyDefaults(
  readFileSync(join(process.cwd(), "src", "styles", "tokens.css"), "utf8"),
) as { light: Record<string, string>; dark: Record<string, string> };

describe("landing/themes/*.json — 배포 테마 계약", () => {
  test("적어도 한 장은 있다", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test.each(themes)("%s — 앱이 받아들이는 모양이다", (_file, theme) => {
    expect(theme.oculpm_theme).toBe("v1");
    expect(theme.metadata.name.trim()).not.toBe("");
    expect(["light", "dark"]).toContain(theme.family);
    // 내장이 아니다 — 남의 갤러리에서 "내장" 으로 앉으면 지울 수 없게 보인다.
    expect(theme.is_built_in).toBe(false);
    for (const [token, value] of Object.entries(theme.tokens ?? {})) {
      expect(ALLOWED_TOKENS, `${token} 는 테마가 칠할 수 있는 토큰이 아니다`).toContain(token);
      expect(isColorValue(value), `${token}: ${value} 는 색 값이 아니다`).toBe(true);
    }
  });

  test.each(themes)("%s — 본문이 읽힌다 (대비 4.5:1)", (_file, theme) => {
    const fam = theme.family === "light" ? defaults.light : defaults.dark;
    const tok = (name: string) => theme.tokens?.[name] ?? fam[name];
    // 지정하지 않은 색은 가족 기본값을 물려받으므로, 검사도 물려받은 값으로 한다.
    const body = contrast(tok("--text"), tok("--bg-content"));
    expect(body, "--text / --bg-content 대비를 계산할 수 없다").not.toBeNull();
    expect(body as number).toBeGreaterThanOrEqual(4.5);

    const onAccent = contrast(tok("--text-on-accent"), tok("--accent"));
    if (onAccent !== null) expect(onAccent).toBeGreaterThanOrEqual(4.5);
  });

  test.each(themes)("%s — 갤러리 페이지에 실려 있다", (file, theme) => {
    const page = readFileSync(join(process.cwd(), "landing", "themes.html"), "utf8");
    expect(page, `${file} 이 themes.html 에 없다 — node landing/wiki-src/build.mjs`).toContain(
      theme.metadata.name,
    );
    // 딥링크는 https + 화이트리스트 호스트여야 앱이 받는다.
    expect(page).toContain(
      `oculpm://theme/install?url=${encodeURIComponent(`https://oculpm.com/themes/${file}`)}`,
    );
  });
});
