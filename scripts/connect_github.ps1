# 公開経路をつなぐ — GitHub リポジトリへの接続と初回 push
#
# 公開先は GitHub Pages（ユーザーサイト / main ブランチの /docs）。
# 詳細と、なぜ Cloudflare Pages をやめたかは CLAUDE.md「公開の仕組み」を参照。
#
# 2つのモードがある。状況に応じて自動で選ばれる。
#
#   [A] トークンあり … secrets\github_token.txt がある場合
#       リポジトリ作成 → push → GitHub Pages 有効化 まで全部自動。人間の作業ゼロ。
#
#   [B] トークンなし … Windows資格情報に GitHub のログインが残っている場合
#       リポジトリの作成だけ人間が行い（github.com/new で40秒）、
#       remote 設定と push はこのスクリプトが行う。
#       この場合スクリプトはトークンの値を一切読まない（git が内部で資格情報を使う）。
#
# 日次ランナー(daily_run.ps1)からも自動で呼ばれる。

param(
    [string]$RepoName,
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
if (@(git remote) -contains 'origin') {
    Say "[skip] origin は設定済み: $(git config --get remote.origin.url)" 'DarkGray'
    exit 0
}

# ── 2. 誰として、どのリポジトリに繋ぐか ──────────────────────────────
$Login = git config user.name
if ([string]::IsNullOrWhiteSpace($Login)) {
    Say "[error] git config user.name が未設定です。" 'Red'
    exit 2
}
# ユーザーサイトにしないと絶対パスが404する（CLAUDE.md 参照）
if ([string]::IsNullOrWhiteSpace($RepoName)) { $RepoName = "$Login.github.io" }
$RepoUrl = "https://github.com/$Login/$RepoName"

$TokenFile = Join-Path $Root 'secrets\github_token.txt'
$HasToken = (Test-Path $TokenFile) -and -not [string]::IsNullOrWhiteSpace((Get-Content $TokenFile -Raw))

# ── 3. モードA: トークンがあるならリポジトリ作成まで自動 ──────────────
if ($HasToken) {
    $Token = (Get-Content $TokenFile -Raw).Trim()
    $Headers = @{
        Authorization = "token $Token"
        'User-Agent'  = 'kurashi-keisan-setup'
        Accept        = 'application/vnd.github+json'
    }

    try {
        $me = Invoke-RestMethod -Uri 'https://api.github.com/user' -Headers $Headers -Method Get -ErrorAction Stop
        $Login = $me.login
        $RepoName = "$Login.github.io"
        $RepoUrl = "https://github.com/$Login/$RepoName"
        Say "[ok] 認証できました: $Login" 'Green'
    }
    catch {
        Say "[error] トークンが無効か権限不足です。スコープ 'repo' を付け直してください。" 'Red'
        exit 3
    }

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
            name = $RepoName; description = 'くらしの計算室 — 根拠つきの計算ツール'
            private = $false; auto_init = $false; has_issues = $false; has_wiki = $false
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

    # トークンは remote URL に埋め込まない。埋め込むと git remote -v や logs\ に流出する。
    $CredFile = Join-Path $HOME '.git-credentials'
    $lines = @()
    if (Test-Path $CredFile) {
        $lines = @(Get-Content $CredFile) | Where-Object { $_ -and ($_ -notmatch 'github\.com') }
    }
    $lines = @($lines) + @("https://$($Login):$($Token)@github.com")
    [System.IO.File]::WriteAllText($CredFile, (($lines -join "`n") + "`n"),
        (New-Object System.Text.UTF8Encoding($false)))
    git config --local credential.helper store
}
else {
    # ── モードB: 保存済みの Windows 資格情報に任せる ──────────────────
    # トークンの値はこのスクリプトも Claude も読まない。git が内部で使う。
    Say "[mode] トークン無し。Windows資格情報で push します（値は読みません）" 'DarkGray'
    git config --local credential.helper wincred
}

# ── 4. 公開前ゲート ──────────────────────────────────────────────────
# 初回 push も「公開」である以上、CLAUDE.md の公開前ゲートを必ず通す。
# ここを飛ばすと、検証されていない状態が世界に出る最初の一回になってしまう。
node (Join-Path $Root 'scripts\verify.mjs')
if ($LASTEXITCODE -ne 0) {
    Say "[中止] 公開前ゲート(verify.mjs)が通りませんでした。push しません。" 'Red'
    exit 6
}

# ── 5. remote 設定と push ────────────────────────────────────────────
git remote add origin "$RepoUrl.git"
git branch -M main
git push -u origin main
if ($LASTEXITCODE -ne 0) {
    Say ''
    Say "[error] push に失敗しました。" 'Red'
    Say "        リポジトリ $RepoName がまだ無い場合は、先にここで作ってください:" 'Yellow'
    Say "        https://github.com/new  →  名前を $RepoName / Public / READMEは追加しない" 'Yellow'
    Say "        作ったら、このスクリプトをもう一度実行してください。" 'Yellow'
    git remote remove origin
    exit 5
}
Say "[ok] push しました: $RepoUrl" 'Green'

# ── 6. GitHub Pages を有効化（トークンがある場合のみ自動） ────────────
$PagesUrl = "https://$Login.github.io/"
if ($HasToken) {
    $pagesBody = @{ source = @{ branch = 'main'; path = '/docs' } } | ConvertTo-Json
    try {
        Invoke-RestMethod -Uri "https://api.github.com/repos/$Login/$RepoName/pages" `
            -Headers $Headers -Method Post -Body $pagesBody `
            -ContentType 'application/json' -ErrorAction Stop | Out-Null
        Say "[ok] GitHub Pages を有効化しました" 'Green'
    }
    catch {
        # 409 = 既に有効。それ以外は手動で設定してもらう
        Say "[info] Pages の自動有効化はできませんでした（既に有効な可能性）。" 'DarkGray'
        Say "       確認: $RepoUrl/settings/pages" 'DarkGray'
    }
}
else {
    Say ''
    Say "残りは1箇所だけです（約30秒）:" 'Cyan'
    Say "  $RepoUrl/settings/pages" 'Cyan'
    Say "  Source = 'Deploy from a branch' / Branch = main / フォルダ = /docs → Save" 'Cyan'
}

Say ''
Say "公開URL（反映まで1〜2分）: $PagesUrl" 'Green'
Say "反映されたら state\pipeline.json の site.published_url に書き込むこと。" 'DarkGray'
exit 0
