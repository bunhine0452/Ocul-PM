import { describe, expect, it } from "vitest";

// @ts-expect-error — 빌드 대상이 아닌 zero-dep 검사 스크립트 (.mjs, 타입 없음).
import { allowedLineCount, countLines, evaluateFileSize, isGoverned, parseChangedFiles, parseUntracked, resolveBaseRef, MAX_LINES } from "../../scripts/check-file-sizes.mjs";

// 파일 크기 래칫의 계약 (플랜 `evidence-based-rules` #ratchet).
//
// 이 게이트의 값어치는 전부 **래칫 성질**에 있다 — 이미 넘은 파일을 지금
// 고치라고 하면 게이트가 통째로 무시되고, 아무것도 안 막으면 없는 것과 같다.

describe("allowedLineCount — 래칫", () => {
  it("기준선이 없으면(신규 파일) 한계가 상한이다", () => {
    expect(allowedLineCount(null, 800)).toBe(800);
    expect(allowedLineCount(undefined, 800)).toBe(800);
  });

  it("한계 안이면 한계가 상한이다 — 경계값 포함", () => {
    expect(allowedLineCount(799, 800)).toBe(800);
    expect(allowedLineCount(800, 800)).toBe(800);
  });

  it("이미 넘어 있으면 **그 크기**가 상한이다 (부채를 강제하지 않는다)", () => {
    expect(allowedLineCount(3674, 800)).toBe(3674);
  });
});

describe("evaluateFileSize — 통과와 실패", () => {
  it("한계를 넘긴 신규 파일은 막힌다", () => {
    expect(evaluateFileSize({ baseLines: null, candidateLines: 801 }).violates).toBe(true);
  });

  it("이미 큰 파일은 **늘지 않으면** 통과한다", () => {
    expect(evaluateFileSize({ baseLines: 1000, candidateLines: 1000 }).violates).toBe(false);
    expect(evaluateFileSize({ baseLines: 1000, candidateLines: 999 }).violates).toBe(false);
    expect(evaluateFileSize({ baseLines: 1000, candidateLines: 1001 }).violates).toBe(true);
  });

  it("한계가 기본값으로 걸린다", () => {
    expect(MAX_LINES).toBe(800);
    expect(evaluateFileSize({ baseLines: null, candidateLines: MAX_LINES }).violates).toBe(false);
  });
});

// 미추적 파일이 게이트에 안 보이던 자리 (2026-09-04). `git diff` 는 추적 파일만
// 보므로, 800줄을 처음부터 넘겨 태어나는 새 파일이 커밋 전까지 조용했다 —
// 1,697줄짜리 테스트 파일이 로컬에서 clean 이었다가 커밋 직후 CI 를 붉혔다.
describe("parseUntracked — 아직 추적되지 않는 파일", () => {
  it("전부 신규(A)로 싣는다 — 기준선이 없으니 800줄 상한을 그대로 맞는다", () => {
    expect(parseUntracked("src/a.ts\0src/b.tsx\0")).toEqual([
      { status: "A", path: "src/a.ts" },
      { status: "A", path: "src/b.tsx" },
    ]);
  });

  it("빈 출력은 빈 목록 — 마지막 NUL 뒤의 빈 조각을 세지 않는다", () => {
    expect(parseUntracked("")).toEqual([]);
    expect(parseUntracked("\0")).toEqual([]);
  });

  it("신규 판정이라 한계를 넘으면 막힌다", () => {
    const [only] = parseUntracked("src/huge.ts\0");
    expect(only.status).toBe("A");
    // 신규 = baseLines 없음 → 상한은 MAX_LINES.
    expect(evaluateFileSize({ baseLines: null, candidateLines: 901 }).violates).toBe(true);
  });
});

describe("parseChangedFiles — 이름이 바뀐 파일", () => {
  it("R/C 는 필드가 셋이다 — 둘로 세면 그 뒤가 전부 밀린다", () => {
    const out = "R100\0src/old.ts\0src/new.ts\0M\0src/other.ts\0";
    expect(parseChangedFiles(out)).toEqual([
      { status: "R", oldPath: "src/old.ts", path: "src/new.ts" },
      { status: "M", path: "src/other.ts" },
    ]);
  });

  it("삭제와 추가를 그대로 싣는다", () => {
    const out = "D\0src/gone.ts\0A\0src/fresh.ts\0";
    expect(parseChangedFiles(out)).toEqual([
      { status: "D", path: "src/gone.ts" },
      { status: "A", path: "src/fresh.ts" },
    ]);
  });
});

describe("isGoverned — 손으로 쓰는 소스만", () => {
  it("Rust 와 TS 소스를 문다", () => {
    expect(isGoverned("src-tauri/src/oculpm/chain.rs")).toBe(true);
    expect(isGoverned("src/features/sessions/SessionsScreenV2.tsx")).toBe(true);
  });

  it("생성물·사전·죽은 코드는 뺀다", () => {
    expect(isGoverned("src/lib/bindings.ts")).toBe(false);
    expect(isGoverned("src/i18n/ko.ts")).toBe(false);
    expect(isGoverned("src/legacy/OldScreen.tsx")).toBe(false);
  });

  it("대상 밖 확장자·경로는 무시한다", () => {
    expect(isGoverned("docs/a2a/00-master-plan.md")).toBe(false);
    expect(isGoverned("scripts/check-file-sizes.mjs")).toBe(false);
  });
});

describe("resolveBaseRef — 무엇과 비교하나", () => {
  it("환경변수가 있으면 그것이 이긴다", () => {
    expect(resolveBaseRef({ OCULPM_FILESIZE_BASE: "abc123" }, () => "")).toBe("abc123");
  });

  it("CI 는 직전 커밋을 본다", () => {
    expect(resolveBaseRef({ GITHUB_ACTIONS: "true" }, () => "")).toBe("HEAD^1");
  });

  it("로컬은 merge-base — 브랜치가 곧 main 이면 HEAD 로 접힌다", () => {
    const git = (args: string[]) => (args[0] === "merge-base" ? "same\n" : "same\n");
    expect(resolveBaseRef({}, git)).toBe("HEAD");
    const forked = (args: string[]) => (args[0] === "merge-base" ? "base1\n" : "head1\n");
    expect(resolveBaseRef({}, forked)).toBe("base1");
  });

  it("기준선을 못 잡으면 **던진다** — 조용히 통과하지 않는다", () => {
    expect(() =>
      resolveBaseRef({}, () => {
        throw new Error("no origin/main");
      }),
    ).toThrow();
  });
});

describe("countLines", () => {
  it("빈 파일은 0줄", () => {
    expect(countLines("")).toBe(0);
  });

  it("마지막 개행 뒤의 빈 줄까지 센다 (wc -l 과 한 줄 차이나는 지점)", () => {
    expect(countLines("a\nb\n")).toBe(3);
    expect(countLines("a\nb")).toBe(2);
  });
});
