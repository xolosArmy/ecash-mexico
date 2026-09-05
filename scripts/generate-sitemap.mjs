import fs from "node:fs";
import { sitePages, canonicalUrl } from "./site-pages.mjs";

// Checkout mtimes are not publication dates. Omit lastmod until editorial
// modification dates are tracked explicitly; repeated builds stay deterministic.
const urls = sitePages().map(
  (file) => `  <url>\n    <loc>${canonicalUrl(file)}</loc>\n  </url>`,
);
fs.writeFileSync(
  "sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>\n`,
);
console.log(`Generated sitemap.xml with ${urls.length} canonical URLs.`);
