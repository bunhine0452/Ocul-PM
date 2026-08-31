/**
 * `automationApi` — 자동화 커맨드의 단일 래퍼.
 *
 * 봉투(`{status}`)를 풀어 값을 돌려주고 실패는 `ApiError` 하나로 접는다
 * (완성도 라운드 `#error-convention` — 화면은 `catch (e)` 하나에
 * `tError(toAppError(e))`). 새 파일은 `bindings.ts` 를 직접 부르지 않는다.
 */

import { call, type Envelope } from "@/api/invoke";
import { commands } from "@/lib/bindings";
import type {
  AutomationDef,
  AutomationRunDto,
  AutomationRunOutcome,
  AutomationSummary,
} from "@/lib/bindings";

const unwrap = <T,>(command: string, p: Promise<Envelope<T>>) => call<T>(command, p);

export const automationApi = {
  list: (projectId: number) =>
    unwrap<AutomationSummary[]>("automation_list", commands.automationList(projectId)),

  runs: (projectId: number, automationId: string | null, limit: number) =>
    unwrap<AutomationRunDto[]>(
      "automation_runs",
      commands.automationRuns(projectId, automationId, limit)
    ),

  seeds: (projectId: number) =>
    unwrap<AutomationDef[]>("automation_seeds", commands.automationSeeds(projectId)),

  save: (projectId: number, def: AutomationDef) =>
    unwrap<AutomationSummary>("automation_save", commands.automationSave(projectId, def)),

  remove: (projectId: number, kind: string, id: string) =>
    unwrap<boolean>("automation_delete", commands.automationDelete(projectId, kind, id)),

  setEnabled: (projectId: number, kind: string, id: string, enabled: boolean) =>
    unwrap<AutomationSummary>(
      "automation_set_enabled",
      commands.automationSetEnabled(projectId, kind, id, enabled)
    ),

  createSeed: (projectId: number, seedId: string) =>
    unwrap<AutomationSummary>(
      "automation_create_seed",
      commands.automationCreateSeed(projectId, seedId)
    ),

  runNow: (projectId: number, kind: string, id: string) =>
    unwrap<AutomationRunOutcome>(
      "automation_run_now",
      commands.automationRunNow(projectId, kind, id)
    ),

  cancel: () => unwrap<null>("automation_cancel", commands.automationCancel()),
};
