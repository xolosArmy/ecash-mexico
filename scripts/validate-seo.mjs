import fs from "node:fs";
import path from "node:path";
import { SITE, sitePages, canonicalUrl, tags } from "./site-pages.mjs";

const files = sitePages();
const titles = new Set();
const descriptions = new Set();
const sitemap = fs.readFileSync("sitemap.xml", "utf8");
const sitemapUrls = Array.from(
  sitemap.matchAll(/<loc>(.*?)<\/loc>/g),
  (m) => m[1],
);
let failures = 0;

for (const file of files) {
  const html = fs.readFileSync(file, "utf8");
  const errors = [];
  const expected = canonicalUrl(file);
  const metas = tags(html, "meta");
  const meta = (key) =>
    metas.filter((m) => m.name === key || m.property === key);
  const content = (key) => meta(key)[0]?.content;
  const titleMatches = [...html.matchAll(/<title>(.*?)<\/title>/gs)];
  const title = titleMatches[0]?.[1].trim();
  if (titleMatches.length !== 1 || !title)
    errors.push("Exactly one non-empty title is required");
  if (titles.has(title)) errors.push("Duplicate page title");
  titles.add(title);
  if (!/^es(?:-MX)?$/i.test(tags(html, "html")[0]?.lang ?? ""))
    errors.push("Spanish document language missing");
  if (tags(html, "h1").length !== 1) errors.push("Exactly one H1 is required");
  if (!content("viewport")?.includes("width=device-width"))
    errors.push("Responsive viewport missing");
  for (const key of [
    "description",
    "og:title",
    "og:description",
    "og:url",
    "twitter:card",
    "twitter:title",
    "twitter:description",
  ]) {
    if (meta(key).length !== 1 || !content(key)?.trim())
      errors.push(`Missing or duplicate ${key}`);
  }
  if (descriptions.has(content("description")))
    errors.push("Duplicate meta description");
  descriptions.add(content("description"));
  const canonicals = tags(html, "link").filter(
    (link) => link.rel === "canonical",
  );
  if (canonicals.length !== 1 || canonicals[0].href !== expected)
    errors.push(`Canonical must be ${expected}`);
  if (content("og:url") !== expected)
    errors.push("Open Graph URL differs from canonical");
  if (!["summary", "summary_large_image"].includes(content("twitter:card")))
    errors.push("Unsupported social card type");
  for (const key of ["og:image", "twitter:image"]) {
    if (!content(key)) continue;
    const image = new URL(content(key), expected);
    if (
      image.origin === SITE &&
      !fs.existsSync(path.join(process.cwd(), image.pathname))
    )
      errors.push(`Missing social image: ${key}`);
  }
  if (/noindex/i.test(content("robots") ?? ""))
    errors.push("Public page contains noindex");
  if (sitemapUrls.filter((url) => url === expected).length !== 1)
    errors.push("Page must appear exactly once in sitemap");

  const schemas = [
    ...html.matchAll(
      /<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
    ),
  ];
  if (!schemas.length) errors.push("Structured data missing");
  for (const [, source] of schemas) {
    try {
      const schema = JSON.parse(source);
      if (schema["@context"] !== "https://schema.org")
        errors.push("Unexpected schema context");
    } catch {
      errors.push("Invalid JSON-LD");
    }
  }

  for (const link of [
    ...tags(html, "a"),
    ...tags(html, "script"),
    ...tags(html, "link"),
    ...tags(html, "img"),
  ]) {
    const href = link.href ?? link.src;
    if (!href || /^(mailto:|tel:|ecash:|javascript:|data:)/i.test(href))
      continue;
    const url = new URL(href.replaceAll("&amp;", "&"), expected);
    if (url.origin !== SITE) continue;
    const pathname = decodeURIComponent(url.pathname);
    const target = path.join(
      process.cwd(),
      pathname,
      pathname.endsWith("/") ? "index.html" : "",
    );
    if (!fs.existsSync(target)) {
      errors.push(`Broken local reference: ${href}`);
    } else if (url.hash && target.endsWith(".html")) {
      const destination = fs.readFileSync(target, "utf8");
      const id = decodeURIComponent(url.hash.slice(1));
      if (id && !destination.includes(`id="${id}"`))
        errors.push(`Missing anchor: ${href}`);
    }
  }

  if (errors.length) {
    console.error(
      `${file}:\n${[...new Set(errors)].map((e) => `  - ${e}`).join("\n")}`,
    );
    failures += errors.length;
  }
}
const expectedUrls = new Set(files.map(canonicalUrl));
for (const url of sitemapUrls) {
  if (!expectedUrls.has(url)) {
    console.error(`Sitemap contains a non-canonical or missing page: ${url}`);
    failures++;
  }
}
if (failures) process.exit(1);
console.log(
  `SEO passed for all ${files.length} pages: metadata, H1s, JSON-LD, canonicals, sitemap and local links.`,
);
