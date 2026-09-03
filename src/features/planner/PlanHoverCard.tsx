/**
 * 계획 레일 행에 마우스를 얹으면 뜨는 카드.
 *
 * 레일은 폭이 170~460px 이라 제목이 거의 항상 잘린다 — `계획이 쌓여도 목록은
 * 짧게 …` 처럼. 잘린 제목을 되찾는 것이 첫 번째 이유이고, 두 번째는 **행에
 * 넣을 자리가 없어 버린 사실들**이다: 상태·남은 항목·마지막 활동의 실제 날짜·
 * 작성자·계획 id. 행은 두 줄이 한계이고, 그 두 줄을 지키려면 나머지는 얹혀야
 * 한다.
 *
 * 네이티브 `title` 로는 안 된다: 지연이 1초 넘고, 줄바꿈·강조가 없고, 진행
 * 바처럼 **보여야 이해되는 것**을 못 그린다.
 *
 * body 로 포털한다 — `.pln-body` 가 `container-type: inline-size` 라 그 안에서는
 * `position: fixed` 조차 컨테이너 기준이 된다 (뷰포트가 아니라).
 */
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Lock, TriangleAlert } from "@/components/Icons";
import type { PlanSummary } from "@/lib/bindings";
import { useT, type I18nKey } from "@/i18n";
import { stripInlineMarkdown } from "@/lib/inlineMarkdown";
import { relDay, type PlanFacet } from "./planList";

/** 묶음 → 배지 라벨 키. 템플릿 문자열로 만들면 키 타입 검사를 빠져나간다. */
const BUCKET_LABEL: Record<string, I18nKey> = {
  active: "plan.group.active",
  done: "plan.group.done",
  archived: "plan.group.archived",
};

/** 카드가 뜨기까지 기다리는 시간(ms) — 목록을 훑고 지나가는 손에는 안 뜬다. */
export const HOVER_DELAY_MS = 320;
/** 행과 카드 사이·뷰포트 가장자리에 남기는 여백. */
const GAP = 8;

export interface PlanHoverTarget {
  plan: PlanSummary;
  facet: PlanFacet | undefined;
  /** 얹힌 행의 화면 좌표 — 카드가 그 옆에 선다. */
  rect: { top: number; left: number; right: number };
}

interface PlanHoverCardProps {
  target: PlanHoverTarget;
  /** 레일이 붙은 쪽. 왼쪽 레일이면 카드는 오른쪽으로 나간다. */
  side: "left" | "right";
  now: number;
}

/** epoch ms → "2026.09.04 07:20". 시각을 모르면 null. */
function fmtAbs(at: number | null): string | null {
  if (at == null) return null;
  const d = new Date(at);
  const two = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}.${two(d.getMonth() + 1)}.${two(d.getDate())}`;
  return `${date} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

export function PlanHoverCard({ target, side, now }: PlanHoverCardProps) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  const { plan, facet, rect } = target;
  // 첫 프레임은 행 옆 어림자리에, 그린 뒤 실제 크기로 화면 안에 당긴다
  // (`CodeContextMenu` 와 같은 방식 — 아래 가장자리에서 카드가 잘리면 정작
  // 마지막 줄인 '마지막 활동'을 못 읽는다).
  const [pos, setPos] = useState({ x: rect.right + GAP, y: rect.top });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const wantX = side === "right" ? rect.left - width - GAP : rect.right + GAP;
    setPos({
      x: Math.max(GAP, Math.min(wantX, window.innerWidth - width - GAP)),
      y: Math.max(GAP, Math.min(rect.top, window.innerHeight - height - GAP)),
    });
  }, [rect.top, rect.left, rect.right, side, plan.plan_id]);

  const pct = facet?.pct ?? Math.round((plan.progress ?? 0) * 100);
  const remaining = facet?.remaining ?? Math.max(0, plan.item_count - plan.done_count);
  const bucket = facet?.bucket ?? "active";
  const when = relDay(facet?.touchedAt ?? null, now);
  const abs = fmtAbs(facet?.touchedAt ?? null);
  const locked = plan.status !== "active";

  const rows: { label: string; value: React.ReactNode }[] = [
    {
      label: t("plan.hover.progress"),
      value: (
        <span className="pln-hover-prog">
          <span className="pln-hover-bar" aria-hidden="true">
            <i style={{ width: `${pct}%` }} />
          </span>
          {plan.done_count}/{plan.item_count} · {pct}%
        </span>
      ),
    },
    { label: t("plan.hover.remaining"), value: t("plan.hover.count", { n: remaining }) },
    {
      label: t("plan.hover.activity"),
      // 활동 기록이 아니라 frontmatter 에서 온 시각은 '마지막으로 손댄 때'가
      // 아니다 — 그 사실을 숨기지 않는다 (planList 모듈 상단 주의 참고).
      value:
        abs == null ? (
          t("plan.group.unknown")
        ) : (
          <>
            {when ? `${when} · ` : ""}
            {abs}
            {facet?.touchedSource === "frontmatter" ? (
              <span className="pln-hover-note">{t("plan.hover.createdOnly")}</span>
            ) : null}
          </>
        ),
    },
    { label: t("plan.hover.owner"), value: plan.owner_agent || t("plan.group.unknown") },
    { label: t("plan.hover.id"), value: <code>{plan.plan_id}</code> },
  ];

  return createPortal(
    <div ref={ref} className="pln-hover" role="tooltip" style={{ left: pos.x, top: pos.y }}>
      <div className="pln-hover-head">
        <span className="pln-hover-badge" data-bucket={bucket}>
          {t(BUCKET_LABEL[bucket] ?? "plan.group.active")}
        </span>
        {locked ? (
          <span className="pln-hover-lock">
            <Lock size={11} />
            {t("plan.locked")}
          </span>
        ) : null}
      </div>
      <div className="pln-hover-title">{stripInlineMarkdown(plan.title)}</div>
      {facet?.staleDays != null ? (
        <div className="pln-hover-stale">
          <TriangleAlert size={12} />
          {t("plan.rail.stale", { n: facet.staleDays })}
        </div>
      ) : null}
      <dl className="pln-hover-grid">
        {rows.map((r) => (
          <div key={r.label}>
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>,
    document.body,
  );
}

