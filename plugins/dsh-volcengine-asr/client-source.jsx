import React, { useEffect, useRef, useState } from 'react';
import { IconMicrophoneOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';
import { TYPERT_REMOTE } from './remote.js';
import { Recording } from './capture.js';
import { VoiceArchive, listRecordings, readAudio, readTranscripts } from './archive.js';
import styles from './style.css';

export const inject = ['remote', 'slots'];

function VoiceInput({ sessionId, inputActions, useInput, useSession, locked, remote, microphone, recordings }) {
  const [voiceMode, setVoiceMode] = useState(false);
  const input = useInput(state => state);
  const draft = input?.draft ?? '';
  const inputState = useRef(input); inputState.current = input;
  const generating = useSession(state => state.running) ?? false;
  const root = useRef(null);
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState('');
  const [level, setLevel] = useState(0);
  const [cancelArmed, setCancelArmed] = useState(false);
  const current = useRef(null);
  const held = useRef(null);
  const [history, setHistory] = useState(null);

  async function showHistory() {
    try { setHistory(await listRecordings()); }
    catch (failure) { setError('读取语音记录失败：' + failure.message); }
  }

  useEffect(() => { setVoiceMode(false); }, [sessionId]);

  function changeMode(next) {
    if (current.current) return;
    if (next) root.current.closest('[data-composer-card]').querySelector('[data-composer-input]')?.blur();
    setVoiceMode(next); setError('');
  }

  async function release(active) {
    clearTimeout(active.waitTimer);
    active.abort.abort();
    active.handle?.dispose();
    if (active.recording) { await active.recording.dispose(); recordings.delete(active.recording); }
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
    if (active) void active.archive.save({ status: discard ? 'cancelled' : 'interrupted' }).catch(failure => setError('语音记录保存失败：' + failure.message));
    if (active) await release(active);
  }

  async function updateTranscript(active, text, final) {
    await active.archive.transcript(text, final);
    if (current.current !== active || text === active.text) return;
    active.text = text;
    if (!inputActions.insertText(text, active.span)) throw new Error('输入框已修改，完整转写保存在语音记录中。');
    const { draftRev } = inputActions.captureInsertion();
    active.span = { start: active.span.start, end: active.span.start + text.length, draftRev };
  }

  async function fail(active, failure) {
    if (current.current !== active || active.failing || active.submitting) return;
    active.failing = true;
    await release(active);
    active.failure = failure;
    active.phase = 'ready'; setPhase('ready'); setError(failure.message + '；已保留语音记录。'); setLevel(0);
    void active.archive.save({ status: 'interrupted', error: failure.message }).catch(error => setError('语音记录保存失败：' + error.message + '；请保留当前页面中的文字。'));
    active.failing = false;
    if (active.released) await submitFinal(active);
  }

  useEffect(() => {
    setPhase('idle'); setError(''); setLevel(0); setCancelArmed(false);
    const escape = event => { if (event.key === 'Escape' && current.current) { event.preventDefault(); void abortRecording(); } };
    const complete = () => {
      if (!held.current) return;
      const cancel = held.current.cancel;
      held.current = null;
      if (cancel) void abortRecording(); else void finish();
    };
    const hidden = () => { if (document.hidden) complete(); };
    const blur = complete;
    const pointerUp = event => { if (held.current?.pointerId === event.pointerId) lift(event); };
    window.addEventListener('pointerup', pointerUp, true);
    document.addEventListener('keydown', escape);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('keydown', escape);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('blur', blur);
      window.removeEventListener('pointerup', pointerUp, true);
      held.current = null;
      const active = current.current;
      current.current = null;
      if (active) void release(active);
    };
  }, [sessionId]);

  async function submitFinal(active) {
    if (current.current !== active || !active.released || active.submitting) return;
    active.submitting = true;
    try {
      if (!active.text.trim()) throw new Error(active.archive.audioIndex ? '未收到识别文字，录音已保存在语音记录中，可重新识别并发送。' : '麦克风尚未采集到音频，请允许麦克风访问后重新录音。');
      if (inputActions.captureInsertion().draftRev !== active.span.draftRev) throw new Error('输入框内容已经变化，完整转写保存在语音记录中，请恢复后发送。');
      clearTimeout(active.waitTimer);
      active.phase = 'submitting'; setPhase('submitting'); setLevel(0); setCancelArmed(false);
      inputActions.submit();
      const deadline = Date.now() + 20000;
      while (current.current === active) {
        await new Promise(resolve => setTimeout(resolve, 50));
        const state = inputState.current;
        if (state && !state.draft.trim() && state.phase === 'plain') {
          await active.archive.save({ status: 'submitted' });
          if (current.current === active) { current.current = null; setPhase('idle'); setError(active.failure ? '识别连接中断，已发送收到的文字；录音保留在语音记录中。' : ''); }
          return;
        }
        if (Date.now() >= deadline) throw new Error('尚未确认消息发送成功，文字和录音已保留。请检查消息或待发送队列。');
      }
    } catch (failure) {
      if (current.current === active) { current.current = null; setPhase('idle'); setError(failure.message); }
    } finally { await release(active); }
  }

  async function finish(released = true) {
    const active = current.current;
    if (!active) return;
    active.released ||= released;
    if (released && !active.waitTimer) {
      active.waitTimer = setTimeout(() => {
        if (current.current === active && !active.submitting) setError('正在等待完整识别结果，文字和录音已保留，完成后自动发送。');
      }, 1200);
    }
    if (active.phase === 'ready') {
      await submitFinal(active);
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
      abort, recording, archive: new VoiceArchive(sessionId),
      span: { ...insertion, start: insertion.end }, text: '',
      sent: 0, acknowledged: 0, phase: 'connecting', released: false, finalReceived: false,
      pending: [], serverReady: false, audioEnded: false,
    };
    current.current = active;
    recordings.add(active.recording);
    setPhase('connecting'); setError(''); setLevel(0); setCancelArmed(false);
    try {
      await active.archive.save({});
      await recording.open(microphone.getSnapshot().id, failure => { void fail(active, failure); });
      if (current.current !== active) { await recording.dispose(); return; }
      if (!active.audioEnded) {
        recording.start((bytes, volume) => {
          try {
            void active.archive.audio(bytes).catch(failure => { void fail(active, failure); });
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
          await updateTranscript(active, frame.text, frame.final);
          if (frame.final) {
            active.finalReceived = true;
            setLevel(0);
            if (active.released) { await submitFinal(active); return; }
          }
        }
      }
      if (!active.finalReceived && current.current === active) throw new Error('听写连接已结束，未收到最终结果');
      if (current.current === active) { active.phase = 'ready'; setPhase('ready'); await submitFinal(active); }
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
    if (held.current?.pointerId !== event.pointerId) return;
    const cancel = held.current.cancel; held.current = null;
    if (cancel) void abortRecording(); else void finish();
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
  async function recover(entry, audio = false) {
    if (current.current || locked) return;
    const existing = inputState.current?.draft ?? '';
    if (existing.trim() && existing !== entry.text) { setError('当前输入框有其他草稿，请处理草稿后再发送语音记录。'); return; }
    const abort = new AbortController();
    const insertion = inputActions.captureInsertion();
    const active = { abort, archive: new VoiceArchive(sessionId), span: existing ? { ...insertion, start: 0, end: existing.length } : { ...insertion, start: insertion.end }, text: '', released: true, phase: 'finishing' };
    current.current = active; setPhase('finishing'); setError(''); setHistory(null);
    try {
      await active.archive.save({ sourceId: entry.id });
      if (!audio) { await updateTranscript(active, entry.text, true); await submitFinal(active); return; }
      const chunks = await readAudio(entry.id);
      if (!chunks.length) throw new Error('这条语音记录没有音频，请恢复已经识别的文字。');
      active.handle = remote.volcSpeech.recognize(abort.signal);
      for await (const frame of active.handle) {
        if (current.current !== active) return;
        if (frame.type === 'ready') {
          active.upload = (async () => {
            for (const chunk of chunks) {
              abort.signal.throwIfAborted();
              await active.archive.audio(chunk.bytes);
              active.handle.send({ audioBase64: btoa(String.fromCharCode(...chunk.bytes)) });
              await new Promise(resolve => setTimeout(resolve, chunk.bytes.length / 32));
            }
            active.handle.end();
          })();
          void active.upload.catch(failure => fail(active, failure));
        } else if (frame.type === 'transcript') {
          await updateTranscript(active, frame.text, frame.final);
          if (frame.final) { await submitFinal(active); return; }
        }
      }
      throw new Error('识别连接中断');
    } catch (failure) { await fail(active, failure); }
  }

  const label = cancelArmed && active ? '松开取消' : phase === 'connecting' ? '正在准备录音' : phase === 'submitting' ? '正在发送' : phase === 'finishing' ? '正在识别，完成后发送' : active ? '松开发送' : '按住说话';
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
    {voiceMode && <button type="button" className="dsh-voice-history-toggle" onClick={showHistory}>语音记录</button>}
    {history && <div className="dsh-voice-history" role="dialog" aria-label="语音记录">
      <button type="button" onClick={() => setHistory(null)}>关闭语音记录</button>
      {!history.length && <p>当前浏览器暂无语音记录。</p>}
      {history.map(entry => <div key={entry.id}>
        <div>{new Date(entry.created).toLocaleString()} · {entry.status === 'submitted' ? '已提交' : '已保留'}</div>
        <p>{entry.text || '录音已保留，尚未识别到文字。'}</p>
        <button type="button" disabled={active || !entry.text} onClick={() => recover(entry)}>发送这段文字</button>
        <button type="button" disabled={active} onClick={() => recover(entry, true)}>重新识别并发送</button>
        <button type="button" onClick={async () => { try { const versions = await readTranscripts(entry.id); setHistory(values => values.map(value => value.id === entry.id ? { ...value, versions } : value)); } catch (failure) { setError(failure.message); } }}>查看识别过程</button>
        {entry.versions?.map(value => <p key={value.index}>{value.text}</p>)}
      </div>)}
    </div>}
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
