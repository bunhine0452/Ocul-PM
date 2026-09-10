/**
 * 다음 할 일 — 계획 머리글 아래의 짧은 띠 (2026-09-10 플래너 업그레이드).
 *
 * 32/35 가 끝난 계획에서 사람이 알고 싶은 것은 「남은 셋이 무엇이고 어디에
 * 있는가」 인데, 문서형 체크리스트는 그것을 완료 행 아래 묻는다. 이 띠는
 * 막힘 → 진행중 → 할 일 순으로 최대 다섯을 꺼내 보이고, 누르면 그 행으로
 * 뛴다 (접힌 단계는 펼친다). 실행 버튼은 항목 행의 것과 같은 동작이다.
 *
 * 순서·개수의 규칙은 `planMeta.nextUp` 이 소유하고, 여기는 그리기만 한다.
 */

import { Play } from "@/components/Icons";
import { InlineMarkdown } from "@/components/InlineMarkdown";
import { t } from "@/i18n";
import type { PlanItemDto } from "@/lib/bindings";
import { NO_PHASE, STATUS_META } from "./planMeta";
import { StatusMark } from "./StatusMark";

interface NextUpProps {
  /** `nextUp()` 이 고른 항목 — 이미 순서·개수가 정해져 있다. */
  items: PlanItemDto[];
  /** 남은 전체 수 (띠에 못 실린 것까지). */
  remaining: number;
  locked: boolean;
  onJump: (item: PlanItemDto) => void;
  onDispatch: (item: PlanItemDto) => void;
}

export function NextUp({ items, remaining, locked, onJump, onDispatch }: NextUpProps) {
  // 잠긴 계획에 남은 것이 없으면 말할 것도 없다. 열린 계획이 비었으면
  // 「마무리할 때」 를 알린다 — 진척 100% 옆에 잠금 버튼이 있다는 것을
  // 사람은 안 본다.
  if (remaining === 0 && locked) return null;
  return (
    <section className="pln-next" aria-label={t("plan.nextUp")}>
      <div className="pln-next-head">
        <span className="pln-next-title">{t("plan.nextUp")}</span>
        {remaining > 0 ? <span className="pln-next-count">{t("plan.remaining", { n: remaining })}</span> : null}
      </div>
      {remaining === 0 ? (
        <div className="pln-next-empty">{t("plan.nextUpDone")}</div>
      ) : (
        items.map((it) => {
          const meta = STATUS_META[it.status] ?? STATUS_META.todo;
          const phase = it.phase && it.phase !== NO_PHASE ? it.phase : null;
          return (
            <div className="pln-next-row" key={it.item_id}>
              <button
                type="button"
                className="pln-next-jump"
                onClick={() => onJump(it)}
                title={t("plan.jumpTo", { title: it.title })}
              >
                <StatusMark status={it.status} />
                <span className="sr-only">{t(meta.labelKey)}</span>
                <InlineMarkdown className="pln-next-text" text={it.title} linkable={false} />
                {phase ? <InlineMarkdown className="pln-next-phase" text={phase} linkable={false} /> : null}
              </button>
              {!locked ? (
                <button type="button" className="pln-act accent" onClick={() => onDispatch(it)} title={t("plan.dispatchTitle")}>
                  <Play size={11} strokeWidth={2.2} />
                  <span>{t("plan.dispatch")}</span>
                </button>
              ) : null}
            </div>
          );
        })
      )}
    </section>
  );
}
