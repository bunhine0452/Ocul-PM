# Homebrew cask — `brew install --cask ocul-pm` (Apple Silicon, macOS 13+).
#
# 이 파일은 바깥 저장소(자체 tap 또는 Homebrew/homebrew-cask)에 올릴 정의의 원본이다. 앱 코드가 아니고
# 앱은 이 파일을 읽지 않는다. 제출은 바깥 저장소에 PR 을 올리는 일이라 사람이 확인한 뒤에 한다
# (docs/RELEASE.md 「설치 채널」). version · sha256 은 릴리스가 공개된 뒤
# `node scripts/packaging/update-manifests.mjs` 가 채운다 — 0 으로 찬 sha256 은 아직 안 채웠다는 뜻이다.
#
# 이름 · 주소의 근거(바뀌면 packaging_manifests 시험이 붉어진다):
#   - dmg 이름  `Ocul-PM_<버전>_aarch64.dmg` — release.yml 의 macOS 잡이 만든다
#     (.github/scripts/release/notes.mjs 의 자산 표). Intel Mac 빌드는 없다(ort 가 x86_64-apple-darwin 을 안 준다).
#   - .app 이름 `Ocul.app` — tauri.conf.json 의 macOS.bundleName.
#   - 서명 · 공증된 빌드라 Gatekeeper 가 막지 않는다(release.yml 이 spctl · codesign 으로 단언).
cask "ocul-pm" do
  version "4.12.1"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"

  url "https://github.com/bunhine0452/Ocul-PM/releases/download/v#{version}/Ocul-PM_#{version}_aarch64.dmg",
      verified: "github.com/bunhine0452/Ocul-PM/"
  name "Ocul"
  desc "Local-first receipts for what your coding agents did"
  homepage "https://oculpm.com"

  # 태그가 `v4.12.1`(앱)과 `ext-v0.3.0`(VS Code 확장)으로 갈려서 releases/latest 는 확장이 가져갈 수 있다 —
  # `v<숫자>` 태그만 앱으로 본다.
  livecheck do
    url "https://github.com/bunhine0452/Ocul-PM.git"
    regex(/^v(\d+(?:\.\d+)+)$/i)
    strategy :git
  end

  # 앱이 스스로 업데이트한다(앱 안 업데이터) — brew upgrade 가 같이 돌려도 어긋나지 않는다.
  auto_updates true
  depends_on arch: :arm64
  depends_on macos: ">= :ventura"

  app "Ocul.app"

  # 앱이 쓰는 기기 쪽 자리만. 프로젝트의 `.oculpm/`(일지 · 계획)은 사용자 기록이라 지우지 않는다.
  zap trash: [
    "~/Library/Application Support/com.kimhyunbin.ocul-pm",
    "~/Library/Caches/com.kimhyunbin.ocul-pm",
    "~/Library/Preferences/com.kimhyunbin.ocul-pm.plist",
    "~/Library/Saved Application State/com.kimhyunbin.ocul-pm.savedState",
    "~/Library/WebKit/com.kimhyunbin.ocul-pm",
  ]
end
