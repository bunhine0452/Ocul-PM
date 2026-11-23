// Finder · 탐색기에서 복사한 파일을 ⌘V (love-round 11-23) — 웹뷰는 파일 이름 글자나 아이콘 그림만 줘서 이름만 붙거나
// 아무것도 안 붙었다. 이제 경로를 끌어다 놓기와 같은 따옴표로 붙이고, 파일이 아니면 예전 길 그대로.
import { afterEach, describe, expect, it, vi } from "vitest";

import { terminalApi } from "@/api/terminal";
import { copiedFilesText, hasCopiedFiles, pathsFromUriList } from "@/features/terminal/filePaste";
import { fakeClipboard, fireClipboard, openRealTerm, type RealTerm } from "./xtermHarness";

/** Finder 의 「복사」 — 글은 파일 이름뿐이고 형식에 `Files` 가 선다. */
const finderCopy = (name: string) => fakeClipboard(name, ["Files"]) as unknown as DataTransfer;

describe("copied files → shell words", () => {
  it("reads file:// lines of a uri-list (Linux desktops) and skips the rest", () => {
    const list = "# copied\r\nfile:///home/me/My%20File.png\r\nhttps://example.com/x\r\nfile://other-host/etc/passwd\r\nfile:///tmp/%ED%95%9C.txt\r\n";
    expect(pathsFromUriList(list)).toEqual(["/home/me/My File.png", "/tmp/한.txt"]); // i18n-ignore -- 퍼센트 디코드한 파일 이름이 검사 재료다
    expect(pathsFromUriList("")).toEqual([]);
  });

  it("only a clipboard that carries files is a file paste", () => {
    expect(hasCopiedFiles(finderCopy("a.txt"))).toBe(true);
    expect(hasCopiedFiles(fakeClipboard("echo hi") as unknown as DataTransfer)).toBe(false);
    expect(copiedFilesText(fakeClipboard("echo hi") as unknown as DataTransfer, false, vi.fn())).toBeNull();
  });

  it("quotes the paths like a drop — POSIX and PowerShell", async () => {
    const read = vi.fn().mockResolvedValue(["/Users/me/My File.png", "/tmp/plain.txt"]);
    await expect(copiedFilesText(finderCopy("My File.png"), false, read)).resolves.toBe("'/Users/me/My File.png' /tmp/plain.txt ");
    const win = vi.fn().mockResolvedValue(["C:\\Users\\me\\it's.txt"]);
    await expect(copiedFilesText(finderCopy("it's.txt"), true, win)).resolves.toBe("'C:\\Users\\me\\it''s.txt' ");
  });

  it("a uri-list answers without asking the OS; a failed read is an empty answer", async () => {
    const read = vi.fn();
    const data = { ...fakeClipboard("", ["text/uri-list"]), getData: (f: string) => (f === "text/uri-list" ? "file:///a/b c" : "") };
    await expect(copiedFilesText(data as unknown as DataTransfer, false, read)).resolves.toBe("'/a/b c' ");
    expect(read).not.toHaveBeenCalled();
    await expect(copiedFilesText(finderCopy("x"), false, () => Promise.reject(new Error("busy")))).resolves.toBe("");
  });
});

describe("⌘V of copied files through the bridge (real xterm)", () => {
  let rt: RealTerm | null = null;
  afterEach(() => {
    rt?.dispose();
    rt = null;
    vi.restoreAllMocks();
  });

  const settle = () => new Promise((r) => setTimeout(r, 0));

  it("pastes the quoted paths, not the bare file name", async () => {
    const name = "\u{BCF4}\u{ACE0}\u{C11C} draft.md"; // 한글 · 빈칸이 든 파일 이름
    vi.spyOn(terminalApi, "clipboardFiles").mockResolvedValue([`/Users/me/${name}`]);
    rt = openRealTerm();
    fireClipboard(rt, "paste", finderCopy(name));
    await settle();
    expect(rt.data.join("")).toBe(`'/Users/me/${name}' `);
  });

  it("no paths (a copied picture) → the old way: Claude's image key on the full screen", async () => {
    vi.spyOn(terminalApi, "clipboardFiles").mockResolvedValue([]);
    rt = openRealTerm();
    await rt.write("\x1b[?1049h");
    fireClipboard(rt, "paste", fakeClipboard("", ["Files", "image/png"]));
    await settle();
    expect(rt.data).toEqual(["\x16"]);
  });

  it("plain text is pasted as before and never asks the OS", async () => {
    const spy = vi.spyOn(terminalApi, "clipboardFiles");
    rt = openRealTerm();
    fireClipboard(rt, "paste", fakeClipboard("echo hi"));
    await settle();
    expect(rt.data.join("")).toBe("echo hi");
    expect(spy).not.toHaveBeenCalled();
  });
});
