#!/usr/bin/env python3
"""Search Console から流入実績を取得する。

日次ループの手順3「計測」の実体。**無人で完結すること**が設計要件なので、
ブラウザでのOAuth同意を必要としないサービスアカウント認証を使う。

前提（人間側の一度きりの作業。SETUP_HUMAN.md STEP 1.5）:
  1. GCPでサービスアカウントを作り、JSONキーを secrets/gsc_service_account.json に置く
  2. Search Console のプロパティ設定 → ユーザーと権限 → そのサービスアカウントの
     メールアドレスを「フル」権限で追加する
  3. state/pipeline.json の site.gsc_property に対象URLを書く
     現在の値: "https://hori0827.github.io/kurashi-keisan/"（URLプレフィックス型）

     ⚠ 末尾の "/kurashi-keisan/" を必ず含めること。ここを "https://hori0827.github.io/"
     にすると、同じホストで別に稼働している HG Analytics（株式スクリーニング）の
     数字が混入する。流入がどちらのものか区別できなくなり、意思決定ルールの
     #4〜#7 が誤った前提で発火する。独自ドメインへ移行したら
     "sc-domain:<取得したドメイン>" に置き換えてよい。

依存: py -3 -m pip install google-api-python-client google-auth

使い方: py -3 scripts/fetch_metrics.py [--days 28]

終了コード:
  0 = 取得成功、または「まだ計測できない」ことを正常に判定した
  2 = 設定は揃っているのに取得に失敗した（調査が要る状態）

重要: 計測できない場合は流入を 0 ではなく null として記録する。
「ゼロだった」と「測っていない」を混同すると、誰にも見えていないツールの
SEO改善に時間を溶かすことになる。
"""

import argparse
import datetime as dt
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PIPELINE = ROOT / "state" / "pipeline.json"
OUT = ROOT / "state" / "metrics_latest.json"
KEY = ROOT / "secrets" / "gsc_service_account.json"
SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly"]


def emit(payload, code=0):
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    sys.exit(code)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=28)
    args = ap.parse_args()

    stamp = dt.date.today().isoformat()
    base = {"fetched_at": stamp, "window_days": args.days}

    if not PIPELINE.exists():
        emit({**base, "status": "no_pipeline", "sessions": None,
              "hint": "state/pipeline.json が無い"}, 2)

    pipeline = json.loads(PIPELINE.read_text(encoding="utf-8"))
    prop = (pipeline.get("site") or {}).get("gsc_property")

    if not prop:
        emit({**base, "status": "not_configured", "sessions": None,
              "hint": "pipeline.json の site.gsc_property が未設定。まだ公開していない可能性が高い"})

    if not KEY.exists():
        emit({**base, "status": "no_credentials", "sessions": None,
              "hint": f"{KEY} が無い。SETUP_HUMAN.md STEP 1.5 が未完了"})

    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
    except ImportError:
        emit({**base, "status": "missing_deps", "sessions": None,
              "hint": "py -3 -m pip install google-api-python-client google-auth"}, 2)

    end = dt.date.today() - dt.timedelta(days=2)   # GSCは約2日遅れる
    start = end - dt.timedelta(days=args.days - 1)

    try:
        creds = service_account.Credentials.from_service_account_file(str(KEY), scopes=SCOPES)
        api = build("searchconsole", "v1", credentials=creds, cache_discovery=False)

        def query(dimensions):
            return api.searchanalytics().query(siteUrl=prop, body={
                "startDate": start.isoformat(),
                "endDate": end.isoformat(),
                "dimensions": dimensions,
                "rowLimit": 50,
            }).execute().get("rows", [])

        totals = query([])
        pages = query(["page"])
        queries = query(["query"])
    except Exception as e:                                    # noqa: BLE001
        emit({**base, "status": "api_error", "sessions": None,
              "error": f"{type(e).__name__}: {e}",
              "hint": "サービスアカウントがSearch Consoleのユーザーに追加されているか確認する"}, 2)

    t = totals[0] if totals else {}
    emit({
        **base,
        "status": "ok",
        "property": prop,
        "period": {"start": start.isoformat(), "end": end.isoformat()},
        "clicks": t.get("clicks", 0),
        "impressions": t.get("impressions", 0),
        "avg_position": round(t.get("position", 0), 1) if t else None,
        "by_page": [
            {"page": r["keys"][0], "clicks": r["clicks"],
             "impressions": r["impressions"], "position": round(r["position"], 1)}
            for r in pages
        ],
        "top_queries": [
            {"query": r["keys"][0], "clicks": r["clicks"],
             "impressions": r["impressions"], "position": round(r["position"], 1)}
            for r in queries[:20]
        ],
    })


if __name__ == "__main__":
    main()
