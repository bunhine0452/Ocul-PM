import { useEffect, useState } from "react";

import { llmApi } from "@/api/llm";
import { PROVIDERS, type Provider } from "@/lib/settings";

/** 프로바이더별 키 존재. `null` = 아직 모른다 (확인 중이거나 못 읽었다). */
export type KeyPresence = Record<Provider, boolean | null>;

const UNKNOWN: KeyPresence = {
  anthropic: null,
  openai: null,
  gemini: null,
  nim: null,
  openrouter: null,
};

/**
 * 키체인에 어떤 프로바이더의 키가 있는지 mount 때 한 번 묻는다
 * (`AiPanelScreenV2` 에서 갈라 나온 조각).
 *
 * **한 번에 묻고 한 번에 쓴다.** 예전에는 `PROVIDERS.forEach(async …)` 였는데
 * 그 모양은 셋을 동시에 잃는다 (2026-09-07 감사):
 *
 * 1. `forEach` 는 async 콜백의 프로미스를 **버린다** — 거부를 아무도 받지 않아
 *    키체인이 잠겨 있어도 조용하다.
 * 2. 프로바이더마다 `setState` 를 따로 쏴서, `keysResolved`(전부 non-null)를
 *    보는 화면이 그 수만큼 다시 그려진다.
 * 3. 실패를 `false` 로 접으면 "키 없음" 과 구별이 사라진다 — `llmApi.hasKey` 가
 *    `null` 로 돌려주는 이유다.
 *
 * 파일로 나온 이유가 하나 더 있다: `AiPanelScreenV2.tsx` 는 크기 래칫이 걸려
 * 있어 (`useEscCancel` 이 `AcpConversation` 에서 나온 것과 같은 사정) 자기
 * 완결적인 이 구독이 가장 자연스러운 조각이었다.
 */
export function useProviderKeys(): KeyPresence {
  const [hasKey, setHasKey] = useState<KeyPresence>(() => ({ ...UNKNOWN }));

  useEffect(() => {
    let cancelled = false;
    void Promise.all(PROVIDERS.map((p) => llmApi.hasKey(p))).then((results) => {
      if (cancelled) return;
      const next = { ...UNKNOWN };
      PROVIDERS.forEach((p, i) => {
        next[p] = results[i];
      });
      setHasKey(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return hasKey;
}
