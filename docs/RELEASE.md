# 릴리스 체크리스트

릴리스는 태그를 미는 것으로 끝나지 않습니다. **변경 내용이 아래 다섯 면에 전부 적혀야** 완결입니다 — 서로 다른 경로로 나가기 때문에 하나씩 빠지기 쉽습니다 (실제로 v2.8.1~2.8.3 은 랜딩 배포가 빠져 라이브가 v2.8.0 에 멈춰 있었고, README 는 v2.7.0 에서 v2.8.5 까지 갱신되지 않았습니다).

## 0. 커밋 전 게이트

```bash
pnpm typecheck && pnpm test && pnpm lint && pnpm build
cd src-tauri && cargo test      # bindings.ts 재생성 포함
```

네 개 모두 exit 0 인지 **직접 확인**합니다 (통과했겠거니 하지 않기).

## 1. 버전 — 5파일 (같은 값)

| 파일 | 위치 |
| --- | --- |
| `package.json` | `"version"` |
| `src-tauri/tauri.conf.json` | `"version"` |
| `src-tauri/Cargo.toml` | `version` |
| `plugin/oculpm/.claude-plugin/plugin.json` | `"version"` |
| `.claude-plugin/marketplace.json` | `plugins[0].version` |

아래 두 개는 `cargo test --test plugin_manifest` 가 앱 버전과의 동기를 강제합니다 (v2.10.3 에서 이 문서가 3파일만 적어 두어 §0 게이트가 두 번 붉게 났습니다). 세 번째 파일을 고친 뒤 게이트를 다시 돌리면 잡히니, 순서는 **버전 5곳 → 게이트** 가 편합니다.

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

## 4. landing/index.html — 버전 문자열 5곳 + 새 기능 표면

버전 문자열: `softwareVersion`(JSON-LD) · `ap-new` NEW 배지 · 변경사항 `<li>` · 다운로드 버튼(`vX.Y.Z 받기`) · CTA `eyebrow`.

```bash
grep -n "2\.8\.5" landing/index.html    # 이전 버전 문자열이 남지 않았는지 전수 확인
```

기능이 추가된 릴리스라면 여기에 더해:

- JSON-LD `featureList` 에 한 줄
- 눈에 띄는 기능이면 FAQ 항목 (SEO 표면)
- 벤토 그리드 셀 — 그리드는 6칸이므로 `c-span2` 3개 = 한 줄로 맞춰 넣습니다
- 플러그인 커맨드·MCP 도구·스킬이 바뀌었으면 `landing/plugin.html` 도 (테스트가 누락을 막습니다)

## 5. 커밋 → 태그 → 랜딩 배포

```bash
git add <명시 경로만>          # git add -A 금지 (병렬 세션 WIP 를 쓸어 담은 사고 전례)
git commit -m "release: vX.Y.Z — <한 줄 요약>"
git tag vX.Y.Z
git push origin main           # 커밋 먼저
git push origin vX.Y.Z         # 태그는 단독으로 — release.yml 이 빌드·서명·릴리스 (로컬 빌드 금지)
cd landing && vercel --prod --yes               # 랜딩은 git 연동이 없어 push 로 안 나갑니다
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
```

**run 이 안 떴으면** 태그를 지웠다 다시 밀어 push 이벤트를 새로 발생시킵니다 (커밋은 이미 main 에 있어 안전):

```bash
git push origin :refs/tags/vX.Y.Z && git push origin refs/tags/vX.Y.Z
```

릴리스 노트 본문이 비어 있지 않은지(`body` 길이 0 이면 §2 의 헤더가 태그와 어긋난 것), 에셋이 4개(`.dmg` · `.app.tar.gz` · `.sig` · `latest.json`)인지, 라이브 사이트 버전이 태그와 같은지까지 보고 마칩니다.
