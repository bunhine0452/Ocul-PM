<!-- template_version: 7 -->
# 문제 해결 문서 규격 (ocul-pm)

> 이 파일은 ocul-pm 이 관리합니다 (직접 편집 금지 — 앱 업그레이드 시 갱신됨).
> 마스터 규칙(`AGENTS.md` §5)이 가리키는 on-demand 규격서입니다.

작업일지가 *무엇을 했나*(회고), 플래너가 *무엇을, 어디까지*(결정 후 계획)라면, **문제 해결 문서**(`.oculpm/discussion/<slug>/discussion.md`)는 그 **앞** 단계 — *"이게 문제인가? 어떤 안들이 있나?"* 를 결정 전에 정리하는 회의록입니다.

## 언제 쓰는가 (요청 기반 — 매 작업마다가 아님)

- 사용자가 *"이 문제 같이 정리/토의해보자", "큰 계획을 세우자", "옵션을 비교하자"* 라고 **명시적으로 요청**할 때.
- 한 세션에 결정되지 않아 여러 세션에 걸쳐 다듬어야 할 때.
- 그 외 일반 작업에는 쓰지 말 것 — 작업이 끝나면 일지·플래너가 정답.

## 형식 (파일 맨 위는 반드시 YAML frontmatter)

```markdown
---
oculpm_discussion: v1
id: onnx-cache-strategy        # 영문 kebab-case. 폴더명과 동일하게
title: "onnx 모델 캐시 전략 결정"
status: open                   # open | resolved | archived
created: 2026-06-29
updated: 2026-06-29
owner: claude-code             # 네 agent.id
---

## 문제 정의
무엇을 결정해야 하는지 한두 문단으로. (필수·최상단)

## 후보 해결 방안
### 방안 A — 제목 {#opt-a}
- 장점 / 단점 / 비용

## 토의 / 메모
<!-- oculpm:discussion-log begin v1 -->
| 시각 | 작성자 | 내용 |
|---|---|---|
| 2026-06-29T14:03:00+09:00 | claude-code | A 가 비용이 낮음 |
<!-- oculpm:discussion-log end -->

## 결론
채택안 + 근거. (status 를 resolved 로)

## 다음 단계
- [ ] 실행할 일 {#next-1}
```

## 규칙

1. `## 문제 정의` 를 **먼저** 채운다 (필수). 정의 없는 토의는 만들지 말 것.
2. 후보안은 `### 제목 {#opt-id}`, 다음 단계는 `- [ ] 내용 {#next-id}` — 안정 id 를 한 줄 끝에 (플래너 항목과 동일: 둘째 줄로 넘기지 말 것).
3. 토의 발언은 managed block(`<!-- oculpm:discussion-log … -->`) 표에 **한 줄 append**: `| <ISO 시각+offset> | <네 agent.id> | <내용> |`. 기존 행 수정 금지.
4. 결론이 서면 `## 결론` 을 쓰고 frontmatter `status` 를 `resolved` 로 (사용자가 플래너로 승격한다).

## 금지

- **진척(progress)을 추적하지 말 것** — 그건 플래너의 일.
- 실행 기록은 일지에 — 문제 해결 문서에 실행 로그를 쌓지 말 것.
- `resolved`/`archived` 문서 수정 금지 (사용자가 닫은 것).
- secrets / API key 포함 금지.
