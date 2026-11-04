#!/usr/bin/env node
/**
 * 多 harness 安装器（install-harnesses）
 *
 * 思路借鉴 LING71671/autoxiumi 的安装器：把本 skill 装进本机探测到的各个 AI 助手技能目录，
 * 这样它不只服务 DSH，Claude Code / Cursor / Codex / Gemini CLI 等也能用。
 *
 * 用法：
 *   node install-harnesses.mjs --list                 # 只探测，不落盘
 *   node install-harnesses.mjs                        # 装到所有探测到的 harness（用户级）
 *   node install-harnesses.mjs --target dsh,claude    # 指定
 *   node install-harnesses.mjs --dir <技能目录>       # 只装一个目录
 *   node install-harnesses.mjs --project              # 装到当前项目的 .xxx/skills
 *   node install-harnesses.mjs --force                # 覆盖已存在的副本
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_SRC = path.resolve(HERE, '..'); // skill/ 目录
const HOME = os.homedir();
const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf('--' + n); if (i < 0) return d; const v = args[i + 1]; return !v || v.startsWith('--') ? true : v; };

/** harness 路径表：{ id, name, userDir, projectDir, probeDir } */
const HARNESSES = [
  { id: 'dsh', name: 'DeepSeek Harness', userDir: path.join(HOME, '.dsh', 'skills'), probe: path.join(HOME, '.dsh') },
  { id: 'agents', name: '通用 ~/.agents', userDir: path.join(HOME, '.agents', 'skills'), probe: path.join(HOME, '.agents') },
  { id: 'claude', name: 'Claude Code', userDir: path.join(HOME, '.claude', 'skills'), probe: path.join(HOME, '.claude') },
  { id: 'codex', name: 'Codex CLI', userDir: path.join(HOME, '.codex', 'skills'), probe: path.join(HOME, '.codex') },
  { id: 'cursor', name: 'Cursor', userDir: path.join(HOME, '.cursor', 'skills'), probe: path.join(HOME, '.cursor') },
  { id: 'gemini', name: 'Gemini CLI', userDir: path.join(HOME, '.gemini', 'skills'), probe: path.join(HOME, '.gemini') },
  { id: 'copilot', name: 'GitHub Copilot', userDir: path.join(HOME, '.copilot', 'skills'), probe: path.join(HOME, '.copilot') },
  { id: 'opencode', name: 'OpenCode', userDir: path.join(HOME, '.config', 'opencode', 'skills'), probe: path.join(HOME, '.config', 'opencode') },
  { id: 'workbuddy', name: 'WorkBuddy', userDir: path.join(HOME, '.workbuddy', 'skills'), probe: path.join(HOME, '.workbuddy') },
  { id: 'kiro', name: 'Kiro', userDir: path.join(HOME, '.kiro', 'skills'), probe: path.join(HOME, '.kiro') },
  { id: 'windsurf', name: 'Windsurf', userDir: path.join(HOME, '.windsurf', 'skills'), probe: path.join(HOME, '.windsurf') },
  { id: 'antigravity', name: 'Antigravity', userDir: path.join(HOME, '.antigravity', 'skills'), probe: path.join(HOME, '.antigravity') },
];
const PROJECT_DIRS = { claude: '.claude/skills', codex: '.codex/skills', cursor: '.cursor/skills', agents: '.agents/skills', dsh: '.dsh/skills' };
const SKILL_NAME = 'xiumi-editor-automation';

function isInstalled(h) { return fs.existsSync(h.probe); }
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name), d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

const project = !!flag('project');
const force = !!flag('force');
const onlyDir = flag('dir');
const onlyTargets = String(flag('target', '')).split(',').map((s) => s.trim()).filter(Boolean);

const detected = HARNESSES.filter(isInstalled);
console.log('本机探测结果：');
for (const h of detected) console.log(`  ✓ ${h.id.padEnd(12)} ${h.name.padEnd(18)} ${h.userDir}`);
const missing = HARNESSES.filter((h) => !isInstalled(h));
if (missing.length) console.log(`  （未安装：${missing.map((h) => h.id).join(', ')}）`);

if (args.includes('--list')) { process.exit(0); }

let targets;
if (onlyDir) {
  targets = [{ id: 'custom', name: '指定目录', dir: path.resolve(String(onlyDir)) }];
} else if (project) {
  const cwd = process.cwd();
  targets = detected.filter((h) => PROJECT_DIRS[h.id] && (!onlyTargets.length || onlyTargets.includes(h.id)))
    .map((h) => ({ id: h.id, name: h.name + '（项目级）', dir: path.join(cwd, PROJECT_DIRS[h.id]) }));
} else if (onlyTargets.length) {
  targets = HARNESSES.filter((h) => onlyTargets.includes(h.id)).map((h) => ({ id: h.id, name: h.name, dir: h.userDir }));
} else {
  targets = detected.map((h) => ({ id: h.id, name: h.name, dir: h.userDir }));
}

if (!targets.length) { console.error('没有可安装目标。用 --list 看探测结果，或用 --dir 指定目录。'); process.exit(1); }

let changed = 0;
for (const t of targets) {
  const dst = path.join(t.dir, SKILL_NAME);
  if (fs.existsSync(dst) && !force) { console.log(`- 跳过（已存在）：${dst}（加 --force 覆盖）`); continue; }
  copyDir(SKILL_SRC, dst);
  changed++;
  console.log(`✓ 已安装 ${t.name} → ${dst}`);
}
console.log(`\n完成：${changed} 个目录${changed ? '' : '（没有改动）'}。依赖仍需在该目录执行 npm i playwright-core，或设置 XIUMI_PW_CORE。`);
