// 지연 로딩 트리의 계약 — 렌더러가 "아직 안 읽음"과 "빈 폴더"를 구별하고,
// 무시된 항목을 숨기지 않고 흐리게 그리는지.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CodeDirEntry } from "@/lib/bindings";
import { CodeTree } from "@/features/code/CodeTree";

// 이 저장소의 vitest 설정은 globals 를 안 켜서 testing-library 의 자동 cleanup 이
// 붙지 않는다 — 안 지우면 앞 테스트의 DOM 이 남아 질의가 엉뚱한 것을 집는다.
afterEach(cleanup);

function entry(name: string, path: string, isDir: boolean, ignored = false): CodeDirEntry {
  return { name, relative_path: path, is_dir: isDir, ignored };
}

function setup(map: Map<string, CodeDirEntry[]>, expanded: string[] = [], loading: string[] = []) {
  const onToggle = vi.fn();
  const onSelect = vi.fn();
  render(
    <CodeTree
      childrenOf={(p) => map.get(p)}
      loadingDirs={new Set(loading)}
      selected={null}
      expanded={new Set(expanded)}
      dirtyPaths={new Set()}
      openPaths={new Set()}
      draft={null}
      onDraftSubmit={vi.fn()}
      onDraftCancel={vi.fn()}
      onContextMenu={vi.fn()}
      dropDir={null}
      rowDrag={() => ({})}
      draggingPaths={new Set()}
      marks={new Map()}
      focusPath={null}
      cutPaths={new Set()}
      onKeyDown={vi.fn()}
      onClickRow={(path, isDir) => (isDir ? onToggle(path) : onSelect(path))}
      onPin={vi.fn()}
    />,
  );
  return { onToggle, onSelect };
}

describe("CodeTree — 지연 로딩", () => {
  it("안 읽은 가지는 '읽는 중', 진짜 빈 폴더는 '빈 폴더'로 구별한다", () => {
    const map = new Map<string, CodeDirEntry[]>([
      ["", [entry("unread", "unread", true), entry("empty", "empty", true)]],
      ["empty", []], // 읽었고, 실제로 비었다
    ]);
    setup(map, ["unread", "empty"]);

    expect(screen.getByText("읽는 중…")).toBeInTheDocument();
    expect(screen.getByText("빈 폴더")).toBeInTheDocument();
  });

  it("접힌 폴더의 자식은 그리지도, 읽지도 않는다", () => {
    const childrenOf = vi.fn((p: string) =>
      p === "" ? [entry("src", "src", true)] : [entry("main.rs", "src/main.rs", false)],
    );
    render(
      <CodeTree
        childrenOf={childrenOf}
        loadingDirs={new Set()}
        selected={null}
        expanded={new Set()}
        dirtyPaths={new Set()}
        openPaths={new Set()}
        draft={null}
        onDraftSubmit={vi.fn()}
        onDraftCancel={vi.fn()}
        onContextMenu={vi.fn()}
        dropDir={null}
        rowDrag={() => ({})}
        draggingPaths={new Set()}
        marks={new Map()}
        focusPath={null}
        cutPaths={new Set()}
        onKeyDown={vi.fn()}
        onClickRow={vi.fn()}
        onPin={vi.fn()}
      />,
    );
    expect(screen.getByText("src")).toBeInTheDocument();
    expect(screen.queryByText("main.rs")).not.toBeInTheDocument();
    expect(childrenOf).toHaveBeenCalledWith("");
    expect(childrenOf).not.toHaveBeenCalledWith("src");
  });

  it("폴더를 누르면 그 경로로 onToggle 이 온다 (부모가 그때 읽는다)", () => {
    const map = new Map<string, CodeDirEntry[]>([["", [entry("src", "src", true)]]]);
    const { onToggle } = setup(map);
    fireEvent.click(screen.getByText("src"));
    expect(onToggle).toHaveBeenCalledWith("src");
  });

  it("무시된 항목은 숨기지 않고 흐리게 + 이유를 title 로 밝힌다", () => {
    const map = new Map<string, CodeDirEntry[]>([
      ["", [entry("node_modules", "node_modules", true, true), entry("src", "src", true)]],
    ]);
    setup(map);

    const ignored = screen.getByText("node_modules").closest("button");
    expect(ignored).toBeInTheDocument();
    expect(ignored).toHaveClass("ignored");
    expect(ignored).toHaveAttribute("title");

    const normal = screen.getByText("src").closest("button");
    expect(normal).not.toHaveClass("ignored");
    expect(normal).not.toHaveAttribute("title");
  });

  it("루트가 비어도 '읽는 중'을 그리지 않는다 (읽은 결과가 빈 것)", () => {
    setup(new Map<string, CodeDirEntry[]>([["", []]]));
    expect(screen.queryByText("읽는 중…")).not.toBeInTheDocument();
    expect(screen.queryByText("빈 폴더")).not.toBeInTheDocument();
  });
});
