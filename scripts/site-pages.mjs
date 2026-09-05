import { globSync } from "glob";

export const SITE = "https://ecash.mx";
export const pagePatterns = [
  "index.html",
  "blog/**/*.html",
  "onboarding/**/*.html",
  "identidad/**/*.html",
  "asamblea/**/*.html",
];

export function sitePages() {
  return globSync(pagePatterns, { nodir: true }).sort();
}

export function canonicalUrl(file) {
  return `${SITE}/${file.replace(/(^|\/)index\.html$/, "$1")}`;
}

export function attributes(tag) {
  return Object.fromEntries(
    Array.from(tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g), (match) => [
      match[1].toLowerCase(),
      match[2],
    ]),
  );
}

export function tags(html, name) {
  return Array.from(
    html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi")),
    (match) => attributes(match[0]),
  );
}
