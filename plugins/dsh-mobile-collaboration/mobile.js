export function configureMobile() {
  const root = document.documentElement;
  const media = matchMedia('(max-width:760px)');
  const viewport = window.visualViewport;
  const meta = document.querySelector('meta[name=viewport]');
  const original = meta?.content;
  if (meta) meta.content = 'width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-content';
  const configured = new Map(), composing = new WeakSet();
  let frame;
  const update = () => {
    frame = null; root.classList.toggle('dsh-mobile-dense', media.matches);
    if (!media.matches) return;
    if (!viewport || Math.abs(viewport.scale - 1) < 0.05) {
      root.style.setProperty('--dsh-mobile-height', `${viewport?.height ?? innerHeight}px`);
      root.style.setProperty('--dsh-mobile-top', `${viewport?.offsetTop ?? 0}px`);
    }
    for (const input of document.querySelectorAll('[data-composer-input]')) {
      if (configured.has(input)) continue;
      configured.set(input, input.getAttribute('enterkeyhint')); input.setAttribute('enterkeyhint', 'enter');
    }
    for (const input of configured.keys()) if (!input.isConnected) configured.delete(input);
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  const composer = target => target instanceof Element ? target.closest('[data-composer-input]') : null;
  const begin = event => { const input = composer(event.target); if (input) composing.add(input); };
  const end = event => { const input = composer(event.target); if (input) composing.delete(input); };
  const key = event => {
    const input = composer(event.target);
    if (media.matches && input && event.key === 'Enter' && (event.isComposing || event.keyCode === 229 || composing.has(input) || !event.ctrlKey && !event.metaKey)) event.stopImmediatePropagation();
  };
  const observer = new MutationObserver(schedule); observer.observe(document.body, { subtree: true, childList: true });
  window.addEventListener('resize', schedule); viewport?.addEventListener('resize', schedule); viewport?.addEventListener('scroll', schedule);
  document.addEventListener('compositionstart', begin, true); document.addEventListener('compositionend', end, true); document.addEventListener('keydown', key, true);
  update();
  return () => {
    observer.disconnect(); cancelAnimationFrame(frame); root.classList.remove('dsh-mobile-dense');
    root.style.removeProperty('--dsh-mobile-height'); root.style.removeProperty('--dsh-mobile-top');
    if (meta) meta.content = original;
    for (const [input, value] of configured) { if (value === null) input.removeAttribute('enterkeyhint'); else input.setAttribute('enterkeyhint', value); }
    window.removeEventListener('resize', schedule); viewport?.removeEventListener('resize', schedule); viewport?.removeEventListener('scroll', schedule);
    document.removeEventListener('compositionstart', begin, true); document.removeEventListener('compositionend', end, true); document.removeEventListener('keydown', key, true);
  };
}
