// 저장 시 정리(B1)의 순수 모델 — docs/20260902_vscode-borrows/01-save-hygiene.md §B1.
//
// 이 함수가 틀리면 **디스크에 잘못 쓴다**. jsdom 이 못 보는 자리라 경계를 여기서
// 전부 잠근다: 보호 줄·끝줄 조합 순서·마크다운 예외·무변경 계약.
import { describe, it, expect } from "vitest";

import { applyHygiene, hygieneForPath, type HygieneOptions } from "@/features/code/saveHygiene";

/** 아무것도 안 하는 기준값 — 테스트마다 켤 것만 켠다. */
const OFF: HygieneOptions = {
  trimTrailingWhitespace: false,
  insertFinalNewline: false,
  trimFinalNewlines: false,
  protectedLines: [],
};

describe("applyHygiene — 후행 공백", () => {
  it("각 줄 끝의 공백과 탭을 지운다", () => {
    const text = "const a = 1;  \n\tif (a) {\t\n  return;   \n}\n";
    expect(applyHygiene(text, { ...OFF, trimTrailingWhitespace: true })).toBe(
      "const a = 1;\n\tif (a) {\n  return;\n}\n",
    );
  });

  it("줄 안쪽의 공백은 건드리지 않는다", () => {
    const text = "a  =  1\n";
    expect(applyHygiene(text, { ...OFF, trimTrailingWhitespace: true })).toBe(text);
  });

  it("보호 줄(자동 저장 시 커서 줄)은 그대로 둔다", () => {
    // 들여쓰기를 치고 멈춘 순간 자동 저장이 그 공백을 먹으면 커서가 튄다.
    const text = "function f() {\n  \nconst x = 1;   \n";
    expect(
      applyHygiene(text, { ...OFF, trimTrailingWhitespace: true, protectedLines: [2] }),
    ).toBe("function f() {\n  \nconst x = 1;\n");
  });

  it("공백만 있는 줄도 (보호되지 않았으면) 빈 줄이 된다", () => {
    expect(applyHygiene("a\n   \nb\n", { ...OFF, trimTrailingWhitespace: true })).toBe(
      "a\n\nb\n",
    );
  });
});

describe("applyHygiene — 끝줄", () => {
  it("insertFinalNewline: 개행으로 끝나지 않으면 하나 붙인다", () => {
    expect(applyHygiene("a\nb", { ...OFF, insertFinalNewline: true })).toBe("a\nb\n");
  });

  it("insertFinalNewline: 빈 파일에는 붙이지 않는다", () => {
    expect(applyHygiene("", { ...OFF, insertFinalNewline: true })).toBe("");
  });

  it("trimFinalNewlines: 끝의 빈 줄을 하나만 남긴다", () => {
    expect(applyHygiene("a\n\n\n\n", { ...OFF, trimFinalNewlines: true })).toBe("a\n");
  });

  it("trimFinalNewlines: 이미 하나면 그대로다", () => {
    expect(applyHygiene("a\n", { ...OFF, trimFinalNewlines: true })).toBe("a\n");
  });

  it("trimFinalNewlines: 개행 없이 끝나면 붙이지 않는다", () => {
    // 끝줄 삽입은 insertFinalNewline 의 일이다 — 여기서 대신 하지 않는다.
    expect(applyHygiene("a", { ...OFF, trimFinalNewlines: true })).toBe("a");
  });

  it("trimFinalNewlines: 전부 빈 줄인 파일은 손대지 않는다", () => {
    // VS Code 는 전체를 지우지만(doTrimFinalNewLines), 저장 한 번에 본문이
    // 통째로 사라지는 편이 더 위험하다 — 의도적 분기.
    expect(applyHygiene("\n\n\n", { ...OFF, trimFinalNewlines: true })).toBe("\n\n\n");
  });

  it("trimFinalNewlines: 보호 줄 아래로는 자르지 않는다", () => {
    // 커서가 5번째(빈) 줄에 있으면 그 줄은 남아야 커서가 유효하다.
    expect(
      applyHygiene("a\n\n\n\n\n\n", { ...OFF, trimFinalNewlines: true, protectedLines: [5] }),
    ).toBe("a\n\n\n\n\n");
  });

  it("셋을 함께 켜면 끝이 정확히 개행 하나가 된다", () => {
    expect(
      applyHygiene("a   \n\n\n   \n", {
        trimTrailingWhitespace: true,
        insertFinalNewline: true,
        trimFinalNewlines: true,
        protectedLines: [],
      }),
    ).toBe("a\n");
  });
});

describe("applyHygiene — 계약", () => {
  it("이미 정돈된 본문은 같은 문자열 그대로다", () => {
    // 이 계약이 깨지면 저장마다 버퍼가 갈리고 에디터가 재마운트된다.
    const tidy = "const a = 1;\nconst b = 2;\n";
    const all: HygieneOptions = {
      trimTrailingWhitespace: true,
      insertFinalNewline: true,
      trimFinalNewlines: true,
      protectedLines: [],
    };
    expect(applyHygiene(tidy, all)).toBe(tidy);
  });

  it("전부 꺼져 있으면 원본을 그대로 돌려준다", () => {
    const messy = "a   \n\n\n";
    expect(applyHygiene(messy, OFF)).toBe(messy);
  });
});

describe("hygieneForPath — 마크다운 예외", () => {
  const on: HygieneOptions = { ...OFF, trimTrailingWhitespace: true };

  it(".md 와 .markdown 은 후행 공백 정리에서 빠진다", () => {
    // 줄 끝 두 칸이 강제 개행이라, 지우면 문서의 뜻이 바뀐다.
    expect(hygieneForPath("docs/README.md", on).trimTrailingWhitespace).toBe(false);
    expect(hygieneForPath("a/b/NOTE.MARKDOWN", on).trimTrailingWhitespace).toBe(false);
  });

  it("끝줄 정리는 마크다운에서도 그대로 산다", () => {
    const both = { ...on, insertFinalNewline: true };
    expect(hygieneForPath("a.md", both).insertFinalNewline).toBe(true);
  });

  it("다른 확장자는 그대로 통과한다 — 같은 객체를 돌려준다", () => {
    expect(hygieneForPath("src/a.ts", on)).toBe(on);
  });

  it("`.md` 로 끝나지 않는 이름에 속지 않는다", () => {
    expect(hygieneForPath("src/md.ts", on).trimTrailingWhitespace).toBe(true);
    expect(hygieneForPath("CHANGELOG.mdx", on).trimTrailingWhitespace).toBe(true);
  });
});
