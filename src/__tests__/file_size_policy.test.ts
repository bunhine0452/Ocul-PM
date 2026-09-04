import { realpathSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

// @ts-expect-error — 빌드 대상이 아닌 zero-dep 검사 스크립트 (.mjs, 타입 없음).
import { EXCLUDED, GOVERNED, MAX_LINES, isGoverned } from "../../scripts/file-size-policy.mjs";
// @ts-expect-error — 같은 이유.
import { baselineLinesFor, isDirectInvocation } from "../../scripts/check-file-sizes.mjs";

// 파일 크기 래칫의 **정책과 진입**을 문다 (플랜 `v241-errors-first`
// #ratchet-policy · #ratchet-fail-open).
//
// 규율(`mcp-lifecycle-hooks` 라운드에서 확립): *"판정 로직을 지우고 상수만
// 남겨도 통과하는 테스트는 아무것도 안 지킨다."* 아래 단언은 전부 **되돌리면
// 깨지도록** 짜여 있고, 각 describe 머리에 무엇을 되돌리면 깨지는지 적었다.
// 2026-09-04 에 두 결함을 일부러 되살려 4건이 붉어지는 것을 확인했다.

// Vite 아래에서는 `import.meta.url` 이 `file:` 이 아니라 dev 서버 URL 이라
// `fileURLToPath` 가 던진다. vitest 의 cwd 는 저장소 루트(vite.config.ts 자리)다.
const SCRIPT_PATH = resolvePath(process.cwd(), "scripts/check-file-sizes.mjs");
const SCRIPT_URL = pathToFileURL(SCRIPT_PATH).href;

// 되돌리면 깨진다: GOVERNED 에서 루트 하나를 지우기, EXCLUDED 에 항목을 슬쩍
// 추가하기. 둘 다 게이트를 조용히 무력화하면서 다른 테스트는 전부 통과시키는
// 변경이다 — `src/` 루트가 빠지면 프런트 전체가 검사 밖이 되는데도 게이트는
// 여전히 "✓ clean" 을 찍는다.
describe("size policy table", () => {
  it("governs exactly two roots, in order", () => {
    expect(GOVERNED).toEqual([
      { root: "src-tauri/src/", ext: [".rs"] },
      { root: "src/", ext: [".ts", ".tsx"] },
    ]);
  });

  it("excludes exactly these six entries, in order", () => {
    expect(EXCLUDED).toEqual([
      "src/legacy/",
      "src/lib/bindings.ts",
      "src/i18n/ko.ts",
      "src/i18n/en.ts",
      "src-tauri/src/lib.rs",
      "src-tauri/src/oculpm/spec.rs",
    ]);
  });

  it("caps files at the 800 lines CLAUDE.md promises", () => {
    expect(MAX_LINES).toBe(800);
  });

  // 표가 판정에 **실제로 연결되어** 있는지. 표만 맞고 배선이 끊기면 위 세
  // 테스트는 통과하고 게이트는 아무것도 안 막는다.
  it("wires the table into the verdict", () => {
    expect(isGoverned("src/features/shell/ShellV2.tsx")).toBe(true);
    expect(isGoverned("src-tauri/src/oculpm/manager.rs")).toBe(true);
    expect(isGoverned("src-tauri/src/lib.rs")).toBe(false);
    expect(isGoverned("src-tauri/src/oculpm/spec.rs")).toBe(false);
    expect(isGoverned("src/lib/bindings.ts")).toBe(false);
  });
});

// 되돌리면 깨진다: `baseContent` 를 `catch { return null }` 로 돌리는 것.
// 그 fail-open 은 `git show` 의 **모든** 실패(손상된 ref·blobless 클론·권한·
// 인코딩)를 "신규 파일" 로 삼켜, 래칫이 조용히 800줄 평면 검사로 바뀌게 했다.
describe("baselineLinesFor — fails closed", () => {
  it("propagates a baseline read failure instead of swallowing it", () => {
    const boom = () => {
      throw new Error("fatal: invalid object name 'deadbeef'");
    };
    expect(() => baselineLinesFor({ status: "M", path: "src/a.ts" }, boom)).toThrow(
      /invalid object name/,
    );
  });

  it("decides newness from the git status code, not from a failed read", () => {
    const read = vi.fn(() => "");
    expect(baselineLinesFor({ status: "A", path: "src/new.ts" }, read)).toBeNull();
    // 여기서 읽었다면 "실패하면 신규" 방식으로 되돌아간 것이다.
    expect(read).not.toHaveBeenCalled();
  });

  it("counts the baseline for a file that already existed", () => {
    expect(baselineLinesFor({ status: "M", path: "src/a.ts" }, () => "a\nb\n")).toBe(3);
  });

  it("reads a renamed file's baseline from its old path", () => {
    const read = vi.fn(() => "x\n");
    baselineLinesFor({ status: "R", oldPath: "src/old.ts", path: "src/new.ts" }, read);
    expect(read).toHaveBeenCalledWith("src/old.ts");
  });
});

// 되돌리면 깨진다: `process.argv[1].endsWith("check-file-sizes.mjs")`.
// 아래 두 테스트가 그 판정의 양쪽 오답을 하나씩 문다.
describe("isDirectInvocation — symlinked entry", () => {
  it("recognises the same file reached through a symlink (endsWith misses it)", () => {
    // 파일 이름이 다르므로 endsWith 판정은 false 를 내고 CLI 가 안 돈다 —
    // 훅이 조용히 아무것도 안 하는 자리.
    const hook = "/repo/.git/hooks/pre-commit";
    const resolve = (p: string) => (p === hook ? SCRIPT_PATH : realpathSync(p));
    expect(isDirectInvocation(hook, SCRIPT_URL, resolve)).toBe(true);
  });

  it("rejects a same-named file from another repo (endsWith is fooled)", () => {
    // 이름이 맞아떨어져 endsWith 판정은 true 를 내고, import 만 했는데 CLI 가 돈다.
    const other = "/other/repo/scripts/check-file-sizes.mjs";
    const resolve = (p: string) => p;
    expect(isDirectInvocation(other, SCRIPT_URL, resolve)).toBe(false);
  });

  // 기본 인자(realpathSync) 배선까지 확인 — 주입한 가짜로만 통과하면 실물은 안 문다.
  it("is true for the real path with the default resolver", () => {
    expect(isDirectInvocation(SCRIPT_PATH, SCRIPT_URL)).toBe(true);
  });

  it("is false without an argv[1] (node --eval and friends)", () => {
    expect(isDirectInvocation(undefined, SCRIPT_URL)).toBe(false);
    expect(isDirectInvocation("", SCRIPT_URL)).toBe(false);
  });

  it("does not claim direct invocation when the path is gone", () => {
    expect(isDirectInvocation("/nope/gone.mjs", SCRIPT_URL)).toBe(false);
  });
});
