import { ArrowRight, Waypoints } from "@/components/Icons";
import { EmptyState } from "@/components/EmptyState";
import type { UiV2View } from "@/contexts/WorkspaceContext";
import { ActivityLine } from "@/features/chat/activity/ActivityLine";
import { useT } from "@/i18n";
import { agentColor } from "./agentColor";
import { useTodayActivity } from "./useTodayActivity";

// Today 의 「지금 무엇을 하고 있는가」 한 줄들 (플랜 `v3-release`
// `{#today-activity-row}`).
//
// 이 화면의 나머지는 전부 **지난 일의 합**이다 — 기록 N건, 변경 파일 N개,
// 활동 시간 N분. 그중 어느 것도 "지금"을 말하지 않아서, 에이전트가 도는 동안
// Today 를 열어 두면 화면은 아무 일도 안 일어나는 것처럼 보였다.
//
// 어휘는 세션 화면·대화 화면의 것을 **그대로** 쓴다 (`seatActivity` +
// `ActivityLine`). 새 낱말을 여기서 만들면 같은 일을 세 화면이 세 이름으로
// 부르게 된다.
//
// 0 을 숨기지 않는다. 붙어 있는 세션이 없는 날에도 카드는 남아 "없다"를
// 말한다 — 있는 날만 뜨는 카드는 없는 날에 화면이 **모르는 것인지 없는
// 것인지**를 사용자가 구별할 수 없게 만든다. 다만 원장 자체를 못 읽었을 때는
// 아무 말도 하지 않는다(`loaded === false`): 그건 0 이 아니라 모름이다.

export function TodayActivity({
  projectId,
  enabled,
  onNavigate,
}: {
  projectId: number;
  enabled: boolean;
  onNavigate: (view: UiV2View) => void;
}) {
  const { t } = useT();
  const { loaded, rows } = useTodayActivity(projectId, enabled);

  if (!enabled || !loaded) return null;

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="panel-head">
        <Waypoints size={16} color="var(--text-2)" />
        <h3>{t("today.activity.title")}</h3>
        <span className="count">{rows.length}</span>
        <button
          className="btn ghost sm right"
          onClick={() => onNavigate("sessions")}
          aria-label={t("today.activity.openAria")}
        >
          {t("today.activity.open")} <ArrowRight size={13} />
        </button>
      </div>
      <div className="panel-body">
        {rows.length > 0 ? (
          rows.map(({ seat, activity }) => (
            <div key={seat.id} style={{ padding: "5px 0", minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                <span
                  className="sess-swatch"
                  style={{ background: agentColor(seat.card.provider) }}
                  aria-hidden="true"
                />
                <strong className="sess-name">{seat.label}</strong>
              </div>
              {activity ? (
                <ActivityLine kind={activity.kind} detail={activity.detail} />
              ) : (
                /* 원장이 이 자리에 대해 아는 일이 없다. 앱 안에서 도는 ACP 턴과
                   이어 붙일 축이 없어(`sessionActivity.ts` 주석) 「돌고 있다」를
                   지어내지 않고 세션 화면과 같은 낱말로 조용하다고만 적는다. */
                <div className="activity-line">
                  <span className="activity-line-detail">{t("sessions.doingIdle")}</span>
                </div>
              )}
            </div>
          ))
        ) : (
          <EmptyState style={{ padding: "16px 20px" }}>{t("today.activity.none")}</EmptyState>
        )}
      </div>
    </div>
  );
}
