/**
 * Leitor de código de barras pela câmera do celular (PDV e contagem de estoque).
 * Usa o leitor nativo do navegador quando existe (Chrome/Android) e, nos outros
 * (Safari), a biblioteca ZXing, baixada só quando esta tela abre.
 */

import { openModal, toastError } from './kit.js';

const FORMATS = ['ean_13', 'ean_8', 'code_128', 'upc_a'];

export function openScanner({ title = 'Ler código de barras', onCode, keepOpen = false } = {}) {
  let stream = null;
  let stop = () => {};
  let last = '';
  let lastAt = 0;

  const m = openModal({
    title,
    subtitle: 'Aponte para o código, com boa luz',
    body: '<div class="scan-box"><video playsinline muted></video></div>',
    footer: '<button class="btn btn-block" data-close>Fechar</button>',
    onClose: () => { stop(); stream?.getTracks().forEach((t) => t.stop()); },
  });
  const video = m.panel.querySelector('video');

  const emit = (text) => {
    const now = Date.now();
    // a câmera lê o mesmo código várias vezes por segundo
    if (text === last && now - lastAt < 1800) return;
    last = text;
    lastAt = now;
    try { navigator.vibrate?.(60); } catch { /* sem vibração */ }
    onCode(text);
    if (!keepOpen) m.close();
  };

  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream;
      await video.play();
      if ('BarcodeDetector' in window) {
        const det = new window.BarcodeDetector({ formats: FORMATS });
        let alive = true;
        stop = () => { alive = false; };
        const tick = async () => {
          if (!alive) return;
          try {
            const codes = await det.detect(video);
            if (codes[0]?.rawValue) emit(codes[0].rawValue);
          } catch { /* quadro sem imagem ainda */ }
          setTimeout(tick, 220);
        };
        tick();
      } else {
        const { BrowserMultiFormatReader } = await import('https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm');
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromVideoElement(video, (result) => { if (result) emit(result.getText()); });
        stop = () => controls.stop();
      }
    } catch (err) {
      console.error(err);
      m.close();
      toastError('Não consegui abrir a câmera', 'Libere a câmera para este site ou use o leitor USB.');
    }
  })();
  return m;
}
