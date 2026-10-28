// PR-CI5 — 추천 스킬 갤러리 데이터.
//
// 2026-10-28 덜어내기(플랜 simplify-round-20261028)로 동봉 스킬이 12→5 가 되면서 갤러리에
// 싣던 넷(project-inception · self-audit · run-evals · tdd-workflow)이 플러그인에서 빠졌다 —
// 설계는 `/oculpm:inception` 커맨드가, 검증은 `/oculpm:redteam` 과 플랜의 확인 명령이 맡는다.
// 갤러리는 비어 있고, 자리(`ContextInbox` 의 「추가하기」)는 스택별 제3자 카탈로그만 보여 준다.
// 다시 채울 때는 `plugin/oculpm/skills/<id>/SKILL.md` 를 `?raw` 로 읽어 사본 하나로 둔다.
import type { I18nKey } from "@/i18n";

export interface GallerySkill {
  /** `.claude/skills/<id>/SKILL.md` 폴더명 (kebab-case). */
  id: string;
  /** 목록 표시명의 사전 키. */
  labelKey: I18nKey;
  /** 목록 부제(뭘 해주는 스킬인지 한 줄)의 사전 키. */
  summaryKey: I18nKey;
  /** SKILL.md 전문 (frontmatter 포함). */
  content: string;
}

export const GALLERY_SKILLS: GallerySkill[] = [];
