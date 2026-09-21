import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { JournalEntrySummary } from "@/lib/bindings";
import { JournalRow } from "@/features/oculpm/JournalRow";
import { isSourceMarkerTag, visibleTags } from "@/features/oculpm/sourceMarkerTags";

// ─── 출처 표식 태그는 태그 칩이 아니다 ({#tag-source-marker}) ─────────────────
//
// `journal_write`(MCP) 는 모든 일지에 `mcp-tool` 을 자동으로 붙인다
// (`mcp/tools/mod.rs`). 이 저장소 표본은 727건 중 431건이라, 빼지 않으면
// 원장의 모든 태그 칩·통계가 이 하나로 뒤덮인다. 그 출처 사실 자체는 이미
// `SourceBadge`(`source: "mcp"`)가 따로 보여주므로 칩에서는 뺀다.

function summary(over: Partial<JournalEntrySummary> = {}): JournalEntrySummary {
  return {
    relative_path: "20260921/Chores/1000_chore_x.md",
    workday: "20260921",
    type: "chore",
    slug: "x",
    status: "done",
    difficulty: null,
    title: "샘플 작업",
    checkbox: null,
    session_id: "mcp-20260921-000001",
    agent_id: "claude-code",
    agent_version: null,
    verified_by_user: false,
    verified_stale: false,
    created_at: "2026-09-21T10:00:00+09:00",
    updated_at: null,
    tags: ["mcp-tool", "deploy-check"],
    files_count: 0,
    parse_ok: true,
    parse_warnings: [],
    ...over,
  };
}

afterEach(() => cleanup());

describe("visibleTags — 출처 표식 제외", () => {
  it("mcp-tool 은 빼고 나머지 태그는 그대로 남긴다", () => {
    expect(visibleTags(["mcp-tool", "deploy-check"])).toEqual(["deploy-check"]);
    expect(isSourceMarkerTag("mcp-tool")).toBe(true);
    expect(isSourceMarkerTag("deploy-check")).toBe(false);
  });
});

describe("원장 행 — mcp-tool 칩을 그리지 않는다", () => {
  it("mcp-tool 은 숨기고 다른 태그는 그대로 보여준다", () => {
    const { container, getByText, queryByText } = render(
      <JournalRow
        entry={summary()}
        focused={false}
        showAgent={false}
        showSource={false}
        onOpenEntry={() => {}}
      />,
    );
    expect(queryByText("mcp-tool")).toBeNull();
    expect(getByText("deploy-check")).toBeTruthy();
    expect(container.querySelectorAll(".tag")).toHaveLength(1);
  });

  it("mcp-tool 뿐이면 태그 칩 자체를 그리지 않는다", () => {
    const { container } = render(
      <JournalRow
        entry={summary({ tags: ["mcp-tool"] })}
        focused={false}
        showAgent={false}
        showSource={false}
        onOpenEntry={() => {}}
      />,
    );
    expect(container.querySelector(".jl-tags")).toBeNull();
  });
});
