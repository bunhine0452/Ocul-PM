/**
 * 화면 뒤로/앞으로 (감사 라운드 2026-09-11 E3 — ⌘[ / ⌘]).
 *
 * 화면이 15개인데 `uiV2View` 는 현재값 하나만 들고 있었다 — 일지 → 편집기 →
 * 코드 맵으로 건너간 뒤 "방금 그 일지" 로 돌아오려면 ⌘번호를 외우거나 목록을
 * 다시 찾아야 했다. 브라우저·IDE 가 전부 갖고 있는 것이다.
 *
 * 관찰 기반이다: 누가 바꿨든(사이드바·⌘번호·팔레트·딥링크) `current` 가 바뀌면
 * 직전 값을 뒤로 스택에 쌓는다. 우리가 부른 이동은 `pending` 으로 표시해 쌓지
 * 않고 대신 앞으로 스택을 채운다. 영속하지 않는다 — 세션 안의 발자국이다.
 */
import { useCallback, useEffect, useRef } from "react";

export const NAV_HISTORY_CAP = 50;

export function useNavHistory<V extends string>(current: V, setView: (v: V) => void) {
  const back = useRef<V[]>([]);
  const forward = useRef<V[]>([]);
  const last = useRef<V>(current);
  /** 우리가 시킨 이동의 목적지 — 관찰 이펙트가 이 값이면 쌓지 않는다. */
  const pending = useRef<{ to: V; dir: "back" | "forward" } | null>(null);

  useEffect(() => {
    if (current === last.current) return;
    const p = pending.current;
    if (p && p.to === current) {
      // 뒤로 갔으면 떠난 화면은 앞으로 스택에, 앞으로 갔으면 뒤로 스택에.
      (p.dir === "back" ? forward : back).current.push(last.current);
    } else {
      back.current.push(last.current);
      if (back.current.length > NAV_HISTORY_CAP) back.current.shift();
      forward.current = [];
    }
    pending.current = null;
    last.current = current;
  }, [current]);

  const goBack = useCallback(() => {
    const to = back.current.pop();
    if (to === undefined) return false;
    pending.current = { to, dir: "back" };
    setView(to);
    return true;
  }, [setView]);

  const goForward = useCallback(() => {
    const to = forward.current.pop();
    if (to === undefined) return false;
    pending.current = { to, dir: "forward" };
    setView(to);
    return true;
  }, [setView]);

  return { goBack, goForward };
}
