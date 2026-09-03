import { useEffect, useRef, useState } from "react";

import { SquarePen } from "@/components/Icons";
import { useT } from "@/i18n";
import { agentColor } from "@/features/today/agentColor";
import { agoText, type SessionSeat } from "./sessionModel";

/** 끌고 다니는 것이 무엇인지 — 다른 화면의 드래그(코드 탭)와 섞이지 않게. */
export const SESSION_DND_MIME = "application/x-oculpm-session";

interface SessionCardProps {
  seat: SessionSeat;
  now: number;
  /** 고름 상태 (팀 안의 멤버 카드에는 없다 — 이미 자리가 있다). */
  picked?: boolean;
  onPick?: (picked: boolean) => void;
  /** 팀에서 빼기 (팀 안에서만). 둘짜리 팀에서는 이것이 곧 해체다. */
  onRemove?: () => void;
  removeLabel?: string;
  onAlias: (alias: string) => void;
}

/**
 * 세션 한 장 (docs/a2a/00-master-plan.md D8).
 *
 * 넷이 같은 provider 일 때 사용자가 고를 수 있어야 하므로, 이 카드는 **이름 한
 * 줄로 끝내지 않는다** — 표면·pid·잡은 구역·마지막 활동을 겹쳐 그린다. 그중
 * 무엇이 결정타가 될지는 상황마다 다르고, 넷 다 없는 세션은 애초에 사용자도
 * 구별할 수 없으므로 별명을 붙이는 자리를 카드 안에 둔다.
 */
export function SessionCard({
  seat,
  now,
  picked,
  onPick,
  onRemove,
  removeLabel,
  onAlias,
}: SessionCardProps) {
  const { t } = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(seat.alias ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = () => {
    onAlias(draft);
    setEditing(false);
  };

  const ago = agoText(seat.card.heartbeat_at, now);
  const swatch = agentColor(seat.card.provider);

  return (
    <div
      className={"sess-card" + (picked ? " picked" : "")}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(SESSION_DND_MIME, seat.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      data-agent-id={seat.id}
    >
      <div className="sess-card-top">
        {onPick ? (
          <input
            type="checkbox"
            checked={picked ?? false}
            aria-label={seat.label}
            onChange={(e) => onPick(e.target.checked)}
          />
        ) : null}
        <span className="sess-swatch" style={{ background: swatch }} aria-hidden="true" />
        <strong className="sess-name">{seat.label}</strong>
        {onRemove ? (
          <button type="button" className="btn ghost sm right" onClick={onRemove}>
            {removeLabel}
          </button>
        ) : null}
      </div>

      <div className="sess-facts">
        <span>{t(`a2a.surface.${seat.card.surface}`)}</span>
        {seat.card.pid != null ? <span>{t("sessions.pid", { pid: seat.card.pid })}</span> : null}
        {ago ? <span>{t("sessions.lastSeen", { ago })}</span> : null}
        {seat.liveness === "unknown" ? (
          <span className="sess-flag" title={t("a2a.unknownLivenessHint")}>
            {t("a2a.unknownLiveness")}
          </span>
        ) : null}
        {/* 앱이 띄우지 않은 세션은 이름이 자칭이다 — 막지 않고 보이게만 한다. */}
        {seat.card.verified ? null : (
          <span className="sess-flag" title={t("a2a.selfClaimedHint")}>
            {t("a2a.selfClaimed")}
          </span>
        )}
      </div>

      {seat.registeredName ? (
        <div className="sess-facts">
          <span>{t("sessions.registeredAs", { name: seat.registeredName })}</span>
        </div>
      ) : null}

      {/* **무엇을 하고 있는가** — 이름이 없을 때 이 줄이 사용자를 건진다. */}
      {seat.leases.length ? (
        <div className="sess-doing">
          <span className="sess-doing-key">{t("sessions.holding")}</span>
          <span className="sess-doing-val">
            {seat.leases.flatMap((l) => l.patterns).join(" · ")}
          </span>
        </div>
      ) : null}
      {seat.openTasks.length ? (
        <div className="sess-doing">
          <span className="sess-doing-key">{t("sessions.openTasks", { n: seat.openTasks.length })}</span>
          <span className="sess-doing-val">{seat.openTasks[0].title}</span>
        </div>
      ) : null}

      {editing ? (
        <div className="sess-alias-edit">
          <input
            ref={inputRef}
            className="a2a-name"
            value={draft}
            maxLength={40}
            aria-label={t("sessions.alias")}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setDraft(seat.alias ?? "");
                setEditing(false);
              }
            }}
          />
          <button type="button" className="btn sm" onClick={commit}>
            {t("common.save")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="sess-alias-btn"
          title={t("sessions.aliasHint")}
          onClick={() => {
            setDraft(seat.alias ?? "");
            setEditing(true);
          }}
        >
          <SquarePen size={12} />
          {seat.alias ?? t("sessions.aliasNone")}
        </button>
      )}
    </div>
  );
}
