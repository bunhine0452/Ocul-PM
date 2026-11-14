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
 *
 * 열리면 「취소」 가 포커스를 받는다 — 바깥에서 온 링크를 ↩ 한 번으로 받아들이지 않는다. 그래서 승인
 * 단추에는 키 표기가 없다. 단추는 앱의 `.btn` 한 벌이다(11-15, shadcn Button 은 이 시트 하나만 쓰고
 * 흰 글자가 4.35:1 이었다).
 */

import { useEffect, useRef, useState } from "react";
import { AppDialog, DialogBody, DialogFoot, DialogHead, DialogKey } from "@/components/ui/AppDialog";
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
  const cancelRef = useRef<HTMLButtonElement | null>(null);

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
    <AppDialog open onClose={() => setLink(null)} label={t(plan.titleKey)} width={460} initialFocusRef={cancelRef}>
      <DialogHead title={t(plan.titleKey)} sub={t(plan.effectKey)} />
      <DialogBody>
        <div className="dl-origin">
          <span className="dl-origin-label">{t("deeplink.origin")}</span>
          <span className="dl-origin-value">{plan.origin}</span>
        </div>
      </DialogBody>
      <DialogFoot>
        <button ref={cancelRef} type="button" className="btn ghost sm" onClick={() => setLink(null)} disabled={busy}>
          <span>{t("common.cancel")}</span>
          <DialogKey>esc</DialogKey>
        </button>
        <button type="button" className="btn primary sm" onClick={accept} disabled={busy}>
          {t(plan.actionKey)}
        </button>
      </DialogFoot>
    </AppDialog>
  );
}
