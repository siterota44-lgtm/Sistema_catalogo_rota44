/**
 * O único lugar que fala com o banco. Mantém uma cópia em memória (busca,
 * filtros e relatórios instantâneos no 4G). Tudo o que mexe em estoque ou
 * dinheiro é função do banco (RPC); a tela nunca grava saldo direto.
 *
 * Os nomes daqui são os mesmos das colunas do banco (snake_case).
 */

import { getClient } from './supabase.js';
import { APP } from '../config.js';
import { priceOf, fold } from './calc.js';
import { thumbPath, THUMB_PX, todayISO, addDays } from './utils.js';

/* ------------------------------------------------------------- estado -- */

const state = {
  who: null,
  store_settings: null,
  store_members: [],
  categories: [], brands: [], collections: [], colors: [], size_grids: [], sizes: [], size_charts: [],
  suppliers: [], customers: [],
  products: [], product_images: [], product_categories: [], product_variants: [], variant_costs: [],
  promotions: [], coupons: [],
  sales: [], sale_items: [], sale_payments: [], sale_item_costs: [],
  catalog_requests: [], stock_alerts: [],
  cash_sessions: [], cash_movements: [],
  purchases: [], purchase_items: [],
  bills: [], finance_categories: [],
  returns: [], return_items: [], store_credits: [],
  inventories: [],
};

const idx = {};              // índices por id, refeitos quando a tabela recarrega
const groups = {};           // listas por chave (variações do produto, itens da venda...)
const GROUP_BY = {
  product_variants: 'product_id', product_images: 'product_id', product_categories: 'product_id', sizes: 'grid_id',
  sale_items: 'sale_id', sale_payments: 'sale_id', purchase_items: 'purchase_id', return_items: 'return_id', cash_movements: 'session_id',
};
let salesFrom = '';          // início da janela de vendas carregada
const listeners = new Set();
let channel = null;
let realtimeUp = false;
let loadedAt = 0;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify() {
  for (const fn of listeners) {
    try { fn(); } catch (err) { console.error(err); }
  }
}

/* ------------------------------------------------------------ permissão -- */

export const who = () => state.who || {};
export const role = () => state.who?.role || '';
export const hasRole = (...roles) => roles.includes(role());
export const canCost = () => !!state.who?.can_see_cost;
export const canMargin = () => !!state.who?.can_see_margin;
const SELLERS = ['admin', 'gerente', 'vendedor'];
const MANAGERS = ['admin', 'gerente'];
const STOCK = ['admin', 'gerente', 'estoquista'];

/* ------------------------------------------------------------- leitura -- */

/* O Supabase devolve no máximo 1000 linhas por consulta: lê em páginas. */
async function readAll(build, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < pageSize) return out;
  }
}

const table = (name) => getClient().from(name);

const LOADERS = {
  store_settings: { one: true },
  store_members: { order: 'nome' },
  categories: { order: 'sort' },
  brands: { order: 'name' },
  collections: { order: 'created_at', desc: true },
  colors: { order: 'name' },
  size_grids: { order: 'sort' },
  sizes: { order: 'sort' },
  size_charts: { order: 'name' },
  suppliers: { order: 'name', roles: STOCK },
  customers: { order: 'name', roles: SELLERS, filter: (q) => q.is('deleted_at', null) },
  products: { order: 'name', filter: (q) => q.is('deleted_at', null) },
  product_images: { order: 'sort' },
  product_categories: { noId: true },
  product_variants: { order: 'sku' },
  variant_costs: { roles: STOCK, key: 'variant_id' },
  promotions: { order: 'created_at', desc: true },
  coupons: { order: 'created_at', desc: true, roles: MANAGERS },
  sales: { order: 'created_at', desc: true, roles: SELLERS, filter: (q) => q.gte('sale_date', salesFrom) },
  sale_items: { order: 'sort', roles: SELLERS, filter: (q) => q.gte('sale_date', salesFrom) },
  sale_payments: { order: 'created_at', roles: SELLERS, filter: (q) => q.gte('paid_on', salesFrom) },
  sale_item_costs: { roles: MANAGERS, key: 'sale_item_id', filter: (q) => q.gte('sale_date', salesFrom) },
  catalog_requests: { order: 'created_at', desc: true, roles: SELLERS },
  stock_alerts: { order: 'created_at', desc: true, roles: SELLERS },
  cash_sessions: { order: 'opened_at', desc: true, roles: SELLERS },
  cash_movements: { order: 'created_at', roles: SELLERS },
  purchases: { order: 'created_at', desc: true, roles: STOCK },
  purchase_items: { roles: STOCK },
  bills: { order: 'due_date', roles: ['admin'] },
  finance_categories: { order: 'name', roles: ['admin'] },
  returns: { order: 'created_at', desc: true, roles: MANAGERS },
  return_items: { roles: MANAGERS },
  store_credits: { order: 'created_at', desc: true, roles: MANAGERS },
  inventories: { order: 'created_at', desc: true, roles: STOCK },
};

async function load(name) {
  const def = LOADERS[name];
  if (def.roles && !def.roles.includes(role())) {
    state[name] = [];
    return;
  }
  if (def.one) {
    const { data, error } = await table(name).select('*').limit(1).maybeSingle();
    if (error) throw error;
    state[name] = data || {};
    return;
  }
  const rows = await readAll(() => {
    let q = table(name).select('*');
    if (def.filter) q = def.filter(q);
    if (def.order) q = q.order(def.order, { ascending: !def.desc });
    return q;
  });
  state[name] = rows;
  if (!def.noId) idx[name] = new Map(rows.map((r) => [r[def.key || 'id'], r]));
  if (GROUP_BY[name]) {
    const m = new Map();
    for (const r of rows) {
      const k = r[GROUP_BY[name]];
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    groups[name] = m;
  }
}
const groupOf = (name, key) => groups[name]?.get(key) || [];

export async function reload(...names) {
  const list = names.length ? names : Object.keys(LOADERS);
  await Promise.all(list.map(load));
  loadedAt = Date.now();
  notify();
}

export async function whoami() {
  const { data, error } = await getClient().rpc('whoami');
  if (error) throw error;
  state.who = data;
  return data;
}

export async function loadAll() {
  salesFrom = todayISO(addDays(new Date(), -366));
  await reload();
  startRealtime();
  // reserva vencida não espera ninguém: solta ao abrir o sistema
  if (hasRole(...SELLERS)) {
    getClient().rpc('release_expired_reservations').then(({ data }) => {
      if (data > 0) reload('sales', 'product_variants');
    });
  }
}

export function reset() {
  stopRealtime();
  state.who = null;
  for (const k of Object.keys(LOADERS)) state[k] = LOADERS[k].one ? null : [];
  loadedAt = 0;
}

/** Relatório pediu um período antes da janela de 12 meses: amplia. */
export async function ensureSalesFrom(iso) {
  if (!iso || iso >= salesFrom) return;
  salesFrom = iso;
  await reload('sales', 'sale_items', 'sale_payments', 'sale_item_costs');
}
export const loadedFrom = () => salesFrom;
export const msSinceLoad = () => (loadedAt ? Date.now() - loadedAt : Infinity);
export const isRealtimeUp = () => realtimeUp;
export function refreshIfStale(maxAge = 120000) {
  if (state.who && msSinceLoad() > maxAge && navigator.onLine !== false) reload().catch(() => {});
}

/* -------------------------------------------------------- tempo real ---- */

const WATCH = {
  products: ['products', 'product_images', 'product_categories', 'product_variants'],
  product_variants: ['product_variants'],
  sales: ['sales', 'sale_items', 'sale_payments', 'sale_item_costs'],
  sale_payments: ['sale_payments', 'sales'],
  catalog_requests: ['catalog_requests'],
  stock_alerts: ['stock_alerts'],
  store_settings: ['store_settings'],
  cash_sessions: ['cash_sessions'],
  customers: ['customers'],
  categories: ['categories'],
};
const requestListeners = new Set();
export function onNewCatalogRequest(fn) {
  requestListeners.add(fn);
  return () => requestListeners.delete(fn);
}

function startRealtime() {
  if (channel) return;
  const pending = new Set();
  let timer = null;
  const flush = () => {
    timer = null;
    const names = [...pending];
    pending.clear();
    reload(...names).catch(() => {});
  };
  channel = getClient().channel('rota44');
  for (const t of Object.keys(WATCH)) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: t }, (ev) => {
      WATCH[t].forEach((n) => pending.add(n));
      if (t === 'catalog_requests' && ev.eventType === 'INSERT') requestListeners.forEach((fn) => fn(ev.new));
      if (!timer) timer = setTimeout(flush, 900);
    });
  }
  channel.subscribe((status) => { realtimeUp = status === 'SUBSCRIBED'; });
}
function stopRealtime() {
  if (channel) { getClient().removeChannel(channel); channel = null; }
  realtimeUp = false;
}

/* ---------------------------------------------------- acesso à cópia --- */

const byId = (name, id) => idx[name]?.get(id) || null;
export const settings = () => state.store_settings || {};
export const members = () => state.store_members;
export const member = (id) => (state.store_members.find((m) => m.user_id === id) || null);
export const memberName = (id) => member(id)?.nome || '-';

export const categories = () => state.categories;
export const category = (id) => byId('categories', id);
export const brands = () => state.brands;
export const brand = (id) => byId('brands', id);
export const collections = () => state.collections;
export const collection = (id) => byId('collections', id);
export const colors = () => state.colors;
export const color = (id) => byId('colors', id);
export const grids = () => state.size_grids;
export const grid = (id) => byId('size_grids', id);
export const sizes = () => state.sizes;
export const size = (id) => byId('sizes', id);
export const sizesOf = (gridId) => groupOf('sizes', gridId);
export const sizeCharts = () => state.size_charts;
export const suppliers = () => state.suppliers;
export const supplier = (id) => byId('suppliers', id);
export const customers = () => state.customers;
export const customer = (id) => byId('customers', id);
export const products = () => state.products;
export const product = (id) => byId('products', id);
export const productImages = (pid) => groupOf('product_images', pid);
export const productCategories = (pid) => groupOf('product_categories', pid).map((c) => c.category_id);
export const variants = () => state.product_variants;
export const variant = (id) => byId('product_variants', id);
export const variantsOf = (pid) => groupOf('product_variants', pid);
export const cost = (variantId) => byId('variant_costs', variantId);
export const promotions = () => state.promotions;
export const coupons = () => state.coupons;
export const sales = () => state.sales;
export const sale = (id) => byId('sales', id);
export const allSaleItems = () => state.sale_items;
export const allSalePayments = () => state.sale_payments;
export const saleItems = (id) => groupOf('sale_items', id);
export const salePayments = (id) => groupOf('sale_payments', id);
export const saleItemCost = (itemId) => Number(byId('sale_item_costs', itemId)?.unit_cost || 0);
export const catalogRequests = () => state.catalog_requests;
export const stockAlerts = () => state.stock_alerts;
export const cashSessions = () => state.cash_sessions;
export const cashMovements = (sid) => groupOf('cash_movements', sid);
export const myOpenCash = () => state.cash_sessions.find((c) => !c.closed_at && c.opened_by === state.who?.user_id) || null;
export const purchases = () => state.purchases;
export const purchase = (id) => byId('purchases', id);
export const purchaseItems = (id) => groupOf('purchase_items', id);
export const bills = () => state.bills;
export const financeCategories = () => state.finance_categories;
export const financeCategory = (id) => byId('finance_categories', id);
export const returns = () => state.returns;
export const returnItems = (id) => groupOf('return_items', id);
export const allReturnItems = () => state.return_items;
export const storeCredits = () => state.store_credits;
export const inventories = () => state.inventories;

/* ---------------------------------------------------------- cálculos --- */

export const priceFor = (v) => priceOf(v, product(v.product_id), state.promotions, state.categories);
export const variantLabel = (v) => `${color(v.color_id)?.name || '-'} · ${size(v.size_id)?.label || '-'}`;
export const variantTitle = (v) => `${product(v.product_id)?.name || '-'} · ${variantLabel(v)}`;
export const coverOf = (p) => p?.cover_url || productImages(p?.id)[0]?.url || '';

/** Foto da variação: a da cor dela, se houver; senão a capa. */
export function photoOf(v) {
  const p = product(v.product_id);
  const imgs = productImages(v.product_id);
  return imgs.find((i) => i.color_id === v.color_id)?.url || coverOf(p);
}

/** Categoria + descendentes (árvore), para filtrar. */
export function categoryTree(rootId) {
  const out = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of state.categories) {
      if (c.parent_id && out.has(c.parent_id) && !out.has(c.id)) { out.add(c.id); grew = true; }
    }
  }
  return out;
}
/** Categorias em ordem de árvore, com a profundidade. */
export function categoryList() {
  const out = [];
  const walk = (parent, depth) => {
    state.categories.filter((c) => (c.parent_id || null) === parent).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
      .forEach((c) => { out.push({ ...c, depth }); walk(c.id, depth + 1); });
  };
  walk(null, 0);
  return out;
}
export function categoryPath(id) {
  const parts = [];
  let c = category(id);
  while (c) { parts.unshift(c.name); c = c.parent_id ? category(c.parent_id) : null; }
  return parts.join(' › ');
}

export function productStock(pid) {
  return variantsOf(pid).filter((v) => v.active).reduce((s, v) => s + v.available, 0);
}
export function priceRange(pid) {
  const list = variantsOf(pid).filter((v) => v.active).map((v) => priceFor(v).price);
  if (!list.length) return { min: Number(product(pid)?.base_price || 0), max: Number(product(pid)?.base_price || 0) };
  return { min: Math.min(...list), max: Math.max(...list) };
}
/** ok | baixo | zerado */
export function level(v) {
  if (v.available <= 0) return 'zerado';
  if (v.available <= v.stock_min) return 'baixo';
  return 'ok';
}
export function lowStock() {
  return state.product_variants.filter((v) => {
    if (!v.active) return false;
    const p = product(v.product_id);
    return p && p.status === 'ativo' && v.available <= v.stock_min;
  });
}
export function stockValue() {
  let cost_ = 0; let sale_ = 0; let units = 0;
  for (const v of state.product_variants) {
    if (!v.active || v.on_hand <= 0) continue;
    units += v.on_hand;
    cost_ += v.on_hand * Number(cost(v.id)?.avg_cost || 0);
    sale_ += v.on_hand * priceFor(v).price;
  }
  return { cost: cost_, sale: sale_, units };
}
export function findByCode(code) {
  const c = String(code || '').trim().toLowerCase();
  if (!c) return null;
  return state.product_variants.find((v) => v.active && (v.barcode === c || v.sku.toLowerCase() === c)) || null;
}

/** Busca de produto: nome, marca, SKU, código de barras. */
export function searchProducts(q) {
  const s = fold(q);
  if (!s) return state.products;
  const words = s.split(/\s+/);
  return state.products.filter((p) => {
    const hay = fold(`${p.name} ${brand(p.brand_id)?.name || ''} ${category(p.category_id)?.name || ''} ${(p.tags || []).join(' ')} `
      + variantsOf(p.id).map((v) => `${v.sku} ${v.barcode}`).join(' '));
    return words.every((w) => hay.includes(w));
  });
}

/** Vendas de cada produto nos últimos N dias (mais vendidos primeiro no PDV). */
export function salesRank(days = 60) {
  const from = todayISO(addDays(new Date(), -days));
  const rank = new Map();
  const canceled = new Set(state.sales.filter((s) => s.status === 'cancelado').map((s) => s.id));
  for (const i of state.sale_items) {
    if (i.sale_date >= from && !canceled.has(i.sale_id)) rank.set(i.product_id, (rank.get(i.product_id) || 0) + i.qty);
  }
  return rank;
}

export function customerStats() {
  const stats = new Map();
  for (const s of state.sales) {
    if (s.status === 'cancelado' || !s.customer_id) continue;
    const c = stats.get(s.customer_id) || { total: 0, count: 0, last: '' };
    c.total += Number(s.total) - Number(s.returned_total);
    c.count += 1;
    if (s.sale_date > c.last) c.last = s.sale_date;
    stats.set(s.customer_id, c);
  }
  return stats;
}

/* -------------------------------------------------- escrita: cadastros -- */

async function rpc(fn, args) {
  const { data, error } = await getClient().rpc(fn, args);
  if (error) throw error;
  return data;
}

/** Cadastro simples (marca, cor, fornecedor...): grava e recarrega a tabela. */
export async function saveRow(name, row, keyCol = 'id') {
  const clean = { ...row };
  let res;
  if (clean[keyCol]) {
    const id = clean[keyCol];
    delete clean[keyCol];
    res = await table(name).update(clean).eq(keyCol, id).select().single();
  } else {
    delete clean[keyCol];
    res = await table(name).insert(clean).select().single();
  }
  if (res.error) throw res.error;
  await reload(name);
  return res.data;
}
export async function deleteRow(name, id, keyCol = 'id') {
  const { error } = await table(name).delete().eq(keyCol, id);
  if (error) throw error;
  await reload(name);
}

export async function saveSettings(patch) {
  const { error } = await table('store_settings').update(patch).eq('id', 1);
  if (error) throw error;
  await reload('store_settings');
}

/** Grade: nome + lista de tamanhos, na ordem. Tamanho em uso não some. */
export async function saveGrid({ id, name, labels }) {
  const g = await saveRow('size_grids', { id, name });
  const existing = sizesOf(g.id);
  for (let i = 0; i < labels.length; i++) {
    const found = existing.find((s) => s.label === labels[i]);
    if (found) {
      if (found.sort !== i + 1) {
        const { error } = await table('sizes').update({ sort: i + 1 }).eq('id', found.id);
        if (error) throw error;
      }
    } else {
      const { error } = await table('sizes').insert({ grid_id: g.id, label: labels[i], sort: i + 1 });
      if (error) throw error;
    }
  }
  for (const s of existing) {
    if (!labels.includes(s.label) && !state.product_variants.some((v) => v.size_id === s.id)) {
      const { error } = await table('sizes').delete().eq('id', s.id);
      if (error) throw error;
    }
  }
  await reload('sizes');
  return g;
}

export async function saveProduct(p) {
  const r = await rpc('save_product', { p });
  await reload('products', 'product_images', 'product_categories', 'product_variants', 'variant_costs');
  return r;
}
export async function deleteProduct(id) {
  await rpc('delete_product', { p_id: id });
  await reload('products', 'product_variants');
}
export async function patchProduct(id, fields) {
  const { error } = await table('products').update(fields).eq('id', id);
  if (error) throw error;
  await reload('products');
}
export async function setPrices(items) {
  await rpc('set_prices', { p: { items } });
  await reload('products');
}
export async function patchVariant(id, fields) {
  const { error } = await table('product_variants').update(fields).eq('id', id);
  if (error) throw error;
  await reload('product_variants');
}

/* ------------------------------------------------------------- estoque -- */

export async function adjustStock(p) {
  const r = await rpc('adjust_stock', { p });
  await reload('product_variants');
  return r;
}
export async function movements(variantId, limit = 120) {
  const { data, error } = await table('stock_movements').select('*').eq('variant_id', variantId).order('id', { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}
export async function priceHistory(productId, limit = 40) {
  const { data, error } = await table('price_history').select('*').eq('product_id', productId).order('changed_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}
export async function inventoryItems(id) {
  return readAll(() => table('inventory_items').select('*').eq('inventory_id', id));
}
export async function startInventory(p) { const r = await rpc('start_inventory', { p }); await reload('inventories'); return r; }
export async function saveInventoryCounts(inventory_id, counts) { return rpc('save_inventory_counts', { p: { inventory_id, counts } }); }
export async function applyInventory(inventory_id, reason) {
  const r = await rpc('apply_inventory', { p: { inventory_id, reason } });
  await reload('inventories', 'product_variants');
  return r;
}
export async function cancelInventory(id) {
  await rpc('cancel_inventory', { p_id: id });
  await reload('inventories');
}

/* -------------------------------------------------------------- vendas -- */

const SALE_TABLES = ['sales', 'sale_items', 'sale_payments', 'sale_item_costs', 'product_variants'];

export async function saveSale(p) {
  const r = await rpc('save_sale', { p });
  await reload(...SALE_TABLES, 'catalog_requests', 'bills', 'store_credits', 'coupons');
  return r;
}
export async function setSaleStatus(p) {
  const r = await rpc('set_sale_status', { p });
  await reload('sales', 'product_variants');
  return r;
}
export async function addPayment(p) {
  const r = await rpc('add_payment', { p });
  await reload('sales', 'sale_payments', 'product_variants', 'store_credits');
  return r;
}
export async function reversePayment(p) {
  await rpc('reverse_payment', { p });
  await reload('sales', 'sale_payments', 'store_credits');
}
export async function cancelSale(p) {
  await rpc('cancel_sale', { p });
  await reload(...SALE_TABLES, 'bills', 'store_credits');
}
export async function saleHistory(id) {
  const { data, error } = await table('sale_status_history').select('*').eq('sale_id', id).order('id');
  if (error) throw error;
  return data;
}
export const checkCoupon = (code, base, customerId) => rpc('check_coupon', { p_code: code, p_base: base, p_customer: customerId || null });
export const findCredit = (code) => rpc('find_credit', { p_code: code });
export const checkManagerPin = (pin, pct) => rpc('check_manager_pin', { p_pin: pin, p_pct: pct });
export async function setMyPin(pin) { await rpc('set_my_pin', { p_pin: pin }); await whoami(); }

export async function createReturn(p) {
  const r = await rpc('create_return', { p });
  await reload(...SALE_TABLES, 'returns', 'return_items', 'store_credits');
  return r;
}

export async function setRequest(id, fields) {
  const { error } = await table('catalog_requests').update(fields).eq('id', id);
  if (error) throw error;
  await reload('catalog_requests');
}
export async function markAlert(id) {
  const { error } = await table('stock_alerts').update({ notified_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
  await reload('stock_alerts');
}

/* --------------------------------------------------------------- caixa -- */

export async function openCash(p) { const r = await rpc('open_cash', { p }); await reload('cash_sessions'); return r; }
export async function cashMove(p) { await rpc('cash_move', { p }); await reload('cash_movements'); }
export const cashSummary = (id) => rpc('cash_summary', { p_session: id });
export async function closeCash(p) { const r = await rpc('close_cash', { p }); await reload('cash_sessions'); return r; }

/* -------------------------------------------------------------- compras -- */

export async function savePurchase(p) { const r = await rpc('save_purchase', { p }); await reload('purchases', 'purchase_items'); return r; }
export async function receivePurchase(p) {
  const r = await rpc('receive_purchase', { p });
  await reload('purchases', 'purchase_items', 'product_variants', 'variant_costs', 'bills');
  return r;
}
export async function cancelPurchase(id) { await rpc('cancel_purchase', { p_id: id }); await reload('purchases'); }

/* ----------------------------------------------------------- financeiro -- */

export async function payBill(p) {
  await rpc('pay_bill', { p });
  await reload('bills', 'sales', 'sale_payments');
}

/* --------------------------------------------------------------- equipe -- */

export const membersList = () => rpc('members_list');
export async function memberUpsert(p) { const r = await rpc('member_upsert', { p }); await reload('store_members'); return r; }

/* ---------------------------------------------------- auditoria e erros -- */

export async function auditLog(limit = 120) {
  const { data, error } = await table('audit_log').select('*').order('at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}
export async function sendErrors(rows) {
  const { error } = await table('client_errors').insert(rows);
  if (error) throw error;
}
export async function listErrors(limit = 30) {
  const { data, error } = await table('client_errors').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}
export async function clearErrors() {
  const { error } = await table('client_errors').delete().gte('id', 0);
  if (error) throw error;
}

/** Cópia em JSON de tudo o que este login enxerga (Ajustes → Backup). */
export function backupSnapshot() {
  const out = { version: APP.version, generated_at: new Date().toISOString() };
  for (const k of Object.keys(LOADERS)) out[k] = state[k];
  return out;
}

/* ---------------------------------------------------------------- fotos -- */

const PHOTO_PX = 1600;

async function decode(file) {
  try { return await createImageBitmap(file); } catch {
    const url = URL.createObjectURL(file);
    try {
      return await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error('Não consegui abrir essa imagem.'));
        i.src = url;
      });
    } finally { setTimeout(() => URL.revokeObjectURL(url), 2000); }
  }
}

function canvasBlob(canvas, type, q) {
  return new Promise((res) => canvas.toBlob(res, type, q));
}

/** Reduz a foto no aparelho: o plano grátis tem 1 GB e o cliente, 4G. */
async function compress(img, max, maxBytes) {
  const w = img.width || img.naturalWidth;
  const h = img.height || img.naturalHeight;
  const scale = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  for (const q of [0.86, 0.76, 0.64, 0.5]) {
    // o Safari não gera WebP: devolve PNG. Aí vai JPEG. Extensão segue o que saiu.
    let blob = await canvasBlob(c, 'image/webp', q);
    if (!blob || blob.type !== 'image/webp') blob = await canvasBlob(c, 'image/jpeg', q);
    if (blob.size <= maxBytes) return blob;
  }
  return canvasBlob(c, 'image/jpeg', 0.42);
}

export async function uploadImage(file) {
  const img = await decode(file);
  const blob = await compress(img, PHOTO_PX, 950000);
  const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `p/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const bucket = getClient().storage.from(APP.photoBucket);
  const { error } = await bucket.upload(path, blob, { contentType: blob.type, cacheControl: '31536000', upsert: false });
  if (error) throw error;
  // Miniatura para listas e para a grade do catálogo. Falhar não quebra nada: a tela cai na foto grande.
  try {
    const small = await compress(img, THUMB_PX, 300000);
    await bucket.upload(thumbPath(path), small, { contentType: small.type, cacheControl: '31536000', upsert: true });
  } catch (err) {
    console.warn('miniatura não foi gerada', err);
  }
  return bucket.getPublicUrl(path).data.publicUrl;
}
