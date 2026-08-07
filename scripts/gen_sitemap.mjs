// sitemap.xml と robots.txt の Sitemap 行を生成する。
//   node scripts/gen_sitemap.mjs
//
// 公開URL（state/pipeline.json の site.published_url）が確定して初めて動く。
// sitemap は絶対URLを要求するため、URLが無い状態では正しく作れない。
//
// ⚠ base は必ずスキーム付きの絶対URLにすること（2026-08-07 のドライランでバグ検出）
// pipeline.site.custom_domain は "keisanshitsu.com" のような**スキーム無しの裸のドメイン**。
// これをそのまま連結すると <loc>keisanshitsu.com/</loc> という不正な sitemap と、
// スキーム欠落の Sitemap 行を持つ robots.txt が生成される。どちらも無効で、
// しかも見た目は正常なので気づきにくい。normalizeBase() で必ず正規化する。
//
// robots.txt は **ホストのルートにあるものしか読まれない**。
// 独自ドメイン（サイトのルート = ドメインのルート）なら docs/robots.txt が有効になる。
// プロジェクトサイト配信のままだと無視されるので、その場合は警告を出す。

import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(ROOT, "docs");   // GitHub Pages の配信元（main ブランチの /docs）

const pipeline = JSON.parse(readFileSync(join(ROOT, "state", "pipeline.json"), "utf8"));

/** 裸のドメインでもURLでも受け取り、必ず "https://host[/path]" の形（末尾スラッシュ無し）にする */
function normalizeBase(value) {
  const v = (value ?? "").trim();
  if (!v) return "";
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "";
    return (u.origin + u.pathname).replace(/\/+$/, "");
  } catch {
    return "";
  }
}

const base = normalizeBase(pipeline.site?.custom_domain) ||
             normalizeBase(pipeline.site?.published_url);

if (!base) {
  console.log("公開URLが未設定。公開経路の接続（SETUP_HUMAN STEP 1）が先。");
  process.exit(0);
}

const walk = (dir, acc = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (name.endsWith(".html")) acc.push(p);
  }
  return acc;
};

const urls = walk(SITE)
  .filter((p) => !/name=["']robots["'][^>]*noindex/i.test(readFileSync(p, "utf8")))
  .map((p) => {
    const rel = relative(SITE, p).replaceAll("\\", "/");
    const loc = rel === "index.html" ? "/" : "/" + rel.replace(/\/index\.html$/, "/");
    const lastmod = statSync(p).mtime.toISOString().slice(0, 10);
    return `  <url><loc>${base}${loc}</loc><lastmod>${lastmod}</lastmod></url>`;
  });

writeFileSync(join(SITE, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`,
  "utf8");

writeFileSync(join(SITE, "robots.txt"),
  `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`, "utf8");

console.log(`sitemap.xml を生成: ${urls.length} URL (${base}/)`);

// サイトのルートがドメインのルートと一致しない配信（プロジェクトサイト等）では
// docs/robots.txt はクローラに読まれない。その場合だけ手動送信を促す。
if (new URL(base).pathname !== "/")
  console.log("注意: サブディレクトリ配信のため docs/robots.txt はクローラに読まれない。"
    + `sitemap は Search Console から直接送信すること → ${base}/sitemap.xml`);
