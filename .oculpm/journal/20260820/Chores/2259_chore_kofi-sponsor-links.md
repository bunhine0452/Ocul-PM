---
schema_version: 1
type: chore
slug: "kofi-sponsor-links"
status: done
difficulty: verylow
created_at: "2026-08-20T22:59:00+09:00"
session_id: "manual-20260820-225924"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: ".github/FUNDING.yml"
    op: create
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
  - path: "landing/index.html"
    op: update
related: []
tags: ["docs", "landing", "sponsor", "kofi", "chore"]
---

[x] Ko-fi 후원 링크를 README·랜딩·GitHub Sponsor 버튼에 심음

## 배경

후원 계정(`ko-fi.com/beachcombers`)이 새로 생겼고, 사람들이 실제로 지나가는 세 표면 — 저장소 README, oculpm.com, GitHub 저장소 헤더 — 어디에도 링크가 없었다.

## 변경 요약

노출 강도는 **은은하게** 로 정했다. 이 제품의 README·랜딩은 "가입도, 설정도, 비용도 없습니다" 를 반복해서 말하는 톤이라, 후원 블록이 다운로드 CTA 옆에 서면 그 문장의 신뢰를 갉아먹는다. 그래서 배너·전용 섹션 대신 이미 링크가 모여 있는 자리에만 한 칸씩 넣었다.

- **`.github/FUNDING.yml`** (신규) — `ko_fi: beachcombers` 한 줄. 저장소 상단과 이슈 사이드바에 GitHub 기본 Sponsor 버튼이 뜬다. README 를 건드리지 않고도 노출되는 유일한 표면이라 비용 대비 효과가 가장 좋다.
- **`README.md` / `README.en.md`** — 상단 배지 줄 끝에 Ko-fi 배지(shields.io, Ko-fi 브랜드색 `FF5E5B`) 하나. 한국어 쪽 라벨 「후원하기」는 퍼센트 인코딩(`%ED%9B%84...`)으로 넣어 렌더러를 안 탄다. 본문에는 「라이선스와 약속」 **바로 앞**에 짧은 후원 문단을 넣었다 — 순서가 중요하다. 부탁을 먼저 하고 곧바로 "후원해도, 하지 않아도 받는 기능은 똑같습니다" 로 받아, 아래의 영구 무료·MIT 약속이 그 부탁을 곧장 무해화한다.
- **`landing/index.html`** — 푸터 링크 줄에 「후원」 한 칸(`기업·제휴 문의` 다음, spacer 앞). nav 와 다운로드 CTA 는 건드리지 않았다.

`landing/plugin.html` 은 푸터 구조(`.foot`)가 index(`.footer`)와 아예 달라 링크 줄이 없다 — 억지로 끼우지 않고 뒀다.

## 검증

`git diff` 로 네 파일의 변경이 의도한 4줄+2문단인지 직접 확인했다. 배지 URL 의 퍼센트 인코딩은 디코드해서 「후원하기」가 나오는지 확인. 코드 변경이 없어 typecheck/test/lint 게이트에는 영향이 없다.

## 메모

랜딩은 git 연동이 없어 `cd landing && vercel --prod` 를 따로 돌려야 반영된다 — 아직 배포하지 않았다. FUNDING.yml 은 기본 브랜치에 푸시되어야 Sponsor 버튼이 뜬다.
