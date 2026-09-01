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

/**
 * 도는 중인 생성 — **키(`projectId:rangeKey`) 단위**로 하나씩 (2026-09-01).
 *
 * 예전엔 슬롯이 하나여서 `running` 이 있기만 하면 무엇이든 막았다. 창 하나 =
 * 프로젝트 하나이던 시절엔 그게 "같은 회고를 두 번 만들지 마라" 와 같은 말이었지만,
 * 크롬식 탭 이후로는 아니다 — 프로젝트 B 의 명시적 클릭이 A 의 생성 때문에 최대
 * STALL_MS 동안 막히고, B 화면엔 아무것도 안 도는데 "이미 생성 중" 만 떴다.
 *
 * 백엔드 `generate_retro` 는 전역 락도 공유 상태도 없이 `(project_id, range_key)`
 * 행에만 upsert 하므로 겹쳐 돌아도 깨지지 않는다. 그래서 막아야 할 진짜 위험은
 * **같은 키의 중복 생성**(토큰 낭비 + 같은 행 경합)뿐이고, 그 키는 이미 여기
 * 있었다 — 예전 가드가 안 썼을 뿐이다.
 */
const running = new Map<string, RetroGenRunning>();
const lastDone = new Map<string, RetroGenDone>();
let version = 0;
const listeners = new Set<() => void>();

// invoke 가 영원히 settle 하지 않는 경우(LLM 연결 스톨)의 탈출구 — 이 시간이
// 지나면 **그 키의** 새 시작이 슬롯을 넘겨받을 수 있다. 회고 생성은 통상 1분 미만.
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

/** 이 키의 생성이 돌고 있나 (경과 시간·provider 표시에도 쓰인다). */
export function getRetroGenRunning(key: string): RetroGenRunning | null {
  return running.get(key) ?? null;
}

/** 이 키의 완료 결과를 가져가며 비운다 — 재마운트한 화면이 입양하는 경로. */
export function consumeRetroGenDone(key: string): RetroGenDone | null {
  const d = lastDone.get(key);
  if (!d) return null;
  lastDone.delete(key);
  return d;
}

/** 테스트 전용 — 창을 새로 여는 것과 같은 상태로 되돌린다. */
export function _resetRetroGen(): void {
  running.clear();
  lastDone.clear();
}

/**
 * 생성 시작. **같은 키**(프로젝트+기간)의 생성이 이미 돌고 있으면 false —
 * 다른 프로젝트나 다른 기간은 막지 않는다. 완료/실패 알림은 버스가 전역
 * 토스트로 처리한다.
 */
export function startRetroGen(
  projectId: number,
  since: string,
  until: string,
  rangeKey: string,
  provider: string,
  model: string,
  /** 완료 토스트가 밝힐 프로젝트 이름. 모르면 생략 — 이름 없는 문구로 떨어진다. */
  projectLabel?: string | null,
): boolean {
  const key = retroGenKey(projectId, rangeKey);
  const prev = running.get(key);
  if (prev && Date.now() - prev.startedAt < STALL_MS) return false;
  const myRun: RetroGenRunning = { key, provider, model, startedAt: Date.now() };
  running.set(key, myRun);
  notify();

  void commands
    .generateRetro(projectId, since, until, provider, model)
    .then((res) => {
      if (res.status === "ok") {
        lastDone.set(key, { key, insight: res.data, error: null });
        // 다른 프로젝트를 보고 있을 때 끝날 수 있다 — 어느 회고인지 밝힌다.
        toast.info(
          projectLabel ? t("retro.genReadyFor", { project: projectLabel }) : t("retro.genReady"),
        );
      } else {
        lastDone.set(key, { key, insight: null, error: res.error });
        toast.destructive(t("retro.genFailed", { error: res.error }));
      }
    })
    .catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      lastDone.set(key, { key, insight: null, error: msg });
      toast.destructive(t("retro.genFailed", { error: msg }));
    })
    .finally(() => {
      // 스톨 시효로 다른 시작이 슬롯을 넘겨받았을 수 있다 — 내 것일 때만 비운다.
      if (running.get(key) === myRun) running.delete(key);
      notify();
    });
  return true;
}
