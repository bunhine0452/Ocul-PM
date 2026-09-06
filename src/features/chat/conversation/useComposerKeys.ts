// 컴포저 키보드 — IME·되부르기·팝오버·전송.
//
// `AcpConversation.tsx` 에서 갈라 나온 조각이다 (v3-surface {#acp-split}).
// 순수 이동이며 동작 변경은 없다. 이 한 함수가 다섯 가지 주인을 조정한다
// (IME · 모드 순환 · 프롬프트 되부르기 · `/` · `@` · 전송) — 그 우선순위가
// 곧 이 파일의 내용이고, 순서를 잘못 바꾸면 "고르려던 파일 대신 반쯤 쓴
// 문장이 날아간다" 같은 사고가 난다.

import { useCallback } from "react";
import type React from "react";
import type { AcpCommand, AcpConfigOption } from "@/lib/bindings";
import { CYCLE_MODES } from "./ConfigControls";
import { recallBack, recallForward, type RecallState } from "../promptHistory";

export interface ComposerKeysArgs {
  draft: string;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  /** 이 대화에서 보낸 지시들 — ↑ 되부르기의 원장. */
  userPrompts: string[];
  /** 되부르기의 현재 위치. 호출부가 다른 곳(초안 교체·전송)에서도 지운다. */
  recallRef: React.RefObject<RecallState | null>;
  options: AcpConfigOption[] | undefined;
  setOption: (configId: string, value: string) => void;
  slash: AcpCommand[] | null;
  slashIndex: number;
  setSlash: React.Dispatch<React.SetStateAction<AcpCommand[] | null>>;
  setSlashIndex: React.Dispatch<React.SetStateAction<number>>;
  pickCommand: (command: AcpCommand) => void;
  mentions: string[] | null;
  mentionIndex: number;
  setMentions: React.Dispatch<React.SetStateAction<string[] | null>>;
  setMentionIndex: React.Dispatch<React.SetStateAction<number>>;
  pickMention: (path: string) => void;
  send: () => void;
}

export function useComposerKeys({
  draft,
  setDraft,
  userPrompts,
  recallRef,
  options,
  setOption,
  slash,
  slashIndex,
  setSlash,
  setSlashIndex,
  pickCommand,
  mentions,
  mentionIndex,
  setMentions,
  setMentionIndex,
  pickMention,
  send,
}: ComposerKeysArgs) {
  /** ⇧Tab — 안전한 모드들을 순환한다. */
  const cycleMode = useCallback(() => {
    const mode = options?.find((o) => o.id === "mode");
    if (!mode) return;
    const at = CYCLE_MODES.indexOf(mode.current as (typeof CYCLE_MODES)[number]);
    // 목록 밖(dontAsk·bypass)에 있었다면 처음으로 되돌린다 — 순환에서 빠져
    // 나오는 길이 없으면 갇힌다.
    const next = CYCLE_MODES[(at + 1) % CYCLE_MODES.length];
    setOption(mode.id, next);
  }, [options, setOption]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 한글 조합 중의 Enter/방향키는 **IME 의 것**이다. 안 거르면 조합을 확정하는
    // Enter 가 문장을 그대로 전송한다 — 한글로 쓰는 사용자가 매일 밟는 지뢰.
    // (일부 엔진이 isComposing 을 늦게 세팅해 keyCode 229 도 같이 본다.)
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Tab" && e.shiftKey && !slash?.length && !mentions?.length) {
      e.preventDefault();
      cycleMode();
      return;
    }
    // ↑/↓ — 보냈던 지시 되부르기. 팝오버가 열려 있으면 그쪽 것이고, 커서가
    // 텍스트 한가운데면 **줄 이동**이다 — 맨 앞(↑)·맨 끝(↓)에서만 받는다.
    if (!slash?.length && !mentions?.length) {
      const el = e.currentTarget;
      if (e.key === "ArrowUp" && el.selectionStart === 0 && el.selectionEnd === 0) {
        const step = recallBack(userPrompts, recallRef.current, draft);
        if (step) {
          e.preventDefault();
          recallRef.current = step.state;
          setDraft(step.text);
        }
        return;
      }
      if (
        e.key === "ArrowDown" &&
        recallRef.current &&
        el.selectionStart === el.value.length &&
        el.selectionEnd === el.value.length
      ) {
        const step = recallForward(userPrompts, recallRef.current);
        if (step) {
          e.preventDefault();
          recallRef.current = step.state;
          setDraft(step.text);
        }
        return;
      }
    }
    if (slash?.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => {
          const next = e.key === "ArrowDown" ? i + 1 : i - 1;
          return (next + slash.length) % slash.length;
        });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickCommand(slash[slashIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlash(null);
        return;
      }
    }
    // 멘션 목록이 떠 있으면 방향키·엔터는 목록 것이다 — 목록을 두고 전송되면
    // 사용자가 고르려던 파일 대신 반쯤 쓴 문장이 날아간다.
    if (mentions?.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => {
          const next = e.key === "ArrowDown" ? i + 1 : i - 1;
          return (next + mentions.length) % mentions.length;
        });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickMention(mentions[mentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentions(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return onKeyDown;
}
