// `@tauri-apps/api/core` 치환 셤 (#mb2-shim, 플랜 D3).
//
// vite.config.ts 의 alias 가 앱·플러그인의 모든 `@tauri-apps/api/core` 임포트를
// 이 파일로 돌린다 (이 디렉터리 안에서의 임포트만 진짜 모듈로 — customResolver).
// 웹뷰(데스크톱)에서는 전부 원본에 위임하고, 브라우저(폰)에서만 HTTP 로 바꾼다.
// vitest 는 vitest.config.ts (alias 없음)라 기존 테스트 경로는 원본 그대로다.

import * as real from "@tauri-apps/api/core";

import { httpInvoke, isTauri } from "./http";

// 명시 export 가 아래에 없는 표면(transformCallback·Resource·권한류…)은 원본 통과.
export * from "@tauri-apps/api/core";

/** 브라우저 Channel — 스트리밍 커맨드는 MB4 전까지 비지원 (toJSON 이 거부). */
class BrowserChannel<T = unknown> {
  onmessage: (message: T) => void = () => {};
  toJSON(): string {
    throw new Error("streaming commands are not available over the mobile bridge yet");
  }
}

export const invoke: typeof real.invoke = isTauri()
  ? real.invoke
  : (httpInvoke as typeof real.invoke);

export const Channel: typeof real.Channel = (
  isTauri() ? real.Channel : (BrowserChannel as unknown)
) as typeof real.Channel;

export const convertFileSrc: typeof real.convertFileSrc = isTauri()
  ? real.convertFileSrc
  : (path: string) => path;
