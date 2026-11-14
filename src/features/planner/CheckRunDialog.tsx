/**
 * 확인 명령을 셸에서 돌리기 전에 묻는 창 (11-15 사용자 결정 「누를 때만 돌리기」, X-02).
 *
 * 딥링크 시트와 같은 규약이다 — 셋을 말한다: **무엇을**(돌릴 한 줄 전문, 기계 글씨) · **어디서**(프로젝트 폴더) ·
 * **무엇이 바뀌는지**(새 셸 세션 하나 · 계획의 마지막 결과는 그대로). 줄은 계획 파일에서 왔고 그 파일은 에이전트도
 * 동료도 쓴다 — 그래서 열리면 「취소」 가 포커스를 받고 「돌리기」 는 눌러야만 선다. ↩ 한 번으로 남이 쓴 명령을
 * 돌리지 않는다. 보이는 글은 셸이 받을 바로 그 글이다(`prepareCheck` 가 거른 뒤 — 판정 카드처럼 && 뒤에서 줄을
 * 나누지도 않는다).
 *
 * 문서 칸(`.plv-main`)은 컨테이너 질의 칸이라 그 안의 `position: fixed` 덮개가 문서 칸에 갇힌다 — 그래서 단추는
 * 판정 카드에, 이 창은 화면 맨 위(완료 확인 상자 옆)에 선다.
 */
import { useRef } from "react";

import { AppDialog, DialogBody, DialogFoot, DialogHead, DialogKey } from "@/components/ui/AppDialog";
import { useProjectRuntime } from "@/contexts/WorkspaceContext";
import { useT } from "@/i18n";

export function CheckRunDialog({
  line,
  onCancel,
  onRun,
}: {
  /** 돌릴 한 줄 — `null` 이면 닫혀 있다. */
  line: string | null;
  onCancel: () => void;
  onRun: (line: string) => void;
}) {
  const { t } = useT();
  // 세션이 열릴 폴더(`term_open` 은 cwd 없이 프로젝트 루트에서 연다) — 모르면 그 칸을 생략한다. 런타임 조각만
  // 구독한다: 계획 화면 전체가 워크스페이스의 필터 · 화면 바뀜마다 다시 그려지지 않게.
  const root = useProjectRuntime().currentProjectRoot;
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  return (
    <AppDialog open={line != null} onClose={onCancel} label={t("plan.check.confirmTitle")} width={480} initialFocusRef={cancelRef}>
      {line != null ? (
        <>
          <DialogHead title={t("plan.check.confirmTitle")} sub={t("plan.check.confirmSub")} />
          <DialogBody>
            <div className="dl-origin">
              <span className="dl-origin-label">{t("plan.check.lineLabel")}</span>
              <span className="dl-origin-value plv-check-line">{line}</span>
            </div>
            {root ? (
              <div className="dl-origin">
                <span className="dl-origin-label">{t("plan.check.whereLabel")}</span>
                <span className="dl-origin-value">{root}</span>
              </div>
            ) : null}
          </DialogBody>
          <DialogFoot>
            <button ref={cancelRef} type="button" className="btn ghost sm" onClick={onCancel}>
              <span>{t("common.cancel")}</span>
              <DialogKey>Esc</DialogKey>
            </button>
            <button type="button" className="btn primary sm" onClick={() => onRun(line)}>
              {t("plan.check.confirm")}
            </button>
          </DialogFoot>
        </>
      ) : null}
    </AppDialog>
  );
}
