# WebView2 런타임과 **같은 버전**의 msedgedriver 를 준비한다 (Windows 러너).
#
# 러너에 깔린 EdgeDriver 는 Edge **브라우저** 버전에 맞춰져 있다. 앱을 그리는
# 것은 WebView2 **런타임**이라, 둘이 어긋나면 세션 생성이 "This version of
# Microsoft Edge WebDriver only supports ..." 로 거부된다. 그래서 런타임 버전을
# 레지스트리에서 읽고 그 버전의 드라이버를 받는다.
#
# 출력: GITHUB_ENV 에 OCULPM_E2E_NATIVE_DRIVER · OCULPM_E2E_WEBVIEW2_VERSION.
$ErrorActionPreference = 'Stop'

$clientId = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' # WebView2 Evergreen Runtime
$keys = @(
  "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$clientId",
  "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$clientId",
  "HKCU:\Software\Microsoft\EdgeUpdate\Clients\$clientId"
)
function Get-WebView2Version {
  foreach ($k in $keys) {
    $v = (Get-ItemProperty -Path $k -Name pv -ErrorAction SilentlyContinue).pv
    if ($v -and $v -ne '0.0.0.0') { return $v }
  }
  return $null
}

$ver = Get-WebView2Version
if (-not $ver) {
  # 런타임이 없는 이미지 — 사용자 PC 처럼 에버그린 부트스트래퍼로 깐다.
  Write-Host 'WebView2 런타임이 없다 — 에버그린 부트스트래퍼로 설치'
  $setup = Join-Path $env:RUNNER_TEMP 'MicrosoftEdgeWebview2Setup.exe'
  Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $setup
  Start-Process -FilePath $setup -ArgumentList '/silent', '/install' -Wait
  $ver = Get-WebView2Version
  if (-not $ver) { throw 'WebView2 런타임 설치 후에도 버전을 못 읽었다' }
}
Write-Host "WebView2 런타임 $ver"

$dest = Join-Path $env:RUNNER_TEMP 'msedgedriver'
$zip = Join-Path $env:RUNNER_TEMP 'edgedriver_win64.zip'
$driver = $null
foreach ($base in @('https://msedgedriver.microsoft.com', 'https://msedgedriver.azureedge.net')) {
  try {
    Invoke-WebRequest -Uri "$base/$ver/edgedriver_win64.zip" -OutFile $zip
    Expand-Archive -Path $zip -DestinationPath $dest -Force
    $driver = Join-Path $dest 'msedgedriver.exe'
    Write-Host "받음: $base/$ver"
    break
  } catch {
    Write-Host "실패: $base/$ver — $($_.Exception.Message)"
  }
}
if (-not $driver) {
  # 받지 못하면 러너의 EdgeDriver 가 같은 메이저일 때만 쓴다 (다르면 어차피 거부된다).
  $fallback = Join-Path $env:EDGEWEBDRIVER 'msedgedriver.exe'
  $fbVer = (& $fallback --version) -replace '.*WebDriver\s+([\d.]+).*', '$1'
  if ($fbVer.Split('.')[0] -ne $ver.Split('.')[0]) { throw "러너 EdgeDriver $fbVer 가 런타임 $ver 과 메이저가 다르다" }
  $driver = $fallback
  Write-Host "러너 EdgeDriver 사용: $fbVer"
}
& $driver --version
"OCULPM_E2E_NATIVE_DRIVER=$driver" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
"OCULPM_E2E_WEBVIEW2_VERSION=$ver" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
