import CDP from 'chrome-remote-interface';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const run = promisify(execFile);
export class NativeCapture {
  closed = false;
  sequence = 0;
  touch = null;
  constructor(info, origin, emit, fail) { this.info = info; this.origin = origin; this.emit = emit; this.fail = fail; }
  async adb(...args) {
    const result = await run(this.config.adbPath, ['-P', String(this.config.serverPort ?? 5037), ...args], { windowsHide: true, timeout: 12000, maxBuffer: 1024 * 1024, env: { ...process.env, ...(this.config.keyPath ? { ADB_VENDOR_KEYS: this.config.keyPath } : {}) } });
    return result.stdout.trim();
  }
  async start() {
    if (!this.info.captureId) throw new Error('请刷新手机上的 DSH 页面以连接原始画面');
    this.config = JSON.parse(await readFile(join(homedir(), '.dsh/mobile-collaboration-capture.json'), 'utf8'));
    await this.adb('start-server');
    const services = await this.adb('mdns', 'services');
    const endpoints = services.split('\n').filter(line => line.includes('_adb-tls-connect._tcp')).map(line => line.trim().split(/\s+/).at(-1));
    for (const endpoint of endpoints) await this.adb('connect', endpoint);
    const devices = (await this.adb('devices', '-l')).split('\n').filter(line => /\sdevice\s/.test(line));
    const matching = devices.filter(line => line.includes(`model:${this.info.label}`));
    if (!matching.length) throw new Error('手机画面连接不可用，请保持已配对手机的无线调试开启');
    this.serial = matching[0].trim().split(/\s+/)[0];
    this.port = Number(await this.adb('-s', this.serial, 'forward', 'tcp:0', 'localabstract:chrome_devtools_remote'));
    if (!Number.isInteger(this.port) || this.port <= 0) throw new Error('手机浏览器调试端口创建失败');
    const targets = await CDP.List({ port: this.port });
    for (const target of targets.filter(item => item.type === 'page' && URL.canParse(item.url) && new URL(item.url).origin === this.origin)) {
      const client = await CDP({ port: this.port, target: target.id, local: true });
      const result = await client.Runtime.evaluate({ expression: 'document.documentElement.dataset.mobileCollabCapture', returnByValue: true });
      if (result.result.value === this.info.captureId) { this.client = client; break; }
      await client.close();
    }
    if (!this.client) throw new Error('未找到当前手机网页，请刷新手机上的 DSH 页面');
    if (this.closed) { await this.close(); return; }
    this.client.on('disconnect', () => { if (!this.closed) this.fail(new Error('手机原始画面连接已断开，请重新连接协同')); });
    this.client.Page.screencastFrame(frame => {
      if (this.closed) return;
      this.emit({ type: 'pixels', sequence: ++this.sequence, image: frame.data, metadata: frame.metadata });
      void this.client.Page.screencastFrameAck({ sessionId: frame.sessionId }).catch(error => { if (!this.closed) this.fail(error); });
    });
    await this.client.Page.enable();
    await this.client.Page.startScreencast({ format: 'png', maxWidth: 1800, maxHeight: 3600, everyNthFrame: 1 });
  }
  async input(command) {
    if (!this.client || this.closed) throw new Error('手机画面连接尚未就绪');
    const { Input } = this.client;
    if (command.action === 'wheel') {
      await Input.dispatchMouseEvent({ type: 'mouseWheel', x: command.x, y: command.y, deltaX: command.dx, deltaY: command.dy, pointerType: 'mouse' });
    } else if (command.action === 'pointer') {
      if (command.phase === 'start') {
        this.touch = { id: command.pointerId, x: command.x, y: command.y };
        await Input.dispatchTouchEvent({ type: 'touchStart', touchPoints: [{ x: command.x, y: command.y, id: 1 }] });
      } else if (this.touch?.id === command.pointerId) {
        if (command.phase === 'move') await Input.dispatchTouchEvent({ type: 'touchMove', touchPoints: [{ x: command.x, y: command.y, id: 1 }] });
        else { this.touch = null; await Input.dispatchTouchEvent({ type: command.phase === 'end' ? 'touchEnd' : 'touchCancel', touchPoints: [] }); }
      }
    } else if (command.action === 'text') await Input.insertText({ text: command.text });
    else if (command.action === 'keyboard') {
      await Input.dispatchKeyEvent({ type: 'keyDown', key: command.key, code: command.code, windowsVirtualKeyCode: command.keyCode, nativeVirtualKeyCode: command.keyCode, modifiers: command.modifiers });
      await Input.dispatchKeyEvent({ type: 'keyUp', key: command.key, code: command.code, windowsVirtualKeyCode: command.keyCode, nativeVirtualKeyCode: command.keyCode, modifiers: command.modifiers });
    }
  }
  async close() {
    this.closed = true;
    const client = this.client; this.client = null;
    try {
      if (client) {
        try { if (this.touch) await client.Input.dispatchTouchEvent({ type: 'touchCancel', touchPoints: [] }); await client.Page.stopScreencast(); }
        finally { await client.close(); }
      }
    } finally {
      if (this.port && this.serial) { const port = this.port; this.port = null; await this.adb('-s', this.serial, 'forward', '--remove', `tcp:${port}`); }
    }
  }
}
