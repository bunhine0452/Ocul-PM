// 앱 데이터 커맨드 래퍼 (2026-10-01 `{#api-facades}`) — 설정 「데이터」 칸(캐시 크기·
// 정리·로그 폴더·앱 판)이 지난다 (4.0). 설정 키-값은 `SettingsContext` 가 맡는다.
import { commands, type AppInfo, type DbHealth } from "@/lib/bindings";
import { call } from "./invoke";

export const appDataApi = {
  /** 앱 판·데이터 폴더 경로. */
  info: (): Promise<AppInfo> => call("app_info", commands.appInfo()),
  /** 캐시 DB 크기(본체·WAL·빈 자리). */
  health: (): Promise<DbHealth> => call("db_health", commands.dbHealth()),
  /** 빈 자리를 돌려받는다 (VACUUM + WAL 체크포인트) — 정리 뒤의 크기가 온다. */
  compact: (): Promise<DbHealth> => call("db_compact", commands.dbCompact()),
  /** 로그 폴더 — 파일 로그를 못 열었으면 `null`. */
  logDir: (): Promise<string | null> => call("oculpm_get_log_dir", commands.oculpmGetLogDir()),
};
