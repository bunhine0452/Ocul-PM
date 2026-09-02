import { useCallback, useState } from "react";
import { Check, Copy } from "@/components/Icons";
import { useT } from "@/i18n";

// 대화의 **세션 id** 를 눈에 보이게 두는 자리.
//
// 이 화면의 대화는 우리 것이 아니라 Claude Code 자신의 세션 스토어에 있다
// (`acp_list_sessions` 주석 참고). 그래서 같은 대화를 터미널에서 그대로 이어
// 열 수 있는데 — `claude --resume <id>` — 정작 그 id 가 화면 어디에도 없었다.
// 앱과 터미널을 오가는 사람에게는 그 한 줄이 두 세계를 잇는 유일한 손잡이다.
//
// 화면에는 앞 8 자만 적는다. UUID 를 통째로 적으면 좁은 패널에서 제목을
// 밀어내는데, 눈으로 대화를 가르는 데는 8 자면 충분하다 — 복사는 언제나
// **전체** 를 넘긴다.

/** 이 대화를 터미널에서 이어 여는 명령. 툴팁이 그대로 보여 준다. */
export function resumeCommand(sessionId: string): string {
  return `claude --resume ${sessionId}`;
}

/** 눈으로 가르는 데 필요한 만큼만 — 앞 8 자. */
export function shortSessionId(sessionId: string): string {
  return sessionId.slice(0, 8);
}

/**
 * 세션 id 칩 — 누르면 **전체 id** 가 클립보드로 간다.
 *
 * 명령줄 전체(`claude --resume …`)가 아니라 id 만 복사하는 이유: 붙여 넣는
 * 자리가 터미널일 수도, 스크립트일 수도, 다른 사람에게 보내는 메시지일 수도
 * 있다. 명령은 툴팁이 알려 주고, 손에 쥐여 주는 것은 재료 쪽이다.
 */
export function SessionIdChip({
  sessionId,
  className,
}: {
  sessionId: string;
  className?: string;
}) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(sessionId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* 클립보드가 없는 환경 — 조용히 지나간다 */
    }
  }, [sessionId]);

  return (
    <button
      type="button"
      className={"session-id-chip" + (copied ? " done" : "") + (className ? " " + className : "")}
      onClick={() => void copy()}
      aria-label={t("acp.session.copyId")}
      title={resumeCommand(sessionId)}
    >
      <span className="session-id-text">{shortSessionId(sessionId)}</span>
      {copied ? <Check size={11} /> : <Copy size={11} />}
    </button>
  );
}
