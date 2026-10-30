import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

// 터미널에 파일 끌어다 놓기 (10-30, Orca 「Drag Files to Agents」) — 따옴표 친 경로가 커서 아래
// 세션의 입력에 붙는다. 웹뷰의 onDragDropEvent 가 경로와 위치를 준다.
const h = vi.hoisted(() => ({ handler: null as null | ((e: { payload: unknown }) => void) }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (cb: (e: { payload: unknown }) => void) => {
      h.handler = cb;
      return Promise.resolve(() => {
        h.handler = null;
      });
    },
  }),
}));

import { dropText, shellQuote, useTerminalFileDrop } from "@/features/terminal/dropFiles";

afterEach(() => cleanup());

describe("shellQuote", () => {
  it("leaves plain paths bare and quotes the rest for a POSIX shell", () => {
    expect(shellQuote("/tmp/shots/home.png", false)).toBe("/tmp/shots/home.png");
    expect(shellQuote("/Users/me/My Shots/a b.png", false)).toBe("'/Users/me/My Shots/a b.png'");
    expect(shellQuote("/tmp/it's.png", false)).toBe(`'/tmp/it'\\''s.png'`);
    expect(shellQuote("/tmp/스크린숏.png", false)).toBe("'/tmp/스크린숏.png'");
  });

  it("uses double quotes on Windows", () => {
    expect(shellQuote("C:\\shots\\a.png", true)).toBe("C:\\shots\\a.png");
    expect(shellQuote("C:\\My Shots\\a.png", true)).toBe('"C:\\My Shots\\a.png"');
  });

  it("joins several paths with a trailing space", () => {
    expect(dropText(["/a.png", "/b c.png"], false)).toBe("/a.png '/b c.png' ");
    expect(dropText([], false)).toBe("");
  });
});

function Probe({ onDrop }: { onDrop: (id: number, text: string) => void }) {
  const over = useTerminalFileDrop(7, false, onDrop);
  return <div data-testid="over">{over ?? "none"}</div>;
}

describe("useTerminalFileDrop", () => {
  it("marks the session while dragging over and pastes on drop", async () => {
    const onDrop = vi.fn();
    const view = render(<Probe onDrop={onDrop} />);
    await act(async () => {});
    expect(h.handler).not.toBeNull();

    // jsdom 에는 elementFromPoint 가 없다 — 칸을 못 찾으면 고른 세션(7)이 받는다.
    act(() => h.handler!({ payload: { type: "enter", paths: ["/tmp/a.png"], position: { x: 10, y: 10 } } }));
    expect(view.getByTestId("over").textContent).toBe("7");
    act(() => h.handler!({ payload: { type: "leave" } }));
    expect(view.getByTestId("over").textContent).toBe("none");

    act(() =>
      h.handler!({ payload: { type: "drop", paths: ["/tmp/a.png", "/tmp/b c.jpg"], position: { x: 10, y: 10 } } }),
    );
    expect(onDrop).toHaveBeenCalledWith(7, "/tmp/a.png '/tmp/b c.jpg' ");
    expect(view.getByTestId("over").textContent).toBe("none");

    view.unmount();
    expect(h.handler).toBeNull();
  });
});
