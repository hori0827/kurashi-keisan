# タスクスケジューラ登録スクリプト
#
# 使い方（PowerShellでこの1行だけ）:
#   powershell -ExecutionPolicy Bypass -File "c:\Users\horik_vle3kvw\OneDrive\Desktop\プロジェクト\scripts\register_task.ps1"
#
# 解除したいとき:
#   Unregister-ScheduledTask -TaskName "KurashiKeisan-Daily"  -Confirm:$false
#   Unregister-ScheduledTask -TaskName "KurashiKeisan-Weekly" -Confirm:$false

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
Write-Host "プロジェクト: $Root"

# 前提チェック --------------------------------------------------------------
$daily  = Join-Path $Root 'scripts\daily_run.ps1'
$weekly = Join-Path $Root 'scripts\weekly_review.ps1'
foreach ($f in @($daily, $weekly)) {
    if (-not (Test-Path $f)) { throw "スクリプトが見つかりません: $f" }
}
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    Write-Warning "claude コマンドが PATH にありません。登録は続行しますが実行時に失敗します。"
}

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)

function Register-One {
    param($Name, $Script, $Trigger, $Desc)

    $arg = '-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $Script
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
        -Argument $arg -WorkingDirectory $Root

    Register-ScheduledTask -TaskName $Name -Action $action -Trigger $Trigger `
        -Settings $settings -Description $Desc -Force | Out-Null

    $info = Get-ScheduledTaskInfo -TaskName $Name
    Write-Host ("  [OK] {0}  次回: {1}" -f $Name, $info.NextRunTime) -ForegroundColor Green
}

Write-Host "`n登録中..."

Register-One -Name 'KurashiKeisan-Daily' -Script $daily `
    -Trigger (New-ScheduledTaskTrigger -Daily -At 9:17AM) `
    -Desc '自律収益プロジェクト: 日次ループ（今日の1手を実行）'

Register-One -Name 'KurashiKeisan-Weekly' -Script $weekly `
    -Trigger (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 10:23AM) `
    -Desc '自律収益プロジェクト: 週次レビュー（戦略の見直しと制度の再検証）'

Write-Host "`n完了。登録内容:" -ForegroundColor Cyan
Get-ScheduledTask | Where-Object { $_.TaskName -like 'KurashiKeisan-*' } |
    Select-Object TaskName, State | Format-Table -AutoSize

Write-Host "すぐ動くか試すなら:"
Write-Host "  Start-ScheduledTask -TaskName 'KurashiKeisan-Daily'"
Write-Host "  実行結果は logs\ に出ます。"
