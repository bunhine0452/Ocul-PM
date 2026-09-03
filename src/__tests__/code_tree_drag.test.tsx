// 트리 안 드래그 이동 — **포인터 몸짓**의 계약.
//
// HTML5 드래그가 아니라 pointerdown/move/up 이라 jsdom 에서 끝까지 몰 수 있다.
// 좌표→행 되찾기(`document.elementFromPoint`)만 갈아 끼우면 나머지는 진짜 코드다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CodeDirEntry } from "@/lib/bindings";
import { CodeTree } from "@/features/code/CodeTree";
import { dropDirFor, SPRING_MS, useTreeDrag } from "@/features/code/useTreeDrag";

afterEach(cleanup);

function entry(name: string, path: string, isDir: boolean): CodeDirEntry {
  return { name, relative_path: path, is_dir: isDir, ignored: false };
}

describe("dropDirFor — 어디로 들어가는가", () => {
  it("폴더 위면 그 폴더, 파일 위면 그 파일의 부모", () => {
    expect(dropDirFor("a.ts", { path: "src/lib", isDir: true })).toBe("src/lib");
    expect(dropDirFor("a.ts", { path: "src/main.ts", isDir: false })).toBe("src");
  });

  it("제자리·자기 자신·자기 후손은 놓을 자리가 아니다", () => {
    // 이미 그 폴더 안에 있다 (드롭이 아니라 취소에 가깝다).
    expect(dropDirFor("src/a.ts", { path: "src", isDir: true })).toBeNull();
    expect(dropDirFor("src", { path: "src", isDir: true })).toBeNull();
    expect(dropDirFor("src", { path: "src/lib", isDir: true })).toBeNull();
    // 트리 밖.
    expect(dropDirFor("src", null)).toBeNull();
  });
});

/** 좌표 아래에 있다고 **칠** 요소. 테스트가 행을 직접 골라 넣는다. */
let under: Element | null = null;

function Harness({
  onMove,
  open = [],
  marks = new Map<string, boolean>(),
}: {
  onMove: (from: string, to: string) => void;
  open?: string[];
  /** 트리 다중 선택 — 뽑아 둔 것 안에서 잡으면 전부 딸려 온다. */
  marks?: ReadonlyMap<string, boolean>;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(open));
  const drag = useTreeDrag({
    onMove,
    payloadOf: (path) => (marks.has(path) ? [...marks.keys()] : [path]),
    onSpringOpen: (dir) => setExpanded((prev) => new Set(prev).add(dir)),
    isExpanded: (dir) => expanded.has(dir),
  });
  const map = new Map<string, CodeDirEntry[]>([
    ["", [entry("src", "src", true), entry("lib", "lib", true), entry("a.ts", "a.ts", false)]],
    ["src", [entry("deep.ts", "src/deep.ts", false)]],
  ]);
  return (
    <>
      <CodeTree
        childrenOf={(p) => map.get(p)}
        loadingDirs={new Set()}
        selected={null}
        expanded={expanded}
        dirtyPaths={new Set()}
        openPaths={new Set()}
        draft={null}
        onDraftSubmit={vi.fn()}
        onDraftCancel={vi.fn()}
        onContextMenu={vi.fn()}
        marks={marks}
        focusPath={null}
        cutPaths={new Set()}
        onKeyDown={vi.fn()}
        onClickRow={(path, isDir) => (isDir ? undefined : onSelect(path))}
        onPin={vi.fn()}
        rowDrag={drag.rowDrag}
        draggingPaths={drag.draggingPaths}
        dropDir={drag.dropDir}
      />
      {drag.ghost}
    </>
  );
}

const onSelect = vi.fn();

function row(label: string): HTMLElement {
  return screen.getByText(label).closest("button")!;
}

/** 한 행을 잡아 다른 자리 위로 끌고 가 놓는다. `over` 가 null 이면 트리 밖. */
function dragTo(from: HTMLElement, over: Element | null) {
  fireEvent.pointerDown(from, { button: 0, clientX: 10, clientY: 10 });
  under = over;
  fireEvent.pointerMove(window, { buttons: 1, clientX: 60, clientY: 90 });
  fireEvent.pointerUp(window);
}

beforeEach(() => {
  onSelect.mockClear();
  under = null;
  // jsdom 에는 레이아웃이 없다 — 좌표→요소는 테스트가 정한다.
  document.elementFromPoint = (() => under) as typeof document.elementFromPoint;
});

describe("CodeTree — 포인터 드래그 이동", () => {
  it("폴더를 다른 폴더 위에 놓으면 그 폴더 안으로 들어간다", () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} />);
    dragTo(row("src"), row("lib"));
    expect(onMove).toHaveBeenCalledWith("src", "lib");
  });

  it("트리 배경에 놓으면 폴더 밖(루트)으로 나온다", () => {
    const onMove = vi.fn();
    const r = render(<Harness onMove={onMove} open={["src"]} />);
    dragTo(row("deep.ts"), r.container.querySelector(".code-tree")!);
    expect(onMove).toHaveBeenCalledWith("src/deep.ts", "");
  });

  it("자기 자신 위에 놓으면 아무 일도 일어나지 않는다", () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} />);
    dragTo(row("src"), row("src"));
    expect(onMove).not.toHaveBeenCalled();
  });

  it("문턱을 넘지 않은 몸짓은 그냥 클릭이다", () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} />);
    const file = row("a.ts");
    fireEvent.pointerDown(file, { button: 0, clientX: 10, clientY: 10 });
    under = row("lib");
    fireEvent.pointerMove(window, { buttons: 1, clientX: 11, clientY: 11 });
    fireEvent.pointerUp(window);
    fireEvent.click(file);
    expect(onMove).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith("a.ts");
  });

  it("드래그로 끝난 몸짓의 클릭은 삼킨다 (놓자마자 그 파일이 열리지 않는다)", () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} />);
    const file = row("a.ts");
    dragTo(file, row("lib"));
    fireEvent.click(file);
    expect(onMove).toHaveBeenCalledWith("a.ts", "lib");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("접힌 폴더 위에 머물면 펼쳐진다 — 폴더 안의 폴더로 옮기는 유일한 길", () => {
    vi.useFakeTimers();
    try {
      render(<Harness onMove={vi.fn()} />);
      expect(screen.queryByText("deep.ts")).not.toBeInTheDocument();
      fireEvent.pointerDown(row("a.ts"), { button: 0, clientX: 10, clientY: 10 });
      under = row("src");
      fireEvent.pointerMove(window, { buttons: 1, clientX: 40, clientY: 70 });
      // 손이 **멈춰 있는 동안** 일어나는 일이라 틱을 돌려야 한다.
      act(() => {
        vi.advanceTimersByTime(SPRING_MS + 100);
      });
      expect(screen.getByText("deep.ts")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  /// 포인터 캡처를 쓰지 않으므로 창 **밖**에서 뗀 손의 `pointerup` 은 오지
  /// 않는다. 회수하지 않으면 누르지도 않은 손을 유령이 계속 따라다닌다.
  it("버튼이 떨어진 채 움직이면 드래그를 접는다 (창 밖에서 뗀 손)", () => {
    const onMove = vi.fn();
    render(<Harness onMove={onMove} />);
    fireEvent.pointerDown(row("a.ts"), { button: 0, clientX: 10, clientY: 10 });
    under = row("lib");
    fireEvent.pointerMove(window, { buttons: 1, clientX: 60, clientY: 90 });
    expect(document.querySelector(".code-drag-ghost")).not.toBeNull();

    fireEvent.pointerMove(window, { buttons: 0, clientX: 70, clientY: 95 });
    expect(document.querySelector(".code-drag-ghost")).toBeNull();
    expect(document.body.classList.contains("code-dragging")).toBe(false);
    expect(onMove).not.toHaveBeenCalled();
  });
});

describe("CodeTree — 여럿을 한 번에 끌기", () => {
  const marks = new Map<string, boolean>([
    ["a.ts", false],
    ["lib", true],
  ]);

  it("뽑아 둔 행은 표시가 남고, 들면 유령이 딸려 오는 수를 말한다", () => {
    render(<Harness onMove={vi.fn()} marks={marks} />);
    expect(row("a.ts").className).toContain("marked");
    expect(row("lib").className).toContain("marked");
    expect(row("src").className).not.toContain("marked");

    fireEvent.pointerDown(row("a.ts"), { button: 0, clientX: 10, clientY: 10 });
    under = row("src");
    act(() => {
      fireEvent.pointerMove(window, { buttons: 1, clientX: 60, clientY: 90 });
    });
    // 이름 하나만 뜨면 나머지가 따라오는 줄 모른 채 놓게 된다.
    expect(screen.getByText("+1")).toBeInTheDocument();
    fireEvent.pointerUp(window);
  });

  it("뽑아 둔 것 **밖**을 잡으면 그것 하나만 들린다", () => {
    render(<Harness onMove={vi.fn()} marks={marks} />);
    fireEvent.pointerDown(row("src"), { button: 0, clientX: 10, clientY: 10 });
    under = row("lib");
    act(() => {
      fireEvent.pointerMove(window, { buttons: 1, clientX: 60, clientY: 90 });
    });
    // 유령은 떠 있되 수는 말하지 않는다 — 하나뿐이므로.
    expect(document.querySelector(".code-drag-ghost")).not.toBeNull();
    expect(screen.queryByText("+1")).not.toBeInTheDocument();
    fireEvent.pointerUp(window);
  });
});
