// `.oculpm/index/` 사용량 조회 + diff 사이드카 정리 (플랜 `journal-scale-round`
// `{#index-usage}`). `codeHistory.ts` 와 같은 규약 — `call` 을 지나므로 화면은
// `catch (e)` 하나면 되고, 오류는 `tError` 로 한 모양이 된다.
import { commands, type IndexUsage } from "@/lib/bindings";
import { call } from "./invoke";

export type { IndexUsage };

export const indexUsageApi = {
  /** `history`/`diffs`/그 밖 세 갈래 사용량 + 합계 (바이트). */
  usage: (projectId: number): Promise<IndexUsage> =>
    call("oculpm_index_usage", commands.oculpmIndexUsage(projectId)),

  /** diff 사이드카 전부 삭제 — git 에서 다시 만들 수 있다. */
  clearDiffs: (projectId: number): Promise<null> =>
    call("oculpm_index_clear_diffs", commands.oculpmIndexClearDiffs(projectId)),
};
