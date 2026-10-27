/**
 * 닫힌 플랜의 미완 — 받은함 (완성도 라운드 2026-10-27, 업그레이드 4).
 *
 * 실측: done·archived 플랜 20개 안에 `[ ]` 가 63건 남아 있었다. MCP `plan_status` 는
 * `locked_open` 으로 세어 주지만 화면에는 없었다 — 「이월은 살아 있는 플랜으로」 규칙을
 * 사람이 지킬 자리가 없었다. 잠긴 플랜은 **절대 고치지 않는다**: 옮기기는 고른 활성
 * 플랜의 「이월」 단계 끝에 `carry-<id>` 항목을 더하는 것이고, 백엔드는 그 id 가 있는
 * 항목을 이 목록에서 뺀다. 그것이 「처리됨」의 유일한 표식이다. 숨기기 버튼은 없다.
 */

import { useCallback, useEffect, useState } from "react";

import { planApi } from "@/api/plan";
import { ArrowRight, Inbox } from "@/components/Icons";
import { useT } from "@/i18n";
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
  /** 지금 고른 플랜 — 활성이 아니면 옮기기는 막힌다. */
  selectedId: string | null;
  selectedLocked: boolean;
  /** 옮긴 뒤 고른 플랜을 다시 읽게 한다. */
  onMoved: () => void;
  /** 플랜 파일이 바뀐 신호 — 목록을 다시 읽는다. */
  refreshKey: number;
}

export function CarryInbox({ projectId, selectedId, selectedLocked, onMoved, refreshKey }: CarryInboxProps) {
  const { t } = useT();
  const [items, setItems] = useState<LockedOpenItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
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
  }, [projectId]);

  useEffect(() => load(), [load, refreshKey]);

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
      load();
    } catch (e) {
      toast.destructive(t("plan.carry.moveFailed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <details className="pln-carry" open={false}>
      <summary className="pln-carry-head">
        <Inbox size={13} />
        <span className="pln-next-title">{t("plan.carry.title")}</span>
        <span className="pln-next-count">{t("plan.carry.count", { n: items.length })}</span>
      </summary>
      <p className="pln-carry-hint">{t("plan.carry.hint")}</p>
      {items.map((item) => {
        const key = `${item.plan_id}#${item.item_id}`;
        return (
          <div className="pln-next-row" key={key}>
            <span className="pln-next-text" title={item.title}>
              {item.title}
            </span>
            <span className="pln-next-phase" title={item.plan_title}>
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
    </details>
  );
}
