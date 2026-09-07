/**
 * 쓰다 만 글은 **대화를 따라간다** (플랜 `v3-release` {#big-files-watch}).
 *
 * `AcpConversation.tsx` 에서 그대로 들어냈다 — 입력창의 글자 자체는 컴포저가
 * 그리는 동안 계속 읽어야 해서 화면이 들고 있고(`draft`), 여기서는 **대화를
 * 옮기는 순간의 재우기·꺼내기**만 소유한다. 순수 이동이며 동작 변경은 없다.
 */

import { useEffect, useRef } from "react";
import type React from "react";

import { type RecallState } from "../promptHistory";

export interface DraftPerSessionOptions {
  /** 지금 보고 있는 대화 (`""`=아직 안 만든 새 대화). */
  activeId: string;
  draft: string;
  setDraft: (next: string) => void;
  /** ↑/↓ 되부르기 위치 — 대화를 옮기면 처음으로 되돌린다. */
  recallRef: React.RefObject<RecallState | null>;
}

/**
 * 입력창이 화면에 하나뿐이라, 탭 A 에서 쓰다 탭 B 로 가면 반쯤 쓴 지시문이
 * B 의 입력창에 따라붙었다 — B 에서 지우면 A 의 글이 사라진 것이다. 대화를
 * 옮기는 순간 쓰던 글을 그 대화 몫으로 재워 두고, 돌아오면 꺼낸다.
 */
export function useDraftPerSession({
  activeId,
  draft,
  setDraft,
  recallRef,
}: DraftPerSessionOptions): void {
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  const draftsRef = useRef<Record<string, string>>({});
  const prevSessionRef = useRef(activeId);
  useEffect(() => {
    const prev = prevSessionRef.current;
    if (prev === activeId) return;
    draftsRef.current = { ...draftsRef.current, [prev]: draftRef.current };
    prevSessionRef.current = activeId;
    setDraft(draftsRef.current[activeId] ?? "");
    recallRef.current = null;
    // 원본 그대로의 의존성 배열 — `setDraft`·`recallRef` 는 안정된 값이고,
    // 여기에 넣으면 글자가 바뀔 때마다 대화 전환으로 오인한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);
}
