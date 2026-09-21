// 의미검색 결과의 **일지 행** (journal-scale-round {#search-semantic-journal}).
//
// 백엔드가 일지 청크를 섞어 보내면 그 행은 파일 경로가 아니라 제목·종류
// 배지로 보여야 하고, 누르면 일지 화면으로 가야 한다. 그 두 계약과, 머리말
// 줄을 읽어 제목/종류/워크데이로 가르는 순수 함수를 여기서 못 박는다.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ChunkSearchResult } from "@/lib/bindings";

import { t } from "@/i18n";
import { SemanticResults, parseJournalChunk } from "@/features/search/SemanticResults";

afterEach(() => cleanup());

// `CodeSnippet` 은 포매터(wasm) 를 지연 로드한다 — 이 테스트의 관심사가
// 아니므로 원문 그대로 그리는 것으로 대신한다.
vi.mock("@/features/search/CodeSnippet", () => ({
  CodeSnippet: ({ content }: { content: string }) => <pre>{content}</pre>,
}));

const HEADER = "# ime composition drops a keystroke · type: bug · tags: terminal · workday: 20260921";

function journalChunk(over: Partial<ChunkSearchResult> = {}): ChunkSearchResult {
  return {
    chunk_id: 1,
    file_path: ".oculpm/journal/20260921/Bugs/0900_bug_ime.md",
    kind: "journal",
    start_line: 20,
    end_line: 44,
    content: `${HEADER}\nthe pty stream reordered the composition events`,
    distance: 0.2,
    ...over,
  };
}

function codeChunk(over: Partial<ChunkSearchResult> = {}): ChunkSearchResult {
  return {
    chunk_id: 2,
    file_path: "src/features/terminal/useTerminalKeys.ts",
    kind: "ast",
    start_line: 10,
    end_line: 30,
    content: "// AST Symbol: useTerminalKeys (function)\nexport function useTerminalKeys() {}",
    distance: 0.4,
    ...over,
  };
}

function renderResults(over: Partial<Parameters<typeof SemanticResults>[0]> = {}) {
  const props = {
    items: [journalChunk(), codeChunk()],
    journalCount: 1,
    formatted: false,
    onFormatted: vi.fn(),
    canOpenInEditor: false,
    onOpenAt: vi.fn(),
    canMore: false,
    onMore: vi.fn(),
    ...over,
  };
  render(<SemanticResults {...props} />);
  return props;
}

describe("parseJournalChunk", () => {
  it("splits the header line into title / type / workday and keeps the body", () => {
    const meta = parseJournalChunk(journalChunk());
    expect(meta.title).toBe("ime composition drops a keystroke");
    expect(meta.entryType).toBe("bug");
    expect(meta.workday).toBe("20260921");
    expect(meta.entryPath).toBe("20260921/Bugs/0900_bug_ime.md");
    // 머리말은 스니펫에 두 번 나오지 않는다.
    expect(meta.body).toBe("the pty stream reordered the composition events");
  });

  it("has no journal-screen destination for a rollup", () => {
    const meta = parseJournalChunk(
      journalChunk({
        file_path: ".oculpm/rollups/2026-W38.md",
        content: "# 2026-W38 · rollup: 2026-W38\nshipped v3.3.0",
      }),
    );
    expect(meta.entryPath).toBeNull();
    expect(meta.title).toBe("2026-W38");
  });
});

describe("SemanticResults", () => {
  it("renders a journal row by title + badge, not by file path", () => {
    renderResults();
    expect(screen.getByText("ime composition drops a keystroke")).toBeTruthy();
    expect(screen.getAllByText(t("search.journalBadge")).length).toBe(1);
    // 일지 행은 파일 경로를 쓰지 않는다. 코드 행은 그대로 경로다.
    expect(screen.queryByText(".oculpm/journal/20260921/Bugs/0900_bug_ime.md")).toBeNull();
    expect(screen.getByText("src/features/terminal/useTerminalKeys.ts")).toBeTruthy();
    // 헤더에 "일지 N건 포함".
    expect(screen.getByText(new RegExp(t("search.journalIncluded", { n: 1 }).trim()))).toBeTruthy();
  });

  it("opens the journal screen with the entry-relative path", () => {
    const onOpenJournal = vi.fn();
    renderResults({ onOpenJournal });
    fireEvent.click(screen.getByText("ime composition drops a keystroke"));
    expect(onOpenJournal).toHaveBeenCalledWith("20260921/Bugs/0900_bug_ime.md");
  });

  it("sends a rollup row to the code screen instead — there is no journal entry", () => {
    const onOpenJournal = vi.fn();
    const onOpenInCode = vi.fn();
    renderResults({
      items: [
        journalChunk({
          file_path: ".oculpm/rollups/2026-W38.md",
          content: "# 2026-W38 · rollup: 2026-W38\nshipped v3.3.0",
        }),
      ],
      onOpenJournal,
      onOpenInCode,
    });
    fireEvent.click(screen.getByText("2026-W38"));
    expect(onOpenJournal).not.toHaveBeenCalled();
    expect(onOpenInCode).toHaveBeenCalledWith(".oculpm/rollups/2026-W38.md", 20);
  });
});
