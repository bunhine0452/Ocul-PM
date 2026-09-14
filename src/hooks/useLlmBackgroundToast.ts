// 백그라운드 LLM 작업(색인 후 개요 생성)의 실패를 토스트로 (2026-09-14 감사 7번).
//
// 기본 모델이 EOL 된 채 3주를 지나도 로그 말고는 아무 데도 안 보였다. 죽은
// 모델은 설정의 문제라 프로젝트를 가리지 않고 창 하나에 한 번 건다 — 같은
// provider·model 은 한 시간에 한 번만. 워크스페이스 컨텍스트가 아니라 여기인
// 이유: 프로젝트 탭마다가 아니라 창마다 하나면 된다.

import { useEffect } from "react";

import { llmApi } from "@/api/llm";
import { toast } from "@/lib/toast";
import { createUnlistenBag } from "@/lib/unlisten";
import { useT } from "@/i18n";

export function useLlmBackgroundToast(): void {
  const { t } = useT();
  useEffect(() => {
    const bag = createUnlistenBag();
    bag.add(
      llmApi.onBackgroundFailed((payload) => {
        const { provider, model, message } = payload;
        toast.warning(t("ws.llmBgFailed", { provider, model, message: message.slice(0, 160) }), {
          title: t("ws.llmBgFailedTitle"),
          dedupKey: `llmbg:${provider}:${model}`,
          dedupWindowMs: 60 * 60_000,
        });
      }),
    );
    return () => bag.dispose();
  }, [t]);
}
