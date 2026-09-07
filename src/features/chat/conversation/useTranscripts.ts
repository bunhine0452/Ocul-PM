/**
 * 대화별 기록 — **화면이 아니라 대화가 턴을 소유한다** (플랜 `v3-release`
 * {#big-files-watch}).
 *
 * `AcpConversation.tsx` 에서 그대로 들어냈다. 지도(대화 id → 턴 배열)와 그
 * 지도에서 파생되는 것들(보고 있는 대화의 턴 · 묶음 · 지시문 목록)이 한 결이라
 * 함께 옮겼다 — 셋을 갈라 두면 "왜 여기서 새 배열을 만들면 안 되는가"라는 같은
 * 이유의 주석이 세 자리에 흩어진다.
 *
 * 훅 순서와 memo 의존성은 원본 그대로다. 순수 이동이며 동작 변경은 없다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";

import { groupTurns, type AcpTurn } from "../acpTurns";

/** 빈 기록의 **한 개짜리** 배열 — 매 렌더 새 배열을 만들면 memo 가 다 깨진다. */
export const EMPTY_TURNS: AcpTurn[] = [];

export interface Transcripts {
  /** 대화 id(`""`=SLATE, 아직 안 만든 새 대화) → 그 대화의 턴 지도를 통째로 갈기. */
  setTranscripts: React.Dispatch<React.SetStateAction<Record<string, AcpTurn[]>>>;
  /** 같은 값의 **읽기 전용 사본** — 비동기 콜백이 최신값을 묻는 자리. */
  transcriptsRef: React.RefObject<Record<string, AcpTurn[]>>;
  /** 한 대화의 턴만 리듀서로 고친다. */
  editTurns: (id: string, update: (prev: AcpTurn[]) => AcpTurn[]) => void;
  /** 그 대화에 **우리가 보낸 지시문**, 보낸 순서대로 (효과 안에서만 부른다). */
  promptsOf: (id: string) => string[];
  /** 지금 보고 있는 대화의 턴. */
  turns: AcpTurn[];
  /** 그 턴을 지시 + 답 묶음으로 나눈 것. */
  groups: AcpTurn[][];
  /** 이 대화에서 보낸 지시들 — ↑ 되부르기의 원장. */
  userPrompts: string[];
}

export function useTranscripts(activeId: string): Transcripts {
  /**
   * 대화별 기록. **화면이 아니라 대화가 턴을 소유한다.**
   *
   * 예전엔 화면이 `turns` 하나를 들고 있어서, 답변 도중 다른 대화로 넘어가면
   * 흐르던 글자가 **그 대화 화면에 쓰였다**. 반대로 돌아오면 `session/load` 가
   * 디스크에서 다시 읽는데 아직 안 끝난 답은 디스크에 없어 통째로 사라졌다.
   * 대화 id 로 갈라 두면 둘 다 저절로 없어진다 — 스트리밍은 자기 대화에
   * 계속 쌓이고, 돌아오면 그 자리에 그대로 있다.
   */
  const [transcripts, setTranscripts] = useState<Record<string, AcpTurn[]>>({});
  const editTurns = useCallback(
    (id: string, update: (prev: AcpTurn[]) => AcpTurn[]) => {
      setTranscripts((prev) => {
        const before = prev[id] ?? EMPTY_TURNS;
        const after = update(before);
        // 리듀서가 **같은 배열**을 돌려주면 아무 일도 없었던 것이다 — 그때
        // 새 지도를 만들면 화면 전체가 다시 그려진다(그리고 아무 것도 안
        // 바뀐다). 버려지는 이벤트가 흔한 자리라 이 검사가 값을 한다.
        return after === before ? prev : { ...prev, [id]: after };
      });
    },
    [],
  );
  /**
   * 같은 값의 **읽기 전용 사본**.
   *
   * `openSession` 이 "이미 본 대화인가"를 판단하려고 `transcripts` 를 읽는데,
   * 의존성에 넣으면 **글자 한 덩어리 올 때마다** openSession 이 새로 만들어진다.
   * 그 아이덴티티는 `send` → 큐 배출 effect → 툴바 탭까지 줄줄이 타고 흘러서,
   * 스트리밍 중 초당 수십 번 헛도는 일감이 됐다. 판단에는 최신값만 있으면 된다.
   */
  const transcriptsRef = useRef(transcripts);
  useEffect(() => {
    transcriptsRef.current = transcripts;
  }, [transcripts]);
  /**
   * 이 대화에 **우리가 보낸 지시문**, 보낸 순서대로.
   *
   * 제목을 거르는 데 쓴다 (acpTitle.ts): 어댑터가 주는 제목은 AI 가 진짜 제목을
   * 붙이기 전까지 **마지막 지시문**이라, 대화를 이어 갈수록 탭이 방금 친 말로
   * 계속 바뀌었다. 무엇을 보냈는지 알면 그 메아리를 가려낼 수 있다.
   *
   * 기록에서 바로 읽는다 — 따로 장부를 두면 지난 대화를 다시 열었을 때(재생분
   * 으로만 채워지는 경우) 그 장부가 비어 있다. **효과 안에서만** 부른다:
   * `transcriptsRef` 는 렌더가 아니라 커밋 뒤에 최신이 된다.
   */
  const promptsOf = useCallback(
    (id: string): string[] =>
      (transcriptsRef.current[id] ?? [])
        .filter((turn) => turn.role === "user")
        .map((turn) => turn.text),
    [],
  );
  const turns = transcripts[activeId] ?? EMPTY_TURNS;
  /**
   * 묶음 나누기는 렌더마다 하지 않는다 — 스트리밍 중에는 초당 수십 번 렌더되고,
   * 그때마다 전체 기록을 다시 훑어 새 배열을 만들면 아래의 `TurnRow` memo 도
   * 통째로 무의미해진다 (props 배열이 매번 새 객체라서).
   */
  const groups = useMemo(() => groupTurns(turns), [turns]);
  /** 이 대화에서 보낸 지시들 — ↑ 되부르기의 원장. */
  const userPrompts = useMemo(
    () => turns.filter((turn) => turn.role === "user").map((turn) => turn.text),
    [turns],
  );

  return {
    setTranscripts,
    transcriptsRef,
    editTurns,
    promptsOf,
    turns,
    groups,
    userPrompts,
  };
}
