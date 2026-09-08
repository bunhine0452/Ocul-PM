# 릴리스 체크리스트

릴리스는 태그를 미는 것으로 끝나지 않습니다. **변경 내용이 아래 다섯 면에 전부 적혀야** 완결입니다 — 서로 다른 경로로 나가기 때문에 하나씩 빠지기 쉽습니다 (실제로 v2.8.1~2.8.3 은 랜딩 배포가 빠져 라이브가 v2.8.0 에 멈춰 있었고, README 는 v2.7.0 에서 v2.8.5 까지 갱신되지 않았습니다).

## 0. 커밋 전 게이트

```bash
pnpm typecheck && pnpm test && pnpm lint && pnpm build
cd src-tauri && cargo test      # bindings.ts 재생성 포함
```

네 개 모두 exit 0 인지 **직접 확인**합니다 (통과했겠거니 하지 않기).

이 게이트는 `.github/workflows/ci.yml` 이 PR 과 main 푸시에서도 자동으로 돌립니다
(프런트 잡 = typecheck·test·lint·build / Rust 잡 = `cargo test --locked` + bindings 신선도).
**태그를 밀기 전에 main 의 CI 가 그린인지 확인하세요** — release.yml 은 테스트를 돌리지
않고 번들만 굽기 때문에, 붉은 main 에 태그를 밀면 깨진 빌드가 그대로 릴리스로 나갑니다.

## 1. 버전 — 6파일 (같은 값)

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

**이것이 GitHub 릴리스 노트의 유일한 소스입니다.** `.github/workflows/release.yml` 이 태그와 같은 헤더의 본문만 뽑아 릴리스 본문에 넣습니다:

```bash
body="$(awk -v t="## ${ver}" '$0==t{f=1;next} /^## /{if(f)exit} f' CHANGELOG.md)"
```

헤더가 태그와 정확히 일치해야 하고(`## v2.8.5` ↔ 태그 `v2.8.5`), 어긋나면 릴리스 본문이 빈 채로 나갑니다. 톤은 기존 항목을 표본으로 — 기능 나열이 아니라 **사용자가 겪던 증상 → 무엇이 바뀌었나** 를 굵게 시작하는 서술형으로, 내부 구현 용어 대신 화면에서 보이는 말로.

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
git push origin vX.Y.Z         # 태그는 단독으로 — release.yml 이 빌드·서명·릴리스 (로컬 빌드 금지)
cd landing && vercel --prod --yes               # 랜딩은 git 연동이 없어 push 로 안 나갑니다
                                               # (§4-1 재빌드가 먼저 — 배포는 디스크에 있는 것만 올립니다)
```

**`--tags` 를 쓰지 않습니다.** 로컬에 원격과 어긋난 옛 태그가 하나라도 있으면 푸시가 **통째로** 거부되고, 그 안에 섞인 새 태그의 push 이벤트까지 함께 묻혀 **워크플로가 아예 돌지 않습니다** (v2.9.0 에서 겪음 — 태그는 원격에 올라갔는데 빌드는 시작되지 않았습니다). 태그를 하나만 밀면 옛 태그의 상태와 무관해집니다.

옛 태그가 어긋나 있다면 (원격이 정본입니다):

```bash
git fetch --tags --force --prune-tags origin
```

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

릴리스 노트 본문이 비어 있지 않은지(`body` 길이 0 이면 §2 의 헤더가 태그와 어긋난 것), 에셋이 4개(`.dmg` · `.app.tar.gz` · `.sig` · `latest.json`)인지, 라이브 사이트 버전이 태그와 같은지까지 보고 마칩니다.

**서명·공증 확인** (§7 을 설정한 뒤로는 매 릴리스 이 두 줄까지 봅니다 — 시크릿이 하나라도 비면 번들러는 *실패하지 않고* 조용히 무서명 번들을 내놓습니다):

```bash
curl -sL -o /tmp/ocul.dmg "$(gh release view vX.Y.Z --json assets --jq '.assets[]|select(.name|endswith(".dmg")).url')"
hdiutil attach -nobrowse -quiet /tmp/ocul.dmg -mountpoint /tmp/ocul-dmg
codesign -dvv /tmp/ocul-dmg/Ocul-PM.app 2>&1 | grep -E "Authority|TeamIdentifier|flags"
spctl -a -vvv -t install /tmp/ocul-dmg/Ocul-PM.app     # → accepted / source=Notarized Developer ID
hdiutil detach -quiet /tmp/ocul-dmg
```

`Signature=adhoc` · `TeamIdentifier=not set` 이 보이면 서명이 안 붙은 것이고, `spctl` 이 `source=Notarized Developer ID` 가 아니면 공증이 빠진 것입니다.

## 7. 서명·공증 시크릿 (한 번만 설정)

Apple Developer Program 계정의 **Developer ID Application** 인증서로 서명하고 공증합니다. 저장소 시크릿 6개가 있어야 `release.yml` 이 서명·공증을 수행하고, 없으면 무서명 번들이 그대로 나갑니다.

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

**인증서 만료: 2027-02-01.** 지금 쓰는 Developer ID Application 인증서의 `notAfter` 가 그날입니다 — Developer ID 는 보통 5년인데 발급 CA 자체의 만료에 맞춰 짧게 잘려 있습니다. 타임스탬프가 붙은 서명은 만료 뒤에도 계속 유효하므로 **이미 나간 빌드는 안전**하지만, 그날 이후 **새 빌드를 서명하려면 인증서를 갱신하고 `APPLE_CERTIFICATE` 를 다시 올려야** 합니다. 갱신 없이 태그를 밀면 서명 단계가 조용히 무서명으로 떨어지므로, §6 의 `spctl` 두 줄이 그 그물입니다.

**서명 주체가 바뀌는 첫 업데이트에서 키체인 프롬프트가 뜹니다.** API 키는 `keyring` 으로 OS 키체인에 들어 있고, 그 항목의 접근 권한은 만들 당시 앱의 코드 서명에 묶입니다. 애드혹 서명 빌드에서 Developer ID 빌드로 올라간 사용자는 처음 한 번 "Ocul-PM 이(가) 키체인의 정보를 사용하려 합니다" 를 보게 되고, **항상 허용**을 누르면 이후로는 조용합니다. 이 릴리스의 CHANGELOG 에 한 줄 적어 두세요.
