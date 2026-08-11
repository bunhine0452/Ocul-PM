// 회고 생성 전역 버스 — 생성 중 상태를 컴포넌트가 아니라 모듈이 소유한다.
//
// 회고 화면을 떠났다 돌아와도 (컴포넌트 언마운트/재마운트) 진행 중인 생성이
// 이어져 보이고, 완료는 어느 화면에 있든 전역 토스트로 알린다. 백엔드
// invoke 는 화면과 무관하게 끝까지 돌아 DB 에 캐시되므로, 버스는 그 결과를
// 들고 있다가 회고 화면이 다시 마운트되면 입양시킨다. (dispatchBus 와 같은
// 모듈-싱글턴 결.)

import { commands, type RetroInsight } from "@/lib/bindings";
// 순수 모듈 — 훅을 쓸 수 없으므로 모듈 t().
import { t } from "@/i18n";
import { toast } from "@/lib/toast";

export type RetroGenRunning = {
  /** `${projectId}:${rangeKey}` — 화면이 자기 기간의 생성인지 판별하는 키. */
  key: string;
  provider: string;
  model: string;
  /** Date.now() — 경과 시간 표시용. */
  startedAt: number;
};

type RetroGenDone = {
  key: string;
  insight: RetroInsight | null;
  error: string | null;
};

let running: RetroGenRunning | null = null;
let lastDone: RetroGenDone | null = null;
let version = 0;
const listeners = new Set<() => void>();

// invoke 가 영원히 settle 하지 않는 경우(LLM 연결 스톨)의 탈출구 — 이 시간이
// 지나면 새 시작이 슬롯을 넘겨받을 수 있다. 회고 생성은 통상 1분 미만.
// (컴포넌트 로컬 state 시절엔 재마운트가 곧 리셋이었지만, 전역화하면서
// 명시적 시효가 필요해졌다.)
const STALL_MS = 3 * 60 * 1000;

// 알려진 한계: rangeKey 가 "오늘" 기준이라 생성 도중 자정을 넘기면 복귀한
// 화면의 키가 달라져 "생성 중" 표시·결과 입양을 놓친다 (결과 자체는 옛
// range_key 로 DB 에 캐시됨). 드문 경계라 수용 — 고치려면 버스가 절대
// 날짜쌍을 들고 화면이 날짜로 재조회해야 한다.

function notify() {
  version += 1;
  listeners.forEach((l) => l());
}

export function retroGenKey(projectId: number, rangeKey: string): string {
  return `${projectId}:${rangeKey}`;
}

/** useSyncExternalStore 용 구독/스냅샷. */
export function subscribeRetroGen(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function retroGenVersion(): number {
  return version;
}

export function getRetroGenRunning(): RetroGenRunning | null {
  return running;
}

/** 이 키의 완료 결과를 가져가며 비운다 — 재마운트한 화면이 입양하는 경로. */
export function consumeRetroGenDone(key: string): RetroGenDone | null {
  if (lastDone && lastDone.key === key) {
    const d = lastDone;
    lastDone = null;
    return d;
  }
  return null;
}

/**
 * 생성 시작. 이미 다른 생성이 돌고 있으면 false (동시 1건 — 백엔드 LLM 호출을
 * 겹치지 않게). 완료/실패 알림은 버스가 전역 토스트로 처리한다.
 */
export function startRetroGen(
  projectId: number,
  since: string,
  until: string,
  rangeKey: string,
  provider: string,
  model: string,
): boolean {
  if (running && Date.now() - running.startedAt < STALL_MS) return false;
  const key = retroGenKey(projectId, rangeKey);
  const myRun: RetroGenRunning = { key, provider, model, startedAt: Date.now() };
  running = myRun;
  notify();

  void commands
    .generateRetro(projectId, since, until, provider, model)
    .then((res) => {
      if (res.status === "ok") {
        lastDone = { key, insight: res.data, error: null };
        toast.info(t("retro.genReady"));
      } else {
        lastDone = { key, insight: null, error: res.error };
        toast.destructive(t("retro.genFailed", { error: res.error }));
      }
    })
    .catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      lastDone = { key, insight: null, error: msg };
      toast.destructive(t("retro.genFailed", { error: msg }));
    })
    .finally(() => {
      // 스톨 시효로 다른 시작이 슬롯을 넘겨받았을 수 있다 — 내 것일 때만 비운다.
      if (running === myRun) running = null;
      notify();
    });
  return true;
}
