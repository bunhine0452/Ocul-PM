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
 *
 * 2026-10-09 — `file://` 갈래 (이미지 미리보기·파일 메뉴):
 *  - `file://` 는 화면으로만 간다 — 브라우저(`open_url`)로는 절대 안 간다
 *  - 받을 곳이 없으면 밑줄도 없다 (눌러도 아무 일 없는 밑줄은 거짓말)
 *  - 열 수 없는 스킴(`javascript:`)은 밑줄도 안 긋는다
 */
import { describe, expect, it, vi } from "vitest";
import { Terminal, type ILink, type ILinkProvider } from "@xterm/xterm";

import {
  activateUrl,
  createOscLinkHandler,
  createWebLinksOptions,
  fileUriToPath,
  isOpenableUrl,
  type FileLinkEvent,
} from "@/features/terminal/urlLinks";
import { read } from "./designFs";

const range = { start: { x: 1, y: 3 }, end: { x: 20, y: 3 } };
const click = new MouseEvent("click", { clientX: 40, clientY: 70 });

function deps(onFileLink?: (e: FileLinkEvent) => void) {
  return {
    openUrl: vi.fn<(uri: string) => void>(),
    underline: { show: vi.fn(), hide: vi.fn(), dispose: vi.fn() },
    getFileLink: () => onFileLink,
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
    const d = deps(vi.fn());
    const h = createOscLinkHandler(d);
    h.activate(click, "javascript:alert(1)", range);
    h.activate(click, "file:///etc/passwd", range);
    h.activate(click, "vscode://file/x", range);
    expect(d.openUrl).not.toHaveBeenCalled();
    // `file://` 를 받으려고 켰다 — 그래서 위 방어선이 유일한 거름망이다.
    expect(h.allowNonHttpProtocols).toBe(true);
  });

  it("열 수 없는 스킴에는 밑줄을 긋지 않는다", () => {
    const d = deps(vi.fn());
    createOscLinkHandler(d).hover?.(click, "javascript:alert(1)", range);
    expect(d.underline.show).not.toHaveBeenCalled();
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

describe("fileUriToPath", () => {
  it("퍼센트 인코딩을 풀고 절대경로만 돌려준다", () => {
    expect(fileUriToPath("file:///private/tmp/a%20b/%ED%95%9C.png")).toBe("/private/tmp/a b/한.png");
    expect(fileUriToPath("file://localhost/Users/me/x.png")).toBe("/Users/me/x.png");
    expect(fileUriToPath("file:///C:/Users/me/x.png")).toBe("C:/Users/me/x.png");
  });

  it("파일이 아니거나 남의 호스트·깨진 인코딩이면 null", () => {
    expect(fileUriToPath("https://example.com/x.png")).toBeNull();
    expect(fileUriToPath("file://evil-host/share/x.png")).toBeNull();
    expect(fileUriToPath("file:///tmp/%E0%A4%A.png")).toBeNull();
    expect(fileUriToPath("not a url")).toBeNull();
  });
});

describe("OSC 8 file:// 갈래", () => {
  const shot = "file:///private/tmp/claude-501/scratchpad/people_lineup_spring.png";

  it("이미지 링크는 화면으로 간다 — 올리면 hover, 누르면 open, 브라우저로는 안 간다", () => {
    const seen: FileLinkEvent[] = [];
    const d = deps((e) => seen.push(e));
    const h = createOscLinkHandler(d);
    h.hover?.(click, shot, range);
    h.leave?.(click, shot, range);
    h.activate(click, shot, range);
    const path = "/private/tmp/claude-501/scratchpad/people_lineup_spring.png";
    expect(seen).toEqual([
      { kind: "hover", path, image: true, x: 40, y: 70 },
      { kind: "leave" },
      { kind: "open", path, image: true, x: 40, y: 70 },
    ]);
    expect(d.underline.show).toHaveBeenCalledWith(range);
    expect(d.openUrl).not.toHaveBeenCalled();
  });

  it("이미지가 아닌 파일도 화면으로 간다 (파일 메뉴) — image=false", () => {
    const seen: FileLinkEvent[] = [];
    createOscLinkHandler(deps((e) => seen.push(e))).activate(click, "file:///proj/src/main.rs", range);
    expect(seen).toEqual([{ kind: "open", path: "/proj/src/main.rs", image: false, x: 40, y: 70 }]);
  });

  it("받을 곳이 없으면 밑줄도 반응도 없다", () => {
    const d = deps(undefined);
    const h = createOscLinkHandler(d);
    h.hover?.(click, shot, range);
    h.activate(click, shot, range);
    expect(d.underline.show).not.toHaveBeenCalled();
    expect(d.openUrl).not.toHaveBeenCalled();
  });
});

/**
 * 좁은 터미널 — Claude Code 는 경로를 열(column) 안에서 줄을 넘겨 찍는다.
 *
 * 바이트 모양은 실측이다 (Claude Code 2.1.292, 14칸 pty, FORCE_HYPERLINK=1):
 * 줄마다 **같은 id·같은 전체 URL 로 OSC 8 을 다시 연다** —
 *   `ESC]8;id=zaxmda;https://…/security BEL` `Security ` `ESC]8;; BEL` CRLF
 *   `ESC]8;id=zaxmda;https://…/security BEL` `guide` `ESC]8;; BEL`
 * 그래서 어느 줄 조각에 올려도 전체 경로가 와야 한다. 앱과 같은 길(코어의
 * OSC 프로바이더 → 우리 linkHandler)을 그대로 지난다.
 */
describe("줄을 넘긴 이미지 경로", () => {
  const path = "/private/tmp/claude-501/-Users-me-Desktop-app/22fae75a-56cc/scratchpad/flat/ref/people_lineup_spring.png";
  const open = `\x1b]8;id=k3v9qa;file://${path}\x07`;
  const close = "\x1b]8;;\x07";
  // 스크린샷 그대로 — 1행 `›` 옆에 앞 조각, 2행 `[image]` 옆에 뒤 조각과 크기.
  const bytes =
    `  \u203a       ${open}/private/tmp/claude-501/-Users-me-Desktop-app/22fae75${close}\r\n` +
    `  [image] ${open}a-56cc/scratchpad/flat/ref/people_lineup_spring.png${close}   (1.9MB)\r\n`;

  function oscProvider(term: Terminal): ILinkProvider {
    // xterm 내부 — 코어가 생성자에서 첫 번째로 등록하는 프로바이더가 OSC 8 이다.
    const core = (term as unknown as { _core: { _linkProviderService: { linkProviders: ILinkProvider[] } } })._core;
    return core._linkProviderService.linkProviders[0];
  }

  const linksAt = (provider: ILinkProvider, y: number) =>
    new Promise<ILink[]>((resolve) => provider.provideLinks(y, (links) => resolve(links ?? [])));

  it("두 줄 조각 모두 전체 경로의 이미지 링크다", async () => {
    const term = new Terminal({ allowProposedApi: true, cols: 80, rows: 24 });
    try {
      const seen: FileLinkEvent[] = [];
      term.options.linkHandler = createOscLinkHandler(deps((e) => seen.push(e)));
      await new Promise<void>((resolve) => term.write(bytes, resolve));
      const provider = oscProvider(term);
      const rows = [await linksAt(provider, 1), await linksAt(provider, 2)];
      for (const [i, links] of rows.entries()) {
        expect(links, `행 ${i + 1}`).toHaveLength(1);
        expect(links[0].text).toBe(`file://${path}`);
        expect(links[0].range.start.y).toBe(i + 1);
        links[0].activate(click, links[0].text);
      }
      expect(seen).toEqual([
        { kind: "open", path, image: true, x: 40, y: 70 },
        { kind: "open", path, image: true, x: 40, y: 70 },
      ]);
      // 크기 `(1.9MB)` 는 링크 밖이다.
      const second = rows[1][0].range;
      expect(second.start.x).toBe(11);
      expect(second.end.x).toBe(11 + "a-56cc/scratchpad/flat/ref/people_lineup_spring.png".length - 1);
    } finally {
      term.dispose();
    }
  });
});
