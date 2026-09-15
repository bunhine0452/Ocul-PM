// 언어 서버 상태를 상태줄의 한 낱말로. `CodePane.tsx` 의 useMemo 본문을 그대로 들어냈다.
import type { LspServerState } from "@/lib/bindings";
import { t } from "@/i18n";

// 서버 상태를 한 낱말로. **"인덱싱 중" 을 밝히는 것이 요점** — rust-analyzer 는
// 첫 기동에 수십 초를 쓰는데, 그동안 진단이 안 오는 것을 "안 붙었다" 와
// 구별할 수 없으면 사용자는 고장으로 읽는다.
export function lspLabelFor(state: LspServerState | null): string | null {
  switch (state) {
    case "indexing":
      return t("code.lsp.indexing");
    case "ready":
      return t("code.lsp.ready");
    case "starting":
      return t("code.lsp.starting");
    case "missing":
      return t("code.lsp.missing");
    case "failed":
      return t("code.lsp.failed");
    default:
      return null;
  }
}
