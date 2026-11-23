import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { JournalEntrySummary } from "@/lib/bindings";

// ─── 일지 상세 — 검증 상자의 색은 목록과 같은 정의를 따른다 (love-round G2 #journal-detail-chore-amber) ───
//
// 결함 · 기능 · 리팩토링만 증거를 요구한다(`evidenceState.ts`). 목록 칩 · 「검증 없음」 필터는 그 규칙을 따랐는데
// 상세의 검증 상자는 등급만 보고 잡일에도 호박 「명령 없음」 과 「주장일 뿐」 경고문을 그렸다 — 같은 일지가
// 목록에선 정상, 상세에선 예외였다.

const BODY = "[x] Release\n\n## Done\nBumped the version.\n\n## Verification\n- release run passed\n";

vi.mock("@/lib/toast", () => ({ toast: { info: vi.fn(), warning: vi.fn(), destructive: vi.fn() } }));
vi.mock("@/api/oculpm", () => ({
  OculpmApiError: class extends Error {},
  oculpmApi: {
    getJournalEntry: (_pid: number, relativePath: string) =>
      Promise.resolve({
        relative_path: relativePath,
        title: "Release",
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
import { t } from "@/i18n";

function entry(type: string): JournalEntrySummary {
  return {
    relative_path: `20260531/X/1000_${type}_x.md`,
    workday: "20260531",
    type,
    slug: "x",
    status: "done",
    difficulty: null,
    title: "Release",
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

describe("verification box chip tone", () => {
  it("a chore without a command gets a neutral chip and no claim-only warning", async () => {
    const { findByText, queryByText, container } = renderDetail("chore");
    const chip = await findByText(t("journal.verify.noCommand"));
    expect(chip.className).toContain("hairline");
    expect(chip.className).not.toContain("warn");
    expect(queryByText(t("journal.verify.claimOnly"))).toBeNull();
    expect(container.querySelector(".chip.warn")).toBeNull();
  });

  it("a bug with the same body gets the amber chip and the warning", async () => {
    const { findAllByText, findByText } = renderDetail("bug");
    const chips = await findAllByText(t("journal.verify.noCommand"));
    expect(chips.every((c) => c.className.includes("warn"))).toBe(true);
    expect(await findByText(t("journal.verify.claimOnly"))).toBeInTheDocument();
  });
});
