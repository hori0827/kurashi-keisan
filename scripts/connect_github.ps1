# 公開経路をつなぐ — GitHubリポジトリの作成から初回pushまでを自動でやる
#
# 人間にやってもらうのは「トークンを1個作って貼る」だけ。
# リポジトリ作成・remote設定・push はこのスクリプトが行う。
#
#   1. secrets\github_token.txt にトークンだけを貼って保存
#   2. powershell -ExecutionPolicy Bypass -File scripts\connect_github.ps1
#
# 日次ランナー(daily_run.ps1)からも自動で呼ばれる。
# つまりトークンを置いておけば、次の自動実行で勝手に公開経路がつながる。
#
# トークンは remote URL に埋め込まない。埋め込むと git remote -v の出力や
# logs\ に残る実行ログにトークンが流出するため。
# 代わりに git 標準の credential store（%USERPROFILE%\.git-credentials）へ入れる。

param(
    [string]$RepoName = 'tools',
    [switch]$Quiet
)

# git は正常時でも stderr に書くことがある。ここで Stop にすると誤爆するので Continue。
# HTTP 呼び出しだけ個別に -ErrorAction Stop を付けて try/catch する。
$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Say($msg, $color = 'Gray') { if (-not $Quiet) { Write-Host $msg -ForegroundColor $color } }

# ── 1. 既に繋がっているなら何もしない ────────────────────────────────
$remotes = @(git remote)
if ($remotes -contains 'origin') {
    $existing = git config --get remote.origin.url
    Say "[skip] origin は設定済み: $existing" 'DarkGray'
    exit 0
}

# ── 2. トークンを読む ────────────────────────────────────────────────
$TokenFile = Join-Path $Root 'secrets\github_token.txt'
if (-not (Test-Path $TokenFile)) {
    Say "[待ち] トークンがまだ置かれていません。" 'Yellow'
    Say "       $TokenFile" 'Yellow'
    Say "       に GitHub のトークンを貼って保存してください。" 'Yellow'
    Say "       発行URL: https://github.com/settings/tokens/new?scopes=repo&description=kurashi-keisan" 'Yellow'
    exit 2
}

$Token = (Get-Content $TokenFile -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($Token)) {
    Say "[error] トークンファイルが空です: $TokenFile" 'Red'
    exit 2
}

$Headers = @{
    Authorization = "token $Token"
    'User-Agent'  = 'kurashi-keisan-setup'
    Accept        = 'application/vnd.github+json'
}

# ── 3. トークンの持ち主を確認 ────────────────────────────────────────
try {
    $me = Invoke-RestMethod -Uri 'https://api.github.com/user' -Headers $Headers -Method Get -ErrorAction Stop
}
catch {
    Say "[error] トークンが無効か、権限が足りません。" 'Red'
    Say "        スコープ 'repo' を付けて作り直してください。" 'Red'
    Say "        $($_.Exception.Message)" 'DarkGray'
    exit 3
}
$Login = $me.login
Say "[ok] 認証できました: $Login" 'Green'

# ── 4. リポジトリを用意する（無ければ作る） ──────────────────────────
$RepoUrl = "https://github.com/$Login/$RepoName"
$exists = $true
try {
    Invoke-RestMethod -Uri "https://api.github.com/repos/$Login/$RepoName" `
        -Headers $Headers -Method Get -ErrorAction Stop | Out-Null
}
catch { $exists = $false }

if ($exists) {
    Say "[ok] リポジトリは既にあります: $RepoUrl" 'Green'
}
else {
    $body = @{
        name        = $RepoName
        description = 'くらしの計算室 — 根拠つきの計算ツール'
        private     = $false
        auto_init   = $false
        has_issues  = $false
        has_wiki    = $false
    } | ConvertTo-Json

    try {
        Invoke-RestMethod -Uri 'https://api.github.com/user/repos' -Headers $Headers `
            -Method Post -Body $body -ContentType 'application/json' -ErrorAction Stop | Out-Null
        Say "[ok] リポジトリを作成しました: $RepoUrl" 'Green'
    }
    catch {
        Say "[error] リポジトリを作成できませんでした: $($_.Exception.Message)" 'Red'
        exit 4
    }
}

# ── 5. 認証情報を git 標準の場所へ（remote URL には入れない） ─────────
$CredFile = Join-Path $HOME '.git-credentials'
$lines = @()
if (Test-Path $CredFile) {
    $lines = @(Get-Content $CredFile) | Where-Object { $_ -and ($_ -notmatch 'github\.com') }
}
$lines = @($lines) + @("https://$($Login):$($Token)@github.com")
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($CredFile, (($lines -join "`n") + "`n"), $utf8NoBom)
git config --local credential.helper store

# ── 6. 公開前ゲート ──────────────────────────────────────────────────
# 初回 push も「公開」である以上、CLAUDE.md の公開前ゲートを必ず通す。
# ここを飛ばすと、検証されていない状態が世界に出る最初の一回になってしまう。
node (Join-Path $Root 'scripts\verify.mjs')
if ($LASTEXITCODE -ne 0) {
    Say "[中止] 公開前ゲート(verify.mjs)が通りませんでした。push しません。" 'Red'
    Say "       上の ERROR を直してから、もう一度このスクリプトを実行してください。" 'Red'
    exit 6
}

# ── 7. remote 設定と push ────────────────────────────────────────────
git remote add origin "$RepoUrl.git"
git branch -M main
git push -u origin main
if ($LASTEXITCODE -ne 0) {
    Say "[error] push に失敗しました。上の git の出力を確認してください。" 'Red'
    exit 5
}

Say ''
Say "[完了] 公開経路がつながりました: $RepoUrl" 'Green'
Say ''
Say "残りは Cloudflare 側だけです（人間の作業・約10分）:" 'Cyan'
Say "  1. https://dash.cloudflare.com/sign-up で無料アカウントを作る" 'Cyan'
Say "  2. Workers & Pages -> Create -> Pages -> Connect to Git" 'Cyan'
Say "  3. リポジトリ '$RepoName' を選ぶ" 'Cyan'
Say "  4. Framework preset=None / Build command=空欄 / Build output directory=site" 'Cyan'
Say "  5. Save and Deploy -> 発行された .pages.dev のURLを SETUP_HUMAN.md の記入欄へ" 'Cyan'
exit 0
