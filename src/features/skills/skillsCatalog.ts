// C1 — 제3자 스킬 카탈로그 (벤더링, 런타임 네트워크 0).
//
// Ocul-PM 이 프로젝트 스택에 맞춰 추천·설치하는 큐레이션 스킬 세트다. 설치
// 시점 fetch 를 하지 않으므로 원문 SKILL.md 를 커밋 핀과 함께 저장소에 동봉한다
// (`catalog/<id>.md`, Vite `?raw` 임포트). 각 파일은 frontmatter 바로 아래에
// `vendored-from:` 출처 헤더(핀 SHA·MIT·수집일)를 갖는다 — 그 외 원문은 무수정
// (수정하면 vendored 무결성이 깨진다). 검증은 src/__tests__/skills_catalog.test.ts.
//
// 갱신 절차: 업스트림 main SHA 재확인 → raw.githubusercontent.com/<repo>/<SHA>/…
// 로 재fetch → 헤더의 SHA·retrieved 갱신 → 아래 핀 상수 동기화.

import pythonPatterns from "./catalog/python-patterns.md?raw";
import pythonTesting from "./catalog/python-testing.md?raw";
import rustPatterns from "./catalog/rust-patterns.md?raw";
import rustTesting from "./catalog/rust-testing.md?raw";
import reactPatterns from "./catalog/react-patterns.md?raw";
import reactTesting from "./catalog/react-testing.md?raw";
import golangPatterns from "./catalog/golang-patterns.md?raw";
import golangTesting from "./catalog/golang-testing.md?raw";
import securityReview from "./catalog/security-review.md?raw";
import codebaseOnboarding from "./catalog/codebase-onboarding.md?raw";
import ponytail from "./catalog/ponytail.md?raw";
import ponytailReview from "./catalog/ponytail-review.md?raw";
import ponytailAudit from "./catalog/ponytail-audit.md?raw";
import vuePatterns from "./catalog/vue-patterns.md?raw";
import reactPerformance from "./catalog/react-performance.md?raw";
import vitePatterns from "./catalog/vite-patterns.md?raw";
import laravelPatterns from "./catalog/laravel-patterns.md?raw";
import springbootPatterns from "./catalog/springboot-patterns.md?raw";
import djangoPatterns from "./catalog/django-patterns.md?raw";
import fastapiPatterns from "./catalog/fastapi-patterns.md?raw";
import accessibility from "./catalog/accessibility.md?raw";
import apiDesign from "./catalog/api-design.md?raw";
import databaseMigrations from "./catalog/database-migrations.md?raw";
import e2eTesting from "./catalog/e2e-testing.md?raw";
import inheritLegacyStyle from "./catalog/inherit-legacy-style.md?raw";
import type { I18nKey } from "@/i18n";

/** 벤더링 당시 핀 고정한 업스트림 커밋 (재fetch 시 갱신). */
export const CATALOG_PINS = {
  ecc: "e4e4163101f162881e628f300a9ca4e6a940bcea",
  ponytail: "16f29800fd2681bdf24f3eb4ccffe38be3baec6b",
} as const;

export type CatalogSource = keyof typeof CATALOG_PINS;

/** 카탈로그 태그 허용 어휘 (소문자 고정). */
export const CATALOG_TAGS = [
  "python",
  "rust",
  "react",
  "typescript",
  "go",
  "security",
  "testing",
  "patterns",
  "style",
  "onboarding",
  "workflow",
  "review",
  "docs",
  "minimalism",
  "frontend",
  "vue",
  "performance",
  "laravel",
  "springboot",
  "django",
  "fastapi",
  "a11y",
  "backend",
  "database",
] as const;

export type CatalogTag = (typeof CATALOG_TAGS)[number];

export interface CatalogSkill {
  /** `catalog/<id>.md` 파일명이자 설치 폴더명 (kebab-case). */
  id: string;
  /** 목록 표시명의 사전 키 — 표시는 소비처가 `t()` 로. */
  labelKey: I18nKey;
  /** 어느 업스트림에서 왔는지. */
  source: CatalogSource;
  /** 핀 SHA 로 고정된 업스트림 원문 URL. */
  sourceUrl: string;
  license: "MIT";
  /** 스택 매칭용 태그 (CATALOG_TAGS 어휘 내). */
  tags: CatalogTag[];
  /** 1문장 요약의 사전 키. */
  summaryKey: I18nKey;
  /** 대략적 토큰 수 (content.length/4 반올림). */
  tokenEstimate: number;
  /** SKILL.md 전문 (frontmatter + vendored-from 헤더 포함, 원문 무수정). */
  content: string;
}

const estimateTokens = (content: string): number => Math.round(content.length / 4);

const skillUrl = (source: CatalogSource, id: string): string => {
  const repo = source === "ecc" ? "affaan-m/ecc" : "DietrichGebert/ponytail";
  return `https://github.com/${repo}/blob/${CATALOG_PINS[source]}/skills/${id}/SKILL.md`;
};

interface CatalogSeed {
  id: string;
  /**
   * 표시 라벨·요약의 **사전 키**. 문자열을 여기 직접 두면 `seed()` 가 모듈 로드
   * 시점에 실행되므로 그때 언어가 굳어 설정을 바꿔도 안 바뀐다 — 소비처가
   * `t(labelKey)` 로 그린다. (SKILL.md 본문 `content` 는 벤더링된 디스크
   * 산출물이라 번역 대상이 아니다.)
   */
  labelKey: I18nKey;
  source: CatalogSource;
  tags: CatalogTag[];
  summaryKey: I18nKey;
  content: string;
}

const seed = ({ id, labelKey, source, tags, summaryKey, content }: CatalogSeed): CatalogSkill => ({
  id,
  labelKey,
  source,
  sourceUrl: skillUrl(source, id),
  license: "MIT",
  tags,
  summaryKey,
  tokenEstimate: estimateTokens(content),
  content,
});

export const CATALOG_SKILLS: CatalogSkill[] = [
  seed({
    id: "python-patterns",
    labelKey: "skill.python-patterns.label",
    source: "ecc",
    tags: ["python", "patterns"],
    summaryKey: "skill.python-patterns.summary",
    content: pythonPatterns,
  }),
  seed({
    id: "python-testing",
    labelKey: "skill.python-testing.label",
    source: "ecc",
    tags: ["python", "testing"],
    summaryKey: "skill.python-testing.summary",
    content: pythonTesting,
  }),
  seed({
    id: "rust-patterns",
    labelKey: "skill.rust-patterns.label",
    source: "ecc",
    tags: ["rust", "patterns"],
    summaryKey: "skill.rust-patterns.summary",
    content: rustPatterns,
  }),
  seed({
    id: "rust-testing",
    labelKey: "skill.rust-testing.label",
    source: "ecc",
    tags: ["rust", "testing"],
    summaryKey: "skill.rust-testing.summary",
    content: rustTesting,
  }),
  seed({
    id: "react-patterns",
    labelKey: "skill.react-patterns.label",
    source: "ecc",
    tags: ["react", "patterns"],
    summaryKey: "skill.react-patterns.summary",
    content: reactPatterns,
  }),
  seed({
    id: "react-testing",
    labelKey: "skill.react-testing.label",
    source: "ecc",
    tags: ["react", "testing"],
    summaryKey: "skill.react-testing.summary",
    content: reactTesting,
  }),
  seed({
    id: "golang-patterns",
    labelKey: "skill.golang-patterns.label",
    source: "ecc",
    tags: ["go", "patterns"],
    summaryKey: "skill.golang-patterns.summary",
    content: golangPatterns,
  }),
  seed({
    id: "golang-testing",
    labelKey: "skill.golang-testing.label",
    source: "ecc",
    tags: ["go", "testing"],
    summaryKey: "skill.golang-testing.summary",
    content: golangTesting,
  }),
  seed({
    id: "security-review",
    labelKey: "skill.security-review.label",
    source: "ecc",
    tags: ["security", "review"],
    summaryKey: "skill.security-review.summary",
    content: securityReview,
  }),
  seed({
    id: "codebase-onboarding",
    labelKey: "skill.codebase-onboarding.label",
    source: "ecc",
    tags: ["onboarding", "docs"],
    summaryKey: "skill.codebase-onboarding.summary",
    content: codebaseOnboarding,
  }),
  seed({
    id: "ponytail",
    labelKey: "skill.ponytail.label",
    source: "ponytail",
    tags: ["style", "minimalism"],
    summaryKey: "skill.ponytail.summary",
    content: ponytail,
  }),
  seed({
    id: "ponytail-review",
    labelKey: "skill.ponytail-review.label",
    source: "ponytail",
    tags: ["style", "review"],
    summaryKey: "skill.ponytail-review.summary",
    content: ponytailReview,
  }),
  seed({
    id: "ponytail-audit",
    labelKey: "skill.ponytail-audit.label",
    source: "ponytail",
    tags: ["style", "review"],
    summaryKey: "skill.ponytail-audit.summary",
    content: ponytailAudit,
  }),
  seed({
    id: "vue-patterns",
    labelKey: "skill.vue-patterns.label",
    source: "ecc",
    tags: ["vue", "patterns"],
    summaryKey: "skill.vue-patterns.summary",
    content: vuePatterns,
  }),
  seed({
    id: "react-performance",
    labelKey: "skill.react-performance.label",
    source: "ecc",
    tags: ["react", "performance"],
    summaryKey: "skill.react-performance.summary",
    content: reactPerformance,
  }),
  seed({
    id: "vite-patterns",
    labelKey: "skill.vite-patterns.label",
    source: "ecc",
    tags: ["frontend", "patterns"],
    summaryKey: "skill.vite-patterns.summary",
    content: vitePatterns,
  }),
  seed({
    id: "laravel-patterns",
    labelKey: "skill.laravel-patterns.label",
    source: "ecc",
    tags: ["laravel", "patterns"],
    summaryKey: "skill.laravel-patterns.summary",
    content: laravelPatterns,
  }),
  seed({
    id: "springboot-patterns",
    labelKey: "skill.springboot-patterns.label",
    source: "ecc",
    tags: ["springboot", "patterns"],
    summaryKey: "skill.springboot-patterns.summary",
    content: springbootPatterns,
  }),
  seed({
    id: "django-patterns",
    labelKey: "skill.django-patterns.label",
    source: "ecc",
    tags: ["django", "patterns"],
    summaryKey: "skill.django-patterns.summary",
    content: djangoPatterns,
  }),
  seed({
    id: "fastapi-patterns",
    labelKey: "skill.fastapi-patterns.label",
    source: "ecc",
    tags: ["fastapi", "patterns"],
    summaryKey: "skill.fastapi-patterns.summary",
    content: fastapiPatterns,
  }),
  seed({
    id: "accessibility",
    labelKey: "skill.accessibility.label",
    source: "ecc",
    tags: ["frontend", "a11y"],
    summaryKey: "skill.accessibility.summary",
    content: accessibility,
  }),
  seed({
    id: "api-design",
    labelKey: "skill.api-design.label",
    source: "ecc",
    tags: ["backend", "patterns"],
    summaryKey: "skill.api-design.summary",
    content: apiDesign,
  }),
  seed({
    id: "database-migrations",
    labelKey: "skill.database-migrations.label",
    source: "ecc",
    tags: ["database", "patterns"],
    summaryKey: "skill.database-migrations.summary",
    content: databaseMigrations,
  }),
  seed({
    id: "e2e-testing",
    labelKey: "skill.e2e-testing.label",
    source: "ecc",
    tags: ["frontend", "testing"],
    summaryKey: "skill.e2e-testing.summary",
    content: e2eTesting,
  }),
  seed({
    id: "inherit-legacy-style",
    labelKey: "skill.inherit-legacy-style.label",
    source: "ecc",
    tags: ["onboarding", "style"],
    summaryKey: "skill.inherit-legacy-style.summary",
    content: inheritLegacyStyle,
  }),
];
