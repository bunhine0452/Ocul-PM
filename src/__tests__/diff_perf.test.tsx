// diff 속도 (11-15 #diff-perf, DF-06) — 같은 패치로 다시 그릴 때 hljs 를 다시 돌리지 않고, 여러 줄 주석의
// 가운데 줄도 주석으로 칠하고, j 로 파일을 넘길 때 「diff 계산 중」 이 깜빡이지 않는다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

vi.mock("@/lib/bindings", async () => (await import("./helpers/diffFx")).bindingsMock());
vi.mock("@/features/terminal/sendToClaude", async () => (await import("./helpers/diffFx")).sendMock());

import { PatchView } from "@/features/diff/PatchView";
import { t } from "@/i18n";
import { loadHljs } from "@/lib/hljs";
import { activeName, renderDiffScreen, resetFx, seed } from "./helpers/diffScreenFx";

beforeEach(resetFx);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const COMMENT_PATCH = [
  "diff --git a/src/c.ts b/src/c.ts",
  "@@ -1,4 +1,5 @@",
  " /**",
  "- * old 0 comment",
  "+ * new 0 comment",
  "+ * second line 42",
  "  */",
  " const x = 1;",
].join("\n");

describe("highlighting", () => {
  it("does not run hljs again when the same patch re-renders", async () => {
    const hljs = await loadHljs();
    const { container, rerender } = render(<PatchView patch={COMMENT_PATCH} mode="unified" lang="typescript" />);
    await waitFor(() => expect(container.querySelector(".hljs-comment")).not.toBeNull());
    const spy = vi.spyOn(hljs, "highlight");
    rerender(<PatchView patch={COMMENT_PATCH} mode="unified" lang="typescript" />);
    rerender(<PatchView patch={COMMENT_PATCH} mode="split" lang="typescript" />);
    expect(spy).not.toHaveBeenCalled();
    // 패치가 바뀌면 다시 — 덩이마다 옛 쪽 · 새 쪽 한 번씩(줄마다가 아니다).
    rerender(<PatchView patch={COMMENT_PATCH.replace("42", "43")} mode="split" lang="typescript" />);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("colours every line inside a multi-line comment as a comment", async () => {
    const { container } = render(<PatchView patch={COMMENT_PATCH} mode="unified" lang="typescript" />);
    await waitFor(() => expect(container.querySelector(".hljs-comment")).not.toBeNull());
    const code = [...container.querySelectorAll(".dl .dl-code")];
    const inner = code.filter((c) => /new 0 comment|second line 42|old 0 comment/.test(c.textContent ?? ""));
    expect(inner).toHaveLength(3);
    for (const c of inner) {
      expect(c.querySelector(".hljs-comment"), c.textContent ?? "").not.toBeNull();
      expect(c.querySelector(".hljs-number, .hljs-keyword"), c.textContent ?? "").toBeNull();
    }
    // 주석이 끝난 뒤의 코드는 다시 코드다.
    const last = code.find((c) => c.textContent === "const x = 1;")!;
    expect(last.querySelector(".hljs-comment")).toBeNull();
    expect(last.querySelector(".hljs-keyword")).not.toBeNull();
  });
});

describe("moving between files", () => {
  it("keeps the previous body instead of flashing 'computing'", async () => {
    seed([
      { path: "src/a.ts", op: "M" },
      { path: "src/b.ts", op: "M" },
    ]);
    const { container } = renderDiffScreen();
    await waitFor(() => expect(activeName(container)).toBe("src/b.ts"));
    await waitFor(() => expect(container.querySelector(".diff-code .dl")).not.toBeNull());
    fireEvent.keyDown(container.querySelector(".chg-split")!, { key: "j" });
    expect(activeName(container)).toBe("src/a.ts");
    expect(container.querySelector(".diff-code .dl")).not.toBeNull();
    expect(container.textContent).not.toContain(t("diff.computing"));
    await waitFor(() => expect(container.querySelector(".chg-fbase")?.textContent).toBe("a.ts"));
    expect(container.textContent).not.toContain(t("diff.computing"));
  });
});
