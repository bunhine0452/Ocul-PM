// 배경 자동화의 기기 동의 안내 (보안 피드백 라운드 2026-10-07 `#automation-consent`).
//
// `config.toml`·`.oculpm/automation/` 은 저장소에 실려 온다. 남이 만든 저장소가 켜 둔
// 자동 화해·일지 초안·스케줄·감시는 이 기기가 허락하기 전까지 돌지 않는다
// (백엔드 `oculpm::automation::consent`). 이 안내가 그 "멈춰 있음" 을 말하고 허락할
// 문을 단다 — 말없이 멈추면 「잘 되던 게 멈췄다」가 된다.
//
// 두 자리에서 쓴다: 오늘 화면의 카드(`variant="card"`, 이번 실행 동안 접을 수 있다)와
// 설정 → 자동화 탭 머리의 안내(`variant="inline"`).
//
// 동의는 그때 본 스위치와 지시문에 묶인다 (3차 피드백 2026-10-08) — 허락한 뒤 저장소가
// 정의를 새로 켜거나 바꾸면 다시 묻고, 그때는 무엇이 바뀌었는지(`changed`)를 말한다.
// 허락한 상태의 설정 안내는 한 줄로 줄고 「허락 거두기」를 단다.

import { useEffect, useState } from "react";

import { ShieldAlert } from "@/components/Icons";
import { useT, type I18nKey } from "@/i18n";
import { tError } from "@/i18n/errors";
import { toAppError } from "@/api/invoke";
import { automationApi } from "@/api/automation";
import { createStore } from "@/lib/createStore";
import { toast } from "@/lib/toast";
import type { AutomationConsent } from "@/lib/bindings";

/** 카드를 접은 프로젝트 — 이번 실행 동안만. 다시 켜면 또 묻는다 (멈춰 있다는 사실은
 *  잊히면 안 된다). */
const dismissed = createStore<ReadonlySet<number>>(new Set());

/** 백엔드가 주는 config 키 → 사람이 읽는 이름. 모르는 키는 그대로 보인다. */
const SWITCH_LABEL: Readonly<Record<string, I18nKey>> = {
  "agents.auto_reconcile": "automation.consent.switch.reconcile",
  "agents.auto_journal_draft": "automation.consent.switch.draft",
  "automation.schedules": "automation.consent.switch.schedules",
  "automation.watchers": "automation.consent.switch.watchers",
};

export function AutomationConsentNotice({
  projectId,
  variant,
  onChange,
}: {
  projectId: number;
  variant: "card" | "inline";
  /** 허락하거나 거둔 뒤 — 부르는 화면이 상태를 다시 읽을 때. */
  onChange?: () => void;
}) {
  const { t } = useT();
  const [consent, setConsent] = useState<AutomationConsent | null>(null);
  const [busy, setBusy] = useState(false);
  const hidden = dismissed.useValue().has(projectId);

  useEffect(() => {
    let cancelled = false;
    // `Promise.resolve().then` — 동기 예외까지 같은 갈래(그리지 않음)로 모은다.
    Promise.resolve()
      .then(() => automationApi.consentStatus(projectId))
      .then((c) => !cancelled && setConsent(c))
      // 읽지 못하면 그리지 않는다 — 이 안내는 정보이고, 실패를 토스트로 쏟을 일이 아니다.
      .catch(() => !cancelled && setConsent(null));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const pending = consent != null && consent.requested.length > 0 && !consent.granted;
  const allowed = consent != null && consent.requested.length > 0 && consent.granted;

  const revoke = async () => {
    setBusy(true);
    try {
      setConsent(await automationApi.consentRevoke(projectId));
      toast.info(t("automation.consent.revoked"));
      onChange?.();
    } catch (e) {
      toast.destructive(tError(toAppError(e)));
    } finally {
      setBusy(false);
    }
  };

  if (allowed && variant === "inline") {
    return (
      <div className="first-run-sub mb-4 flex items-center gap-2">
        <span>{t("automation.consent.allowed")}</span>
        <button className="btn sm" disabled={busy} onClick={() => void revoke()}>
          {t("automation.consent.revoke")}
        </button>
      </div>
    );
  }
  if (!pending || (variant === "card" && hidden)) return null;

  const switches = consent.requested
    .map((key) => (SWITCH_LABEL[key] ? t(SWITCH_LABEL[key]) : key))
    .join(" · ");

  const grant = async () => {
    setBusy(true);
    try {
      setConsent(await automationApi.consentGrant(projectId));
      toast.info(t("automation.consent.granted"));
      onChange?.();
    } catch (e) {
      toast.destructive(tError(toAppError(e)));
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <>
      <div className="stat-top">
        <ShieldAlert size={15} color="var(--warn)" />
        <strong>{t("automation.consent.title")}</strong>
      </div>
      <div className="first-run-sub">{t("automation.consent.body", { switches })}</div>
      {consent.changed.length > 0 && (
        <div className="first-run-sub">
          {t("automation.consent.changed", { names: consent.changed.join(" · ") })}
        </div>
      )}
      <div className="first-run-sub">{t("automation.consent.review")}</div>
      <div className="first-run-actions">
        <button className="btn primary sm" disabled={busy} onClick={() => void grant()}>
          {t("automation.consent.grant")}
        </button>
        {variant === "card" && (
          <button
            className="btn sm"
            onClick={() => dismissed.update((prev) => new Set(prev).add(projectId))}
          >
            {t("automation.consent.dismiss")}
          </button>
        )}
      </div>
    </>
  );

  return variant === "card" ? (
    <div className="card card-pad first-run-card" role="status">
      {body}
    </div>
  ) : (
    <div
      className="first-run-card rounded-md border border-border bg-accent/20 px-3 py-2 mb-4"
      role="status"
    >
      {body}
    </div>
  );
}
