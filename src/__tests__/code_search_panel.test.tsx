// 전역 검색 패널 (#project-search) — 검색 → 결과 그룹 → 열기/제외/치환의 배선.
//
// 순수 로직(previewSegments·dropFile·replaceablePaths)은 직접, 패널은 백엔드
// 커맨드를 목으로 갈아끼워 확인한다. 디바운스는 기다리지 않고 Enter(즉시 검색)
// 로 우회한다 — 타이머 경합은 이 테스트가 밝힐 것이 아니다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CodeSearchResult } from "@/lib/bindings";

import { t } from "@/i18n";
import {
  dropFile,
  previewSegments,
  replaceablePaths,
  splitPath,
} from "@/features/code/searchPanelModel";

const fx: {
  search: CodeSearchResult;
  searchCalls: Array<{ query: string; caseSensitive: boolean }>;
  replaceCalls: Array<{ paths: string[]; target: unknown }>;
} = {
  search: { files: [], total_hits: 0, truncated: false },
  searchCalls: [],
  replaceCalls: [],
};

vi.mock("@/lib/bindings", () => ({
  commands: {
    codeSearch: (_p: number, query: string, caseSensitive: boolean) => {
      fx.searchCalls.push({ query, caseSensitive });
      return Promise.resolve({ status: "ok" as const, data: fx.search });
    },
    codeSearchReplace: (
      _p: number,
      _q: string,
      _r: string,
      _c: boolean,
      _w: boolean,
      _x: boolean,
      paths: string[],
      target: unknown,
    ) => {
      fx.replaceCalls.push({ paths, target });
      return Promise.resolve({
        status: "ok" as const,
        data: { files_changed: paths.length || 1, hits_replaced: 1, errors: [] },
      });
    },
  },
}));

import { CodeSearchPanel } from "@/features/code/CodeSearchPanel";

describe("searchPanelModel", () => {
  it("previewSegments splits by UTF-16 offsets (Hangul-safe)", () => {
    // col 5, len 5 (UTF-16 단위 = JS 인덱스) — 한글이 1단위임을 같이 확인.
    const line = "한글 앞 match 뒤"; // i18n-ignore -- 표시 문자열이 아니라 검색 픽스처다
    expect(previewSegments(line, 5, 5)).toEqual([
      { text: line.slice(0, 5), hit: false },
      { text: "match", hit: true },
      { text: line.slice(10), hit: false },
    ]);
    // 줄 시작/끝 매치는 빈 조각을 만들지 않는다.
    expect(previewSegments("abc", 0, 3)).toEqual([{ text: "abc", hit: true }]);
    // 좌표가 어긋나면(방어) 전체를 평문으로.
    expect(previewSegments("abc", 2, 5)).toEqual([{ text: "abc", hit: false }]);
  });

  it("dropFile removes the file and shrinks the total", () => {
    const result: CodeSearchResult = {
      files: [
        { path: "a.ts", hits: [{ line: 1, col: 0, len: 1, preview: "x", preview_col: 0 }] },
        { path: "b.ts", hits: [{ line: 2, col: 0, len: 1, preview: "y", preview_col: 0 }] },
      ],
      total_hits: 2,
      truncated: false,
    };
    const next = dropFile(result, "a.ts");
    expect(next.files.map((f) => f.path)).toEqual(["b.ts"]);
    expect(next.total_hits).toBe(1);
    expect(dropFile(next, "nope.ts")).toBe(next);
  });

  it("replaceablePaths excludes dirty files and counts them", () => {
    const files = [
      { path: "a.ts", hits: [] },
      { path: "b.ts", hits: [] },
    ];
    const out = replaceablePaths(files, new Set(["b.ts"]));
    expect(out).toEqual({ paths: ["a.ts"], skippedDirty: 1 });
  });

  it("splitPath separates name and folder", () => {
    expect(splitPath("src/lib/a.ts")).toEqual({ name: "a.ts", dir: "src/lib" });
    expect(splitPath("root.md")).toEqual({ name: "root.md", dir: "" });
  });
});

describe("CodeSearchPanel", () => {
  const opts = { caseSensitive: false, wholeWord: false, regex: false };

  beforeEach(() => {
    fx.search = {
      files: [
        {
          path: "src/a.ts",
          hits: [
            { line: 3, col: 2, len: 6, preview: "  needle here", preview_col: 2 },
            { line: 9, col: 0, len: 6, preview: "needle again", preview_col: 0 },
          ],
        },
        {
          path: "src/b.ts",
          hits: [{ line: 1, col: 0, len: 6, preview: "needle", preview_col: 0 }],
        },
      ],
      total_hits: 3,
      truncated: false,
    };
    fx.searchCalls = [];
    fx.replaceCalls = [];
  });

  afterEach(() => cleanup());

  function renderPanel(over: Partial<Parameters<typeof CodeSearchPanel>[0]> = {}) {
    const onOpenHit = vi.fn();
    const onOptsChange = vi.fn();
    render(
      <CodeSearchPanel
        projectId={1}
        opts={opts}
        onOptsChange={onOptsChange}
        dirtyPaths={new Set()}
        onOpenHit={onOpenHit}
        onClose={() => {}}
        focusSeq={0}
        {...over}
      />,
    );
    return { onOpenHit, onOptsChange };
  }

  async function search(query: string) {
    const input = screen.getByRole("textbox", { name: t("code.search.placeholder") });
    fireEvent.change(input, { target: { value: query } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(fx.searchCalls.length).toBeGreaterThan(0));
  }

  it("renders grouped results and opens a hit with its selection range", async () => {
    const { onOpenHit } = renderPanel();
    await search("needle");

    expect(await screen.findByText("a.ts")).toBeTruthy();
    expect(screen.getByText(t("code.search.summary", { files: 2, count: 3 }))).toBeTruthy();

    // 매치 클릭 → 파일·1-based 줄·UTF-16 범위가 그대로 넘어간다.
    // (미리보기는 <mark> 로 쪼개져 있어 줄 번호로 행을 찾는다.)
    fireEvent.click(screen.getByText("3", { selector: ".code-search-line" }).closest("button")!);
    expect(onOpenHit).toHaveBeenCalledWith("src/a.ts", 3, 2, 6);
  });

  it("dismisses a whole file from the list", async () => {
    renderPanel();
    await search("needle");
    await screen.findByText("a.ts");

    fireEvent.click(screen.getAllByRole("button", { name: t("code.search.dismissFile") })[0]);
    expect(screen.queryByText("a.ts")).toBeNull();
    expect(screen.getByText(t("code.search.summary", { files: 1, count: 1 }))).toBeTruthy();
  });

  it("persists match toggles through onOptsChange", () => {
    const { onOptsChange } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: t("code.search.caseSensitive") }));
    expect(onOptsChange).toHaveBeenCalledWith({ ...opts, caseSensitive: true });
  });

  it("replace-all confirms, skips dirty files, and passes the rest", async () => {
    renderPanel({ dirtyPaths: new Set(["src/b.ts"]) });
    await search("needle");
    await screen.findByText("a.ts");

    fireEvent.click(screen.getByRole("button", { name: t("code.search.toggleReplace") }));
    fireEvent.change(screen.getByRole("textbox", { name: t("code.search.replacePlaceholder") }), {
      target: { value: "thread" },
    });
    fireEvent.click(screen.getByRole("button", { name: t("code.search.replaceAll") }));
    // 확인 다이얼로그를 지나야 실제 치환이 나간다.
    fireEvent.click(screen.getByRole("button", { name: t("code.search.confirm") }));

    await waitFor(() => expect(fx.replaceCalls.length).toBe(1));
    expect(fx.replaceCalls[0]).toEqual({ paths: ["src/a.ts"], target: null });
  });
});
