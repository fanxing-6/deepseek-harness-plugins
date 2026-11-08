import React, { useRef, useState, useSyncExternalStore } from 'react';
import { encode } from 'base64-arraybuffer';
import styles from './style.css';
import { TYPERT_REMOTE } from './remote.js';
import { Controller } from './controller.js';
import { startPhone } from './phone.js';
import { configureMobile } from './mobile.js';
import { synchronizeNavigation } from './navigation.js';
import { PixelPreview } from './pixel-preview.jsx';

export const inject = ['remote', 'slots', 'layout', 'uiWorkspace', 'sessions'];
const TYPE = '@local/dsh-mobile-collaboration';
function JoinLink({ url, controller }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); } catch (error) { controller.update({ error: `复制失败：${error.message}` }); } };
  return <div className="dsh-collab-join"><strong>连接手机</strong><span>手机和电脑连接同一 Wi-Fi，在手机浏览器打开这个地址，并保持已配对的无线调试开启：</span><input aria-label="手机连接地址" readOnly value={url} onFocus={event => event.target.select()} /><button onClick={copy} disabled={!url}>{copied ? '已复制' : '复制连接地址'}</button></div>;
}
function CollaborationPanel({ controller }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot), files = useRef(null);
  const addImages = async event => {
    const selected = [...event.target.files]; event.target.value = '';
    try { for (const file of selected) {
      if (!file.type.startsWith('image/')) throw new Error('请选择图片文件');
      if (file.size > 20 * 1024 * 1024) throw new Error('单张图片不能超过 20 MB');
      controller.send({ type:'command', command:{action:'file',name:file.name,mime:file.type,data:encode(await file.arrayBuffer())} });
    } } catch (error) { controller.update({ error:error.message }); }
  };
  return <section className="dsh-collab" data-mobile-collab="true" aria-label="手机协同">
    <div className="dsh-collab-head">
      <select aria-label="选择协同手机" value={state.selected ?? ''} onChange={event => controller.watch(event.target.value || null)} disabled={!state.connected}><option value="">{state.phones.length ? '选择手机' : '等待手机连接'}</option>{state.phones.map(phone => <option key={phone.id} value={phone.id}>{phone.label} · {Math.round(phone.viewport.width)} × {Math.round(phone.viewport.height)}{phone.visible ? '' : ' · 后台'}</option>)}</select>
      {state.connected ? <button onClick={() => controller.watch(null)} disabled={!state.selected}>断开</button> : <button onClick={() => controller.start()}>重新连接</button>}
      <button onClick={() => files.current.click()} disabled={!state.selected}>添加图片</button><input ref={files} type="file" accept="image/*" multiple hidden onChange={addImages} />
    </div>
    <PixelPreview controller={controller} empty={state.phones.length === 0 ? <JoinLink url={state.joinUrl} controller={controller} /> : <div className="dsh-collab-empty">{state.selected ? '正在连接手机原始画面…' : '选择手机后显示实时画面。'}</div>} />
    {state.error && <div role="alert" className="dsh-collab-error">{state.error}</div>}
    <div className="dsh-collab-note">手机原始画面 · 点击、滚动和键盘输入直接发送到手机。</div>
  </section>;
}
function OpenButton({ controller, wide = true }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return <button type="button" className="dsh-collab-launcher" aria-label="手机协同" title="手机协同" aria-expanded={state.opened} onClick={() => state.opened ? controller.close() : controller.open()}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="3" /><path d="M10 18h4" /></svg>{wide && <span>手机协同</span>}</button>;
}
function GlobalCollaboration({ controller }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return <><div className="dsh-collab-global-launcher"><OpenButton controller={controller} /></div>{state.opened && <aside className="dsh-collab-global" data-mobile-collab="true" aria-label="全局手机协同"><div className="dsh-collab-global-title"><strong>手机协同</strong><button aria-label="关闭手机协同" onClick={() => controller.close()}>关闭</button></div><CollaborationPanel controller={controller} /></aside>}</>;
}
function MobileMenu({ toggle, global = false }) {
  return <button className={global ? 'dsh-mobile-menu dsh-collab-phone-menu' : 'dsh-mobile-menu'} type="button" aria-label="打开会话列表" onClick={toggle}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 6h16M4 12h16M4 18h16" /></svg></button>;
}
export async function apply(ctx) {
  const unmount = await ctx.remote.$mount(TYPERT_REMOTE);
  const mobile = navigator.userAgentData?.mobile ?? /Android|iPhone|iPad/i.test(navigator.userAgent);
  const device = mobile && navigator.userAgentData ? await navigator.userAgentData.getHighEntropyValues(['model']) : null;
  const label = device?.model || (/iPhone|iPad/.test(navigator.userAgent) ? 'iPhone / iPad' : 'Android 手机');
  const style = document.createElement('style'); style.textContent = styles; document.head.append(style);
  const registration = ctx.inject(['remote.mobileCollab','slots','layout','uiWorkspace','sessions'], child => {
    const controller = new Controller(child.remote, mobile, label);
    child.effect(() => synchronizeNavigation(child, controller));
    const offline = () => controller.stop(false, true), online = () => { if (mobile || controller.state.opened) controller.start(); };
    window.addEventListener('offline', offline); window.addEventListener('online', online);
    child.effect(() => () => { controller.stop(); window.removeEventListener('offline', offline); window.removeEventListener('online', online); });
    if (mobile) {
      child.effect(() => configureMobile());
      child.effect(() => child.slots.inject('conversation.header.leading', () => child.slots.register({name:'conversation.header.leading',inject:()=>({toggle:()=>child.layout.toggleSidebar()})}, MobileMenu)));
      child.effect(() => child.slots.inject('shell.overlay', () => child.slots.register({name:'shell.overlay',id:TYPE+'/mobile-menu',inject:()=>({global:true,toggle:()=>child.layout.toggleSidebar()})}, MobileMenu)));
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
      child.effect(() => startPhone(controller)); controller.start();
      const reconnect = () => { if (!document.hidden && !controller.abort) controller.start(); }, leave = () => controller.stop();
      document.addEventListener('visibilitychange', reconnect); window.addEventListener('pageshow', reconnect); window.addEventListener('pagehide', leave);
      child.effect(() => () => { document.removeEventListener('visibilitychange', reconnect); window.removeEventListener('pageshow', reconnect); window.removeEventListener('pagehide', leave); });
    } else {
      child.effect(() => child.slots.inject('sidebar.footer.action', () => child.slots.register({name:'sidebar.footer.action',id:TYPE+'/open',inject:()=>({controller})}, OpenButton)));
      child.effect(() => child.slots.inject('shell.overlay', () => child.slots.register({name:'shell.overlay',id:TYPE+'/global',inject:()=>({controller})}, GlobalCollaboration)));
    }
  });
  await registration;
  return async () => { await registration.dispose(); style.remove(); await unmount(); };
}
