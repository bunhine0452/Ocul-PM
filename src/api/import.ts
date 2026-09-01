/**
 * `importApi` — 대화 임포트 래퍼 (Osaurus 라운드 Phase 7).
 *
 * 봉투를 풀어 값을 돌려주고 실패는 `ApiError` 하나로 접는다
 * (완성도 라운드 `#error-convention`).
 */

import { call, type Envelope } from "@/api/invoke";
import { commands } from "@/lib/bindings";
import type { EntryType, ImportReport, ImportScan } from "@/lib/bindings";

const unwrap = <T,>(command: string, p: Promise<Envelope<T>>) => call<T>(command, p);

export const importApi = {
  /** `.json` / `.zip` 고르기. 취소하면 `null`. */
  pickExport: () =>
    unwrap<string | null>("conversation_pick_export", commands.conversationPickExport()),

  /** 후보 목록 — **오프라인이고 과금이 없다**. */
  scan: (projectId: number, path: string) =>
    unwrap<ImportScan>("conversation_import_scan", commands.conversationImportScan(projectId, path)),

  /** 고른 대화를 일지로. Core Model 이 없으면 `import_core_model_missing`. */
  run: (projectId: number, path: string, sourceIds: string[], types: EntryType[]) =>
    unwrap<ImportReport>(
      "conversation_import_run",
      commands.conversationImportRun(projectId, path, sourceIds, types),
    ),
};
