import { useSyncExternalStore } from "react";

// 모듈 스코프 스토어·신호·요청 슬롯의 공통 뼈대 (완성도 라운드 Phase 4).
//
// 같은 모양을 일곱 군데가 손으로 들고 있었다 — 리스너 Set, 스냅샷, 구독 해제,
// `useSyncExternalStore` 훅, 그리고 "아직 마운트 안 된 화면을 위한 끈적 플래그".
// 세 가지 원시형으로 줄인다:
//   createStore   — 값 하나 + 구독 + 훅 (`recentChangesStore` 류)
//   createSignal  — 값 없는 한 번의 사건 (`usageBus` 류)
//   createIntentSlot — 페이로드 있는 요청 + 끈적 플래그 (`journalCompose` 류)

type Listener = () => void;

function fanout(listeners: Set<Listener>): void {
  for (const listener of [...listeners]) listener();
}

export interface Store<T> {
  get(): T;
  /** `Object.is` 로 같으면 조용하다 — 구독자가 헛돌지 않는다. */
  set(next: T): void;
  update(fn: (prev: T) => T): void;
  subscribe(listener: Listener): () => void;
  /** React 훅 — 값이 바뀔 때만 다시 그린다. */
  useValue(): T;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<Listener>();
  const get = () => value;
  const subscribe = (listener: Listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const set = (next: T) => {
    if (Object.is(next, value)) return;
    value = next;
    fanout(listeners);
  };
  return {
    get,
    set,
    update: (fn) => set(fn(value)),
    subscribe,
    useValue: () => useSyncExternalStore(subscribe, get, get),
  };
}

export interface Signal {
  emit(): void;
  on(listener: Listener): () => void;
}

/** 값 없는 사건 — 듣는 이가 없으면 조용히 사라진다. */
export function createSignal(): Signal {
  const listeners = new Set<Listener>();
  return {
    emit: () => fanout(listeners),
    on: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export interface IntentSlot<T> {
  /** 요청한다 — 떠 있는 화면은 이벤트로 즉시, 아직 없는 화면은 마운트 때 `consume` 으로. */
  request(payload: T): void;
  /** 이벤트 없이 다시 붙들어 둔다 (셸이 화면을 옮길 때). */
  hold(payload: T): void;
  /** 대기 중인 요청을 회수한다 — 소비형. */
  consume(): T | null;
  /**
   * 이미 마운트된 쪽의 구독. `consume: true`(기본)면 콜백 전에 플래그를 비운다 —
   * 그 화면이 처리했으니 마운트 회수가 두 번 열지 않게. `false` 면 남긴다
   * (셸처럼 화면만 바꾸고 실제 처리는 마운트되는 쪽에 맡길 때).
   */
  subscribe(fn: (payload: T) => void, opts?: { consume?: boolean }): () => void;
  /** 테스트 전용. */
  reset(): void;
}

/** 창 전역 CustomEvent 를 쓴다 — 프로젝트 탭이 여럿이라도 한 창의 이야기다. */
export function createIntentSlot<T>(eventName: string): IntentSlot<T> {
  let pending: T | null = null;
  return {
    request(payload) {
      pending = payload;
      window.dispatchEvent(new CustomEvent(eventName, { detail: payload }));
    },
    hold(payload) {
      pending = payload;
    },
    consume() {
      const had = pending;
      pending = null;
      return had;
    },
    subscribe(fn, opts) {
      const consume = opts?.consume ?? true;
      const handler = (event: Event) => {
        const payload = (event as CustomEvent<T>).detail;
        if (consume) pending = null;
        fn(payload);
      };
      window.addEventListener(eventName, handler);
      return () => window.removeEventListener(eventName, handler);
    },
    reset() {
      pending = null;
    },
  };
}
