// 2026-09-11 편집기 IDE 라운드의 순수 모델 자물쇠 — ⌘P 순위 · git 표식 말아
// 올리기 · 브레드크럼 심볼 사슬 · 산문 판정.
import { describe, expect, it } from "vitest";

import { buildGitMarks } from "@/features/code/gitDecor";
import { enclosingChain } from "@/features/code/gotoModel";
import { isProsePath } from "@/features/code/codeLang";
import { flattenFiles, rankFiles } from "@/features/code/quickOpenModel";
import type { CodeTreeNode, LspSymbol } from "@/lib/bindings";

const node = (path: string, children?: CodeTreeNode[]): CodeTreeNode => ({
  name: path.slice(path.lastIndexOf("/") + 1),
  relative_path: path,
  is_dir: children != null,
  children: children ?? [],
});

const TREE: CodeTreeNode[] = [
  node("AGENTS.md"),
  node("src", [
    node("src/features", [
      node("src/features/code", [node("src/features/code/code.css"), node("src/features/code/code-frame.css")]),
    ]),
    node("src/main.tsx"),
  ]),
  node("src-tauri", [node("src-tauri/src", [node("src-tauri/src/lib.rs"), node("src-tauri/src/db", [node("src-tauri/src/db/mod.rs")])])]),
];

describe("⌘P 빠른 열기", () => {
  const files = flattenFiles(TREE);

  it("전량 트리를 파일만 문서 순서로 편다 — 폴더는 없다", () => {
    expect(files.map((f) => f.path)).toEqual([
      "AGENTS.md",
      "src/features/code/code.css",
      "src/features/code/code-frame.css",
      "src/main.tsx",
      "src-tauri/src/lib.rs",
      "src-tauri/src/db/mod.rs",
    ]);
    expect(files[1].dir).toBe("src/features/code");
    expect(files[0].dir).toBe("");
  });

  it("빈 질의는 열려 있는 탭만, 준 순서대로 — 전체 목록을 쏟지 않는다", () => {
    const out = rankFiles(files, "", ["src/main.tsx", "AGENTS.md"]);
    expect(out.map((f) => f.path)).toEqual(["src/main.tsx", "AGENTS.md"]);
    expect(out.every((f) => f.open)).toBe(true);
  });

  it("약어가 이름에 걸린다 (agmd → AGENTS.md) · 경로 조각도 걸린다 (src/feat)", () => {
    expect(rankFiles(files, "agmd", [])[0].path).toBe("AGENTS.md");
    expect(rankFiles(files, "src/feat", []).map((f) => f.path)).toEqual([
      "src/features/code/code.css",
      "src/features/code/code-frame.css",
    ]);
  });

  it("낱말 여럿은 전부 맞아야 한다 — `code css` 는 css 둘, `code frame` 은 하나", () => {
    expect(rankFiles(files, "code css", []).map((f) => f.path)).toEqual([
      "src/features/code/code.css",
      "src/features/code/code-frame.css",
    ]);
    expect(rankFiles(files, "code frame", []).map((f) => f.path)).toEqual(["src/features/code/code-frame.css"]);
  });

  it("동점이면 열린 탭이 먼저, 그다음 짧은 경로", () => {
    const withOpen = rankFiles(files, "code", ["src/features/code/code-frame.css"]);
    expect(withOpen[0].path).toBe("src/features/code/code-frame.css");
    const noOpen = rankFiles(files, "code", []);
    expect(noOpen[0].path).toBe("src/features/code/code.css");
  });

  it("안 맞으면 빈 목록 — 상한을 지킨다", () => {
    expect(rankFiles(files, "zzz", [])).toEqual([]);
    expect(rankFiles(files, "s", [], 2)).toHaveLength(2);
  });
});

describe("git 표식", () => {
  it("파일은 제 op, 조상 폴더는 전부 M 으로 말린다", () => {
    const marks = buildGitMarks([
      { path: "src/features/code/code.css", op: "M" },
      { path: "docs/new.md", op: "A" },
      { path: "old.txt", op: "D" },
    ]);
    expect(marks.get("src/features/code/code.css")).toBe("M");
    expect(marks.get("src/features/code")).toBe("M");
    expect(marks.get("src/features")).toBe("M");
    expect(marks.get("src")).toBe("M");
    expect(marks.get("docs/new.md")).toBe("A");
    expect(marks.get("docs")).toBe("M");
    expect(marks.get("old.txt")).toBe("D");
    expect(marks.has("")).toBe(false);
  });

  it("모르는 op 는 M 으로 읽는다 — 색이 없는 것보다 낫다", () => {
    expect(buildGitMarks([{ path: "a", op: "?" }]).get("a")).toBe("M");
  });
});

describe("브레드크럼 심볼 사슬", () => {
  const sym = (name: string, depth: number, line: number): LspSymbol => ({
    name,
    detail: null,
    kind: "function",
    depth,
    line,
    character: 0,
  });
  // impl Foo { fn a() {..} fn b() {..} }  fn c()
  const SYMS = [sym("Foo", 0, 0), sym("a", 1, 2), sym("inner", 2, 3), sym("b", 1, 8), sym("c", 0, 20)];

  it("커서가 든 가장 안쪽부터 바깥으로 — 깊이가 한 단씩 줄어드는 것만", () => {
    expect(enclosingChain(SYMS, 4).map((i) => SYMS[i].name)).toEqual(["Foo", "a", "inner"]);
    expect(enclosingChain(SYMS, 9).map((i) => SYMS[i].name)).toEqual(["Foo", "b"]);
    expect(enclosingChain(SYMS, 25).map((i) => SYMS[i].name)).toEqual(["c"]);
  });

  it("첫 심볼보다 앞이면 비어 있다 · 빈 목록도 비어 있다", () => {
    expect(enclosingChain(SYMS, -1)).toEqual([]);
    expect(enclosingChain([], 3)).toEqual([]);
  });
});

describe("산문 판정 (줄바꿈 기본값)", () => {
  it("md · txt 는 산문, 코드는 아니다", () => {
    expect(isProsePath("AGENTS.md")).toBe(true);
    expect(isProsePath("docs/README.MD")).toBe(true);
    expect(isProsePath("notes.txt")).toBe(true);
    expect(isProsePath("src/main.tsx")).toBe(false);
    expect(isProsePath("Makefile")).toBe(false);
  });
});
