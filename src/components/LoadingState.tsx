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
 * 그래서 **자리와 치수는 그대로 두고**(`.es .es--plain` 을 그대로 입는다)
 * 브랜드 스피너 하나로만 갈린다. 옮기는 과정에서 레이아웃이 흔들리지 않고,
 * 움직이는 것이 있다 = 기다리는 중이라는 신호는 설명 없이 읽힌다.
 *
 * `role="status"` 는 이 컴포넌트가 지고 스피너는 `aria-hidden` 이다 —
 * `OculSpinner` 가 자기 `aria-label`("불러오는 중")을 갖고 있어서, 감싸지
 * 않으면 보조기술이 같은 말을 두 번 읽는다.
 */
import { OculSpinner } from "@/components/OculSpinner";
import { useT } from "@/i18n";

import type { CSSProperties, ReactNode } from "react";

export interface LoadingStateProps {
  /** `EmptyState` 와 **같은 축** — 로딩과 빈 상태가 한 자리에서 번갈아 뜨므로
   *  둘의 밀도가 갈리면 전환할 때 자리가 튄다. `rich` 는 없다: 아이콘·제목·
   *  행동이 있는 로딩은 이 앱에 없다. */
  density?: "plain" | "compact";
  /** 생략하면 `common.loading`. 자리마다 더 구체적인 문안이 있으면 그것을. */
  children?: ReactNode;
  /** 가운데가 어색한 자리(목록 옆·코드 옆)는 왼쪽으로 — `EmptyState` 와 같은 축. */
  align?: "center" | "start";
  className?: string;
  style?: CSSProperties;
}

export function LoadingState({
  children,
  density = "plain",
  align = "center",
  className,
  style,
}: LoadingStateProps) {
  const { t } = useT();
  const cls = [
    "es",
    density === "compact" ? "es--compact" : "es--plain",
    "ls",
    align === "start" ? "ls--start" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls} style={style} role="status">
      <span className="ls-spin" aria-hidden="true">
        <OculSpinner size={13} />
      </span>
      <span>{children ?? t("common.loading")}</span>
    </div>
  );
}

export default LoadingState;
