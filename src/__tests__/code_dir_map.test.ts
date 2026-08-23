import { describe, expect, it } from "vitest";
import type { CodeTreeNode } from "@/lib/bindings";
import { flattenToDirMap } from "@/features/code/treeUtils";

function dir(name: string, path: string, children: CodeTreeNode[]): CodeTreeNode {
  return { name, relative_path: path, is_dir: true, children };
}
function file(name: string, path: string): CodeTreeNode {
  return { name, relative_path: path, is_dir: false, children: [] };
}

describe("flattenToDirMap", () => {
  it("루트를 빈 문자열 키에 담고 폴더마다 한 칸씩 만든다", () => {
    const nodes = [
      dir("src", "src", [file("main.rs", "src/main.rs"), dir("a", "src/a", [file("b.rs", "src/a/b.rs")])]),
      file("README.md", "README.md"),
    ];

    const map = flattenToDirMap(nodes);

    expect(map.get("")?.map((e) => e.name)).toEqual(["src", "README.md"]);
    expect(map.get("src")?.map((e) => e.name)).toEqual(["main.rs", "a"]);
    expect(map.get("src/a")?.map((e) => e.relative_path)).toEqual(["src/a/b.rs"]);
  });

  it("빈 폴더도 키를 만든다 — 렌더러가 '미로드'와 구별할 수 있어야 한다", () => {
    const map = flattenToDirMap([dir("empty", "empty", [])]);
    expect(map.get("empty")).toEqual([]);
    expect(map.has("empty")).toBe(true);
    expect(map.get("nope")).toBeUndefined();
  });

  it("code_tree 는 gitignore 를 존중하므로 전부 ignored=false 다", () => {
    const map = flattenToDirMap([dir("src", "src", [file("main.rs", "src/main.rs")])]);
    expect(map.get("")?.[0].ignored).toBe(false);
    expect(map.get("src")?.[0].ignored).toBe(false);
  });
});
