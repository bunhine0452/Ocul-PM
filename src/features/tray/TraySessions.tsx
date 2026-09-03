import { t, useT } from "@/i18n";
import type { Session } from "@/lib/bindings";

// 메뉴바 팝오버의 "지금 돌고 있는 것" 구획 (2026-09-04 분리).
//
// `TrayPopover` 에서 떼어냈다 — 파일이 이미 한계를 넘어 있었고, 이 구획은
// 팝오버의 다른 부분과 아무 상태도 나누지 않는다 (프로젝트별 스냅샷을 평평한
// 줄 목록으로 받아 그리기만 한다).
//
// 프로젝트 스냅샷 타입을 그대로 받지 않는 이유도 같다: 여기서 필요한 것은
// 프로젝트 **이름 하나**뿐이라, 스냅샷을 통째로 끌고 오면 팝오버의 자료구조가
// 바뀔 때마다 이 파일이 함께 흔들린다.

export interface TraySessionRow {
  /** 프로젝트+세션을 가르는 React 키. */
  key: string;
  projectName: string;
  session: Session;
}

/** 한 화면에 세우는 줄 수 상한 — 팝오버는 목록이 아니라 눈길 한 번이다. */
const MAX_ROWS = 4;

/**
 * 세션이 시작된 지 얼마나 됐나. 컴포넌트 밖 순수 헬퍼라 모듈 `t()` 를 쓴다
 * (구독 시점이 아니라 **부르는 시점**의 언어를 읽는다).
 */
function elapsedLabel(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return t("tray.justStarted");
  if (min < 60) return t("tray.elapsedMinutes", { n: min });
  return t("tray.elapsedHours", { h: Math.floor(min / 60), m: min % 60 });
}

export function TraySessions({ rows }: { rows: readonly TraySessionRow[] }) {
  const { t: tr } = useT();

  if (rows.length === 0) {
    return (
      <section className="tp-sessions">
        <div className="tp-idle-line">{tr("tray.noActiveSession")}</div>
      </section>
    );
  }

  return (
    <section className="tp-sessions">
      <div className="tp-sec-label">
        <span className="tp-live-dot" /> {tr("tray.sessionsActive", { n: rows.length })}
      </div>
      {rows.slice(0, MAX_ROWS).map(({ key, projectName, session }) => {
        // 터미널을 분할해 CLI 를 여럿 띄우면 우리 작업 세션은 하나인데 대화는
        // N개다. 라벨("claude-code")만 보면 그 N이 어디에도 없다 — 둘 이상일
        // 때만 숫자를 붙여 평소의 한 줄을 어지럽히지 않는다.
        const convs = session.agent_sessions?.length ?? 0;
        return (
          <div className="tp-session-row" key={key}>
            <span className="tp-agent">{session.agent_label_guess ?? tr("tray.agentFallback")}</span>
            {convs > 1 ? (
              <span className="tp-convs" title={session.agent_sessions?.join("\n")}>
                {tr("tray.conversations", { n: convs })}
              </span>
            ) : null}
            <span className="tp-dim">{elapsedLabel(session.started_at)}</span>
            <span className="tp-proj">{projectName}</span>
          </div>
        );
      })}
    </section>
  );
}
