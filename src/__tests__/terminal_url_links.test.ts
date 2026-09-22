/**
 * 터미널 URL 링크 — OSC 8 하이퍼링크가 우리 통로를 타는가 (2026-09-22).
 *
 * 로그(oculpm.log 2026-09-21T18:59:03)에 3ms 간격으로 붙어 나온 두 줄:
 *   WARN  Opening link blocked as opener could not be cleared
 *   ERROR unhandled rejection: Command plugin:dialog|confirm not allowed by ACL
 * 둘 다 xterm `OscLinkProvider` 의 **기본 처리기**(`confirm()`→`window.open()`)
 * 다. `linkHandler` 옵션이 비어 있으면 OSC 8 링크가 거기로 떨어진다 — Tauri
 * 웹뷰에서는 둘 다 실패해 링크가 열리지 않는다.
 *
 * 여기서 무는 것:
 *  - 처리기가 http/https 만 백엔드 `open_url` 로 보낸다 (그 밖은 조용히 무시)
 *  - hover/leave 가 파일 링크와 같은 밑줄 오버레이를 켜고 끈다
 *  - 실제 xterm 인스턴스가 **생성 뒤에** 이 옵션을 받아들인다 (밑줄은 생성 뒤에
 *    만들어지므로 그 순서로만 붙일 수 있다)
 *  - `TerminalInstanceImpl` 이 실제로 그 옵션을 붙인다 (빠지면 기본 처리기로
 *    되돌아간다 — 회귀가 조용하다)
 */
import { describe, expect, it, vi } from "vitest";
import { Terminal } from "@xterm/xterm";

import {
  activateUrl,
  createOscLinkHandler,
  createWebLinksOptions,
  isOpenableUrl,
} from "@/features/terminal/urlLinks";
import { read } from "./designFs";

const range = { start: { x: 1, y: 3 }, end: { x: 20, y: 3 } };
const click = new MouseEvent("click");

function deps() {
  return {
    openUrl: vi.fn<(uri: string) => void>(),
    underline: { show: vi.fn(), hide: vi.fn(), dispose: vi.fn() },
  };
}

describe("isOpenableUrl", () => {
  it("http/https 만 통과시킨다", () => {
    expect(isOpenableUrl("https://github.com/x/y/pull/1")).toBe(true);
    expect(isOpenableUrl("http://localhost:5173/")).toBe(true);
    expect(isOpenableUrl("  https://example.com  ")).toBe(true);
    expect(isOpenableUrl("HTTPS://EXAMPLE.COM")).toBe(true);
  });

  it("그 밖의 스킴은 막는다 — 특히 javascript:", () => {
    for (const uri of [
      "javascript:alert(1)",
      "file:///Users/me/.ssh/id_rsa",
      "mailto:a@b.c",
      "ftp://host/",
      "example.com",
      "",
    ]) {
      expect(isOpenableUrl(uri), uri).toBe(false);
    }
  });
});

describe("createOscLinkHandler", () => {
  it("activate 가 백엔드 open_url 통로를 부른다 (confirm/window.open 이 아니라)", () => {
    const d = deps();
    const confirmSpy = vi.spyOn(window, "confirm");
    const openSpy = vi.spyOn(window, "open");
    try {
      createOscLinkHandler(d).activate(click, "https://example.com/a?b=1", range);
      expect(d.openUrl).toHaveBeenCalledWith("https://example.com/a?b=1");
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(openSpy).not.toHaveBeenCalled();
    } finally {
      confirmSpy.mockRestore();
      openSpy.mockRestore();
    }
  });

  it("허용되지 않는 스킴은 백엔드까지 가지 않는다", () => {
    const d = deps();
    const h = createOscLinkHandler(d);
    h.activate(click, "javascript:alert(1)", range);
    h.activate(click, "file:///etc/passwd", range);
    expect(d.openUrl).not.toHaveBeenCalled();
    // xterm 이 프로바이더 단계에서 거르는 전제 — 켜면 위 방어선이 유일해진다.
    expect(h.allowNonHttpProtocols).toBe(false);
  });

  it("hover/leave 가 밑줄 오버레이를 켜고 끈다", () => {
    const d = deps();
    const h = createOscLinkHandler(d);
    h.hover?.(click, "https://example.com", range);
    expect(d.underline.show).toHaveBeenCalledWith(range);
    h.leave?.(click, "https://example.com", range);
    expect(d.underline.hide).toHaveBeenCalled();
  });

  it("실제 xterm 인스턴스가 생성 뒤 옵션 대입을 받아들인다", () => {
    const term = new Terminal({ allowProposedApi: true, cols: 80, rows: 24 });
    try {
      expect(term.options.linkHandler).toBeNull();
      const d = deps();
      term.options.linkHandler = createOscLinkHandler(d);
      term.options.linkHandler?.activate(click, "https://example.com", range);
      expect(d.openUrl).toHaveBeenCalledWith("https://example.com");
    } finally {
      term.dispose();
    }
  });
});

describe("createWebLinksOptions", () => {
  it("본문 URL 도 같은 통로·같은 밑줄을 쓴다", () => {
    const d = deps();
    const w = createWebLinksOptions(d);
    w.handler(click, "https://example.com");
    expect(d.openUrl).toHaveBeenCalledWith("https://example.com");
    w.options.hover(click, "https://example.com", range);
    expect(d.underline.show).toHaveBeenCalledWith(range);
    w.options.leave(click, "https://example.com");
    expect(d.underline.hide).toHaveBeenCalled();
  });

  it("activateUrl 은 앞뒤 공백을 다듬어 보낸다", () => {
    const d = deps();
    activateUrl(d, "  https://example.com/x ");
    expect(d.openUrl).toHaveBeenCalledWith("https://example.com/x");
  });
});

describe("TerminalInstanceImpl 배선", () => {
  it("OSC 8 처리기를 붙인다 — 빠지면 xterm 기본 confirm/window.open 으로 되돌아간다", () => {
    const src = read("features/terminal/TerminalInstanceImpl.tsx");
    expect(src).toMatch(/term\.options\.linkHandler\s*=\s*createOscLinkHandler\(/);
    // 본문 URL 도 같은 모듈을 탄다 — 두 갈래가 다른 통로로 갈리지 않게.
    expect(src).toMatch(/new WebLinksAddon\(webLinks\.handler, webLinks\.options\)/);
  });
});
