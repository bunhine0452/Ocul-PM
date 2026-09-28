import { describe, expect, it } from "vitest";
import {
  isTargetMissing,
  packageManagedFormat,
  statusAfterCheck,
  statusBeforeCheck,
  type CheckOutcome,
  type InstallKindLike,
} from "@/lib/updaterRoute";

// ─── 업데이터 판정 — 세 OS × 설치 형식 × 확인 결과 (크로스플랫폼 L-UPD #upd-target-missing) ───
// 업데이터는 버전과 무관하게 latest.json 에서 자기 키부터 찾는다. deb 설치본과 이번 릴리스에서
// 빠진 OS 의 앱은 그래서 확인할 때마다 「대상 없음」 이었다 — 설정에서 직접 확인하면 오류 문장이
// 보였다. 여기서 그 판정을 전수로 문다.

/** Rust `install_kind::compute` 와 같은 규칙 — 설치 형식 → 업데이터가 찾는 키. */
function install(os: "darwin" | "windows" | "linux", format: string | null): InstallKindLike {
  const arch = os === "darwin" ? "aarch64" : "x86_64";
  return {
    os,
    bundle_type: format,
    updater_targets: [...(format ? [`${os}-${arch}-${format}`] : []), `${os}-${arch}`],
  };
}

/** tauri-plugin-updater 2.10.1 error.rs 의 실제 문장 (Rust 테스트가 같은 표식을 대조한다). */
const targetsNotFound = (targets: string[]) =>
  `None of the fallback platforms \`[${targets.map((t) => `"${t}"`).join(", ")}]\` were found in the response \`platforms\` object`;

const MATRIX: Record<"darwin" | "windows" | "linux", (string | null)[]> = {
  darwin: ["app", null],
  windows: ["nsis", "msi", null],
  linux: ["appimage", "deb", "rpm", null],
};

function outcomesFor(kind: InstallKindLike): [string, CheckOutcome][] {
  return [
    ["새 버전", { kind: "found", version: "9.9.9", notes: "노트" }],
    ["새 버전 없음", { kind: "none" }],
    ["대상 없음", { kind: "failed", message: targetsNotFound(kind.updater_targets) }],
    ["네트워크 오류", { kind: "failed", message: "error sending request for url (https://github.com/...)" }],
  ];
}

describe("업데이터 판정 — 세 OS × 설치 형식 × 결과", () => {
  for (const [os, formats] of Object.entries(MATRIX) as [keyof typeof MATRIX, (string | null)[]][]) {
    for (const format of formats) {
      const kind = install(os, format);
      const managed = format === "deb" || format === "rpm";
      for (const [label, outcome] of outcomesFor(kind)) {
        it(`${os} · ${format ?? "번들 밖"} · ${label}`, () => {
          const before = statusBeforeCheck(kind);
          if (managed) {
            // 패키지 관리자가 주인 — 업데이터에 묻지 않는다(결과가 무엇이든 같은 안내).
            expect(before).toEqual({ kind: "packageManaged", format });
            return;
          }
          expect(before).toBeNull();
          const after = statusAfterCheck(kind, outcome);
          switch (label) {
            case "새 버전":
              expect(after).toEqual({ kind: "available", version: "9.9.9", notes: "노트" });
              break;
            case "새 버전 없음":
              expect(after).toEqual({ kind: "uptodate" });
              break;
            case "대상 없음":
              // 오류도 「최신이에요」 도 아니다 — 이 OS 의 빌드가 없다는 중립 상태.
              expect(after).toEqual({ kind: "noBuild", targets: kind.updater_targets });
              break;
            default:
              expect(after.kind).toBe("error");
          }
        });
      }
    }
  }
});

describe("업데이터 판정 — 가장자리", () => {
  it("설치 형식을 모르면(커맨드 실패) 예전처럼 묻고, 대상 없음은 여전히 중립이다", () => {
    expect(statusBeforeCheck(null)).toBeNull();
    const after = statusAfterCheck(null, { kind: "failed", message: targetsNotFound(["linux-x86_64"]) });
    expect(after).toEqual({ kind: "noBuild", targets: [] });
  });

  it("대상 없음은 결코 uptodate 가 되지 않는다 (최신이라고 말하지 않는다)", () => {
    for (const [os, formats] of Object.entries(MATRIX) as [keyof typeof MATRIX, (string | null)[]][]) {
      for (const format of formats) {
        const kind = install(os, format);
        const after = statusAfterCheck(kind, { kind: "failed", message: targetsNotFound(kind.updater_targets) });
        expect(after.kind).not.toBe("uptodate");
        expect(after.kind).not.toBe("error");
      }
    }
  });

  it("사용자가 대상을 정한 경우의 단수 문장(TargetNotFound)도 대상 없음이다", () => {
    expect(isTargetMissing("the platform `linux-x86_64` was not found in the response `platforms` object")).toBe(true);
  });

  it("다른 오류는 대상 없음으로 오인하지 않는다", () => {
    expect(isTargetMissing("Could not fetch a valid release JSON from the remote")).toBe(false);
    expect(isTargetMissing("invalid updater binary format")).toBe(false);
    expect(isTargetMissing("")).toBe(false);
  });

  it("패키지 관리 형식은 deb·rpm 뿐이다 — AppImage 는 앱이 스스로 갈아 끼운다", () => {
    expect(packageManagedFormat(install("linux", "deb"))).toBe("deb");
    expect(packageManagedFormat(install("linux", "rpm"))).toBe("rpm");
    expect(packageManagedFormat(install("linux", "appimage"))).toBeNull();
    expect(packageManagedFormat(install("windows", "nsis"))).toBeNull();
    expect(packageManagedFormat(install("linux", null))).toBeNull();
  });
});
