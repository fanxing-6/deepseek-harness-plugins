import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

export function PixelPreview({ controller, empty }) {
  const area = useRef(null), stage = useRef(null), screen = useRef(null), keyboard = useRef(null);
  const pending = useRef(null), busy = useRef(false), generation = useRef(0), press = useRef(null), composing = useRef(false);
  const [frame, setFrame] = useState(null), [room, setRoom] = useState({ width: 0, height: 0 }), [visible, setVisible] = useState(true);
  const current = useRef(null); current.current = frame;
  const scale = frame ? Math.min(room.width / frame.width, room.height / frame.height, 1) : 1;
  const source = useRef(null);
  const displayWidth = frame ? Math.round(frame.width * scale * devicePixelRatio) / devicePixelRatio : 0;
  const displayHeight = frame ? Math.round(frame.height * scale * devicePixelRatio) / devicePixelRatio : 0;
  useLayoutEffect(() => {
    if (!frame || !source.current || !displayWidth || !displayHeight) return;
    const canvas = screen.current, image = source.current;
    canvas.width = Math.round(displayWidth * devicePixelRatio); canvas.height = Math.round(displayHeight * devicePixelRatio);
    const context = canvas.getContext('2d'); context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let cancelled = false;
    void createImageBitmap(image, { resizeWidth:canvas.width, resizeHeight:canvas.height, resizeQuality:'high' }).then(bitmap => {
      if (!cancelled) { context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0); }
      bitmap.close();
    }).catch(error => controller.update({ error:'手机画面缩放失败：'+error.message }));
    return () => { cancelled = true; };
  }, [frame, displayWidth, displayHeight]);
  const send = command => { if (controller.handle && controller.state.selected) controller.send({ type: 'command', command }); };
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setRoom({ width: Math.max(0, entry.contentRect.width - 12), height: Math.max(0, entry.contentRect.height - 12) }));
    observer.observe(area.current);
    const clear = () => { generation.current++; pending.current = null; press.current = null; setFrame(null); };
    const paint = async () => {
      if (busy.current || !pending.current) return;
      busy.current = true;
      const next = pending.current; pending.current = null;
      const revision = generation.current;
      try {
        const image = new Image(); image.src = 'data:image/png;base64,' + next.image; await image.decode();
        if (revision !== generation.current) return;
        const canvas = screen.current;
        source.current = image;
        canvas.dataset.sequence = String(next.sequence);
        canvas.dataset.sourceWidth = String(image.naturalWidth); canvas.dataset.sourceHeight = String(image.naturalHeight);
        canvas.dataset.captureMetadata = JSON.stringify(next.metadata);
        const width = next.viewport.width, height = width * image.naturalHeight / image.naturalWidth;
        setFrame({ width, height, metadata: next.metadata });
      } catch (error) { controller.update({ error: '手机画面解码失败：' + error.message }); }
      finally { busy.current = false; if (pending.current) void paint(); }
    };
    const off = controller.onFrame(data => {
      if (data.type === 'reset') { clear(); setVisible(data.visible); }
      else if (data.type === 'pixels') { pending.current = data; void paint(); }
      else if (data.type === 'viewport') setVisible(data.visible);
      else if (['stop','stopped','offline'].includes(data.type)) clear();
    });
    return () => { clear(); off(); observer.disconnect(); };
  }, [controller]);
  const point = event => {
    const box = stage.current.getBoundingClientRect(), value = current.current;
    if (!value || !box.width || !box.height) return null;
    return { x: Math.max(0, Math.min(value.width - 1, (event.clientX - box.left) * value.width / box.width)), y: Math.max(0, Math.min(value.height - 1, (event.clientY - box.top) * value.height / box.height)) };
  };
  const end = (phase, event) => {
    const active = press.current;
    if (!active || event && event.pointerId !== active.pointerId) return;
    press.current = null;
    send({ action: 'pointer', pointerId: active.pointerId, phase, ...(event ? point(event) : active.point) });
  };
  useEffect(() => {
    const blur = () => end('cancel');
    const hidden = () => { if (document.hidden) end('cancel'); };
    window.addEventListener('blur', blur); document.addEventListener('visibilitychange', hidden);
    const wheel = event => { const value = point(event); if (!value) return; event.preventDefault(); const factor = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? current.current.height : 1; send({ action: 'wheel', ...value, dx: event.deltaX * factor, dy: event.deltaY * factor }); };
    stage.current.addEventListener('wheel', wheel, { passive: false });
    return () => { end('cancel'); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', hidden); stage.current?.removeEventListener('wheel', wheel); };
  }, [controller]);
  const text = event => { if (composing.current) return; const value = event.target.value; if (value) send({ action: 'text', text: value }); event.target.value = ''; };
  return <div ref={area} className="dsh-collab-area">
    <div ref={stage} className="dsh-collab-stage" style={{ width: displayWidth, height: displayHeight, visibility: frame ? 'visible' : 'hidden' }}>
      <canvas ref={screen} className="dsh-collab-pixels" aria-label="手机原始画面" />
      <div className="dsh-collab-overlay" role="application" aria-label="手机实时画面" tabIndex={0}
        onPointerDown={event => { if (event.button !== 0 || !event.isPrimary || press.current) return; const value = point(event); if (!value) return; event.preventDefault(); keyboard.current.focus({ preventScroll:true }); event.currentTarget.setPointerCapture(event.pointerId); press.current = { pointerId: event.pointerId, point: value }; send({ action:'pointer', pointerId:event.pointerId, phase:'start', ...value }); }}
        onPointerMove={event => { if (press.current?.pointerId !== event.pointerId) return; event.preventDefault(); send({ action:'pointer', pointerId:event.pointerId, phase:'move', ...point(event) }); }}
        onPointerUp={event => end('end', event)} onPointerCancel={event => end('cancel', event)} onLostPointerCapture={event => end('cancel', event)} onContextMenu={event => event.preventDefault()} />
      <textarea ref={keyboard} className="dsh-collab-keyboard" aria-label="手机同步输入" onCompositionStart={() => { composing.current = true; }} onCompositionEnd={event => { composing.current = false; text(event); }} onInput={text}
        onKeyDown={event => { if (event.isComposing || composing.current || event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) return; event.preventDefault(); send({ action:'keyboard', key:event.key, code:event.code, keyCode:event.keyCode, modifiers:(event.altKey?1:0)|(event.ctrlKey?2:0)|(event.metaKey?4:0)|(event.shiftKey?8:0) }); }} />
    </div>
    {!frame && <div style={{position:'absolute'}}>{empty}</div>}
    {frame && !visible && <div className="dsh-collab-empty" style={{position:'absolute',background:'var(--dsw-alias-background-primary,#fff)'}}>手机网页位于后台，请切回手机浏览器。</div>}
  </div>;
}
