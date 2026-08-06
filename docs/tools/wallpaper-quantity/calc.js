// 壁紙（クロス）必要量の計算ロジック
//
// このファイルはブラウザとテストの両方から読み込まれる。
// 「テストしたコード」と「出荷したコード」を必ず同一にするため、
// 計算式をHTML側に複製してはならない。
//
// 根拠（2026-08-06 確認）:
//   リリカラ「壁紙クロスの必要メーター数の計算方法」
//     https://shop.lilycolor.co.jp/blogs/how-to/wallpaper-measure
//     - 「基本的に壁紙の巾は約90cm」
//     - 「最低でも天井高に＋10cmは余裕を持ちましょう」
//     - 柄物: 天井高÷縦リピートを切り上げ、さらに柄合わせ用に1リピート分を加算
//       （例: 縦リピート64cm・天井240cm → 1巾あたり320cm）
//     - 初めての施工なら1割ほど多めに購入
//   DIYショップRESTA「壁紙クロスの必要サイズ（数量）の測り方」
//     https://www.diy-shop.jp/info/diy_sz.html
//     - 「壁紙の幅は約90cmで計算します」
//     - 「高さは切りしろ分が必要なので、それぞれ+10cm」
//     - 窓・扉などの開口部は差し引かず、上下に分けて加算する方式
//
// 開口部を差し引かない理由: 窓上・窓下は幅の狭い切れ端になり、
// 別の面へ流用できないことが多い。差し引くと材料不足になる。

export const DEFAULT_ROLL_WIDTH_CM = 90;   // 実寸は92cm前後だが、両社とも90cmで計算する
export const DEFAULT_CUT_MARGIN_CM = 10;   // 切りしろ（上下合計）
export const DEFAULT_SPARE_PERCENT = 10;   // 予備

const isPositive = (n) => typeof n === "number" && Number.isFinite(n) && n > 0;

/** 1面に必要な巾（はば）の数。端数は必ず切り上げる（切り捨てると足りなくなる） */
export function stripCount(wallWidthCm, rollWidthCm = DEFAULT_ROLL_WIDTH_CM) {
  if (!isPositive(wallWidthCm) || !isPositive(rollWidthCm)) return 0;
  return Math.ceil(wallWidthCm / rollWidthCm);
}

/**
 * 1巾あたりに必要な長さ(cm)。
 * 柄合わせがある場合は切りしろではなくリピート単位で決まる（リリカラの方式）。
 */
export function stripLengthCm(
  wallHeightCm,
  { repeatCm = 0, cutMarginCm = DEFAULT_CUT_MARGIN_CM } = {},
) {
  if (!isPositive(wallHeightCm)) return 0;
  if (isPositive(repeatCm)) {
    return (Math.ceil(wallHeightCm / repeatCm) + 1) * repeatCm;
  }
  return wallHeightCm + Math.max(0, cutMarginCm);
}

/**
 * 壁面の配列から必要量を求める。
 * walls: [{ label, widthCm, heightCm }]
 * 戻り値の長さはすべて cm、meters は m。
 */
export function calculate(walls, options = {}) {
  const {
    rollWidthCm = DEFAULT_ROLL_WIDTH_CM,
    repeatCm = 0,
    cutMarginCm = DEFAULT_CUT_MARGIN_CM,
    sparePercent = DEFAULT_SPARE_PERCENT,
  } = options;

  const rows = (walls ?? [])
    .filter((w) => isPositive(w?.widthCm) && isPositive(w?.heightCm))
    .map((w) => {
      const strips = stripCount(w.widthCm, rollWidthCm);
      const perStrip = stripLengthCm(w.heightCm, { repeatCm, cutMarginCm });
      return { ...w, strips, perStripCm: perStrip, totalCm: strips * perStrip };
    });

  const totalCm = rows.reduce((s, r) => s + r.totalCm, 0);
  const totalMeters = totalCm / 100;

  return {
    rows,
    totalStrips: rows.reduce((s, r) => s + r.strips, 0),
    totalCm,
    totalMeters,
    // 実売は1m単位なので切り上げる
    orderMeters: Math.ceil(totalMeters),
    // 予備込みの推奨発注量
    recommendedMeters: Math.ceil(totalMeters * (1 + Math.max(0, sparePercent) / 100)),
    options: { rollWidthCm, repeatCm, cutMarginCm, sparePercent },
  };
}
