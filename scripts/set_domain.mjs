// 独自ドメインを確定させ、必要なファイルを一度に揃える。
//
//   node scripts/set_domain.mjs keisanshitsu.com
//
// やること:
//   1. state/pipeline.json の site.custom_domain / published_url を更新
//   2. docs/CNAME を書く ← これが無いと GitHub Pages でカスタムドメインが効かない
//   3. docs/sitemap.xml と docs/robots.txt を作り直す（gen_sitemap.mjs を呼ぶ）
//
// GitHub Pages は Settings 画面でカスタムドメインを保存すると自分で CNAME ファイルを
// commit しようとする。こちらから先に置いておけば、その勝手なコミットが起きず、
// 「リポジトリの内容 = 公開される内容」という対応が崩れない。

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(ROOT, "docs");
const PIPELINE = join(ROOT, "state", "pipeline.json");

const raw = (process.argv[2] ?? "").trim().toLowerCase()
  .replace(/^https?:\/\//, "").replace(/\/.*$/, "");

if (!raw) {
  console.error("使い方: node scripts/set_domain.mjs <ドメイン>");
  console.error("例:     node scripts/set_domain.mjs keisanshitsu.com");
  process.exit(1);
}
// www 付きで渡されたら apex に直す（Aレコードを張るのは apex 側）
const domain = raw.replace(/^www\./, "");

if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
  console.error(`ドメインの形式が不正です: ${domain}`);
  process.exit(1);
}
if (!existsSync(SITE)) {
  console.error("docs/ が見つかりません");
  process.exit(1);
}

const pipeline = JSON.parse(readFileSync(PIPELINE, "utf8"));
pipeline.site = {
  ...(pipeline.site ?? {}),
  custom_domain: domain,
  published_url: `https://${domain}/`,
  // Search Console は独自ドメインなら「ドメインプロパティ」が使える。
  // www有無・http/https をまとめて計測でき、取りこぼしが出ない。
  gsc_property: `sc-domain:${domain}`,
};
writeFileSync(PIPELINE, JSON.stringify(pipeline, null, 2) + "\n", "utf8");
console.log(`pipeline.json を更新: ${domain}`);

// CNAME は改行1つで終わる1行のプレーンテキスト。余計なものを書かない
writeFileSync(join(SITE, "CNAME"), domain + "\n", "utf8");
console.log(`docs/CNAME を作成: ${domain}`);

execFileSync(process.execPath, [join(ROOT, "scripts", "gen_sitemap.mjs")], { stdio: "inherit" });

console.log("");
console.log("次にやること:");
console.log(`  1. GitHub Settings→Pages の Custom domain に ${domain} を入力`);
console.log("  2. DNSに A×4 / AAAA×4 / www CNAME を登録（SETUP_HUMAN.md STEP 1-4）");
console.log("  3. node scripts/verify.mjs で確認してから commit / push");
