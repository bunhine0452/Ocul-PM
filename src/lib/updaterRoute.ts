// 업데이터의 판정 — 설치 형식 × 확인 결과 → 화면 상태 (크로스플랫폼 L-UPD
// `#upd-target-missing`, 설계 D10).
//
// 업데이터(tauri-plugin-updater 2.10.1)는 **버전과 무관하게** latest.json 에서 자기
// 키(`{os}-{arch}-{설치 형식}` → `{os}-{arch}`)부터 찾고, 없으면 「대상 없음」 오류로
// 끝난다. 그 오류가 나는 두 경우는 고장이 아니다:
//   - deb 설치본 — 릴리스는 deb 키도 맨 `linux-x86_64` 도 싣지 않는다(맨 키가 있으면 deb
//     앱이 AppImage 를 받아 설치에서 거절된다). deb 는 패키지 관리자가 파일의 주인이다.
//   - 이번 릴리스에서 빠진 OS — 설치 스모크·E2E 에서 떨어진 플랫폼은 latest.json 에 없다.
// 그래서 deb 는 묻지도 않고 안내로, 「대상 없음」 은 오류가 아니라 중립 상태로 바꾼다 —
// 「최신이에요」 라고 말하지 않는다(새 버전이 있는지 이 앱은 알 수 없다).
//
// 순수 함수만 둔다 — 플러그인·IPC 는 `lib/updater.ts` 의 훅이 부른다.

import type { InstallKind } from "@/lib/bindings";

export type UpdaterStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "uptodate" }
  | { kind: "available"; version: string; notes: string | null }
  | { kind: "installing" }
  /** 새 버전은 깔렸고, **끊으면 안 되는 일**이 끝나기를 기다리는 중. */
  | { kind: "awaiting"; reason: string }
  | { kind: "error"; message: string }
  /** 시스템 패키지(deb·rpm)로 깔린 앱 — 앱 안에서 확인·설치하지 않는다. */
  | { kind: "packageManaged"; format: string }
  /** 최신 릴리스에 이 OS·설치 형식의 빌드가 없다. `targets` 는 업데이터가 찾은 키. */
  | { kind: "noBuild"; targets: string[] };

/** 판정에 쓰는 설치 형식의 부분 — 커맨드가 실패하면 `null`(모름)로 온다. */
export type InstallKindLike = Pick<InstallKind, "os" | "bundle_type" | "updater_targets">;

/** 사용자가 새 설치 파일을 받는 곳 — 링크는 OS 브라우저로 나간다(`open_url`). */
export const RELEASES_PAGE = "https://github.com/bunhine0452/Ocul-PM/releases/latest";

/** 앱 안 업데이트를 하지 않는 설치 형식 — 파일의 주인이 시스템 패키지 관리자다. */
const PACKAGE_MANAGED = new Set(["deb", "rpm"]);

/**
 * tauri-plugin-updater 2.10.1 의 「대상 없음」 문장 (error.rs `TargetsNotFound` ·
 * `TargetNotFound`). 오류는 IPC 를 문자열로 건너오므로 문장으로 알아본다.
 * Rust 통합 테스트 `src-tauri/tests/updater_target_wording.rs` 가 플러그인의 실제 문장과
 * 이 목록을 대조한다 — 플러그인을 올려 문장이 바뀌면 거기서 붉어진다.
 */
export const TARGET_MISSING_MARKERS = [
  "were found in the response `platforms` object",
  "was not found in the response `platforms` object",
] as const;

export function isTargetMissing(message: string): boolean {
  return TARGET_MISSING_MARKERS.some((m) => message.includes(m));
}

/** 패키지 관리자가 주인인 설치면 그 형식(`deb`·`rpm`), 아니면 null. */
export function packageManagedFormat(install: InstallKindLike | null): string | null {
  const format = install?.bundle_type ?? null;
  return format && PACKAGE_MANAGED.has(format) ? format : null;
}

/**
 * 확인 **전에** 정한다. 상태를 돌려주면 업데이터에 묻지 않는다(네트워크 0) —
 * null 이면 물어본다. 설치 형식을 모르면(커맨드 실패) 예전처럼 묻는다.
 */
export function statusBeforeCheck(install: InstallKindLike | null): UpdaterStatus | null {
  const format = packageManagedFormat(install);
  return format ? { kind: "packageManaged", format } : null;
}

/** 업데이터 확인의 결과 — 플러그인의 반환·예외를 옮겨 담은 것. */
export type CheckOutcome =
  | { kind: "found"; version: string; notes: string | null }
  | { kind: "none" }
  | { kind: "failed"; message: string };

/** 확인 **뒤의** 상태. 「대상 없음」 만 오류에서 중립으로 옮긴다. */
export function statusAfterCheck(install: InstallKindLike | null, outcome: CheckOutcome): UpdaterStatus {
  switch (outcome.kind) {
    case "found":
      return { kind: "available", version: outcome.version, notes: outcome.notes };
    case "none":
      return { kind: "uptodate" };
    case "failed":
      if (isTargetMissing(outcome.message)) {
        return { kind: "noBuild", targets: install?.updater_targets ?? [] };
      }
      return { kind: "error", message: outcome.message };
  }
}
