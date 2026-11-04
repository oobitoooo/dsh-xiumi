#!/usr/bin/env node
/**
 * 秀米登录态导出/注入（xiumi-session）
 *
 * 解决"复制整个浏览器 profile"太重、Cookies 被锁就失效的问题：
 * 把已登录浏览器里的**秀米 Cookie + LocalStorage** 存成一份 session.json，
 * 之后任何带调试口的浏览器（哪怕全新 profile、没登录过）都能注入这份会话直接用。
 *
 * 思路借鉴 LING71671/xiumi-api 的 sid 会话做法，但走本项目自己的路径：
 * 不逆向登录接口，只搬运浏览器会话（cookie + localStorage），零密码、零风控风险。
 *
 * 用法：
 *   node xiumi-session.mjs export [--out <file>]        # 从已登录的调试浏览器导出
 *   node xiumi-session.mjs apply  [--file <file>] [--open <draftUrl>]
 *   node xiumi-session.mjs status [--file <file>]
 *
 * 默认文件：~/.dsh/xiumi/session.json（.gitignore 已排除，权限 600 更好）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPlaywright } from './xiumi-lib.mjs';

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name, dflt = null) => {
  const i = args.indexOf('--' + name);
  if (i < 0) return dflt;
  const v = args[i + 1];
  return !v || v.startsWith('--') ? true : v;
};
const PORT = Number(flag('port', 9222));
const sessionFile = String(flag('file') || flag('out') || path.join(os.homedir(), '.dsh', 'xiumi', 'session.json'));
const ORIGINS = ['https://xiumi.us', 'https://xiumius.cn', 'https://v.xiumius.cn', 'https://png.xiumi.us'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  const { chromium } = await loadPlaywright();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0];
  return { browser, ctx };
}

function ensureDir(file) { fs.mkdirSync(path.dirname(file), { recursive: true }); }

async function exportSession() {
  const { browser, ctx } = await connect();
  const cookies = await ctx.cookies();
  const xiumiCookies = cookies.filter((c) => /xiumi/i.test(c.domain));
  // localStorage 只对同源页面可读；打开一个秀米页拿
  let page = ctx.pages().find((p) => p.url().includes('xiumi.us'));
  if (!page) { page = await ctx.newPage(); await page.goto('https://xiumi.us/studio/v5', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {}); await sleep(1500); }
  const storage = await page.evaluate(() => {
    const dump = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); dump[k] = localStorage.getItem(k); }
    return dump;
  }).catch(() => ({}));
  const payload = {
    version: 1,
    capturedAt: new Date().toISOString(),
    source: page.url(),
    cookies: xiumiCookies,
    localStorage: { 'https://xiumi.us': storage },
  };
  ensureDir(sessionFile);
  fs.writeFileSync(sessionFile, JSON.stringify(payload, null, 2) + '\n', { mode: 0o600 });
  const sidCookie = xiumiCookies.find((c) => /(^|_)sid$/i.test(c.name));
  console.log(`已导出：${sessionFile}`);
  console.log(`  cookie 数：${xiumiCookies.length}（${xiumiCookies.map((c) => c.name).join(', ') || '无'}）`);
  console.log(`  localStorage 键：${Object.keys(storage).length}`);
  console.log(`  sid：${sidCookie ? '有（' + sidCookie.name + '）' : '未找到（可能登录态在 localStorage）'}`);
  await browser.close().catch(() => {});
}

async function applySession() {
  if (!fs.existsSync(sessionFile)) { console.error('没有 session 文件：' + sessionFile); process.exit(2); }
  const data = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  const { browser, ctx } = await connect();
  const cookies = (data.cookies || []).map((c) => ({
    name: c.name, value: c.value, domain: c.domain, path: c.path || '/',
    expires: typeof c.expires === 'number' ? c.expires : -1,
    httpOnly: !!c.httpOnly, secure: c.secure !== false, sameSite: c.sameSite || 'Lax',
  }));
  await ctx.addCookies(cookies);
  console.log(`已注入 ${cookies.length} 条 cookie（采集于 ${data.capturedAt}）`);

  const page = await ctx.newPage();
  const target = String(flag('open') || 'https://xiumi.us/studio/v5');
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log('导航失败：' + e.message));
  await sleep(3500);
  // localStorage 注入后需要 reload 才被应用
  const origin = new URL(page.url()).origin;
  const ls = data.localStorage?.[origin] || data.localStorage?.['https://xiumi.us'];
  if (ls && Object.keys(ls).length) {
    await page.evaluate((kv) => { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); }, ls);
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await sleep(3500);
  }
  const state = await page.evaluate(() => {
    const t = document.body.innerText || '';
    return {
      url: location.href,
      loggedOut: /登录|扫码登录|账户未登录/.test(t) && !/退出登录|我的秀米/.test(t),
      hasCanvas: !!document.querySelector('.tn-page'),
      hasUserMenu: /我的秀米|退出登录|个人中心/.test(t),
    };
  }).catch(() => ({ url: page.url() }));
  console.log('登录态检查：' + JSON.stringify(state));
  if (state.loggedOut) { console.log('⚠️ 仍像未登录：可能 cookie 已过期，重新 export 一份。'); process.exitCode = 1; }
  await browser.close().catch(() => {});
}

function status() {
  if (!fs.existsSync(sessionFile)) { console.log('没有 session 文件：' + sessionFile); return; }
  const d = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  const now = Date.now() / 1000;
  const rows = (d.cookies || []).map((c) => ({ name: c.name, domain: c.domain, exp: c.expires && c.expires > 0 ? new Date(c.expires * 1000).toISOString().slice(0, 16) : 'session', expired: c.expires > 0 && c.expires < now }));
  console.log(JSON.stringify({ file: sessionFile, capturedAt: d.capturedAt, source: d.source, cookies: rows }, null, 2));
}

(async () => {
  if (cmd === 'export') return exportSession();
  if (cmd === 'apply') return applySession();
  if (cmd === 'status') return status();
  console.error('用法: node xiumi-session.mjs <export|apply|status> [--file <file>] [--open <url>] [--port 9222]');
  process.exit(2);
})().catch((e) => { console.error('ERROR', e.message); process.exit(2); });
