---
schema_version: 1
type: chore
slug: tag-push-without-all-tags
status: done
created_at: 2026-08-13T00:44:00+09:00
session_id: "manual-20260813-004400"
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
difficulty: low
files_touched:
  - path: docs/RELEASE.md
    op: update
related: []
tags: [release, git, tags, ci]
---

[x] 릴리스 태그 푸시에서 `--tags` 를 걷어냈다 — 옛 태그 하나가 빌드 전체를 막는다

## 배경

v2.9.0 태그를 밀었는데 `release.yml` 이 돌지 않았다. 태그 자체는 원격에 올라가 있었다.

`git push origin main --tags` 가 옛 태그 6개(v1.6.0 · v1.6.1 · v1.7.0 · v1.8.0 · v1.8.1 · v1.9.0)에서 `already exists` 로 거부되며 **푸시 전체가 실패**했고, 그 안에 섞여 있던 v2.9.0 의 push 이벤트도 함께 묻혔다. 태그는 원격에 남았는데 워크플로만 안 돈, 진단하기 어려운 상태가 됐다. 태그를 지웠다 단독으로 다시 밀어 그 자리에서는 해결했다.

## 원인

로컬의 그 6개 태그가 **main 에 없는 커밋**을 가리키고 있었다. 히스토리 재작성 때 떨어져 나간 것들이다:

```
v1.6.0  로컬 1ecc60443 (main 에 없음)  원격 6876fe915 (main 위)
v1.9.0  로컬 98632992a (main 에 없음)  원격 159d8963c (main 위)
```

둘 다 커밋 제목은 `chore(release): v1.6.0` 로 같다 — 같은 릴리스의 재작성 전/후 쌍이다. 실제로 배포된 것은 원격 쪽이므로 원격이 정본이다.

## 무엇을 했나

1. `git fetch --tags --force --prune-tags origin` — 로컬 태그를 원격 기준으로 정렬. 태그 10개가 갱신됐고, `git push --dry-run --tags` 가 이제 통과한다.
2. `docs/RELEASE.md` §5 — `git push origin main --tags` 를 **두 줄로 분리**했다. 태그를 하나만 밀면 옛 태그의 상태와 무관해져 이 함정 자체가 사라진다.
3. 같은 문서 §6 — 확인 항목의 첫 줄을 "run 이 실제로 떴는지" 로 바꾸고, 안 떴을 때의 복구(태그 삭제 후 재푸시)와 에셋 4개 확인을 명시했다.

## 판단

**둘 다 했다.** `fetch --force` 만 하면 지금 저장소는 깨끗해지지만 다른 기여자·다른 머신에서 재발한다. 체크리스트만 고치면 이미 어긋난 로컬은 그대로다. 한쪽만으로는 닫히지 않는 구멍이다.

`--prune-tags` 를 같이 준 이유는 원격에서 지워진 태그가 로컬에 남아 있으면 다음 `--tags` 푸시에서 똑같은 거부를 만들기 때문이다. 다만 체크리스트가 `--tags` 를 더 이상 쓰지 않으므로 이건 보조 안전장치다.

## 검증

- 6개 태그가 원격과 일치하는 것을 재확인.
- `git push --dry-run --tags origin` → `Everything up-to-date`, exit 0.
