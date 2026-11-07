import source from './capture.worklet';

export class Recording {
  constructor(signal) { this.signal = signal; }

  prepare() {
    this.signal.throwIfAborted();
    if (!window.isSecureContext) throw new Error('请使用 HTTPS 地址打开听写。当前 HTTP 页面无法申请麦克风权限。');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器未提供麦克风接口，请使用最新版 Chrome 或 Safari。');
    this.context = new AudioContext({ sampleRate: 16000 });
    if (this.context.sampleRate !== 16000) throw new Error('麦克风采样率不支持');
    this.resumed = this.context.resume().then(() => null, error => error);
  }

  async open(deviceId, onFailure) {
    this.signal.throwIfAborted();
    if (!this.context) throw new Error('录音初始化尚未完成');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
    });
    if (this.signal.aborted) {
      for (const track of stream.getTracks()) track.stop();
      this.signal.throwIfAborted();
    }
    this.stream = stream;
    for (const track of stream.getTracks()) track.onended = () => onFailure(new Error('麦克风已断开'));
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    try { await this.context.audioWorklet.addModule(url); }
    finally { URL.revokeObjectURL(url); }
    this.signal.throwIfAborted();
    const resumeError = await this.resumed;
    if (resumeError) throw resumeError;
    this.onFailure = onFailure;
  }

  start(onAudio) {
    this.signal.throwIfAborted();
    if (!this.stream) throw new Error('麦克风尚未就绪');
    this.node = new AudioWorkletNode(this.context, 'dsh-volc-pcm');
    this.node.onprocessorerror = () => this.onFailure(new Error('音频处理失败'));
    this.node.port.onmessage = event => {
      if (this.signal.aborted) return;
      if (event.data.type === 'finished') this.finishResolve?.();
      else onAudio(new Uint8Array(event.data.bytes), event.data.level);
    };
    this.input = this.context.createMediaStreamSource(this.stream);
    this.mute = this.context.createGain();
    this.mute.gain.value = 0;
    this.input.connect(this.node).connect(this.mute).connect(this.context.destination);
  }

  async finish() {
    if (!this.node) throw new Error('录音尚未开始');
    this.input.disconnect();
    const finished = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('音频处理结束超时')), 2000);
      this.finishResolve = () => { clearTimeout(timer); resolve(); };
    });
    this.node.port.postMessage('finish');
    await finished;
    void this.dispose();
  }

  dispose() {
    if (this.disposing) return this.disposing;
    for (const track of this.stream?.getTracks() ?? []) { track.onended = null; track.stop(); }
    this.node?.disconnect();
    this.input?.disconnect();
    this.mute?.disconnect();
    this.disposing = this.context && this.context.state !== 'closed' ? this.context.close() : Promise.resolve();
    return this.disposing;
  }
}
