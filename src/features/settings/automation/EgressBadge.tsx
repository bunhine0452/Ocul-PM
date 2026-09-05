/**
 * 「이 자동화는 프로젝트 내용을 ‹provider› 로 보냅니다」 ({#automation-egress-badge}).
 *
 * # 왜 배지인가
 *
 * 제품의 1번 약속은 "로컬 우선 — 사용자가 만든 LLM API 호출과 업데이트 확인
 * 말고는 기기 밖으로 아무것도 안 나간다" 다. 자동화는 그 예외를 **자동으로**
 * 만든다: 사람이 없는 사이 일지 본문·플랜·git 요약이 프로바이더로 나간다.
 * 그 사실이 화면에 없으면 약속은 문서 안에만 있다.
 *
 * # 안 붙는 자리가 요점이다
 *
 * 로컬 모델이면 배지가 **없다**. 있고 없고의 차이가 약속 그 자체이고, 지금까지
 * 화면에 없던 것이 바로 그 구분이다. 판정(`local`)은 백엔드
 * (`automation::egress`)가 소유한다 — 프런트가 프로바이더 목록을 따로 들면
 * 언젠가 어긋나고, 그때 배지가 조용히 거짓말을 한다.
 *
 * 프로바이더 이름과 호스트를 **그대로 찍는다.** "외부로 나감" 같은 뭉뚱그린
 * 문구는 사용자가 확인할 수 없는 말이라 안심도 경계도 주지 못한다.
 *
 * 색은 토큰 경유, 아이콘은 그 자리의 동작(앱을 떠난다 = ExternalLink · 이 기기
 * 안 = Monitor). de-AI 규율에 따라 스파클·유리·팔레트 원색·광택 없음.
 */

import { ExternalLink, Monitor } from "@/components/Icons";

export interface EgressNotice {
  text: string;
  /** 원격일 때만 붙는 보조 설명. 로컬이면 `null`. */
  hint: string | null;
}

export function EgressBadge({ notice }: { notice: EgressNotice | null }) {
  if (!notice) return null;
  const remote = notice.hint !== null;
  const Icon = remote ? ExternalLink : Monitor;
  return (
    <div
      className={
        remote
          ? "rounded-lg border border-(--warn)/40 bg-(--warn-soft) p-3 space-y-1"
          : "rounded-lg border border-border bg-muted/30 p-3 space-y-1"
      }
      role="note"
      data-testid="automation-egress-badge"
      data-egress={remote ? "remote" : "local"}
    >
      <p className="flex items-start gap-1.5 text-xs font-medium text-foreground">
        <Icon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" aria-hidden="true" />
        {notice.text}
      </p>
      {notice.hint && <p className="text-[11px] text-muted-foreground">{notice.hint}</p>}
    </div>
  );
}
