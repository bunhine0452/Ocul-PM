// Finder → 코드 트리 파일 들여오기 — "어디에 놓이는가" 규칙(순수)과, 드롭·⌘V
// 두 창구가 같은 커맨드로 합류하는지(훅).
//
// Tauri 의 드래그드롭 구독을 목으로 갈아끼워 이벤트를 직접 발화시킨다 — jsdom 에
// 실제 OS 드롭은 없고, 검사하려는 것은 좌표→목적지 변환과 합류 지점이다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import { importDestDir, destLabel } from "@/features/code/importTarget";

type DropPayload =
  | { type: "enter" | "over"; position: { x: number; y: number }; paths: string[] }
  | { type: "drop"; position: { x: number; y: number }; paths: string[] }
  | { type: "leave" };

const fx: {
  imports: Array<{ destDir: string; sources: string[] }>;
  clipboard: string[];
  emit: ((p: DropPayload) => void) | null;
} = { imports: [], clipboard: [], emit: null };

vi.mock("@/lib/bindings", () => ({
  commands: {
    codeImport: (_p: number, destDir: string, sources: string[]) => {
      fx.imports.push({ destDir, sources });
      return Promise.resolve({
        status: "ok" as const,
        data: { imported: sources.map((s) => s.split("/").pop() ?? s), skipped: [], truncated: false },
      });
    },
    codeClipboardFiles: () => Promise.resolve({ status: "ok" as const, data: fx.clipboard }),
  },
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (cb: (e: { payload: DropPayload }) => void) => {
      fx.emit = (p) => cb({ payload: p });
      return Promise.resolve(() => {
        fx.emit = null;
      });
    },
  }),
}));

import { useCodeImport, TREE_DIR_ATTR, TREE_PATH_ATTR } from "@/features/code/useCodeImport";

describe("importDestDir", () => {
  it("lands in the folder itself, and folds a file to its parent", () => {
    expect(importDestDir({ path: "src/features", isDir: true }, null)).toBe("src/features");
    // 파일 위에 놓는 것은 "그 옆에" 라는 뜻이다.
    expect(importDestDir({ path: "src/main.ts", isDir: false }, null)).toBe("src");
    expect(importDestDir({ path: "top.ts", isDir: false }, null)).toBe("");
  });

  it("falls back to the selection, then to the project root", () => {
    expect(importDestDir(null, { path: "docs/img", isDir: true })).toBe("docs/img");
    expect(importDestDir(null, { path: "docs/a.md", isDir: false })).toBe("docs");
    expect(importDestDir(null, null)).toBe("");
    // 커서가 이긴다 — 드래그 중에는 눈이 가 있는 곳이 답이다.
    expect(importDestDir({ path: "lib", isDir: true }, { path: "docs/a.md", isDir: false })).toBe("lib");
  });

  it("labels the root by name — an empty path cannot go on screen", () => {
    expect(destLabel("", "my-app")).toBe("my-app");
    expect(destLabel("src/lib", "my-app")).toBe("src/lib");
  });
});

/** 훅만 돌리는 껍데기 — 트리 행 두 줄을 실제 DOM 에 세워 좌표 조회가 걸리게 한다. */
function Harness({ selected }: { selected: { path: string; isDir: boolean } | null }) {
  const { dropDir, pasteFiles } = useCodeImport({
    projectId: 1,
    isVisible: () => true,
    selected,
    rootName: "my-app",
    onImported: () => {},
  });
  return (
    <div>
      <button type="button" data-testid="paste" onClick={pasteFiles} />
      <span data-testid="dropdir">{dropDir === null ? "(none)" : `[${dropDir}]`}</span>
    </div>
  );
}

describe("useCodeImport", () => {
  let row: HTMLElement;

  beforeEach(() => {
    fx.imports = [];
    fx.clipboard = [];
    // 좌표 아래에 놓일 트리 행. elementFromPoint 는 jsdom 이 레이아웃을 몰라
    // 항상 null 이라, 이 테스트에서 직접 답하게 한다.
    row = document.createElement("div");
    row.setAttribute(TREE_PATH_ATTR, "src/features");
    row.setAttribute(TREE_DIR_ATTR, "1");
    document.body.appendChild(row);
    document.elementFromPoint = () => row;
  });
  afterEach(() => {
    row.remove();
    cleanup();
  });

  it("imports into the dropped folder and lights it up while dragging", async () => {
    const { getByTestId } = render(<Harness selected={null} />);
    await act(async () => {});

    await act(async () => {
      fx.emit?.({ type: "over", position: { x: 100, y: 200 }, paths: [] });
    });
    expect(getByTestId("dropdir").textContent).toBe("[src/features]");

    await act(async () => {
      fx.emit?.({ type: "drop", position: { x: 100, y: 200 }, paths: ["/Users/me/a.png"] });
    });
    expect(fx.imports).toEqual([{ destDir: "src/features", sources: ["/Users/me/a.png"] }]);
    // 놓고 나면 표시는 사라진다.
    expect(getByTestId("dropdir").textContent).toBe("(none)");
  });

  it("ignores a drop outside the tree", async () => {
    document.elementFromPoint = () => null;
    render(<Harness selected={null} />);
    await act(async () => {});
    await act(async () => {
      fx.emit?.({ type: "over", position: { x: 5, y: 5 }, paths: [] });
    });
    await act(async () => {
      fx.emit?.({ type: "drop", position: { x: 5, y: 5 }, paths: ["/Users/me/a.png"] });
    });
    // 어디로 갈지 모르는 파일을 조용히 어딘가로 복사하지 않는다.
    expect(fx.imports).toEqual([]);
  });

  it("⌘V imports clipboard files into the open file's folder", async () => {
    fx.clipboard = ["/Users/me/shot.png", "/Users/me/pack"];
    const { getByTestId } = render(<Harness selected={{ path: "docs/guide.md", isDir: false }} />);
    await act(async () => {});
    await act(async () => {
      getByTestId("paste").click();
    });
    expect(fx.imports).toEqual([
      { destDir: "docs", sources: ["/Users/me/shot.png", "/Users/me/pack"] },
    ]);
  });

  it("⌘V follows the folder clicked in the tree, not the open file", async () => {
    fx.clipboard = ["/Users/me/shot.png"];
    // 폴더는 눌러도 탭이 열리지 않는다 — 화면이 그 자리를 따로 기억해 넘겨준다.
    const { getByTestId } = render(<Harness selected={{ path: "assets", isDir: true }} />);
    await act(async () => {});
    await act(async () => {
      getByTestId("paste").click();
    });
    expect(fx.imports).toEqual([{ destDir: "assets", sources: ["/Users/me/shot.png"] }]);
  });

  it("⌘V with only text on the clipboard does nothing", async () => {
    fx.clipboard = [];
    const { getByTestId } = render(<Harness selected={null} />);
    await act(async () => {});
    await act(async () => {
      getByTestId("paste").click();
    });
    expect(fx.imports).toEqual([]);
  });
});
