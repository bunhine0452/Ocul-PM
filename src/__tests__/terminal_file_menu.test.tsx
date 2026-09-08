/**
 * 터미널 파일 링크 ⌘클릭 메뉴 (2026-09-07).
 *
 * 예전에는 ⌘클릭이 **곧장** 외부 편집기를 띄웠다. 이제 네 갈래를 사람이
 * 고른다 — 앱 안 편집기 · 빠른 미리보기 · Finder · 외부 편집기.
 *
 * 여기서 무는 것:
 *  - 각 항목이 **자기 커맨드**를 부른다 (경로·줄이 그대로 실린다)
 *  - 앱 안 편집기는 코드 화면의 기존 점프 이벤트를 타고, 줄은 0-based 로 간다
 *  - 떼어낸 터미널 창(코드 화면이 없다)에서는 그 항목 자체가 없다
 *  - 거절 사유를 삼키지 않는다
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

import { NAV_BUS, type OpenEntityDetail } from "@/lib/navRegistry";
import { TerminalFileMenu } from "@/features/terminal/TerminalFileMenu";
import type { FileRefHit } from "@/features/terminal/fileRefLinks";

const calls = {
  quickLook: [] as unknown[][],
  reveal: [] as unknown[][],
  external: [] as unknown[][],
};
let rejectWith: string | null = null;

vi.mock("@/api/fileOpen", () => ({
  fileOpenApi: {
    quickLook: (...a: unknown[]) => {
      calls.quickLook.push(a);
      return rejectWith ? Promise.reject(new Error(rejectWith)) : Promise.resolve(null);
    },
    reveal: (...a: unknown[]) => {
      calls.reveal.push(a);
      return Promise.resolve(null);
    },
    inExternalEditor: (...a: unknown[]) => {
      calls.external.push(a);
      return Promise.resolve(null);
    },
  },
}));

const toasts: string[] = [];
vi.mock("@/lib/toast", () => ({
  toast: { destructive: (m: string) => toasts.push(m), info: (m: string) => toasts.push(m) },
}));

const hit: FileRefHit = {
  path: "docs/naming-engine-design-2026-09.md",
  line: 12,
  rect: { top: 100, bottom: 100, left: 200, right: 200 },
};

function show(overrides: Partial<FileRefHit> = {}) {
  return render(
    <TerminalFileMenu
      hit={{ ...hit, ...overrides }}
      projectRoot="/proj"
      externalEditorCommand='code -g "%path:%line"'
      onClose={() => {}}
    />,
  );
}

beforeEach(() => {
  calls.quickLook.length = 0;
  calls.reveal.length = 0;
  calls.external.length = 0;
  toasts.length = 0;
  rejectWith = null;
  window.history.replaceState({}, "", "/index.html");
});
afterEach(() => cleanup());

describe("터미널 파일 링크 메뉴", () => {
  it("네 갈래를 모두 보여 준다", () => {
    show();
    expect(screen.getAllByRole("menuitem")).toHaveLength(4);
  });

  it("경로와 줄 번호를 머리에 적는다 — 무엇을 눌렀는지 보이게", () => {
    show();
    expect(screen.getByText(`${hit.path}:12`)).toBeTruthy();
  });

  it("빠른 미리보기는 루트와 상대경로를 그대로 넘긴다", () => {
    show();
    fireEvent.click(screen.getByText("빠른 미리보기"));
    expect(calls.quickLook).toEqual([["/proj", hit.path]]);
  });

  it("Finder 항목도 같은 인자로 자기 커맨드를 부른다", () => {
    show();
    fireEvent.click(screen.getByText("Finder 에서 보기"));
    expect(calls.reveal).toEqual([["/proj", hit.path]]);
  });

  it("외부 편집기는 명령 템플릿과 **1-based** 줄을 함께 넘긴다", () => {
    show();
    fireEvent.click(screen.getByText("외부 편집기에서 열기"));
    expect(calls.external).toEqual([["/proj", hit.path, 'code -g "%path:%line"', 12]]);
  });

  it("앱 안 편집기는 코드 화면 점프 이벤트를 쏘고, 줄은 0-based 다", () => {
    const seen: OpenEntityDetail[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent<OpenEntityDetail>).detail);
    window.addEventListener(NAV_BUS.openEntity, listener);
    show();
    fireEvent.click(screen.getByText("ocul-pm 편집기에서 열기"));
    window.removeEventListener(NAV_BUS.openEntity, listener);
    // LSP 규약과 같은 0-based — ShellV2 가 다시 +1 해서 편집기로 보낸다.
    expect(seen).toEqual([{ kind: "code", id: hit.path, line: 11 }]);
  });

  it("줄 번호가 없으면 line 을 싣지 않는다 (파일만 연다)", () => {
    const seen: OpenEntityDetail[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent<OpenEntityDetail>).detail);
    window.addEventListener(NAV_BUS.openEntity, listener);
    show({ line: null });
    fireEvent.click(screen.getByText("ocul-pm 편집기에서 열기"));
    window.removeEventListener(NAV_BUS.openEntity, listener);
    expect(seen).toEqual([{ kind: "code", id: hit.path }]);
  });

  /**
   * 떼어낸 터미널 창에는 셸도 코드 화면도 없다 — 이벤트를 들을 사람이 없어
   * 눌러도 아무 일이 안 일어난다. 그런 항목은 보여 주지 않는다.
   */
  it("분리 터미널 창에서는 앱 안 편집기 항목이 없다", () => {
    window.history.replaceState({}, "", "/index.html?term=3");
    show();
    expect(screen.queryByText("ocul-pm 편집기에서 열기")).toBeNull();
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
  });

  it("거절 사유를 삼키지 않는다", async () => {
    rejectWith = "file does not exist: docs/x.md";
    show();
    fireEvent.click(screen.getByText("빠른 미리보기"));
    await waitFor(() => expect(toasts).toHaveLength(1));
    expect(toasts[0]).toContain("file does not exist");
  });
});
