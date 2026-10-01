// 앱 설정(SQLite 키-값) 커맨드 래퍼 (2026-10-01 `{#api-facades}`).
//
// 화면 대부분은 `SettingsContext` 를 지나지만, 그 밖에서 키 하나를 직접 읽고
// 쓰는 자리(LLM 대상 해석·코드 탭의 언어 서버 행)가 여기를 쓴다.
import { commands } from "@/lib/bindings";
import { call } from "./invoke";

export const settingsApi = {
  /** 저장된 값. 한 번도 안 쓴 키는 `null`. */
  get: (key: string): Promise<string | null> => call("settings_get", commands.settingsGet(key)),
  set: (key: string, value: string): Promise<null> => call("settings_set", commands.settingsSet(key, value)),
};
