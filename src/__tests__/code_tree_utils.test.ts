import { describe, expect, it } from "vitest";
import type { CodeTreeNode } from "@/lib/bindings";
import {
  ancestorDirs,
  collectDirs,
  collectFiles,
  filterTree,
  formatBytes,
} from "@/features/code/treeUtils";

// 코드 화면 — 트리 필터·경로 유틸 (순수 함수).

function file(path: string): CodeTreeNode {
  return { name: path.split("/").pop()!, relative_path: path, is_dir: false, children: [] };
}
function dir(path: string, children: CodeTreeNode[]): CodeTreeNode {
  return { name: path.split("/").pop()!, relative_path: path, is_dir: true, children };
}

const TREE: CodeTreeNode[] = [
  dir("src", [
    dir("src/features", [file("src/features/CodeScreenV2.tsx")]),
    file("src/main.tsx"),
  ]),
  dir("scripts", [file("scripts/check.mjs")]),
  file("README.md"),
];

describe("ancestorDirs", () => {
  it("returns every ancestor, excluding the file itself", () => {
    expect(ancestorDirs("src/features/CodeScreenV2.tsx")).toEqual(["src", "src/features"]);
    expect(ancestorDirs("README.md")).toEqual([]);
  });
});

describe("filterTree", () => {
  it("returns the input when the query is blank", () => {
    expect(filterTree(TREE, "  ")).toBe(TREE);
  });

  it("matches files by full relative path, case-insensitive", () => {
    const out = filterTree(TREE, "features/code");
    expect(collectFiles(out)).toEqual(["src/features/CodeScreenV2.tsx"]);
    // 매치 후손을 품은 가지만 남는다.
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("src");
  });

  it("keeps a whole subtree when a directory name matches", () => {
    const out = filterTree(TREE, "scripts");
    expect(collectFiles(out)).toEqual(["scripts/check.mjs"]);
  });

  it("drops everything when nothing matches", () => {
    expect(filterTree(TREE, "zzz-nope")).toEqual([]);
  });

  it("does not mutate the original tree", () => {
    const before = JSON.stringify(TREE);
    filterTree(TREE, "code");
    expect(JSON.stringify(TREE)).toBe(before);
  });
});

describe("collectDirs / collectFiles", () => {
  it("walks nested nodes in order", () => {
    expect(collectDirs(TREE)).toEqual(["src", "src/features", "scripts"]);
    expect(collectFiles(TREE)).toEqual([
      "src/features/CodeScreenV2.tsx",
      "src/main.tsx",
      "scripts/check.mjs",
      "README.md",
    ]);
  });
});

describe("formatBytes", () => {
  it("scales to B / KB / MB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
