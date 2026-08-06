# 自律収益プロジェクト — 日次実行ランナー
#
# Windowsタスクスケジューラから毎日1回呼ばれる。
# Claude Code をヘッドレスで起動し、CLAUDE.md の「日次ループ」を実行させる。
#
# 手動で試したいとき:  powershell -ExecutionPolicy Bypass -File scripts\daily_run.ps1
# 停止したいとき:      Unregister-ScheduledTask -TaskName "KurashiKeisan-Daily" -Confirm:$false

$ErrorActionPreference = 'Continue'

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$LogDir = Join-Path $Root 'logs'
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$Log = Join-Path $LogDir ("run_{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))

"===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') 開始 =====" | Add-Content $Log -Encoding utf8

# ── 公開経路の自動接続 ───────────────────────────────────────────────
# origin が未設定で、かつ secrets\github_token.txt が置かれていれば、
# ここでリポジトリ作成から初回pushまで済ませる（公開前ゲートは向こうで通る）。
# 人間はトークンを1回貼るだけでよく、以降の公開は完全に自動になる。
$remotes = @(git remote)
if (-not ($remotes -contains 'origin')) {
    & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'connect_github.ps1') |
        Add-Content $Log -Encoding utf8
}

$Prompt = @'
あなたはこのプロジェクトの自律運用を担っている。まず CLAUDE.md を読むこと。

そのうえで「日次ループ」の手順1〜7を順に実行せよ。本日の1手は「意思決定ルール」の
表に従って自分で決定すること。人間に質問はできない（ヘッドレス実行のため）ので、
判断は自分で下し、人間の作業が必要なものは SETUP_HUMAN.md のキューに追記するだけにせよ。

厳守事項:
- 数値・制度・税率は必ず官公庁の一次情報で裏取りする。記憶や二次情報で書かない。
- 裏取りできない数値を含むツールは公開しない。保留にして理由を state/decisions.md に残す。
- 公開前ゲート（計算のテスト・レンダリング確認・スマホ幅確認）を必ず通す。
- 最後に必ず state/pipeline.json と state/decisions.md を更新し、git commit すること。
'@

# 権限は必要最小限のみ許可する。任意のコマンド実行は許可しない。
$Allowed = @(
    'Read,Write,Edit,Glob,Grep,WebSearch,WebFetch,TodoWrite'
    'Bash(git add:*),Bash(git commit:*),Bash(git status:*)'
    'Bash(git log:*),Bash(git diff:*),Bash(git push:*),Bash(git remote:*)'
    'Bash(py -3 scripts/fetch_metrics.py:*)'   # 手順3の計測
    'Bash(node scripts/verify.mjs:*)'          # 公開前ゲート
) -join ','

try {
    & claude -p $Prompt --allowedTools $Allowed --permission-mode acceptEdits 2>&1 |
        Add-Content $Log -Encoding utf8
    "----- 終了コード: $LASTEXITCODE -----" | Add-Content $Log -Encoding utf8
}
catch {
    "!!! 実行エラー: $($_.Exception.Message)" | Add-Content $Log -Encoding utf8
}

"===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') 終了 =====`n" | Add-Content $Log -Encoding utf8

# ログは30日で自動削除
Get-ChildItem $LogDir -Filter 'run_*.log' |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
    Remove-Item -Force -ErrorAction SilentlyContinue
