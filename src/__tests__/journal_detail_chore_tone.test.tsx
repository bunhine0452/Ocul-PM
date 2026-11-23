import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { JournalEntrySummary } from "@/lib/bindings";

// ─── 일지 상세 — 검증 상자의 색은 목록과 같은 정의를 따른다 (love-round G2 #journal-detail-chore-amber) ───
//
// 결함 · 기능 · 리팩토링만 증거를 요구한다(`evidenceState.ts`). 목록 칩 · 「검증 없음」 필터는 그 규칙을 따랐는데
// 상세의 검증 상자는 등급만 보고 잡일에도 호박 「명령 없음」 과 「주장일 뿐」 경고문을 그렸다 — 같은 일지가
// 목록에선 정상, 상세에선 예외였다.

const BODY = "[x] 릴리스\n\n## 한 일\n버전을 올렸다.\n\n## 검증\n- 릴리스 run 통과\n";

vi.mock("@/lib/toast", () => ({ toast: { info: vi.fn(), warning: vi.fn(), destructive: vi.fn() } }));
vi.mock("@/api/oculpm", () => ({
  OculpmApiError: class extends Error {},
  oculpmApi: {
    getJournalEntry: (_pid: number, relativePath: string) =>
      Promise.resolve({
        relative_path: relativePath,
        title: "릴리스",
        body_markdown: BODY,
        evidence: 1,
        frontmatter: { files_touched: [], related: [], agent: { id: "claude-code", version: null } },
      }),
    getEntryDiffs: () => Promise.resolve([]),
    suggestRelated: () => Promise.resolve([]),
    openEntryInEditor: () => Promise.resolve(null),
    setJournalVerified: () => Promise.resolve(null),
  },
}));
vi.mock("@/components/Markdown", () => ({ Markdown: ({ children }: { children: string }) => children }));

import { JournalDetail } from "@/features/oculpm/JournalDetail";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";

function entry(type: string): JournalEntrySummary {
  return {
    relative_path: `20260531/X/1000_${type}_x.md`,
    workday: "20260531",
    type,
    slug: "x",
    status: "done",
    difficulty: null,
    title: "릴리스",
    checkbox: null,
    session_id: "20260531-001",
    agent_id: "claude-code",
    agent_version: null,
    verified_by_user: false,
    verified_stale: false,
    evidence: 1,
    created_at: "2026-05-31T10:00:00+09:00",
    updated_at: null,
    tags: [],
    files_count: 0,
    parse_ok: true,
    parse_warnings: [],
  } as JournalEntrySummary;
}

function renderDetail(type: string) {
  return render(
    <WorkspaceProvider projectId={1}>
      <JournalDetail projectId={1} entry={entry(type)} planLinks={[]} onOpenDiff={() => {}} onOpenRelated={() => {}} />
    </WorkspaceProvider>,
  );
}

afterEach(() => cleanup());

describe("검증 상자 칩의 색", () => {
  it("잡일은 명령이 없어도 호박 칩도 「주장」 경고문도 없다 — 사실만 무채색으로", async () => {
    const { findByText, queryByText, container } = renderDetail("chore");
    const chip = await findByText("명령 없음");
    expect(chip.className).toContain("hairline");
    expect(chip.className).not.toContain("warn");
    expect(queryByText(/주장일 뿐이에요/)).toBeNull();
    expect(container.querySelector(".chip.warn")).toBeNull();
  });

  it("결함은 같은 본문이라도 호박 칩과 경고문이 선다", async () => {
    const { findAllByText, findByText } = renderDetail("bug");
    const chips = await findAllByText("명령 없음");
    expect(chips.every((c) => c.className.includes("warn"))).toBe(true);
    expect(await findByText(/주장일 뿐이에요/)).toBeInTheDocument();
  });
});
