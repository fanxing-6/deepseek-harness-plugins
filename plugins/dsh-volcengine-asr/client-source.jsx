import React, { useEffect, useRef, useState } from 'react';
import { IconMicrophoneOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';
import { TYPERT_REMOTE } from './remote.js';
import { Recording } from './capture.js';
import styles from './style.css';

export const inject = ['remote', 'slots'];

function VoiceInput({ sessionId, inputActions, useInput, useSession, onActiveChange, locked, remote, microphone, recordings }) {
  const [voiceMode, setVoiceMode] = useState(false);
  const draft = useInput(state => state?.draft ?? '');
  const generating = useSession(state => state.running) ?? false;
  const root = useRef(null);
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState('');
  const [level, setLevel] = useState(0);
  const [cancelArmed, setCancelArmed] = useState(false);
  const current = useRef(null);
  const held = useRef(null);

  useEffect(() => { setVoiceMode(false); }, [sessionId]);
  useEffect(() => {
    onActiveChange(voiceMode);
    return () => onActiveChange(false);
  }, [voiceMode, onActiveChange]);

  function changeMode(next) {
    if (current.current) return;
    if (next) root.current.closest('[data-composer-card]').querySelector('[data-composer-input]')?.blur();
    setVoiceMode(next); setError('');
  }

  async function release(active) {
    clearTimeout(active.submitTimer);
    active.abort.abort();
    active.handle?.dispose();
    await active.recording.dispose();
    recordings.delete(active.recording);
  }

  async function abortRecording(discard = true) {
    const active = current.current;
    held.current = null;
    current.current = null;
    let message = '';
    if (discard && active?.text && !inputActions.insertText('', active.span)) {
      message = '草稿已被修改，录音已取消，请检查输入内容。';
    }
    setPhase('idle'); setError(message); setLevel(0); setCancelArmed(false);
    if (active) await release(active);
  }

  function updateTranscript(active, text) {
    if (text === active.text) return;
    if (!inputActions.insertText(text, active.span)) throw new Error('输入框已修改，听写已停止。');
    const { draftRev } = inputActions.captureInsertion();
    active.span = { start: active.span.start, end: active.span.start + text.length, draftRev };
    active.text = text;
  }

  async function fail(active, failure) {
    if (current.current !== active) return;
    held.current = null;
    current.current = null;
    setPhase('idle'); setError(failure.message); setLevel(0); setCancelArmed(false);
    await release(active);
  }

  useEffect(() => {
    setPhase('idle'); setError(''); setLevel(0); setCancelArmed(false);
    const escape = event => { if (event.key === 'Escape' && current.current) { event.preventDefault(); void abortRecording(); } };
    const hidden = () => { if (document.hidden && held.current) void abortRecording(false); };
    const blur = () => { if (held.current) void abortRecording(false); };
    document.addEventListener('keydown', escape);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('keydown', escape);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('blur', blur);
      held.current = null;
      const active = current.current;
      current.current = null;
      if (active) void release(active);
    };
  }, [sessionId]);

  function submitFinal(active) {
    if (current.current !== active || !active.released) return;
    if (inputActions.captureInsertion().draftRev !== active.span.draftRev) throw new Error('输入框已修改，请检查内容后发送。');
    clearTimeout(active.submitTimer);
    current.current = null;
    setPhase('idle'); setLevel(0); setCancelArmed(false);
    if (active.text.trim()) inputActions.submit();
    else setError('尚未收到识别文字，请重新按住说话。');
    void release(active);
  }

  async function finish(released = true) {
    const active = current.current;
    if (!active) return;
    active.released ||= released;
    if (released && !active.submitTimer) {
      active.submitTimer = setTimeout(() => {
        try { submitFinal(active); } catch (failure) { void fail(active, failure); }
      }, 900);
    }
    if (active.phase === 'ready') {
      try { submitFinal(active); } catch (failure) { await fail(active, failure); }
      return;
    }
    if (!['recording', 'connecting'].includes(active.phase)) return;
    if (!active.recording.node) {
      await fail(active, new Error('录音尚未开始，请按住按钮再说话。'));
      return;
    }
    active.phase = 'finishing'; setPhase('finishing'); setLevel(0);
    try {
      await active.recording.finish();
      active.audioEnded = true;
      if (current.current === active && active.serverReady) active.handle.end();
    } catch (failure) { await fail(active, failure); }
  }

  async function start() {
    if (locked || current.current) return;
    const abort = new AbortController();
    const recording = new Recording(abort.signal);
    try {
      if (typeof inputActions.submit !== 'function') throw new Error('当前 DSH 版本未提供发送接口');
      recording.prepare();
    } catch (failure) {
      await recording.dispose();
      held.current = null;
      setError(failure.message);
      return;
    }
    const insertion = inputActions.captureInsertion();
    const active = {
      abort, recording,
      span: { ...insertion, start: insertion.end }, text: '',
      sent: 0, acknowledged: 0, phase: 'connecting', released: false, finalReceived: false,
      pending: [], serverReady: false, audioEnded: false,
    };
    current.current = active;
    recordings.add(active.recording);
    setPhase('connecting'); setError(''); setLevel(0); setCancelArmed(false);
    try {
      await recording.open(microphone.getSnapshot().id, failure => { void fail(active, failure); });
      if (current.current !== active) { await recording.dispose(); return; }
      if (!active.audioEnded) {
        recording.start((bytes, volume) => {
          try {
            if (active.maxBytes && active.sent >= active.maxBytes) return;
            if (active.sent - active.acknowledged > 64000) throw new Error('音频发送超时，已保留识别文字。');
            setLevel(Math.max(0, Math.min(1, (20 * Math.log10(Math.max(volume, 0.000001)) + 60) / 60)));
            active.sent += bytes.length;
            const chunk = { audioBase64: btoa(String.fromCharCode(...bytes)) };
            if (active.serverReady) active.handle.send(chunk);
            else active.pending.push(chunk);
            if (active.maxBytes && active.sent >= active.maxBytes) void finish(false);
          } catch (failure) { void fail(active, failure); }
        });
      }
      active.handle = remote.volcSpeech.recognize(abort.signal);
      for await (const frame of active.handle) {
        if (current.current !== active) return;
        if (frame.type === 'ready') {
          active.serverReady = true;
          active.maxBytes = frame.maxSeconds * 32000;
          for (const chunk of active.pending) active.handle.send(chunk);
          active.pending = [];
          if (active.audioEnded) active.handle.end();
          if (active.phase === 'connecting') {
            active.phase = 'recording'; setPhase('recording');
          }
        } else if (frame.type === 'ack') {
          active.acknowledged = frame.bytes;
        } else {
          updateTranscript(active, frame.text);
          if (frame.final) {
            active.finalReceived = true;
            setLevel(0);
            if (active.released) { submitFinal(active); return; }
          }
        }
      }
      if (!active.finalReceived && current.current === active) throw new Error('听写连接已结束，未收到最终结果');
      if (current.current === active) { active.phase = 'ready'; setPhase('ready'); submitFinal(active); }
    } catch (failure) { await fail(active, failure); }
  }

  function press(event) {
    if (event.button !== 0 || !event.isPrimary || locked || current.current) return;
    event.preventDefault();
    held.current = { pointerId: event.pointerId, startY: event.clientY, top: event.currentTarget.getBoundingClientRect().top, cancel: false };
    if (event.nativeEvent.isTrusted) event.currentTarget.setPointerCapture(event.pointerId);
    void start();
  }

  function lift(event) {
    if (held.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    move(event);
    const cancel = held.current.cancel;
    held.current = null;
    if (cancel) void abortRecording();
    else { setCancelArmed(false); void finish(); }
  }

  function move(event) {
    const press = held.current;
    if (!press || press.pointerId !== event.pointerId) return;
    event.preventDefault();
    const cancel = press.cancel ? event.clientY < press.top : press.startY - event.clientY >= 56;
    if (cancel === press.cancel) return;
    press.cancel = cancel;
    setCancelArmed(cancel);
  }

  function cancelPointer(event) {
    if (held.current?.pointerId === event.pointerId) void abortRecording();
  }

  function keyDown(event) {
    if (![' ', 'Enter'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.repeat || locked || current.current) return;
    held.current = { key: event.key }; void start();
  }

  function keyUp(event) {
    if (held.current?.key !== event.key) return;
    event.preventDefault(); event.stopPropagation(); held.current = null; void finish();
  }

  const active = phase !== 'idle';
  const label = cancelArmed && active ? '松开取消' : phase === 'connecting' ? '正在准备录音' : phase === 'finishing' ? '正在识别并发送' : active ? '松开发送' : '按住说话';
  return <div ref={root} className="dsh-voice-panel" data-volc-mode={voiceMode ? 'voice' : 'text'} data-volc-generating={generating}>
      {voiceMode && draft.trim() && <div className="dsh-voice-transcript" aria-label="语音转写内容" aria-live="polite">{draft}</div>}
      <div className="dsh-voice-row">
        {voiceMode && <button type="button" className="dsh-voice-hold" disabled={!active && locked}
          aria-label={label} aria-pressed={active} title="按住说话，松开发送，上滑取消"
          data-volc-speech={phase} data-volc-gesture="hold" data-volc-cancel={cancelArmed}
          onPointerDown={press} onPointerMove={move} onPointerUp={lift} onPointerCancel={cancelPointer} onLostPointerCapture={cancelPointer}
          onKeyDown={keyDown} onKeyUp={keyUp}
          onContextMenu={event => event.preventDefault()} onClick={event => event.preventDefault()}>
          <span>{label}</span>
          {active && phase !== 'finishing' && <span className="dsh-voice-gesture-hint" role="status">{cancelArmed ? '松手取消 · 滑回继续' : '松开发送 · 上滑取消'}</span>}
          {active && <span role="meter" className="dsh-voice-meter" aria-label="麦克风音量" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
            <span style={{ transform: `scaleX(${level})` }} />
          </span>}
        </button>}
        <button key="mode" type="button" className="dsh-voice-toggle"
          aria-label={voiceMode ? '切换文字输入' : '切换语音输入'} title={voiceMode ? '切换文字输入' : '切换语音输入'}
          disabled={active || locked} onMouseDown={event => event.preventDefault()} onClick={() => changeMode(!voiceMode)}>
          {voiceMode ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="3"/><path d="M5 9h2m2 0h2m2 0h2m2 0h2M5 12h2m2 0h2m2 0h2m2 0h2M7 15h10"/></svg> : <IconMicrophoneOutlineRegular size={20} />}
        </button>
      </div>
    {error && <div role="alert" className="dsh-voice-error">{error}</div>}
  </div>;
}

export async function apply(ctx) {
  const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE);
  const style = document.createElement('style'); style.textContent = styles; document.head.append(style);
  const microphone = createSnapshotStore({ id: '', label: '' }, { persist: { name: 'dsh.voice-input.microphone' } });
  const recordings = new Set();
  const ui = ctx.inject(['remote.volcSpeech', 'slots'], child => {
    child.slots.inject('conversation.input.activity', () => child.slots.register({
      name: 'conversation.input.activity',
      inject: () => ({ remote: child.remote, microphone, recordings }),
    }, VoiceInput));
  });
  await ui;
  return async () => {
    await ui.dispose();
    await Promise.all([...recordings].map(recording => recording.dispose()));
    style.remove();
    await disposeRemote();
  };
}
