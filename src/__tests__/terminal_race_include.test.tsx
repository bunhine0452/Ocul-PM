import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// 레인 준비의 `.worktreeinclude` (love-round L6) — 백엔드가 레인마다 복사한 git 무시 파일의 이름만 알려 주면,
// 시작 대화상자가 그 이름을 토스트 한 줄로 말한다. 내용은 오지 않는다. 복사 규칙은 Rust(git::race_include)가 본다.
const h = vi.hoisted(() => ({
  included: [] as string[] | undefined,
  toasts: [] as string[],
  noTerms: [] as never[],
}));
vi.mock("@/api/race", () => ({
  raceApi: {
    start: async (_p: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        name: `s-${i + 1}`,
        path: `/data/races/p1/s-${i + 1}`,
        branch: `ocul-race/s-${i + 1}`,
        files: 0,
        added: 0,
        removed: 0,
        journals: 0,
        journal_title: null,
        evidence: 0,
        proof: null,
        included: h.included,
      })),
    lanes: async () => [],
  },
}));
vi.mock("@/features/terminal/termStore", () => ({
  subscribeTerms: () => () => {},
  termsSnapshot: () => h.noTerms,
  openTerm: async () => 41,
  closeTerm: () => {},
  hasWorked: () => false,
}));
vi.mock("@/lib/toast", () => ({
  toast: {
    info: (m: string) => void h.toasts.push(m),
    destructive: (m: string) => void h.toasts.push(`error:${m}`),
    warning: (m: string) => void h.toasts.push(`warn:${m}`),
  },
}));

import { setLangSetting, t } from "@/i18n";
import { RaceStartDialog } from "@/features/terminal/RacePanel";
import { __resetRaceForTests, includedLine } from "@/features/terminal/race";

beforeEach(() => {
  setLangSetting("ko");
  __resetRaceForTests();
  h.toasts.length = 0;
});
afterEach(() => cleanup());

async function startTwo() {
  const onClose = vi.fn();
  render(<RaceStartDialog projectId={1} onClose={onClose} />);
  fireEvent.click(screen.getByRole("radio", { name: "2" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "p" } });
  fireEvent.click(screen.getByRole("button", { name: t("race.start", { n: 2 }) }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
}

describe(".worktreeinclude — names only, one line", () => {
  it("says which ignored files each run got", async () => {
    h.included = [".env", "config/app.local.json"];
    await startTwo();
    expect(h.toasts).toEqual([t("race.included", { names: ".env, config/app.local.json" })]);
  });

  it("folds a long list into the first three and a count", () => {
    expect(includedLine(["a", "b", "c", "d", "e"])).toBe(
      t("race.included", { names: t("race.includedMore", { names: "a, b, c", n: 2 }) }),
    );
  });

  it("says nothing when nothing was copied (no file, or an older backend without the field)", async () => {
    h.included = [];
    await startTwo();
    cleanup();
    h.included = undefined;
    await startTwo();
    expect(h.toasts).toEqual([]);
  });
});
