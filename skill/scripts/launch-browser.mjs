#!/usr/bin/env node
/**
 * 启动一个「带远程调试口」的 Edge/Chrome，并把已登录 profile 的登录态复制过去。
 *
 * 为什么需要：Chrome/Edge 136+ 不允许默认 profile 开 --remote-debugging-port。
 * 解法：把用户日常 profile 的关键登录态文件复制到一个独立目录，用该目录启动。
 *
 * 用法：
 *   node launch-browser.mjs                 # 自动找 Edge/Chrome + 复制 profile + 起端口 9222
 *   node launch-browser.mjs --browser chrome --port 9223
 *   node launch-browser.mjs --profile "/path/to/User Data" --fresh   # 重新复制登录态
 *
 * 注意：复制时如果原浏览器正在运行，Cookies 可能被独占锁定而复制失败；
 * 此时请先完全退出原浏览器，或直接在调试窗口里扫码登录一次（登录态会留在复制体里）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (name, dflt = null) => {
  const i = args.indexOf('--' + name);
  if (i < 0) return dflt;
  const v = args[i + 1];
  return !v || v.startsWith('--') ? true : v;
};

const port = Number(flag('port', 9222));
const browserName = String(flag('browser', process.platform === 'win32' ? 'edge' : 'edge'));
const fresh = !!flag('fresh');
const cdpProfileDir = path.join(os.homedir(), '.dsh', 'xiumi', 'browser-profile');

function candidates() {
  const env = process.env;
  if (process.platform === 'win32') {
    const pf = env['ProgramFiles'] || 'C:\\Program Files';
    const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const local = env['LOCALAPPDATA'] || path.join(os.homedir(), 'AppData', 'Local');
    return {
      edge: {
        bins: [
          path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        ],
        data: path.join(local, 'Microsoft', 'Edge', 'User Data'),
      },
      chrome: {
        bins: [
          path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        ],
        data: path.join(local, 'Google', 'Chrome', 'User Data'),
      },
    };
  }
  if (process.platform === 'darwin') {
    const home = os.homedir();
    return {
      edge: {
        bins: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
        data: path.join(home, 'Library', 'Application Support', 'Microsoft Edge'),
      },
      chrome: {
        bins: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
        data: path.join(home, 'Library', 'Application Support', 'Google', 'Chrome'),
      },
    };
  }
  const home = os.homedir();
  return {
    edge: {
      bins: ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/opt/microsoft/msedge/msedge'],
      data: path.join(home, '.config', 'microsoft-edge'),
    },
    chrome: {
      bins: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
      data: path.join(home, '.config', 'google-chrome'),
    },
  };
}

const table = candidates();
const spec = table[browserName];
if (!spec) {
  console.error(`未知浏览器: ${browserName}（可选 edge / chrome）`);
  process.exit(2);
}
const bin = spec.bins.find((p) => fs.existsSync(p));
if (!bin) {
  console.error(`没找到 ${browserName}。已尝试:\n  ${spec.bins.join('\n  ')}`);
  process.exit(2);
}
const srcData = String(flag('profile', spec.data));

function copyFileShared(from, to) {
  try {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    return true;
  } catch {
    return false;
  }
}

function copyTreeShared(from, to) {
  let ok = 0, fail = 0;
  let entries = [];
  try { entries = fs.readdirSync(from, { withFileTypes: true }); } catch { return { ok, fail: 1 }; }
  for (const ent of entries) {
    const s = path.join(from, ent.name);
    const d = path.join(to, ent.name);
    if (ent.isDirectory()) {
      const r = copyTreeShared(s, d);
      ok += r.ok; fail += r.fail;
    } else if (ent.isFile()) {
      if (copyFileShared(s, d)) ok++; else fail++;
    }
  }
  return { ok, fail };
}

function copyProfile() {
  if (fs.existsSync(cdpProfileDir) && !fresh) {
    console.log(`profile 已存在，复用: ${cdpProfileDir}（要重新复制加 --fresh）`);
    return;
  }
  console.log(`复制登录态：\n  从 ${srcData}\n  到 ${cdpProfileDir}`);
  fs.mkdirSync(path.join(cdpProfileDir, 'Default'), { recursive: true });
  for (const f of ['Local State']) copyFileShared(path.join(srcData, f), path.join(cdpProfileDir, f));
  for (const f of ['Preferences', 'Cookies', 'Login Data', 'Web Data']) {
    copyFileShared(path.join(srcData, 'Default', f), path.join(cdpProfileDir, 'Default', f));
  }
  for (const dir of ['Local Storage', 'Session Storage', 'IndexedDB', 'Network', 'WebStorage']) {
    const s = path.join(srcData, 'Default', dir);
    if (fs.existsSync(s)) {
      const r = copyTreeShared(s, path.join(cdpProfileDir, 'Default', dir));
      console.log(`  Default/${dir}: ${r.ok} ok, ${r.fail} failed`);
    }
  }
  console.log('复制完成。若源浏览器正在运行，Cookies 可能复制失败（登录态没带过来）——关掉源浏览器重跑 --fresh，或直接在调试窗口登录一次。');
}

async function probe() {
  const url = `http://127.0.0.1:${port}/json/version`;
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return await res.json();
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

async function main() {
  copyProfile();
  const child = spawn(bin, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${cdpProfileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { detached: true, stdio: 'ignore' });
  child.unref();
  console.log(`已启动: ${bin} (pid ${child.pid})`);
  const info = await probe();
  if (!info) {
    console.error(`CDP 没起来：http://127.0.0.1:${port}/json/version 无响应。`);
    console.error('排查：浏览器版本是否 136+、是否已有同 user-data-dir 实例在跑、端口是否被占用。');
    process.exit(1);
  }
  console.log('CDP OK:', JSON.stringify({ Browser: info.Browser, 'Protocol-Version': info['Protocol-Version'] }));
  console.log(`下一步：在这个浏览器里打开草稿编辑页，例如`);
  console.log('  https://xiumi.us/studio/v5#/paper/for/<草稿id>/cube/0');
  console.log('然后运行: node xiumi-gallery.mjs status');
}

main().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
