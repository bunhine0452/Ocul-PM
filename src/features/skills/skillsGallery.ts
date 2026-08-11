// PR-CI5 — 추천 스킬 갤러리 데이터 (마스터플랜 트랙4 / EDD-lite 의 앞단).
//
// 백엔드 없이 순수 데이터다: 설치는 기존 `skills_save`(create=true) 를 그대로
// 재사용하고, 중복 가드는 (a) UI 의 "설치됨" 상태 + (b) skills_save 의 동명
// 거부가 이중으로 막는다. `run-evals` 템플릿이 EVALS.md 의 `## 기록` 표 규약을
// 정의한다 — PR-CI6 회고 eval 추이가 같은 표를 파싱한다 (형식 변경 금지).

// SKILL.md 본문은 **플러그인 디렉토리에서 직접** `?raw` 로 읽는다.
//
// 예전에는 같은 본문이 이 파일의 템플릿 리터럴과 `plugin/oculpm/skills/<id>/
// SKILL.md` 두 곳에 있었고, `plugin_skills_sync` 테스트가 둘이 어긋나지 않는지
// 감시했다. 사본을 하나로 줄이면 그 불변식이 **테스트가 아니라 구조로** 보장된다
// — 드리프트가 애초에 불가능해진다.
//
// 부수 효과로 본문이 .ts 밖으로 나간다: 이건 사용자의 `.claude/skills/<id>/
// SKILL.md` 로 그대로 쓰이는 디스크 산출물이라 UI 번역 대상이 아닌데, 한글
// 하드코딩 검사기(=.ts/.tsx 만 훑는다)가 오탐하던 것도 함께 사라진다.
import projectInceptionMd from "../../../plugin/oculpm/skills/project-inception/SKILL.md?raw";
import selfAuditMd from "../../../plugin/oculpm/skills/self-audit/SKILL.md?raw";
import runEvalsMd from "../../../plugin/oculpm/skills/run-evals/SKILL.md?raw";
import tddWorkflowMd from "../../../plugin/oculpm/skills/tdd-workflow/SKILL.md?raw";
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

export const GALLERY_SKILLS: GallerySkill[] = [
  {
    id: "project-inception",
    labelKey: "skill.project-inception.label",
    summaryKey: "skill.project-inception.summary",
    content: projectInceptionMd,
  },
  {
    id: "self-audit",
    labelKey: "skill.self-audit.label",
    summaryKey: "skill.self-audit.summary",
    content: selfAuditMd,
  },
  {
    id: "run-evals",
    labelKey: "skill.run-evals.label",
    summaryKey: "skill.run-evals.summary",
    content: runEvalsMd,
  },
  {
    id: "tdd-workflow",
    labelKey: "skill.tdd-workflow.label",
    summaryKey: "skill.tdd-workflow.summary",
    content: tddWorkflowMd,
  },
];
