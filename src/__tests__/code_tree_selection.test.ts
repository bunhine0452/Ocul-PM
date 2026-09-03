// 트리 다중 선택의 규칙 — 틀리면 파일이 엉뚱한 데로 가는 쪽이라 순수 함수로 문다.
import { describe, expect, it } from "vitest";
import type { CodeDirEntry } from "@/lib/bindings";
import {
  actionTargets,
  clickIntent,
  marksOf,
  pruneNested,
  rangeBetween,
  toggleMark,
  visibleEntries,
} from "@/features/code/treeSelection";

function entry(name: string, path: string, isDir: boolean): CodeDirEntry {
  return { name, relative_path: path, is_dir: isDir, ignored: false };
}

const TREE = new Map<string, CodeDirEntry[]>([
  ["", [entry("src", "src", true), entry("lib", "lib", true), entry("a.ts", "a.ts", false)]],
  ["src", [entry("main.ts", "src/main.ts", false), entry("deep", "src/deep", true)]],
  ["src/deep", [entry("x.ts", "src/deep/x.ts", false)]],
  ["lib", [entry("b.ts", "lib/b.ts", false)]],
]);
const childrenOf = (dir: string) => TREE.get(dir);

describe("clickIntent", () => {
  it("⇧ 가 ⌘ 보다 세다 — 둘 다 눌리면 범위다", () => {
    expect(clickIntent({ metaKey: false, ctrlKey: false, shiftKey: false })).toBe("replace");
    expect(clickIntent({ metaKey: true, ctrlKey: false, shiftKey: false })).toBe("toggle");
    expect(clickIntent({ metaKey: false, ctrlKey: true, shiftKey: false })).toBe("toggle");
    expect(clickIntent({ metaKey: true, ctrlKey: false, shiftKey: true })).toBe("range");
  });
});

describe("visibleEntries", () => {
  it("펼친 가지만 따라 내려가며 화면 순서 그대로 편다", () => {
    const order = visibleEntries(childrenOf, new Set(["src"])).map((e) => e.path);
    expect(order).toEqual(["src", "src/main.ts", "src/deep", "lib", "a.ts"]);
  });

  it("접힌 폴더의 자식은 없다 — 안 보이는 것을 범위에 넣으면 고른 적 없는 파일이 딸려 간다", () => {
    const order = visibleEntries(childrenOf, new Set()).map((e) => e.path);
    expect(order).toEqual(["src", "lib", "a.ts"]);
  });
});

describe("rangeBetween", () => {
  const order = visibleEntries(childrenOf, new Set(["src"]));

  it("방향에 상관없이 두 자리 사이를 전부 채운다", () => {
    expect(rangeBetween(order, "src/main.ts", "a.ts").map((e) => e.path)).toEqual([
      "src/main.ts",
      "src/deep",
      "lib",
      "a.ts",
    ]);
    expect(rangeBetween(order, "a.ts", "src/main.ts").map((e) => e.path)).toEqual([
      "src/main.ts",
      "src/deep",
      "lib",
      "a.ts",
    ]);
  });

  it("기준이 없으면 누른 것 하나", () => {
    expect(rangeBetween(order, null, "lib").map((e) => e.path)).toEqual(["lib"]);
  });

  it("폴더 여부를 잃지 않는다 (삭제 확인 문구가 이걸로 갈린다)", () => {
    expect(rangeBetween(order, "src", "src/main.ts")).toEqual([
      { path: "src", isDir: true },
      { path: "src/main.ts", isDir: false },
    ]);
  });
});

describe("toggleMark", () => {
  it("있으면 빼고 없으면 넣는다. 원본은 그대로 둔다", () => {
    const before = marksOf([{ path: "a.ts", isDir: false }]);
    const added = toggleMark(before, { path: "lib", isDir: true });
    expect([...added.keys()]).toEqual(["a.ts", "lib"]);
    expect(added.get("lib")).toBe(true);
    expect(toggleMark(added, { path: "a.ts", isDir: false }).has("a.ts")).toBe(false);
    expect(before.size).toBe(1);
  });
});

describe("pruneNested", () => {
  it("조상이 뽑혀 있으면 후손은 뺀다 — 폴더를 옮기면 안의 것은 이미 따라간다", () => {
    expect(pruneNested(["src", "src/main.ts", "src/deep/x.ts", "lib"])).toEqual(["lib", "src"]);
  });

  it("이름이 접두사로 겹칠 뿐인 형제는 남긴다", () => {
    // "src" 는 "src-old" 의 조상이 아니다 — 경계는 `/` 다.
    expect(pruneNested(["src", "src-old"])).toEqual(["src", "src-old"]);
  });
});

describe("actionTargets", () => {
  const marks = marksOf([
    { path: "a.ts", isDir: false },
    { path: "lib", isDir: true },
  ]);

  it("뽑아 둔 것 안에서 잡으면 뽑은 전부를 데려간다", () => {
    expect(actionTargets(marks, "a.ts", false)).toEqual([
      { path: "a.ts", isDir: false },
      { path: "lib", isDir: true },
    ]);
  });

  it("선택 밖을 잡으면 그것 하나뿐이다 (선택은 버려진다)", () => {
    expect(actionTargets(marks, "src", true)).toEqual([{ path: "src", isDir: true }]);
  });

  it("하나만 뽑혀 있으면 그냥 그 하나다", () => {
    const one = marksOf([{ path: "a.ts", isDir: false }]);
    expect(actionTargets(one, "a.ts", false)).toEqual([{ path: "a.ts", isDir: false }]);
  });
});
