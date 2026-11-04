// Minimal CDP driver for the Edge instance started with --remote-debugging-port=9222
// Usage:
//   node cdp.mjs targets
//   node cdp.mjs nav <url>
//   node cdp.mjs eval <js-expression>
//   node cdp.mjs click <x> <y> [modifiers]     modifiers: bitmask Shift=8 Ctrl=2 Alt=1
//   node cdp.mjs type <text>
//   node cdp.mjs shot <file.png>
//   node cdp.mjs wait <ms>

const PORT = 9222;
const base = `http://127.0.0.1:${PORT}`;

async function getPage() {
  const list = await (await fetch(`${base}/json`)).json();
  const pages = list.filter(t => t.type === 'page');
  if (!pages.length) throw new Error('no page target');
  return pages[0];
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.seq = 0;
    this.pending = new Map();
    this.ready = new Promise((res, rej) => {
      this.ws.onopen = () => res();
      this.ws.onerror = (e) => rej(new Error('ws error'));
    });
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    };
  }
  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async close() { try { this.ws.close(); } catch {} }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const [cmd, ...args] = process.argv.slice(2);
const page = await getPage();
const cdp = new CDP(page.webSocketDebuggerUrl);
await cdp.ready;
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');

try {
  if (cmd === 'targets') {
    const list = await (await fetch(`${base}/json`)).json();
    for (const t of list) console.log(`${t.type}\t${t.title}\t${t.url}`);
  } else if (cmd === 'nav') {
    await cdp.send('Page.navigate', { url: args[0] });
    await sleep(args[1] ? Number(args[1]) : 4000);
    console.log('navigated');
  } else if (cmd === 'eval') {
    const r = await cdp.send('Runtime.evaluate', { expression: args[0], returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) console.log('EXCEPTION: ' + JSON.stringify(r.exceptionDetails).slice(0, 800));
    else console.log(JSON.stringify(r.result.value));
  } else if (cmd === 'click') {
    const x = Number(args[0]), y = Number(args[1]), mod = Number(args[2] || 0);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers: mod });
    await sleep(80);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, modifiers: mod });
    await sleep(60);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, modifiers: mod });
    console.log(`clicked ${x},${y} mod=${mod}`);
  } else if (cmd === 'wheel') {
    const x = Number(args[0]), y = Number(args[1]), dy = Number(args[2]);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy, modifiers: 0 });
    console.log(`wheel ${dy} at ${x},${y}`);
  } else if (cmd === 'key') {
    // args[0] = key name e.g. ArrowDown, modifiers bitmask
    const key = args[0], mod = Number(args[1] || 0);
    const codes = { ArrowDown: 40, ArrowUp: 38, Enter: 13, Escape: 27, Tab: 9 };
    const vk = codes[key] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: vk, modifiers: mod });
    await sleep(30);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: vk, modifiers: mod });
    console.log(`key ${key} mod=${mod}`);
  } else if (cmd === 'type') {
    await cdp.send('Input.insertText', { text: args[0] });
    console.log('typed');
  } else if (cmd === 'shot') {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const fs = await import('node:fs');
    fs.writeFileSync(args[0], Buffer.from(r.data, 'base64'));
    console.log('saved ' + args[0]);
  } else if (cmd === 'wait') {
    await sleep(Number(args[0] || 1000));
    console.log('waited');
  } else {
    console.log('unknown command');
  }
} finally {
  await cdp.close();
}
