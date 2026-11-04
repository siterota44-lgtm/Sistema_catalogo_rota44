// Ambiente dos testes de navegador: o site de verdade (dist/, com a CSP de
// verdade) no Chrome, falando com o supabase-js de verdade, e o Supabase imitado
// aqui: toda chamada /rest/v1 vira SQL no supabase/schema.sql rodando num
// Postgres (PGlite), com o papel certo (anon ou authenticated) e transação por
// requisição, como o PostgREST. Nada vai para o projeto real.

import { chromium, webkit, devices } from 'playwright-core';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIST = path.join(ROOT, 'dist');
export const SHOTS = fileURLToPath(new URL('../out/shots/', import.meta.url));
fs.mkdirSync(SHOTS, { recursive: true });
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 8766;
export const BASE = `http://localhost:${PORT}`;

/* ------------------------------------------------------------- banco --- */

export async function createDb({ demo = true } = {}) {
  const db = new PGlite({ parsers: { 1082: (v) => v } });
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, email_confirmed_at timestamptz, password text);
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
  await db.exec(fs.readFileSync(`${ROOT}supabase/schema.sql`, 'utf8'));
  await db.exec(fs.readFileSync(`${ROOT}supabase/seed_base.sql`, 'utf8'));
  if (demo) await db.exec(fs.readFileSync(`${ROOT}supabase/seed_demo.sql`, 'utf8'));
  return db;
}

export async function addUser(db, email, nome, role) {
  const id = (await db.query(`insert into auth.users (email, password, email_confirmed_at) values ($1, 'senha-de-teste', now()) returning id`, [email])).rows[0].id;
  if (role === 'admin') await db.query(`select public.bootstrap_admin($1, $2)`, [email, nome]);
  else await db.query(`insert into public.store_members (user_id, nome, role) values ($1, $2, $3)`, [id, nome, role]);
  return id;
}

/** SQL como dono do banco, para o teste conferir o resultado. */
export const q = async (db, sql, params) => (await db.query(sql, params)).rows;

/* ------------------------------------------------ imitação do PostgREST -- */

const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`nome inválido: ${s}`);
  return `"${s}"`;
};

async function asRole(db, uid, fn) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.headers', '{"x-forwarded-for":"127.0.0.1"}', true)`, [uid || '']);
    await tx.exec(`set local role ${uid ? 'authenticated' : 'anon'}`);
    return fn(tx);
  });
}

function errorResponse(e) {
  const code = e.code || 'XX000';
  const status = code === '42501' ? 403 : code === 'P0001' ? 400 : code === '23505' ? 409 : 400;
  return { status, body: { code, message: e.message, details: e.detail || null, hint: e.hint || null } };
}

function parseFilters(params, alias) {
  const where = [];
  const values = [];
  const push = (v) => { values.push(v); return `$${values.length}`; };
  for (const [k, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns', 'apikey'].includes(k)) continue;
    const dot = raw.indexOf('.');
    const op = raw.slice(0, dot);
    const v = raw.slice(dot + 1);
    const col = `${alias}.${ident(k)}`;
    if (op === 'is') where.push(`${col} is ${v === 'null' ? 'null' : v === 'true' ? 'true' : 'false'}`);
    else if (op === 'in') where.push(`${col} in (${v.slice(1, -1).split(',').map((x) => push(x.replace(/^"|"$/g, ''))).join(',')})`);
    else {
      const sym = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }[op];
      if (!sym) throw new Error(`filtro não suportado: ${op}`);
      where.push(`${col} ${sym} ${push(v)}`);
    }
  }
  return { where: where.length ? `where ${where.join(' and ')}` : '', values };
}

async function restTable(db, method, name, url, body, headers, uid) {
  const t = ident(name);
  const params = url.searchParams;
  const single = String(headers.accept || '').includes('vnd.pgrst.object');
  const wantRows = String(headers.prefer || '').includes('return=representation') || params.has('select');
  const finish = (rows) => {
    if (single) {
      if (rows.length !== 1) {
        // maybeSingle pede o objeto e trata 0 linhas por conta própria
        return { status: 406, body: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows` } };
      }
      return { status: 200, body: rows[0] };
    }
    return { status: wantRows || method === 'GET' ? 200 : 204, body: wantRows || method === 'GET' ? rows : null };
  };
  return asRole(db, uid, async (tx) => {
    if (method === 'GET') {
      const { where, values } = parseFilters(params, 'x');
      const order = params.get('order');
      const orderSql = order ? `order by ${order.split(',').map((o) => { const [c, d] = o.split('.'); return `x.${ident(c)} ${d === 'desc' ? 'desc' : 'asc'}`; }).join(', ')}` : '';
      const limit = params.get('limit') ? `limit ${Number(params.get('limit'))}` : 'limit 1000';
      const offset = params.get('offset') ? `offset ${Number(params.get('offset'))}` : '';
      const r = await tx.query(`select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as v from (select x.* from public.${t} x ${where} ${orderSql} ${limit} ${offset}) t`, values);
      return finish(r.rows[0].v);
    }
    if (method === 'POST') {
      const rows = Array.isArray(body) ? body : [body];
      const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      const list = cols.map(ident).join(', ');
      const ret = wantRows ? 'returning *' : '';
      const sql = `with ins as (insert into public.${t} (${list}) select ${list} from jsonb_populate_recordset(null::public.${t}, $1::jsonb) ${ret || 'returning 1 as ok'}) select coalesce(jsonb_agg(to_jsonb(ins)), '[]'::jsonb) as v from ins`;
      const r = await tx.query(sql, [JSON.stringify(rows)]);
      return { status: wantRows ? (single ? 201 : 201) : 201, body: wantRows ? (single ? r.rows[0].v[0] : r.rows[0].v) : null };
    }
    if (method === 'PATCH') {
      const { where, values } = parseFilters(params, 'x');
      const cols = Object.keys(body);
      values.push(JSON.stringify(body));
      const pos = values.length;
      const set = cols.map((c) => `${ident(c)} = r.${ident(c)}`).join(', ');
      const ret = wantRows ? 'returning x.*' : 'returning 1 as ok';
      const sql = `with upd as (update public.${t} as x set ${set} from (select * from jsonb_populate_record(null::public.${t}, $${pos}::jsonb)) r ${where} ${ret}) select coalesce(jsonb_agg(to_jsonb(upd)), '[]'::jsonb) as v from upd`;
      const r = await tx.query(sql, values);
      return finish(r.rows[0].v);
    }
    if (method === 'DELETE') {
      const { where, values } = parseFilters(params, 'x');
      await tx.query(`delete from public.${t} as x ${where}`, values);
      return { status: 204, body: null };
    }
    throw new Error(`método ${method}`);
  });
}

async function restRpc(db, fn, args, uid) {
  const names = Object.keys(args);
  const sql = `select public.${ident(fn)}(${names.map((k, i) => `${ident(k)} => $${i + 1}`).join(', ')}) as v`;
  const vals = names.map((k) => {
    const v = args[k];
    if (v === null || v === undefined) return null;
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  });
  return asRole(db, uid, async (tx) => {
    const r = await tx.query(sql, vals);
    const v = r.rows[0]?.v;
    // como o PostgREST: a função pode definir cabeçalhos da resposta
    const h = (await tx.query(`select current_setting('response.headers', true) h`)).rows[0]?.h;
    const headers = h ? Object.assign({}, ...JSON.parse(h)) : {};
    return { status: 200, body: v === undefined || v === '' ? null : v, headers };
  });
}

/* -------------------------------------------------- servidor do site --- */

let server = null;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.xml': 'application/xml' };

function cspHeader() {
  const h = fs.readFileSync(path.join(DIST, '_headers'), 'utf8');
  // upgrade-insecure-requests quebraria o http://localhost do teste
  return /Content-Security-Policy: (.+)/.exec(h)[1].replace(/;\s*upgrade-insecure-requests/, '');
}

export function startServer() {
  if (server) return Promise.resolve();
  const csp = cspHeader();
  server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, BASE).pathname);
    if (p === '/') p = '/index.html';
    if (p === '/sistema') p = '/sistema.html';
    const file = path.join(DIST, p);
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end(fs.readFileSync(path.join(DIST, '404.html')));
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'content-security-policy': csp });
    res.end(fs.readFileSync(file));
  });
  return new Promise((r) => server.listen(PORT, r));
}
export const stopServer = () => new Promise((r) => { if (server) server.close(r); else r(); server = null; });

/* ------------------------------------------------------- navegador ---- */

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeJwt = (sub, email) => `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ sub, email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.x`;
const subOf = (auth) => {
  const token = String(auth || '').replace(/^Bearer\s+/i, '');
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString()).sub || null; } catch { return null; }
};

export const uploads = new Map();

/**
 * Abre um contexto de navegador ligado ao banco.
 * @param {{ device?: string|object, theme?: 'light'|'dark' }} opts
 */
export async function open(db, { device = 'Desktop', theme = 'dark', reduced = true } = {}) {
  // E2E_ENGINE=webkit: o mesmo teste no motor do Safari do iPhone
  const browser = process.env.E2E_ENGINE === 'webkit' ? await webkit.launch() : await chromium.launch({ executablePath: CHROME });
  const base = typeof device === 'object' ? device : device === 'Desktop' ? { viewport: { width: 1366, height: 860 } } : devices[device];
  const ctx = await browser.newContext({ ...base, colorScheme: theme, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const errors = [];
  const external = new Set();
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };

  // No WebKit o Playwright não entrega o corpo do envio: pega o arquivo antes de sair da página.
  if (process.env.E2E_ENGINE === 'webkit') {
    await ctx.exposeBinding('__upload', (_src, p, b64) => {
      const body = Buffer.from(b64, 'base64');
      if (body.length > 1048576) return 413;
      uploads.set(p, { type: p.endsWith('.webp') ? 'image/webp' : 'image/jpeg', body, path: p });
      return 200;
    });
    await ctx.addInitScript(() => {
      const real = window.fetch;
      window.fetch = async (input, init = {}) => {
        const m = /\/storage\/v1\/object\/produtos\/([^?]+)/.exec(String(input?.url || input));
        if (!m || (init.method || 'GET') !== 'POST') return real(input, init);
        const blob = init.body instanceof Blob ? init.body : [...init.body.values()].find((v) => v instanceof Blob);
        const bin = new Uint8Array(await blob.arrayBuffer());
        let text = '';
        for (let i = 0; i < bin.length; i += 32768) text += String.fromCharCode(...bin.subarray(i, i + 32768));
        const status = await window.__upload(decodeURIComponent(m[1]), btoa(text));
        const body = status === 200 ? { Key: `produtos/${m[1]}`, Id: m[1] } : { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' };
        return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      };
    });
  }
  await ctx.routeWebSocket(/supabase\.co/, () => { /* tempo real desligado no teste: não conecta em nada */ });
  await ctx.route('https://wa.me/**', (r) => r.fulfill({ contentType: 'text/html', body: '<p>whatsapp</p>' }));
  await ctx.route(/https:\/\/[^/]*supabase\.co\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const headers = req.headers();
    const respond = (status, body, extra = {}) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json', ...extra }, body: body === null ? '' : JSON.stringify(body) });
    try {
      // autenticação
      if (url.pathname === '/auth/v1/token') {
        const data = JSON.parse(req.postData() || '{}');
        if (url.searchParams.get('grant_type') === 'password') {
          const u = (await db.query(`select id, email, password from auth.users where lower(email) = lower($1)`, [data.email])).rows[0];
          if (!u || u.password !== data.password) return respond(400, { code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials', message: 'Invalid login credentials' });
          const user = { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
          return respond(200, { access_token: fakeJwt(u.id, u.email), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: `r-${u.id}`, user });
        }
        const id = String(data.refresh_token || '').slice(2);
        const u = (await db.query(`select id, email from auth.users where id = $1`, [id])).rows[0];
        return respond(200, { access_token: fakeJwt(u.id, u.email), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: `r-${u.id}`, user: { id: u.id, aud: 'authenticated', email: u.email } });
      }
      if (url.pathname === '/auth/v1/logout') return respond(204, null);
      if (url.pathname === '/auth/v1/user') {
        const sub = subOf(headers.authorization);
        if (method === 'PUT') {
          const body = JSON.parse(req.postData() || '{}');
          if (body.password) await db.query(`update auth.users set password = $1 where id = $2`, [body.password, sub]);
        }
        const u = (await db.query(`select id, email from auth.users where id = $1`, [sub])).rows[0];
        return respond(200, { id: u.id, aud: 'authenticated', email: u.email, app_metadata: {}, user_metadata: {} });
      }
      if (url.pathname.startsWith('/auth/v1/')) return respond(200, {});
      // fotos
      if (url.pathname.startsWith('/storage/v1/object/public/produtos/')) {
        const f = uploads.get(decodeURIComponent(url.pathname.split('/produtos/')[1]));
        if (!f) return route.fulfill({ status: 404, headers: cors, body: '' });
        return route.fulfill({ status: 200, headers: { ...cors, 'content-type': f.type }, body: f.body });
      }
      if (url.pathname.startsWith('/storage/v1/object/produtos/')) {
        const p = decodeURIComponent(url.pathname.split('/object/produtos/')[1]);
        const raw = req.postDataBuffer();
        // o supabase-js manda o arquivo em multipart: guarda só para servir de volta
        const file = extractMultipart(raw);
        // mesmas regras do bucket real: 1 MB e só estes tipos
        const type = p.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
        if (file.length > 1048576) return respond(413, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' });
        uploads.set(p, { type, body: file, path: p });
        return respond(200, { Key: `produtos/${p}`, Id: p });
      }
      // API
      const auth = subOf(headers.authorization);
      if (url.pathname.startsWith('/rest/v1/rpc/')) {
        const fn = url.pathname.split('/rpc/')[1];
        const args = method === 'GET' ? {} : JSON.parse(req.postData() || '{}');
        const r = await restRpc(db, fn, args, auth);
        return respond(r.status, r.body, r.headers);
      }
      if (url.pathname.startsWith('/rest/v1/')) {
        const name = url.pathname.split('/rest/v1/')[1];
        const body = req.postData() ? JSON.parse(req.postData()) : null;
        const r = await restTable(db, method, name, url, body, headers, auth);
        return respond(r.status, r.body);
      }
      return respond(404, { message: 'não imitado' });
    } catch (e) {
      const r = errorResponse(e);
      return respond(r.status, r.body);
    }
  });
  // tudo o que sair do site, além do Supabase imitado, fica anotado
  ctx.on('request', (r) => {
    const h = new URL(r.url()).hostname;
    if (!['localhost', 'cdn.jsdelivr.net', 'wa.me'].includes(h) && !/supabase\.co$/.test(h) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.add(h);
  });

  const page = await ctx.newPage();
  const watch = (p) => {
    p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    p.on('console', (m) => {
      if (m.type() !== 'error') return;
      const t = m.text();
      if (/favicon|Failed to load resource|\.t\.webp|WebSocket connection/.test(t)) return;
      errors.push(`console: ${t}`);
    });
  };
  watch(page);
  ctx.on('page', watch);
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  return { browser, ctx, page, errors, external };
}

/* O supabase-js manda o arquivo em multipart, com o cacheControl antes: pega a parte que tem filename. */
function extractMultipart(buf) {
  if (!buf || buf[0] !== 0x2d) return buf || Buffer.alloc(0);
  const boundary = buf.subarray(0, buf.indexOf('\r\n'));
  let at = 0;
  while (at >= 0) {
    const next = buf.indexOf(boundary, at + boundary.length);
    if (next < 0) break;
    const part = buf.subarray(at + boundary.length, next);
    const head = part.indexOf('\r\n\r\n');
    if (head >= 0 && /filename=/i.test(part.subarray(0, head).toString())) return part.subarray(head + 4, part.length - 2);
    at = next;
  }
  return buf;
}

export async function login(page, email, password = 'senha-de-teste') {
  await page.goto(`${BASE}/sistema`);
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type=submit]');
  await page.waitForSelector('.app', { timeout: 15000 });
}

export const nav = async (page, id) => {
  await page.evaluate((r) => { location.hash = `#/${r}`; }, id);
  await page.waitForTimeout(120);
};

export async function shot(page, name, { full = false } = {}) {
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${SHOTS}${name}.png`, fullPage: full });
}

/** Auditoria da tela: rolagem lateral, campo < 16 px e toque pequeno (celular). */
export async function audit(page, label, { mobile = false } = {}) {
  return page.evaluate(({ label, mobile }) => {
    const issues = [];
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw + 1) {
      const off = [...document.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > vw + 1 && !el.closest('.grid-matrix, .k-chips, .k-cats, .k-hl-row, .tabs, .k-gal-track, .table-wrap, dialog, .segmented')).slice(0, 3).map((el) => `${el.tagName}.${String(el.className).slice(0, 40)}`);
      issues.push(`${label}: rolagem lateral (${document.documentElement.scrollWidth} > ${vw}) ${off.join(' | ')}`);
    }
    for (const d of document.querySelectorAll('dialog[open]')) {
      const p = d.querySelector('.modal-body, .k-sheet-body');
      if (p && p.scrollWidth > p.clientWidth + 1 && !p.querySelector('.grid-matrix, .label-sheet')) issues.push(`${label}: modal com rolagem lateral (${p.scrollWidth} > ${p.clientWidth})`);
    }
    if (mobile) {
      const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      const top = [...document.querySelectorAll('dialog[open]')].pop() || document;
      for (const el of top.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=color]):not([hidden]), select, textarea')) {
        if (visible(el) && parseFloat(getComputedStyle(el).fontSize) < 16) issues.push(`${label}: campo com fonte ${getComputedStyle(el).fontSize} (${el.name || el.placeholder || el.className})`);
      }
      for (const el of top.querySelectorAll('button, a.btn, a.k-btn, .chip, label.btn')) {
        if (!visible(el) || el.closest('.gallery-move, .gallery-rm, .cart-qty, .pp-nav, [data-dot], .k-gal-dots')) continue;
        const r = el.getBoundingClientRect();
        if (r.height < 36 || r.width < 36) issues.push(`${label}: toque pequeno ${Math.round(r.width)}×${Math.round(r.height)} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 28)}"`);
      }
    }
    return [...new Set(issues)].slice(0, 10);
  }, { label, mobile });
}

let fails = 0;
let passes = 0;
export const ok = (cond, msg, extra = '') => {
  if (cond) { passes += 1; console.log('  ✓', msg); } else { fails += 1; console.log('  ✗', msg, extra); }
};
export const section = (t) => console.log(`\n${t}`);
export const result = () => { console.log(`\n${passes} ok, ${fails} falha(s)`); return fails; };
