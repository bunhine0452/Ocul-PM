// "지금 끊으면 안 되는 일" 등록소.
//
// 업데이트는 두 걸음이다: 새 번들을 **디스크에 깔고**, 앱을 **다시 띄운다**.
// 앞걸음은 언제 해도 안전하다(도는 프로세스는 메모리의 옛 코드를 계속 쓴다).
// 위험한 것은 뒷걸음뿐이다 — 재시작은 우리가 띄운 자식 프로세스(ACP 어댑터)를
// 같이 죽이고, 그때 흐르던 답변은 아직 디스크에 없어 그대로 사라진다.
//
// 그래서 재시작 직전에 여기 물어본다. 답변이 도는 중이면 기다렸다 띄운다.

type Reason = () => string | null;

const reasons = new Set<Reason>();
const listeners = new Set<() => void>();

/**
 * 바쁜 이유를 대는 함수를 등록한다. 바쁘지 않으면 `null` 을 돌려주면 된다.
 * 반환값을 부르면 해지된다 (effect cleanup 에 그대로 쓴다).
 */
export function registerBusy(reason: Reason): () => void {
  reasons.add(reason);
  notify();
  return () => {
    reasons.delete(reason);
    notify();
  };
}

/** 지금 끊으면 안 되는 이유 하나 (없으면 `null`). */
export function busyReason(): string | null {
  for (const reason of reasons) {
    const why = reason();
    if (why) return why;
  }
  return null;
}

/** 바쁨이 바뀔 때 알려 준다 — 기다리던 재시작이 깨어나는 통로. */
export function onBusyChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of [...listeners]) listener();
}
