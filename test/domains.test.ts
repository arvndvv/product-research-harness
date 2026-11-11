import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { config } from "../src/config.ts";
const realDomains = new URL("../domains", import.meta.url).pathname;
import { domainFactors, domainMetrics, findDomainPack } from "../src/knowledge.ts";

test("findDomainPack picks the guide for the thing being bought", () => {
  config.paths.domains = realDomains;
  const cases: [string, string | null][] = [
    ["laptop", "laptops.md"],
    ["gaming laptop", "laptops.md"],
    ["laptop ram", "ram.md"],
    ["ssd for laptop", "ssds.md"],
    ["portable ssd for macbook", "ssds.md"],
    ["smart tv", "tvs.md"],
    ["55 inch OLED TV", "tvs.md"],
    ["gaming monitor", "monitors.md"],
    ["smart watch", "smartwatches.md"],
    ["wireless headphones", "headphones.md"],
    ["true wireless earbuds", "earbuds.md"],
    ["graphics card", "gpus.md"],
    ["nas", "nas.md"],
    ["nas drive", "hdds.md"],
    ["1.5 ton inverter ac", "air-conditioners.md"],
    ["mobile phone", "smartphone.md"],
    ["air purifier for bedroom", "air-purifiers.md"],
    ["standing desk", null],
  ];
  for (const [category, expected] of cases) {
    assert.equal(findDomainPack(category)?.name ?? null, expected, category);
  }
});

test("every domain guide parses: aliases, decision factors, valid measurement rows", () => {
  config.paths.domains = realDomains;
  for (const file of readdirSync(config.paths.domains).filter((f) => f.endsWith(".md"))) {
    const text = readFileSync(join(config.paths.domains, file), "utf8");
    const category = file.slice(0, -3).replace(/-/g, " ");
    assert.equal(findDomainPack(category)?.name, file, `${file} is found by its own name`);
    assert.match(text, /^aliases:\s*\S/im, `${file} has an Aliases line`);
    assert.ok(domainFactors(category).length >= 5, `${file} lists decision factors`);
    for (const m of domainMetrics(category)) {
      assert.equal(m.good > m.poor, m.higherIsBetter, `${file} ${m.key}: scale direction matches "better"`);
    }
  }
});
