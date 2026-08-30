import type { IntegrityWarning } from "@/lib/bindings";
import { createStore } from "@/lib/createStore";

// 무결성 경고의 세션 내 기록 (완성도 라운드 Phase 2, 2026-08-30).
//
// 워처가 보내는 `oculpm-integrity-warning` 은 토스트 한 번이 전부였다 — 8초
// 뒤엔 어떤 파일이 왜 깨졌는지 다시 볼 곳이 없었다. 설정 → 진단의 닥터가
// 이 목록을 보여 주고, 토스트엔 「진단에서 보기」 가 붙는다.
//
// 메모리에만 산다 (usageBus·acpBusyBus 와 같은 판단): 경고는 파일이 고쳐지면
// 의미가 없고, 앱을 껐다 켜면 워처가 다시 읽으며 다시 낸다. 프로젝트 탭이
// 여럿이라 projectId 로 거른다.

export interface IntegrityLogItem {
  id: number;
  projectId: number;
  kind: string;
  path: string;
  message: string;
  /** `Date.now()` — 닥터 목록의 상대 시각. */
  at: number;
}

/** 세션당 이만큼만 — 워처가 같은 파일을 두고 반복해도 목록이 폭주하지 않게. */
export const INTEGRITY_LOG_MAX = 50;

const store = createStore<readonly IntegrityLogItem[]>([]);
let nextId = 1;

/** 워처 경고 하나를 기록한다. 같은 (kind, path) 가 이미 맨 앞이면 시각만 갱신. */
export function pushIntegrityWarning(projectId: number, w: IntegrityWarning, now = Date.now()): void {
  store.update((items) => {
    const head = items[0];
    if (head && head.projectId === projectId && head.kind === w.kind && head.path === w.path) {
      return [{ ...head, message: w.message, at: now }, ...items.slice(1)];
    }
    const item: IntegrityLogItem = {
      id: nextId++,
      projectId,
      kind: w.kind,
      path: w.path,
      message: w.message,
      at: now,
    };
    return [item, ...items].slice(0, INTEGRITY_LOG_MAX);
  });
}

/** 프로젝트 하나(또는 전부)의 기록을 비운다 — 닥터의 「지우기」. */
export function clearIntegrityLog(projectId?: number): void {
  store.update((items) => (projectId == null ? [] : items.filter((it) => it.projectId !== projectId)));
}

/** 전 프로젝트 기록 (최신 먼저). 화면은 projectId 로 걸러 쓴다. */
export const useIntegrityLog = store.useValue;

/** 테스트 전용. */
export function resetIntegrityLog(): void {
  store.set([]);
  nextId = 1;
}
