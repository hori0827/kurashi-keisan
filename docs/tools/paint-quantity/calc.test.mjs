// 塗料必要量ロジックのテスト。境界値を必ず含めること（CLAUDE.md 公開前ゲート）。
//
// このテストの中心は「メーカー公表値の再現」である。
// 缶に書かれた標準塗り面積を入力すると、その缶の容量がそのまま出てくること。
// ここがずれていたら、計算式か転記のどちらかが壊れている。
import {
  PRODUCTS,
  surfacesArea,
  paintableArea,
  coverageRatio,
  customRatio,
  litersNeeded,
  planCans,
  calculate,
} from "./calc.js";

const eq = (name, actual, expected) => ({
  name, ok: Object.is(actual, expected), expected, actual,
});
const close = (name, actual, expected, tol = 1e-9) => ({
  name,
  ok: typeof actual === "number" && Math.abs(actual - expected) <= tol,
  expected: `${expected} (±${tol})`,
  actual,
});
const truthy = (name, actual, expected = true) => ({
  name, ok: actual === expected, expected, actual,
});

const KANPE = PRODUCTS.find((p) => p.id === "kanpe-shitsunai-kabe");
const EX = PRODUCTS.find((p) => p.id === "asahipen-tayouto-ex");
const COLOR = PRODUCTS.find((p) => p.id === "asahipen-tayouto-color");

const ROOM6 = [
  { widthCm: 360, heightCm: 250 }, { widthCm: 270, heightCm: 250 },
  { widthCm: 360, heightCm: 250 }, { widthCm: 270, heightCm: 250 },
];
const OPENINGS6 = [
  { widthCm: 165, heightCm: 170 }, // 腰高窓
  { widthCm: 80, heightCm: 200 },  // ドア
];

export default async () => {
  const out = [];

  // ── 面積 ───────────────────────────────────────────────────────────
  out.push(close("面積 360×250cm = 9.0㎡", surfacesArea([{ widthCm: 360, heightCm: 250 }]), 9));
  out.push(close("面積 count=2 が効く（窓165×170×2）",
    surfacesArea([{ widthCm: 165, heightCm: 170, count: 2 }]), 5.61));
  out.push(close("面積 count省略は1枚扱い",
    surfacesArea([{ widthCm: 165, heightCm: 170 }]), 2.805));
  out.push(close("面積 count=0 は1枚に丸めず無視しない（0以下は1扱い）",
    surfacesArea([{ widthCm: 100, heightCm: 100, count: 0 }]), 1));
  out.push(close("面積 不正な行は無視される",
    surfacesArea([{ widthCm: 360, heightCm: 250 }, { widthCm: 0, heightCm: 250 },
      { widthCm: 200, heightCm: null }, { widthCm: -100, heightCm: 100 }]), 9));
  out.push(eq("面積 空配列は0", surfacesArea([]), 0));
  out.push(eq("面積 undefinedでも落ちない", surfacesArea(undefined), 0));

  // ── 塗る面積: 開口部を差し引く（壁紙ツールとの決定的な違い） ────────
  out.push(close("塗る面積 6畳4面 31.5㎡ − 窓2.805 − ドア1.6 = 27.095㎡",
    paintableArea(ROOM6, OPENINGS6), 27.095));
  out.push(close("塗る面積 開口部なしなら総面積のまま", paintableArea(ROOM6, []), 31.5));
  out.push(eq("塗る面積 開口部が壁より大きくても負にならない（境界）",
    paintableArea([{ widthCm: 100, heightCm: 100 }], [{ widthCm: 200, heightCm: 200 }]), 0));

  // ── 塗布量レンジ: メーカー公表値からの導出 ──────────────────────────
  out.push(close("塗布量 カンペハピオ室内かべ用 下限 7.0㎡/L", coverageRatio(KANPE).minPerL, 7, 1e-9));
  out.push(close("塗布量 カンペハピオ室内かべ用 上限 10.0㎡/L", coverageRatio(KANPE).maxPerL, 10, 1e-9));
  out.push(eq("塗布量 カンペハピオは1回塗り基準", coverageRatio(KANPE).basisCoats, 1));
  out.push(eq("塗布量 水性多用途EXは2回塗り基準（取り違え防止）", coverageRatio(EX).basisCoats, 2));
  out.push(eq("塗布量 缶が無ければ null", coverageRatio({ cans: [] }), null));

  // 転記ミス検出: 同一製品の缶ごとの㎡/Lは本来ほぼ一定。
  // 桁や単位を写し間違えるとここで跳ねる。
  for (const p of PRODUCTS) {
    const lo = p.cans.map((c) => c.areaMinM2 / c.volumeL);
    const hi = p.cans.map((c) => c.areaMaxM2 / c.volumeL);
    const spread = Math.max(
      Math.max(...lo) / Math.min(...lo),
      Math.max(...hi) / Math.min(...hi),
    );
    out.push(truthy(`公表値の整合 ${p.maker} ${p.name}: 缶ごとの㎡/Lのばらつきが1.35倍以内`,
      spread <= 1.35));
    out.push(truthy(`公表値の整合 ${p.maker} ${p.name}: すべての缶で 下限面積 < 上限面積`,
      p.cans.every((c) => c.areaMinM2 < c.areaMaxM2 && c.volumeL > 0)));
    out.push(truthy(`出典の明示 ${p.maker} ${p.name}: URLと確認日がある`,
      typeof p.url === "string" && p.url.startsWith("https://") && !!p.confirmedOn));
  }

  // 2社の独立した裏取りが一致していること。片方が改定されたら気づきたい。
  {
    const a = coverageRatio(KANPE);   // カンペハピオ 7.0〜10.0
    const b = coverageRatio(COLOR);   // アサヒペン   約6.9〜9.5
    out.push(truthy("2社突き合わせ 1回塗りの塗布量レンジが重なる",
      a.minPerL <= b.maxPerL && b.minPerL <= a.maxPerL));
  }

  // ── 必要量: 公表値をそのまま逆算できること ──────────────────────────
  {
    // カンペハピオの0.7L缶は「4.9〜7㎡（1回塗り）」。
    // 7㎡を1回塗るなら 0.7L（延びない側）〜 の範囲に収まるはず。
    const r = litersNeeded({ areaM2: 7, coats: 1, ratio: coverageRatio(KANPE), sparePercent: 0 });
    out.push(close("必要量 7㎡×1回 → 最少0.7L（公表の上限面積と一致）", r.minL, 0.7));
    out.push(close("必要量 7㎡×1回 → 最多1.0L", r.maxL, 1));
    out.push(eq("必要量 基準回数と同じなら近似フラグは立たない", r.scaled, false));
  }
  {
    // 境界: 4.9㎡ はカンペハピオ0.7L缶の「最も食う側」ちょうど
    const r = litersNeeded({ areaM2: 4.9, coats: 1, ratio: coverageRatio(KANPE), sparePercent: 0 });
    out.push(close("必要量 4.9㎡×1回 → 最多0.7L（缶ちょうど・境界）", r.maxL, 0.7));
    out.push(close("必要量 4.9㎡×1回 → 最少0.49L", r.minL, 0.49));
  }
  {
    // 2回塗り基準の製品を2回塗るなら換算は起きない（factor=1）
    const r = litersNeeded({ areaM2: 77, coats: 2, ratio: coverageRatio(EX), sparePercent: 0 });
    out.push(close("必要量 EX 77㎡×2回 → 最多14.0L", r.maxL, 14));
    out.push(eq("必要量 EXを2回塗りなら近似フラグは立たない", r.scaled, false));
  }
  {
    // 基準と違う回数を指定したら、近似であることを必ず申告する
    const r = litersNeeded({ areaM2: 77, coats: 1, ratio: coverageRatio(EX), sparePercent: 0 });
    out.push(close("必要量 EX 77㎡×1回 → 最多7.0L（比例換算）", r.maxL, 7));
    out.push(eq("必要量 基準と違う回数なら近似フラグが立つ", r.scaled, true));
  }
  {
    const one = litersNeeded({ areaM2: 20, coats: 1, ratio: coverageRatio(KANPE) });
    const two = litersNeeded({ areaM2: 20, coats: 2, ratio: coverageRatio(KANPE) });
    out.push(close("必要量 塗り回数2倍で必要量も2倍", two.maxL, one.maxL * 2));
  }
  {
    const r = litersNeeded({ areaM2: 70, coats: 1, ratio: coverageRatio(KANPE), sparePercent: 10 });
    out.push(close("必要量 予備10%は最多側に乗る", r.recommendedL, 11));
    out.push(close("必要量 予備は最多側の値そのものは変えない", r.maxL, 10));
  }
  out.push(eq("必要量 面積0なら0",
    litersNeeded({ areaM2: 0, coats: 2, ratio: coverageRatio(KANPE) }).recommendedL, 0));
  out.push(eq("必要量 ratioが無くても落ちない",
    litersNeeded({ areaM2: 30, coats: 2, ratio: null }).recommendedL, 0));
  out.push(eq("必要量 塗り回数0なら0",
    litersNeeded({ areaM2: 30, coats: 0, ratio: coverageRatio(KANPE) }).recommendedL, 0));

  // 缶の値を直接入れる経路
  {
    const r = customRatio({ areaM2: 16, volumeL: 1.6, basisCoats: 1 });
    out.push(close("自由入力 16㎡/1.6L = 10㎡/L", r.minPerL, 10));
    out.push(eq("自由入力 不正なら null", customRatio({ areaM2: 0, volumeL: 1.6 }), null));
  }

  // ── 缶の組み合わせ ─────────────────────────────────────────────────
  {
    // 4.9L 必要・缶は 0.7/1.6/3/7L。本数を増やすほど余りが減るはず。
    const p = planCans(4.9, [0.7, 1.6, 3, 7]);
    out.push(eq("缶組み 4.9L → 選択肢は5通り", p.options.length, 5));
    out.push(eq("缶組み 最少本数は1缶", p.options[0].canCount, 1));
    out.push(close("缶組み 1缶なら7.0L（余り2.1L）", p.options[0].totalL, 7));
    out.push(close("缶組み 2缶なら6.0L", p.options[1].totalL, 6));
    out.push(close("缶組み 3缶なら5.3L", p.options[2].totalL, 5.3));
    out.push(close("缶組み 4缶なら5.1L", p.options[3].totalL, 5.1));
    out.push(close("缶組み 7缶で余りゼロの4.9L（境界）", p.options[4].totalL, 4.9));
    out.push(close("缶組み 余りゼロのとき wasteL は0", p.options[4].wasteL, 0));
    out.push(truthy("缶組み 本数は昇順",
      p.options.every((o, i) => i === 0 || o.canCount > p.options[i - 1].canCount)));
    out.push(truthy("缶組み 総量は降順（本数と余りはトレードオフ）",
      p.options.every((o, i) => i === 0 || o.totalL < p.options[i - 1].totalL)));
    out.push(truthy("缶組み どの選択肢も必要量以上",
      p.options.every((o) => o.totalL >= 4.9 - 1e-9)));
    out.push(truthy("缶組み 内訳の合計が総量と一致する",
      p.options.every((o) =>
        Math.abs(o.cans.reduce((s, c) => s + c.volumeL * c.count, 0) - o.totalL) < 1e-6)));
    out.push(truthy("缶組み 内訳の本数の合計が canCount と一致する",
      p.options.every((o) => o.cans.reduce((s, c) => s + c.count, 0) === o.canCount)));
  }
  {
    // 必要量が缶ぴったりのとき、余計な選択肢を出さない（境界）
    const p = planCans(3, [0.7, 1.6, 3, 7]);
    out.push(eq("缶組み 3.0Lちょうど → 選択肢は1通り", p.options.length, 1));
    out.push(eq("缶組み 3.0Lちょうど → 1缶", p.options[0].canCount, 1));
    out.push(close("缶組み 3.0Lちょうど → 余り0", p.options[0].wasteL, 0));
  }
  {
    // 浮動小数の誤差で「ぴったり」が1mL超過に化けないこと
    const p = planCans(4.9, [4.9]);
    out.push(eq("缶組み 誤差で1缶が2缶にならない", p.options[0].canCount, 1));
  }
  out.push(eq("缶組み 必要量0なら null", planCans(0, [0.7, 3]), null));
  out.push(eq("缶組み 缶が無ければ null", planCans(5, []), null));
  out.push(eq("缶組み 上限60Lを超えたら null（業務用規模は扱わない）",
    planCans(61, [0.7, 1.6, 3, 7]), null));

  // ── 統合 ───────────────────────────────────────────────────────────
  {
    const r = calculate({
      walls: ROOM6, openings: OPENINGS6,
      productId: "kanpe-shitsunai-kabe", coats: 2, sparePercent: 10,
    });
    out.push(close("統合 6畳の塗る面積 27.095㎡", r.areaM2, 27.095));
    out.push(close("統合 総面積 31.5㎡", r.grossM2, 31.5));
    out.push(close("統合 開口部 4.405㎡", r.openingsM2, 4.405));
    out.push(close("統合 必要量の最多 7.741L", r.need.maxL, 7.741428571428571, 1e-6));
    out.push(close("統合 予備込み推奨 8.516L", r.need.recommendedL, 8.515571428571428, 1e-6));
    out.push(close("統合 缶は7L+1.6L の2缶 = 8.6L", r.plan.options[0].totalL, 8.6));
    out.push(eq("統合 2缶", r.plan.options[0].canCount, 2));
  }
  out.push(eq("統合 引数なしでも落ちない", calculate().areaM2, 0));
  out.push(eq("統合 未知の製品IDでも落ちない", calculate({
    walls: ROOM6, productId: "no-such-product",
  }).need.recommendedL, 0));

  return out;
};
