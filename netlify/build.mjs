/*
 * Netlify: monta a pasta dist/, a única que vai para o ar.
 *
 * Lista branca: só os arquivos do site. SQL, testes, documentação e .github
 * nunca são publicados. A página inicial é o catálogo (index.html) e o sistema
 * mora em /sistema (sistema.html).
 *
 * No painel do Netlify nada precisa ser configurado: o netlify.toml já diz
 * o comando (node netlify/build.mjs) e a pasta (dist).
 */
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const out = new URL('dist/', root);
const FILES = ['index.html', 'sistema.html', 'manifest.webmanifest', 'sw.js', 'robots.txt', 'sitemap.xml', '404.html'];
const DIRS = ['assets'];

// Lista branca do que a página pode carregar e com quem pode falar:
//   script-src  → nosso código + bibliotecas do jsDelivr (com versão fixa)
//   connect-src → API e realtime do Supabase, e a consulta de CEP
//   style-src 'unsafe-inline' → estilos aplicados em atributo style
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob: https://*.supabase.co",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://cdn.jsdelivr.net",
  "manifest-src 'self'",
  "worker-src 'self'",
  'upgrade-insecure-requests',
].join('; ');

// HSTS: só HTTPS · frame-ancestors/X-Frame-Options: ninguém põe o site num iframe ·
// nosniff: o navegador respeita o tipo do arquivo · Permissions: câmera só para o
// próprio site (leitor de código de barras e foto), o resto bloqueado.
// O sistema fica fora dos buscadores; o catálogo aparece no Google.
const HEADERS = `/*
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: accelerometer=(), camera=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()
  Cross-Origin-Opener-Policy: same-origin-allow-popups
  Content-Security-Policy: ${CSP}

/sistema
  X-Robots-Tag: noindex, nofollow, noarchive

/sistema.html
  X-Robots-Tag: noindex, nofollow, noarchive

/sw.js
  Cache-Control: no-cache

/assets/fonts/*
  Cache-Control: public, max-age=31536000, immutable

/assets/brand/*
  Cache-Control: public, max-age=604800
`;

// Cópia à mão: o fs.cpSync do Node 24 no Windows quebra com acento no caminho.
function copy(rel) {
  const src = new URL(rel, root);
  if (!fs.statSync(src).isDirectory()) { fs.copyFileSync(src, new URL(rel, out)); return; }
  fs.mkdirSync(new URL(`${rel}/`, out), { recursive: true });
  for (const name of fs.readdirSync(src)) copy(`${rel}/${name}`);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
FILES.forEach(copy);
DIRS.forEach(copy);
fs.writeFileSync(new URL('_headers', out), HEADERS);
fs.writeFileSync(new URL('_redirects', out), '/catalogo / 301\n/admin /sistema 301\n');

// Conferência final: nada de fora da lista branca escapou para a dist/.
const files = fs.readdirSync(out, { recursive: true }).map(String);
const bad = files.filter((f) => /\.(sql|md|gpg|env|key|mjs)$|^(supabase|tests|netlify|\.github)/i.test(f));
if (bad.length) {
  console.error('arquivo interno na dist/:', bad);
  process.exit(1);
}
console.log(`dist/ pronta: ${files.length} itens`);
