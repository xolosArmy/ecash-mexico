import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("assets/css/network.css", "utf8");

test("roadmap and Tonalli Memo are discoverable in the ecosystem and footer", () => {
  for (const href of [
    "https://roadmap.xolosarmy.xyz/",
    "https://app.tonalli.cash/memo",
  ]) {
    assert.equal(
      html.split(`href="${href}"`).length - 1,
      2,
      `${href} should appear once in the ecosystem and once in the footer`,
    );
  }
  assert.match(html, />Roadmap público</);
  assert.match(html, />Tonalli Memo</);
  assert.match(html, />07 \/ Transparencia</);
  assert.match(html, />08 \/ Memoria verificable</);
  assert.match(html, />09 \/ Cultura e identidad</);
});

test("new ecosystem links keep the existing external-link safety boundary", () => {
  for (const block of [
    /href="https:\/\/roadmap\.xolosarmy\.xyz\/"[\s\S]*?target="_blank"[\s\S]*?rel="noopener noreferrer"/,
    /href="https:\/\/app\.tonalli\.cash\/memo"[\s\S]*?target="_blank"[\s\S]*?rel="noopener noreferrer"/,
  ]) {
    assert.match(html, block);
  }
});

test("proof cards reuse the existing grid and collapse on mobile", () => {
  assert.match(
    css,
    /\.network-proof-grid\s*\{[\s\S]*?grid-column:\s*1 \/ -1;[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/,
  );
  assert.match(
    css,
    /@media \(max-width: 700px\)[\s\S]*?\.network-proof-grid,[\s\S]*?grid-template-columns:\s*1fr;/,
  );
});
