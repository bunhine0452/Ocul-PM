// 활동 한 줄 — 대화 화면 **밖에서** 같은 어휘를 쓰는 자리 (플랜 `v3-surface`
// `{#activity-vocab-reuse}`).
//
// 세션 화면의 「무엇을 하고 있는가」는 지금까지 잡은 구역(lease) 하나뿐이었고,
// 그것도 이 화면만의 낱말로 적혀 있었다. 같은 일을 대화 화면은 「고침」이라
// 부르고 세션 화면은 「잡은 구역」이라 부르면, 두 화면을 오갈 때마다 사용자가
// 번역을 한 번씩 한다.
//
// 얼굴(글리프·이름)은 `presenters.tsx` 의 것을 그대로 쓴다 — 어휘가 자라면
// 여기도 함께 자란다.

import { useT } from "@/i18n";
import type { ActivityKind } from "./activityTypes";
import { PRESENTERS } from "./presenters";

export function ActivityLine({
  kind,
  detail,
  title,
}: {
  kind: ActivityKind;
  /** 한 줄 상세 — 태스크 제목·잡은 구역. 등폭으로 그린다. */
  detail: string;
  /** 호버에 나오는 설명 (없으면 상세를 그대로). */
  title?: string;
}) {
  const { t } = useT();
  const { Icon, labelKey } = PRESENTERS[kind];
  return (
    <div className="activity-line" title={title ?? detail}>
      <span className="activity-line-icon">
        <Icon size={12} />
      </span>
      <span className="activity-line-name">{t(labelKey)}</span>
      <span className="activity-line-detail">{detail}</span>
    </div>
  );
}
