const opened = new Promise((resolve, reject) => {
  const request = indexedDB.open('dsh-voice-recordings', 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore('recordings', { keyPath: 'id' });
    request.result.createObjectStore('audio', { keyPath: ['id', 'index'] });
    request.result.createObjectStore('transcripts', { keyPath: ['id', 'index'] });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

async function transaction(store, mode, action) {
  const database = await opened;
  return new Promise((resolve, reject) => {
    const tx = database.transaction(store, mode);
    const request = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error ?? new Error('语音记录保存失败'));
    tx.onerror = () => reject(tx.error);
  });
}

export class VoiceArchive {
  constructor(sessionId, id = crypto.randomUUID()) {
    this.record = { id, sessionId, created: Date.now(), text: '', status: 'recording' };
    this.audioIndex = 0; this.textIndex = 0;
    this.pending = Promise.resolve();
  }
  save(patch) {
    Object.assign(this.record, patch);
    const value = { ...this.record };
    this.pending = this.pending.then(() => transaction('recordings', 'readwrite', store => store.put(value)));
    return this.pending;
  }
  audio(bytes) {
    const value = { id: this.record.id, index: this.audioIndex++, bytes };
    this.pending = this.pending.then(() => transaction('audio', 'readwrite', store => store.put(value)));
    return this.pending;
  }
  transcript(text, final) {
    const value = { id: this.record.id, index: this.textIndex++, text, final, created: Date.now() };
    this.pending = this.pending.then(() => transaction('transcripts', 'readwrite', store => store.put(value)));
    return this.save({ text, final, status: final ? 'recognized' : 'recording' });
  }
}

export async function listRecordings() {
  const values = await transaction('recordings', 'readonly', store => store.getAll());
  return values.filter(value => value.status !== 'cancelled').sort((a, b) => b.created - a.created);
}

export function readAudio(id) {
  return transaction('audio', 'readonly', store => store.getAll(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER])));
}

export function readTranscripts(id) {
  return transaction('transcripts', 'readonly', store => store.getAll(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER])));
}
