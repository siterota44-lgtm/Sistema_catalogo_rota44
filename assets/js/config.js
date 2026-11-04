/**
 * Configuração da conexão com o Supabase.
 *
 * ┌─ É SEGURO estas duas linhas ficarem no repositório e no HTML público? ─┐
 * │ SIM. A chave "publishable" é feita para ficar no navegador. Quem       │
 * │ protege os dados é o RLS ativado no banco: sem estar logado, a chave   │
 * │ só alcança o catálogo público.                                         │
 * │ O que NUNCA pode aparecer aqui é a chave secreta (service_role).       │
 * └────────────────────────────────────────────────────────────────────────┘
 */

const SUPABASE = {
  url: 'https://jjynilzpcekissqkbigj.supabase.co',
  anonKey: 'sb_publishable_VuIb8VQW_25fDUxTk1O81Q_40Cl9ES0',
};

export function getConfig() {
  return { ...SUPABASE };
}

/** Configurações de comportamento do app (não são segredos). */
export const APP = {
  name: 'Rota 44',
  subtitle: 'Gestão da loja',
  /** Minutos de inatividade até deslogar automaticamente. 0 = desativado. */
  idleLogoutMinutes: 60,
  /** Quantas linhas por página nas listas longas. */
  pageSize: 50,
  /** Bucket do Supabase Storage para as fotos (criado pelo schema.sql). */
  photoBucket: 'produtos',
  /** Versão do app (aparece em Ajustes e nos erros do Diagnóstico). */
  version: '1.1.0',
  /**
   * Versão do banco que este app precisa (whoami().schema_version). Banco
   * mais antigo = tela "rode o supabase/schema.sql" em vez de erro escondido.
   */
  schemaVersion: 2,
};
