/**
 * Comportamento dos campos numéricos, ligado uma vez para o app inteiro.
 *
 *  - Dinheiro (qualquer campo dentro de `.money-input`): a vírgula entra
 *    sozinha. Digitar 1 5 0 0 0 0 mostra "1.500,00".
 *  - Ao tocar num campo de valor ou quantidade que já tem algo escrito, o
 *    conteúdo fica selecionado: o primeiro dígito digitado substitui tudo,
 *    sem precisar apagar o valor antigo.
 *
 * Os ouvintes ficam no documento em fase de captura, então a máscara roda
 * antes dos ouvintes de cada tela, que já leem o valor formatado.
 */

import { maskMoney, parseMoney, moneyInputValue } from '../core/utils.js';

const MONEY = '.money-input > input';
const SELECT_ON_FOCUS = `${MONEY}, input[type="number"]`;

let wired = false;

export function initInputs() {
  if (wired) return;
  wired = true;

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!el.matches?.(MONEY)) return;
    const masked = maskMoney(el.value);
    if (masked !== el.value) el.value = masked;
    // Na máscara os dígitos entram pela direita: o cursor mora no fim.
    const end = el.value.length;
    try { el.setSelectionRange(end, end); } catch { /* campo sem seleção */ }
  }, true);

  // Colar "1.500" ou "R$ 1.500,50" deve dar o valor certo, não "15,00".
  document.addEventListener('paste', (e) => {
    const el = e.target;
    if (!el.matches?.(MONEY)) return;
    const text = e.clipboardData?.getData('text');
    if (!text) return;
    e.preventDefault();
    el.value = moneyInputValue(parseMoney(text));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, true);

  let justFocused = null;

  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (!el.matches?.(SELECT_ON_FOCUS) || !el.value) return;
    justFocused = el;
    // O Safari do iPhone só respeita a seleção depois que o foco assenta.
    setTimeout(() => selectAll(el), 0);
  });

  // No clique, o navegador desfaz a seleção ao soltar o botão. Impede só
  // nesse primeiro soltar, para o usuário ainda poder posicionar o cursor.
  document.addEventListener('mouseup', (e) => {
    if (e.target === justFocused) e.preventDefault();
  });

  // No toque, o cursor é posicionado DEPOIS do foco (o setTimeout acima
  // perde a corrida) e o primeiro dígito entrava no meio do valor antigo:
  // 4.600,00 virava 5.460.000,00. O click chega por último - seleciona de novo.
  document.addEventListener('click', (e) => {
    if (e.target === justFocused) selectAll(e.target);
    justFocused = null;
  }, true);
  document.addEventListener('focusout', (e) => {
    if (e.target === justFocused) justFocused = null;
  });
}

function selectAll(el) {
  if (document.activeElement !== el) return;
  try { el.setSelectionRange(0, el.value.length); } catch { el.select(); }
}
