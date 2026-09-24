/**
 * 맥 전용 낱말의 다른 OS 판 (크로스플랫폼 라운드 {#ui-mac-words} · {#ui-followups}).
 *
 * 사전은 맥 문구가 정본이고, Windows·Linux 에서만 `<키>__win` · `<키>__linux` ·
 * `<키>__pc` 가 이긴다(`i18n/index.ts` lookup). 이 표가 지키는 것:
 *  1. macOS 에서는 어떤 키도 판을 보지 않는다 — 맥의 문구는 한 글자도 바뀌지 않는다 (D3).
 *  2. 판은 원래 키가 있어야 하고, 두 언어에 다 있으며, 자리표시자가 같다.
 *  3. Windows·Linux 화면에 맥에만 있는 것(메뉴바·Dock·Finder·키체인·macOS·iTerm2)이
 *     남지 않는다 — 판이 있는 키에 한해.
 *  4. Windows 에서 틀리던 MCP 권고 셋은 Windows 판을 갖는다 — 따르면 MCP 가 하나도
 *     안 남던 문구 (#integ-win-plugin-mcp).
 */
import { afterEach, describe, expect, it } from "vitest";

import { __resetLangForTests, setLangSetting, t, tAll, type I18nKey } from "@/i18n";
import { ko } from "@/i18n/ko";
import { en } from "@/i18n/en";
import { __setPlatformForTests, type Platform } from "@/lib/platform";

const VARIANT = /__(win|linux|pc)$/;
const allKeys = Object.keys(ko) as I18nKey[];
const variantKeys = allKeys.filter((k) => VARIANT.test(k));
const baseKeys = [...new Set(variantKeys.map((k) => k.replace(VARIANT, "") as I18nKey))];

// i18n-ignore-next-line -- 맥 전용 낱말 검출 정규식(검사 재료)
const MAC_WORDS = /메뉴바|상단바|Dock|Finder|키체인|macOS|iTerm2|Terminal\.app|menu bar|keychain/i;

afterEach(() => {
  __resetLangForTests();
});

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("variant table shape", () => {
  it("has variants at all (the table is not silently empty)", () => {
    expect(variantKeys.length).toBeGreaterThan(20);
  });

  it.each(variantKeys)("%s has a base key, an English twin and the same placeholders", (key) => {
    const base = key.replace(VARIANT, "") as I18nKey;
    expect(ko[base], `${base} missing`).toBeTruthy();
    expect(en[key], `en ${key} missing`).toBeTruthy();
    expect(placeholders(ko[key])).toEqual(placeholders(ko[base]));
    expect(placeholders(en[key])).toEqual(placeholders(en[base]));
  });
});

describe("macOS never sees a variant (D3)", () => {
  it.each(["ko", "en"] as const)("%s: t(base) is the dictionary's base value", (lang) => {
    setLangSetting(lang);
    const dict = lang === "ko" ? ko : en;
    for (const base of baseKeys) {
      // t() 는 단축키 표기만 바꾼다 — 맥에서는 원문 그대로다.
      expect(t(base)).toBe(dict[base]);
    }
  });
});

describe("Windows · Linux pick their own words", () => {
  const cases: Array<[Platform, string]> = [
    ["windows", "win"],
    ["linux", "linux"],
  ];

  it.each(cases)("%s: every base key resolves to its own or the shared variant", (platform, tag) => {
    __setPlatformForTests(platform);
    for (const lang of ["ko", "en"] as const) {
      setLangSetting(lang);
      const dict = (lang === "ko" ? ko : en) as Record<string, string>;
      for (const base of baseKeys) {
        const expected = dict[`${base}__${tag}`] ?? dict[`${base}__pc`] ?? dict[base];
        // 단축키 표기(⌘W → Ctrl+W)는 따로 바뀌므로 ⌘ 가 없는 문구만 글자 그대로 본다.
        if (!expected.includes("⌘")) expect(t(base), `${lang} ${base}`).toBe(expected);
      }
    }
  });

  it.each(cases)("%s: no mac-only word survives where a variant exists", (platform) => {
    __setPlatformForTests(platform);
    for (const lang of ["ko", "en"] as const) {
      setLangSetting(lang);
      for (const base of baseKeys) {
        const shown = t(base);
        // 판이 맥 낱말을 일부러 **부정**하는 곳은 없다 — 있으면 그대로 걸린다.
        expect(MAC_WORDS.test(shown), `${lang} ${platform} ${base}: ${shown}`).toBe(false);
      }
    }
  });

  it("the search index sees the words of this OS", () => {
    __setPlatformForTests("windows");
    expect(tAll("term.fileRef.reveal")).toContain(en["term.fileRef.reveal__win"]);
    expect(tAll("term.fileRef.reveal")).not.toContain(en["term.fileRef.reveal"]);
  });
});

describe("Windows MCP advice — following it must leave MCP working", () => {
  const WIN_ONLY: I18nKey[] = ["op.mcp.pluginCovers", "op.mcp.pluginConflict", "op.plugin.warn"];

  it.each(WIN_ONLY)("%s has a Windows variant and Linux keeps the original advice", (key) => {
    const all = ko as Record<string, string>;
    expect(all[`${key}__win`]).toBeTruthy();
    expect(all[`${key}__pc`]).toBeUndefined();
    expect(all[`${key}__linux`]).toBeUndefined();

    __setPlatformForTests("linux");
    setLangSetting("ko");
    expect(t(key)).toBe(ko[key]);
    __setPlatformForTests("windows");
    expect(t(key)).toBe(all[`${key}__win`]);
    // Windows 판은 등록을 권한다 — "해제하라"·"플러그인 하나만" 이 아니다.
    expect(t(key)).toMatch(/MCP/);
    setLangSetting("en");
    expect(t(key)).toMatch(/Windows/);
  });
});
