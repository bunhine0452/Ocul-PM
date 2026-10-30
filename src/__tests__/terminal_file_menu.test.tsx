import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// 터미널 경로 → 「이 파일로 할 일」 (10-31) — 3.x 의 ⌘클릭 메뉴가 4.0 터미널에서 빠졌던 것을 다시.
const h = vi.hoisted(() => ({
  reveal: vi.fn(() => Promise.resolve(null)),
  quickLook: vi.fn(() => Promise.resolve(null)),
  warning: vi.fn(),
}));
vi.mock("@/api/fileOpen", () => ({
  fileOpenApi: { reveal: h.reveal, quickLook: h.quickLook, inExternalEditor: vi.fn() },
}));
vi.mock("@/lib/toast", () => ({ toast: { warning: h.warning, destructive: vi.fn() } }));

import { setLangSetting } from "@/i18n";
import { __setPlatformForTests } from "@/lib/platform";
import type { CellLine } from "@/features/terminal/fileLinks";
import {
  closeFileMenu,
  createFileRefProvider,
  openFileMenu,
  relativeToRoot,
  scanFileRefs,
} from "@/features/terminal/fileRefs";
import { TermFileMenuHost } from "@/features/terminal/TermFileMenu";

afterEach(() => {
  act(() => closeFileMenu());
  cleanup();
  __setPlatformForTests(null);
  h.reveal.mockClear();
  h.quickLook.mockClear();
  h.warning.mockClear();
});

function line(text: string): CellLine {
  const cells = [...text].map((ch) => ({ getChars: () => ch, getWidth: () => 1 }));
  return { length: cells.length, getCell: (x) => cells[x] };
}

describe("fileRefs", () => {
  it("finds project-relative refs with line numbers, not absolute, escaping or URL paths", () => {
    const refs = scanFileRefs("error at src/lib/foo.ts:42:7 and ./b.rs, not /abs/x.ts ../up.ts https://x.dev/a.js");
    expect(refs.map((r) => [r.path, r.line])).toEqual([
      ["src/lib/foo.ts", 42],
      ["b.rs", null],
    ]);
  });

  it("makes absolute paths relative to the project root, and refuses ones outside it", () => {
    expect(relativeToRoot("/repo/src/a.ts", "/repo")).toBe("src/a.ts");
    expect(relativeToRoot("/repo/src/a.ts", "/repo/")).toBe("src/a.ts");
    expect(relativeToRoot("/repo-other/a.ts", "/repo")).toBeNull();
    expect(relativeToRoot("/tmp/a.log", "/repo")).toBeNull();
    expect(relativeToRoot("./src/a.ts", "/repo")).toBe("src/a.ts");
    expect(relativeToRoot("C:\\repo\\src\\a.ts", "C:\\repo")).toBe("src/a.ts");
  });

  it("opens the menu only on ⌘-click — a plain click stays focus and selection", () => {
    __setPlatformForTests("mac");
    const onRef = vi.fn();
    const provider = createFileRefProvider(() => line("at src/a.ts:3"), onRef);
    let links: Parameters<Parameters<typeof provider.provideLinks>[1]>[0];
    provider.provideLinks(1, (l) => (links = l));
    expect(links![0].range).toEqual({ start: { x: 4, y: 1 }, end: { x: 13, y: 1 } });
    links![0].activate({ clientX: 5, clientY: 6, metaKey: false } as MouseEvent, links![0].text);
    expect(onRef).not.toHaveBeenCalled();
    links![0].activate({ clientX: 5, clientY: 6, metaKey: true } as MouseEvent, links![0].text);
    expect(onRef).toHaveBeenCalledWith({ path: "src/a.ts", line: 3, x: 5, y: 6 });
  });
});

describe("TermFileMenu", () => {
  it("shows the file and line, reveals it in Finder and closes; Escape closes too", () => {
    setLangSetting("ko");
    __setPlatformForTests("mac");
    render(<TermFileMenuHost projectRoot="/repo" />);
    act(() => openFileMenu({ path: "/repo/src/a.ts", line: 3, x: 20, y: 20 }));
    const menu = screen.getByRole("menu", { name: "이 파일로 할 일" });
    expect(menu.textContent).toContain("src/a.ts:3");
    expect(screen.getByRole("menuitem", { name: /빠른 미리보기/ })).toBeTruthy();
    // 외부 편집기 명령이 없으면(설정 밖) 그 항목은 없다.
    expect(screen.queryByRole("menuitem", { name: /외부 편집기/ })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: /Finder 에서 보기/ }));
    expect(h.reveal).toHaveBeenCalledWith("/repo", "src/a.ts");
    expect(screen.queryByRole("menu")).toBeNull();

    act(() => openFileMenu({ path: "src/b.ts", line: null, x: 0, y: 0 }));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("does not open for a path outside the project — it says why instead", () => {
    setLangSetting("ko");
    render(<TermFileMenuHost projectRoot="/repo" />);
    act(() => openFileMenu({ path: "/tmp/a.log", line: null, x: 0, y: 0 }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(h.warning).toHaveBeenCalledWith("프로젝트 밖의 파일은 여기서 열지 않아요");
  });
});
