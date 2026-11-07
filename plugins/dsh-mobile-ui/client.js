window.__ModuleLoader__.load({
  id: '@local/dsh-mobile-ui',
  factory: require => {
    const React = require('react');
    const styles = `
.dsh-mobile-menu{display:none}
@media(max-width:760px){
html.dsh-mobile,html.dsh-mobile body{height:100%;overflow:hidden;overscroll-behavior:none;--dsh-content-font-size:16px!important;--dsh-content-font-delta:0px!important;--dsh-content-font-size-secondary:12px!important;--dsh-content-font-delta-secondary:0px!important}
.dsh-mobile .PIRFFq_frame{position:fixed;inset:var(--dsh-mobile-top,0px) 0 auto;height:var(--dsh-mobile-height,100dvh);grid-template-columns:0 minmax(0,1fr) 0!important;transition:none!important}
.dsh-mobile .PIRFFq_centerCol{grid-column:2;min-width:0;border:0}
.dsh-mobile .PIRFFq_sidebarCol{position:absolute;inset:0 auto 0 0;width:min(300px,86vw);z-index:40;box-shadow:8px 0 30px #0003;background:var(--dsw-specific-sidebar-fill)}
.dsh-mobile [data-sidebar-collapsed]>.PIRFFq_sidebarCol{display:none}
.dsh-mobile .PIRFFq_handle,.dsh-mobile .PIRFFq_leadingSeat{display:none}
.dsh-mobile .PIRFFq_frame:not([data-sidebar-collapsed]):after{content:'';position:absolute;inset:0;background:#0004;z-index:30}
.dsh-mobile .kiGsTW_header{position:relative;min-height:44px!important;height:44px;grid-template-columns:34px minmax(0,1fr);padding:4px 8px!important;gap:4px}
.dsh-mobile .kiGsTW_headerLeading{gap:0}
.dsh-mobile .dsh-mobile-menu{display:grid;place-items:center;width:32px;height:34px;border:0;border-radius:8px;background:transparent;color:inherit;cursor:pointer;touch-action:manipulation}
.dsh-mobile .kiGsTW_titleRow{min-height:34px;padding:0 32px 0 0;gap:4px}
.dsh-mobile .kiGsTW_titleCluster{gap:4px;min-width:0}
.dsh-mobile .kiGsTW_crumb{max-width:100%;padding:4px;font-size:14px}
.dsh-mobile .kiGsTW_crumbs{flex:1}
.dsh-mobile .kiGsTW_headerActions,.dsh-mobile .kiGsTW_headerUtilities{display:none}
.dsh-mobile .kiGsTW_headerCorner{margin:0}
.dsh-mobile .kiGsTW_tabs{display:contents}
.dsh-mobile .kiGsTW_viewTabs{display:none}
.dsh-mobile .kiGsTW_viewsMoreAnchor{position:absolute;right:8px;top:8px}
.dsh-mobile .kiGsTW_viewsMore{margin:0;width:28px;height:28px}
.dsh-mobile [data-conversation-content]{--dsh-chat-content-width:100%;--dsh-composer-card-max-width:100%;--dsh-composer-side-clearance:8px;--dsh-composer-dock-inset:4px;--dsh-chat-flow-gap:12px;min-width:0}
.dsh-mobile [data-conversation-scroll]{min-height:0;overscroll-behavior-y:contain;scroll-padding-bottom:8px}
.dsh-mobile .tnXGgG_scroll{padding:10px 12px}
.dsh-mobile .tnXGgG_column{max-width:100%;width:100%}
.dsh-mobile [data-chat-flow]{--dsh-chat-flow-gap:12px}
.dsh-mobile [data-chat-turn-spacer]{max-height:20px}
.dsh-mobile [data-chat-flow] pre{max-width:100%;overflow:auto}
.dsh-mobile [data-chat-flow] table{display:block;max-width:100%;overflow:auto}
.dsh-mobile [data-chat-flow] img{max-width:100%;height:auto}
.dsh-mobile [data-composer-seat]{--dsh-composer-text-max-height:min(150px,30dvh);padding-bottom:env(safe-area-inset-bottom,0px)}
.dsh-mobile[data-mobile-keyboard] [data-composer-seat]{padding-bottom:0;--dsh-composer-text-max-height:min(110px,28dvh)}
.dsh-mobile .kiGsTW_composerStack{--dsh-composer-stack-gap:2px}
.dsh-mobile .JZLxKW_root{padding:0 8px 6px}
.dsh-mobile [data-composer-card]{padding-top:5px;gap:3px;border-radius:14px;box-shadow:0 0 0 1px var(--dsw-alias-border-l2)}
.dsh-mobile [data-composer-input]{min-height:32px!important;padding:5px 10px 1px;font-size:16px;line-height:22px;scroll-margin:8px}
.dsh-mobile [data-composer-placeholder]{left:10px;top:5px;font-size:14px;line-height:22px}
.dsh-mobile .JZLxKW_row{flex-wrap:nowrap;gap:4px;padding:1px 6px 4px;min-height:36px}
.dsh-mobile .JZLxKW_tools,.dsh-mobile .JZLxKW_modes,.dsh-mobile .JZLxKW_trailing,.dsh-mobile .JZLxKW_standardControls{gap:4px}
.dsh-mobile .JZLxKW_row{--dsh-composer-model-text-display:none;--dsh-composer-model-icon-display:block}
.dsh-mobile .JZLxKW_primary{width:34px;height:34px;transform:none}
.dsh-mobile .JZLxKW_row button{touch-action:manipulation;min-height:32px}
.dsh-mobile .JZLxKW_row button[aria-label='回退']{display:none}
.dsh-mobile [data-composer-stat],.dsh-mobile .JZLxKW_dock:has([data-composer-stat]){display:none}
.dsh-mobile .kiGsTW_heroOptionsRow{padding:0 8px;margin:0}
}
`;
    function Menu({ toggle }) {
      return React.createElement('button', { className: 'dsh-mobile-menu', type: 'button', 'aria-label': '打开会话列表', onClick: toggle },
        React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true },
          React.createElement('path', { d: 'M4 6h16M4 12h16M4 18h16', strokeLinecap: 'round' })));
    }
    function apply(ctx) {
      if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
      const root = document.documentElement;
      const media = matchMedia('(max-width:760px)');
      const viewport = window.visualViewport;
      const style = document.createElement('style');
      style.dataset.pluginCss = '@local/dsh-mobile-ui/mobile';
      style.textContent = styles;
      document.head.append(style);
      const meta = document.querySelector('meta[name="viewport"]');
      const originalViewport = meta?.content;
      if (meta) meta.content = 'width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-content';
      let scheduled = 0;
      let maximumHeight = window.innerHeight;
      const configured = new Map();
      const composing = new WeakSet();
      const lastComposition = new WeakMap();
      const inputOf = target => target instanceof Element ? target.closest('[data-composer-input]') : null;
      const update = () => {
        scheduled = 0;
        root.classList.toggle('dsh-mobile', media.matches);
        if (!media.matches) return;
        if (!viewport || Math.abs(viewport.scale - 1) < 0.05) {
          const height = viewport?.height ?? window.innerHeight;
          maximumHeight = Math.max(maximumHeight, window.innerHeight);
          root.style.setProperty('--dsh-mobile-height', `${height}px`);
          root.style.setProperty('--dsh-mobile-top', `${viewport?.offsetTop ?? 0}px`);
          root.toggleAttribute('data-mobile-keyboard', Boolean(inputOf(document.activeElement)) && maximumHeight - height > 100);
        }
        for (const input of document.querySelectorAll('[data-composer-input]')) {
          if (configured.has(input)) continue;
          configured.set(input, { inputmode: input.getAttribute('inputmode'), enterkeyhint: input.getAttribute('enterkeyhint') });
          input.setAttribute('inputmode', 'text');
          input.setAttribute('enterkeyhint', 'enter');
        }
        for (const input of configured.keys()) if (!input.isConnected) configured.delete(input);
      };
      const schedule = () => { if (!scheduled) scheduled = requestAnimationFrame(update); };
      const startComposition = event => { const input = inputOf(event.target); if (input) composing.add(input); };
      const endComposition = event => {
        const input = inputOf(event.target);
        if (input) { composing.delete(input); lastComposition.set(input, performance.now()); }
      };
      const keydown = event => {
        const input = inputOf(event.target);
        if (!media.matches || !input || event.key !== 'Enter') return;
        if (event.isComposing || event.keyCode === 229 || composing.has(input) || performance.now() - (lastComposition.get(input) ?? -1000) < 100) {
          event.stopImmediatePropagation();
          return;
        }
        if (!event.ctrlKey && !event.metaKey) event.stopImmediatePropagation();
      };
      const pointerdown = event => {
        if (!media.matches || !(event.target instanceof Element)) return;
        const frame = document.querySelector('.PIRFFq_frame');
        if (frame && !frame.hasAttribute('data-sidebar-collapsed') && !event.target.closest('.PIRFFq_sidebarCol,.dsh-mobile-menu')) {
          event.preventDefault();
          ctx.layout.toggleSidebar();
        }
      };
      const click = event => {
        if (!media.matches || !(event.target instanceof Element)) return;
        const frame = document.querySelector('.PIRFFq_frame');
        if (!frame || frame.hasAttribute('data-sidebar-collapsed')) return;
        const row = event.target.closest('.PIRFFq_sidebarCol [role="treeitem"][aria-selected]');
        const newSession = event.target.closest('.PIRFFq_sidebarCol .kB3qhq_newSession');
        if (newSession || row && !row.hasAttribute('aria-description') && !event.target.closest('button')) ctx.layout.toggleSidebar();
      };
      const orientation = () => { maximumHeight = window.innerHeight; schedule(); };
      const observer = new MutationObserver(schedule);
      observer.observe(document.body, { childList: true, subtree: true });
      window.addEventListener('resize', schedule);
      window.addEventListener('orientationchange', orientation);
      viewport?.addEventListener('resize', schedule);
      viewport?.addEventListener('scroll', schedule);
      document.addEventListener('focusin', schedule);
      document.addEventListener('focusout', schedule);
      document.addEventListener('compositionstart', startComposition, true);
      document.addEventListener('compositionend', endComposition, true);
      document.addEventListener('keydown', keydown, true);
      document.addEventListener('pointerdown', pointerdown, true);
      document.addEventListener('click', click);
      ctx.slots.inject('conversation.header.leading', () => ctx.slots.register({
        name: 'conversation.header.leading', inject: () => ({ toggle: () => ctx.layout.toggleSidebar() }),
      }, Menu));
      update();
      return () => {
        observer.disconnect(); cancelAnimationFrame(scheduled); style.remove();
        root.classList.remove('dsh-mobile'); root.removeAttribute('data-mobile-keyboard');
        root.style.removeProperty('--dsh-mobile-height'); root.style.removeProperty('--dsh-mobile-top');
        if (meta) meta.content = originalViewport;
        for (const [input, values] of configured) for (const [name, value] of Object.entries(values)) {
          if (value === null) input.removeAttribute(name); else input.setAttribute(name, value);
        }
        window.removeEventListener('resize', schedule);
        window.removeEventListener('orientationchange', orientation);
        viewport?.removeEventListener('resize', schedule);
        viewport?.removeEventListener('scroll', schedule);
        document.removeEventListener('focusin', schedule);
        document.removeEventListener('focusout', schedule);
        document.removeEventListener('compositionstart', startComposition, true);
        document.removeEventListener('compositionend', endComposition, true);
        document.removeEventListener('keydown', keydown, true);
        document.removeEventListener('pointerdown', pointerdown, true);
        document.removeEventListener('click', click);
      };
    }
    return { inject: ['layout', 'slots'], apply };
  },
});
