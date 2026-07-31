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
] as const;

export type CatalogTag = (typeof CATALOG_TAGS)[number];

export interface CatalogSkill {
  /** `catalog/<id>.md` 파일명이자 설치 폴더명 (kebab-case). */
  id: string;
  /** 목록 표시명 (한국어 한 줄). */
  label: string;
  /** 어느 업스트림에서 왔는지. */
  source: CatalogSource;
  /** 핀 SHA 로 고정된 업스트림 원문 URL. */
  sourceUrl: string;
  license: "MIT";
  /** 스택 매칭용 태그 (CATALOG_TAGS 어휘 내). */
  tags: CatalogTag[];
  /** 한국어 1문장 요약. */
  summary: string;
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
  label: string;
  source: CatalogSource;
  tags: CatalogTag[];
  summary: string;
  content: string;
}

const seed = ({ id, label, source, tags, summary, content }: CatalogSeed): CatalogSkill => ({
  id,
  label,
  source,
  sourceUrl: skillUrl(source, id),
  license: "MIT",
  tags,
  summary,
  tokenEstimate: estimateTokens(content),
  content,
});

export const CATALOG_SKILLS: CatalogSkill[] = [
  seed({
    id: "python-patterns",
    label: "python-patterns — Python 관용구·패턴",
    source: "ecc",
    tags: ["python", "patterns"],
    summary:
      "Pythonic 관용구, PEP 8, 타입 힌트 등 견고하고 유지보수 가능한 Python 코드를 위한 베스트 프랙티스입니다.",
    content: pythonPatterns,
  }),
  seed({
    id: "python-testing",
    label: "python-testing — pytest 기반 TDD",
    source: "ecc",
    tags: ["python", "testing"],
    summary: "pytest 픽스처·모킹·파라미터라이즈와 TDD 방법론, 커버리지 요건을 다룹니다.",
    content: pythonTesting,
  }),
  seed({
    id: "rust-patterns",
    label: "rust-patterns — Rust 소유권·트레이트 패턴",
    source: "ecc",
    tags: ["rust", "patterns"],
    summary: "소유권·에러 처리·트레이트·동시성 등 안전하고 성능 좋은 Rust 를 위한 관용 패턴입니다.",
    content: rustPatterns,
  }),
  seed({
    id: "rust-testing",
    label: "rust-testing — Rust 테스트 패턴",
    source: "ecc",
    tags: ["rust", "testing"],
    summary:
      "단위·통합·비동기·property 기반 테스트와 모킹, 커버리지까지 TDD 방법론을 따르는 Rust 테스트 패턴입니다.",
    content: rustTesting,
  }),
  seed({
    id: "react-patterns",
    label: "react-patterns — React 18/19 컴포넌트 패턴",
    source: "ecc",
    tags: ["react", "patterns"],
    summary:
      "훅 규율, 서버/클라이언트 컴포넌트 경계, Suspense·폼 액션·상태관리 결정 트리 등 React 18/19 패턴입니다.",
    content: reactPatterns,
  }),
  seed({
    id: "react-testing",
    label: "react-testing — React Testing Library 테스트",
    source: "ecc",
    tags: ["react", "testing"],
    summary:
      "React Testing Library + Vitest/Jest, MSW 네트워크 모킹, axe 접근성 단언과 E2E 경계 판단을 다룹니다.",
    content: reactTesting,
  }),
  seed({
    id: "golang-patterns",
    label: "golang-patterns — Go 관용구·패턴",
    source: "ecc",
    tags: ["go", "patterns"],
    summary: "관용적 Go 패턴·컨벤션으로 견고하고 효율적인 Go 애플리케이션을 만들게 합니다.",
    content: golangPatterns,
  }),
  seed({
    id: "golang-testing",
    label: "golang-testing — Go 테이블 주도 테스트",
    source: "ecc",
    tags: ["go", "testing"],
    summary: "테이블 주도 테스트·서브테스트·벤치마크·퍼징·커버리지 등 Go 테스트 패턴을 TDD 로 안내합니다.",
    content: golangTesting,
  }),
  seed({
    id: "security-review",
    label: "security-review — 보안 리뷰 체크리스트",
    source: "ecc",
    tags: ["security", "review"],
    summary:
      "인증·사용자 입력·시크릿·API 엔드포인트·결제 코드를 위한 종합 보안 체크리스트입니다 (블록체인(Solana) 절 포함).",
    content: securityReview,
  }),
  seed({
    id: "codebase-onboarding",
    label: "codebase-onboarding — 코드베이스 온보딩 가이드",
    source: "ecc",
    tags: ["onboarding", "docs"],
    summary:
      "낯선 코드베이스를 분석해 아키텍처 맵·진입점·컨벤션 정리와 초기 CLAUDE.md 를 만들어 주는 온보딩 가이드입니다.",
    content: codebaseOnboarding,
  }),
  seed({
    id: "ponytail",
    label: "ponytail — 가장 게으른(최소) 해법 강제",
    source: "ponytail",
    tags: ["style", "minimalism"],
    summary:
      "실제로 동작하는 가장 게으르고 짧고 최소한의 해법을 강제합니다 — YAGNI, 표준 라이브러리·네이티브 기능 우선.",
    content: ponytail,
  }),
  seed({
    id: "ponytail-review",
    label: "ponytail-review — 오버엔지니어링 삭제 리뷰",
    source: "ponytail",
    tags: ["style", "review"],
    summary:
      "오버엔지니어링만 겨냥한 코드 리뷰 — 재발명된 stdlib·불필요 의존성·투기적 추상화 등 삭제할 것을 한 줄씩 짚습니다.",
    content: ponytailReview,
  }),
  seed({
    id: "ponytail-audit",
    label: "ponytail-audit — 저장소 전체 과잉설계 감사",
    source: "ponytail",
    tags: ["style", "review"],
    summary:
      "diff 가 아닌 저장소 전체를 훑어 삭제·단순화·stdlib 대체 후보를 순위 목록으로 뽑는 일회성 감사입니다.",
    content: ponytailAudit,
  }),
];
