import { decode } from 'base64-arraybuffer';
export const phoneViewport = () => ({ width: visualViewport?.width ?? innerWidth, height: visualViewport?.height ?? innerHeight, layoutWidth: innerWidth, layoutHeight: innerHeight, left: visualViewport?.offsetLeft ?? 0, top: visualViewport?.offsetTop ?? 0, dpr: devicePixelRatio });
export function startPhone(controller) {
  let badge, wakeLock, wakeRequest, disposed = false;
  const needsWakeLock = () => !disposed && controller.state.connected && !document.hidden;
  const releaseWakeLock = () => { const lock = wakeLock; wakeLock = null; document.documentElement.dataset.mobileCollabWakeLock = 'released'; void lock?.release(); };
  const keepAwake = async () => {
    if (!needsWakeLock() || wakeLock || wakeRequest) return;
    if (!navigator.wakeLock) { document.documentElement.dataset.mobileCollabWakeLock = 'unsupported'; return; }
    wakeRequest = navigator.wakeLock.request('screen');
    try {
      const lock = await wakeRequest;
      if (!needsWakeLock()) { await lock.release(); return; }
      wakeLock = lock; document.documentElement.dataset.mobileCollabWakeLock = 'active';
      lock.addEventListener('release', () => { if (wakeLock === lock) { wakeLock = null; document.documentElement.dataset.mobileCollabWakeLock = 'released'; } });
    } catch (error) {
      document.documentElement.dataset.mobileCollabWakeLock = 'denied';
      if (needsWakeLock()) controller.send({ type: 'notice', text: `手机无法保持亮屏：${error.message}` });
    } finally { wakeRequest = null; }
  };
  const stop = () => { badge?.remove(); badge = null; };
  const unsubscribe = controller.onFrame(data => {
    if (data.type === 'ready') void keepAwake();
    if (data.type === 'stop') stop();
    if (data.type === 'start') {
      stop(); badge = document.createElement('button'); badge.className = 'dsh-collab-badge'; badge.dataset.mobileCollab = 'true';
      badge.textContent = '正在与电脑协同 · 结束'; badge.onclick = () => controller.send({ type: 'stop' });
      document.body.append(badge); controller.presence(); void keepAwake();
    }
    if (data.type === 'command' && data.command.action === 'file') {
      const input = [...document.querySelectorAll('input[type=file]')].find(node => !node.disabled);
      if (!input) { controller.send({ type: 'notice', text: '当前手机页面没有文件上传入口' }); return; }
      const transfer = new DataTransfer(); transfer.items.add(new File([decode(data.command.data)], data.command.name, { type: data.command.mime }));
      input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  const visible = () => { controller.presence(); if (document.hidden) releaseWakeLock(); else void keepAwake(); };
  const resized = () => controller.presence();
  const wakeTimer = setInterval(() => { void keepAwake(); }, 15000);
  document.addEventListener('visibilitychange', visible); visualViewport?.addEventListener('resize', resized); visualViewport?.addEventListener('scroll', resized); window.addEventListener('resize', resized);
  return () => { disposed = true; clearInterval(wakeTimer); releaseWakeLock(); stop(); unsubscribe(); document.removeEventListener('visibilitychange', visible); visualViewport?.removeEventListener('resize', resized); visualViewport?.removeEventListener('scroll', resized); window.removeEventListener('resize', resized); };
}
