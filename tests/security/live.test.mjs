// Ataque SEM LOGIN contra o banco real, com a chave pública que está no site.
// Não grava nada: só tenta, e tudo tem de sair "recusado".
// Rodar depois do schema.sql e a cada mudança de banco:
//   cd tests && npm run test:security
//   cd tests && SITE_URL=https://rota44.netlify.app npm run test:security   (confere também o site publicado)

const URL_ = 'https://jjynilzpcekissqkbigj.supabase.co';
const KEY = 'sb_publishable_VuIb8VQW_25fDUxTk1O81Q_40Cl9ES0';
const H = { apikey: KEY, 'Content-Type': 'application/json' };
const SITE = process.env.SITE_URL;

let fails = 0;
const ok = (cond, msg, extra = '') => { if (!cond) fails += 1; console.log(cond ? '  ✓' : '  ✗', msg, cond ? '' : extra); };

const TABLES = ['store_members', 'member_secrets', 'store_settings', 'categories', 'brands', 'collections', 'colors', 'size_grids', 'sizes', 'size_charts',
  'suppliers', 'customers', 'products', 'product_categories', 'product_images', 'product_variants', 'variant_costs', 'stock_movements', 'price_history',
  'promotions', 'coupons', 'store_credits', 'cash_sessions', 'cash_movements', 'catalog_requests', 'sales', 'sale_items', 'sale_item_costs', 'sale_payments',
  'sale_status_history', 'coupon_uses', 'discount_approvals', 'returns', 'return_items', 'stock_alerts', 'purchases', 'purchase_items', 'finance_categories',
  'bills', 'inventories', 'inventory_items', 'audit_log', 'client_errors', 'public_throttle'];
const RPCS = ['whoami', 'save_sale', 'save_product', 'delete_product', 'adjust_stock', 'cancel_sale', 'set_sale_status', 'add_payment', 'create_return', 'open_cash', 'close_cash',
  'save_purchase', 'receive_purchase', 'pay_bill', 'start_inventory', 'apply_inventory', 'member_upsert', 'members_list', 'bootstrap_admin', 'set_prices', 'check_manager_pin', 'set_my_pin', 'find_credit'];

console.log('\nLer tabelas sem login');
for (const t of TABLES) {
  const r = await fetch(`${URL_}/rest/v1/${t}?select=*&limit=1`, { headers: H });
  const body = await r.text();
  ok(r.status >= 400 || body === '[]', `${t}: ${r.status}`, body.slice(0, 120));
}

console.log('\nGravar sem login');
for (const [t, row] of [['products', { name: 'x', slug: 'x' }], ['customers', { name: 'x' }], ['sales', { sale_date: '2026-01-01' }], ['store_members', { nome: 'x' }]]) {
  const r = await fetch(`${URL_}/rest/v1/${t}`, { method: 'POST', headers: H, body: JSON.stringify(row) });
  ok(r.status >= 400, `insert em ${t}: ${r.status}`);
}
const up = await fetch(`${URL_}/rest/v1/product_variants?id=neq.00000000-0000-0000-0000-000000000000`, { method: 'PATCH', headers: H, body: JSON.stringify({ on_hand: 999 }) });
ok(up.status >= 400, `alterar estoque: ${up.status}`);

console.log('\nChamar funções internas sem login');
for (const f of RPCS) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${f}`, { method: 'POST', headers: H, body: JSON.stringify(f === 'whoami' || f === 'members_list' ? {} : { p: {} }) });
  ok(r.status >= 400, `${f}: ${r.status}`);
}

console.log('\nCatálogo público: só o que pode sair');
const cat = await fetch(`${URL_}/rest/v1/rpc/public_catalog`, { method: 'POST', headers: H, body: '{}' });
ok(cat.ok, `public_catalog responde: ${cat.status}`);
const text = await cat.text();
ok(!/avg_cost|last_cost|unit_cost|on_hand|"reserved"|"barcode"|"sku"|cpf|customer/i.test(text), 'sem custo, saldo, código interno nem cliente');

console.log('\nLogin');
const s = await (await fetch(`${URL_}/auth/v1/settings`, { headers: H })).json();
ok(s.disable_signup === true, 'cadastro público desligado', '(Supabase → Authentication → Sign In / Providers → Email → desligue "Allow new users to sign up")');
ok(s.external?.anonymous_users === false, 'login anônimo desligado');
const bad = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: H, body: JSON.stringify({ email: 'nao-existe@rota44.test', password: 'errada-1234' }) });
ok(bad.status === 400, `senha errada recusada: ${bad.status}`);

if (SITE) {
  console.log(`\nSite publicado: ${SITE}`);
  const home = await fetch(SITE);
  const h = home.headers;
  ok(home.ok, `catálogo abre: ${home.status}`);
  ok(/frame-ancestors 'none'/.test(h.get('content-security-policy') || ''), 'CSP com frame-ancestors');
  ok(/max-age=/.test(h.get('strict-transport-security') || ''), 'HSTS');
  ok(h.get('x-content-type-options') === 'nosniff', 'nosniff');
  ok(/camera=\(self\)/.test(h.get('permissions-policy') || ''), 'câmera só para o próprio site');
  const sys = await fetch(`${SITE}/sistema`);
  ok(sys.ok && /noindex/.test(sys.headers.get('x-robots-tag') || ''), 'sistema abre e fica fora do Google');
  for (const p of ['supabase/schema.sql', 'tests/package.json', 'README.md', 'netlify/build.mjs', '.github/workflows/backup.yml', 'rota44-sistema-gestao-catalogo.md']) {
    const r = await fetch(`${SITE}/${p}`);
    ok(r.status === 404, `arquivo interno não publicado: ${p} (${r.status})`);
  }
  const js = await (await fetch(`${SITE}/assets/js/config.js`)).text();
  ok(!/sb_secret_[A-Za-z0-9]{8,}|eyJ[A-Za-z0-9_-]{20,}.[A-Za-z0-9_-]{20,}/.test(js), 'nenhuma chave secreta no site');
}

console.log(`\n${fails ? `${fails} FALHA(S)` : 'Tudo certo.'}`);
process.exit(fails ? 1 : 0);
