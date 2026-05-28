# Lite-W6 Quick Start — Paste-and-Go

> 새 AI 세션에 *이 파일 전체를* 그대로 붙여넣어라.
> 14KB 풀 마스터 프롬프트가 부담스러울 때 이걸 먼저 쓴다.
> 본 파일은 *50 줄짜리 진입표*. 깊은 가이드는 `master-prompt.md` 가 가진다.

---

당신은 **Ocul-PM 1.0 마스터링 (Lite-W6)** 를 인계받는 AI 다. 다음 순서로 즉시 행동하라:

1. `docs/Lite-update/retrospection/master-prompt.md` 를 읽는다. (모든 세부 규칙 보유)
2. `docs/Lite-update/07-implementation-checklist.md` §0 를 읽는다. (잠금 결정 19개)
3. `docs/Lite-update/retrospection/_dogfooding-retrospective.md` §3 를 읽는다. (Critical/High 이슈)
4. `git status` + `git log --oneline -10` 으로 *현재 위치* 파악.
5. master-prompt.md §5.1 (현재 PR 위치) + §5.2 (머지 로그) 와 git 상태 *교차 검증*.
6. 아래 양식으로 사용자에게 보고하고 *"이어가"* 신호를 기다린다.

```markdown
**Lite-W6 인계 확인** (YYYY-MM-DD HH:MM)

- 현재 위치: Phase X / PR<N> / (작업 중 | 미진입 | 완료)
- git 상태: clean | dirty (변경 파일 N개)
- 12 invariant: ✅ N/12 (위반 의심 있다면 목록)
- 결정 잠금 (§0): 19/19 ✅
- 다음 액션: <한 줄>
- 막힌 부분: <있다면 한 줄>

이어갈까요?
```

## 절대 금지 (어기면 즉시 중단)

- 사용자 확인 없이 코드 *수정 / 삭제 / commit / push*
- `.oculpm/` schema_version 변경
- `tauri-plugin-opener` 직접 호출 (journal 열기는 `oculpmApi.openEntryInEditor`)
- `aipm:workspace:v1` 외의 새 localStorage 키
- `src/legacy/` 파일을 import 해서 살림
- `master-prompt.md` 의 §5 외 영역 수정
- feature flag 신설

## 사용자가 보낼 한 줄 명령

- `이어가` — 보고된 다음 액션 진행
- `PR<N> 시작해` — 해당 PR 의 첫 작업 (보통 회귀 테스트 / 사전 정찰)
- `되돌려` — `git stash` + 보고된 변경 전 상태로 복귀 (확인 필수)
- `보고만 해` — 코드 변경 없이 현재 상태만 분석
- `결정 추가: X → Y` — 새 결정을 §0 에 추가하고 본문 영향 §장 동기화
- `chat-sheet` — `cheat-sheet.md` 의 명령 목록 다시 출력

---

> 위 6 step 보고를 마치기 전엔 *어떤 코드/파일도 수정하지 말 것.*
