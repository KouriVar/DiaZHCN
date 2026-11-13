// WebUI 锚点变体回归：确认反引号扩展没有改变既有 87 条规则的任何变体。
// 真实变体由 tests/variants-harness.jxa 载入 scripts/patch-webui.jxa 后产出；
// 这里逐条与「扩展前的实现」对照，并检查默认锚点集合与 opt-in 行为。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const helperPath = path.join(root, "scripts", "patch-webui.jxa");
const harnessPath = path.join(here, "variants-harness.jxa");
const manifestPath = path.join(root, "manifests", "1.41.1-84131.json");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

// 扩展前的实现，逐字保留，作为回归基线。
function legacyVariants(rule) {
  const escapedSource = rule.source.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const escapedTarget = rule.target.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const singleSource = rule.source.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const singleTarget = rule.target.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return [
    { find: '"' + escapedSource + '"', replace: '"' + escapedTarget + '"' },
    { find: "'" + singleSource + "'", replace: "'" + singleTarget + "'" },
    { find: ">" + rule.source + "<", replace: ">" + rule.target + "<" },
    {
      find: "&quot;" + rule.source + "&quot;",
      replace: "&quot;" + rule.target + "&quot;"
    }
  ];
}

function runHarness(manifestPathToUse) {
  const output = execFileSync(
    "/usr/bin/osascript",
    ["-l", "JavaScript", harnessPath, helperPath, manifestPathToUse],
    { encoding: "utf8" }
  );
  return JSON.parse(output);
}

// 1) 默认清单：锚点集合必须是既有四种，且每条规则的变体与改动前逐字相同。
const actual = runHarness(manifestPath);
assert.equal(actual.length, manifest.webRules.length, "harness must cover every rule");
for (const rule of manifest.webRules) {
  const found = actual.find((item) => item.id === rule.id);
  assert.ok(found, `harness missing rule: ${rule.id}`);
  assert.deepEqual(
    found.anchors,
    ["double", "single", "angle", "entity"],
    `${rule.id}: default anchor set changed`
  );
  assert.deepEqual(
    found.variants,
    legacyVariants(rule),
    `${rule.id}: variants differ from the pre-extension implementation`
  );
}

// 2) 显式声明 webAnchorVariants 时才追加反引号变体，且前四种不变。
const optIn = {
  shortVersion: manifest.shortVersion,
  buildVersion: manifest.buildVersion,
  webAnchorVariants: ["double", "single", "angle", "entity", "template"],
  webRules: manifest.webRules
};
const optInPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dia-zh-variants-")), "optin.json");
fs.writeFileSync(optInPath, JSON.stringify(optIn));
const optInActual = runHarness(optInPath);
for (const rule of manifest.webRules) {
  const found = optInActual.find((item) => item.id === rule.id);
  assert.equal(found.variants.length, 5, `${rule.id}: opt-in must add exactly one variant`);
  assert.deepEqual(
    found.variants.slice(0, 4),
    legacyVariants(rule),
    `${rule.id}: opt-in must not reorder the four legacy variants`
  );
  assert.deepEqual(
    found.variants[4],
    { find: "`" + rule.source + "`", replace: "`" + rule.target + "`" },
    `${rule.id}: template variant is malformed`
  );
}
fs.rmSync(path.dirname(optInPath), { recursive: true, force: true });

console.log(
  `Variants regression passed: ${manifest.webRules.length} rules unchanged, ` +
  `template variant is opt-in only.`
);
