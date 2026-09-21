import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TagMergeReport, TagStat } from "@/lib/bindings";

// ─── 「태그 정리」 시트 ({#tag-merge}) ───────────────────────────────────────
//
// 시트의 약속 둘을 문다:
//  1. **누르기 전에는 아무것도 안 바뀐다** — 제안 옆 「병합」은 확인 단계를
//     띄울 뿐이고, 확인을 눌러야 `oculpm_tag_merge` 가 불린다.
//  2. 제안은 **대상별로 접힌다** — `suggest_into` 가 같은 태그들이 한 줄이다.

const api = vi.hoisted(() => ({
  stats: [] as TagStat[],
  merges: [] as Array<{ from: string[]; into: string }>,
  report: { rewritten: 0, skipped: [] } as TagMergeReport,
}));
const toastMock = vi.hoisted(() => ({ info: vi.fn(), warning: vi.fn(), destructive: vi.fn() }));
vi.mock("@/lib/toast", () => ({ toast: toastMock }));

vi.mock("@/api/oculpm", () => ({
  OculpmApiError: class extends Error {},
  oculpmApi: {
    tagStats: () => Promise.resolve(api.stats),
    tagMerge: (_pid: number, from: string[], into: string) => {
      api.merges.push({ from, into });
      return Promise.resolve(api.report);
    },
  },
}));

import { TagTidySheet } from "@/features/oculpm/TagTidySheet";

function stat(tag: string, count: number, suggestInto: string | null = null): TagStat {
  return { tag, count, last_workday: "20260921", suggest_into: suggestInto };
}

beforeEach(() => {
  api.stats = [];
  api.merges = [];
  api.report = { rewritten: 0, skipped: [] };
  toastMock.info.mockClear();
});
afterEach(cleanup);

describe("TagTidySheet", () => {
  it("제안은 대상별로 접히고, 확인을 거쳐야 병합한다", async () => {
    api.stats = [
      stat("bug", 40),
      stat("bugs", 3, "bug"),
      stat("bug-", 1, "bug"),
      stat("terminal", 9),
    ];
    api.report = { rewritten: 4, skipped: [] };

    render(<TagTidySheet projectId={1} open onClose={() => {}} onMerged={() => {}} />);
    await waitFor(() => expect(screen.getByText("bugs, bug-")).toBeTruthy());

    // 「병합」 한 번은 확인일 뿐 — 아직 아무것도 안 부른다.
    fireEvent.click(screen.getAllByRole("button", { name: "병합" })[0]);
    expect(api.merges).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "병합할게요" }));
    await waitFor(() => expect(api.merges).toHaveLength(1));
    expect(api.merges[0]).toEqual({ from: ["bugs", "bug-"], into: "bug" });
  });

  it("근거 없는 태그만 있으면 제안 자리는 비었다고 말한다", async () => {
    api.stats = [stat("terminal", 9), stat("한글-태그", 2)];
    render(<TagTidySheet projectId={1} open onClose={() => {}} onMerged={() => {}} />);

    await waitFor(() => expect(screen.getByText("terminal")).toBeTruthy());
    expect(screen.getByText(/닮은 태그를 못 찾았어요/)).toBeTruthy();
    // 1회용이 아니면 「1회」 칩도 없다.
    expect(screen.queryByText("1회")).toBeNull();
  });
});
