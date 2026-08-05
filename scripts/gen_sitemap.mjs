// sitemap.xml と robots.txt の Sitemap 行を生成する。
//   node scripts/gen_sitemap.mjs
//
// 公開URL（state/pipeline.json の site.published_url）が確定して初めて動く。
// sitemap は絶対URLを要求するため、URLが無い状態では正しく作れない。

import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(ROOT, "site");

const pipeline = JSON.parse(readFileSync(join(ROOT, "state", "pipeline.json"), "utf8"));
const base = (pipeline.site?.custom_domain || pipeline.site?.published_url || "").replace(/\/$/, "");

if (!base) {
  console.log("published_url が未設定。公開経路の接続（SETUP_HUMAN STEP 1）が先。");
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

console.log(`sitemap.xml を生成: ${urls.length} URL (${base})`);
