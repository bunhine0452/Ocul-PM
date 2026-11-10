/**
 * OS 판정 — **여기가 단일 창구다** (크로스플랫폼 라운드 2026-09-23 {#ui-platform}).
 *
 * 예전에는 `navigator.platform.toUpperCase().includes("MAC")` 가 창·셸·시작
 * 화면·분리 터미널 네 곳에 따로 있었다. 수정키 표기(⌘ ↔ Ctrl+)와 단축키 매칭,
 * 창 크롬(신호등 여백·드래그 영역)이 전부 이 한 답을 봐야 서로 어긋나지 않는다.
 *
 * 새 Tauri 플러그인(os)을 들이지 않는다 — 세 웹뷰가 각자 자기를 밝힌다:
 *
 *   macOS   WKWebView   platform "MacIntel"      UA "(Macintosh; Intel Mac OS X …)"
 *   Windows WebView2    platform "Win32"         UA "(Windows NT 10.0; Win64; x64) … Edg/…"
 *   Linux   WebKitGTK   platform "Linux x86_64"  UA "(X11; Linux x86_64) AppleWebKit/…"
 *
 * `navigator.platform` 을 **먼저** 본다. 폐기 예고된 API 지만 세 엔진 모두 값을
 * 채우고, WebKitGTK 는 사이트 호환 때문에 UA 를 macOS Safari 로 꾸미는 일이 있어
 * UA 만 믿으면 리눅스가 맥으로 보일 수 있다. platform 이 비어 있을 때(jsdom 등)만
 * UA 로 간다. 둘 다 모르면 **맥**이다 — 지금까지 출시된 유일한 판이라, 모름이
 * 표기·동작을 바꾸지 않는 쪽이다 (D3: macOS 는 한 글자도 바뀌지 않는다).
 */

export type Platform = "mac" | "windows" | "linux";

function fromPlatformString(raw: string): Platform | null {
  const p = raw.toLowerCase();
  if (!p) return null;
  if (p.startsWith("win")) return "windows";
  if (p.startsWith("mac") || p === "iphone" || p === "ipad" || p === "ipod") return "mac";
  if (p.includes("linux") || p.includes("x11") || p.includes("freebsd") || p.includes("openbsd")) {
    return "linux";
  }
  return null;
}

function fromUserAgent(raw: string): Platform | null {
  if (/Windows/i.test(raw)) return "windows";
  if (/Macintosh|Mac OS X|iPhone|iPad/i.test(raw)) return "mac";
  if (/Linux|X11|CrOS|FreeBSD|OpenBSD/i.test(raw)) return "linux";
  return null;
}

/** 순수 판정 — 표 테스트가 실제 세 웹뷰의 (UA, platform) 쌍으로 부른다. */
export function detectPlatform(userAgent: string, platform = ""): Platform {
  return fromPlatformString(platform) ?? fromUserAgent(userAgent) ?? "mac";
}

let cached: Platform | null = null;
let forced: Platform | null = null;

/** 이 웹뷰가 도는 OS. 한 번 재고 기억한다 (실행 중에 OS 가 바뀔 일은 없다). */
export function getPlatform(): Platform {
  if (forced) return forced;
  if (cached) return cached;
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  cached = detectPlatform(nav?.userAgent ?? "", nav?.platform ?? "");
  return cached;
}

export function isMac(): boolean {
  return getPlatform() === "mac";
}

/**
 * 앱이 제목줄을 그리는 OS인가 — macOS 와 Windows (2026-11-10).
 *
 * macOS 창은 titleBarStyle "Overlay" 라 제목줄이 없고, 셸 윗줄이 그 자리다 — 신호등은
 * OS 가 그 위에 얹는다. Windows 창은 제목줄이 아예 없다(`decorations: false`,
 * `tauri.windows.conf.json` · `window/lifecycle.rs`) — 윗줄이 제목줄이고 최소화 · 최대화 ·
 * 닫기 단추는 앱이 그린다(`windows/CaptionButtons.tsx`). 예전(크로스플랫폼 라운드)에는
 * Windows 도 네이티브 제목줄이었다 — 44px 윗줄 위에 30px 띠가 하나 더 섰고, 다크 테마에서도
 * 그 띠만 흰색이었다. Linux 는 네이티브 제목줄 그대로다(창 관리자마다 단추 자리와 모양이 달라
 * 앱이 흉내 내면 반드시 하나는 어긋난다).
 */
export function drawsOwnTitleBar(): boolean {
  const p = getPlatform();
  return p === "mac" || p === "windows";
}

/** 창 단추 셋(최소화 · 최대화 · 닫기)을 앱이 그리는가 — Windows 만. macOS 는 OS 의 신호등이다. */
export function drawsCaptionButtons(): boolean {
  return getPlatform() === "windows";
}

/**
 * 창 드래그 영역 속성 — 앱이 제목줄을 그리는 OS(macOS · Windows)에서만 단다 ({#ui-chrome}).
 *
 * 그 OS 에서는 툴바·윗줄의 빈 곳이 제목줄 역할을 한다(끌어서 옮기기 · 두 번 눌러 확대 ·
 * Windows 는 화면 가장자리로 끌어 스냅). Linux 는 네이티브 제목줄이 있다 — 거기에 툴바까지
 * 드래그 영역이면 버튼 옆 빈 곳을 누르다 창이 끌리고, 두 번 누르면 창이 최대화된다. 그 OS
 * 사용자가 기대하지 않는 동작이다.
 *
 * `<div {...dragRegion()}>` 로 쓴다 — 렌더 때 판정하므로 테스트가 OS 를 바꿔
 * 끼우면 그대로 따라온다.
 */
export function dragRegion(): { "data-tauri-drag-region"?: true } {
  return drawsOwnTitleBar() ? { "data-tauri-drag-region": true } : {};
}

/**
 * 테스트 전용 — OS 를 바꿔 끼운다. `null` 이면 실제 판정으로 돌아간다.
 *
 * vitest 셋업이 매 테스트 전에 `"mac"` 으로 되돌린다: jsdom 의 platform 은 빈
 * 문자열이고 UA 는 호스트 OS(`(darwin)`·`(win32)`)를 담아, 그대로 두면 같은
 * 스위트가 macOS 에서는 ⌘K 를, Windows 러너에서는 Ctrl+K 를 보게 된다.
 */
export function __setPlatformForTests(platform: Platform | null): void {
  forced = platform;
}
