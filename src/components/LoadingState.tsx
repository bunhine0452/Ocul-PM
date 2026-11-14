/**
 * 「불러오는 중」 하나 — `EmptyState` 의 쌍둥이 (v3 일관성 라운드
 * {#layout-loading-state}).
 *
 * 그전까지 여덟 자리가 **로딩을 `EmptyState` 로** 그렸다. 그중 다섯
 * (NextTasks · WhatsNewCard · ConversationHistoryModal · BinaryFileView ·
 * AutomationHistory)은 로딩 분기와 빈 분기가 *같은 컴포넌트에 같은 props* 라
 * 문자열만 달랐다 — 화면이 픽셀 단위로 같으니 사용자는 "기다리면 채워지는
 * 것" 과 "여기는 원래 비어 있는 것" 을 구분할 수 없었다. 둘은 정반대의
 * 행동을 요구한다: 하나는 기다려라, 하나는 무언가를 해라.
 *
 * 그래서 **자리와 치수는 그대로 두고**(`.es .es--plain` 을 그대로 입는다) `role="status"` 와 문안으로
 * 갈린다.
 *
 * 11-15 — **300ms 안에 끝나는 로딩은 아무것도 그리지 않는다.** 그 뒤에야 멈춰 있는 글자 「불러오는 중」
 * 하나가 선다. 돌아가는 브랜드 스피너(초록 세 호, 무한 회전)는 걷었다 — 움직임은 응답일 때만이고
 * (영수증 규칙 6), 순간 로딩마다 스피너가 번쩍이면 화면이 느려 보인다. 정렬 기본값도 빈 상태와 같은
 * 왼쪽이다 — 로딩(가운데) → 빈 상태(왼쪽)로 같은 자리에서 글자가 튀었다.
 */
import { useEffect, useState } from "react";
import { useT } from "@/i18n";

import type { CSSProperties, ReactNode } from "react";

/** 이만큼 지나야 「불러오는 중」 이 선다 — 그 안에 끝나는 로딩은 깜빡이지 않는다. */
export const LOADING_SHOW_AFTER_MS = 300;

export interface LoadingStateProps {
  /** `EmptyState` 와 **같은 축** — 로딩과 빈 상태가 한 자리에서 번갈아 뜨므로
   *  둘의 밀도가 갈리면 전환할 때 자리가 튄다. `rich` 는 없다: 아이콘·제목·
   *  행동이 있는 로딩은 이 앱에 없다. */
  density?: "plain" | "compact";
  /** 생략하면 `common.loading`. 자리마다 더 구체적인 문안이 있으면 그것을. */
  children?: ReactNode;
  /** 기본은 왼쪽 — `EmptyState` 와 같은 축. 가운데는 부르는 쪽이 고른다. */
  align?: "center" | "start";
  className?: string;
  style?: CSSProperties;
}

export function LoadingState({
  children,
  density = "plain",
  align = "start",
  className,
  style,
}: LoadingStateProps) {
  const { t } = useT();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setShown(true), LOADING_SHOW_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, []);
  const cls = [
    "es",
    density === "compact" ? "es--compact" : "es--plain",
    "ls",
    align === "start" ? "ls--start" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  // 리전은 처음부터 서 있고 글자만 나중에 들어온다 — 라이브 리전이 내용과 함께 삽입되면 스크린리더가
  // 놓친다(Toaster 와 같은 이유).
  return (
    <div className={cls} style={style} role="status">
      {shown ? <span>{children ?? t("common.loading")}</span> : null}
    </div>
  );
}

export default LoadingState;
