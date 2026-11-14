// diff 는 정확한 사본 (11-15 #diff-exact, DF-01) — 위치로 가르는 파서 · 번호 안 먹는 표식 줄 · 끝 개행 ·
// 표식 칸과 코드 칸 두 칸 격자.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { classifyDiffLines, countPatchStats } from "@/features/diff/diffParse";
import { PatchView } from "@/features/diff/PatchView";
import { buildPatchModel } from "@/features/diff/patchModel";
import { t } from "@/i18n";

afterEach(cleanup);

const gutters = (el: HTMLElement) => [...el.querySelectorAll(".dl .dl-gut")].map((g) => g.textContent);
const view = (patch: string) => render(createElement(PatchView, { patch, mode: "unified" })).container;

describe("SQL / Lua `--` comment lines", () => {
  // 「-- 주석」 을 지우면 `--- 주석`, 「++ x」 를 더하면 `+++ x` — 접두로 가르면 파일 머리로 읽혀 사라졌다.
  const patch = [
    "diff --git a/q.sql b/q.sql",
    "--- a/q.sql",
    "+++ b/q.sql",
    "@@ -1,4 +1,4 @@",
    " select 1;",
    "--- old comment",
    "-select 2;",
    "+select 3;",
    "+++ counter",
    " select 4;",
  ].join("\n");

  it("keeps two deletions and two additions and the numbers run on", () => {
    const kinds = classifyDiffLines(patch).map((l) => l.kind);
    expect(kinds.filter((k) => k === "deletion")).toHaveLength(2);
    expect(kinds.filter((k) => k === "addition")).toHaveLength(2);
    expect(kinds.filter((k) => k === "header")).toHaveLength(3);
    expect(countPatchStats(patch)).toEqual({ add: 2, del: 2 });
    // 문맥 1 · 지움 2 · 지움 3 · 더함 2 · 더함 3 · 문맥 4(새 쪽).
    expect(gutters(view(patch))).toEqual(["1", "2", "3", "2", "3", "4"]);
  });

  it("draws the deleted comment line as a line", () => {
    const el = view(patch);
    expect([...el.querySelectorAll(".dl.del .dl-code")].map((c) => c.textContent)).toEqual(["-- old comment", "select 2;"]);
  });
});

describe("the `\\ No newline at end of file` marker", () => {
  const patch = ["@@ -1 +1,2 @@", "-a", "\\ No newline at end of file", "+a", "+b"].join("\n");

  it("takes no line number — the new side is 1 and 2", () => {
    const lines = buildPatchModel(patch, null, null).hunks[0].lines;
    expect(lines.map((l) => l.kind)).toEqual(["deletion", "meta", "addition", "addition"]);
    expect(lines.filter((l) => l.kind === "addition").map((l) => l.newNo)).toEqual([1, 2]);
    expect(lines[1].oldNo).toBeNull();
    expect(lines[1].newNo).toBeNull();
  });

  it("renders one small grey line with no number and no note button", () => {
    const el = render(createElement(PatchView, { patch, mode: "unified", notes: { projectId: 1, file: "a.txt" } })).container;
    const meta = el.querySelector(".dl.meta")!;
    expect(meta.textContent).toBe(t("diff.noNewline"));
    expect(meta.querySelector(".dl-gut")?.textContent).toBe("");
    expect(meta.querySelector("button")).toBeNull();
    expect(gutters(el).filter(Boolean)).toEqual(["1", "1", "2"]);
  });

  it("does not break the side-by-side pairing", () => {
    const el = render(createElement(PatchView, { patch, mode: "split" })).container;
    const first = el.querySelector(".dl.split:not(.meta)")!;
    expect([...first.querySelectorAll(".dl-code")].map((c) => c.textContent)).toEqual(["a", "a"]);
  });
});

describe("a trailing newline", () => {
  it("is not an extra line", () => {
    const patch = "diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b\n";
    expect(classifyDiffLines(patch).map((l) => l.kind)).toEqual(["header", "hunk", "deletion", "addition"]);
    expect(view(patch).querySelectorAll(".dl")).toHaveLength(2);
  });
});

describe("marker column and code column", () => {
  it("lays .dl-x out as a 1ch marker column plus a code column so wrapped lines hang off the code", () => {
    const css = readFileSync(join(__dirname, "..", "styles", "screens.css"), "utf8");
    const rule = /\n\.dl-x \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toContain("display: grid");
    expect(rule).toContain("grid-template-columns: 1ch minmax(0, 1fr)");
    // 코드 칸은 그 줄의 들여쓰기만큼 들어가 매달린다.
    expect(css).toMatch(/\.dl-code \{[^}]*padding-left: var\(--ind/);
    const el = view("@@ -1 +1 @@\n-    old();\n+    neu();");
    const x = el.querySelector(".dl.add .dl-x")!;
    expect([...x.children].map((c) => c.className)).toEqual(["dl-mark", "dl-code"]);
    expect((x.querySelector(".dl-code") as HTMLElement).style.getPropertyValue("--ind")).toBe("4ch");
  });
});
