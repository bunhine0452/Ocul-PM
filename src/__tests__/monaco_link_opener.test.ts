/**
 * Monaco URL ⌘클릭 → OS 브라우저 (2026-09-22).
 *
 * 기본 외부 오프너는 `window.open(url, "_blank", "noopener")` 인데 이 웹뷰(wry)
 * 는 새 창 요청 처리기가 없어 null 을 돌려주고 아무 일도 하지 않는다 — 오류도
 * 없이. 터미널 OSC 8 링크와 같은 부류다 (`terminal_url_links.test.ts`).
 *
 * 여기서 무는 것:
 *  - http/https 만 백엔드 `open_url` 로 간다, 쿼리가 %XX 로 깨지지 않은 채
 *  - 그 밖의 스킴은 `false` — Monaco 의 나머지 오프너(명령 링크)가 받게 둔다
 *  - `setup.ts` 가 실제로 등록한다 (빠지면 기본 오프너로 조용히 되돌아간다)
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createExternalLinkOpener, type LinkResource } from "@/features/code/monaco/linkOpener";

const ROOT = resolve(__dirname, "../..");

/** Monaco `Uri` 흉내 — `toString(true)` 는 인코딩을 건너뛴 원문을 돌려준다. */
function uri(scheme: string, raw: string): LinkResource {
  return {
    scheme,
    toString: (skipEncoding?: boolean) => (skipEncoding ? raw : encodeURIComponent(raw)),
  };
}

describe("createExternalLinkOpener", () => {
  it("http/https 를 백엔드 통로로 보내고 처리했다고 답한다", () => {
    const openUrl = vi.fn();
    const opener = createExternalLinkOpener(openUrl);
    expect(opener.open(uri("https", "https://github.com/x/y/pull/1"))).toBe(true);
    expect(opener.open(uri("http", "http://localhost:5173/"))).toBe(true);
    expect(openUrl).toHaveBeenNthCalledWith(1, "https://github.com/x/y/pull/1");
    expect(openUrl).toHaveBeenNthCalledWith(2, "http://localhost:5173/");
  });

  it("쿼리의 =·& 가 %XX 로 깨지지 않는다 (Monaco 의 toString 함정)", () => {
    const openUrl = vi.fn();
    createExternalLinkOpener(openUrl).open(uri("https", "https://a.b/c?x=1&y=두 번"));
    expect(openUrl).toHaveBeenCalledWith("https://a.b/c?x=1&y=%EB%91%90%20%EB%B2%88");
  });

  it("그 밖의 스킴은 받지 않는다 — 명령 링크 등은 Monaco 몫", () => {
    const openUrl = vi.fn();
    const opener = createExternalLinkOpener(openUrl);
    for (const [scheme, raw] of [
      ["command", "command:editor.action.formatDocument"],
      ["file", "file:///etc/passwd"],
      ["javascript", "javascript:alert(1)"],
      ["mailto", "mailto:a@b.c"],
    ] as const) {
      expect(opener.open(uri(scheme, raw)), raw).toBe(false);
    }
    expect(openUrl).not.toHaveBeenCalled();
  });
});

describe("monaco/setup.ts 배선", () => {
  it("링크 오프너를 등록한다", () => {
    const setup = readFileSync(resolve(ROOT, "src/features/code/monaco/setup.ts"), "utf8");
    expect(setup).toMatch(/monaco\.editor\.registerLinkOpener\(\s*createExternalLinkOpener\(/);
  });
});
