const api = 'https://izghcfsrkvtxopsfuyic.supabase.co/functions/v1/thread-share';
const heading = document.querySelector('#heading');
const statusText = document.querySelector('#status');
const viewer = document.querySelector('#viewer');
const titleField = document.querySelector('#title');
const contentField = document.querySelector('#content');
const extensionNote = document.querySelector('#extension-note');
const extensionActions = document.querySelector('#extension-actions');
const successText = document.querySelector('#success');
const errorText = document.querySelector('#error');
const shareId = new URL(location.href).searchParams.get('id');
const extensionResponseTimeoutMs = 45_000;
let extensionReady = false;

function decode(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function currentThread() {
  return { title: titleField.value.trim(), content: contentField.value };
}

function setMessage(message, isError = false) {
  successText.textContent = isError ? '' : message;
  errorText.textContent = isError ? message : '';
}

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  if (event.data?.type !== 'CONTEXTLY_EXTENSION_READY') return;
  extensionReady = true;
  extensionActions.hidden = false;
  extensionNote.textContent = 'Contextly detected. Save this thread or inject the edited version directly.';
});
window.postMessage({ type: 'CONTEXTLY_VIEWER_READY' }, location.origin);

function askExtension(destination) {
  return new Promise((resolve, reject) => {
    if (!extensionReady) return reject(new Error('Contextly is not available on this page. Reload the extension and this link.'));
    const requestId = crypto.randomUUID();
    const timeout = setTimeout(() => {
      window.removeEventListener('message', listener);
      reject(new Error('Contextly did not respond. Reload the extension and try again.'));
    }, extensionResponseTimeoutMs);
    function listener(event) {
      if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'CONTEXTLY_RECEIVER_RESPONSE' || event.data.requestId !== requestId) return;
      clearTimeout(timeout);
      window.removeEventListener('message', listener);
      event.data.ok ? resolve(event.data) : reject(new Error(event.data.error || 'Contextly could not receive the thread.'));
    }
    window.addEventListener('message', listener);
    const thread = currentThread();
    window.postMessage({ type: 'CONTEXTLY_RECEIVER_REQUEST', requestId, shareId, title: thread.title, content: thread.content, destination }, location.origin);
  });
}

async function sendToExtension(destination) {
  setMessage('');
  if (!currentThread().title || !currentThread().content) return setMessage('The thread name and content are required.', true);
  try {
    statusText.textContent = destination ? 'Saving and opening the destination…' : 'Saving to Contextly…';
    await askExtension(destination);
    statusText.textContent = destination ? 'Saved to Contextly and inserted as an editable draft.' : 'Saved to your Contextly library.';
    setMessage(statusText.textContent);
  } catch (reason) {
    statusText.textContent = 'Shared checkpoint · Edit or continue when ready';
    setMessage(reason instanceof Error ? reason.message : String(reason), true);
  }
}

async function openThread() {
  try {
    const key = location.hash.slice(1);
    if (!shareId || !key) throw new Error('This private link is incomplete.');
    const response = await fetch(`${api}?id=${encodeURIComponent(shareId)}&format=json`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'This private link is unavailable.');
    const bytes = decode(body.payload);
    const cryptoKey = await crypto.subtle.importKey('raw', decode(key), 'AES-GCM', false, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, cryptoKey, bytes.slice(12));
    const thread = JSON.parse(new TextDecoder().decode(plaintext));
    heading.textContent = 'Shared thread';
    statusText.textContent = 'Shared checkpoint · Edit or continue when ready';
    titleField.value = thread.title;
    contentField.value = thread.content;
    viewer.hidden = false;
    document.querySelector('#save').onclick = () => sendToExtension();
    document.querySelector('#chatgpt').onclick = () => sendToExtension('chatgpt');
    document.querySelector('#claude').onclick = () => sendToExtension('claude');
    document.querySelector('#copy').onclick = async () => {
      await navigator.clipboard.writeText(contentField.value);
      setMessage('Edited thread copied.');
    };
    document.querySelector('#download').onclick = () => {
      const now = new Date().toISOString();
      const edited = currentThread();
      const portable = { format: 'contextly-thread', version: 1, thread: { id: crypto.randomUUID(), title: edited.title, content: edited.content, createdAt: now, updatedAt: now, source: 'imported' } };
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([JSON.stringify(portable, null, 2)], { type: 'application/json' }));
      link.download = `${edited.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'contextly-thread'}.contextly.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    };
  } catch (reason) {
    heading.textContent = 'Thread unavailable';
    statusText.textContent = '';
    setMessage(reason instanceof Error ? reason.message : String(reason), true);
  }
}

void openThread();
