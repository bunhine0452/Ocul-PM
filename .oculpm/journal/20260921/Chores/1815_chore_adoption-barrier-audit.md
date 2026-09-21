---
schema_version: 1
type: chore
slug: "adoption-barrier-audit"
status: done
created_at: "2026-09-21T18:15:13+09:00"
session_id: "20260921-001"
agent:
  id: "codex"
  version: "GPT-6"
language: "ko"
verified_by_user: false
files_touched: []
related:
  - ref: "20260906/Bugs/1305_bug_first-five-minutes-truth.md"
    kind: "followup"
tags:
  - "product"
  - "onboarding"
  - "adoption"
  - "mcp-tool"
---
[x] 사용자 유입·첫 가치 경험 장벽 진단

## 진단
README·랜딩 소스·시작 안내·WelcomeWizard·한국어 문구·활성 플랜을 검토했다. 제품은 자동 기록을 전면에 내세우지만 실제 지원 계약은 규칙 호환과 MCP/훅/앱 통합으로 다르며, 시작 안내의 별도 설정 불필요 설명은 README의 에이전트별 규칙 활성화 설명과 일치하지 않는다. 마법사는 언어·외형·프로젝트 등록에서 끝나 첫 기록 성공까지 직접 확인하지 않는다. 빈 상태 CTA·백필·플러그인 안내는 이미 구현되어 있어 미구현으로 판단하지 않았다.

소개에서 기록·검증·콘솔·편집기 역할과 긴 릴리스 설명이 함께 경쟁하고, 낮은 부담의 플러그인 시작 경로는 README 하단에 있다. 활성 계획은 구현·검증 중심이며 Show HN/awesome 배포 항목은 미완이다. 이는 홍보를 전혀 안 했다는 뜻은 아니다(Product Hunt 링크 있음).

## 판단과 한계
가장 유력한 가설은 좁고 즉각적인 사용 이유 및 첫 성공 경로보다 기능 범위가 앞서 있다는 것이다. 기존 도구 안에서 과거 결정 재사용을 경험하게 하는 진입점과 첫 일지 확인을 우선 검증할 것을 제안한다. 사용자 수·유입·재방문 수치는 확보하지 않아 이탈 원인 또는 사용자 0명을 확정하지 않는다.

## 검증
소스 및 과거 첫 5분 수정 일지를 대조했다. 공개 GitHub는 웹 캐시로 확인했으나 최신성 보장 불가, oculpm.com은 웹 도구 접근 실패로 로컬 랜딩 소스를 사용했다. 앱 실행·사용자 행동 관찰·코드 수정은 수행하지 않았다. 대응하는 구현 완료 플랜 항목은 없어 상태를 변경하지 않았다.