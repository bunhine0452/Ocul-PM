import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// 같은 일을 worktree 여럿에서 (10-30, Orca 「Parallel Worktrees」) — 레인을 만들고 레인마다 claude,
// 띠에서 크기를 보고 하나를 원래 폴더로 가져오고, 모두 정리한다. git 쪽은 Rust 테스트(git::race)가 본다.
const h = vi.hoisted(() => ({
  lanes: [] as Array<{ name: string; path: string; branch: string; files: number; added: number; removed: number }>,
  started: [] as number[],
  taken: [] as string[],
  cleared: 0,
  opened: [] as Array<[number, string | null, string | null]>,
  closed: [] as number[],
  noTerms: [] as never[],
}));
vi.mock("@/api/race", () => ({
  raceApi: {
    start: async (_p: number, count: number) => {
      h.started.push(count);
      h.lanes = Array.from({ length: count }, (_, i) => ({
        name: `1030-1812-${i + 1}`,
        path: `/data/races/p1/1030-1812-${i + 1}`,
        branch: `ocul-race/1030-1812-${i + 1}`,
        files: 0,
        added: 0,
        removed: 0,
      }));
      return h.lanes;
    },
    lanes: async () => h.lanes,
    patch: async () => "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-x\n+y\n",
    take: async (_p: number, path: string) => void h.taken.push(path),
    clear: async () => {
      h.cleared++;
      const n = h.lanes.length;
      h.lanes = [];
      return n;
    },
  },
}));
vi.mock("@/features/terminal/termStore", () => ({
  subscribeTerms: () => () => {},
  // 실제 저장소처럼 같은 배열을 돌려준다 — 매번 새 배열이면 useSyncExternalStore 가 끝없이 다시 그린다.
  termsSnapshot: () => h.noTerms,
  openTerm: async (projectId: number, prompt: string | null, cwd: string | null) => {
    h.opened.push([projectId, prompt, cwd]);
    return 40 + h.opened.length;
  },
  closeTerm: (id: number) => void h.closed.push(id),
}));

import { setLangSetting, t } from "@/i18n";
import { RaceStartDialog, RaceStrip, splitByFile } from "@/features/terminal/RacePanel";
import { __resetRaceForTests, laneNumberOf } from "@/features/terminal/race";

beforeEach(() => {
  setLangSetting("ko");
  __resetRaceForTests();
  h.lanes = [];
  h.started.length = 0;
  h.taken.length = 0;
  h.cleared = 0;
  h.opened.length = 0;
  h.closed.length = 0;
});
afterEach(() => cleanup());

describe("같은 일을 여럿에서", () => {
  it("프롬프트와 개수로 레인을 만들고 레인마다 그 worktree 에서 claude 를 연다", async () => {
    const onClose = vi.fn();
    render(<RaceStartDialog projectId={1} onClose={onClose} />);
    const start = screen.getByRole("button", { name: t("race.start", { n: 3 }) });
    expect(start).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("tab", { name: "2" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "캐시를 고쳐 줘" } });
    fireEvent.click(screen.getByRole("button", { name: t("race.start", { n: 2 }) }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(h.started).toEqual([2]);
    expect(h.opened).toEqual([
      [1, "캐시를 고쳐 줘", "/data/races/p1/1030-1812-1"],
      [1, "캐시를 고쳐 줘", "/data/races/p1/1030-1812-2"],
    ]);
    // 레인의 세션은 탭에서 「레인 n」 으로 불린다.
    expect(laneNumberOf(42)).toBe(2);
  });

  it("띠는 레인마다 크기를 보이고, 고른 레인을 가져오며, 모두 정리하면 세션부터 닫는다", async () => {
    render(<RaceStartDialog projectId={1} onClose={() => {}} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "p" } });
    fireEvent.click(screen.getByRole("button", { name: t("race.start", { n: 3 }) }));
    await waitFor(() => expect(h.opened).toHaveLength(3));
    cleanup();

    h.lanes[0] = { ...h.lanes[0], files: 2, added: 3, removed: 1 };
    render(<RaceStrip projectId={1} />);
    await waitFor(() => expect(screen.getByText(t("race.files", { n: 2 }))).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getAllByText(t("race.noChanges")).length).toBeGreaterThan(0);

    // 변경 없는 레인은 가져올 수 없다 — 첫 레인을 고른다.
    const takes = screen.getAllByRole("button", { name: t("race.take") });
    expect(takes[1]).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(takes[0]);
    // 확인 대화상자의 「이것으로」 — 띠의 셋 뒤에 하나 더 선다.
    await waitFor(() => expect(screen.getAllByRole("button", { name: t("race.take") })).toHaveLength(4));
    const confirmTake = screen.getAllByRole("button", { name: t("race.take") });
    fireEvent.click(confirmTake[confirmTake.length - 1]);
    await waitFor(() => expect(h.taken).toEqual(["/data/races/p1/1030-1812-1"]));

    fireEvent.click(screen.getByRole("button", { name: t("race.clear") }));
    const confirmClear = await screen.findAllByRole("button", { name: t("race.clear") });
    fireEvent.click(confirmClear[confirmClear.length - 1]);
    await waitFor(() => expect(h.cleared).toBe(1));
    expect(h.closed).toEqual([41, 42, 43]);
    await act(async () => {});
  });

  it("레인 diff 는 파일마다 한 장으로 나눈다", () => {
    const patch = "diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-x\n+y\ndiff --git a/src/b c.ts b/src/b c.ts\nnew file mode 100644\n";
    expect(splitByFile(patch).map((f) => f.file)).toEqual(["a.ts", "src/b c.ts"]);
    // 확장 머리줄 · 끝의 빈 줄은 코드 줄로 그려지지 않게 뺀다.
    expect(splitByFile(patch)[1].patch).toBe("diff --git a/src/b c.ts b/src/b c.ts");
    expect(splitByFile(patch)[0].patch.endsWith("+y")).toBe(true);
  });
});
