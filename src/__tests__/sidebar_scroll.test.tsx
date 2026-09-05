import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Sidebar } from "@/components/Sidebar";
import { NAV_ENTRIES } from "@/lib/navRegistry";
import { ko } from "@/i18n/ko";

// ─── 사이드바 넘침 (2026-09-05) ──────────────────────────────────────────
//
// 화면이 16개(+설정)가 되면서 사이드바 자연 높이가 900px 을 넘었고, `.app` 이
// overflow:hidden 이라 낮은 창에서는 발밑(터미널 도크·테마·설정)이 통째로
// 잘려 나갔다 — 있는 줄도 모르는 상태.
//
// jsdom 은 레이아웃을 재지 않아 "잘리지 않는다" 를 픽셀로 단언할 수 없다
// (shell.css 계열의 오래된 한계 — 2026-08-21 단차 건에서도 같았다). 대신
// **구조**를 묻는다: 스크롤 그릇이 있는가, 목록 전부가 그 안에 있는가, 발은
// 그 밖에 남아 있는가. CSS 가 스크롤을 걸 수 있는 형태인지는 그 세 가지가
// 정한다. 값(min-height:0 · flex:1 1 0%)은 CSS 파일에서 직접 읽어 잰다.
const LABELS = {
  terminalDock: ko["sidebar.terminalDock"],
  darkMode: ko["sidebar.darkMode"],
  settings: ko["sidebar.settings"],
};

function renderSidebar(overrides: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  return render(
    <Sidebar
      view="today"
      onNavigate={() => {}}
      projectName="aurora-web"
      projectPath="~/dev/aurora-web"
      onOpenProjectSwitcher={() => {}}
      isDark={false}
      onToggleTheme={() => {}}
      onToggleTerminalDock={() => {}}
      onToggleCollapse={() => {}}
      {...overrides}
    />,
  );
}

function parts(container: HTMLElement) {
  const nav = container.querySelector("nav.sidebar") as HTMLElement;
  const scroll = container.querySelector(".side-nav-scroll") as HTMLElement;
  const foot = container.querySelector(".side-foot") as HTMLElement;
  return { nav, scroll, foot };
}

afterEach(() => cleanup());

describe("Sidebar — overflow scrolls instead of clipping", () => {
  it("puts the scroll region between the fixed head and foot, foot last", () => {
    const { container } = renderSidebar();
    const { nav, scroll, foot } = parts(container);

    expect(scroll).toBeTruthy();
    // 그릇은 사이드바의 직계 자식이어야 flex 로 남은 높이를 받아간다.
    expect(scroll.parentElement).toBe(nav);
    expect(foot.parentElement).toBe(nav);
    // 발은 언제나 바닥 — 스크롤 그릇이 아무리 길어져도 그 아래다.
    expect(nav.lastElementChild).toBe(foot);
    // 프로젝트 스위처는 그릇 **밖**(고정 머리)이다. 안에 있으면 팝오버가
    // 스크롤 그릇에 잘린다.
    expect(scroll.contains(container.querySelector(".proj-switch-wrap"))).toBe(false);
  });

  it("no longer renders the flex:1 spacer", () => {
    // flex:1 짜리 스페이서가 남아 있으면 스크롤 그릇과 남은 높이를 나눠 가져
    // 목록이 반토막 난다. 지운 사실 자체를 잠근다.
    const { container } = renderSidebar();
    expect(container.querySelector(".side-spacer")).toBeNull();
  });

  it("holds every nav entry inside the scroll region", () => {
    const { container } = renderSidebar();
    const { scroll } = parts(container);

    // 개수는 navRegistry 가 정한다 — 여기서 숫자를 못박으면 화면 하나 늘 때마다
    // 이 테스트부터 깨진다. 잠그는 것은 "전부 그릇 안" 이라는 관계다.
    for (const entry of NAV_ENTRIES) {
      // "터미널" 은 발의 도크 토글과 이름이 같다 — 그릇 안에서만 찾는다.
      const row = within(scroll).getByText(ko[entry.labelKey]).closest("button");
      expect(row).toBeTruthy();
      expect(scroll.contains(row)).toBe(true);
    }
    expect(scroll.querySelectorAll(".nav-item").length).toBe(NAV_ENTRIES.length);
  });

  it("keeps the three foot buttons outside the scroll region", () => {
    const { container } = renderSidebar();
    const { scroll, foot } = parts(container);

    // "터미널" 은 nav 항목과 발의 도크 토글 양쪽에 있다 — 발 안에서만 찾는다.
    for (const label of [LABELS.terminalDock, LABELS.darkMode, LABELS.settings]) {
      const btn = within(foot).getByText(label).closest("button");
      expect(btn).toBeTruthy();
      expect(scroll.contains(btn)).toBe(false);
      expect(foot.contains(btn)).toBe(true);
    }
    expect(foot.querySelectorAll("button").length).toBe(3);
  });

  it("keeps the same structure in the collapsed overlay", () => {
    // 접으면 사이드바가 흐름에서 빠져 position:absolute 오버레이가 된다.
    // 짧은 창에서 오버레이가 잘리면 접었을 때만 설정에 못 닿는다.
    const { container } = renderSidebar({ collapsed: true });
    const { nav, scroll, foot } = parts(container);
    expect(scroll.parentElement).toBe(nav);
    expect(nav.lastElementChild).toBe(foot);
    expect(scroll.querySelectorAll(".nav-item").length).toBe(NAV_ENTRIES.length);
  });
});

describe("shell.css — can it actually scroll?", () => {
  // 이 넷은 jsdom 이 절대 못 잡는다(레이아웃이 없다). 그런데 전형적인 실수는
  // 전부 값에 있다 — flex 컬럼에서 min-height:0 을 빠뜨리면 자식이 줄지 않아
  // overflow 를 줘도 스크롤이 안 걸린다. 그래서 값 자체를 잠근다.
  const css = readFileSync(join(__dirname, "..", "styles", "shell.css"), "utf8");
  const block = (selector: string) => {
    const at = css.indexOf(selector + " {");
    expect(at, selector).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf("}", at));
  };

  it("`.sidebar` and `.side-nav-scroll` both zero their flex min-height", () => {
    expect(block(".sidebar")).toMatch(/min-height:\s*0;/);
    expect(block(".side-nav-scroll")).toMatch(/min-height:\s*0;/);
  });

  it("only the nav region scrolls, and it takes the leftover height", () => {
    const scroll = block(".side-nav-scroll");
    expect(scroll).toMatch(/overflow-y:\s*auto;/);
    // flex-basis 0 — 발(.side-foot)을 밀어내지 않고 남는 만큼만 차지한다.
    expect(scroll).toMatch(/flex:\s*1\s+1\s+0%;/);
  });

  it("the head and foot never shrink", () => {
    expect(css).toMatch(/\.side-drag-strip,\s*\n\.side-brand,\s*\n\.proj-switch-wrap,\s*\n\.side-foot\s*\{\s*\n\s*flex:\s*none;/);
  });

  it("the flex:1 spacer rule is gone", () => {
    expect(css).not.toMatch(/^\.side-spacer\s*\{/m);
  });
});

describe("Sidebar — the overflow is visible", () => {
  /** jsdom 에는 레이아웃이 없다 — 넘침을 직접 심어 useEdgeFade 만 잰다. */
  function fakeOverflow(el: HTMLElement, scrollTop: number) {
    Object.defineProperty(el, "scrollHeight", { value: 900, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(el, "scrollTop", { value: scrollTop, configurable: true, writable: true });
    fireEvent.scroll(el);
  }

  it("fades nothing when everything fits", () => {
    const { container } = renderSidebar();
    const { scroll } = parts(container);
    // 레이아웃이 없으면 scrollHeight === clientHeight === 0 = 넘치지 않음.
    expect(scroll.classList.contains("fade-top")).toBe(false);
    expect(scroll.classList.contains("fade-bottom")).toBe(false);
  });

  it("fades only the side that has more", () => {
    const { container } = renderSidebar();
    const { scroll } = parts(container);

    fakeOverflow(scroll, 0); // 맨 위 — 아래로만 더 있다
    expect(scroll.classList.contains("fade-top")).toBe(false);
    expect(scroll.classList.contains("fade-bottom")).toBe(true);

    fakeOverflow(scroll, 200); // 가운데 — 양쪽 다
    expect(scroll.classList.contains("fade-top")).toBe(true);
    expect(scroll.classList.contains("fade-bottom")).toBe(true);

    fakeOverflow(scroll, 500); // 맨 아래 — 위로만 더 있다
    expect(scroll.classList.contains("fade-top")).toBe(true);
    expect(scroll.classList.contains("fade-bottom")).toBe(false);
  });
});
