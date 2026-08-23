// 파일 조작의 경로 계산 + 버퍼 재키잉.
//
// 버퍼 쪽이 이 파일의 핵심이다: 파일을 옮기는 순간 미저장 편집이 조용히
// 사라지는 것이 가장 나쁜 실패 방식이고, 눈으로는 알아채기 어렵다.
import { beforeEach, describe, expect, it } from "vitest";
import {
  baseName,
  joinPath,
  moveTarget,
  parentDir,
  renameTarget,
  validateName,
} from "@/features/code/fileOps";
import {
  _resetBuffers,
  bufferKey,
  dropBuffersUnder,
  getBuffer,
  listDirtyPaths,
  putBuffer,
  renameBufferPath,
  type CodeBuffer,
} from "@/features/code/codeBuffers";

describe("fileOps — 경로", () => {
  it("부모·이름·잇기", () => {
    expect(parentDir("src/a/b.rs")).toBe("src/a");
    expect(parentDir("README.md")).toBe("");
    expect(baseName("src/a/b.rs")).toBe("b.rs");
    expect(joinPath("", "a.ts")).toBe("a.ts");
    expect(joinPath("src", "a.ts")).toBe("src/a.ts");
  });

  it("이름 검사 — / 는 허용하고 빈 구간·점만 막는다", () => {
    expect(validateName("a.ts")).toBeNull();
    expect(validateName("nested/a.ts")).toBeNull(); // VS Code 처럼 한 번에 만들기
    expect(validateName("  ")).toBe("empty");
    expect(validateName("a//b")).toBe("empty");
    expect(validateName("..")).toBe("dotdot");
    expect(validateName("a/../b")).toBe("dotdot");
    expect(validateName("a\\b")).toBe("separator");
  });

  it("이름만 주면 제자리, 경로를 주면 루트 기준으로 옮긴다", () => {
    expect(renameTarget("src/a.ts", "b.ts")).toBe("src/b.ts");
    expect(renameTarget("src/a.ts", "lib/b.ts")).toBe("lib/b.ts");
    expect(renameTarget("a.ts", "b.ts")).toBe("b.ts");
  });
});

describe("fileOps — 드래그 이동", () => {
  it("목적지 폴더 아래로 같은 이름을 옮긴다", () => {
    expect(moveTarget("src/a.ts", "lib")).toEqual({ ok: true, to: "lib/a.ts" });
    expect(moveTarget("src/a.ts", "")).toEqual({ ok: true, to: "a.ts" }); // 루트로
  });

  it("이미 그 폴더에 있으면 취소로 본다 (말없이 아무 일도 없음)", () => {
    expect(moveTarget("src/a.ts", "src")).toEqual({ ok: false, reason: "sameDir" });
    expect(moveTarget("a.ts", "")).toEqual({ ok: false, reason: "sameDir" });
  });

  it("폴더를 자기 자신·자기 후손으로는 못 옮긴다", () => {
    expect(moveTarget("src", "src")).toEqual({ ok: false, reason: "intoSelf" });
    expect(moveTarget("src", "src/deep")).toEqual({ ok: false, reason: "intoSelf" });
    // 접두사만 겹치는 형제는 정상 이동이다.
    expect(moveTarget("src", "src-old")).toEqual({ ok: true, to: "src-old/src" });
  });
});

describe("codeBuffers — 이름이 바뀌어도 미저장 편집이 남는다", () => {
  const dirty = (text: string): CodeBuffer => ({
    text,
    baseText: "disk",
    baseHash: "h",
    eol: "\n",
  });
  const clean = (): CodeBuffer => ({ text: "disk", baseText: "disk", baseHash: "h", eol: "\n" });

  beforeEach(_resetBuffers);

  it("파일 이름이 바뀌면 버퍼가 새 키로 따라간다", () => {
    putBuffer(bufferKey(1, "src/a.ts"), dirty("편집 중"));
    renameBufferPath(1, "src/a.ts", "src/z.ts", false);

    expect(getBuffer(bufferKey(1, "src/a.ts"))).toBeUndefined();
    expect(getBuffer(bufferKey(1, "src/z.ts"))?.text).toBe("편집 중");
    expect([...listDirtyPaths(1)]).toEqual(["src/z.ts"]);
  });

  it("폴더 이름이 바뀌면 그 아래 버퍼가 전부 따라가고, 형제는 그대로다", () => {
    putBuffer(bufferKey(1, "src/a.ts"), dirty("A"));
    putBuffer(bufferKey(1, "src/deep/b.ts"), dirty("B"));
    putBuffer(bufferKey(1, "src-old/c.ts"), dirty("C"));
    renameBufferPath(1, "src", "lib", true);

    expect(getBuffer(bufferKey(1, "lib/a.ts"))?.text).toBe("A");
    expect(getBuffer(bufferKey(1, "lib/deep/b.ts"))?.text).toBe("B");
    expect(getBuffer(bufferKey(1, "src-old/c.ts"))?.text).toBe("C");
    expect([...listDirtyPaths(1)].sort()).toEqual(["lib/a.ts", "lib/deep/b.ts", "src-old/c.ts"]);
  });

  it("다른 프로젝트의 같은 경로는 건드리지 않는다", () => {
    putBuffer(bufferKey(1, "a.ts"), dirty("mine"));
    putBuffer(bufferKey(2, "a.ts"), dirty("theirs"));
    renameBufferPath(1, "a.ts", "b.ts", false);

    expect(getBuffer(bufferKey(2, "a.ts"))?.text).toBe("theirs");
    expect(getBuffer(bufferKey(1, "b.ts"))?.text).toBe("mine");
  });

  it("삭제하면 버퍼를 버리고, 사라진 미저장 편집만 알려준다", () => {
    putBuffer(bufferKey(1, "src/a.ts"), dirty("아직 저장 안 함"));
    putBuffer(bufferKey(1, "src/b.ts"), clean());
    putBuffer(bufferKey(1, "README.md"), dirty("남아야 한다"));

    const lost = dropBuffersUnder(1, "src", true);
    expect(lost).toEqual(["src/a.ts"]); // 깨끗했던 b.ts 는 보고 대상이 아니다
    expect(getBuffer(bufferKey(1, "src/b.ts"))).toBeUndefined();
    expect(getBuffer(bufferKey(1, "README.md"))?.text).toBe("남아야 한다");
  });
});
