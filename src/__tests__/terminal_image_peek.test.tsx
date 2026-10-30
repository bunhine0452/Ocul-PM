import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// 터미널 이미지 미리보기 (10-30, 3.12.0 의 것을 다시) — 경로를 링크로 찾고, 올리면 카드,
// 누르면 크게. OSC 8 은 linkHandler 가 없으면 웹뷰에서 눌러도 아무 일이 없었다.
const h = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock("@/api/terminal", () => ({ terminalApi: { imagePreview: h.preview } }));

import { setLangSetting } from "@/i18n";
import {
  createImagePathProvider,
  createOscLinkHandler,
  fileUriToPath,
  findImagePaths,
  lineCells,
  type CellLine,
} from "@/features/terminal/fileLinks";
import { closePeek, HOVER_DELAY_MS, peekEvent } from "@/features/terminal/imagePeek";
import { TermImagePeekHost } from "@/features/terminal/TermImagePeek";

afterEach(() => {
  act(() => closePeek());
  cleanup();
  vi.useRealTimers();
  h.preview.mockReset();
});

/** 글자마다 한 칸, 한글은 두 칸(뒤 칸은 폭 0) — xterm 버퍼 줄의 모양. */
function fakeLine(text: string): CellLine {
  const cells: { getChars(): string; getWidth(): number }[] = [];
  for (const ch of text) {
    const wide = /[가-힣]/.test(ch);
    cells.push({ getChars: () => ch, getWidth: () => (wide ? 2 : 1) });
    if (wide) cells.push({ getChars: () => "", getWidth: () => 0 });
  }
  return { length: cells.length, getCell: (x) => cells[x] };
}

const mouse = (x = 10, y = 10) => ({ clientX: x, clientY: y }) as MouseEvent;

describe("fileLinks", () => {
  it("turns file URIs into local paths and refuses other hosts", () => {
    expect(fileUriToPath("file:///private/tmp/a%20b.png")).toBe("/private/tmp/a b.png");
    expect(fileUriToPath("file:///C:/shots/x.png")).toBe("C:/shots/x.png");
    expect(fileUriToPath("file://evil.example/x.png")).toBeNull();
    expect(fileUriToPath("https://example.com/x.png")).toBeNull();
  });

  it("finds absolute image paths in a line, not relative ones or URLs", () => {
    const line = "› [image] /private/tmp/claude/shot.png (1.9MB) · see assets/a.png https://x.dev/b.png";
    expect(findImagePaths(line).map((m) => m.path)).toEqual(["/private/tmp/claude/shot.png"]);
    expect(findImagePaths('saved to "C:\\shots\\Win.JPG".').map((m) => m.path)).toEqual(["C:\\shots\\Win.JPG"]);
  });

  it("maps a path after Korean text to the right cells", () => {
    const { text, first, last } = lineCells(fakeLine("그림 /t/a.png"));
    const [m] = findImagePaths(text);
    // 「그」「림」이 두 칸씩 + 공백 한 칸 → 경로는 다섯째 칸(0부터 5)에서 시작한다.
    expect(first[m.start]).toBe(5);
    expect(last[m.end - 1]).toBe(5 + "/t/a.png".length - 1);
  });

  it("gives the provider's link a 1-based cell range and peek events", () => {
    const onImage = vi.fn();
    const provider = createImagePathProvider(() => fakeLine("x /t/a.png"), onImage);
    let links: Parameters<Parameters<typeof provider.provideLinks>[1]>[0];
    provider.provideLinks(3, (l) => (links = l));
    expect(links![0].range).toEqual({ start: { x: 3, y: 3 }, end: { x: 10, y: 3 } });
    links![0].hover!(mouse(), links![0].text);
    expect(onImage).toHaveBeenCalledWith({ kind: "hover", path: "/t/a.png", x: 10, y: 10 });
  });

  it("routes OSC 8 links: web to the browser, images to the peek, other files to the file menu", () => {
    const openUrl = vi.fn();
    const onImage = vi.fn();
    const onFile = vi.fn();
    const handler = createOscLinkHandler({ openUrl, onImage, onFile });
    const range = { start: { x: 1, y: 1 }, end: { x: 2, y: 1 } };
    handler.activate(mouse(), "https://oculpm.com", range);
    handler.activate(mouse(), "file:///tmp/a.png", range);
    handler.activate(mouse(), "file:///repo/src/main.ts", range);
    handler.activate(mouse(), "javascript:alert(1)", range);
    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledWith("https://oculpm.com");
    expect(onImage).toHaveBeenCalledTimes(1);
    expect(onImage).toHaveBeenCalledWith({ kind: "open", path: "/tmp/a.png", x: 10, y: 10 });
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile).toHaveBeenCalledWith({ path: "/repo/src/main.ts", line: null, x: 10, y: 10 });
    expect(handler.allowNonHttpProtocols).toBe(true);
  });
});

describe("TermImagePeek", () => {
  it("shows a card after a short hover, enlarges on click and closes on Escape", async () => {
    setLangSetting("ko");
    h.preview.mockResolvedValue({ mime: "image/png", bytes: 2048, base64: "iVBORw0KGgo=" });
    vi.useFakeTimers();
    render(<TermImagePeekHost />);

    act(() => peekEvent({ kind: "hover", path: "/tmp/shots/home.png", x: 40, y: 40 }));
    expect(screen.queryByRole("tooltip")).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(HOVER_DELAY_MS);
    });
    expect(screen.getByRole("tooltip").textContent).toContain("home.png");
    expect(screen.getByRole("tooltip").textContent).toContain("2.0 KB");
    expect(screen.getByRole("tooltip").textContent).toContain("눌러서 크게");

    act(() => peekEvent({ kind: "open", path: "/tmp/shots/home.png", x: 40, y: 40 }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("/tmp/shots/home.png");
    // 크게 띄운 동안 다른 링크를 스치거나 벗어나도 그대로다.
    act(() => peekEvent({ kind: "leave" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    // 같은 경로라 다시 읽지 않았다.
    expect(h.preview).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says why when the file is not an image", async () => {
    setLangSetting("ko");
    h.preview.mockRejectedValue({ code: "image_not_image", detail: null });
    render(<TermImagePeekHost />);
    await act(async () => peekEvent({ kind: "open", path: "/tmp/fake.png", x: 0, y: 0 }));
    expect(screen.getByRole("dialog").textContent).toContain("이미지 파일이 아니에요");
  });
});
