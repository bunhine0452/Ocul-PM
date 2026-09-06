// 컴포저 자동완성 — `@` 파일 · `/` 커맨드 · 입력창 자동 높이.
//
// `AcpConversation.tsx` 에서 갈라 나온 조각이다 (v3-surface {#acp-split}).
// 순수 이동이며 동작 변경은 없다. 셋을 한 훅에 둔 이유는 전부 **초안 한
// 글자마다** 도는 일이고, 셋 다 같은 입력창 ref 를 본다는 것이다.

import { useCallback, useEffect, useState } from "react";

import { commands, type AcpCommand } from "@/lib/bindings";
import { useT } from "@/i18n";
import { applyMention, findMentionQuery } from "../acpMention";
import { applyCommand, filterCommands, findSlashQuery, withLocalCommands } from "../acpSlash";

export interface ComposerSuggestArgs {
  projectId: number;
  provider: "claude" | "codex";
  codex: boolean;
  draft: string;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  /** 고른 뒤 커서를 돌려보낼 입력창. 컴포저의 여러 주인이 함께 쓴다. */
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  /** 멘션으로 고른 파일은 붙임으로도 들어간다. */
  addAttachment: (relPath: string) => void;
}

export function useComposerSuggest({
  projectId,
  provider,
  codex,
  draft,
  setDraft,
  inputRef,
  addAttachment,
}: ComposerSuggestArgs) {
  const { t } = useT();
  /** `@` 자동완성 후보. `null` 이면 닫힌 상태. */
  const [mentions, setMentions] = useState<string[] | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  /** `/` 커맨드 후보. `null` 이면 닫힌 상태. */
  const [slash, setSlash] = useState<AcpCommand[] | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);

  // `@` 를 치는 동안만 후보를 부른다 — 멘션이 아닐 땐 즉시 닫아 디스크를
  // 매 입력마다 걷지 않는다. 짧은 디바운스: 이 조회는 키 하나마다 디스크를
  // 걷는 일이라, 빠르게 치는 동안은 마지막 한 번만 나가면 된다.
  useEffect(() => {
    const mention = findMentionQuery(draft);
    if (!mention) {
      setMentions(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void commands.acpListFiles(projectId, mention.query, 8).then((res) => {
        if (cancelled) return;
        setMentions(res.status === "ok" ? res.data : []);
        setMentionIndex(0);
      });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [draft, projectId, t]);

  // `/` 로 시작할 때만 커맨드 목록을 부른다. 목록은 세션 시작 **알림**으로
  // 오므로 시작 응답 스냅샷은 비어 있을 수 있다 — 칠 때 묻는 편이 항상 최신이다.
  useEffect(() => {
    const typed = findSlashQuery(draft);
    if (!typed) {
      setSlash(null);
      return;
    }
    let cancelled = false;
    void commands.acpCommands(projectId, provider).then((res) => {
      if (cancelled) return;
      // 어댑터 목록 + 앱이 직접 처리하는 명령(`/clear`·`/continue`·`/rc` …).
      // 어댑터가 못 주는 것까지 합쳐야 `/` 를 눌렀을 때 실제로 되는 것이 다 보인다.
      const all = withLocalCommands(res.status === "ok" ? res.data : [], (key) =>
        t(key as Parameters<typeof t>[0]),
      ).filter((command) => !codex || command.name !== "remote-control");
      setSlash(filterCommands(all, typed.query));
      setSlashIndex(0);
    });
    return () => {
      cancelled = true;
    };
  }, [codex, draft, projectId, provider, t]);

  /**
   * 입력창이 내용을 따라 자란다 (최대 180px — 프로바이더 채팅과 같은 상한).
   *
   * 없으면 두 줄 고정 칸 안에서 긴 지시문을 **안경 구멍으로** 쓰게 된다 —
   * 번호 매긴 요구사항 대여섯 줄이 이 화면의 평범한 입력이다.
   */
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }, [draft, inputRef]);

  const pickMention = useCallback(
    (relPath: string) => {
      const mention = findMentionQuery(draft);
      if (!mention) return;
      setDraft(applyMention(draft, mention, relPath));
      addAttachment(relPath);
      setMentions(null);
      inputRef.current?.focus();
    },
    [draft, setDraft, addAttachment, inputRef],
  );

  const pickCommand = useCallback(
    (command: AcpCommand) => {
      setDraft(applyCommand(command));
      setSlash(null);
      inputRef.current?.focus();
    },
    [setDraft, inputRef],
  );

  return {
    mentions,
    setMentions,
    mentionIndex,
    setMentionIndex,
    pickMention,
    slash,
    setSlash,
    slashIndex,
    setSlashIndex,
    pickCommand,
  };
}
