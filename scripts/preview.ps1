# ローカルプレビュー
#
#   powershell -ExecutionPolicy Bypass -File scripts\preview.ps1
#
# docs\ をローカルサーバーで配信してブラウザを開く。
# （docs\ は GitHub Pages の配信元。詳細は CLAUDE.md「公開の仕組み」）
# HTMLを直接ダブルクリック（file://）ではESモジュールがCORSで読めず、
# 計算が動かないので必ずこちらを使うこと。
#
# 375px の表示確認手順:
#   F12 → 端末ツールバーの切り替え(Ctrl+Shift+M) → 幅を 375 に設定
#   横スクロールバーが出なければ合格。
#
# 止めるときは、このウィンドウで Ctrl+C。

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$Site = Join-Path $Root 'docs'
$Port = 8765

if (-not (Test-Path $Site)) { throw "docs フォルダが見つかりません: $Site" }

Write-Host ""
Write-Host "  http://localhost:$Port/                              トップ" -ForegroundColor Cyan
Write-Host "  http://localhost:$Port/tools/wallpaper-quantity/     壁紙ツール" -ForegroundColor Cyan
Write-Host "  http://localhost:$Port/tools/paint-quantity/         塗料ツール" -ForegroundColor Cyan
Write-Host ""
Write-Host "  375px 確認: F12 → Ctrl+Shift+M → 幅を 375 に設定" -ForegroundColor DarkGray
Write-Host "  停止: Ctrl+C" -ForegroundColor DarkGray
Write-Host ""

Start-Process "http://localhost:$Port/"

Set-Location $Site
py -3 -m http.server $Port
