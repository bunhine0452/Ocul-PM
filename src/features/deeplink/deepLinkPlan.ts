/**
 * 딥링크가 **무엇을 바꾸는가** 를 계산하는 순수 함수
 * (Osaurus 라운드 Phase 6 `#deep-link`).
 *
 * 확인 시트의 규약은 "무엇을, 어디서, 무엇이 바뀌는지" 를 보여 주는 것이다.
 * 그 세 줄을 컴포넌트가 아니라 여기서 만든다 — 링크 종류가 늘어도 문구가
 * 빠지지 않는지를 렌더 없이 단언할 수 있어야 한다.
 */

import type { DeepLink } from "@/lib/bindings";
import type { I18nKey } from "@/i18n";

export interface DeepLinkPlan {
  /** 시트 제목 키. */
  titleKey: I18nKey;
  /** "어디서" — 출처를 그대로 보여 준다 (요약하지 않는다). */
  origin: string;
  /** "무엇이 바뀌는지" — 한 줄 설명 키. */
  effectKey: I18nKey;
  /** 승인 버튼 키. */
  actionKey: I18nKey;
  /** 되돌리기 어려운 변화인가 — 시트가 강조 톤을 고른다. */
  writes: boolean;
}

export function planFor(link: DeepLink): DeepLinkPlan {
  switch (link.action) {
    case "plugin_install":
      return {
        titleKey: "deeplink.plugin.title",
        origin: `github.com/${link.source}`,
        effectKey: "deeplink.plugin.effect",
        actionKey: "deeplink.plugin.action",
        writes: true,
      };
    case "skill_install":
      return {
        titleKey: "deeplink.skill.title",
        origin: `github.com/${link.source}`,
        effectKey: "deeplink.skill.effect",
        actionKey: "deeplink.skill.action",
        writes: true,
      };
    case "theme_install":
      return {
        titleKey: "deeplink.theme.title",
        origin: link.url,
        effectKey: "deeplink.theme.effect",
        actionKey: "deeplink.theme.action",
        writes: true,
      };
    case "open":
      return {
        titleKey: "deeplink.open.title",
        origin: link.project,
        effectKey: "deeplink.open.effect",
        actionKey: "deeplink.open.action",
        // 여는 것뿐이다 — 디스크를 바꾸지 않는다.
        writes: false,
      };
  }
}

/**
 * `open` 은 **이미 등록된** 프로젝트만 연다. 경로가 목록에 없으면 새
 * 프로젝트를 추가하지 않고 거절한다 — 링크 하나로 임의 폴더가 추적 대상이
 * 되는 길을 막는다.
 */
export function resolveRegisteredProject(
  projects: Array<{ id: number; root_path: string }>,
  wanted: string,
): number | null {
  const norm = (p: string) => p.replace(/\/+$/, "");
  return projects.find((p) => norm(p.root_path) === norm(wanted))?.id ?? null;
}
