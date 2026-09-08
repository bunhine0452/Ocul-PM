/**
 * 논의 본문 저장 — CAS 대조와 **충돌 조정** (2026-09-08).
 *
 * 화면에서 갈라 나온 이유는 크기가 아니라 응집이다. 저장 한 번은 세 갈래로
 * 끝난다 — 성공 / 평범한 실패 / **쓰기 충돌** — 이고, 셋째 갈래는 토스트 하나로
 * 끝나지 않고 사용자에게 선택지를 준 뒤 두 번째 왕복까지 이어진다. 그 흐름이
 * 렌더 함수 한가운데 있으면 "저장 버튼이 무엇을 하는가" 를 읽는 데 화면 전체를
 * 읽어야 한다.
 *
 * ## 왜 CAS 인가
 *
 * 편집기는 열 때의 본문 스냅숏(`draft`)에서 갈라져 나온 사용자의 작업본이고,
 * 화면은 편집 중 디스크 변경을 **일부러 무시한다**(초안을 지키려고). 그래서 그
 * 사이 에이전트가 적은 문단은 저장 한 번에 조용히 사라졌다 — 오류도 흔적도 없이,
 * "저장했어요" 토스트와 함께. 백엔드가 이제 `base_hash` 를 대조하고 어긋나면
 * **아무것도 쓰지 않는다** (`commands/discussion.rs` 의 CAS 문단).
 */
import { useCallback } from "react";

import { commands, type DiscussionDetail } from "@/lib/bindings";
import { toast } from "@/lib/toast";
import { useT } from "@/i18n";

import { isWriteConflict } from "./conflict";

export interface DiscussionSaveDeps {
  projectId: number;
  /** 저장이 실제로 디스크에 닿았다 — 편집기를 닫고 목록을 다시 읽을 자리. */
  onSaved: (saved: DiscussionDetail | null) => void;
  /** 초안을 **버리고** 디스크 내용으로 편집기를 다시 연다 (충돌 선택지 ②). */
  onReload: (id: string) => void;
  /** 저장 중 표시. */
  onBusy: (busy: boolean) => void;
}

/** `(discussionId, 본문, base_hash)` 를 받아 저장하고 충돌까지 조정한다. */
export type SaveDiscussionBody = (id: string, text: string, baseHash: string) => Promise<void>;

export function useDiscussionSave({
  projectId,
  onSaved,
  onReload,
  onBusy,
}: DiscussionSaveDeps): SaveDiscussionBody {
  const { t } = useT();

  const saved = useCallback(
    (detail: DiscussionDetail | null) => {
      onSaved(detail);
      toast.info(t("disc.saved"));
    },
    [onSaved, t],
  );

  /**
   * 읽은 뒤에 디스크가 바뀌었다 — **초안은 그대로 두고** 사용자가 고르게 한다.
   *
   * 자동 재시도는 없다. 조용히 덮는 것이 애초에 이 라운드가 고친 사고이고, 새
   * 해시로 다시 쏘는 것은 그 사고를 한 단계 뒤로 옮긴 것에 지나지 않는다.
   * 그렇다고 막다른 골목으로 두면(같은 해시로는 영영 저장이 안 된다) 사용자가
   * 잃는 것은 반대쪽 — 자기 초안 — 이므로, 두 길을 **이름을 붙여** 연다.
   *
   * 편집기는 열린 채다. 어느 쪽도 안 고르고 떠나는 것이 초안을 지키는 가장
   * 안전한 선택지라, 토스트는 스스로 사라지지 않는다(`durationMs: 0`).
   */
  const offerChoice = useCallback(
    (id: string, myDraft: string) => {
      toast.destructive(t("disc.conflictBody"), {
        title: t("disc.conflictTitle"),
        durationMs: 0,
        dedupKey: `disc-conflict:${projectId}:${id}`,
        actions: [
          {
            label: t("disc.conflictOverwrite"),
            onClick: () => {
              void (async () => {
                // 지금 값을 읽어 그것으로 쓴다 — 사용자가 **알고** 덮는 것이다.
                const fresh = await commands.discussionReadRaw(projectId, id);
                if (fresh.status !== "ok") {
                  toast.destructive(t("disc.saveFailed", { error: fresh.error }));
                  return;
                }
                const w = await commands.discussionWrite(projectId, id, myDraft, fresh.data.hash);
                if (w.status !== "ok") {
                  toast.destructive(t("disc.saveFailed", { error: w.error }));
                  return;
                }
                saved(w.data);
              })();
            },
          },
          // 초안을 버린다 — 라벨이 그렇게 말한다.
          { label: t("disc.conflictReload"), onClick: () => onReload(id) },
        ],
      });
    },
    [projectId, t, onReload, saved],
  );

  return useCallback(
    async (id, text, baseHash) => {
      onBusy(true);
      const res = await commands.discussionWrite(projectId, id, text, baseHash);
      onBusy(false);
      if (res.status === "ok") {
        saved(res.data);
        return;
      }
      // 충돌은 다른 실패와 다르다 — 초안이 멀쩡히 살아 있고 고를 것이 있다.
      if (isWriteConflict(res.error)) {
        offerChoice(id, text);
        return;
      }
      toast.destructive(t("disc.saveFailed", { error: res.error }));
    },
    [projectId, onBusy, saved, offerChoice, t],
  );
}
