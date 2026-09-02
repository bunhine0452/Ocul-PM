---
schema_version: 1
type: chore
slug: producthunt-badge-readme
status: done
difficulty: verylow
created_at: 2026-09-02T09:50:00+09:00
session_id: manual-20260902-095001
agent:
  id: claude-code
  version: Opus 5 (1M context)
language: ko
verified_by_user: false
files_touched:
  - path: README.md
    op: update
  - path: README.en.md
    op: update
related: []
tags: [readme, producthunt, badge]
---

[x] README ko/en 에 Product Hunt featured 배지 추가

Product Hunt 에 Ocul-PM 이 등재되면서 받은 featured 임베드 배지를 저장소 첫 화면에
붙였다. 위치는 배지 행(CI·release·downloads·platform·Tauri·MIT·Ko-fi) 바로 아래,
링크 줄 위 — 방패 배지들과 크기(250×54)가 달라 같은 줄에 섞으면 정렬이 깨지므로
한 줄을 따로 뒀다. 한국어·영문 README 양쪽 같은 자리에 동일하게 넣었다.

배지 HTML 은 Product Hunt 가 준 임베드 그대로다(`post_id=1237239`, `theme=light`).
GitHub 마크다운은 `<a target>`·`<img width/height>` 를 허용하므로 raw HTML 로 둔다.
다크 모드용 `theme=dark` 스왑(`<picture>`)은 넣지 않았다 — 공식 임베드가 light 단일이고
확인하지 않은 파라미터로 깨진 이미지를 만드는 쪽이 더 나쁘다.

## 검증

`sed -n '12,20p'` 로 양쪽 README 의 삽입 위치를 눈으로 확인했다(Ko-fi 배지 다음 줄,
링크 줄 앞, 앞뒤 빈 줄 유지). 커밋 b84b7aa 로 main 에 푸시 — GitHub 렌더 화면에서
배지가 뜨는지는 사용자 육안 확인 대기.

## 메모

대응하는 활성 플래너 항목이 없어(`first-run-and-english-landing` 은 첫 실행·영문 랜딩
범위) 플래너는 갱신하지 않았다.
