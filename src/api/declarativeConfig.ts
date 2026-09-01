/**
 * `declarativeConfigApi` — 선언적 설정 커맨드 래퍼 (Osaurus 라운드 Phase 6).
 *
 * 봉투를 풀어 값을 돌려주고 실패는 `ApiError` 하나로 접는다
 * (완성도 라운드 `#error-convention`).
 */

import { call, type Envelope } from "@/api/invoke";
import { commands } from "@/lib/bindings";
import type { ConfigApplyResult, ConfigPlan } from "@/lib/bindings";

const unwrap = <T,>(command: string, p: Promise<Envelope<T>>) => call<T>(command, p);

export const declarativeConfigApi = {
  /** 지금 상태를 YAML 문서 문자열로. */
  export: (projectId: number | null) =>
    unwrap<string>("config_export", commands.configExport(projectId)),

  /** 대화상자로 파일 저장. 취소하면 `null`. */
  exportToFile: (projectId: number | null) =>
    unwrap<string | null>("config_export_to_file", commands.configExportToFile(projectId)),

  /** 대화상자로 파일 열기(경로를 주면 그 파일). 취소하면 `null`. */
  readFile: (path: string | null = null) =>
    unwrap<string | null>("config_read_file", commands.configReadFile(path)),

  /** 계획만 — 아무것도 쓰지 않는다. */
  plan: (projectId: number | null, doc: string) =>
    unwrap<ConfigPlan>("config_plan", commands.configPlan(projectId, doc)),

  /** 적용 + 대조 검증. */
  apply: (projectId: number | null, doc: string) =>
    unwrap<ConfigApplyResult>("config_apply", commands.configApply(projectId, doc)),
};
