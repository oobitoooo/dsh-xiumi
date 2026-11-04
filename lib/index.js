// dsh-xiumi —— 把「秀米（XIUMI）图文排版自动化」skill 装进 DSH
//
// 做法：把包内 skill/ 目录同步到 $DSH_HOME/skills/<skill-name>/。
// DSH 的 skills 服务会扫描 user-dsh 根目录并热更新，所以不用重启、也不依赖内部注册 API。
//
// 升级策略（幂等）：
//   - 目标不存在 → 直接写入；
//   - 目标存在且 .dsh-xiumi.json 里版本相同 → 跳过；
//   - 目标存在但版本不同（或没有我们的标记，说明是旧版/手工副本）→ 先备份为
//     <dir>.bak-<时间戳>，再覆盖写入。
//
// 设计约束：apply() 里任何失败只记日志、不抛异常，绝不阻塞宿主启动。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'dsh-xiumi';

const LOG_TAG = '[dsh-xiumi]';
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_SRC = path.join(PLUGIN_ROOT, 'skill');
const STAMP = '.dsh-xiumi.json';

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** DSH 主目录：优先 DSH_HOME，Windows 桌面端默认 ~/.dsh。 */
export function dshHome() {
  const fromEnv = (process.env.DSH_HOME ?? '').trim();
  return fromEnv.length > 0 ? fromEnv : path.join(os.homedir(), '.dsh');
}

/** 读 SKILL.md 的 frontmatter（只需要 name）。 */
export function readSkillName(skillDir) {
  try {
    const raw = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return null;
    const nameLine = m[1].split(/\r?\n/).find((l) => /^name\s*:/.test(l));
    if (!nameLine) return null;
    return nameLine.replace(/^name\s*:\s*/, '').replace(/^["']|["']$/g, '').trim() || null;
  } catch {
    return null;
  }
}

/**
 * 把包内 skill 同步到目标目录。
 * @returns {{status: 'installed'|'updated'|'skipped'|'missing-source', target?: string, backup?: string}}
 */
export function installSkill({ skillDir, version = '0.0.0', force = false } = {}) {
  const src = SKILL_SRC;
  if (!fs.existsSync(path.join(src, 'SKILL.md'))) return { status: 'missing-source', target: skillDir };
  const skillName = readSkillName(src);
  if (!skillName) return { status: 'missing-source', target: skillDir };
  const target = skillDir || path.join(dshHome(), 'skills', skillName);

  const stampPath = path.join(target, STAMP);
  const existing = readJson(stampPath);
  const exists = fs.existsSync(target);

  if (exists && !force && existing?.version === version) {
    return { status: 'skipped', target };
  }

  let backup;
  if (exists) {
    // ⚠️ 备份必须放在「两层以下」：skills 根目录只扫描 `<root>/<name>/SKILL.md`，
    // 如果备份直接叫 `<name>.bak-xxx`，它自己会被当成一个 skill 扫进目录（同名冲突、显示旧内容）。
    const backupDir = path.join(path.dirname(target), '.dsh-xiumi-backups');
    fs.mkdirSync(backupDir, { recursive: true });
    backup = path.join(backupDir, `${path.basename(target)}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    fs.cpSync(target, backup, { recursive: true });
  }

  // 先复制到临时目录，成功后再原子替换，避免"复制失败把技能目录搞没"
  const stage = `${target}.staging-${process.pid}-${Date.now()}`;
  try {
    fs.mkdirSync(stage, { recursive: true });
    fs.cpSync(src, stage, { recursive: true });
    fs.writeFileSync(path.join(stage, STAMP), JSON.stringify({ version, installedAt: new Date().toISOString() }, null, 2) + '\n', 'utf8');
    if (exists) fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(stage, target);
  } catch (error) {
    fs.rmSync(stage, { recursive: true, force: true });
    // 目标已被删除时用备份兜底，保证技能不会消失
    if (exists && backup && fs.existsSync(backup) && !fs.existsSync(target)) fs.cpSync(backup, target, { recursive: true });
    throw error;
  }

  return { status: exists ? 'updated' : 'installed', target, backup };
}

/** 记录安装日志，方便排查"技能没出现"这类问题（宿主没有统一日志文件）。 */
function logLine(line) {
  try {
    const dir = path.join(dshHome(), 'xiumi');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'install.log'), `${new Date().toISOString()} ${line}\n`, 'utf8');
  } catch { /* 日志失败不影响安装 */ }
}

export function apply(ctx, config = {}) {
  const version = readJson(path.join(PLUGIN_ROOT, 'package.json'))?.version ?? '0.0.0';
  const skillDir = typeof config.skillDir === 'string' && config.skillDir.trim() ? config.skillDir.trim() : undefined;

  // 宿主启动/插件热装时，skills 目录可能正被 watcher 扫描（Windows 上偶发 EBUSY 或扫到中间态），
  // 所以延迟执行 + 失败重试，最后再补一次"目录缺失就重建"。
  const attempt = (label) => {
    try {
      const result = installSkill({ skillDir, version, force: config.force === true });
      if (result.status === 'missing-source') {
        logLine(`${label} SKILL.md 缺失，跳过`);
        ctx.logger?.warn?.(`${LOG_TAG} 包内 skill/SKILL.md 缺失，跳过安装`);
        return true;
      }
      logLine(`${label} ${result.status} -> ${result.target}${result.backup ? ' (backup ' + result.backup + ')' : ''}`);
      ctx.logger?.info?.(`${LOG_TAG} skill ${result.status}: ${result.target}`);
      return true;
    } catch (error) {
      logLine(`${label} FAILED: ${String(error)}`);
      ctx.logger?.warn?.(`${LOG_TAG} skill 安装失败（将重试）：${String(error)}`);
      return false;
    }
  };

  const run = (n = 0) => {
    const ok = attempt(`attempt${n + 1}`);
    const target = skillDir || path.join(dshHome(), 'skills', 'xiumi-editor-automation');
    const missing = !fs.existsSync(path.join(target, 'SKILL.md'));
    if (missing && n < 3) {
      setTimeout(() => run(n + 1), 800 * (n + 1));
    } else if (missing) {
      logLine(`give-up: ${target} 仍然不存在`);
      ctx.logger?.warn?.(`${LOG_TAG} 安装后仍找不到 ${target}/SKILL.md，请手动执行 node skill/scripts/install-harnesses.mjs --dir ${path.dirname(target)}`);
    }
  };

  // 首次立刻跑，另在 1.5s 后补一次（宿主启动期 watcher 竞争）
  run(0);
  setTimeout(() => {
    const target = skillDir || path.join(dshHome(), 'skills', 'xiumi-editor-automation');
    if (!fs.existsSync(path.join(target, 'SKILL.md'))) run(0);
    else logLine('post-check ok');
  }, 1500);
}
