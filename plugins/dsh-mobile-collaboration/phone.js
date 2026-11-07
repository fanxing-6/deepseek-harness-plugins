import { record } from 'rrweb';
import { decode } from 'base64-arraybuffer';

export const phoneViewport = () => ({ width: visualViewport?.width ?? innerWidth, height: visualViewport?.height ?? innerHeight, layoutWidth: innerWidth, layoutHeight: innerHeight, left: visualViewport?.offsetLeft ?? 0, top: visualViewport?.offsetTop ?? 0, dpr: devicePixelRatio });
export const inputText = node => node.isContentEditable ? (node.innerText === '\n' && !node.textContent ? '' : node.innerText) : node.value;

export function startPhone(controller) {
  let stopRecord;
  let badge;
  let voiceButton;
  let pointerSequence = 100;
  const presses = new Map();
  const pointer = (target, type, pointerId, point) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId, clientX: point?.x ?? 0, clientY: point?.y ?? 0, pointerType: 'mouse', button: 0, buttons: ['pointerdown', 'pointermove'].includes(type) ? 1 : 0, isPrimary: true }));
  let wakeLock, wakeRequest;
  const keepAwake = async () => {
    if (!stopRecord || document.hidden || wakeLock || wakeRequest || !navigator.wakeLock) return;
    const session = stopRecord;
    wakeRequest = navigator.wakeLock.request('screen');
    try {
      const lock = await wakeRequest;
      if (stopRecord !== session) { await lock.release(); return; }
      wakeLock = lock;
      badge.title = '协同时屏幕保持亮起，点击结束后恢复';
      lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
    } catch (error) {
      if (stopRecord === session && !document.hidden) controller.send({ type: 'notice', text: `手机无法保持亮屏：${error.message}` });
    } finally { wakeRequest = null; if (stopRecord && stopRecord !== session) void keepAwake(); }
  };
  const stop = () => { for (const press of presses.values()) pointer(press.target, 'pointercancel', press.pointerId); presses.clear(); stopRecord?.(); stopRecord = null; badge?.remove(); badge = null; voiceButton?.remove(); voiceButton = null; const lock = wakeLock; wakeLock = null; void lock?.release(); };
  const start = () => {
    stop();
    badge = document.createElement('button');
    badge.className = 'dsh-collab-badge'; badge.dataset.mobileCollab = 'true';
    badge.textContent = '正在与电脑协同 · 结束';
    badge.onclick = () => controller.send({ type: 'stop' });
    document.body.append(badge);
    stopRecord = record({
      emit: event => controller.send({ type: 'event', event }),
      inlineStylesheet: true, inlineImages: true, collectFonts: true,
      blockSelector: '[data-mobile-collab]', maskInputOptions: { password: true },
      sampling: { mousemove: false, scroll: 40, input: 'last' },
    });
    if (!stopRecord) throw new Error('手机页面尚未完成加载');
    controller.presence();
    void keepAwake();
  };
  const execute = command => {
    if (!stopRecord) throw new Error('手机协同已经结束');
    if (command.action === 'hold' && command.phase !== 'start') {
      const press = presses.get(command.pressId);
      if (press) {
        press.point = { x: command.x ?? press.point.x, y: command.y ?? press.point.y };
        if (command.phase !== 'move') presses.delete(command.pressId);
        pointer(press.target, command.phase === 'move' ? 'pointermove' : command.phase === 'end' ? 'pointerup' : 'pointercancel', press.pointerId, press.point);
      }
      return;
    }
    if (command.action === 'file') {
      const input = [...document.querySelectorAll('input[type=file]')].find(node => !node.disabled);
      if (!input) throw new Error('手机页面暂时没有文件上传入口');
      const transfer = new DataTransfer();
      transfer.items.add(new File([decode(command.data)], command.name, { type: command.mime }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    let element = record.mirror.getNode(command.id);
    if (!element || !element.isConnected) throw new Error('手机页面已变化，请重新操作');
    if (element.nodeType === Node.DOCUMENT_NODE) element = document.scrollingElement;
    if (!(element instanceof Element) || element.closest('[data-mobile-collab]')) throw new Error('此区域无法远程操作');
    if (command.action === 'scroll') {
      element.scrollBy({ left: command.dx, top: command.dy, behavior: 'instant' });
      return;
    }
    if (element.matches(':disabled,[type=password],[type=file]')) throw new Error('请在手机上操作此控件');
    if (command.action === 'hold') {
      const target = element.closest('[data-volc-gesture=hold]');
      if (!target || target.matches(':disabled')) throw new Error('当前控件不支持按住录音');
      if (navigator.userActivation && !navigator.userActivation.hasBeenActive) {
        controller.send({ type: 'notice', text: '首次录音请在手机上点击“启用手机录音”，之后可在电脑按住说话，松开发送。' });
        if (!voiceButton) {
          voiceButton = document.createElement('button'); voiceButton.className = 'dsh-collab-badge'; voiceButton.dataset.mobileCollab = 'true'; voiceButton.style.top = '38px'; voiceButton.textContent = '启用手机录音'; voiceButton.setAttribute('aria-label', '启用手机录音');
          voiceButton.onclick = () => {
            voiceButton.remove(); voiceButton = null;
            controller.send({ type: 'notice', text: '' });
          };
          document.body.append(voiceButton);
        }
        return;
      }
      const pointerId = ++pointerSequence;
      const rect = target.getBoundingClientRect();
      const point = { x: command.x ?? rect.left + rect.width / 2, y: command.y ?? rect.top + rect.height / 2 };
      presses.set(command.pressId, { target, pointerId, point });
      pointer(target, 'pointerdown', pointerId, point);
      return;
    }
    if (command.action === 'click') {
      const target = element.closest('button,a,input,textarea,select,[role=button],[role=treeitem],[contenteditable=true]') ?? element;
      if (target.matches('[data-volc-gesture=hold]')) return;
      const rect = target.getBoundingClientRect();
      const options = { bubbles: true, cancelable: true, composed: true, clientX: rect.left + Math.min(rect.width, Math.max(0, command.x)), clientY: rect.top + Math.min(rect.height, Math.max(0, command.y)), button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true };
      target.dispatchEvent(new PointerEvent('pointerdown', options));
      target.dispatchEvent(new MouseEvent('mousedown', options));
      target.focus?.({ preventScroll: true });
      target.dispatchEvent(new PointerEvent('pointerup', options));
      target.dispatchEvent(new MouseEvent('mouseup', options));
      target.dispatchEvent(new MouseEvent('click', options));
    } else if (command.action === 'input') {
      if (!element.matches('input,textarea,[contenteditable=true]') || element.readOnly) throw new Error('当前区域不允许输入');
      if (inputText(element) !== command.expected) throw new Error('手机输入已变化，请重新选择输入框');
      if (element.matches('[data-composer-input]') && controller.inputActions) {
        if (element.querySelector('[contenteditable=false]')) throw new Error('带引用的内容请在手机输入框中编辑');
        controller.inputActions.setDraft(command.text);
      } else if (element.isContentEditable) {
        element.focus({ preventScroll: true });
        const selection = getSelection(); selection.selectAllChildren(element);
        if (!document.execCommand('insertText', false, command.text)) throw new Error('手机编辑器未接受输入');
      } else {
        const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, command.text);
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: command.text }));
      }
      controller.send({ type: 'input-state', id: command.id, requestId: command.requestId, text: command.text });
    } else if (command.action === 'blur') {
      if (document.activeElement === element) element.blur();
    } else if (command.action === 'select') {
      if (!(element instanceof HTMLSelectElement)) throw new Error('选择框已经变化');
      element.value = command.value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (command.action === 'key') {
      if (command.key === 'Escape' && document.activeElement?.matches('input,textarea,[contenteditable=true]')) document.activeElement.blur();
      element.dispatchEvent(new KeyboardEvent('keydown', { key: command.key, bubbles: true, cancelable: true }));
    }
  };
  const handle = data => {
    if (data.type === 'stop') stop();
    else if (data.type === 'start') start();
    else if (data.type === 'command') {
      try { execute(data.command); }
      catch (error) { controller.send({ type: 'notice', text: error.message }); }
    }
  };
  const unsubscribe = controller.onFrame(handle);
  const visible = () => { controller.presence(); if (!document.hidden && stopRecord) { record.takeFullSnapshot(); void keepAwake(); } };
  const resized = () => controller.presence();
  document.addEventListener('visibilitychange', visible);
  visualViewport?.addEventListener('resize', resized);
  visualViewport?.addEventListener('scroll', resized);
  window.addEventListener('resize', resized);
  return () => {
    stop(); unsubscribe(); document.removeEventListener('visibilitychange', visible);
    visualViewport?.removeEventListener('resize', resized); visualViewport?.removeEventListener('scroll', resized); window.removeEventListener('resize', resized);
  };
}
