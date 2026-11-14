/**
 * 닫힌 계획의 미완 — 받은함 (완성도 라운드 2026-10-27, 업그레이드 4).
 *
 * 실측: done·archived 계획 20개 안에 `[ ]` 가 63건 남아 있었다. MCP `plan_status` 는
 * `locked_open` 으로 세어 주지만 화면에는 없었다 — 「이월은 살아 있는 계획으로」 규칙을
 * 사람이 지킬 자리가 없었다. 닫힌 계획은 **절대 고치지 않는다**: 옮기기는 고른 진행 중
 * 계획의 「이월」 단계 끝에 `carry-<id>` 항목을 더하는 것이고, 백엔드는 그 id 가 있는
 * 항목을 이 목록에서 뺀다. 그것이 「처리됨」의 유일한 표식이다. 숨기기 버튼은 없다.
 *
 * 11-15: 디스크가 바뀌면 스스로 다시 읽는다(계획 수가 그대로면 놓치던 것) · 접기 손잡이는 `Disclosure`.
 */

import { useCallback, useEffect, useState } from "react";

import { toAppError } from "@/api/invoke";
import { planApi } from "@/api/plan";
import { Disclosure } from "@/components/Disclosure";
import { ArrowRight } from "@/components/Icons";
import { useOculpmDataEvents } from "@/features/oculpm/useOculpmLive";
import { useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import { blocked } from "@/lib/blocked";
import type { LockedOpenItem } from "@/lib/bindings";
import { toast } from "@/lib/toast";

const STATUS_KEY = {
  todo: "plan.carry.status.todo",
  in_progress: "plan.carry.status.in_progress",
  blocked: "plan.carry.status.blocked",
} as const;

interface CarryInboxProps {
  projectId: number;
  /** 지금 고른 계획 — 진행 중이 아니면 옮기기는 막힌다. */
  selectedId: string | null;
  selectedLocked: boolean;
  /** 옮긴 뒤 고른 계획을 다시 읽게 한다. */
  onMoved: () => void;
}

export function CarryInbox({ projectId, selectedId, selectedLocked, onMoved }: CarryInboxProps) {
  const { t } = useT();
  const [items, setItems] = useState<LockedOpenItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  useOculpmDataEvents("planner", projectId, true, reload);

  useEffect(() => {
    let alive = true;
    void planApi
      .lockedOpen(projectId)
      .then((rows) => {
        if (alive) setItems(rows);
      })
      .catch(() => {
        if (alive) setItems([]);
      });
    return () => {
      alive = false;
    };
  }, [projectId, tick]);

  if (!items || items.length === 0) return null;
  const canMove = selectedId != null && !selectedLocked;

  const move = async (item: LockedOpenItem) => {
    if (!canMove || selectedId == null || busy) return;
    setBusy(`${item.plan_id}#${item.item_id}`);
    try {
      await planApi.applyEdit(
        projectId,
        selectedId,
        {
          kind: "add_item",
          phase: t("plan.carry.phase"),
          title: `${item.title} (← ${item.plan_id} #${item.item_id})`,
          item_id: `carry-${item.item_id}`,
          status: item.status,
        },
        null,
      );
      toast.info(t("plan.carry.moved", { plan: selectedId }));
      onMoved();
      reload();
    } catch (e) {
      toast.destructive(t("plan.carry.moveFailed", { error: tError(toAppError(e)) }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Disclosure className="plv-carry" label={t("plan.carry.title")} count={items.length}>
      <p className="plv-carry-hint">{t("plan.carry.hint")}</p>
      {items.map((item) => {
        const key = `${item.plan_id}#${item.item_id}`;
        return (
          <div className="plv-carry-row" key={key}>
            <span className="plv-carry-text" title={item.title}>
              {item.title}
            </span>
            <span className="plv-carry-from plv-meta" title={item.plan_title}>
              {t("plan.carry.from", {
                plan: item.plan_title,
                status: t(STATUS_KEY[item.status as keyof typeof STATUS_KEY] ?? "plan.carry.status.todo"),
              })}
            </span>
            <button
              type="button"
              className="btn sm"
              {...blocked(canMove ? null : t("plan.carry.needActive"), t("plan.carry.moveTitle"))}
              disabled={busy != null}
              onClick={() => void move(item)}
            >
              <ArrowRight size={11} /> {t("plan.carry.move")}
            </button>
          </div>
        );
      })}
    </Disclosure>
  );
}
