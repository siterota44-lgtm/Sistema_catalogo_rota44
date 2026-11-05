/**
 * Leitor de código de barras pela câmera do celular (PDV e contagem de estoque).
 * Usa o leitor nativo do navegador quando existe (Chrome/Android) e, nos outros
 * (Safari do iPhone), o ZXing em WebAssembly, baixado só quando esta tela abre.
 * Não troque pelo @zxing/browser: ele não acha o Code 128 quando há algo escuro à
 * esquerda do código na imagem, ou seja, nunca leria etiqueta em camiseta preta.
 */

import { openModal, toastError } from './kit.js';

const FORMATS = ['ean_13', 'ean_8', 'code_128', 'upc_a'];

const READER = 'https://cdn.jsdelivr.net/npm/barcode-detector@3.2.3/ponyfill/+esm';
const WASM = 'https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.6/dist/reader/';

async function makeDetector() {
  if ('BarcodeDetector' in window) {
    try {
      if ((await window.BarcodeDetector.getSupportedFormats()).includes('code_128')) return new window.BarcodeDetector({ formats: FORMATS });
    } catch { /* cai no leitor próprio */ }
  }
  const { BarcodeDetector, prepareZXingModule } = await import(READER);
  prepareZXingModule({ overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? WASM + path : prefix + path) } });
  return new BarcodeDetector({ formats: FORMATS });
}

export function openScanner({ title = 'Ler código de barras', onCode, keepOpen = false } = {}) {
  let stream = null;
  let stop = () => {};
  let last = '';
  let lastAt = 0;

  const m = openModal({
    title,
    subtitle: 'Aponte para o código, com boa luz',
    body: '<div class="scan-box" data-box><video playsinline muted></video></div><p class="scan-last small" data-last aria-live="polite"></p>',
    footer: '<button class="btn btn-block" data-close>Fechar</button>',
    onClose: () => { stop(); stream?.getTracks().forEach((t) => t.stop()); },
  });
  const video = m.panel.querySelector('video');

  const emit = (text) => {
    const now = Date.now();
    // a câmera lê o mesmo código várias vezes por segundo: parada em cima dele,
    // conta uma vez só. Para repetir a peça, tire a câmera e aponte de novo.
    if (text === last && now - lastAt < 1800) { lastAt = now; return; }
    last = text;
    lastAt = now;
    try { navigator.vibrate?.(60); } catch { /* sem vibração */ }
    const said = onCode(text);
    if (!keepOpen) { m.close(); return; }
    // o iPhone não vibra pelo navegador: a confirmação é na tela
    const box = m.panel.querySelector('[data-box]');
    box.classList.add('hit');
    setTimeout(() => box.classList.remove('hit'), 350);
    if (said) m.panel.querySelector('[data-last]').textContent = said;
  };

  (async () => {
    try {
      // sem pedir resolução, o iPhone entrega imagem pequena e a barra fina da etiqueta não lê
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } });
      if (!m.panel.isConnected) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.srcObject = stream;
      await video.play();
      const det = await makeDetector();
      let alive = true;
      stop = () => { alive = false; };
      const tick = async () => {
        if (!alive || !m.panel.isConnected) return;
        try {
          const codes = await det.detect(video);
          if (codes[0]?.rawValue) emit(codes[0].rawValue);
        } catch { /* quadro sem imagem ainda */ }
        setTimeout(tick, 150);
      };
      tick();
    } catch (err) {
      console.error(err);
      m.close();
      toastError('Não consegui abrir a câmera', 'Libere a câmera para este site ou use o leitor USB.');
    }
  })();
  return m;
}
