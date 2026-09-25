# 릴리스 체크리스트

릴리스는 태그를 미는 것으로 끝나지 않습니다. **변경 내용이 아래 다섯 면에 전부 적혀야** 완결입니다 — 서로 다른 경로로 나가기 때문에 하나씩 빠지기 쉽습니다 (실제로 v2.8.1~2.8.3 은 랜딩 배포가 빠져 라이브가 v2.8.0 에 멈춰 있었고, README 는 v2.7.0 에서 v2.8.5 까지 갱신되지 않았습니다).

## 0. 커밋 전 게이트

```bash
pnpm typecheck && pnpm test && pnpm lint && pnpm build
cd src-tauri && cargo test      # bindings.ts 재생성 포함
```

네 개 모두 exit 0 인지 **직접 확인**합니다 (통과했겠거니 하지 않기).

이 게이트는 `.github/workflows/ci.yml` 이 PR 과 main 푸시에서도 자동으로 돌립니다
(프런트 잡 = typecheck·test·lint·build·확장 vitest / Rust 잡 = `cargo test --locked` + bindings 신선도 / 의존성 잡 = cargo-deny).
**태그를 밀기 전에 그 커밋의 CI 가 그린인지 확인하세요** — release.yml 은 테스트를 돌리지
않고 번들만 굽습니다. 다만 사람이 잊어도 이제 기계가 막습니다: release.yml 의 첫 잡 `gate` 가
**태그가 가리키는 정확히 그 커밋**의 CI run 을 API 로 찾아 `conclusion == success` 일 때만
빌드로 넘어갑니다. 태그를 커밋 직후에 밀어 CI 가 아직 도는 중이면 60초 간격으로 최대 45분
기다렸다가 판정하고, `failure`·`cancelled`·`timed_out` 은 물론 **CI run 이 아예 없는 커밋**
(`[skip ci]`, main 에 없는 커밋)도 차단합니다. 이 게이트가 없던 v3.1.1 은 cargo-deny 잡이
붉은 커밋에서 그대로 릴리스됐습니다.

**Windows·Linux 는 이 게이트가 보지 않습니다** (크로스플랫폼 D2). `portability.yml`(Rust·프런트·사이드카·
번들·설치 스모크)과 `e2e.yml`(실제 앱 E2E)은 main push 에서도 돌지만(문서·일지만 바뀐 push 는 건너뜀)
**미리보기**입니다 — 붉어도 macOS 릴리스는 나갑니다. 태그 전에 그 커밋의 두 run 을 한 번 보세요: 붉으면
이번 릴리스에서 그 플랫폼이 빠질 가능성이 높습니다(실제로 싣느냐는 release.yml 이 태그 커밋에서 다시
돌려 정합니다 — §5).

```bash
gh run list --commit "$(git rev-parse HEAD)" --json workflowName,conclusion,url \
  --jq '.[] | "\(.workflowName)\t\(.conclusion)\t\(.url)"'
```

게이트에 걸렸을 때: CI 가 실제로 붉으면 고쳐서 새 커밋 → 새 버전으로 다시 갑니다(태그를 옮기지
않습니다). 같은 브랜치에 연속 푸시해 concurrency 로 **취소된** run 이면 그 run 을 `gh run rerun
<id>` 로 다시 돌려 초록을 만든 뒤 Release run 을 re-run 합니다(`gh run rerun <release run id>` —
태그를 다시 밀 필요 없습니다).

## 1. 버전 — 6파일 (같은 값)

```bash
# 6파일 + 랜딩 ko/en 각 6곳을 한 번에 — 자리 수가 어긋나면 아무것도 안 쓰고 멈춥니다
node scripts/bump-version.mjs 2.48.0 [--title-ko "…" --title-en "…"] [--dry-run]
```

아래 표와 §4 의 6곳은 이 스크립트가 고치는 자리의 목록입니다 (손으로 고칠 때의 대조표이자, 자리가 늘면 스크립트와 `src/__tests__/bump_version.test.ts` 도 함께 늘립니다). 변경 이력 `<li>`·bento·FAQ·CHANGELOG·README 는 사람이 씁니다.

| 파일 | 위치 |
| --- | --- |
| `package.json` | `"version"` |
| `src-tauri/tauri.conf.json` | `"version"` |
| `src-tauri/Cargo.toml` | `version` |
| `plugin/oculpm/.claude-plugin/plugin.json` | `"version"` |
| `plugin/oculpm-codex/.codex-plugin/plugin.json` | `"version"` |
| `.claude-plugin/marketplace.json` | `plugins[0].version` |

아래 세 개는 `cargo test --test plugin_manifest` 가 앱 버전과의 동기를 강제합니다 (v2.10.3 에서 이 문서가 3파일만 적어 두어 §0 게이트가 두 번 붉게 났고, v2.40.0 에서는 v2.39.0 에 생긴 **Codex 플러그인**이 빠져 있었습니다 — 표는 파일이 늘 때 함께 늘려야 합니다). 순서는 **버전 6곳 → 게이트** 가 편합니다.

`Cargo.toml` 을 고치면 `Cargo.lock` 도 함께 바뀝니다 — `cargo test` 가 갱신해 주므로 §0 게이트를 돌린 뒤 **둘 다** 커밋합니다.

## 2. CHANGELOG.md — 맨 위에 `## vX.Y.Z` 섹션

**이것이 GitHub 릴리스 노트의 「What's new」 의 유일한 소스입니다.** `.github/workflows/release.yml` 이 태그와 같은 헤더의 본문만 뽑아(`.github/scripts/release/notes.mjs section` — 예전 awk 와 같은 규칙) 릴리스 본문에 넣고, publish 단계가 그 아래에 **실제로 올라간 자산**으로 Downloads 표 · OS 별 설치 안내 · 빠진 플랫폼 줄을 붙입니다(`notes.mjs body`).

헤더가 태그와 정확히 일치해야 하고(`## v2.8.5` ↔ 태그 `v2.8.5`), 어긋나면 「What's new」 가 빈 채로 나갑니다.

**다음 릴리스에 실릴 것은 `## Unreleased` 절에 미리 모아 둘 수 있습니다** — 버전 번호 없이 맨 위에 둡니다. 릴리스 때 그 제목을 `## vX.Y.Z` 로 바꾸면 끝입니다. `Unreleased` 는 태그와 맞지 않아 진짜 릴리스 본문에는 들어가지 않고, 랜딩의 `/changelog` 생성(`splitReleases`)도 버전 제목만 읽어 건너뜁니다. 드라이런(§8)은 이 절을 본문으로 씁니다. 톤은 기존 항목을 표본으로 — 기능 나열이 아니라 **사용자가 겪던 증상 → 무엇이 바뀌었나** 를 굵게 시작하는 서술형으로, 내부 구현 용어 대신 화면에서 보이는 말로.

### 2-1. VS Code 확장 (`extension/`) — 릴리스 노트는 여기 한 곳

확장은 **별도 CHANGELOG 를 갖지 않습니다.** `extension/CHANGELOG.md` 는 이 파일을 가리키는 한 줄뿐이고, `extension/LICENSE` 는 루트 `LICENSE` 의 복사본(마켓 리스팅이 패키지 안의 파일을 요구해서)입니다. 확장에 사용자가 보는 변경이 있으면 그 릴리스의 `## vX.Y.Z` 섹션 **안에 `### 확장` 소절**을 두고 거기에 적습니다 — 앱과 확장이 같은 `.oculpm` 규격을 공유하므로 같은 커밋·같은 노트로 움직입니다. `extension/README.md` 는 마켓 리스팅 본문(영어)이라 기능이 늘면 그 파일도 같이 고칩니다. #### 확장 게시 절차 (태그 `ext-v*`)

확장은 앱과 **별도 태그**로 나갑니다 — `extension/package.json` 의 `version` 을 올리고 `ext-v<그 버전>` 태그를 밀면 `.github/workflows/extension-release.yml` 이 패키징(dry-run 과 같은 잡) → **GitHub Release 에 .vsix 첨부(항상)** → Open VSX → VS Marketplace 순으로 갑니다. 마켓 토큰이 없으면 마켓 단계는 **건너뛰고**(실패 아님) GitHub Release 만 납니다 — 토큰을 넣은 뒤 그 run 을 re-run 하면 게시됩니다. 태그와 `package.json` 버전이 다르면 잡이 멈춥니다(마켓은 같은 버전 재게시를 막아 되돌릴 수 없기 때문). 앱 릴리스(`v*`)는 `.vsix` 를 릴리스 자산에도 첨부합니다 — 마켓이 막힌 환경은 `code --install-extension ocul-pm-<ver>.vsix`.

```bash
cd extension && npm version 0.1.0 --no-git-tag-version   # package.json 만
git add extension/package.json && git commit -m "release(extension): v0.1.0"
git tag ext-v0.1.0 && git push origin main ext-v0.1.0
```

**한 번만 하는 수동 단계** (토큰은 GitHub secret 으로 — 저장소에 적지 않습니다):

- [ ] **Open VSX** — [open-vsx.org](https://open-vsx.org) 에 GitHub 로 로그인 → Publisher Agreement 서명 → Settings → Access Tokens 에서 토큰 생성 → 네임스페이스 `oculpm` 을 **먼저** 만든다: `npx ovsx create-namespace oculpm -p <token>` (네임스페이스가 없으면 첫 게시가 실패한다). 토큰을 `gh secret set OPEN_VSX_TOKEN`.
- [ ] **VS Marketplace** — [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage) 에서 publisher `oculpm` 생성(Microsoft 계정) → [dev.azure.com](https://dev.azure.com) 에서 PAT 생성: Organization = **All accessible organizations**, Scopes = **Marketplace → Manage**. 토큰을 `gh secret set VSCE_PAT`. 만료(최대 1년)를 캘린더에.
- [ ] 두 토큰이 들어간 뒤 `workflow_dispatch` 로 `Extension` 워크플로를 한 번 돌려 패키징 잡이 초록인지 본다(게시는 태그에서만).
- [ ] 첫 게시 뒤 마켓 두 곳의 리스팅(README·아이콘·`repository` 링크)을 눈으로 확인한다.

Open VSX 는 Cursor·VSCodium·code-server 가 쓰는 레지스트리라 **둘 다** 올려야 "VS Code 계열 전부"가 됩니다. MS 마켓은 MS 제품 밖 사용을 ToS 로 막으므로 포크 사용자는 Open VSX 판만 받습니다.

## 3. README.md · README.en.md — **양쪽 다**

- 최상단 하이라이트 섹션(`## 🚀 vX.Y — …`)에 이번 변경 반영. 섹션이 계속 쌓이지 않도록 오래된 것은 묶어 압축합니다.
- 새 화면·설정·에이전트가 생겼다면 **화면 구성 / Screens**, **지원 에이전트**, 단축키 문단까지 함께 고칩니다.
- 한국어만 고치고 영어를 두고 오는 실수가 가장 잦습니다. 두 파일은 항상 같은 사실을 말해야 합니다.

## 4. landing/ — **ko·en 각각** 버전 문자열 6곳 + 생성물 재빌드 + 새 기능 표면

버전 문자열: `softwareVersion`(JSON-LD) · `nav-ver` 배지 · `ap-new` NEW 배지 · **다운로드 버튼 2곳**(히어로와 CTA — 둘 다 `vX.Y.Z 받기`) · CTA `eyebrow`. 변경사항 `<li>` 는 새로 **추가**하는 것이라 이 수에 들지 않습니다 (v2.15.0 에서 이 문서가 5곳이라고 적어 둔 탓에 버튼 하나를 놓칠 뻔했습니다 — 아래 grep 이 실제 심판입니다).

**영문 랜딩(`landing/en/index.html`)도 같은 6곳을 갖습니다.** 이 문서가 오래 `landing/index.html` 만 적어 두어, 영문 페이지가 옛 버전에 멈출 뻔했습니다 (v2.40.0 에서 확인). `build.mjs` 는 위키·changelog·themes·privacy 만 굽고 **en/index.html 은 손으로 고치는 면**입니다.

```bash
# 이전 버전 문자열이 남지 않았는지 전수 확인 — 변경 이력 <li> 만 남는 것이 정상
grep -n "2\.8\.5" landing/index.html landing/en/index.html landing/plugin.html landing/en/plugin.html
```

`landing/plugin.html` **과 `landing/en/plugin.html`** 의 `nav-ver` 배지도 매 릴리스 함께 올립니다 (v2.45.0 에서 이 문서가 한국어 쪽만 적어 두어 영문 플러그인 페이지가 옛 버전에 멈출 뻔했습니다 — 아래 grep 에 두 파일을 모두 넣어 두었습니다).

### 4-1. 생성물 재빌드 (한 줄)

```bash
node landing/wiki-src/build.mjs
```

이 한 줄이 위키(`wiki/**`) · **변경 이력**(`changelog.html`) · **테마 갤러리**(`themes.html`) · **개인정보**(`privacy.html`) · `sitemap.xml` 을 전부 다시 굽습니다. `CHANGELOG.md` 를 §2 에서 고쳤으므로 **이 단계는 매 릴리스 필수**입니다 — 빼먹으면 웹의 변경 이력만 옛 버전에 멈춥니다. `src/__tests__/landing_pages.test.ts` 가 「CHANGELOG 맨 위 섹션 == `package.json` 버전」과 「모든 릴리스가 changelog.html 에 앵커로 있는가」를 함께 재므로, 잊으면 §0 게이트에서 붉게 납니다.

### 4-2. 손으로 고치는 면

기능이 추가된 릴리스라면 여기에 더해:

- JSON-LD `featureList` 에 한 줄
- 눈에 띄는 기능이면 FAQ 항목 (SEO 표면)
- 벤토 그리드 셀 — 그리드는 6칸이므로 `c-span2` 3개 = 한 줄로 맞춰 넣습니다
- 플러그인 커맨드·MCP 도구·스킬이 바뀌었으면 `landing/plugin.html` 도. **버전 배지**(`v2.30.0`)가 그 페이지에 있고 `cargo test --test plugin_manifest` 가 앱 버전과의 동기를 강제합니다 (제3자 스킬 카탈로그·핀 SHA 는 `plugin_docs_sync.test.ts`)
- 테마를 `landing/themes/` 에 더했다면 4-1 재빌드로 갤러리에 실립니다 (`landing_themes.test.ts` 가 스키마·색 값·본문 대비를 검사합니다)
- 영문 랜딩(`landing/en/index.html`)의 대응 항목 — 한국어만 고치고 두고 오기 쉽습니다
- **기존 FAQ 가 거짓이 되지 않는지** 확인합니다. 새 항목을 더하는 것보다 이쪽이 먼저입니다 — v2.15.0 에서 「자동완성이 필요하면 외부 에디터로」라고 적힌 답변이 바로 그 자동완성을 넣는 릴리스와 충돌했습니다. 같은 문장이 JSON-LD 와 `<details>` **두 곳**에 있으니 둘 다 고칩니다

## 5. 커밋 → 태그 → 랜딩 배포

```bash
git add <명시 경로만>          # git add -A 금지 (병렬 세션 WIP 를 쓸어 담은 사고 전례)
git commit -m "release: vX.Y.Z — <한 줄 요약>"
git tag vX.Y.Z
git push origin main           # 커밋 먼저
git push origin vX.Y.Z         # 태그는 단독으로 — release.yml 이 게이트→빌드·서명→검증→공개 (로컬 빌드 금지)
cd landing && vercel --prod --yes               # 랜딩은 git 연동이 없어 push 로 안 나갑니다
                                               # (§4-1 재빌드가 먼저 — 배포는 디스크에 있는 것만 올립니다)
```

태그를 밀면 release.yml 은 이 순서로 갑니다 — **릴리스는 draft 로 만들어졌다가 검증을 전부
통과한 마지막 단계에서만 공개됩니다**:

```
meta ─ gate ─┬─ macos ───────────────────────────────────┐
             └─ bundle(windows·linux) ─┬─ smoke(windows·linux) ─┼─ publish
                                       └─ e2e(windows·linux) ───┘
```

1. `meta` — 태그 모양(`vX.Y.Z`) · `tauri.conf.json` 의 version == 태그(§1 을 빼먹었으면 한 시간 빌드
   전에 여기서 멈춥니다) · latest.json 병합 스크립트의 픽스처 테스트(`node --test
   .github/scripts/release/release.test.mjs`)
2. `gate` — 태그 커밋의 CI(ci.yml) `conclusion == success` (§0). Windows·Linux 워크플로는 보지 않습니다
3. `macos` — 핀된 툴체인(`rust-toolchain.toml`, ci.yml 과 같은 단계)으로 번들 → tauri-action 이
   **draft** 릴리스에 `.dmg` · `.app.tar.gz` · `.sig` · `latest.json` 업로드, 이어서
   - 서명·공증 검증 — `.app` 에 `codesign --verify --deep --strict` · `codesign -dvv` 의 Authority 가
     `Developer ID Application` · `spctl -a -t exec` 가 `accepted` + `source=Notarized Developer ID` ·
     `xcrun stapler validate`. `.dmg` 는 서명(Developer ID)만 단언하고 공증·스테이플은 로그만 남깁니다 —
     tauri-bundler 가 `.dmg` 는 공증하지 않기 때문입니다(v3.1.1 실측: `spctl -t open` 이
     `Unnotarized Developer ID`). Gatekeeper 는 마운트한 `.app` 의 스테이플로 판정하므로 사용자에겐
     문제없습니다.
   - 업데이터 검증 — 디스크의 `.app.tar.gz` 옆에 `.sig` 가 있고, draft 자산에 `.dmg` · `.app.tar.gz` ·
     `.sig` · `latest.json` 이 다 있으며, `latest.json` 의 `version` 이 태그와 같고 각 플랫폼 `url` 이
     `releases/download/vX.Y.Z/` 아래의 **실제 자산**을 가리키는지(draft 의 `untagged-…` URL 이
     남지 않았는지), `signature` 가 base64 한 덩어리인지, macOS 키(`darwin-aarch64` ·
     `darwin-aarch64-app`)가 다 있는지 — 규칙은 `.github/scripts/release/latest-json.mjs verify` 한 곳
   - `.vsix` 패키징·첨부 (draft 에 올라갑니다)
4. `bundle` — (**비-mac 공개 스위치가 켜졌을 때만**, §5-1) **같은 태그 커밋에서** Windows(`windows-latest`, NSIS) · Linux(`ubuntu-22.04`, AppImage + deb)
   번들. Windows 는 `tauri build` 전에 VC++ 재배포를 받아 검증합니다(`.github/scripts/fetch-vcredist.ps1`).
   업데이터 서명은 macOS 와 같은 `TAURI_PRIVATE_KEY`. 산출물은 **워크플로 아티팩트로만** 넘깁니다 — 아직
   릴리스 자산이 아닙니다. 파일 이름·`.sig`·플랫폼 설정 병합(msi·rpm 없음)과, AppImage 실행 파일에
   번들러가 굽는 설치 형식 표식(`__TAURI_BUNDLE_TYPE_VAR_APP` — 업데이터가 이것으로 latest.json 키를
   고릅니다)을 단언합니다
5. `smoke` · `e2e` — 번들과 **다른 깨끗한 러너**에서: 설치 스모크(L-PKG 의 `.github/scripts/install-smoke-*`,
   portability.yml 과 같은 인자)와 **설치본 E2E**(설치 파일을 깐 실행 파일로 `e2e/run.mjs --app`; Linux 는
   deb 를 깔아 시스템 WebKitGTK 로). 통과하면 검증한 파일의 SHA-256 을 표식으로 남깁니다
6. `publish` — **macOS 가 초록이면 반드시 돕니다**(비-mac 이 실패·timeout·건너뜀이어도):
   - 판정: 번들 + 스모크 표식 + E2E 표식 + 해시 일치인 플랫폼만 「통과」
   - macOS 가 올린 latest.json 을 baseline 으로 검증 → 통과한 플랫폼의 자산 업로드(앞 시도에서 올라갔다
     이번에 떨어진 것은 삭제) → 플랫폼을 하나씩 더하며 병합·검증(병합에서 걸린 플랫폼만 떨어짐) →
     latest.json 업로드 → **다시 받아** 최종 검증(비-mac 집합이 정확히 통과한 것 · macOS 항목이 baseline 과
     한 글자도 같음 · 떨어진 플랫폼의 자산이 남지 않음)
   - 본문을 **실제로 올라간 자산으로** 다시 씁니다(`notes.mjs` — 「What's new」 는 CHANGELOG, Downloads 표 ·
     OS 별 설치 안내 · 빠진 플랫폼과 떨어진 단계)
   - `gh release edit vX.Y.Z --draft=false --latest` — 여기서 비로소 `releases/latest` 가 됩니다.
     `--latest` 는 처음 공개할 때, 이 버전이 지금 latest 보다 새로울 때만 줍니다
   - 비-mac 이 하나라도 빠졌으면 마지막 단계(「비-mac 빠짐 알림」)가 run 을 붉힙니다 — 공개는 끝났고
     macOS 는 정상입니다(§6-2)

latest.json 에 싣는 키: `darwin-aarch64` · `darwin-aarch64-app`(tauri-action) · `windows-x86_64` ·
`windows-x86_64-nsis` · `linux-x86_64-appimage`. **맨 `linux-x86_64` 와 deb 키는 싣지 않습니다** —
업데이터(tauri-plugin-updater 2.10.1)는 `{os}-{arch}-{설치 형식}` 다음 `{os}-{arch}` 를 찾으므로, 맨 키가
있으면 deb 로 깐 앱이 AppImage 를 받아 설치에서 거절됩니다. deb 는 패키지 관리자로 올립니다.
업데이터는 **버전이 같아도 자기 키부터 찾기** 때문에(updater.rs `check` 가 버전 비교와 무관하게
`get_urls` 를 부른다), deb 로 깐 앱과 이번 릴리스에서 빠진 OS 의 앱은 확인할 때마다 「대상 없음」
오류로 끝납니다 — 앱 시작 때의 자동 확인은 조용히 넘어가고, 설정 → 업데이트에서 직접 확인하면 그
오류 문장이 보입니다. deb 를 알아보고 패키지 관리자 안내로 바꾸는 것은 앱 쪽 후속입니다.

macOS 단계(3)가 하나라도 붉으면 **publish 가 돌지 않고 릴리스는 draft 로 남습니다.** draft 는
`releases/latest` 가 아니라 앱 내 업데이터도 랜딩의 다운로드 링크도 그것을 보지 못합니다 — 깨진
빌드가 사용자에게 닿지 않는 것이 이 구조의 목적입니다. 대가는 시간: macOS 공개가 비-mac 잡이 끝날
때까지 기다립니다(Windows 콜드 빌드 때문에 보통 태그 뒤 1시간 반 안팎, 비-mac 이 매달리면 그 잡의
timeout 까지). 막히지는 않습니다.

**`--tags` 를 쓰지 않습니다.** 로컬에 원격과 어긋난 옛 태그가 하나라도 있으면 푸시가 **통째로** 거부되고, 그 안에 섞인 새 태그의 push 이벤트까지 함께 묻혀 **워크플로가 아예 돌지 않습니다** (v2.9.0 에서 겪음 — 태그는 원격에 올라갔는데 빌드는 시작되지 않았습니다). 태그를 하나만 밀면 옛 태그의 상태와 무관해집니다.

옛 태그가 어긋나 있다면 (원격이 정본입니다):

```bash
git fetch --tags --force --prune-tags origin
```

### 5-1. Windows·Linux 공개 스위치 (`OCULPM_RELEASE_NONMAC`)

위 4~5 단계(비-mac 번들·스모크·E2E)와 publish 의 비-mac 병합은 **저장소 Actions 변수
`OCULPM_RELEASE_NONMAC` 이 `true` 일 때만** 돕니다. 변수가 없거나 다른 값이면 태그 릴리스는 **예전처럼
macOS 만** 냅니다 — bundle·smoke·e2e 는 건너뛰고, publish 는 macOS latest.json 검증(비-mac 키·자산이
없는지까지) → draft 해제만 합니다. 자산(5개) · latest.json(`darwin-aarch64` · `darwin-aarch64-app`) ·
본문 모양이 v3.5.0 과 같습니다 — 본문은 `notes.mjs` 의 `composeMacOnlyBody` 가 만들고, 실제 v3.5.0
본문과 바이트 단위로 같다는 것을 `release.test.mjs` 가 단언합니다. 「X 빌드가 없습니다」 줄도 없고
run 도 붉지 않습니다 — 빠진 것이 아니라 범위 밖이기 때문입니다.

이 스위치가 있는 이유: 파이프라인은 main 에 먼저 들어가지만, **첫 Windows·Linux 공개는 사용자가 따로
정합니다.** 스위치 없이 다른 세션이 macOS 핫픽스 태그를 밀면 README·랜딩이 아직 모르는 Windows·Linux
빌드가 같이 공개됩니다.

**첫 Windows·Linux 릴리스 절차** (이 순서로):

```bash
gh variable set OCULPM_RELEASE_NONMAC --body true   # 1. 스위치 켜기 — 태그 전에
gh variable list                                    #    OCULPM_RELEASE_NONMAC  true 확인
# 2. port/l-rel-docs(README ko/en · 랜딩 ko/en · CHANGELOG Unreleased)를 main 에 합류
# 3. CHANGELOG 의 `## Unreleased` → `## vX.Y.Z`, 그다음 §1~§5 평소대로 (버전 · README 하이라이트 · 랜딩 · 태그)
# 4. release run 이 끝나 공개된 **뒤에** 랜딩 배포 — 랜딩의 OS 별 링크는 릴리스 자산이 있어야 살아난다
```

태그 전에 드라이런으로 세 플랫폼이 초록인지 먼저 보는 것을 권합니다(§8, `nonmac` 기본 true).

**되돌리기** — Windows·Linux 를 다시 싣지 않으려면(예: 베타에 P0 가 나와 다음 몇 릴리스는 macOS 만):

```bash
gh variable set OCULPM_RELEASE_NONMAC --body false  # 또는: gh variable delete OCULPM_RELEASE_NONMAC
```

되돌린 뒤의 릴리스는 macOS 만 싣습니다. 이미 Windows·Linux 를 깐 사용자의 앱은 latest.json 에서 자기 키를
못 찾아 업데이트를 건너뜁니다(「대상 없음」 — §6-2) — 되돌리는 동안 README·랜딩도 함께 되돌릴지 정합니다.

## 6. 확인

```bash
gh run list --workflow=release.yml --limit 3   # ← 새 태그의 run 이 실제로 떴는지부터
gh release view vX.Y.Z --json body,assets --jq '{notes: (.body|length), assets: (.assets|length)}'
curl -s https://oculpm.com/ | grep softwareVersion
curl -s https://oculpm.com/changelog | grep -c 'id="v'   # 릴리스 수만큼 앵커가 있는지
```

**run 이 안 떴으면** 태그를 지웠다 다시 밀어 push 이벤트를 새로 발생시킵니다 (커밋은 이미 main 에 있어 안전):

```bash
git push origin :refs/tags/vX.Y.Z && git push origin refs/tags/vX.Y.Z
```

릴리스 노트 본문이 비어 있지 않은지(`body` 길이 0 이면 §2 의 헤더가 태그와 어긋난 것), 에셋이 **10개**인지(§5-1 스위치가 꺼졌으면 macOS 의 **5개**), 라이브 사이트 버전이 태그와 같은지까지 보고 마칩니다:

| 플랫폼 | 자산 |
| --- | --- |
| macOS | `.dmg` · `Ocul-PM_aarch64.app.tar.gz` · `.app.tar.gz.sig` · `latest.json` · `.vsix` (5) |
| Windows (베타) | `Ocul-PM_X.Y.Z_x64-setup.exe` · `.exe.sig` (2) |
| Linux (베타) | `Ocul-PM_X.Y.Z_amd64.AppImage` · `.AppImage.sig` · `Ocul-PM_X.Y.Z_amd64.deb` (3) |

비-mac 이 빠진 릴리스는 그만큼 적고, 본문에 「이번 버전에는 X 빌드가 없습니다」 줄이 있습니다(§6-2).
latest.json 의 키를 한 줄로 보려면:

```bash
gh release download vX.Y.Z --pattern latest.json --output - | jq -r '.platforms | keys[]'
```

### 6-1. 검증에 걸려 draft 로 남았을 때

Release run 이 붉은데 `gh release view vX.Y.Z --json isDraft` 가 `true` 면 §5 의 macOS 단계(3) 중 하나나
publish 의 최종 검증이 막은 것입니다(`false` 면 공개는 됐고 비-mac 이 빠진 것 — §6-2). 붉은 단계의 로그에
`::error::` 한 줄로 원인이 적혀 있습니다:

| 로그 | 뜻 | 조치 |
| --- | --- | --- |
| `애드혹(무서명) 번들이다` / `Signature=adhoc` | 서명이 안 붙음 | §7 시크릿 6개가 다 있는지(`gh secret list`), 인증서 만료(2027-02-01) 여부 |
| `Gatekeeper 가 .app 을 거부했다` / `source=Unnotarized Developer ID` | 서명은 됐는데 공증이 빠짐 | `APPLE_ID` · `APPLE_PASSWORD`(앱 암호여야 함) · `APPLE_TEAM_ID`; tauri-action 로그의 notarytool 출력 |
| `stapler validate` 실패 | 공증은 됐는데 티켓이 안 박힘 | 대개 일시적 — re-run |
| `.sig 가 없거나 비어 있다` | 업데이터 서명 키 없음 | `TAURI_PRIVATE_KEY` 시크릿 |
| `릴리스 자산에 … 이 없다` / `latest.json …` | 업로드 누락·URL 불일치 | tauri-action 로그; `version` 불일치면 §1 의 `tauri.conf.json` |
| `tauri.conf.json 의 version(…)이 태그(…)와 다르다` (meta) | §1 을 빠뜨리고 태그 | 빌드 전에 멈춘 것 — 버전을 올린 새 커밋 → 새 태그 |
| publish 의 `latest.json — … macOS 항목이 병합 전과 다르다` | 병합이 macOS 항목을 건드렸다(버그) | 공개하지 않고 멈춘 것이 맞습니다. `node --test .github/scripts/release/release.test.mjs` 로 재현 → 스크립트 수정 |

고친 뒤에는 **draft 를 지우고 run 을 다시 돌립니다** — 시크릿 문제라면 커밋을 바꿀 필요가 없으므로
태그도 그대로입니다:

```bash
gh release delete vX.Y.Z --yes                  # draft 삭제 (태그는 남습니다 — --cleanup-tag 금지)
gh run rerun <release run id>                    # 같은 태그로 다시: gate → build → 검증 → 공개
# 또는 push 이벤트를 새로 내고 싶으면: git push origin :refs/tags/vX.Y.Z && git push origin refs/tags/vX.Y.Z
```

코드를 고쳐야 하는 문제(예: 번들에 dylib 이 실려 하드닝 런타임 예외가 필요해짐)라면 태그를 옮기지
말고 새 커밋 → 새 버전으로 갑니다. 그 경우도 남아 있는 draft 는 지웁니다 — 같은 태그의 draft 가
있으면 다음 run 의 tauri-action 이 그 draft 를 찾아 자산을 덮어쓰기 때문에 지우지 않아도 동작은
하지만, 옛 시도의 자산이 섞여 남을 수 있습니다.

**손으로 `--draft=false` 를 누르지 마세요.** 검증을 건너뛰고 공개하는 유일한 경로가 그것이고, 그
순간 업데이터가 무서명 빌드를 모든 사용자에게 밀어 넣습니다.

**서명·공증 확인** — §5 의 3~4 단계가 매 릴리스 자동으로 단언하므로 이 두 줄은 이제 *교차 확인*입니다
(워크플로가 보는 것은 러너 디스크의 번들이고, 여기서 보는 것은 실제로 내려받은 `.dmg` 입니다). 시크릿이
하나라도 비면 번들러는 *실패하지 않고* 조용히 무서명 번들을 내놓는데, 그 경우 릴리스는 draft 로 남아
여기까지 오지도 않습니다(§6-1):

```bash
curl -sL -o /tmp/ocul.dmg "$(gh release view vX.Y.Z --json assets --jq '.assets[]|select(.name|endswith(".dmg")).url')"
hdiutil attach -nobrowse -quiet /tmp/ocul.dmg -mountpoint /tmp/ocul-dmg
codesign -dvv /tmp/ocul-dmg/Ocul-PM.app 2>&1 | grep -E "Authority|TeamIdentifier|flags"
spctl -a -vvv -t install /tmp/ocul-dmg/Ocul-PM.app     # → accepted / source=Notarized Developer ID
hdiutil detach -quiet /tmp/ocul-dmg
```

`Signature=adhoc` · `TeamIdentifier=not set` 이 보이면 서명이 안 붙은 것이고, `spctl` 이 `source=Notarized Developer ID` 가 아니면 공증이 빠진 것입니다.

### 6-2. 비-mac 이 빠졌을 때 (run 은 붉고, 릴리스는 공개됨)

Release run 이 붉은데 `isDraft` 가 `false` 이고 본문에 「이번 버전에는 Windows(또는 Linux) 빌드가
없습니다 — 「…」 단계」 가 있으면, **macOS 는 정상 공개됐고** 그 플랫폼만 검증에서 떨어져 자산과
latest.json 에서 빠진 것입니다(설계 D7). publish 의 마지막 단계 「비-mac 빠짐 알림」 이 사람을 부르려고
run 을 붉힌 것이지 공개가 실패한 것이 아닙니다.

- **사용자에게 보이는 것**: 그 플랫폼의 옛 버전 앱은 이번 latest.json 에서 자기 키를 못 찾아 이번 버전을
  건너뜁니다(업데이터는 「대상 없음」 으로 끝나고 아무것도 받지 않습니다 — 시작 때 확인은 조용하고,
  설정 → 업데이트에서 직접 확인하면 그 오류 문장이 보입니다). 다음 버전에서 이어집니다.
  릴리스 페이지에는 그 플랫폼 파일이 없습니다 — 검증 안 된 설치 파일을 사람 손에 내보내지 않으려고
  자산에서도 뺍니다.
- **원인 보기**: 붉은 잡(`번들 — windows` · `설치 스모크 — linux` · `E2E (설치본) — …`)과 아티팩트
  `release-bundle-log-<os>` · `release-smoke-log-<os>`(summary.md · 스크린샷) · `release-e2e-log-<os>`
  (index.html). publish 의 요약 표에 떨어진 단계가 적혀 있습니다.

고르는 길:

1. **그대로 둔다** — 코드 결함이면 고쳐서 다음 버전에 싣습니다. 태그를 옮기지 않습니다.
2. **일시적 실패(러너·네트워크·플레이크)면 실패한 잡만 다시**:
   ```bash
   gh run rerun <release run id> --failed
   ```
   떨어진 플랫폼의 bundle·smoke·e2e 와 publish 만 다시 돕니다(macOS 는 다시 굽지 않습니다 — 앞 시도의
   번들 아티팩트를 그대로 씁니다). publish 는 이미 공개된 릴리스에서도 안전하게 다시 돕니다: 통과한
   플랫폼을 병합해 자산·latest.json·본문을 갈아 끼우고, draft·`releases/latest` 는 건드리지 않습니다.
   **주의** — latest.json 을 갈아 끼우는 몇 초(`--clobber` 는 지운 뒤 올립니다) 동안 업데이트를 확인한
   앱은 404 를 보고 다음 확인 때 다시 봅니다. 그래서 공개된 릴리스의 re-run 은 **그 버전이 아직
   latest 일 때 한 번만** 합니다.
3. **코드를 고쳐야 하면 새 버전** — §6-1 과 같습니다.

**손으로 설치 파일을 올리거나 latest.json 을 고치지 마세요.** macOS 항목이 온전하다는 것을 증명하는
것은 publish 의 병합·검증뿐입니다 — 손으로 고친 latest.json 은 모든 macOS 사용자의 업데이트 경로를
걸고 도박하는 것입니다.

## 7. 서명·공증 시크릿 (한 번만 설정)

Apple Developer Program 계정의 **Developer ID Application** 인증서로 서명하고 공증합니다. 저장소 시크릿 6개가 있어야 `release.yml` 이 서명·공증을 수행합니다. 없으면 번들러는 조용히 무서명 번들을 내놓지만, §5 의 검증 단계가 그것을 잡아 릴리스를 draft 로 묶어 둡니다(§6-1) — 사용자에게 나가지는 않습니다.

로컬 키체인에서 인증서와 개인키를 `.p12` 로 내보낸 뒤 (Keychain Access → *내 인증서* → "Developer ID Application: …" 우클릭 → 항목 내보내기 → `.p12`, 암호 지정):

```bash
security find-identity -v -p codesigning        # 이름·팀 ID 확인
base64 -i DeveloperID.p12 | gh secret set APPLE_CERTIFICATE
gh secret set APPLE_CERTIFICATE_PASSWORD        # .p12 내보낼 때 지정한 암호
gh secret set APPLE_SIGNING_IDENTITY            # "Developer ID Application: <이름> (<팀ID>)"
gh secret set APPLE_ID                          # Apple 개발자 계정 이메일
gh secret set APPLE_PASSWORD                    # appleid.apple.com 의 앱 암호 (계정 암호 아님)
gh secret set APPLE_TEAM_ID                     # 10자 팀 ID
gh secret list                                  # 6개가 다 있는지
```

`APPLE_PASSWORD` 는 **앱 암호**(app-specific password)입니다 — appleid.apple.com → 로그인 및 보안 → 앱 암호에서 발급합니다. 계정 암호를 넣으면 공증 단계에서 인증 실패합니다.

설정은 `tauri.conf.json` 에 인증서 이름을 박지 않습니다 — `bundle.macOS` 에는 `hardenedRuntime: true` 만 두고 신원은 `APPLE_SIGNING_IDENTITY` 환경변수로 들어갑니다. 그래야 인증서 없는 로컬 `pnpm tauri build` 도 그대로 돌아갑니다 (무서명 번들이 나오고, 로컬 실행은 격리 표시가 없어 문제 없습니다).

**엔타이틀먼트 파일은 없습니다.** 하드닝 런타임(`hardenedRuntime`)만 켜져 있고 별도 예외가 필요 없습니다 — 번들에 dylib 이 없고(`ort`/`rusqlite` 모두 정적 링크), WKWebView 는 Apple 서명 프로세스로 분리돼 있으며, `git`·`claude`·`codex` 같은 자식 프로세스 실행은 하드닝 런타임이 막지 않습니다. 이 조건이 깨지면(동적 라이브러리를 싣게 되면) `bundle.macOS.entitlements` 로 `com.apple.security.cs.disable-library-validation` 을 추가해야 합니다.

**인증서 만료: 2027-02-01.** 지금 쓰는 Developer ID Application 인증서의 `notAfter` 가 그날입니다 — Developer ID 는 보통 5년인데 발급 CA 자체의 만료에 맞춰 짧게 잘려 있습니다. 타임스탬프가 붙은 서명은 만료 뒤에도 계속 유효하므로 **이미 나간 빌드는 안전**하지만, 그날 이후 **새 빌드를 서명하려면 인증서를 갱신하고 `APPLE_CERTIFICATE` 를 다시 올려야** 합니다. 갱신 없이 태그를 밀면 서명 단계가 조용히 무서명으로 떨어지고, release.yml 의 서명·공증 검증이 그것을 잡아 draft 로 남깁니다(§6-1) — 인증서를 갱신해 시크릿을 올린 뒤 draft 를 지우고 run 을 re-run 하면 됩니다.

**서명 주체가 바뀌는 첫 업데이트에서 키체인 프롬프트가 뜹니다.** API 키는 `keyring` 으로 OS 키체인에 들어 있고, 그 항목의 접근 권한은 만들 당시 앱의 코드 서명에 묶입니다. 애드혹 서명 빌드에서 Developer ID 빌드로 올라간 사용자는 처음 한 번 "Ocul-PM 이(가) 키체인의 정보를 사용하려 합니다" 를 보게 되고, **항상 허용**을 누르면 이후로는 조용합니다. 이 릴리스의 CHANGELOG 에 한 줄 적어 두세요.

### 7-1. Windows · Linux

- **업데이터 서명**(`.exe.sig` · `.AppImage.sig`)은 macOS 와 같은 `TAURI_PRIVATE_KEY` 로 합니다 — 시크릿이
  더 필요하지 않습니다.
- **Windows 코드 서명(Authenticode)은 없습니다** — 무서명 베타로 시작합니다(사용자 결정 2026-09-24).
  처음 실행하면 SmartScreen 이 「Windows의 PC 보호」 를 띄우고, 사용자는 **추가 정보 → 실행** 을 눌러야
  합니다(README·릴리스 본문이 안내합니다). 나중에 서명을 붙이면 `bundle` 잡의 `tauri build` 에 서명
  설정을 주고, 산출물 단계에 `signtool verify /pa` 단언을 더합니다.
- **Linux** — AppImage 는 업데이터 서명(`.sig`)만, deb 는 서명이 없습니다(apt 저장소가 아니라 직접
  받는 파일).
- **VC++ 재배포** — Windows 설치 파일은 Microsoft VC++ 재배포(x64)를 싣고, PC 에 없거나 낡았을 때만
  설치합니다. `bundle` 잡이 `tauri build` 전에 `.github/scripts/fetch-vcredist.ps1` 로 판 고정 URL ·
  SHA-256 · Authenticode 를 확인하며 받습니다. 판을 올리는 법은 그 스크립트 머리 주석에 있습니다.

## 8. 드라이런 — 태그 없이 release.yml 전체를 (workflow_dispatch)

release.yml 을 고쳤거나 비-mac 경로를 태그 전에 미리 보려면:

```bash
gh workflow run release.yml --ref <브랜치>                     # 정상
gh workflow run release.yml --ref <브랜치> -f fail=linux-smoke # 비-mac 하나를 일부러 떨어뜨림
gh workflow run release.yml --ref <브랜치> -f keep_draft=true  # draft 를 남겨 눈으로 본다
gh workflow run release.yml --ref <브랜치> -f nonmac=false     # 공개 스위치가 꺼진 태그 릴리스와 같은 경로 (macOS 만)
```

- 드라이런은 저장소 변수(§5-1) 대신 입력 `nonmac`(기본 true)을 따릅니다 — `false` 면 bundle·smoke·e2e 를
  건너뛰고 macOS 만, 본문은 v3.5.0 모양, run 은 초록이어야 맞습니다.
- 가짜 버전 `0.0.<run 번호>` · 태그 `v0.0.N` 의 **draft** 로 meta → gate → macOS(실제 서명·공증) ·
  비-mac 번들 → 스모크 · E2E → publish 를 전부 돕니다. 6 버전 파일은 러너 안에서만
  (`.github/scripts/release/dryrun-version.mjs`) 바꾸고 커밋하지 않습니다.
- gate 는 **보고만** 합니다(브랜치 커밋엔 ci.yml run 이 없습니다). 본문의 「What's new」 는
  `CHANGELOG.md` 의 `## Unreleased` 절입니다.
- 공개·`--latest` 는 코드에서 막혀 있습니다 — publish 는 드라이런이면 `v0.0.N` 이고 draft 인지 단언한 뒤
  해제하지 않고, meta 는 `0.0.N` 을 진짜 태그로 받지 않습니다. draft 는 git 태그를 만들지 않습니다(공개할
  때 만들어집니다). `0.0.N` 은 어떤 공개 버전보다 낮아 설령 보여도 업데이터가 고르지 않습니다.
- `fail` 은 `windows-bundle` · `linux-bundle` · `windows-smoke` · `linux-smoke` · `windows-e2e` ·
  `linux-e2e` 중 하나 — macOS 와 다른 플랫폼이 멀쩡하고 그 플랫폼만 자산·latest.json 에서 빠지는지,
  본문에 그 줄이 남는지 봅니다. run 은 붉게 끝나는 것이 맞습니다.
- 끝에서 `dryrun-cleanup` 이 draft 를 지웁니다(`v0.0.N` 이고 draft 일 때만, 혹시 태그가 생겼으면 그것도).
  `keep_draft=true` 로 남겼으면 다 본 뒤 `gh release delete v0.0.N --yes`.
- 한 바퀴 1시간 반 안팎(Windows 릴리스 프로필 콜드 빌드). `workflow_dispatch` 는 기본 브랜치에
  release.yml 이 있어야 뜨고, 실행은 `--ref` 브랜치의 파일 내용으로 합니다.
