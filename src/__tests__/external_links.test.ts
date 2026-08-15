import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 2026-08-16 — "Claude 가 준 링크를 누르면 앱 안에서 열린다".
//
// 웹뷰에는 뒤로 가기가 없어서, 그 자리에서 열리면 앱이 그 페이지가 되고 돌아올
// 길이 없다. 바깥 스킴은 전부 OS 기본 앱으로 나가야 한다.

const openUrl = vi.fn((_url: string) => Promise.resolve({ status: "ok", data: null }));
vi.mock("@/lib/bindings", () => ({ commands: { openUrl: (url: string) => openUrl(url) } }));

const { installExternalLinkGuard } = await import("@/lib/externalLinks");

let uninstall: (() => void) | null = null;

beforeEach(() => {
  openUrl.mockClear();
  uninstall = installExternalLinkGuard();
});

afterEach(() => {
  uninstall?.();
  uninstall = null;
  document.body.innerHTML = "";
});

/** 앵커 하나를 붙이고 누른다. 기본 동작이 막혔는지와 함께 돌려준다. */
function clickAnchor(href: string, type: "click" | "auxclick" = "click") {
  const a = document.createElement("a");
  a.setAttribute("href", href);
  a.textContent = "link";
  document.body.appendChild(a);
  const event = new MouseEvent(type, { bubbles: true, cancelable: true });
  a.dispatchEvent(event);
  return event;
}

describe("바깥 링크 가드", () => {
  it("https 링크는 기본 브라우저로 나가고 웹뷰는 움직이지 않는다", () => {
    const event = clickAnchor("https://docs.anthropic.com/");
    expect(openUrl).toHaveBeenCalledWith("https://docs.anthropic.com/");
    expect(event.defaultPrevented).toBe(true);
  });

  it("http·mailto 도 같은 길로 나간다", () => {
    clickAnchor("http://example.com/a");
    clickAnchor("mailto:hi@example.com");
    expect(openUrl.mock.calls.map((c) => c[0])).toEqual([
      "http://example.com/a",
      "mailto:hi@example.com",
    ]);
  });

  it("가운데 클릭(auxclick)도 새 창으로 새지 않는다", () => {
    const event = clickAnchor("https://example.com/", "auxclick");
    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("앵커 안쪽 요소를 눌러도 잡는다 (마크다운은 링크 안에 코드·강조를 넣는다)", () => {
    const a = document.createElement("a");
    a.setAttribute("href", "https://example.com/deep");
    const code = document.createElement("code");
    code.textContent = "readme";
    a.appendChild(code);
    document.body.appendChild(a);

    code.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(openUrl).toHaveBeenCalledWith("https://example.com/deep");
  });

  it("앱 안에서 처리하는 링크는 건드리지 않는다", () => {
    // 문서 뷰어의 상대경로 위키 링크 — 화면이 자기 손으로 연다.
    clickAnchor("./guide.md");
    clickAnchor("#section");
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("화면이 이미 처리했으면(preventDefault) 두 번 열지 않는다", () => {
    const a = document.createElement("a");
    a.setAttribute("href", "https://example.com/");
    document.body.appendChild(a);
    a.addEventListener("click", (e) => e.preventDefault());

    a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("해제하면 더는 가로채지 않는다", () => {
    uninstall?.();
    uninstall = null;
    const event = clickAnchor("https://example.com/");
    expect(openUrl).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
