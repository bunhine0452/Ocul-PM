/**
 * 세 OS 로 바꿔 끼운 판정·매칭·표기 표 (크로스플랫폼 라운드 2026-09-23 {#ui-tests}).
 *
 * 사용자는 Windows·Linux 를 직접 볼 수 없다 — 이 표가 "그 OS 에서 무엇을 누르면
 * 무엇이 되는가" 의 명세다. macOS 행은 **예전과 한 글자도 다르지 않다**는 것을
 * 못박는다 (D3). setup.ts 가 매 테스트 전에 맥으로 되돌린다.
 *
 * 테스트 설명은 영어다 — 한글 하드코딩 게이트(scripts/check-no-hardcoded-korean)의
 * 테스트 허용 목록은 레인 소유 밖이라, 한글이 검사 재료인 줄만 i18n-ignore 로 둔다.
 */
import { describe, expect, it } from "vitest";

import { __setPlatformForTests, detectPlatform, dragRegion, type Platform } from "@/lib/platform";
import { isCmdKey, isModKey, isShellKey, kbd, modLabel, readChord, yieldsToShell } from "@/lib/kbd";
import { t, type I18nKey } from "@/i18n";
import { ko } from "@/i18n/ko";
import { en } from "@/i18n/en";
import { buildShortcutGroups } from "@/lib/shortcutRegistry";
import { NAV_ENTRIES, navShortcutLabel } from "@/lib/navRegistry";

const GLYPH = /[⌘⇧⌥⌃]/;
const OTHERS: Platform[] = ["windows", "linux"];

// ── detection ─────────────────────────────────────────────────────────────

describe("detectPlatform — what the three webviews report", () => {
  const table: Array<[string, string, string, Platform]> = [
    [
      "WKWebView (macOS)",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
      "MacIntel",
      "mac",
    ],
    [
      "WebView2 (Windows)",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
      "Win32",
      "windows",
    ],
    [
      "WebKitGTK (Linux)",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)",
      "Linux x86_64",
      "linux",
    ],
    [
      "WebKitGTK spoofing a mac Safari UA still reads as linux (platform wins)",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      "Linux x86_64",
      "linux",
    ],
    ["empty platform falls back to the UA — Windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "", "windows"],
    ["empty platform falls back to the UA — Linux", "Mozilla/5.0 (X11; Linux x86_64)", "", "linux"],
    ["knowing nothing means mac (the only shipped build — unknown must not change labels)", "", "", "mac"],
  ];
  it.each(table)("%s", (_name, ua, platform, expected) => {
    expect(detectPlatform(ua, platform)).toBe(expected);
  });
});

// ── matching ──────────────────────────────────────────────────────────────

function xtermTarget(): HTMLElement {
  const host = document.createElement("div");
  host.className = "xterm";
  const ta = document.createElement("textarea");
  host.appendChild(ta);
  return ta;
}

type KeyInit = Partial<KeyboardEvent> & { key: string; altGraph?: boolean };

function key(init: KeyInit, target: EventTarget | null = document.body) {
  const code =
    init.code ??
    (/^[a-z]$/i.test(init.key) ? `Key${init.key.toUpperCase()}` : /^\d$/.test(init.key) ? `Digit${init.key}` : init.key);
  return {
    key: init.key,
    code,
    metaKey: init.metaKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    altKey: init.altKey ?? false,
    shiftKey: init.shiftKey ?? false,
    target,
    getModifierState: (k: string) => k === "AltGraph" && !!init.altGraph,
  } as unknown as KeyboardEvent;
}

describe("isModKey / isCmdKey — ⌘ on mac, Ctrl elsewhere", () => {
  it("mac: the old expression — ⌘ or ⌃; isCmdKey is ⌘ only", () => {
    __setPlatformForTests("mac");
    expect(isModKey(key({ key: "k", metaKey: true }))).toBe(true);
    expect(isModKey(key({ key: "k", ctrlKey: true }))).toBe(true);
    expect(isCmdKey(key({ key: "k", metaKey: true }))).toBe(true);
    expect(isCmdKey(key({ key: "k", ctrlKey: true }))).toBe(false);
    // mac: focus inside the terminal changes nothing.
    expect(isModKey(key({ key: "k", metaKey: true }, xtermTarget()))).toBe(true);
  });

  it.each(OTHERS)("%s: Ctrl only — the Win/Super key is not the modifier", (os) => {
    __setPlatformForTests(os);
    expect(isModKey(key({ key: "k", ctrlKey: true }))).toBe(true);
    expect(isModKey(key({ key: "k", metaKey: true }))).toBe(false);
    expect(isCmdKey(key({ key: "ArrowLeft", ctrlKey: true, altKey: true }))).toBe(true);
  });

  it.each(OTHERS)("%s: AltGr (arrives as Ctrl+Alt) is not the modifier", (os) => {
    __setPlatformForTests(os);
    // German AltGr+ß types "\" — read as ⌘\ it would jump to the AI screen on every backslash.
    const altGr: KeyInit = { key: "\\", ctrlKey: true, altKey: true, altGraph: true };
    expect(isModKey(key(altGr))).toBe(false);
    expect(readChord(key(altGr)).mod).toBe(false);
  });

  it.each(OTHERS)("%s: inside the terminal (xterm) screen shortcuts do not fire — the shell owns Ctrl", (os) => {
    __setPlatformForTests(os);
    expect(isModKey(key({ key: "s", ctrlKey: true }, xtermTarget()))).toBe(false);
    expect(isModKey(key({ key: "f", ctrlKey: true }, xtermTarget()))).toBe(false);
  });
});

/**
 * Shell-key yield table — key × (mac / win·linux inside terminal / win·linux elsewhere).
 * When `yieldsToShell` is true the app does not intercept (xterm sends it to the PTY).
 */
describe("shell-key yield — Ctrl+C/D/K/L/R/U/W/Z … belong to the shell inside the terminal", () => {
  const shellKeys = ["c", "d", "k", "l", "r", "u", "w", "z", "a", "e", "j", "p", "f", "[", "\\", "]"];

  it.each(shellKeys)("Ctrl+%s — mac: n/a (⌘ and ⌃ differ); win·linux: yield inside terminal only", (k) => {
    __setPlatformForTests("mac");
    expect(yieldsToShell(key({ key: k, ctrlKey: true }, xtermTarget()))).toBe(false);
    for (const os of OTHERS) {
      __setPlatformForTests(os);
      expect(yieldsToShell(key({ key: k, ctrlKey: true }, xtermTarget())), `${os} in-terminal`).toBe(true);
      expect(yieldsToShell(key({ key: k, ctrlKey: true })), `${os} outside`).toBe(false);
      // adding Shift makes it the app's (terminal family).
      expect(yieldsToShell(key({ key: k.toUpperCase(), ctrlKey: true, shiftKey: true }, xtermTarget()))).toBe(false);
    }
  });

  it.each(OTHERS)("%s: digits, comma and slash are not shell keys — nav/settings/cheatsheet work in the terminal", (os) => {
    __setPlatformForTests(os);
    for (const k of ["1", "0", ",", "/"]) {
      expect(yieldsToShell(key({ key: k, ctrlKey: true }, xtermTarget())), k).toBe(false);
      expect(readChord(key({ key: k, ctrlKey: true }, xtermTarget())).mod, k).toBe(true);
    }
  });

  it("isShellKey — every letter plus [ \\ ]", () => {
    for (const k of ["a", "Z", "[", "\\", "]"]) expect(isShellKey(k), k).toBe(true);
    for (const k of ["1", ",", "/", "=", "-", "Enter", "ArrowUp", "Tab"]) expect(isShellKey(k), k).toBe(false);
  });
});

describe("readChord — the terminal family", () => {
  it("mac: same expression the old handlers used { mod: meta||ctrl, shift, alt, key }", () => {
    __setPlatformForTests("mac");
    expect(readChord(key({ key: "d", metaKey: true }), "terminal")).toEqual({ mod: true, shift: false, alt: false, key: "d" });
    expect(readChord(key({ key: "D", metaKey: true, shiftKey: true }), "terminal")).toEqual({
      mod: true,
      shift: true,
      alt: false,
      key: "D",
    });
    expect(readChord(key({ key: "k", ctrlKey: true }, xtermTarget())).mod).toBe(true);
  });

  it.each(OTHERS)("%s: Ctrl+X shell · Ctrl+Shift+X = ⌘X · Ctrl+Alt+Shift+X = ⇧⌘X", (os) => {
    __setPlatformForTests(os);
    expect(readChord(key({ key: "d", ctrlKey: true }), "terminal").mod).toBe(false);
    expect(readChord(key({ key: "D", ctrlKey: true, shiftKey: true }), "terminal")).toEqual({
      mod: true,
      shift: false,
      alt: false,
      key: "d",
    });
    expect(readChord(key({ key: "D", ctrlKey: true, shiftKey: true, altKey: true }), "terminal")).toEqual({
      mod: true,
      shift: true,
      alt: false,
      key: "d",
    });
    // non-shell keys pass through — Ctrl+↑, Ctrl+Shift+Enter.
    expect(readChord(key({ key: "ArrowUp", ctrlKey: true }), "terminal")).toMatchObject({ mod: true, shift: false });
    expect(readChord(key({ key: "Enter", ctrlKey: true, shiftKey: true }), "terminal")).toMatchObject({
      mod: true,
      shift: true,
    });
  });

  it.each(OTHERS)("%s: ordinary screens read Ctrl+X as ⌘X; only xterm focus switches to the terminal family", (os) => {
    __setPlatformForTests(os);
    expect(readChord(key({ key: "k", ctrlKey: true }))).toMatchObject({ mod: true, key: "k" });
    expect(readChord(key({ key: "k", ctrlKey: true }, xtermTarget())).mod).toBe(false);
    expect(readChord(key({ key: "K", ctrlKey: true, shiftKey: true }, xtermTarget()))).toMatchObject({
      mod: true,
      shift: false,
      key: "k",
    });
    // Shift turns [ into { — the code gives it back.
    expect(
      readChord(key({ key: "{", code: "BracketLeft", ctrlKey: true, shiftKey: true }, xtermTarget())),
    ).toMatchObject({ mod: true, shift: false, key: "[" });
  });

  it.each(OTHERS)("%s: a non-Latin layout still yields the Latin letter via `code`", (os) => {
    __setPlatformForTests(os);
    // i18n-ignore-next-line -- 한글 자판의 key 값이 검사 재료다
    expect(readChord(key({ key: "ㅏ", code: "KeyK", ctrlKey: true })).key).toBe("k");
  });
});

// ── labels ────────────────────────────────────────────────────────────────

describe("kbd — label table", () => {
  const table: Array<[string, string, string]> = [
    // [mac notation, Windows·Linux (app), Windows·Linux (terminal)]
    ["⌘K", "Ctrl+K", "Ctrl+Shift+K"],
    ["⇧⌘D", "Ctrl+Shift+D", "Ctrl+Alt+Shift+D"],
    ["⌘D", "Ctrl+D", "Ctrl+Shift+D"],
    ["⌃Tab / ⌃⇧Tab", "Ctrl+Tab / Ctrl+Shift+Tab", "Ctrl+Tab / Ctrl+Shift+Tab"],
    ["⌘⌥← / ⌘⌥→", "Ctrl+Alt+← / Ctrl+Alt+→", "Ctrl+Alt+← / Ctrl+Alt+→"],
    ["⇧⌥F", "Alt+Shift+F", "Alt+Shift+F"],
    ["⇧F12", "Shift+F12", "Shift+F12"],
    ["⌘↑ / ⌘↓", "Ctrl+↑ / Ctrl+↓", "Ctrl+↑ / Ctrl+↓"],
    ["⌘= / ⌘−", "Ctrl+= / Ctrl+−", "Ctrl+= / Ctrl+−"],
    ["⇧⌘0", "Ctrl+Shift+0", "Ctrl+Shift+0"],
    ["⇧⌘↩", "Ctrl+Shift+Enter", "Ctrl+Shift+Enter"],
    ["⌘⌫", "Ctrl+Backspace", "Ctrl+Backspace"],
    ["⌘\\", "Ctrl+\\", "Ctrl+Shift+\\"],
    ["⌘[ / ⌘]", "Ctrl+[ / Ctrl+]", "Ctrl+Shift+[ / Ctrl+Shift+]"],
    ["⌘,", "Ctrl+,", "Ctrl+,"],
    ["⌘1", "Ctrl+1", "Ctrl+1"],
    ["⌥Z", "Alt+Z", "Alt+Z"],
    ["⌃G", "Ctrl+G", "Ctrl+G"],
    ["⌘⇧M", "Ctrl+Shift+M", "Ctrl+Alt+Shift+M"],
    ["⇧Enter", "Shift+Enter", "Shift+Enter"],
    ["Switch project (⌘P)", "Switch project (Ctrl+P)", "Switch project (Ctrl+Shift+P)"],
    [
      "⌘T new tab · ⌘D split · ⇧⌘D split down",
      "Ctrl+T new tab · Ctrl+D split · Ctrl+Shift+D split down",
      "Ctrl+Shift+T new tab · Ctrl+Shift+D split · Ctrl+Alt+Shift+D split down",
    ],
    ["↩ next · ⇧↩ previous", "↩ next · Shift+Enter previous", "↩ next · Shift+Enter previous"],
    // Hangul right after the glyph ("⌘ + number") — it is not a shell key, so no Shift in the terminal.
    ["⌘번호", "Ctrl+번호", "Ctrl+번호"], // i18n-ignore -- 글리프 바로 뒤의 한글이 검사 재료다
    ["F12", "F12", "F12"],
  ];

  it.each(table)("mac returns it untouched: %s", (mac) => {
    __setPlatformForTests("mac");
    expect(kbd(mac)).toBe(mac);
    expect(kbd(mac, "terminal")).toBe(mac);
  });

  it.each(table)("windows·linux: %s → %s / terminal %s", (mac, app, term) => {
    for (const os of OTHERS) {
      __setPlatformForTests(os);
      expect(kbd(mac), os).toBe(app);
      expect(kbd(mac, "terminal"), os).toBe(term);
    }
  });

  it("modLabel", () => {
    __setPlatformForTests("mac");
    expect(modLabel("K")).toBe("⌘K");
    __setPlatformForTests("windows");
    expect(modLabel("K")).toBe("Ctrl+K");
    expect(modLabel("D", "terminal")).toBe("Ctrl+Shift+D");
  });
});

describe("dictionary — t() renders the OS notation", () => {
  const glyphKeys = (Object.keys(ko) as I18nKey[]).filter((k) => GLYPH.test(ko[k]) || GLYPH.test(en[k]));

  it("there are glyph strings to check (an empty sample would prove nothing)", () => {
    expect(glyphKeys.length).toBeGreaterThan(30);
  });

  it("mac: **every** key equals the raw dictionary string, character for character (D3)", () => {
    __setPlatformForTests("mac");
    for (const k of Object.keys(ko) as I18nKey[]) {
      if (/\{\w+\}/.test(ko[k])) continue; // placeholders stay as-is without vars — covered below
      expect(t(k), k).toBe(ko[k]);
    }
    expect(t("term.fontSizeHint", { min: 9, max: 22 })).toBe(
      ko["term.fontSizeHint"].replace("{min}", "9").replace("{max}", "22"),
    );
  });

  it.each(OTHERS)("%s: no glyph string leaves a ⌘⇧⌥⌃ behind", (os) => {
    __setPlatformForTests(os);
    for (const k of glyphKeys) expect(t(k), k).not.toMatch(GLYPH);
  });

  it.each(OTHERS)("%s: term.* use the terminal family — the status bar never advertises the shell's Ctrl+D", (os) => {
    __setPlatformForTests(os);
    expect(t("term.splitRowHint")).toBe(ko["term.splitRowHint"].replace("⌘D", "Ctrl+Shift+D"));
    expect(t("term.splitColHint")).toBe(ko["term.splitColHint"].replace("⇧⌘D", "Ctrl+Alt+Shift+D"));
    expect(t("term.closePaneHint")).toBe(ko["term.closePaneHint"].replace("⌘W", "Ctrl+Shift+W"));
    expect(t("term.dock.closeHint")).toContain("Ctrl+Shift+J");
    expect(t("term.shortcuts")).toBe(
      ko["term.shortcuts"]
        .replace("⌘T", "Ctrl+Shift+T")
        .replace("⇧⌘D", "Ctrl+Alt+Shift+D")
        .replace("⌘D", "Ctrl+Shift+D")
        .replace("⇧⌘↩", "Ctrl+Shift+Enter")
        .replace("⌘F", "Ctrl+Shift+F")
        .replace("⌘L", "Ctrl+Shift+L")
        .replace("⌘W", "Ctrl+Shift+W"),
    );
    // strings outside the terminal use the plain notation.
    expect(t("sidebar.switchProject")).toBe(ko["sidebar.switchProject"].replace("⌘P", "Ctrl+P"));
  });
});

describe("cheatsheet and nav numbers — OS notation", () => {
  it("mac: as written (⌘1, ⌘K); no Windows/Linux-only rows", () => {
    __setPlatformForTests("mac");
    expect(navShortcutLabel(NAV_ENTRIES[0].id)).toBe("⌘1");
    const groups = buildShortcutGroups();
    const all = groups.flatMap((g) => g.rows.map((r) => r.keys));
    expect(all).toContain("⌘K");
    expect(all).toContain("⇧⌘N");
    expect(all.some((k) => k.startsWith("Ctrl+"))).toBe(false);
  });

  it.each(OTHERS)("%s: every row loses its glyphs; keys the OS lacks are dropped", (os) => {
    __setPlatformForTests(os);
    expect(navShortcutLabel(NAV_ENTRIES[0].id)).toBe("Ctrl+1");
    const groups = buildShortcutGroups();
    for (const g of groups) {
      for (const r of g.rows) expect(r.keys, `${g.id} ${r.labelKey}`).not.toMatch(GLYPH);
    }
    const byLabel = new Map(groups.flatMap((g) => g.rows.map((r) => [`${g.id}:${r.labelKey}`, r.keys] as const)));
    expect(byLabel.get("global:keys.palette")).toBe("Ctrl+K");
    expect(byLabel.get("terminal:keys.termSplit")).toBe("Ctrl+Shift+D");
    expect(byLabel.get("terminal:keys.termSplitDown")).toBe("Ctrl+Alt+Shift+D");
    expect(byLabel.get("terminal:keys.termClosePane")).toBe("Ctrl+Shift+W");
    expect(byLabel.get("terminal:keys.termCopyPaste")).toBe("Ctrl+Shift+C / Ctrl+Shift+V");
    expect(byLabel.get("window:keys.closeWindow")).toBe("Alt+F4");
    expect(byLabel.has("window:keys.newWindow")).toBe(false);
    // no duplicate chord inside a group (polish_phase2's rule, on this OS too).
    for (const g of groups) {
      const keys = g.rows.map((r) => r.keys);
      expect(new Set(keys).size, g.id).toBe(keys.length);
    }
  });
});

describe("window chrome — drag regions only on macOS", () => {
  it("mac gets data-tauri-drag-region; Windows·Linux get nothing (native title bar)", () => {
    __setPlatformForTests("mac");
    expect(dragRegion()).toEqual({ "data-tauri-drag-region": true });
    for (const os of OTHERS) {
      __setPlatformForTests(os);
      expect(dragRegion()).toEqual({});
    }
  });
});
