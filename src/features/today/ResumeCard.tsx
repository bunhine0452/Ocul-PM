import { ErrorCard } from "@/components/ErrorCard";
import { ArrowRight, Copy, History, ListTodo, NotebookText, Terminal } from "@/components/Icons";
import type { UiV2View } from "@/contexts/WorkspaceContext";
import { agentLabel } from "@/features/today/agentColor";
import { agoText } from "@/features/sessions/sessionModel";
import { useMinuteTick } from "@/hooks/useSecondTick";
import { useT } from "@/i18n";
import { toast } from "@/lib/toast";
import { shortConversation } from "./firstRecordModel";
import { useResumeDigest } from "./useResumeDigest";

// 이어하기 카드 (플랜 `first-record-loop` Phase 2 · 보고서 §8·§9).
//
// 다음 세션이 어디서 시작하는지를 **결정적 목록**으로 보여 준다 — 마지막 작업
// 일지 3건, 활성 계획의 다음 항목, 그리고 그 자료가 어느 대화의 시작 컨텍스트에
// 실렸는지(전달 원장). LLM 요약은 없다. 원본으로 가는 길만 짧게 둔다.
//
// 관측의 의미를 문구가 가른다 (§9 다섯 단계): 원장이 증명하는 것은 "포함됨"
// 까지다 — 참조했는지·도움이 됐는지는 알 수 없다고 적는다. 복사 버튼은 전달로
// 세지 않는다.
//
// 기존 사용자 보호 (여정 C): 화면 구조를 바꾸지 않고 카드 하나를 더한다.
// 일지도 계획도 없는 프로젝트에는 그리지 않는다 — 빈 이어하기는 소음이다.

const GLYPH: Record<string, string> = { todo: "[ ]", in_progress: "[~]", blocked: "[!]" };
const SHOWN_ITEMS = 3;

export function ResumeCard({
  projectId,
  enabled,
  onNavigate,
  onOpenEntryPath,
  onContinue,
}: {
  projectId: number;
  enabled: boolean;
  onNavigate: (view: UiV2View) => void;
  onOpenEntryPath: (relativePath: string) => void;
  /**
   * 「이 맥락으로 이어서 작업」 — 플래너 ▶실행과 같은 디스패치: 돌고 있는
   * 에이전트에 붙여넣거나 셸에 한 줄을 프리필하고, 터미널이 안 보이면 그쪽으로
   * 이동한다. 보내는 건 사용자의 Enter.
   */
  onContinue: () => void;
}) {
  const { t } = useT();
  const { digest, loaded, error, refresh } = useResumeDigest(projectId, enabled);
  const now = useMinuteTick(enabled);

  if (!enabled) return null;
  if (error && loaded) {
    return <ErrorCard title={t("today.resume.loadFailed")} error={error} onRetry={refresh} />;
  }
  if (!digest) return null;
  if (digest.last_journals.length === 0 && digest.next_items.length === 0) return null;

  const copy = () => {
    void navigator.clipboard?.writeText(digest.text).then(() => toast.info(t("today.resume.copied")));
  };

  const delivery = digest.last_delivery;
  const deliveryLine = delivery
    ? t("today.resume.delivered", {
        id: shortConversation(delivery.conversation),
        ago: agoText(delivery.ts, now) ?? delivery.ts,
        n: delivery.journals.length,
        m: delivery.plan_items,
      })
    : digest.hooks_seen
      ? t("today.resume.notYet")
      : t("today.resume.noHooks");

  return (
    <div className="card" data-resume-card={delivery ? "delivered" : "pending"}>
      <div className="panel-head">
        <History size={15} color="var(--accent-text)" />
        <h3>{t("today.resume.title")}</h3>
        <button
          className="btn ghost sm right"
          onClick={() => onNavigate("journal")}
          aria-label={t("today.viewAllAria")}
        >
          {t("today.allEntries")} <ArrowRight size={13} />
        </button>
      </div>
      <div className="panel-body">
        {digest.last_journals.length > 0 ? (
          <>
            <div className="first-run-sub" style={{ marginTop: 0, display: "flex", alignItems: "center", gap: 6 }}>
              <NotebookText size={13} />
              <b>{t("today.resume.lastWork")}</b>
            </div>
            {digest.last_journals.map((j) => (
              <button
                type="button"
                key={j.relative_path}
                className="next-item"
                onClick={() => onOpenEntryPath(j.relative_path)}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="next-title">{j.title}</div>
                  <div className="next-goal">
                    {[
                      j.agent_id ? agentLabel(j.agent_id) : null,
                      j.created_at ? agoText(j.created_at, now) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <ArrowRight size={13} />
              </button>
            ))}
          </>
        ) : null}

        {digest.next_items.length > 0 ? (
          <>
            <div className="first-run-sub" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <ListTodo size={13} />
              <b>{t("today.resume.nextItems")}</b>
            </div>
            {digest.next_items.slice(0, SHOWN_ITEMS).map((it) => (
              <button
                type="button"
                key={`${it.plan_id}:${it.item_id}`}
                className="next-item"
                onClick={() => onNavigate("planner")}
              >
                <span className="mono" style={{ color: "var(--text-3)" }}>
                  {GLYPH[it.status] ?? "[ ]"}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="next-title">{it.title}</div>
                  <div className="next-goal">{it.plan_title}</div>
                </div>
              </button>
            ))}
            {digest.next_items.length > SHOWN_ITEMS ? (
              <div className="first-run-sub" style={{ color: "var(--text-3)" }}>
                {t("today.resume.moreItems", { n: digest.next_items.length - SHOWN_ITEMS })}
              </div>
            ) : null}
          </>
        ) : null}

        {/* 관측의 의미 — 원장이 말할 수 있는 것은 "포함됨" 까지다. */}
        <div className="first-run-sub" style={{ color: "var(--text-3)" }} data-resume-delivery>
          {deliveryLine}
        </div>

        <div className="first-run-actions">
          <button
            className="btn primary sm"
            onClick={onContinue}
            title={t("today.resume.continueHint")}
          >
            <Terminal size={13} /> {t("today.resume.continue")}
          </button>
          <button className="btn sm" onClick={copy}>
            <Copy size={13} /> {t("today.resume.copy")}
          </button>
          <button className="btn sm" onClick={() => onNavigate("planner")}>
            {t("today.resume.planner")}
          </button>
        </div>
      </div>
    </div>
  );
}
