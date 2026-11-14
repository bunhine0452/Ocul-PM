/**
 * 열자마자 서는 창 (11-15).
 *
 * 새 창마다 1.06초 고정 타이머의 스플래시가 내용을 가렸다 — ⇧⌘N · ⌥⌘숫자 · ⌘K 프로젝트 · 창 정리가 모두
 * 1초씩 늦었다. 이제 스플래시는 앱 콜드 스타트의 첫 창(`main`)에서, 첫 내용이 300ms 안에 안 설 때만
 * 뜨고, 끝은 시계가 아니라 첫 내용이다. 테마는 설정을 읽자마자 첫 렌더 전에 단다 — 설정이 어둡게 ·
 * OS 가 밝게면 밝은 판이 먼저 그려졌다 뒤집혔다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

vi.mock("@/lib/bindings", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/bindings")>();
  return { ...orig, commands: { ...orig.commands, settingsGetAll: vi.fn() } };
});

import { BOOT_FIRST_CONTENT, BOOT_SHOW_AFTER_MS, BootSplash } from "@/components/BootSplash";
import { applyBootTheme, bootSettings } from "@/contexts/SettingsContext";
import { commands } from "@/lib/bindings";

import { read } from "./designFs";

const FAKE: Parameters<typeof vi.useFakeTimers>[0] = {
  toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"],
};
const splash = () => document.querySelector(".boot-splash");

/** `ms` 를 10ms 씩 흘리며 스플래시가 DOM 에 있었는지 적는다 — 한 프레임이라도 그려지면 남는다. */
function advance(ms: number, seen: boolean[] = []): boolean[] {
  for (let t = 0; t < ms; t += 10) {
    act(() => {
      vi.advanceTimersByTime(10);
    });
    seen.push(splash() != null);
  }
  return seen;
}
function firstContent(cls: string) {
  const el = document.createElement("div");
  el.className = cls;
  document.body.appendChild(el);
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  for (const el of document.querySelectorAll("body > .topbar, body > .start, body > .err-card")) el.remove();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-accent");
});

describe("splash — only when the first window is slow", () => {
  it("first content at 100ms → the splash never paints", () => {
    vi.useFakeTimers(FAKE);
    render(<BootSplash label="main" />);
    const seen = advance(100);
    firstContent("topbar");
    advance(1500, seen);
    expect(seen.some(Boolean)).toBe(false);
    expect(BOOT_SHOW_AFTER_MS).toBe(300);
  });

  it("first content at 400ms → painted at 300ms, gone the moment content stands (no 1060ms clock)", () => {
    vi.useFakeTimers(FAKE);
    render(<BootSplash label="main" />);
    const before = advance(290);
    expect(before.some(Boolean)).toBe(false);
    advance(110);
    expect(splash()).not.toBeNull();
    firstContent("start");
    // 다음 프레임(16ms) 안에 걷힌다.
    advance(20);
    expect(splash()).toBeNull();
  });

  it("the end is the content, not a clock — still up after 2s without content", () => {
    vi.useFakeTimers(FAKE);
    render(<BootSplash label="main" />);
    advance(2000);
    expect(splash()).not.toBeNull();
    firstContent("err-card");
    advance(20);
    expect(splash()).toBeNull();
  });

  it("gives up after 10s with nothing and stops the rAF loop", () => {
    vi.useFakeTimers(FAKE);
    render(<BootSplash label="main" />);
    advance(10_020);
    expect(splash()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("the first-content selector names real roots — TopBar · StartWindow · ErrorCard (other lanes' markup)", () => {
    // 이 이름들이 바뀌면 콜드 스타트마다 스플래시(fixed · 불투명)가 10초 give-up 까지 창을 덮는다 — 조용히.
    expect(BOOT_FIRST_CONTENT).toBe(".topbar, .start, .err-card");
    expect(read("features/shell/TopBar.tsx"), "BOOT_FIRST_CONTENT .topbar").toMatch(/<header\s+className="topbar"/);
    expect(read("features/start/StartWindow.tsx"), "BOOT_FIRST_CONTENT .start").toMatch(/className=\{"start"/);
    expect(read("components/ErrorCard.tsx"), "BOOT_FIRST_CONTENT .err-card").toMatch(/"card err-card"/);
  });

  it("a window whose label is not main (opened later) never has one", () => {
    vi.useFakeTimers(FAKE);
    render(<BootSplash label="win-2" />);
    expect(vi.getTimerCount()).toBe(0);
    const seen = advance(2000);
    expect(seen.some(Boolean)).toBe(false);
  });

  it("reduced motion still shows a slow start — as a still mark", () => {
    const mm = vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
    );
    vi.useFakeTimers(FAKE);
    render(<BootSplash label="main" />);
    advance(400);
    expect(splash()).not.toBeNull();
    mm.mockRestore();

    const css = read("components/bootsplash.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*)\}\s*$/.exec(css)?.[1] ?? "";
    expect(reduced).toMatch(/\.boot-arc,[\s\S]*animation: none;/);
    expect(reduced).toMatch(/\.boot-ripple \{ display: none; \}/);
    // 예전처럼 스플래시를 통째로 감추지 않는다 — 늦게 뜨는 창이 빈 판이 된다.
    expect(reduced).not.toMatch(/\.boot-splash \{ display: none/);
    // 스스로 사라지는 퇴장 애니메이션(시계)은 없다.
    expect(css).not.toMatch(/bootOut/);
  });
});

describe("theme before the first render", () => {
  it("settings dark · OS light → data-theme dark before the first render", async () => {
    vi.mocked(commands.settingsGetAll).mockResolvedValue({
      status: "ok",
      data: [
        ["theme", "dark"],
        ["color_theme", "blue"],
        ["language", "en"],
      ],
    });
    // OS 는 밝게 (setup 의 matchMedia 는 늘 matches: false).
    expect(window.matchMedia("(prefers-color-scheme: dark)").matches).toBe(false);
    expect(document.getElementById("root")).toBeNull();
    const lang = await bootSettings();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-accent")).toBe("blue");
    // 같은 조회가 언어도 돌려준다 — 두 번 묻지 않는다.
    expect(lang).toBe("en");
    expect(commands.settingsGetAll).toHaveBeenCalledTimes(1);
  });

  it("system follows the OS · nothing is set when settings cannot be read", async () => {
    const root = document.createElement("html");
    applyBootTheme([["theme", "system"]], root, true);
    expect(root.getAttribute("data-theme")).toBe("dark");
    applyBootTheme([], root, false);
    expect(root.getAttribute("data-theme")).toBe("light");
    expect(root.getAttribute("data-accent")).toBe("green");

    vi.mocked(commands.settingsGetAll).mockResolvedValue({ status: "error", error: "db" });
    expect(await bootSettings()).toBeNull();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("main.tsx renders only after reading settings and setting the theme", () => {
    const main = read("main.tsx");
    expect(main).toMatch(/bootI18n\(async \(\) => \(isWebview \? bootSettings\(\) : null\)\)\.then\(renderApp\);/);
  });
});
