// 塗料（ペンキ）必要量の計算ロジック
//
// このファイルはブラウザとテストの両方から読み込まれる。
// 「テストしたコード」と「出荷したコード」を必ず同一にするため、
// 計算式をHTML側に複製してはならない。
//
// ──────────────────────────────────────────────────────────────────────
// 設計上いちばん大事な判断: 「1Lで何㎡塗れるか」を固定値にしない
// ──────────────────────────────────────────────────────────────────────
// 世の中の計算ツールは「水性なら8㎡/L」のような単一の値を使っているが、
// メーカーが公表しているのは **幅のある範囲** であり、しかも製品ごとに違う。
// さらに「何回塗り基準の面積か」が製品ごとに異なる（1回塗り基準と2回塗り基準が混在する）。
// この2点を無視すると、実際より少ない量を提示して塗料切れを起こす。
// 本ツールはメーカー公表の缶ごとの標準塗り面積をそのまま持ち、範囲で答える。
//
// 出典（すべて 2026-08-06 に各社公式サイトで確認）:
//   カンペハピオ「室内かべ用塗料」 https://www.kanpe.co.jp/products/6000/
//   アサヒペン「水性多用途EX」     https://www.asahipen.jp/products/view/29500
//   アサヒペン「水性スーパーコート」https://www.asahipen.jp/products/view/20003
//   アサヒペン「水性多用途カラー」 https://www.asahipen.jp/products/view/29610
//
// 2社の突き合わせ: 1回塗り基準の塗布量は
//   カンペハピオ 室内かべ用塗料  … 7.0〜10.0 ㎡/L
//   アサヒペン   水性多用途カラー … 約7.1〜9.5 ㎡/L
// と独立に一致した。この一致をもって「1回塗りで概ね7〜10㎡/L」を裏付けとする。

/** メーカー公表値。数値は公式サイトの表記をそのまま転記している（丸めない） */
export const PRODUCTS = [
  {
    id: "kanpe-shitsunai-kabe",
    maker: "カンペハピオ",
    name: "室内かべ用塗料",
    basisCoats: 1,
    forWhat: "室内のかべ（ビニールかべ紙・石こうボード・室内コンクリートかべ・板壁ほか）",
    url: "https://www.kanpe.co.jp/products/6000/",
    confirmedOn: "2026-08-06",
    // 14kg入りもあるが、重量表記のため容量ベースの本計算では扱わない
    cans: [
      { volumeL: 0.7, areaMinM2: 4.9, areaMaxM2: 7 },
      { volumeL: 1.6, areaMinM2: 11.2, areaMaxM2: 16 },
      { volumeL: 3, areaMinM2: 21, areaMaxM2: 30 },
      { volumeL: 7, areaMinM2: 49, areaMaxM2: 70 },
    ],
  },
  {
    id: "asahipen-tayouto-ex",
    maker: "アサヒペン",
    name: "水性多用途EX",
    basisCoats: 2, // ← 公表値が2回塗り基準。ここを1回塗りと誤読すると倍の誤差になる
    forWhat: "木部・鉄部・しっくい・モルタル・コンクリート壁・板壁・外壁・プラスチック面",
    url: "https://www.asahipen.jp/products/view/29500",
    confirmedOn: "2026-08-06",
    cans: [
      { volumeL: 0.2, label: "1/5L", areaMinM2: 1.1, areaMaxM2: 1.4 },
      { volumeL: 0.7, areaMinM2: 4, areaMaxM2: 5 },
      { volumeL: 1.6, areaMinM2: 9, areaMaxM2: 11 },
      { volumeL: 3, areaMinM2: 17, areaMaxM2: 22 },
      { volumeL: 7, areaMinM2: 40, areaMaxM2: 50 },
      { volumeL: 14, areaMinM2: 80, areaMaxM2: 100 },
    ],
  },
  {
    id: "asahipen-supercoat",
    maker: "アサヒペン",
    name: "水性スーパーコート（一般色）",
    basisCoats: 1,
    forWhat: "鉄部・トタン屋根・コンクリート・サイディング・木部・しっくい・プラスチック面",
    url: "https://www.asahipen.jp/products/view/20003",
    confirmedOn: "2026-08-06",
    cans: [
      { volumeL: 1 / 12, label: "1/12L", areaMinM2: 0.5, areaMaxM2: 0.8 },
      { volumeL: 0.2, label: "1/5L", areaMinM2: 1.4, areaMaxM2: 1.9 },
      { volumeL: 0.7, areaMinM2: 5.0, areaMaxM2: 6.6 },
      { volumeL: 1.6, areaMinM2: 11, areaMaxM2: 15 },
      { volumeL: 5, areaMinM2: 36, areaMaxM2: 47 },
      { volumeL: 10, areaMinM2: 71, areaMaxM2: 94 },
    ],
  },
  {
    id: "asahipen-tayouto-color",
    maker: "アサヒペン",
    name: "水性多用途カラー",
    basisCoats: 1,
    forWhat: "屋内外の木部・鉄部・外壁・へい・しっくい・モルタル・コンクリート壁・板壁",
    url: "https://www.asahipen.jp/products/view/29610",
    confirmedOn: "2026-08-06",
    cans: [
      { volumeL: 0.2, label: "1/5L", areaMinM2: 1.4, areaMaxM2: 1.9 },
      { volumeL: 0.7, areaMinM2: 5.0, areaMaxM2: 6.6 },
      { volumeL: 1.6, areaMinM2: 11, areaMaxM2: 15 },
      { volumeL: 5, areaMinM2: 36, areaMaxM2: 47 },
      { volumeL: 10, areaMinM2: 71, areaMaxM2: 94 },
    ],
  },
];

export const DEFAULT_PRODUCT_ID = "kanpe-shitsunai-kabe";
export const DEFAULT_COATS = 2;
export const DEFAULT_SPARE_PERCENT = 10;

/** 缶の組み合わせを提示する上限。これを超える規模は業務用で、DIYの購入判断ではない */
export const MAX_PLAN_LITERS = 60;

const isPositive = (n) => typeof n === "number" && Number.isFinite(n) && n > 0;
const toMl = (liters) => Math.round(liters * 1000);
/** 浮動小数の誤差で 4900mL が 4901mL に切り上がるのを防ぐ（1nL の許容） */
const ceilMl = (liters) => Math.ceil(liters * 1000 - 1e-6);

/**
 * 面の一覧から面積(㎡)を求める。
 * items: [{ widthCm, heightCm, count }] — count 省略時は1
 * 不正な行（未入力・0・負）は黙って無視する（入力途中で結果が壊れないように）
 */
export function surfacesArea(items) {
  return (items ?? []).reduce((sum, it) => {
    const w = it?.widthCm;
    const h = it?.heightCm;
    if (!isPositive(w) || !isPositive(h)) return sum;
    const raw = it?.count;
    const count = isPositive(raw) ? Math.floor(raw) : 1;
    return sum + (w / 100) * (h / 100) * count;
  }, 0);
}

/**
 * 実際に塗る面積(㎡)。壁紙と違い、塗料では窓・ドアなどの開口部を差し引く。
 * 塗料は液体なので、塗らない面積の分はそのまま不要になるため
 * （壁紙は切れ端が他の面に回せず差し引けない。姉妹ツールとの差はここ）。
 */
export function paintableArea(walls, openings) {
  return Math.max(0, surfacesArea(walls) - surfacesArea(openings));
}

/**
 * 製品の公表値から塗布量の範囲(㎡/L)を求める。
 * basisCoats は「その面積が何回塗り基準か」。ここを取り違えると倍半分ずれる。
 */
export function coverageRatio(product) {
  const cans = (product?.cans ?? []).filter((c) => isPositive(c?.volumeL));
  if (cans.length === 0) return null;
  return {
    minPerL: Math.min(...cans.map((c) => c.areaMinM2 / c.volumeL)),
    maxPerL: Math.max(...cans.map((c) => c.areaMaxM2 / c.volumeL)),
    basisCoats: isPositive(product.basisCoats) ? product.basisCoats : 1,
  };
}

/** 缶に書かれた値を直接入れてもらう場合（プリセットに無い製品用） */
export function customRatio({ areaM2, volumeL, basisCoats = 1 } = {}) {
  if (!isPositive(areaM2) || !isPositive(volumeL)) return null;
  const perL = areaM2 / volumeL;
  return { minPerL: perL, maxPerL: perL, basisCoats: isPositive(basisCoats) ? basisCoats : 1 };
}

/**
 * 必要な塗料の量(L)。
 * 塗布量が範囲で公表されている以上、答えも範囲で返すのが正しい。
 *   よく延びる側(maxPerL) → 少なくて済む = minL
 *   延びない側(minPerL)   → 多く要る     = maxL
 * 希望の塗り回数が公表値の基準回数と違う場合は、1回あたり同量として比例させる。
 * これは近似なので scaled:true を立て、UI側で明示する。
 */
export function litersNeeded({ areaM2, coats = 1, ratio, sparePercent = 0 } = {}) {
  const empty = { minL: 0, maxL: 0, recommendedL: 0, scaled: false };
  if (!ratio || !isPositive(areaM2) || !isPositive(coats)) return empty;
  if (!isPositive(ratio.minPerL) || !isPositive(ratio.maxPerL)) return empty;

  const factor = coats / ratio.basisCoats;
  const minL = (areaM2 / ratio.maxPerL) * factor;
  const maxL = (areaM2 / ratio.minPerL) * factor;
  const spare = Math.max(0, sparePercent) / 100;

  return {
    minL,
    maxL,
    // 推奨は「最も塗料を食う側」に予備を足す。足りないほうが損失が大きいため
    recommendedL: maxL * (1 + spare),
    scaled: coats !== ratio.basisCoats,
  };
}

function reconstruct(volumeMl, from, sizes) {
  const counts = new Map();
  let v = volumeMl;
  let guard = 0;
  while (v > 0) {
    if (++guard > 10000) return null;
    const i = from[v];
    if (i < 0) return null;
    const key = sizes[i].volumeL;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    v -= sizes[i].ml;
  }
  return [...counts.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([volumeL, count]) => ({ volumeL, count }));
}

/**
 * 缶の組み合わせ。
 *
 * 「合計が必要量以上になる買い方」は無数にあり、本数を減らすほど余りが増える。
 * どちらが得かは実売価格しだいで、価格は裏取りできない（改定も頻繁）ので断定しない。
 * そこで **本数と余りのトレードオフの一覧**（パレート最適）を返し、選択は利用者に委ねる。
 * これが本ツールが他の計算ツールと最も違うところ。
 *
 * 戻り値の options は本数の昇順（＝余りの降順）。
 */
export function planCans(litersNeededL, canVolumesL, { maxCans = 8 } = {}) {
  if (!isPositive(litersNeededL)) return null;
  if (litersNeededL > MAX_PLAN_LITERS) return null;

  const sizes = [...new Set((canVolumesL ?? []).filter(isPositive))]
    .map((volumeL) => ({ volumeL, ml: toMl(volumeL) }))
    .filter((s) => s.ml > 0)
    .sort((a, b) => a.ml - b.ml);
  if (sizes.length === 0) return null;

  const target = ceilMl(litersNeededL);
  const largest = sizes[sizes.length - 1].ml;
  const cap = target + largest;

  // dp[v] = 合計がちょうど v mL になる最小の缶数
  const INF = 0x3fffffff;
  const dp = new Int32Array(cap + 1).fill(INF);
  const from = new Int32Array(cap + 1).fill(-1);
  dp[0] = 0;
  for (let v = 1; v <= cap; v++) {
    for (let i = 0; i < sizes.length; i++) {
      const s = sizes[i].ml;
      if (s > v || dp[v - s] >= INF) continue;
      if (dp[v - s] + 1 < dp[v]) {
        dp[v] = dp[v - s] + 1;
        from[v] = i;
      }
    }
  }

  const options = [];
  let seen = null;
  for (let k = 1; k <= maxCans; k++) {
    let best = -1;
    for (let v = target; v <= cap; v++) {
      if (dp[v] <= k) { best = v; break; }
    }
    if (best < 0 || best === seen) continue;
    seen = best;
    const cans = reconstruct(best, from, sizes);
    if (!cans) continue;
    options.push({
      canCount: dp[best],
      cans,
      totalL: best / 1000,
      wasteL: best / 1000 - litersNeededL,
    });
  }

  return options.length ? { neededL: litersNeededL, options } : null;
}

/** 画面から呼ぶ入口。ここだけ使えば個別の関数を知らなくてよい */
export function calculate(input = {}) {
  const {
    walls = [],
    openings = [],
    productId = DEFAULT_PRODUCT_ID,
    customSpec = null,
    coats = DEFAULT_COATS,
    sparePercent = DEFAULT_SPARE_PERCENT,
  } = input;

  const product = customSpec ? null : PRODUCTS.find((p) => p.id === productId) ?? null;
  const ratio = product ? coverageRatio(product) : customRatio(customSpec ?? {});

  const grossM2 = surfacesArea(walls);
  const openingsM2 = surfacesArea(openings);
  const areaM2 = paintableArea(walls, openings);
  const need = litersNeeded({ areaM2, coats, ratio, sparePercent });

  const canVolumes = product
    ? product.cans.map((c) => c.volumeL)
    : (customSpec?.canVolumesL ?? []);

  return {
    grossM2,
    openingsM2,
    areaM2,
    ratio,
    product,
    need,
    plan: planCans(need.recommendedL, canVolumes),
    options: { coats, sparePercent },
  };
}
