# 自律収益プロジェクト — 週次レビュー
#
# 日次ループは「今日の1手」しか打たない。俯瞰して戦略を見直す役はこちらが担う。
# 毎週日曜に1回。

$ErrorActionPreference = 'Continue'

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$LogDir = Join-Path $Root 'logs'
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$Log = Join-Path $LogDir ("weekly_{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))

"===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') 週次レビュー開始 =====" | Add-Content $Log -Encoding utf8

$Prompt = @'
あなたはこのプロジェクトの自律運用を担っている。まず CLAUDE.md を読むこと。

今回は日次ループではなく【週次レビュー】を行う。今日の1手を打つのではなく、
一段上から現状を評価し、必要なら方針そのものを修正せよ。

1. state/decisions.md と state/pipeline.json を読み、この1週間に何をしたかを把握する
2. 公開済みツールごとに、流入と収益の実績を確認する（計測基盤が無ければその旨を記録）
3. 次の問いに、憶測でなく記録された事実にもとづいて答える:
   - 今のペースで月10万円に到達しうるか。到達しないなら何がボトルネックか
   - 外したツールに共通点はあるか。選定スコアリングの基準を修正すべきか
   - 日次ループの「意思決定ルール」は機能しているか。空回りしていないか
4. pipeline.json の facts_to_recheck を確認し、再検証期限が近い制度は
   官公庁の一次情報で裏を取り直す。改定があればツールを即修正する
5. 結論を state/decisions.md に「週次レビュー」として1件記録する。
   方針を変えるなら CLAUDE.md 自体を書き換えてよい（理由を必ず添えること）
6. 人間の作業が必要になったものは SETUP_HUMAN.md に追記する
7. 変更を git commit する

正直に書くこと。うまくいっていないなら、うまくいっていないと記録せよ。
成果を良く見せる記述は、将来の自分の判断を誤らせるので有害である。
'@

$Allowed = @(
    'Read,Write,Edit,Glob,Grep,WebSearch,WebFetch,TodoWrite'
    'Bash(git add:*),Bash(git commit:*),Bash(git status:*)'
    'Bash(git log:*),Bash(git diff:*),Bash(git push:*),Bash(git remote:*)'
    'Bash(py -3 scripts/fetch_metrics.py:*)'
    'Bash(node scripts/verify.mjs:*)'
) -join ','

try {
    & claude -p $Prompt --allowedTools $Allowed --permission-mode acceptEdits 2>&1 |
        Add-Content $Log -Encoding utf8
    "----- 終了コード: $LASTEXITCODE -----" | Add-Content $Log -Encoding utf8
}
catch {
    "!!! 実行エラー: $($_.Exception.Message)" | Add-Content $Log -Encoding utf8
}

"===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') 週次レビュー終了 =====`n" | Add-Content $Log -Encoding utf8
