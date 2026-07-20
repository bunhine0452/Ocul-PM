# 04. oculpm 플러그인 패키징 — 조사·골격 (PR-CI8)

> 상위 문서: [`00-master-plan.md`](00-master-plan.md) PR-CI8. 작성일 2026-07-20.
> attribution: claude-code (Fable 5). 골격 실물: 리포의 [`plugin/oculpm/`](../../plugin/oculpm/).

## 1. 조사 팩트 (2026-07-20, code.claude.com/docs plugins·plugins-reference·hooks·mcp 재검증)

| 사실 | 내용 |
|---|---|
| 디렉터리 규약 | `.claude-plugin/plugin.json` **만** 그 폴더에 — `hooks/`·`.mcp.json`·`skills/`·`commands/`·`agents/`·`bin/` 은 전부 **플러그인 루트** |
| plugin.json | 필수는 `name`(kebab) 하나. `hooks`/`mcpServers` 는 상대 경로(`./…`) 또는 인라인 오브젝트. `version` 을 안 쓰면 git SHA 가 버전 |
| 훅 형식 | settings.json 의 `{"hooks": {"Stop": [...]}}` 와 **동일 형태**를 `hooks/hooks.json` 에. 훅은 프로젝트 cwd 에서 돌고 `${CLAUDE_PROJECT_DIR}` 사용 가능 |
| 변수 확장 | `${CLAUDE_PLUGIN_ROOT}`(플러그인 설치 절대경로) · `${CLAUDE_PLUGIN_DATA}`(업데이트에도 남는 데이터 dir) · `${CLAUDE_PROJECT_DIR}` · `${ENV_VAR}` · `${user_config.KEY}` — MCP `command`/`args` 에서도 확장됨. 쉘 기본값 문법(`:-`)은 JSON 확장엔 없음 (훅 command 는 셸이라 가능) |
| MCP in 플러그인 | `.mcp.json` (stdio/http/sse/ws). **플러그인 밖 절대경로 바이너리 참조 가능** — .app 번들 속 사이드카를 가리켜도 된다 |
| 설치 채널 | 개발 `claude --plugin-dir <dir>`(.zip 도 가능) · 마켓플레이스 `claude plugin install <name>@<marketplace>` · `~/.claude/skills/<name>/` 자동 로드. git URL 직설치는 없음(마켓플레이스 경유) |
| 스코프 | user(전 프로젝트) / project(`.claude/settings.json`, 팀 공유·신뢰 다이얼로그) / local(비공유). `defaultEnabled: false` 로 꺼진 채 배포 가능 |

## 2. 결정

1. **훅은 `.oculpm/` 존재 가드** — 플러그인은 user 스코프 설치가 자연스러운데, CI0 의 무조건 append 를 그대로 쓰면 ocul-pm 비추적 저장소에도 `.oculpm/hooks/` 가 생긴다. 커맨드를 `[ -d …/.oculpm ] && … || true` 로 감싸 추적 프로젝트에서만 동작시킨다 (설정 파일 방식 CI0 은 프로젝트별 옵인이라 가드 불필요 — 두 방식의 차이는 스코프뿐).
2. **MCP 는 `--root "${CLAUDE_PROJECT_DIR}"`** — CI2 의 프로젝트별 `.mcp.json` 은 절대경로 root 를 박아 머신 종속이었는데, 플러그인의 변수 확장 덕에 **유저 스코프 서버 하나가 모든 프로젝트를 커버**한다. 이것이 플러그인 배포의 실질 이득.
3. **바이너리 경로 = .app 번들 절대경로** (`/Applications/ocul-pm.app/Contents/MacOS/oculpm-mcp`) — #ci2-sidecar-bundle 완료 후의 릴리스 빌드 기준. 개발은 `--plugin-dir` + 경로 수정으로. (후속 아이디어: 앱이 설치 시 `${CLAUDE_PLUGIN_DATA}` 에 심볼릭 링크를 놓거나, 플러그인 `bin/` 셔틀 스크립트로 앱 위치를 탐색.)
4. **중복 설치 캐비앗 문서화** — 앱 훅 토글과 플러그인을 동시에 켜면 인박스에 이벤트가 2배 적재된다 (세션 집합 연산이라 정확성은 유지 — `claude_hooks.rs` 의 open-set 이 중복 insert 에 안전). README 에 "하나만" 명시.
5. **배포 채널** — 골격 검증은 `--plugin-dir`. 공개 배포는 마켓플레이스 리포(`.claude-plugin/marketplace.json`) 신설이 필요해 후속으로 미룬다 (릴리스 파이프라인과 함께).

## 3. 골격 (커밋됨)

```
plugin/oculpm/
├── .claude-plugin/plugin.json   # name/hooks/mcpServers 매니페스트
├── hooks/hooks.json             # SessionStart·Stop·SessionEnd — 가드된 인박스 append
├── .mcp.json                    # oculpm stdio 서버 (--root ${CLAUDE_PROJECT_DIR})
└── README.md                    # 설치·경로 캐비앗·중복 설치 주의
```

수용 기준 대비: 플러그인 설치(= `--plugin-dir`) 하나로 CI0 훅 + CI2 MCP 가 수동 설정 없이 구성된다 — 프로토타입 수준 충족. 실기기 검증(플러그인 로드→인박스 적재→도구 왕복)은 sidecar 번들이 선행 조건이라 #phase-c-runtime-verify 로 묶었다.

## 4. 잔여

- [ ] #ci2-sidecar-bundle 후 릴리스 빌드에서 `--plugin-dir` 실검증 (훅 3이벤트 적재 + `plan_status` 왕복)
- [ ] 마켓플레이스 리포/항목 신설 + `claude plugin install oculpm@…` 경로
- [ ] 앱 설정 UI 에 "플러그인로 설치" 안내 (기존 훅/MCP 블록과의 택일 UX)
- [ ] dev 편의: 바이너리 경로 자동 탐색 셔틀 (`bin/` 스크립트 또는 user_config)
