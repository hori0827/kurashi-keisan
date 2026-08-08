# 公開経路をつなぐ — GitHub リポジトリへの接続と初回 push
#
# 公開先は GitHub Pages（**プロジェクトサイト** / main ブランチの /docs）。
#   https://<login>.github.io/<RepoName>/
#
# ⚠ 2026-08-07 変更: 公開先をユーザーサイト(<login>.github.io)から
#   プロジェクトサイトへ変更した。理由は「安全装置」の項を読むこと。
#   詳細は CLAUDE.md「公開の仕組み」と state/decisions.md 2026-08-07。
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
# ── 安全装置（絶対に外さないこと） ────────────────────────────────────
# ユーザーは同じGitHubアカウントで **別の本番サイトを運用している**。
#   hori0827.github.io = HG Analytics（株式スクリーニング。2026-05-09 開設・102コミット）
# 当初このリポジトリ名を公開先に指定していたが、**既に埋まっていた**。
# 2026-08-07 の日次実行がこれを検出するまで、初回 push は毎回失敗し続けていた。
#
# push が通らないときに `--force` や `-f` を足せば「解決」するが、
# **それは他人の本番サイトを102コミットごと消す操作である。**
# したがって本スクリプトは:
#   1. push 先に既存コミットがあれば **push せずに中止する**
#   2. `--force` を絶対に使わない
# この2点を将来変更しないこと。変更するなら state/decisions.md に理由を残すこと。

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
# 既定はプロジェクトサイト用のリポジトリ名。
# ユーザーサイト（<login>.github.io）は HG Analytics が使用中のため選べない。
if ([string]::IsNullOrWhiteSpace($RepoName)) { $RepoName = 'kurashi-keisan' }
$RepoUrl   = "https://github.com/$Login/$RepoName"
$PagesUrl  = "https://$Login.github.io/$RepoName/"

$TokenFile = Join-Path $Root 'secrets\github_token.txt'
$HasToken  = (Test-Path $TokenFile) -and -not [string]::IsNullOrWhiteSpace((Get-Content $TokenFile -Raw))

# ── 2.5. 独自ドメインが確定しているか ────────────────────────────────
# push と「公開」は別物である。GitHub Pages は Settings→Pages で発行元を
# 設定するまで1枚も公開しない（GitHub公式ドキュメントで確認・2026-08-08）。
# したがって push はドメインを待たずに行ってよいが、**Pages の有効化＝公開の引き金**は
# ドメインが決まるまで引かない。先に引くと <login>.github.io/<repo>/ で公開が始まり、
# 「URLに名前や数字を入れたくない」という要件を満たさないURLが先に世に出てしまう。
$CustomDomain = $null
$PipelinePath = Join-Path $Root 'state\pipeline.json'
if (Test-Path $PipelinePath) {
    try {
        $pipeline = (Get-Content $PipelinePath -Raw -Encoding UTF8) | ConvertFrom-Json
        $CustomDomain = $pipeline.site.custom_domain
    }
    catch {
        Say "[warn] pipeline.json を読めませんでした。ドメイン未確定として扱います。" 'Yellow'
    }
}
$DomainReady = -not [string]::IsNullOrWhiteSpace($CustomDomain)

# ── 3. 安全装置: push 先が空であることを確認する ──────────────────────
# 中身のあるリポジトリに push すると、良くて拒否、最悪は既存サイトの破壊になる。
# 認証なしでも読める公開APIで、押し込む前に必ず確かめる。
$ApiHeaders = @{ 'User-Agent' = 'kurashi-keisan-setup'; Accept = 'application/vnd.github+json' }

$RepoExists = $true
try {
    Invoke-RestMethod -Uri "https://api.github.com/repos/$Login/$RepoName" `
        -Headers $ApiHeaders -Method Get -ErrorAction Stop | Out-Null
}
catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 404) { $RepoExists = $false }
    else {
        Say "[error] GitHub API に到達できませんでした: $($_.Exception.Message)" 'Red'
        Say "        通信を確認して再実行してください。確認できないまま push はしません。" 'Yellow'
        exit 7
    }
}

if ($RepoExists) {
    # 空リポジトリなら commits API が 409 を返す。200 が返るなら中身がある。
    $HasCommits = $true
    try {
        Invoke-RestMethod -Uri "https://api.github.com/repos/$Login/$RepoName/commits?per_page=1" `
            -Headers $ApiHeaders -Method Get -ErrorAction Stop | Out-Null
    }
    catch {
        if ($_.Exception.Response.StatusCode.value__ -eq 409) { $HasCommits = $false }
    }

    if ($HasCommits) {
        Say ''
        Say "[中止] $RepoUrl には既にコミットがあります。push しません。" 'Red'
        Say ''
        Say "  空でないリポジトリへの push は、拒否されるか、既存のサイトを壊します。" 'Yellow'
        Say "  このプロジェクトは実際に一度これを踏んでいます:" 'Yellow'
        Say "  $Login.github.io は HG Analytics（別の本番サイト）が使用中でした。" 'Yellow'
        Say ''
        Say "  対処:" 'Cyan'
        Say "   (a) 別のリポジトリ名を使う  → -RepoName '<別の名前>' を付けて再実行" 'Cyan'
        Say "   (b) このリポジトリが本プロジェクトのものなら（.git を作り直した等）:" 'Cyan'
        Say "       git remote add origin $RepoUrl.git ; git pull --rebase origin main" 'Cyan'
        Say ''
        Say "  ⚠ push --force で通してはいけません。既存の履歴が消えます。" 'Red'
        exit 8
    }
    Say "[ok] リポジトリは空です。push できます: $RepoUrl" 'Green'
}

# ── 4. モードA: トークンがあるならリポジトリ作成まで自動 ──────────────
if ($HasToken) {
    $Token = (Get-Content $TokenFile -Raw).Trim()
    $Headers = @{
        Authorization = "token $Token"
        'User-Agent'  = 'kurashi-keisan-setup'
        Accept        = 'application/vnd.github+json'
    }

    try {
        $me = Invoke-RestMethod -Uri 'https://api.github.com/user' -Headers $Headers -Method Get -ErrorAction Stop
        if ($me.login -ne $Login) {
            # 別アカウントのトークンだと、意図しない場所にリポジトリを作ってしまう
            Say "[info] トークンの所有者は $($me.login) です（git config は $Login）。$($me.login) 側で進めます。" 'DarkGray'
            $Login    = $me.login
            $RepoUrl  = "https://github.com/$Login/$RepoName"
            $PagesUrl = "https://$Login.github.io/$RepoName/"
        }
        Say "[ok] 認証できました: $Login" 'Green'
    }
    catch {
        Say "[error] トークンが無効か権限不足です。スコープ 'repo' を付け直してください。" 'Red'
        exit 3
    }

    if ($RepoExists) {
        Say "[ok] リポジトリは既にあります（空）: $RepoUrl" 'Green'
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

    if (-not $RepoExists) {
        Say ''
        Say "[待ち] リポジトリ $RepoName がまだありません。作成は人間の作業です（約40秒）:" 'Yellow'
        Say "        https://github.com/new" 'Cyan'
        Say "        Repository name = $RepoName ／ Public ／ README等は追加しない" 'Cyan'
        Say "        作ったら、このスクリプトをもう一度実行してください（翌朝の自動実行でも可）。" 'Yellow'
        if (-not $DomainReady) {
            Say "        ⚠ 作成後、Settings→Pages はまだ開かないでください（独自ドメイン取得後に設定します）。" 'Yellow'
            Say "          リポジトリを作って push しただけでは、ページは1枚も公開されません。" 'DarkGray'
        }
        exit 1
    }
}

# ── 5. 公開前ゲート ──────────────────────────────────────────────────
# 初回 push も「公開」である以上、CLAUDE.md の公開前ゲートを必ず通す。
# ここを飛ばすと、検証されていない状態が世界に出る最初の一回になってしまう。
node (Join-Path $Root 'scripts\verify.mjs')
if ($LASTEXITCODE -ne 0) {
    Say "[中止] 公開前ゲート(verify.mjs)が通りませんでした。push しません。" 'Red'
    exit 6
}

# ── 6. remote 設定と push ────────────────────────────────────────────
# ⚠ --force は使わない（冒頭「安全装置」参照）。push が拒否されたら、
#    強制するのではなく必ず原因を調べること。
git remote add origin "$RepoUrl.git"
git branch -M main
git push -u origin main
$Pushed = ($LASTEXITCODE -eq 0)

if (-not $Pushed) {
    # 拒否の理由が「向こうが進んでいる」だけなら、合流すれば通る。--force ではない。
    # これは実際に起きうる: カスタムドメインを Settings→Pages で設定すると、GitHub が
    # CNAME ファイルのコミットをソースブランチに直接追加する
    # （公式ドキュメントで確認・2026-08-08）。そのとき手元は遅れ、push は
    # non-fast-forward で拒否される。ここで --force を選ぶと向こうのコミットが消える。
    Say "[info] push が拒否されました。リモートが進んでいないか調べます（--force は使いません）。" 'Yellow'
    git fetch origin main
    $remoteHead = if ($LASTEXITCODE -eq 0) { (git rev-parse origin/main 2>$null) } else { $null }

    if (-not [string]::IsNullOrWhiteSpace($remoteHead)) {
        Say "[info] リモートに手元に無いコミットがあります。git pull --rebase で合流します。" 'Yellow'
        git pull --rebase origin main
        if ($LASTEXITCODE -eq 0) {
            git push -u origin main
            $Pushed = ($LASTEXITCODE -eq 0)
            if ($Pushed) { Say "[ok] 合流して push しました: $RepoUrl" 'Green' }
        }
        else {
            git rebase --abort 2>$null
            Say "[中止] rebase が競合しました。手元の状態は元に戻してあります。" 'Red'
            Say "        競合内容を確認して手動で解決してください。⚠ --force は使わないこと。" 'Red'
        }
    }
}

if (-not $Pushed) {
    Say ''
    Say "[error] push に失敗しました。リモートは進んでいないので、原因は認証の可能性が高いです。" 'Red'
    Say "        Windows資格情報に $Login のGitHubログインが無いか、期限切れかもしれません。" 'Yellow'
    Say "        確認: コントロールパネル → 資格情報マネージャー → Windows資格情報 → git:https://github.com" 'Yellow'
    Say "        あるいは https://github.com/settings/tokens/new?scopes=repo でトークンを作り" 'Yellow'
    Say "        secrets\github_token.txt に貼れば、次回の実行で全自動になります。" 'Yellow'
    Say "        ⚠ --force を足して通そうとしないこと。" 'Red'
    git remote remove origin
    exit 5
}
Say "[ok] push しました: $RepoUrl" 'Green'

# ── 7. GitHub Pages（＝公開の引き金） ────────────────────────────────
# ドメインが未確定のうちは有効化しない。ここを押すと <login>.github.io/<repo>/ で
# 公開が始まり、「URLに名前や数字を入れたくない」という要件に反するURLが先に世に出る。
# push しただけでは1枚も公開されない（GitHub公式ドキュメント・2026-08-08 確認）ので、
# 待っている間もコードは安全に GitHub 上へ退避できている。
if (-not $DomainReady) {
    Say ''
    Say "[保留] GitHub Pages はまだ有効化しません（独自ドメインが未確定のため）。" 'Yellow'
    Say "       この時点でページは1枚も公開されていません。バックアップと経路確認が済んだ状態です。" 'DarkGray'
    Say ''
    Say "  次にやること: SETUP_HUMAN.md の STEP 1-B（ドメイン取得・10分）" 'Cyan'
    Say "  ドメイン名が決まったら:  node scripts\set_domain.mjs <ドメイン>" 'Cyan'
    Say "  その後 Settings→Pages を設定すれば公開されます（STEP 1-C）。" 'Cyan'
    exit 0
}

$PublicUrl = "https://$CustomDomain/"
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
    Say "残りは1箇所だけです（約40秒）:" 'Cyan'
    Say "  $RepoUrl/settings/pages" 'Cyan'
    Say "  Source = 'Deploy from a branch' / Branch = main / フォルダ = /docs → Save" 'Cyan'
    Say "  Custom domain = $CustomDomain → Save（DNS は SETUP_HUMAN.md STEP 1-D）" 'Cyan'
}

Say ''
Say "公開URL: $PublicUrl" 'Green'
Say "（DNS反映前は $PagesUrl 側で先に見えることがある）" 'DarkGray'
Say "開けたら state\pipeline.json の site.published_url に書き込むこと。" 'DarkGray'
exit 0
