// 열린 파일의 문서 심볼 — 아웃라인·이동 위젯·브레드크럼·스티키가 **같은 목록**을 쓴다.
// 저장·포맷 뒤에는 `setSymbolEpoch` 로 다시 묻는다.
// `CodeScreenV2` 에서 그대로 들어냈다 (optimization-round-2 {#split-codescreen}) — 동작 불변.
import { useEffect, useState } from "react";

import { commands, type LspSymbol } from "@/lib/bindings";

interface UseDocumentSymbolsArgs {
  projectId: number;
  /** 지금 보고 있는 파일. */
  selected: string | null;
  /** 접혀 있으면 묻지 않는다 — 화면이 판단해서 넘긴다. */
  wanted: boolean;
}

export function useDocumentSymbols({ projectId, selected, wanted }: UseDocumentSymbolsArgs) {
  const [symbols, setSymbols] = useState<LspSymbol[] | null>(null);
  const [symbolsLoading, setSymbolsLoading] = useState(false);
  /** 저장·포맷 뒤 아웃라인을 다시 묻게 하는 신호. */
  const [symbolEpoch, setSymbolEpoch] = useState(0);

  useEffect(() => {
    if (!wanted || !selected) {
      setSymbols(null);
      return;
    }
    let cancelled = false;
    setSymbolsLoading(true);
    void commands.lspDocumentSymbols(projectId, selected).then((res) => {
      if (cancelled) return;
      setSymbolsLoading(false);
      setSymbols(res.status === "ok" ? res.data : []);
    });
    return () => {
      cancelled = true;
    };
  }, [wanted, selected, projectId, symbolEpoch]);

  return { symbols, symbolsLoading, setSymbolEpoch };
}
