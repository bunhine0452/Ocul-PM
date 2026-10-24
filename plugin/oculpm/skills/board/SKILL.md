---
description: 활성 플랜을 claude.ai 비공개 아티팩트 보드로 발행·동기화 — 폰·다른 기기에서 진행 보기
---

# /oculpm:board

이 프로젝트의 활성 플랜을 claude.ai 아티팩트 보드 한 장에 비춘다. 보드는 **읽기
전용**이고 원본은 `.oculpm/planner/` 다. 문서는 앱 바이너리가 만들고(마스킹 포함),
너는 파일 경로만 넘긴다 — 플랜 문구를 손으로 옮겨 적지 말 것.

1. `.oculpm/` 이 없으면 "ocul-pm 추적 프로젝트가 아닙니다" 라고 답하고 끝낸다.
   `Artifact`·`ArtifactData` 도구가 없으면(claude.ai 로그인이 아닌 세션) 그 사실을
   말하고 끝낸다.
2. 문서를 낸다 (출력 폴더는 세션 스크래치패드 아래, 없으면 `mktemp -d`):
   `"${CLAUDE_PLUGIN_ROOT}/bin/oculpm-mcp" board --root "$PWD" --out <폴더>`
   변수가 안 풀렸으면 `ls ~/.claude/plugins/cache/*/oculpm/*/bin/oculpm-mcp` 의
   마지막 줄을 쓴다. `unknown argument 'board'` 면 "ocul-pm 앱을 최신으로
   업데이트하세요" 라고 답하고 끝낸다. stdout JSON 의 `title`·`page`·`plans`·`files`
   를 쓴다.
3. 보드를 찾는다: `Artifact` `action: "list"` 에서 제목이 `title` 과 같은 것.
   - **없으면** `page` 파일을 발행한다 — `icon: "checklist"`, `description` 은
     "<프로젝트> 의 활성 플랜과 항목 상태 — /oculpm:board 로 동기화되는 읽기 전용 보드.",
     `capabilities` 는 정확히
     `{"db":{"rules":[{"path":"plans","read":"view","write":"owner"},{"path":"meta","read":"view","write":"owner"}]}}`.
   - **있으면** 페이지는 다시 발행하지 않는다.
4. 동기화한다: `ArtifactData` `list` 로 `plans` 컬렉션의 현재 문서와 `version`
   을 읽고, `batch` 한 번으로 — `files` 의 각 항목을 `op: "set"` + `file_path`
   로(이미 있는 문서는 그 `version` 을 `if_version` 으로), 그리고 `plans` 목록에
   없는 옛 문서는 `op: "delete"` 로. `meta/board` 도 같은 batch 에 넣는다
   (있으면 `get` 으로 version 을 읽어 둔다). 50건을 넘으면 나눠 보낸다.
5. 보드 링크와 "플랜 N개를 올렸습니다" 한 줄로 보고한다. 보드는
   비공개로 만들어지며 공유는 사용자가 페이지의 Share 메뉴에서 정한다고 덧붙인다.
