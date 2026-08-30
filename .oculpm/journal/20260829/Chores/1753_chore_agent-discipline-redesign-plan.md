---
schema_version: 1
type: chore
slug: agent-discipline-redesign-plan
status: done
created_at: 2026-08-29T17:53:00+09:00
session_id: "manual-20260829-175300"
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
files_touched:
  - path: docs/agent-discipline/00-master-plan.md
    op: create
  - path: .oculpm/planner/agent-discipline-redesign.md
    op: create
related: []
tags:
  - skills
  - rules
  - design
---

[x] 스킬·규칙 재설계 마스터플랜 — transcript 실측으로 진단하고 발동 루프로 재구성

사용자 관측 "스킬과 규칙 기능을 잘 안 쓰는 것 같다" 를 가설 없이 계측부터 했다.
이 저장소의 Claude Code transcript 136개를 직접 훑은 결과가 예상과 반대였다.

- `Skill` 도구 발동: **11회 / 136 세션**(0.08회/세션). 그중 `oculpm:*` 은 1회.
- 이 저장소의 `.claude/skills/`·`.claude/rules/`: **둘 다 존재하지 않음**.
  스킬 샵 28종·갤러리 5종을 구현한 저장소가 정작 하나도 설치하지 않았다.
- 반면 전역 규칙 주입(`attachment.type == "nested_memory"`)은 **누적 1,812회**,
  세션당 **30파일 · 89,808바이트(≈22K 토큰)**.
- 그 30개에 react-native 8건 · arkts(HarmonyOS) 5건 · vue 1건이 섞여 있다.
  원인은 ECC 규칙의 과대 glob — `paths: ["**/*.ts", "**/*.tsx"]` 라서 TS 파일 하나만
  만져도 무관한 플랫폼 규율이 통째로 딸려온다.

즉 "안 쓴다"가 아니라 **스킬은 죽어 있고 규칙은 폭주 중인데 아무도 그걸 볼 수 없다**.
현재 설계(12번째 화면 5탭 CRUD 허브)가 파일 관리자이기 때문이다 — 사용자는 파일을
관리하고 싶은 게 아니라 에이전트 행동을 고치고 싶다.

재설계 원칙 넷과 결정 다섯(D1 발동 원장 · D2 1화면 3존 · D3 사건 진입점 ·
D4 규칙 다이어트 · D5 옵인 리마인더 후순위), PR 분해 AD-1~6, 실측 기준선 기반
성공 지표를 `docs/agent-discipline/00-master-plan.md` 에 SSOT 로 고정했다.
CI4/CI5 의 `rule_promotion`·`skill_promotion` 은 이미 완성돼 있으나 회고 화면에만
갇혀 있어, 재사용 대상으로 명시했다(신규 백엔드 없이 Today 로 승격).

## 검증

계측 재현 가능: `~/.claude/projects/-Users-kimhyunbin-Desktop-git-ai-pm/*.jsonl` 에서
`"name":"Skill"` grep 11건, `"type":"nested_memory"` grep 1,812건, 최근 세션 1건의
고유 주입 경로 30개 바이트 합 89,808 을 확인했다. 문서만 추가했으므로 코드 게이트
영향 없음.

## 메모

D5(훅으로 규칙 주입)를 일부러 후순위로 뒀다. 지금 문제는 주입이 모자란 게 아니라
과한 것이므로, 예산을 볼 수 있게 만들기 전에 예산을 늘리는 기능을 붙이면 안 된다.
