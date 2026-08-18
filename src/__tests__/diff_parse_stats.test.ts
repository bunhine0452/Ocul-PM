import { describe, expect, test } from "vitest";

import { countPatchStats } from "@/features/diff/diffParse";

// 헬퍼 — 배열을 unified diff 텍스트로.
const patch = (lines: string[]) => lines.join("\n");

describe("countPatchStats", () => {
  test("counts additions and deletions inside hunks, skipping file headers", () => {
    const p = patch([
      "diff --git a/foo.ts b/foo.ts",
      "index 1234567..89abcde 100644",
      "--- a/foo.ts",
      "+++ b/foo.ts",
      "@@ -1,3 +1,3 @@",
      " context",
      "-old line",
      "+new line",
      " context",
    ]);
    expect(countPatchStats(p)).toEqual({ add: 1, del: 1 });
  });

  test("counts a deleted `---` front-matter line instead of dropping it as a header", () => {
    // `---` 내용 줄을 지우면 패치 줄은 `----` — 접두 검사(startsWith("---"))는
    // 이를 헤더로 오인해 del 0 으로 만들었다 (회귀 방지).
    const p = patch([
      "diff --git a/note.md b/note.md",
      "index 1234567..89abcde 100644",
      "--- a/note.md",
      "+++ b/note.md",
      "@@ -1,3 +1,2 @@",
      " title: hi",
      "----",
      " body",
    ]);
    expect(countPatchStats(p)).toEqual({ add: 0, del: 1 });
  });

  test("counts an added line that itself starts with ++", () => {
    const p = patch([
      "--- a/inc.c",
      "+++ b/inc.c",
      "@@ -1,1 +1,2 @@",
      " int i;",
      "+++i;",
    ]);
    expect(countPatchStats(p)).toEqual({ add: 1, del: 0 });
  });

  test("resets hunk state at the next file in a multi-file patch", () => {
    const p = patch([
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,1 +1,1 @@",
      "-x",
      "+y",
      "diff --git a/b.ts b/b.ts",
      "--- a/b.ts",
      "+++ b/b.ts",
      "@@ -1,1 +1,2 @@",
      " z",
      "+w",
    ]);
    expect(countPatchStats(p)).toEqual({ add: 2, del: 1 });
  });

  test("returns zero for a patch with no hunks", () => {
    expect(countPatchStats("")).toEqual({ add: 0, del: 0 });
    expect(countPatchStats("Binary files a/img.png and b/img.png differ")).toEqual({
      add: 0,
      del: 0,
    });
  });
});
