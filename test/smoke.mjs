// 冒烟测试：文件完整性 + 语法检查 + frontmatter + 安装逻辑（写到临时目录）
// 运行：node test/smoke.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const ok = [];
function check(name, fn) {
  try { fn(); ok.push(name); } catch (e) { fails.push(`${name}: ${e.message}`); }
}

check('package.json 可解析且带 dsh.bundle.patch', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'dsh-xiumi');
  assert.ok(pkg.dsh?.bundle?.patch, 'missing dsh.bundle.patch');
  assert.ok(fs.existsSync(path.join(ROOT, pkg.dsh.bundle.patch)), 'patch file missing');
});

check('cordis.patch.yml 含 insert 行', () => {
  const yml = fs.readFileSync(path.join(ROOT, 'cordis.patch.yml'), 'utf8');
  assert.match(yml, /-\s*insert:/);
  assert.match(yml, /id:\s*dsh-xiumi/);
});

check('SKILL.md frontmatter 含 name/description', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'skill', 'SKILL.md'), 'utf8');
  assert.match(raw, /^---\r?\n/);
  assert.match(raw, /name:\s*xiumi-editor-automation/);
  assert.match(raw, /description:\s*\S+/);
});

check('skill 引用的文件都存在', () => {
  for (const rel of [
    'skill/references/edge-cdp-setup.md',
    'skill/references/dom-playbook.md',
    'skill/references/gallery-recipe.md',
    'skill/scripts/launch-browser.mjs',
    'skill/scripts/xiumi-lib.mjs',
    'skill/scripts/xiumi-gallery.mjs',
    'skill/scripts/xiumi-audit.mjs',
    'skill/scripts/xiumi-session.mjs',
    'skill/scripts/install-harnesses.mjs',
    'skill/scripts/cdp.mjs',
  ]) assert.ok(fs.existsSync(path.join(ROOT, rel)), `missing ${rel}`);
});

check('所有 JS 语法检查通过', () => {
  const files = ['lib/index.js', 'test/smoke.mjs',
    'skill/scripts/launch-browser.mjs', 'skill/scripts/xiumi-lib.mjs',
    'skill/scripts/xiumi-gallery.mjs', 'skill/scripts/xiumi-audit.mjs',
    'skill/scripts/xiumi-session.mjs', 'skill/scripts/install-harnesses.mjs', 'skill/scripts/cdp.mjs'];
  for (const rel of files) {
    const r = spawnSync(process.execPath, ['--check', path.join(ROOT, rel)], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${rel} 语法错误: ${r.stderr}`);
  }
});

// ---- 安装逻辑：写到临时目录，验证幂等与备份 ----
const mod = await import(pathToFileURL(path.join(ROOT, 'lib/index.js')).href);

check('模块导出 name/apply/installSkill', () => {
  assert.equal(mod.name, 'dsh-xiumi');
  assert.equal(typeof mod.apply, 'function');
  assert.equal(typeof mod.installSkill, 'function');
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-xiumi-test-'));
const target = path.join(tmp, 'skills', 'xiumi-editor-automation');

check('首次安装：写入目录 + stamp', () => {
  const r = mod.installSkill({ skillDir: target, version: '0.1.0' });
  assert.equal(r.status, 'installed');
  assert.ok(fs.existsSync(path.join(target, 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(target, 'scripts', 'xiumi-lib.mjs')));
  const stamp = JSON.parse(fs.readFileSync(path.join(target, '.dsh-xiumi.json'), 'utf8'));
  assert.equal(stamp.version, '0.1.0');
});

check('同版本再装：跳过', () => {
  const r = mod.installSkill({ skillDir: target, version: '0.1.0' });
  assert.equal(r.status, 'skipped');
});

check('版本变化：先备份再覆盖', () => {
  const r = mod.installSkill({ skillDir: target, version: '0.2.1' });
  assert.equal(r.status, 'updated');
  assert.ok(r.backup && fs.existsSync(r.backup), 'backup 目录不存在');
  // 备份不能落在 skills 根目录下一层，否则会被 skills provider 当成同名 skill 扫到
  assert.equal(path.dirname(r.backup), path.join(path.dirname(target), '.dsh-xiumi-backups'));
  const stamp = JSON.parse(fs.readFileSync(path.join(target, '.dsh-xiumi.json'), 'utf8'));
  assert.equal(stamp.version, '0.2.1');
});

check('升级会清掉旧版本残留文件', () => {
  // 先伪造一个"旧版本残留脚本"，再升级
  const stale = path.join(target, 'scripts', 'launch-edge-cdp.ps1');
  fs.writeFileSync(stale, 'stale', 'utf8');
  const r = mod.installSkill({ skillDir: target, version: '0.2.2' });
  assert.equal(r.status, 'updated');
  assert.equal(fs.existsSync(stale), false, '旧文件仍然存在');
});

check('apply 用假 ctx 跑通并装到 config.skillDir', () => {
  const target2 = path.join(tmp, 'skills2', 'xiumi-editor-automation');
  const infos = [];
  mod.apply({ logger: { info: (m) => infos.push(m), warn: (m) => infos.push('WARN ' + m) } }, { skillDir: target2 });
  assert.ok(fs.existsSync(path.join(target2, 'SKILL.md')), 'apply 未安装 skill');
  assert.ok(infos.some((m) => m.includes('installed')), 'apply 未记录日志');
});

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`✅ ${ok.length} passed`);
if (fails.length) {
  console.error(`❌ ${fails.length} failed:\n` + fails.map((f) => '  - ' + f).join('\n'));
  process.exit(1);
}
