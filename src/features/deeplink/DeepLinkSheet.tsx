/**
 * 딥링크 확인 시트 (Osaurus 라운드 Phase 6 `#deep-link`).
 *
 * **이 컴포넌트가 규약이다.** 백엔드는 URL 을 파싱해 이벤트로 넘기기만 하고
 * 아무것도 실행하지 않는다 — 실행은 여기서 사용자가 누른 뒤에야 일어난다.
 * 그래서 "무확인 실행 0" 은 정책이 아니라 구조다: 승인 버튼을 지나지 않는
 * 코드 경로가 존재하지 않는다.
 *
 * 시트는 셋을 말한다 — **무엇을**(제목) · **어디서**(출처 그대로) ·
 * **무엇이 바뀌는지**(효과 한 줄).
 */

import { useEffect, useState } from "react";
import { AppDialog } from "@/components/ui/AppDialog";
import { Button } from "@/components/ui/button";
import { onDeepLink, type DeepLink } from "@/api/deeplink";
import { useT } from "@/i18n";
import { planFor } from "./deepLinkPlan";

export function DeepLinkSheet({
  onAccept,
}: {
  /** 승인됐을 때 실제 작업을 하는 쪽. 시트는 절대 스스로 하지 않는다. */
  onAccept: (link: DeepLink) => void | Promise<void>;
}) {
  const { t } = useT();
  const [link, setLink] = useState<DeepLink | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => onDeepLink(setLink), []);

  if (!link) return null;
  const plan = planFor(link);

  const accept = async () => {
    setBusy(true);
    try {
      await onAccept(link);
    } finally {
      setBusy(false);
      setLink(null);
    }
  };

  return (
    <AppDialog open onClose={() => setLink(null)} label={t(plan.titleKey)} width={460}>
      <div className="p-5 space-y-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">{t(plan.titleKey)}</h2>
          <p className="text-sm text-muted-foreground">{t(plan.effectKey)}</p>
        </div>

        <div className="rounded-lg border border-border bg-background px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {t("deeplink.origin")}
          </div>
          <div className="text-xs font-mono text-foreground break-all">{plan.origin}</div>
        </div>

        {plan.writes && (
          <p className="text-xs text-muted-foreground">{t("deeplink.writesNote")}</p>
        )}

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setLink(null)}
            disabled={busy}
            className="flex-1"
          >
            {t("common.cancel")}
          </Button>
          <Button onClick={accept} disabled={busy} className="flex-1">
            {t(plan.actionKey)}
          </Button>
        </div>
      </div>
    </AppDialog>
  );
}
