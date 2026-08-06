// 壁紙必要量ロジックのテスト。境界値を必ず含めること（CLAUDE.md 公開前ゲート）。
import { stripCount, stripLengthCm, calculate } from "./calc.js";

const eq = (name, actual, expected) => ({
  name, ok: Object.is(actual, expected), expected, actual,
});

export default async () => [
  // ── 巾数: 端数は切り上げ。割り切れるときに1本多く数えないこと ──
  eq("巾数 180cm/90cm = ちょうど2巾", stripCount(180, 90), 2),
  eq("巾数 181cm/90cm = 3巾（切り上げ）", stripCount(181, 90), 3),
  eq("巾数 89cm/90cm = 1巾（1未満でも1）", stripCount(89, 90), 1),
  eq("巾数 270cm/90cm = ちょうど3巾", stripCount(270, 90), 3),
  eq("巾数 幅0は0", stripCount(0, 90), 0),
  eq("巾数 幅が負なら0", stripCount(-100, 90), 0),
  eq("巾数 ロール幅0で0除算しない", stripCount(180, 0), 0),
  eq("巾数 輸入53cm幅 200cm = 4巾", stripCount(200, 53), 4),

  // ── 1巾の長さ: 柄なしは切りしろ+10cm ──
  eq("柄なし 250cm → 260cm", stripLengthCm(250), 260),
  eq("柄なし 切りしろ0指定", stripLengthCm(250, { cutMarginCm: 0 }), 250),
  eq("柄なし 高さ0は0", stripLengthCm(0), 0),

  // ── 柄合わせ: リリカラの公式例と一致すること ──
  // 縦リピート64cm・天井240cm → 320cm（ceil(240/64)=4、+1リピートで5×64）
  eq("柄あり リリカラ公式例 240cm/R64 → 320cm", stripLengthCm(240, { repeatCm: 64 }), 320),
  // 割り切れる場合も必ず1リピート分を足す（柄合わせの余裕）
  eq("柄あり 256cm/R64 → 320cm（割り切れても+1）", stripLengthCm(256, { repeatCm: 64 }), 320),
  eq("柄あり 10cm/R64 → 128cm", stripLengthCm(10, { repeatCm: 64 }), 128),

  // ── 合計 ──
  (() => {
    // 幅360cm×高さ250cmの壁1面: 4巾 × 260cm = 1040cm = 10.4m
    const r = calculate([{ widthCm: 360, heightCm: 250 }]);
    return eq("合計 1面 4巾×260cm = 1040cm", r.totalCm, 1040);
  })(),
  (() => {
    const r = calculate([{ widthCm: 360, heightCm: 250 }]);
    return eq("発注m 10.4m → 11m（切り上げ）", r.orderMeters, 11);
  })(),
  (() => {
    const r = calculate([{ widthCm: 360, heightCm: 250 }]);
    return eq("推奨m 10.4m×1.1=11.44 → 12m", r.recommendedMeters, 12);
  })(),
  (() => {
    // 6畳間の4面を想定: 360×250, 270×250, 360×250, 270×250
    const walls = [
      { widthCm: 360, heightCm: 250 }, { widthCm: 270, heightCm: 250 },
      { widthCm: 360, heightCm: 250 }, { widthCm: 270, heightCm: 250 },
    ];
    const r = calculate(walls);
    // 4+3+4+3 = 14巾 × 260cm = 3640cm
    return eq("合計 6畳4面で14巾", r.totalStrips, 14);
  })(),
  (() => {
    const r = calculate([
      { widthCm: 360, heightCm: 250 }, { widthCm: 270, heightCm: 250 },
      { widthCm: 360, heightCm: 250 }, { widthCm: 270, heightCm: 250 },
    ]);
    return eq("合計 6畳4面 = 36.4m", r.totalMeters, 36.4);
  })(),
  (() => {
    // 不正な行は無視され、計算を壊さないこと
    const r = calculate([
      { widthCm: 360, heightCm: 250 }, { widthCm: 0, heightCm: 250 },
      { widthCm: 200, heightCm: null },
    ]);
    return eq("不正な行は除外される", r.rows.length, 1);
  })(),
  eq("空配列でも落ちない", calculate([]).totalCm, 0),
  eq("undefinedでも落ちない", calculate(undefined).totalCm, 0),
];
