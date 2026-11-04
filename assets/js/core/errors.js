/**
 * Erros do banco em português, num ponto só.
 *
 * As funções do schema já levantam mensagens prontas para quem usa
 * (`raise exception 'Estoque insuficiente...'`, código P0001) - essas passam
 * direto. O resto (RLS, rede, check) vira uma frase que diz o que fazer.
 */

export function friendlyError(err) {
  const code = String(err?.code || '');
  const msg = String(err?.message || err || '');
  const low = msg.toLowerCase();

  // Mensagens prontas das funções do banco (raise exception) passam direto
  // (os prefixos "EM_USO:" / "CONFLITO:" são só para a tela reconhecer o caso).
  if (code === 'P0001') return msg.replace(/^(EM_USO|CONFLITO|DESCONTO_ACIMA):\s*/, '');
  if (low.includes('failed to fetch') || low.includes('networkerror') || low.includes('load failed')
      || low.includes('network request failed')) {
    return 'Sem conexão com o servidor. O que você preencheu continua aqui: confira a internet e tente de novo.';
  }
  if (code === '23503' || low.includes('foreign key')) {
    return 'Este cadastro está sendo usado em outro lugar (produto, venda ou compra). Em vez de excluir, desative.';
  }
  if (code === '42501' || low.includes('permission denied') || low.includes('row-level security')) {
    return low.includes('acesso negado') ? msg : 'Este login não tem permissão para isso.';
  }
  if (code === 'PGRST301' || code === 'PGRST303' || low.includes('jwt expired') || low.includes('jwt')) {
    return 'Sua sessão expirou. Recarregue a página e entre de novo.';
  }
  if (code === '23514' || low.includes('violates check constraint')) {
    return 'Algum valor está fora do permitido (tamanho ou formato). Confira os campos.';
  }
  if (code === '23505' || low.includes('duplicate key')) {
    if (low.includes('sku')) return 'Esse SKU já existe em outra variação.';
    if (low.includes('barcode')) return 'Esse código de barras já existe em outra variação.';
    if (low.includes('slug')) return 'Já existe um cadastro com esse nome.';
    if (low.includes('code')) return 'Esse código já está em uso.';
    if (low.includes('name')) return 'Já existe um cadastro com esse nome.';
    return 'Já existe um cadastro com esses dados.';
  }
  if (code === 'PGRST205' || code === 'PGRST202' || code === '42P01' || code === '42883') {
    return 'O banco ainda não foi preparado para esta versão (falta rodar o supabase/schema.sql no Supabase).';
  }
  return msg || 'Não foi possível concluir a operação.';
}

/** Desconto acima do limite do perfil: a tela pede a senha do gerente. */
export function needsApproval(err) {
  return /^DESCONTO_ACIMA/.test(String(err?.message || ''));
}

/** Tabela/função ainda não criada no banco - o schema.sql não foi rodado. */
export function isMissingSchema(err) {
  const code = String(err?.code || '');
  return code === 'PGRST205' || code === 'PGRST202' || code === '42P01' || code === '42883';
}

/** Erro de rede (sem internet / 4G travado). */
export function isNetworkError(err) {
  const low = String(err?.message || err || '').toLowerCase();
  return low.includes('failed to fetch') || low.includes('networkerror') || low.includes('load failed')
    || low.includes('network request failed');
}
