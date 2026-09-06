// AD-4 — Today 의 규칙·스킬 제안 카드 (docs/agent-discipline/00-master-plan.md D3).
//
// 승격 루프는 회고 화면에만 있었다. 회고는 매일 가는 곳이 아니라, 만들어 둔
// 루프가 사실상 잠겨 있었다(F3). Today 는 **매일 보는 곳**이라 여기에 "지금
// 승격할 게 몇 건 있다" 를 띄우고, 승인 흐름 자체는 한 곳(스킬·규칙 화면의
// 제안 인박스)에 둔다 — 같은 결정을 두 화면에서 하게 만들지 않는다.
//
// 후보 조회는 **결정적**이다 (LLM 없음, 과금 없음). 0건이면 아무것도 그리지
// 않는다 — 빈 카드는 Today 의 신호를 흐린다.
import { useEffect, useState } from "react";

import { EmptyState } from "@/components/EmptyState";
import { ClipboardCheck, ArrowRight } from "@/components/Icons";
import { promoteApi } from "@/api/claudeSurface";
import { requestAgentContext } from "@/lib/agentContextNav";
import { localWorkdayKey, shiftWorkday } from "@/lib/workday";
import { useT } from "@/i18n";

/** 인박스와 같은 30일 창. */
const WINDOW_DAYS = 30;

export function TodaySuggestions({ projectId, enabled }: { projectId: number; enabled: boolean }) {
  const { t } = useT();
  const [rules, setRules] = useState(0);
  const [skills, setSkills] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const until = localWorkdayKey();
    const since = shiftWorkday(until, -(WINDOW_DAYS - 1));
    setRules(0);
    setSkills(0);
    // 조회 실패는 Today 를 막을 일이 아니다 — 카드를 안 그리면 그만이다.
    // (커맨드 부재·백엔드 오류 어느 쪽이든 0 으로 떨어뜨린다.)
    const count = async (load: () => Promise<unknown>): Promise<number> => {
      try {
        const list = await load();
        return Array.isArray(list) ? list.length : 0;
      } catch {
        return 0;
      }
    };
    void count(() => promoteApi.ruleCandidates(projectId, since, until)).then((n) => {
      if (alive) setRules(n);
    });
    void count(() => promoteApi.skillCandidates(projectId, since, until)).then((n) => {
      if (alive) setSkills(n);
    });
    return () => {
      alive = false;
    };
  }, [projectId, enabled]);

  if (!enabled || rules + skills === 0) return null;

  return (
    <div className="card">
      <div className="panel-head">
        <ClipboardCheck size={16} color="var(--text-2)" />
        <h3>{t("today.suggestions")}</h3>
        <span className="count">{rules + skills}</span>
        <button
          className="btn ghost sm right"
          onClick={() => requestAgentContext({ kind: "inbox" })}
        >
          {t("today.suggestionsOpen")} <ArrowRight size={13} />
        </button>
      </div>
      <div className="panel-body">
        <EmptyState align="start" style={{ padding: "6px 2px" }}>
          {t("promo.ruleTitle")} {rules} · {t("promo.skillTitle")} {skills}
        </EmptyState>
      </div>
    </div>
  );
}
