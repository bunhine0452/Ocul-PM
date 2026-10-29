/**
 * 오늘 화면의 두 줄 — 지금 일하는 중 · 다음.
 *
 * 둘 다 「지금 무엇을 결정할까」에 답한다: 누가 돌고 있고(멈췄나), 다음에 무엇을 넘길까.
 * 계획별 진행·판정 카드는 걷었다 — 계획 탭이 같은 것을 보여 주고, 실패한 판정과 사람 몫은
 * 이미 「확인할 것」에 선다 (4.0 「더 단순하게」).
 */

import { SquareTerminal } from "@/components/Icons";
import { agentLabel } from "@/features/today/agentColor";
import { useT } from "@/i18n";
import { relativeTime } from "@/lib/format";
import type { DigestItem, DigestPlan } from "@/lib/bindings";
import type { LiveSession } from "./useLiveSessions";
import { QUIET_MINUTES } from "./useLiveSessions";

export function LiveCard({ sessions, now }: { sessions: LiveSession[]; now: number }) {
  const { t } = useT();
  if (sessions.length === 0) return null;
  return (
    <section className="card tdy-card" aria-labelledby="tdy-live-h">
      <header className="tdy-ch">
        <h2 id="tdy-live-h">{t("today.live.title")}</h2>
        <span className="tdy-cnt">{sessions.length}</span>
      </header>
      <ul className="tdy-list">
        {sessions.map((s) => {
          const since = s.lastRecordAt ?? s.startedAt;
          const quietMin = Math.floor((now - since) / 60_000);
          const quiet = quietMin >= QUIET_MINUTES;
          return (
            <li key={s.id} className="tdy-sess">
              <span className={"tdy-dot tdy-sess-dot" + (quiet ? " is-quiet" : "")} aria-hidden="true" />
              <div className="tdy-grow">
                <div>
                  {s.agentId ? agentLabel(s.agentId) : t("today.live.unknownAgent")}
                  {s.conversations > 1 ? (
                    <span className="tdy-meta"> · {t("today.live.conversations", { n: s.conversations })}</span>
                  ) : null}
                </div>
                <div className={quiet ? "tdy-meta tdy-warn" : "tdy-meta"}>
                  {quiet
                    ? t("today.live.quiet", { n: quietMin })
                    : s.lastRecordAt != null
                      ? t("today.live.last", { ago: relativeTime(s.lastRecordAt, now) })
                      : t("today.live.noneYet", { ago: relativeTime(s.startedAt, now) })}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * 다음 — 한 줄. 항목 제목 · 계획 이름 · 「터미널에서 실행」 하나(앱 안 터미널의 새 세션에서
 * `claude "<프롬프트>"`). 끝까지 맡기는 법(`/oculpm:next until-done`)은 버튼의 title 에.
 */
export function NextCard({ next, onRun }: { next: { plan: DigestPlan; item: DigestItem } | null; onRun: () => void }) {
  const { t } = useT();
  return (
    <section className="card tdy-card tdy-next" aria-labelledby="tdy-next-h">
      <h2 id="tdy-next-h" className="tdy-next-k">
        {t("today.nextUp.title")}
      </h2>
      {next ? (
        <>
          <div className="tdy-grow">
            <div className="tdy-strong tdy-ellipsis">{next.item.title}</div>
            <div className="tdy-meta tdy-ellipsis">{next.plan.title}</div>
          </div>
          <button
            type="button"
            className="btn primary sm"
            onClick={onRun}
            title={`${t("today.nextUp.hint")} /oculpm:next until-done`}
          >
            <SquareTerminal size={13} aria-hidden="true" />
            {t("today.nextUp.run")}
          </button>
        </>
      ) : (
        <p className="tdy-grow tdy-meta">{t("today.nextUp.none")}</p>
      )}
    </section>
  );
}
