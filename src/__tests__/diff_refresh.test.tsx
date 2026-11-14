// 열어 둔 파일을 에이전트가 다시 고치면 (11-15 #diff-exact, DF-01) — diff 를 조용히 다시 읽고(본문을
// 걷지 않아 스크롤이 남는다) 머리줄이 「11:42 에 다시 바뀜」 을 말한다. 예전엔 diff 는 그대로인데
// 메모 판정만 새 내용을 봤다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, waitFor } from "@testing-library/react";

vi.mock("@/lib/bindings", async () => (await import("./helpers/diffFx")).bindingsMock());
vi.mock("@/features/terminal/sendToClaude", async () => (await import("./helpers/diffFx")).sendMock());

import { clockOf } from "@/features/diff/DiffFileHead";
import { REFRESH_DEBOUNCE_MS } from "@/features/diff/useDiffFile";
import { t } from "@/i18n";
import { recentChangesStore } from "@/lib/recentChangesStore";
import { fx, renderDiffScreen, resetFx, seed } from "./helpers/diffScreenFx";

beforeEach(resetFx);
afterEach(cleanup);

const callsFor = (path: string) => fx.computeCalls.filter((c) => c[1] === path).length;

describe("the open file changes again", () => {
  it("re-reads compute_diff after the debounce, keeps the body, and says when it changed", async () => {
    seed([{ path: "src/a.ts", op: "M" }]);
    const { container } = renderDiffScreen();
    await waitFor(() => expect(container.textContent).toContain("new line"));
    expect(callsFor("src/a.ts")).toBe(1);

    fx.diffByPath["src/a.ts"] = {
      path: "src/a.ts",
      source: { source: "git", patch: "diff --git a/src/a.ts b/src/a.ts\n@@ -1,2 +1,2 @@\n context line\n-old line\n+newer line\n" },
      truncated: null,
    };
    const ts = Date.now();
    act(() => recentChangesStore.push(1, { path: "src/a.ts", op: "M", ts, read: false }));
    // 디바운스 동안 본문은 그대로 — 걷었다 다시 그리면 스크롤이 맨 위로 튄다.
    expect(container.querySelector(".diff-code .dl")).not.toBeNull();
    expect(callsFor("src/a.ts")).toBe(1);

    await waitFor(() => expect(callsFor("src/a.ts")).toBe(2), { timeout: REFRESH_DEBOUNCE_MS + 2000 });
    await waitFor(() => expect(container.textContent).toContain("newer line"));
    expect(container.querySelector(".chg-again")?.textContent).toBe(t("diff.changedAgain", { time: clockOf(ts) }));
    expect(container.textContent).not.toContain(t("diff.computing"));
  });

  it("does not re-read when another file changes", async () => {
    seed([
      { path: "src/a.ts", op: "M" },
      { path: "src/b.ts", op: "M" },
    ]);
    const { container } = renderDiffScreen();
    await waitFor(() => expect(container.querySelector(".diff-code .dl")).not.toBeNull());
    const before = fx.computeCalls.length;
    // b 가 골라져 있다(가장 최근) — a 가 바뀌어도 b 를 다시 읽지 않는다.
    act(() => recentChangesStore.push(1, { path: "src/a.ts", op: "M", ts: Date.now(), read: false }));
    await new Promise((r) => setTimeout(r, REFRESH_DEBOUNCE_MS + 100));
    expect(fx.computeCalls.length).toBe(before);
    expect(container.querySelector(".chg-again")).toBeNull();
  });
});
