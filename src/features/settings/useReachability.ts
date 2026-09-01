/**
 * 프로바이더 도달성 훅 (Osaurus 라운드 Phase 7 `#model-picker-offline`).
 *
 * # 왜 숨기지 않고 흐리게 하는가
 *
 * 못 닿는 프로바이더를 목록에서 빼면 사용자는 **설정이 날아간 줄 안다**.
 * 자리는 그대로 두고 흐리게 만든 뒤 사유를 툴팁에 싣는다 — 고르는 것도 막지
 * 않는다. 지금 못 닿는다는 것이 영원히 못 닿는다는 뜻은 아니기 때문이다.
 *
 * # 관측이 없으면 "정상"이다
 *
 * 백엔드는 **한 번이라도 불러 본** 프로바이더만 돌려준다. 목록에 없다는 것은
 * "모른다" 이고, 모르는 것을 "안 된다" 로 그리면 첫 실행부터 전부 회색이 된다.
 */

import { useCallback, useEffect, useState } from "react";

import { llmApi } from "@/api/llm";
import type { ProviderReach } from "@/lib/bindings";

/** 브라우저(웹뷰)가 아는 오프라인 — 전 프로바이더에 동시에 걸린다. */
function systemOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export interface Reachability {
  /** 이 프로바이더가 지금 못 닿는가. 관측이 없으면 `false`. */
  offline: (provider: string) => boolean;
  /** 툴팁에 실을 영어 원문 사유. 없으면 `null`. */
  detail: (provider: string) => string | null;
  /** 기기 자체가 오프라인인가 (`navigator.onLine`). */
  systemOffline: boolean;
  refresh: () => void;
}

export function useReachability(): Reachability {
  const [marks, setMarks] = useState<ProviderReach[]>([]);
  const [offlineNow, setOfflineNow] = useState(systemOffline);

  const refresh = useCallback(() => {
    llmApi
      .reachability()
      .then(setMarks)
      // 도달성 조회가 실패해도 화면은 그냥 "관측 없음" 으로 산다 —
      // 부가 표시 하나 때문에 모델 선택기를 못 열게 하지 않는다.
      .catch(() => setMarks([]));
  }, []);

  useEffect(() => {
    refresh();
    const on = () => setOfflineNow(false);
    const off = () => setOfflineNow(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [refresh]);

  return {
    systemOffline: offlineNow,
    offline: (provider) =>
      offlineNow || marks.some((m) => m.provider === provider && !m.reachable),
    detail: (provider) => marks.find((m) => m.provider === provider)?.detail ?? null,
    refresh,
  };
}
