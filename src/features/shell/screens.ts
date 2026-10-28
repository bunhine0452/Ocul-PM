/**
 * 셸이 지연 로드하는 화면 청크 목록 (플랜 `v3-release` {#big-files-watch}).
 *
 * 라우터가 **어떤 화면을 언제 그리는가**를 읽는 자리에 "무엇이 별도 청크인가"라는
 * 다른 결의 목록이 섞이지 않게 여기 모은다. 이 모듈은 셸이 **정적으로** 임포트한다 —
 * 그래야 `lazy()` 의 동적 임포트가 화면별 청크로 갈라진다.
 *
 * 4.0 에서는 설정 하나만 남았다. 오늘·작업 일지·계획·변경은 매일 여는 화면이라
 * eager 이고, 설정은 가끔 연다.
 */

import { lazy } from "react";

export const SettingsPage = lazy(() =>
  import("@/features/settings/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
