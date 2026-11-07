import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Replayer } from 'rrweb';
import { encode } from 'base64-arraybuffer';
import rrStyles from 'rrweb/dist/style.css';
import styles from './style.css';
import { TYPERT_REMOTE } from './remote.js';
import { Controller } from './controller.js';
import { startPhone, inputText } from './phone.js';
import { configureMobile } from './mobile.js';

export const inject = ['remote', 'slots', 'sidebarRightTabs', 'sidebarRight', 'layout'];
const TYPE = '@local/dsh-mobile-collaboration';
const KIND = 'mobile-collaboration';

function ComposerBridge({ inputActions, controller }) {
  useEffect(() => {
    controller.inputActions = inputActions;
    return () => { if (controller.inputActions === inputActions) controller.inputActions = null; };
  }, [controller, inputActions]);
  return null;
}

function JoinLink({ url, controller }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); }
    catch (error) { controller.update({ error: `复制失败：${error.message}` }); }
  };
  return <div className="dsh-collab-join"><strong>连接手机</strong><span>手机和电脑连接同一 Wi-Fi，在手机浏览器打开这个地址：</span><input aria-label="手机连接地址" readOnly value={url} onFocus={event => event.target.select()} /><button onClick={copy} disabled={!url}>{copied ? '已复制' : '复制连接地址'}</button><span className="dsh-collab-note">页面打开后，设备会自动出现在上方列表。</span></div>;
}

function Preview({ controller, phoneCount, joinUrl }) {
  const area = useRef(null), surface = useRef(null), player = useRef(null), stage = useRef(null);
  const [viewport, setViewport] = useState(null), [room, setRoom] = useState({ width: 0, height: 0 });
  const [visible, setVisible] = useState(true), [received, setReceived] = useState(false), [editor, setEditor] = useState(null);
  const editorRef = useRef(null), draft = useRef('');
  const heldPress = useRef(null), suppressClick = useRef(false);
  const editing = useRef(null); editing.current = editor;
  const scale = viewport ? Math.min(room.width / viewport.width, room.height / viewport.height, 1) : 1;
  const current = useRef({ viewport, scale }); current.current = { viewport, scale };
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setRoom({ width: entry.contentRect.width - 12, height: entry.contentRect.height - 12 }));
    observer.observe(area.current);
    let clock, refreshInput;
    const clear = () => { heldPress.current = null; player.current?.destroy(); player.current = null; setReceived(false); setEditor(null); clock = undefined; };
    const off = controller.onFrame(data => {
      if (data.type === 'reset') {
        clear(); setViewport(data.viewport); setVisible(data.visible);
        player.current = new Replayer([], { root: surface.current, liveMode: true, triggerFocus: false, mouseTail: false, showWarning: false, showDebug: false, insertStyleRules: ['.dsh-collab-badge{visibility:hidden!important}'] });
        player.current.startLive(Date.now() - 60);
      } else if (data.type === 'viewport') { setViewport(data.viewport); setVisible(data.visible); }
      else if (data.type === 'event' && player.current) {
        clock ??= Date.now() - data.event.timestamp;
        player.current.addEvent({ ...data.event, timestamp: data.event.timestamp + clock });
        if (data.event.type === 2) setReceived(true);
        clearTimeout(refreshInput);
        refreshInput = setTimeout(() => {
          const current = editing.current;
          if (!current || current.select || controller.pendingInputs.size) return;
          const node = player.current?.getMirror().getNode(current.id);
          if (!node) { setEditor(null); return; }
          const text = inputText(node);
          if (typeof text === 'string' && text !== draft.current) { draft.current = text; setEditor(previous => previous?.id === current.id ? { ...previous, value: text } : previous); }
        }, 120);
      } else if (['offline', 'stopped', 'stop'].includes(data.type)) clear();
      else if (data.type === 'notice') setEditor(null);
    });
    return () => { off(); clear(); clearTimeout(refreshInput); observer.disconnect(); };
  }, [controller]);
  useEffect(() => { if (editor) editorRef.current?.focus(); }, [editor?.id]);
  const command = value => {
    try { controller.send({ type: 'command', command: value }); }
    catch (error) { controller.update({ error: error.message }); }
  };
  const hit = (clientX, clientY) => {
    if (!player.current || !viewport || scale <= 0) return null;
    const box = stage.current.getBoundingClientRect();
    const x = (clientX - box.left) / scale + viewport.left, y = (clientY - box.top) / scale + viewport.top;
    const doc = player.current.iframe.contentDocument;
    return { node: doc?.elementFromPoint(x, y), x, y, doc };
  };
  const click = event => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    controller.update({ error: '' });
    const point = hit(event.clientX, event.clientY); if (!point?.node) return;
    const node = point.node.closest('input,textarea,select,[contenteditable=true],button,a,[role=button],[role=treeitem]') ?? point.node;
    const id = player.current.getMirror().getId(node); if (id < 0) return;
    if (node.matches('input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]),textarea,[contenteditable=true]')) {
      if (node.matches('[type=password],[type=file],:disabled,[readonly]')) { controller.update({ error: '请在手机上操作此控件' }); return; }
      const rect = node.getBoundingClientRect(), css = node.ownerDocument.defaultView.getComputedStyle(node);
      const value = inputText(node) ?? '';
      draft.current = value;
      setEditor({ id, value, x: Math.max(0, (rect.left - viewport.left) * scale), y: Math.max(0, (rect.top - viewport.top) * scale), width: Math.min(viewport.width * scale, rect.width * scale), height: Math.max(40, rect.height * scale), color: css.color, background: node.ownerDocument.defaultView.getComputedStyle(node.ownerDocument.body).backgroundColor, fontSize: Math.max(12, parseFloat(css.fontSize) * scale) });
    } else if (node instanceof node.ownerDocument.defaultView.HTMLSelectElement) {
      const rect = node.getBoundingClientRect();
      setEditor({ id, select: true, value: node.value, options: [...node.options].map(option => ({ value: option.value, text: option.text, disabled: option.disabled })), x: (rect.left - viewport.left) * scale, y: (rect.top - viewport.top) * scale, width: rect.width * scale, height: Math.max(32, rect.height * scale) });
    } else {
      setEditor(null); const rect = node.getBoundingClientRect();
      command({ action: 'click', id, x: point.x - rect.left, y: point.y - rect.top });
    }
  };
  const finishHold = (phase, event) => {
    const press = heldPress.current;
    if (!press || event && press.pointerId !== event.pointerId) return;
    heldPress.current = null;
    if (controller.handle) command({ action: 'hold', id: press.id, pressId: press.pressId, phase });
  };
  const startHold = event => {
    suppressClick.current = false;
    if (event.button !== 0 || !event.isPrimary || heldPress.current) return;
    const point = hit(event.clientX, event.clientY), node = point?.node?.closest('[data-volc-gesture=hold]');
    if (!node) return;
    event.preventDefault(); suppressClick.current = true;
    if (node.matches(':disabled') || node.dataset.volcSpeech !== 'idle') return;
    const id = player.current.getMirror().getId(node);
    if (id < 0) return;
    const pressId = crypto.randomUUID();
    heldPress.current = { id, pressId, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    controller.update({ error: '' });
    command({ action: 'hold', id, pressId, phase: 'start' });
  };
  useEffect(() => {
    const blur = () => finishHold('cancel');
    const hidden = () => { if (document.hidden) finishHold('cancel'); };
    window.addEventListener('blur', blur); document.addEventListener('visibilitychange', hidden);
    return () => { finishHold('cancel'); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', hidden); };
  }, [controller]);
  const scroll = event => {
    event.preventDefault(); const point = hit(event.clientX, event.clientY); if (!point?.node) return;
    let node = point.node;
    while (node && node !== point.doc.documentElement) {
      const css = node.ownerDocument.defaultView.getComputedStyle(node);
      if ((event.deltaY && node.scrollHeight > node.clientHeight + 1 && /auto|scroll/.test(css.overflowY)) || (event.deltaX && node.scrollWidth > node.clientWidth + 1 && /auto|scroll/.test(css.overflowX))) break;
      node = node.parentElement;
    }
    node ??= point.doc.scrollingElement;
    const id = player.current.getMirror().getId(node);
    if (id >= 0) command({ action: 'scroll', id, dx: event.deltaX / scale, dy: event.deltaY / scale });
  };
  useEffect(() => {
    const element = stage.current;
    element.addEventListener('wheel', scroll, { passive: false });
    return () => element.removeEventListener('wheel', scroll);
  }, [viewport, scale]);
  const edit = event => {
    const text = event.target.value, expected = draft.current;
    draft.current = text; setEditor(previous => ({ ...previous, value: text }));
    command({ action: 'input', id: editor.id, expected, text });
  };
  const editorStyle = editor && { left: editor.x, top: editor.y, width: editor.width, height: editor.height, color: editor.color, background: editor.background, fontSize: editor.fontSize };
  const blurEditor = () => { if (editor) command({ action: 'blur', id: editor.id }); setEditor(null); };
  return <div ref={area} className="dsh-collab-area">
    <div ref={stage} className="dsh-collab-stage" style={{ width: viewport ? viewport.width * scale : 0, height: viewport ? viewport.height * scale : 0, visibility: received ? 'visible' : 'hidden' }}>
      <div ref={surface} className="dsh-collab-replay" style={{ width: viewport?.layoutWidth, height: viewport?.layoutHeight, transform: `scale(${scale}) translate(${-1 * (viewport?.left ?? 0)}px,${-1 * (viewport?.top ?? 0)}px)` }} />
      <div className="dsh-collab-overlay" role="application" aria-label="手机实时画面" tabIndex={0} onClick={click} onPointerDown={startHold} onPointerUp={event => finishHold('end', event)} onPointerCancel={event => finishHold('cancel', event)} onLostPointerCapture={event => finishHold('cancel', event)} onContextMenu={event => { if (heldPress.current) event.preventDefault(); }} onKeyDown={event => { if (event.key === 'Escape') { finishHold('cancel'); setEditor(null); const doc = player.current?.iframe.contentDocument; const node = doc?.activeElement; const id = node && player.current.getMirror().getId(node); if (id >= 0) command({ action: 'key', id, key: 'Escape' }); } }} />
      {editor && (editor.select
        ? <select ref={editorRef} className="dsh-collab-edit" aria-label="手机同步选择" style={editorStyle} value={editor.value} onChange={event => { command({ action: 'select', id: editor.id, value: event.target.value }); setEditor(null); }} onBlur={() => setEditor(null)}>{editor.options.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.text}</option>)}</select>
        : <textarea ref={editorRef} className="dsh-collab-edit" aria-label="手机同步输入" style={editorStyle} value={editor.value} onChange={edit} onBlur={blurEditor} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); blurEditor(); } }} />)}
    </div>
    {!received && <div style={{ position: 'absolute' }}>{phoneCount === 0 ? <JoinLink url={joinUrl} controller={controller} /> : <div className="dsh-collab-empty">选择手机后，实时画面会显示在这里。</div>}</div>}
    {received && !visible && <div className="dsh-collab-empty" style={{ position: 'absolute', background: 'var(--dsw-alias-background-primary,#fff)' }}>手机网页位于后台，请切回手机浏览器。</div>}
  </div>;
}

function CollaborationPanel({ controller, useTabInfo }) {
  const { tab } = useTabInfo();
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const files = useRef(null);
  const addImages = async event => {
    const selected = [...event.target.files]; event.target.value = '';
    try {
      for (const file of selected) {
        if (!file.type.startsWith('image/')) throw new Error('请选择图片文件');
        if (file.size > 20 * 1024 * 1024) throw new Error('单张图片不能超过 20 MB');
        controller.send({ type: 'command', command: { action: 'file', name: file.name, mime: file.type, data: encode(await file.arrayBuffer()) } });
      }
    } catch (error) { controller.update({ error: error.message }); }
  };
  useEffect(() => {
    if (tab.visible) controller.start();
    return () => { if (tab.visible) controller.stop(); };
  }, [controller, tab.visible]);
  useEffect(() => {
    if (tab.visible && state.connected && !state.selected && !state.suspended && state.phones.length === 1) controller.watch(state.phones[0].id);
  }, [tab.visible, state.connected, state.selected, state.suspended, state.phones]);
  return <section className="dsh-collab" data-mobile-collab="true" aria-label="手机协同">
    <div className="dsh-collab-head">
      <select aria-label="选择协同手机" value={state.selected ?? ''} onChange={event => controller.watch(event.target.value || null)} disabled={!state.connected}>
        <option value="">{state.phones.length ? '选择手机' : '等待手机连接'}</option>
        {state.phones.map(phone => <option key={phone.id} value={phone.id}>{phone.label} · {Math.round(phone.viewport.width)} × {Math.round(phone.viewport.height)}{phone.visible ? '' : ' · 后台'}</option>)}
      </select>
      {state.connected ? <button onClick={() => controller.watch(null)} disabled={!state.selected}>断开</button> : <button onClick={() => controller.start()}>重新连接</button>}
      <button onClick={() => files.current.click()} disabled={!state.selected}>添加图片</button>
      <input ref={files} type="file" accept="image/*" multiple hidden onChange={addImages} />
    </div>
    <Preview controller={controller} phoneCount={state.phones.length} joinUrl={state.joinUrl} />
    {state.error && <div role="alert" className="dsh-collab-error">{state.error}</div>}
    <div className="dsh-collab-note">{state.connected ? state.phones.length ? '点击、输入和滚动会同步到手机。关闭面板即可结束协同。' : '在手机浏览器打开本机 DSH 网页，保持页面在前台。' : '正在连接协同服务…'}</div>
  </section>;
}

function OpenButton({ open }) {
  return <button type="button" aria-label="手机协同" title="手机协同" onClick={open} style={{ border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', width: 28, height: 28, padding: 4 }}>
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="3" /><path d="M10 18h4" /></svg>
  </button>;
}

function MobileMenu({ toggle }) {
  return <button className="dsh-mobile-menu" type="button" aria-label="打开会话列表" onClick={toggle}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 6h16M4 12h16M4 18h16" /></svg></button>;
}

export async function apply(ctx) {
  const unmount = await ctx.remote.$mount(TYPERT_REMOTE);
  const mobile = navigator.userAgentData?.mobile ?? /Android|iPhone|iPad/i.test(navigator.userAgent);
  const device = mobile && navigator.userAgentData ? await navigator.userAgentData.getHighEntropyValues(['model']) : null;
  const label = device?.model || (/iPhone|iPad/.test(navigator.userAgent) ? 'iPhone / iPad' : 'Android 手机');
  const style = document.createElement('style'); style.textContent = rrStyles + styles; document.head.append(style);
  let controller, disposePhone, disposeMobile;
  const registration = ctx.inject(['remote.mobileCollab', 'slots', 'sidebarRightTabs', 'sidebarRight', 'layout'], child => {
    controller = new Controller(child.remote, mobile, label);
    child.effect(() => child.slots.inject('conversation.input.right', () => child.slots.register({ name: 'conversation.input.right', id: TYPE + '/composer', inject: () => ({ controller }) }, ComposerBridge)));
    if (mobile) {
      disposeMobile = configureMobile();
      child.effect(() => child.slots.inject('conversation.header.leading', () => child.slots.register({ name: 'conversation.header.leading', inject: () => ({ toggle: () => child.layout.toggleSidebar() }) }, MobileMenu)));
      const outside = event => {
        const frame = document.querySelector('[data-rightbar-col]')?.parentElement;
        if (!document.documentElement.classList.contains('dsh-mobile-dense') || !frame || frame.hasAttribute('data-sidebar-collapsed') || !(event.target instanceof Element)) return;
        if (!event.target.closest('[class$="_sidebarCol"],.dsh-mobile-menu')) { event.preventDefault(); child.layout.toggleSidebar(); }
      };
      const select = event => {
        const frame = document.querySelector('[data-rightbar-col]')?.parentElement;
        if (!document.documentElement.classList.contains('dsh-mobile-dense') || !frame || frame.hasAttribute('data-sidebar-collapsed') || !(event.target instanceof Element)) return;
        if (event.target.closest('[class$="_sidebarCol"] [role=treeitem][aria-selected]') && !event.target.closest('button')) child.layout.toggleSidebar();
      };
      document.addEventListener('pointerdown', outside, true); document.addEventListener('click', select);
      child.effect(() => () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('click', select); });
      disposePhone = startPhone(controller); controller.start();
      const reconnect = () => { if (!document.hidden && !controller.abort) controller.start(); };
      window.addEventListener('online', reconnect); document.addEventListener('visibilitychange', reconnect);
      child.effect(() => () => { window.removeEventListener('online', reconnect); document.removeEventListener('visibilitychange', reconnect); });
    } else {
      child.effect(() => child.sidebarRightTabs.register({ id: TYPE, kind: KIND, title: () => '手机协同', guide: [{ id: 'mobile-collaboration', title: () => '手机协同', description: () => '与手机同步查看和操作', order: 25 }] }));
      child.effect(() => child.slots.inject('sidebar.right.pane.tab', () => child.slots.register({ name: 'sidebar.right.pane.tab', key: TYPE, inject: () => ({ controller }) }, CollaborationPanel)));
      child.effect(() => child.slots.inject('conversation.session.header.actions', () => child.slots.register({ name: 'conversation.session.header.actions', id: TYPE + '/open', inject: () => ({ open: () => child.sidebarRight.openTab(KIND) }) }, OpenButton)));
    }
  });
  await registration;
  return async () => { disposePhone?.(); disposeMobile?.(); controller?.stop(); await registration.dispose(); style.remove(); await unmount(); };
}
