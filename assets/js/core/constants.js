/** Listas fixas do sistema: situações, formas de pagamento, perfis, tipos. */

export const ROLES = {
  admin: 'Admin / Dono',
  gerente: 'Gerente',
  vendedor: 'Vendedor',
  estoquista: 'Estoquista',
};

/* Funil da venda. `next` = para onde ela costuma andar. */
export const SALE_STATUS = {
  aguardando_pagamento: { label: 'Aguardando pgto.', tone: 'amber', open: true },
  pago: { label: 'Pago', tone: 'blue', open: true },
  em_separacao: { label: 'Em separação', tone: 'indigo', open: true },
  enviado: { label: 'Enviado', tone: 'teal', open: true },
  pronto_retirada: { label: 'Pronto p/ retirada', tone: 'teal', open: true },
  entregue: { label: 'Entregue', tone: 'green', open: false },
  cancelado: { label: 'Cancelado', tone: 'red', open: false },
};
export const FLOW = ['aguardando_pagamento', 'pago', 'em_separacao', 'pronto_retirada', 'enviado', 'entregue'];

export const CHANNELS = {
  balcao: 'Balcão',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  site: 'Catálogo online',
  marketplace: 'Marketplace',
  outro: 'Outro',
};

export const PAYMENT_METHODS = {
  dinheiro: { label: 'Dinheiro', icon: 'cash' },
  pix: { label: 'Pix', icon: 'qr' },
  debito: { label: 'Débito', icon: 'card' },
  credito: { label: 'Crédito', icon: 'card' },
  vale_troca: { label: 'Vale-troca', icon: 'tag' },
  crediario: { label: 'Crediário', icon: 'calendar' },
  outro: { label: 'Outro', icon: 'wallet' },
};

export const DELIVERY = {
  balcao: 'Levou na hora',
  retirada: 'Retirada na loja',
  motoboy: 'Motoboy',
  correios: 'Correios',
  transportadora: 'Transportadora',
};

export const GENDERS = { unissex: 'Unissex', masculino: 'Masculino', feminino: 'Feminino', infantil: 'Infantil' };
export const FITS = ['Oversized', 'Regular', 'Boxy', 'Baggy', 'Slim', 'Cropped', 'Wide', 'Reta'];
export const PRINT_TYPES = ['Silk', 'DTF', 'Bordado', 'Puff', 'Estonado', 'Lavagem ácida', 'Patch', 'Sem estampa'];
export const PRODUCT_STATUS = {
  ativo: { label: 'Ativo', tone: 'green' },
  rascunho: { label: 'Rascunho', tone: 'amber' },
  inativo: { label: 'Inativo', tone: 'gray' },
  arquivado: { label: 'Arquivado', tone: 'gray' },
};

export const MOVEMENT_TYPES = {
  estoque_inicial: 'Estoque inicial',
  entrada_compra: 'Entrada por compra',
  entrada_producao: 'Entrada por produção',
  venda: 'Venda',
  cancelamento_venda: 'Venda cancelada',
  devolucao_cliente: 'Devolução de cliente',
  devolucao_fornecedor: 'Devolução ao fornecedor',
  ajuste: 'Ajuste',
  inventario: 'Inventário',
  perda: 'Perda / furto',
  avaria: 'Avaria',
  brinde: 'Brinde / uso interno',
  reserva: 'Reserva',
  libera_reserva: 'Reserva liberada',
};

export const RETURN_REASONS = {
  tamanho: 'Tamanho',
  defeito: 'Defeito',
  cor: 'Cor',
  arrependimento: 'Arrependimento',
  outro: 'Outro',
};

export const SUPPLIER_KINDS = {
  fabricante: 'Fabricante',
  confeccao: 'Confecção',
  estamparia: 'Estamparia',
  bordado: 'Bordado',
  atacadista: 'Atacadista',
  revenda: 'Revenda de marca',
  outro: 'Outro',
};

export const PURCHASE_STATUS = {
  rascunho: { label: 'Rascunho', tone: 'gray' },
  enviado: { label: 'Enviado', tone: 'blue' },
  parcial: { label: 'Parcial', tone: 'amber' },
  recebido: { label: 'Recebido', tone: 'green' },
  cancelado: { label: 'Cancelado', tone: 'red' },
};
