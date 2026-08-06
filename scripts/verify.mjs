// 公開前ゲート — 無人実行できる形の品質検証
//
//   node scripts/verify.mjs
//
// 設計方針: 「ブラウザで目視確認」は headless の自動実行では物理的に不可能である。
// 実行できない規則を憲法に書くと、毎晩破られて憲法全体が形骸化する。
// そこで目視を、機械が実行できる検査に置き換えたのが本スクリプト。
//
// puppeteer が入っていれば 375px の実レンダリングまで検証する（任意）:
//   npm i -D puppeteer
// 入っていない場合は静的検査のみで続行し、その旨を明示する。
//
// 終了コード: 0 = 公開可 / 1 = ERROR あり（push 禁止）

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// 公開されるフォルダ。GitHub Pages が「main ブランチの /docs」を配信するため
// この名前でなければならない（CLAUDE.md「公開の仕組み」参照）。
const SITE = join(ROOT, "docs");

const errors = [];
const warns = [];
const err = (f, m) => errors.push(`${f}: ${m}`);
const warn = (f, m) => warns.push(`${f}: ${m}`);

function walk(dir, ext, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, ext, acc);
    else if (name.endsWith(ext)) acc.push(p);
  }
  return acc;
}

// ── 1. HTML の静的検査 ────────────────────────────────────────────────
const pages = walk(SITE, ".html");
if (pages.length === 0) err("docs/", "HTMLが1枚も無い");

for (const page of pages) {
  const rel = relative(ROOT, page).replaceAll("\\", "/");
  const html = readFileSync(page, "utf8");
  const isTool = rel.includes("/tools/");
  const noindex = /name=["']robots["'][^>]*noindex/i.test(html);

  if (!/<html[^>]+lang=["']ja["']/i.test(html)) err(rel, "<html lang='ja'> が無い");
  if (!/name=["']viewport["'][^>]*width=device-width/i.test(html))
    err(rel, "viewport メタタグが無い。スマホで崩れる");

  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1].trim();
  if (!title) err(rel, "<title> が無い");
  else if (title.length > 62) warn(rel, `title が長い(${title.length}字)。検索結果で切れる`);

  const desc = html.match(/name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1];
  if (!desc && !noindex) err(rel, "meta description が無い");
  else if (desc && (desc.length < 50 || desc.length > 160))
    warn(rel, `description が ${desc.length}字（推奨 50〜160）`);

  const h1 = html.match(/<h1[\s>]/gi)?.length ?? 0;
  if (h1 === 0) err(rel, "<h1> が無い。SEO上の基本欠落");
  if (h1 > 1) warn(rel, `<h1> が ${h1} 個ある。1個にする`);

  for (const bad of ["TODO", "FIXME", "XXX", "lorem ipsum", "ダミー", "仮の値"])
    if (html.toLowerCase().includes(bad.toLowerCase()))
      err(rel, `未完成マーカー "${bad}" が残っている`);

  // 内部リンクの死活
  for (const m of html.matchAll(/href=["'](\/[^"'#?]*)["']/g)) {
    let t = m[1];
    if (t.endsWith("/")) t += "index.html";
    if (!existsSync(join(SITE, t))) err(rel, `内部リンク切れ: ${t}`);
  }

  // YMYL 必須表記
  if (isTool) {
    if (!/概算/.test(html)) err(rel, "YMYL必須: 「概算」の明示が無い（ドクトリン違反）");
    if (!/出典|根拠/.test(html)) err(rel, "YMYL必須: 出典の記載が無い（ドクトリン違反）");
    if (!/専門家|税務署|年金事務所/.test(html))
      err(rel, "YMYL必須: 最終判断を専門家に委ねる旨の記載が無い");
  }

  // 横スクロールを生みやすい書き方の検出（静的ヒューリスティック）
  // max-width は可変なので除外し、固定 width / min-width だけを見る
  for (const m of html.matchAll(/(?<!max-)\b(?:min-)?width\s*:\s*(\d{3,})px/gi))
    if (Number(m[1]) > 375) warn(rel, `固定幅 ${m[0].trim()}。375pxで溢れる恐れ`);
  if (/<table/i.test(html) && !/overflow-x\s*:\s*auto/i.test(html))
    warn(rel, "table があるが overflow-x:auto が無い。狭幅で横スクロールが出る");
}

// ── 2. 計算ロジックのテスト ──────────────────────────────────────────
// 各ツールは *.test.mjs を同居させる。テストの無いツールは公開できない。
const toolDirs = existsSync(join(SITE, "tools"))
  ? readdirSync(join(SITE, "tools")).filter((d) => statSync(join(SITE, "tools", d)).isDirectory())
  : [];

let assertions = 0;
for (const dir of toolDirs) {
  const abs = join(SITE, "tools", dir);
  const tests = walk(abs, ".test.mjs");
  if (tests.length === 0) {
    err(`docs/tools/${dir}`, "計算ロジックのテストが無い（公開前ゲート1を通過できない）");
    continue;
  }
  for (const t of tests) {
    const rel = relative(ROOT, t).replaceAll("\\", "/");
    try {
      const mod = await import(pathToFileURL(t).href);
      const cases = mod.default ?? mod.cases;
      if (typeof cases !== "function") { err(rel, "default export が関数でない"); continue; }
      const results = await cases();
      for (const r of results) {
        assertions++;
        if (!r.ok) err(rel, `失敗: ${r.name} — 期待 ${r.expected} / 実際 ${r.actual}`);
      }
    } catch (e) {
      err(rel, `テスト実行時エラー: ${e.message}`);
    }
  }
}

// ── 3. サイト全体の SEO 基盤 ────────────────────────────────────────
if (!existsSync(join(SITE, "robots.txt"))) err("docs/robots.txt", "存在しない");

const pipeline = JSON.parse(readFileSync(join(ROOT, "state", "pipeline.json"), "utf8"));
const published = pipeline.site?.published_url;
if (published && !existsSync(join(SITE, "sitemap.xml")))
  err("docs/sitemap.xml", "公開URLが確定しているのに sitemap が無い。node scripts/gen_sitemap.mjs");

// ── 4. 実レンダリング検証（puppeteer があるときだけ） ────────────────
let rendered = false;
try {
  const { default: puppeteer } = await import("puppeteer");
  const browser = await puppeteer.launch();
  for (const page of pages) {
    const rel = relative(ROOT, page).replaceAll("\\", "/");
    const tab = await browser.newPage();
    await tab.setViewport({ width: 375, height: 812 });
    await tab.goto(pathToFileURL(page).href, { waitUntil: "load" });
    const over = await tab.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 1) err(rel, `375px で ${over}px 横に溢れている`);
    await tab.close();
  }
  await browser.close();
  rendered = true;
} catch { /* 未導入なら静的検査のみで続行 */ }

// ── 結果 ─────────────────────────────────────────────────────────────
console.log(`検査: HTML ${pages.length}枚 / ツール ${toolDirs.length}本 / アサーション ${assertions}件`);
console.log(rendered
  ? "375px 実レンダリング検証: 実施"
  : "375px 実レンダリング検証: スキップ（npm i -D puppeteer で有効化）");

for (const w of warns) console.log(`  WARN  ${w}`);
for (const e of errors) console.log(`  ERROR ${e}`);

if (errors.length) {
  console.log(`\n公開不可: ERROR ${errors.length}件。修正するまで push しないこと。`);
  process.exit(1);
}
console.log(`\n公開可（WARN ${warns.length}件）`);
