// Testa supabase/schema.sql + seeds num Postgres real (PGlite), imitando o
// Supabase: papéis anon/authenticated, auth.users, auth.uid() lendo o "sub" do
// JWT e os privilégios padrão do "Automatically expose new tables" ligado (pior
// caso: tudo liberado até o schema revogar). Rodar: cd tests && npm run test:db
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../supabase/', import.meta.url));
const db = new PGlite();
let fails = 0; let passes = 0;
const ok = (cond, msg) => { if (cond) { passes++; console.log('  ✓', msg); } else { fails++; console.log('  ✗', msg); } };
const section = (t) => console.log(`\n${t}`);

const as = async (role, uid) => {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
  if (role) await db.exec(`set role ${role}`);
};
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const all = async (sql, params) => (await db.query(sql, params)).rows;
const rpc = async (fn, arg) => Object.values(await one(`select public.${fn}($1::jsonb) as r`, [JSON.stringify(arg)]))[0];
const n = (v) => Number(v);
const expectError = async (fn, re, msg) => {
  try { await fn(); ok(false, `${msg} (não deu erro)`); }
  catch (e) { ok(re.test(e.message), `${msg} → "${e.message.split('\n')[0]}"`); }
};
process.on('unhandledRejection', (e) => {
  console.error('\nERRO:', e?.message, e?.where ? `\n  em: ${e.where.split('\n')[0]}` : '', e?.position ? `\n  posição: ${e.position}` : '');
  process.exit(1);
});

await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  create publication supabase_realtime;
`);

const schema = fs.readFileSync(`${ROOT}schema.sql`, 'utf8');
const seed = fs.readFileSync(`${ROOT}seed_base.sql`, 'utf8');
const demo = fs.readFileSync(`${ROOT}seed_demo.sql`, 'utf8');

section('Instalação');
await db.exec(schema); ok(true, 'schema.sql roda');
await db.exec(schema); ok(true, 'schema.sql roda de novo (idempotente)');
await db.exec(seed); await db.exec(seed); ok(true, 'seed_base.sql roda duas vezes');
await db.exec(demo); await db.exec(demo);
ok((await one(`select count(*)::int c from public.products`)).c === 3, 'seed_demo.sql cria 3 produtos e não duplica');
ok((await one(`select count(*)::int c from public.categories`)).c > 40, 'árvore de categorias criada');

const uid = async (email) => (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
const adminId = await uid('admin@rota44.test');
const gerenteId = await uid('gerente@rota44.test');
const vendedorId = await uid('vendedor@rota44.test');
const estoqueId = await uid('estoque@rota44.test');
const intrusoId = await uid('intruso@rota44.test');
await db.query(`select public.bootstrap_admin('admin@rota44.test', 'Dono')`);
ok((await one(`select role from public.store_members where user_id = $1`, [adminId])).role === 'admin', 'bootstrap_admin cria o dono');
ok((await one(`select email_confirmed_at from auth.users where id = $1`, [adminId])).email_confirmed_at, 'e confirma o e-mail da conta');

section('Equipe');
await as('authenticated', adminId);
await rpc('member_upsert', { email: 'gerente@rota44.test', nome: 'Gê', role: 'gerente', commission_pct: 2 });
await rpc('member_upsert', { email: 'vendedor@rota44.test', nome: 'Vê', role: 'vendedor', commission_pct: 5 });
await rpc('member_upsert', { email: 'estoque@rota44.test', nome: 'Stock', role: 'estoquista' });
ok((await all(`select jsonb_array_elements(public.members_list()) x`)).length === 4, 'admin coloca e lista a equipe');
await expectError(() => rpc('member_upsert', { user_id: adminId, nome: 'Dono', role: 'vendedor' }), /ao menos um administrador/, 'loja nunca fica sem admin');
await expectError(() => rpc('member_upsert', { email: 'naoexiste@x.com', nome: 'X' }), /não encontrei/i, 'e-mail sem login é recusado');
await as('authenticated', vendedorId);
await expectError(() => rpc('member_upsert', { email: 'intruso@rota44.test', nome: 'I', role: 'admin' }), /não tem permissão/, 'vendedor não mexe na equipe');
let who = await one(`select public.whoami() w`);
ok(who.w.role === 'vendedor' && who.w.can_see_cost === false && who.w.schema_version === 2, 'whoami do vendedor: sem custo');

section('Anônimo: portas fechadas');
await as('anon', null);
const tables = (await (async () => { await as(null); const t = await all(`select tablename from pg_tables where schemaname='public'`); await as('anon', null); return t; })()).map((x) => x.tablename);
let leaked = [];
for (const t of tables) { try { await db.query(`select * from public.${t} limit 1`); leaked.push(t); } catch { /* negado */ } }
ok(leaked.length === 0, `anônimo não lê nenhuma das ${tables.length} tabelas ${leaked.join(',')}`);
await expectError(() => db.query(`update public.product_variants set on_hand = 999`), /permission denied/, 'anônimo não altera estoque');
await as(null);
const open = (await all(`
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`)).map((r) => r.proname).sort();
ok(JSON.stringify(open) === JSON.stringify(['catalog_request', 'keepalive', 'log_client_error', 'notify_me', 'public_catalog', 'public_coupon']),
  `só 6 funções abertas ao mundo: ${open.join(', ')}`);

section('Login sem autorização: não vê nada');
await as('authenticated', intrusoId);
ok((await all(`select * from public.products`)).length === 0, 'intruso lê produtos: vazio');
ok((await all(`select * from public.customers`)).length === 0, 'intruso lê clientes: vazio');
await expectError(() => rpc('save_sale', { items: [] }), /Acesso negado/, 'intruso não vende');

section('Produto com grade');
await as('authenticated', gerenteId);
const preto = (await one(`select id from public.colors where name='Preto'`)).id;
const branco = (await one(`select id from public.colors where name='Branco'`)).id;
const sizes = await all(`select s.id, s.label from public.sizes s join public.size_grids g on g.id=s.grid_id where g.name='Letra adulto' and s.label in ('P','M','G') order by s.sort`);
const catCam = (await one(`select id from public.categories where slug='camisetas-oversized'`)).id;
const grid = (await one(`select id from public.size_grids where name='Letra adulto'`)).id;
const variants = [];
for (const c of [preto, branco]) for (const s of sizes) variants.push({ color_id: c, size_id: s.id, initial_stock: 5, cost: 40 });
const prod = await rpc('save_product', {
  name: 'Camiseta Oversized Rota', category_id: catCam, grid_id: grid, fit: 'Oversized', base_price: 100, gsm: 240,
  images: [{ url: 'https://x.test/a.webp', color_id: preto }, { url: 'https://x.test/b.webp', color_id: branco }], variants,
});
ok(prod.slug === 'camiseta-oversized-rota', 'slug gerado');
const vs = await all(`select * from public.product_variants where product_id=$1 order by sku`, [prod.id]);
ok(vs.length === 6, 'grade gerou 6 variações');
ok(/^R44-CAM-OVS-\d{3}-PRT-[PMG]$|^R44-CAM-OVS-\d{3}-BRC-[PMG]$/.test(vs[0].sku), `SKU no padrão: ${vs[0].sku}`);
ok(vs[0].barcode.length === 13 && vs[0].barcode.startsWith('244'), `código de barras interno: ${vs[0].barcode}`);
ok(vs.every((v) => v.on_hand === 5), 'estoque inicial entrou');
ok((await all(`select * from public.stock_movements where variant_id=$1`, [vs[0].id])).length === 1, 'estoque inicial gerou movimento');
ok(n((await one(`select avg_cost from public.variant_costs where variant_id=$1`, [vs[0].id])).avg_cost) === 40, 'custo gravado');
const prod2 = await rpc('save_product', { name: 'Camiseta Oversized Rota', base_price: 80, variants: [] });
ok(prod2.slug === 'camiseta-oversized-rota-2', 'nome igual: slug único');
await expectError(() => db.query(`update public.product_variants set on_hand = 999 where id=$1`, [vs[0].id]), /permission denied/, 'gerente não edita saldo direto');
const P = vs.find((v) => v.sku.endsWith('PRT-P')); const M = vs.find((v) => v.sku.endsWith('PRT-M')); const G = vs.find((v) => v.sku.endsWith('PRT-G'));

await as('authenticated', vendedorId);
await expectError(() => rpc('save_product', { name: 'x' }), /não tem permissão/, 'vendedor não cadastra produto');
ok((await all(`select * from public.products`)).length >= 4, 'vendedor consulta produtos');
ok((await all(`select * from public.variant_costs`)).length === 0, 'vendedor NÃO lê custo pela API');
ok((await all(`select * from public.stock_movements`)).length === 0, 'vendedor NÃO lê movimentos (têm custo)');
await as('authenticated', estoqueId);
ok((await all(`select * from public.variant_costs`)).length > 0, 'estoquista lê custo (precisa nas entradas)');
ok((await all(`select * from public.customers`)).length === 0, 'estoquista não lê clientes (LGPD)');

section('Venda no balcão');
await as('authenticated', vendedorId);
await expectError(() => rpc('save_sale', { sale_date: '2026-11-04', items: [{ variant_id: P.id, qty: 1 }], payments: [{ method: 'dinheiro', amount: 100 }] }),
  /Abra o caixa/, 'dinheiro sem caixa aberto é recusado');
const caixa = await rpc('open_cash', { opening_amount: 50 });
await expectError(() => rpc('open_cash', {}), /já tem um caixa/, 'um caixa aberto por operador');
const ref = '11111111-1111-4111-8111-111111111111';
const venda = await rpc('save_sale', { client_ref: ref, sale_date: '2026-11-04', items: [{ variant_id: P.id, qty: 2, discount_value: 10 }], payments: [{ method: 'dinheiro', amount: 190, tendered: 200, change_given: 10 }] });
ok(n(venda.total) === 190, 'preço vem do banco: 2 × 100 − 10 = 190');
const dup = await rpc('save_sale', { client_ref: ref, sale_date: '2026-11-04', items: [{ variant_id: P.id, qty: 2 }], payments: [] });
ok(dup.duplicate === true && dup.id === venda.id, 'reenvio com o mesmo client_ref não duplica');
ok((await one(`select on_hand from public.product_variants where id=$1`, [P.id])).on_hand === 3, 'baixou 2 do estoque, uma vez só');
const sale1 = await one(`select * from public.sales where id=$1`, [venda.id]);
ok(n(sale1.paid_total) === 190 && n(sale1.balance) === 0 && sale1.status === 'entregue', 'paga e entregue, saldo zero');
ok(sale1.seller_id === vendedorId, 'vendedor registrado');
ok((await all(`select * from public.sale_item_costs`)).length === 0, 'vendedor não lê custo da venda');
await as('authenticated', gerenteId);
const c1 = await one(`select c.unit_cost from public.sale_item_costs c join public.sale_items i on i.id=c.sale_item_id where i.sale_id=$1`, [venda.id]);
ok(n(c1.unit_cost) === 40, 'gerente vê o custo do momento na venda');
await as('authenticated', vendedorId);

await expectError(() => rpc('save_sale', { sale_date: '2026-11-04', items: [{ variant_id: P.id, qty: 99 }], payments: [] }), /Estoque insuficiente/, 'não vende mais do que tem');
await expectError(() => rpc('save_sale', { sale_date: '2026-11-04', items: [{ variant_id: M.id, qty: 1 }], payments: [] }), /Falta receber/, 'não fecha venda sem receber');
ok((await one(`select on_hand from public.product_variants where id=$1`, [M.id])).on_hand === 5, 'erro desfaz tudo (transação)');
await expectError(() => rpc('save_sale', { sale_date: '2026-11-04', items: [{ variant_id: M.id, qty: 1 }], payments: [{ method: 'pix', amount: 500 }] }), /passam do total/, 'pagamento maior que o total é recusado');

section('Limite de desconto e senha do gerente');
await expectError(() => rpc('save_sale', { sale_date: '2026-11-04', items: [{ variant_id: M.id, qty: 1, discount_value: 20 }], payments: [{ method: 'pix', amount: 80 }] }),
  /DESCONTO_ACIMA/, 'vendedor com 20% (limite 10%) é barrado');
await as('authenticated', gerenteId);
await db.query(`select public.set_my_pin('4444')`);
await as('authenticated', vendedorId);
let appr = (await one(`select public.check_manager_pin('0000', 20) r`)).r;
ok(appr.ok === false, 'senha errada não libera');
appr = (await one(`select public.check_manager_pin('4444', 20) r`)).r;
ok(appr.ok === true && appr.manager === 'Gê', 'senha do gerente libera');
const vd = await rpc('save_sale', { sale_date: '2026-11-04', approval_id: appr.approval_id, items: [{ variant_id: M.id, qty: 1, discount_value: 20 }], payments: [{ method: 'pix', amount: 80 }] });
ok(n(vd.total) === 80, 'venda com desconto liberado');
await as(null);
ok((await one(`select approved_by from public.sales where id=$1`, [vd.id])).approved_by === gerenteId, 'quem liberou fica registrado');
await as('authenticated', vendedorId);
await expectError(() => rpc('save_sale', { sale_date: '2026-11-04', approval_id: appr.approval_id, items: [{ variant_id: M.id, qty: 1, discount_value: 20 }], payments: [{ method: 'pix', amount: 80 }] }),
  /DESCONTO_ACIMA/, 'a liberação vale uma vez só');
const over = (await one(`select public.check_manager_pin('4444', 90) r`)).r;
ok(over.ok === false, 'gerente não libera acima do limite dele');

section('Vendedor só vê as próprias vendas');
await as('authenticated', gerenteId);
const dele = await rpc('save_sale', { sale_date: '2026-11-04', items: [{ variant_id: G.id, qty: 1 }], payments: [{ method: 'pix', amount: 100 }] });
await as('authenticated', vendedorId);
ok(!(await all(`select id from public.sales`)).some((s) => s.id === dele.id), 'venda do gerente não aparece para o vendedor');
ok((await all(`select id from public.sales`)).length === 2, 'as dele aparecem');
ok((await all(`select * from public.sale_items where sale_id=$1`, [dele.id])).length === 0, 'itens de venda alheia: vazio');
await expectError(() => rpc('cancel_sale', { sale_id: venda.id, reason: 'x' }), /chame um gerente/, 'vendedor não cancela venda paga');

section('Promoção, promocional e cupom');
await as('authenticated', gerenteId);
await db.query(`insert into public.promotions (name, percent, target_type, target_id) values ('Black 44', 20, 'categoria', $1)`, [catCam]);
const catFromPublic = async () => { await as('anon', null); const r = await one(`select public.public_catalog() c`); await as('authenticated', gerenteId); return r.c; };
let cat = await catFromPublic();
let pub = cat.products.find((x) => x.id === prod.id);
ok(n(pub.variants[0].price) === 80 && n(pub.variants[0].list_price) === 100, 'promoção de categoria: de R$ 100 por R$ 80');
await db.query(`update public.promotions set active = false`);
await db.query(`insert into public.coupons (code, kind, value, min_total, max_uses) values ('ROTA10', 'percent', 10, 50, 1)`);
const cp = await rpc('save_sale', { sale_date: '2026-11-04', coupon_code: 'rota10', items: [{ variant_id: G.id, qty: 1 }], payments: [{ method: 'pix', amount: 90 }] });
ok(n(cp.total) === 90, 'cupom ROTA10 aplicou 10%');
await expectError(() => rpc('save_sale', { sale_date: '2026-11-04', coupon_code: 'ROTA10', items: [{ variant_id: G.id, qty: 1 }], payments: [{ method: 'pix', amount: 90 }] }), /todo usado/, 'cupom com limite de uso esgota');
await expectError(() => rpc('save_sale', { sale_date: '2026-11-04', coupon_code: 'NAOEXISTE', items: [{ variant_id: G.id, qty: 1 }], payments: [] }), /Cupom inválido/, 'cupom inválido');
await as(null); await db.exec(`update public.store_settings set pix_discount_pct = 5 where id = 1`); await as('authenticated', gerenteId);
const px = await rpc('save_sale', { sale_date: '2026-11-04', use_pix_discount: true, items: [{ variant_id: G.id, qty: 1 }], payments: [{ method: 'pix', amount: 95 }] });
ok(n(px.total) === 95, 'desconto de 5% no Pix');
await expectError(() => rpc('save_sale', { sale_date: '2026-11-04', use_pix_discount: true, items: [{ variant_id: G.id, qty: 1 }], payments: [{ method: 'credito', amount: 95 }] }), /todo no Pix/, 'desconto do Pix exige Pix');

section('Pedido online: reserva, pagamento, cancelamento');
const B = vs.find((v) => v.sku.endsWith('BRC-M'));
const onl = await rpc('save_sale', { sale_date: '2026-11-04', channel: 'whatsapp', status: 'aguardando_pagamento', delivery_method: 'correios', shipping_fee: 20, items: [{ variant_id: B.id, qty: 2 }], payments: [] });
let vb = await one(`select on_hand, reserved, available from public.product_variants where id=$1`, [B.id]);
ok(vb.on_hand === 5 && vb.reserved === 2 && vb.available === 3, 'reservou: físico 5, reservado 2, disponível 3');
ok(n(onl.total) === 220, 'frete somou no total');
await expectError(() => rpc('set_sale_status', { sale_id: onl.id, status: 'em_separacao' }), /Falta receber/, 'não anda sem pagamento');
const sinal = '22222222-2222-4222-8222-222222222222';
await rpc('add_payment', { id: sinal, sale_id: onl.id, method: 'pix', amount: 100, paid_on: '2026-11-04' });
await rpc('add_payment', { id: sinal, sale_id: onl.id, method: 'pix', amount: 100, paid_on: '2026-11-04' });
ok(n((await one(`select paid_total from public.sales where id=$1`, [onl.id])).paid_total) === 100, 'sinal lançado uma vez, mesmo reenviado');
await expectError(() => rpc('add_payment', { sale_id: onl.id, method: 'pix', amount: 500 }), /passa do que falta/, 'não recebe mais do que falta');
const pg = await rpc('add_payment', { sale_id: onl.id, method: 'pix', amount: 120, paid_on: '2026-11-04' });
ok(pg.status === 'pago', 'pagou tudo: virou pago sozinho');
vb = await one(`select on_hand, reserved from public.product_variants where id=$1`, [B.id]);
ok(vb.on_hand === 3 && vb.reserved === 0, 'saída de verdade ao confirmar o pagamento');
await rpc('set_sale_status', { sale_id: onl.id, status: 'enviado', tracking_code: 'BR123' });
await rpc('cancel_sale', { sale_id: onl.id, reason: 'Desistiu', refund: true, date: '2026-11-05' });
const canc = await one(`select status, paid_total, stock_state from public.sales where id=$1`, [onl.id]);
ok(canc.status === 'cancelado' && n(canc.paid_total) === 0, 'cancelada com estorno: pago zerado');
ok((await one(`select on_hand from public.product_variants where id=$1`, [B.id])).on_hand === 5, 'peça voltou ao estoque');
await expectError(() => db.query(`delete from public.sales where id=$1`, [onl.id]), /permission denied/, 'venda não se apaga');

// reserva vencida
const exp = await rpc('save_sale', { sale_date: '2026-11-04', channel: 'site', status: 'aguardando_pagamento', items: [{ variant_id: B.id, qty: 1 }], payments: [] });
await as(null); await db.query(`update public.sales set reserved_until = now() - interval '1 hour' where id=$1`, [exp.id]);
await as('anon', null); await db.query(`select public.keepalive()`);
await as('authenticated', gerenteId);
ok((await one(`select status from public.sales where id=$1`, [exp.id])).status === 'cancelado', 'reserva vencida cancela sozinha');
ok((await one(`select reserved from public.product_variants where id=$1`, [B.id])).reserved === 0, 'e solta a peça');

section('Troca e devolução');
const B2 = vs.find((v) => v.sku.endsWith('BRC-P'));
const tv = await rpc('save_sale', { sale_date: '2026-11-04', items: [{ variant_id: B2.id, qty: 2 }], payments: [{ method: 'pix', amount: 200 }] });
const tItem = await one(`select id from public.sale_items where sale_id=$1`, [tv.id]);
const tr = await rpc('create_return', { sale_id: tv.id, kind: 'troca', reason: 'tamanho', items: [{ sale_item_id: tItem.id, qty: 1, condition: 'vendavel' }] });
ok(n(tr.amount) === 100 && /^VT/.test(tr.credit_code), `troca gerou vale ${tr.credit_code}`);
ok((await one(`select on_hand from public.product_variants where id=$1`, [B2.id])).on_hand === 4, 'peça vendável voltou');
const dv = await rpc('create_return', { sale_id: tv.id, kind: 'devolucao', reason: 'defeito', refund_method: 'pix', date: '2026-11-05', items: [{ sale_item_id: tItem.id, qty: 1, condition: 'avaria' }] });
const vd2 = await one(`select on_hand, damaged from public.product_variants where id=$1`, [B2.id]);
ok(vd2.on_hand === 4 && vd2.damaged === 1, 'peça com defeito vai para avaria, não para o disponível');
ok(n(dv.amount) === 100, 'devolução vale R$ 100');
await expectError(() => rpc('create_return', { sale_id: tv.id, kind: 'troca', reason: 'cor', items: [{ sale_item_id: tItem.id, qty: 1 }] }), /Só restam 0/, 'não devolve mais do que comprou');
const tvs = await one(`select returned_total, paid_total, balance from public.sales where id=$1`, [tv.id]);
ok(n(tvs.returned_total) === 200 && n(tvs.paid_total) === 100, 'totais: devolvido 200, pago líquido 100 (o vale é crédito)');

// usar o vale numa venda nova
const vl = await rpc('save_sale', { sale_date: '2026-11-04', items: [{ variant_id: G.id, qty: 1 }], payments: [{ method: 'vale_troca', amount: 100, credit_code: tr.credit_code }] });
ok(n(vl.total) === 100, 'vale-troca pagou a venda');
ok(n((await one(`select balance from public.store_credits where code=$1`, [tr.credit_code])).balance) === 0, 'saldo do vale zerou');
await expectError(() => rpc('save_sale', { sale_date: '2026-11-04', items: [{ variant_id: G.id, qty: 1 }], payments: [{ method: 'vale_troca', amount: 100, credit_code: tr.credit_code }] }), /insuficiente/, 'vale sem saldo é recusado');
await rpc('cancel_sale', { sale_id: vl.id, reason: 'teste', refund: true });
ok(n((await one(`select balance from public.store_credits where code=$1`, [tr.credit_code])).balance) === 100, 'cancelar a venda devolve o saldo do vale');
await as('authenticated', vendedorId);
await expectError(() => rpc('create_return', { sale_id: venda.id, kind: 'troca', reason: 'cor', items: [] }), /não tem permissão/, 'vendedor não aprova troca');
ok((await one(`select public.find_credit($1) r`, [tr.credit_code])).r.balance !== undefined, 'vendedor consulta o vale que tem em mãos');
ok((await all(`select * from public.store_credits`)).length === 0, 'mas não lista os vales');

section('Caixa');
await rpc('cash_move', { session_id: caixa.id, type: 'sangria', amount: 30, reason: 'Depósito' });
await rpc('cash_move', { session_id: caixa.id, type: 'suprimento', amount: 5, reason: 'Troco' });
const cl = await rpc('close_cash', { session_id: caixa.id, counted: { dinheiro: 210 } });
ok(n(cl.expected.dinheiro) === 215, 'esperado: 50 + 190 − 30 + 5 = 215');
ok(n(cl.difference) === -5, 'diferença registrada: −5');
ok((await one(`select closed_at from public.cash_sessions where id=$1`, [caixa.id])).closed_at, 'caixa fechado');

section('Compras: entrada, frete rateado e custo médio');
await as('authenticated', estoqueId);
const compra = await rpc('save_purchase', { status: 'enviado', freight: 50, items: [{ variant_id: P.id, qty_ordered: 10, unit_cost: 50 }] });
const pItem = await one(`select id from public.purchase_items where purchase_id=$1`, [compra.id]);
ok(n(compra.total) === 550, 'total: 10 × 50 + 50 de frete');
const antes = (await one(`select on_hand from public.product_variants where id=$1`, [P.id])).on_hand;
const avgAntes = n((await one(`select avg_cost from public.variant_costs where variant_id=$1`, [P.id])).avg_cost);
await rpc('receive_purchase', { purchase_id: compra.id, due_date: '2026-12-04', items: [{ item_id: pItem.id, qty: 4 }] });
ok((await one(`select status from public.purchases where id=$1`, [compra.id])).status === 'parcial', 'recebimento parcial');
const avg1 = n((await one(`select avg_cost from public.variant_costs where variant_id=$1`, [P.id])).avg_cost);
const esperado = (antes * avgAntes + 4 * 55) / (antes + 4);
ok(Math.abs(avg1 - esperado) < 0.01, `custo médio ponderado com frete: ${avg1.toFixed(2)}`);
await expectError(() => rpc('receive_purchase', { purchase_id: compra.id, items: [{ item_id: pItem.id, qty: 99 }] }), /mais do que falta/, 'não recebe além do pedido');
await rpc('receive_purchase', { purchase_id: compra.id, items: [{ item_id: pItem.id, qty: 6 }] });
ok((await one(`select status from public.purchases where id=$1`, [compra.id])).status === 'recebido', 'recebido por completo');
ok((await one(`select on_hand from public.product_variants where id=$1`, [P.id])).on_hand === antes + 10, 'entrou no estoque');
await as('authenticated', adminId);
const contas = await all(`select * from public.bills where purchase_id=$1`, [compra.id]);
ok(contas.length === 2 && Math.abs(contas.reduce((s, b) => s + n(b.amount), 0) - 550) < 0.02, 'gerou contas a pagar de R$ 550');
await as('authenticated', estoqueId);
ok((await all(`select * from public.bills`)).length === 0, 'estoquista não vê financeiro');

section('Crediário e baixa de conta');
await as('authenticated', gerenteId);
const cli = await one(`insert into public.customers (name, phone) values ('Mano Brown Teste', '44999990000') returning id`);
await expectError(() => rpc('save_sale', { sale_date: '2026-11-04', crediario: { installments: 2 }, items: [{ variant_id: M.id, qty: 1 }], payments: [] }), /precisa de um cliente/, 'crediário exige cliente');
const cred = await rpc('save_sale', { sale_date: '2026-11-04', customer_id: cli.id, crediario: { installments: 2, first_due: '2026-12-04' }, items: [{ variant_id: M.id, qty: 1 }], payments: [] });
await as('authenticated', adminId);
const parc = await all(`select * from public.bills where sale_id=$1 order by due_date`, [cred.id]);
ok(parc.length === 2 && n(parc[0].amount) === 50 && parc[1].due_date, 'duas parcelas a receber');
await rpc('pay_bill', { bill_id: parc[0].id, method: 'pix', paid_on: '2026-12-04' });
ok(n((await one(`select paid_total from public.sales where id=$1`, [cred.id])).paid_total) === 50, 'baixa da parcela lança o pagamento na venda');
await expectError(() => rpc('pay_bill', { bill_id: parc[0].id }), /já foi baixada/, 'não baixa duas vezes');
const rec = await one(`insert into public.bills (kind, description, due_date, amount, recurring) values ('pagar', 'Aluguel', '2026-11-10', 1500, 'mensal') returning id`);
await rpc('pay_bill', { bill_id: rec.id, method: 'pix', paid_on: '2026-11-10' });
ok((await one(`select count(*)::int c from public.bills where description='Aluguel' and status='aberta' and due_date='2026-12-10'`)).c === 1, 'conta mensal gera a do mês seguinte');
await as('authenticated', gerenteId);
ok((await all(`select * from public.bills`)).length === 0, 'gerente não vê financeiro (só admin)');

section('Ajuste de estoque e inventário');
await as('authenticated', estoqueId);
await expectError(() => rpc('adjust_stock', { variant_id: P.id, type: 'ajuste', new_on_hand: 1 }), /motivo/, 'ajuste sem motivo é recusado');
await expectError(() => rpc('adjust_stock', { variant_id: P.id, type: 'perda', qty: 1, reason: 'furto' }), /gerente/, 'perda precisa de gerente');
const aj = await rpc('adjust_stock', { variant_id: B2.id, type: 'ajuste', new_on_hand: 10, reason: 'Contagem' });
ok(aj.on_hand === 10, 'ajuste vira movimento');
const inv = await rpc('start_inventory', { notes: 'Geral' });
await expectError(() => rpc('start_inventory', {}), /já existe uma contagem/i, 'uma contagem por vez');
await rpc('save_inventory_counts', { inventory_id: inv.id, counts: [{ variant_id: B2.id, counted: 7 }] });
await expectError(() => rpc('apply_inventory', { inventory_id: inv.id }), /não tem permissão/, 'estoquista conta, gerente aprova');
await as('authenticated', gerenteId);
const ap = await rpc('apply_inventory', { inventory_id: inv.id, reason: 'Fechamento' });
ok(ap.adjusted === 1, 'só o que divergiu vira ajuste');
ok((await one(`select on_hand from public.product_variants where id=$1`, [B2.id])).on_hand === 7, 'saldo igual à contagem');
const k = await all(`select type, qty, balance_after from public.stock_movements where variant_id=$1 order by id`, [B2.id]);
ok(k[k.length - 1].type === 'inventario' && k[k.length - 1].qty === -3 && k[k.length - 1].balance_after === 7, 'kardex com saldo após cada movimento');

section('Catálogo público: o que sai e o que não sai');
cat = await catFromPublic();
const text = JSON.stringify(cat);
ok(!/avg_cost|unit_cost|last_cost|on_hand|"reserved"|barcode|"sku"/.test(text), 'nem custo, nem saldo exato, nem códigos internos');
ok(cat.open === true && cat.products.length >= 4, 'produtos à mostra');
pub = cat.products.find((x) => x.id === prod.id);
ok(pub.variants.every((v) => typeof v.available === 'boolean'), 'só "tem / não tem"');
ok(pub.images.length === 2, 'fotos por cor');
ok(!cat.products.some((x) => x.id === prod2.id && x.variants.length), 'produto sem variação não oferece nada');

await as('authenticated', gerenteId);
const drop = await one(`insert into public.collections (name, slug, launch_at, limit_per_customer, limited) values ('Drop 07', 'drop-07', now() + interval '2 days', 2, true) returning id`);
await as(null); await db.query(`update public.products set collection_id=$1 where id=$2`, [drop.id, prod.id]); await as('authenticated', gerenteId);
cat = await catFromPublic();
pub = cat.products.find((x) => x.id === prod.id);
ok(pub.coming_soon === true && pub.variants.length === 0, 'drop antes da hora: "em breve", sem como pedir');
await as('anon', null);
await expectError(() => rpc('catalog_request', { customer_name: 'A', items: [{ variant_id: P.id, qty: 1 }] }), /não estão mais disponíveis/, 'não pede peça de drop fechado');
await as('authenticated', vendedorId);
await expectError(() => rpc('save_sale', { sale_date: '2026-11-04', items: [{ variant_id: P.id, qty: 1 }], payments: [{ method: 'pix', amount: 100 }] }), /ainda não foi lançado/, 'vendedor não vende drop fechado');
await as('authenticated', gerenteId);
await db.query(`update public.collections set launch_at = now() - interval '1 hour' where id=$1`, [drop.id]);
const cli2 = await one(`insert into public.customers (name) values ('Limite') returning id`);
await rpc('save_sale', { sale_date: '2026-11-04', customer_id: cli2.id, items: [{ variant_id: P.id, qty: 2 }], payments: [{ method: 'pix', amount: 200 }] });
await expectError(() => rpc('save_sale', { sale_date: '2026-11-04', customer_id: cli2.id, items: [{ variant_id: P.id, qty: 1 }], payments: [{ method: 'pix', amount: 100 }] }), /no máximo 2 por cliente/, 'limite por cliente do drop');

await as('anon', null);
const pedido = await rpc('catalog_request', { customer_name: 'Sabotage Teste', customer_phone: '(44) 99999-0011', items: [{ variant_id: M.id, qty: 1, unit_price: 0.01 }, { variant_id: M.id, qty: 1 }] });
ok(n(pedido.total) === 200, 'preço do pedido vem do banco (o navegador mandou 0,01)');
ok((await one(`select public.public_coupon('NADA', 100) r`)).r.ok === false, 'cupom inválido na sacola responde sem erro');
ok((await rpc('notify_me', { variant_id: M.id, name: 'Ana', phone: '44999990001' })).ok === true, 'avise-me registrado');
await expectError(() => rpc('notify_me', { variant_id: M.id, name: '', phone: '1' }), /nome e WhatsApp/, 'avise-me valida os dados');
await expectError(() => db.query(`select public.save_sale('{}'::jsonb)`), /permission denied/, 'anônimo não chama save_sale');
await as('authenticated', vendedorId);
const req = await one(`select * from public.catalog_requests where number=$1`, [pedido.number]);
ok(req.status === 'novo', 'pedido chegou no painel');
const conv = await rpc('save_sale', { sale_date: '2026-11-04', request_id: req.id, channel: 'whatsapp', status: 'aguardando_pagamento', customer_name: req.customer_name, customer_phone: req.customer_phone, items: [{ variant_id: M.id, qty: 2 }], payments: [] });
ok((await one(`select status, sale_id from public.catalog_requests where id=$1`, [req.id])).sale_id === conv.id, 'pedido virou venda');

section('Freio contra robô');
await as(null);
await db.query(`select set_config('request.headers', '{"x-forwarded-for":"9.9.9.9"}', false)`);
await as('anon', null);
await db.query(`select set_config('request.headers', '{"x-forwarded-for":"9.9.9.9"}', false)`);
let barrou = false;
for (let i = 0; i < 12 && !barrou; i++) {
  try { await rpc('catalog_request', { customer_name: `Robô ${i}`, items: [{ variant_id: M.id, qty: 1 }] }); }
  catch (e) { barrou = /Muitas tentativas/.test(e.message); }
}
ok(barrou, 'mesmo aparelho, muitos pedidos: barrado');

section('Auditoria e histórico');
await as('authenticated', gerenteId);
await rpc('save_product', { id: prod.id, name: 'Camiseta Oversized Rota', category_id: catCam, grid_id: grid, fit: 'Oversized', base_price: 120 });
const hist = await all(`select * from public.price_history where product_id=$1 and field='base_price'`, [prod.id]);
ok(hist.length === 1 && n(hist[0].old_value) === 100 && n(hist[0].new_value) === 120, 'mudança de preço guardada (de/por honesto)');
ok((await all(`select * from public.audit_log`)).length === 0, 'gerente não lê a auditoria');
await as('authenticated', adminId);
const aud = await all(`select * from public.audit_log where table_name='products' and row_id=$1 and action='UPDATE'`, [prod.id]);
ok(aud.length > 0 && aud[0].user_id, 'admin vê quem mudou, com antes e depois');
await rpc('member_upsert', { user_id: vendedorId, nome: 'Vê', role: 'vendedor', active: false });
await as('authenticated', vendedorId);
ok((await all(`select * from public.products`)).length === 0, 'usuário desativado perde o acesso');
ok((await one(`select public.whoami() w`)).w.member === false, 'whoami: não é mais membro');
await as('authenticated', adminId);
ok((await all(`select * from public.sales where seller_id=$1`, [vendedorId])).length > 0, 'mas o histórico de vendas dele continua');

section('Regras validadas');
await as('authenticated', gerenteId);
await expectError(() => rpc('cancel_sale', { sale_id: tv.id, reason: 'x', refund: true }), /já teve troca/, 'venda com troca não cancela (devolveria duas vezes)');
await expectError(() => rpc('add_payment', { sale_id: cred.id, method: 'pix', amount: 10 }), /crediário/, 'crediário recebe só pelas parcelas');
const credIt = await one(`select id from public.sale_items where sale_id=$1`, [cred.id]);
await expectError(() => rpc('create_return', { sale_id: cred.id, kind: 'devolucao', reason: 'cor', refund_method: 'pix', items: [{ sale_item_id: credIt.id, qty: 1 }] }), /parcelas em aberto/, 'não devolve dinheiro de parcela que nem foi paga');
const a1 = await rpc('save_sale', { sale_date: '2026-11-04', status: 'aguardando_pagamento', channel: 'site', customer_name: 'Cliente do Site', customer_phone: '(44) 98888-7777', items: [{ variant_id: B.id, qty: 1 }] });
const a2 = await rpc('save_sale', { sale_date: '2026-11-04', status: 'aguardando_pagamento', channel: 'site', customer_name: 'Outro Nome', customer_phone: '44988887777', items: [{ variant_id: B.id, qty: 1 }] });
ok((await all(`select id from public.customers where phone='44988887777'`)).length === 1, 'telefone novo vira cliente, e não duplica');
const s1 = await one(`select customer_id, customer_name from public.sales where id=$1`, [a2.id]);
ok(s1.customer_id && s1.customer_name === 'Cliente do Site', 'segunda venda reconhece o cliente pelo telefone');
await db.query(`select public.anonymize_customer($1)`, [s1.customer_id]);
const s2 = await one(`select customer_name, customer_phone from public.sales where id=$1`, [a1.id]);
ok(s2.customer_name === 'Cliente removido' && s2.customer_phone === '', 'LGPD: apaga também a cópia nas vendas');
await rpc('cancel_sale', { sale_id: a1.id, reason: 't' }); await rpc('cancel_sale', { sale_id: a2.id, reason: 't' });
await as('authenticated', estoqueId);
const hand0 = (await one(`select on_hand from public.product_variants where id=$1`, [G.id])).on_hand;
const qe = await rpc('quick_stock_entry', { reason: 'Confecção', items: [{ variant_id: G.id, qty: 3, unit_cost: 50 }, { variant_id: M.id, qty: 0 }] });
ok(qe.pieces === 3 && (await one(`select on_hand from public.product_variants where id=$1`, [G.id])).on_hand === hand0 + 3, 'entrada rápida soma ao estoque');
ok((await one(`select type from public.stock_movements where variant_id=$1 order by id desc limit 1`, [G.id])).type === 'entrada_compra', 'e fica no histórico');
await expectError(() => rpc('quick_stock_entry', { items: [{ variant_id: G.id, qty: 0 }] }), /Digite a quantidade/, 'entrada sem quantidade é recusada');
const comp2 = await rpc('save_purchase', { status: 'enviado', items: [{ variant_id: G.id, qty_ordered: 4, unit_cost: 50 }] });
const pi2 = await one(`select id from public.purchase_items where purchase_id=$1`, [comp2.id]);
await rpc('receive_purchase', { purchase_id: comp2.id, create_bill: false, items: [{ item_id: pi2.id, qty: 1 }] });
await as('authenticated', gerenteId);
await db.query(`select public.close_purchase($1)`, [comp2.id]);
ok((await one(`select status from public.purchases where id=$1`, [comp2.id])).status === 'recebido', 'pedido parcial pode ser encerrado sem o resto');
await as(null); await db.query(`update public.products set collection_id=$1 where id=$2`, [drop.id, prod.id]);
await db.query(`update public.collections set ends_at = now() - interval '1 hour' where id=$1`, [drop.id]);
await db.query(`select set_config('request.headers', '{"x-forwarded-for":"8.8.8.8"}', false)`); await as('authenticated', gerenteId);
cat = await catFromPublic();
ok(!cat.products.some((x) => x.id === prod.id), 'drop encerrado sai do catálogo');
await as('anon', null);
await expectError(() => rpc('catalog_request', { customer_name: 'Tarde', items: [{ variant_id: P.id, qty: 1 }] }), /não estão mais disponíveis/, 'e não aceita pedido');
await as(null); await db.query(`update public.collections set ends_at = null where id=$1`, [drop.id]);

section('Excluir produto só esconde');
await as('authenticated', gerenteId);
await db.query(`select public.delete_product($1)`, [prod.id]);
cat = await catFromPublic();
ok(!cat.products.some((x) => x.id === prod.id), 'sumiu do catálogo');
ok((await all(`select * from public.sale_items where product_id=$1`, [prod.id])).length > 0, 'vendas continuam nos relatórios');
await as(null);
await db.exec(`update public.store_settings set catalog_open = false where id = 1`);
await as('anon', null);
const fechado = (await one(`select public.public_catalog() c`)).c;
ok(fechado.open === false && !fechado.products && fechado.store.store_name === 'Rota 44', 'catálogo fechado: só o contato da loja');
await as(null);

console.log(`\n${passes} ok, ${fails} falha(s)`);
process.exit(fails ? 1 : 0);
