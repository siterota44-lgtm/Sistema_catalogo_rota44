# Rota 44 · Sistema de gestão e catálogo

Sistema da loja **Rota 44** (streetwear: rap, skate, trap), no mesmo molde do sistema
da i7even: HTML, CSS e JavaScript puros, sem build no app, com **Supabase** (banco,
login, fotos) e **Netlify**.

- **Catálogo público:** página inicial do site. O cliente escolhe e o pedido abre no WhatsApp da loja.
- **Sistema:** em `/sistema`. PDV, estoque, compras, financeiro, relatórios.

---

## Colocar no ar

Faça nesta ordem. Leva uns 10 minutos.

### 1. Banco de dados (Supabase → SQL Editor → New query)

Cole cada arquivo inteiro e clique em **Run**, um de cada vez:

| Ordem | Arquivo | O que faz |
|---|---|---|
| 1 | `supabase/schema.sql` | Cria tabelas, funções, regras de acesso e a pasta de fotos |
| 2 | `supabase/seed_base.sql` | Categorias, cores, grades, marca, contas do financeiro |
| 3 | `supabase/primeiro_admin.sql` | Dá acesso de administrador a `siterota44@gmail.com` |
| 4 (opcional) | `supabase/seed_demo.sql` | 3 peças de exemplo com as fotos da pasta (nomes e preços inventados) |

Os arquivos podem rodar de novo sem duplicar nem apagar nada.

### 2. Fechar o cadastro (Supabase → Authentication)

1. **Sign In / Providers → Email:** desligue **Allow new users to sign up**.
   Hoje ele está ligado: sem isso, qualquer pessoa cria conta. (Ela não veria nada, mas não há motivo para deixar aberto.)
2. **URL Configuration:** em *Site URL* coloque `https://SEU-SITE.netlify.app/sistema`
   e em *Redirect URLs* `https://SEU-SITE.netlify.app/**`. É o que faz o "esqueci minha senha" funcionar.

### 3. Publicar (Netlify)

O `netlify.toml` já diz tudo: comando `node netlify/build.mjs`, pasta `dist`.

- **Pelo GitHub:** este repositório já está pronto: conecte `siterota44-lgtm/Sistema_catalogo_rota44`, branch `main`, e deixe os campos de build como vierem. Cada push publica sozinho.
- **Arrastando:** rode `node netlify/build.mjs` e arraste a pasta `dist` para o Netlify.

Só a `dist/` vai para o ar: SQL, testes e documentos nunca são publicados.

**Se o endereço final não for `rota-44.netlify.app`:** troque-o no `index.html` (`og:url` e `og:image`,
é a prévia do link no WhatsApp), no `robots.txt` e no `sitemap.xml`.

### 4. Conferir

```bash
cd tests && npm install
npm run test:security                                          # banco real: tudo tem de sair "recusado"
SITE_URL=https://SEU-SITE.netlify.app npm run test:security    # também confere o site publicado
```

### 5. Preencher a loja (no sistema)

1. **Ajustes → Loja:** WhatsApp (é para ele que os pedidos vão), Instagram, endereço, Pix.
2. **Ajustes → Vendas e taxas:** taxas da maquininha e limites de desconto.
3. **Catálogo online:** textos do topo, "sobre", trocas, frete. Lá tem o checklist "antes de divulgar" e o QR code.
4. **Produtos → Novo produto**: escolha categoria, grade e cores; as variações saem sozinhas, com SKU e código de barras.

### 6. Backup e "Supabase não pausa" (GitHub, recomendado)

O plano grátis do Supabase **pausa o projeto após ~7 dias sem acesso e não faz backup**. O
`.github/workflows/backup.yml` roda todo dia e resolve os dois:

- **Sinal de vida:** funciona sozinho assim que o repositório estiver no GitHub. Também solta reservas vencidas.
- **Backup criptografado:** cadastre em *Settings → Secrets and variables → Actions*:
  - `SUPABASE_DB_URL`: Supabase → **Connect** → *Session pooler* (a connection string com a senha do banco);
  - `BACKUP_PASSPHRASE`: uma senha longa só sua. Guarde num cofre: sem ela o backup não abre.

  Depois: *Actions → Supabase acordado + backup → Run workflow*, e confira o log. O artefato fica 30 dias.

**Restaurar:** baixe o artefato, `gpg -d rota44-AAAA-MM-DD_HHMM.tar.gz.gpg > b.tar.gz`, `tar -xzf b.tar.gz`, e no SQL
Editor rode `schema.sql` → `2_login.sql` → `1_dados.sql`. **Cuidado:** o `1_dados.sql` apaga os dados atuais.

> O Netlify grátis tem limite mensal de publicações (na i7even dava cerca de 20 por mês). Se bater, a i7even
> resolveu indo para o Cloudflare, que publica a mesma `dist/`.

---

## O que o sistema faz

| Tela | O quê |
|---|---|
| **Painel** | Hoje, 7 dias e mês com comparação; "precisa de atenção"; mais vendidos |
| **PDV** | Bipa o código (USB ou câmera), grade cor × tamanho, cliente, desconto, cupom, vários pagamentos, troco, Pix com desconto, crediário, comprovante térmico e WhatsApp. Rascunho sobrevive a fechar a tela |
| **Vendas** | Funil (aguardando → pago → separação → enviado/retirada → entregue), pagamento depois, estorno, rastreio, cancelar com motivo |
| **Pedidos do catálogo** | O que chegou pelo site: vira venda com 1 toque. Lista do "avise-me" |
| **Trocas** | Troca gera vale-troca; devolução estorna; peça com defeito vai para avaria |
| **Caixa** | Abertura, sangria, suprimento, fechamento conferido por forma de pagamento |
| **Clientes** | Histórico, tamanhos preferidos, segmentos (VIP, inativos, aniversariantes), exportar e apagar dados (LGPD) |
| **Produtos** | Variações automáticas, fotos por cor, margem, reajuste em lote, histórico de preço |
| **Categorias e drops** | Árvore de categorias, drops com data e limite por cliente, marcas, cores, grades, medidas |
| **Promoções e cupons** | % por loja, categoria, drop ou produto; cupons com validade e limite |
| **Estoque** | Físico × reservado × disponível, curva de grade, kardex, repor, parados, contagem física |
| **Compras** | Lançamento em grade, recebimento parcial, frete rateado, custo médio, conta a pagar |
| **Etiquetas** | 50×30 mm com código de barras e preço (de/por em promoção) |
| **Financeiro** | DRE simples, fluxo de caixa com previsto (cartão cai depois), contas a pagar e receber |
| **Relatórios** | Vendas, produtos (giro, margem, sell-through por drop), estoque (curva ABC, ruptura), trocas, clientes, comissões. Tudo em CSV |
| **Catálogo online** | Abrir/fechar, link, QR code, textos e regras da vitrine |
| **Ajustes** | Dados da loja, taxas, equipe, senha de liberação, backup, auditoria, diagnóstico |

**Catálogo público:** herói com o muro de grafite, drops com contagem regressiva, filtros (categoria, tamanho, cor, preço,
modelagem...), busca que tolera erro de digitação, ficha com galeria por cor e tamanho esgotado riscado, tabela de medidas,
"avise-me", sacola com cupom e pedido no WhatsApp. Modo claro e escuro. Aparece no Google (o sistema não).

### Perfis

| Perfil | Acessa | Não acessa |
|---|---|---|
| **Admin / Dono** | Tudo | |
| **Gerente** | Vendas, produtos, estoque, trocas, relatórios, custo e margem; libera desconto com senha | Financeiro, equipe |
| **Vendedor** | PDV, as próprias vendas, clientes, consulta de estoque | Custo e margem (nem pela API), trocas, relatórios |
| **Estoquista** | Estoque, compras, contagem, etiquetas, custo | Vendas, clientes, financeiro |

A trava de verdade é no banco: esconder o menu é só conforto. Para incluir alguém: crie o login em *Authentication → Users*
e adicione em *Ajustes → Equipe*.

---

## Decisões que valem saber

- **Pedido do catálogo não reserva estoque.** Reserva aberta ao público deixaria qualquer um segurar a loja inteira.
  A reserva nasce quando o atendente transforma em venda, e expira sozinha (padrão: 24 h, em *Ajustes*).
- **Pagamento pelo site e cálculo de frete não existem:** o fechamento é no WhatsApp, como pedido. Ligar um gateway e frete é o próximo passo natural.
- **Nota fiscal (NFC-e/NF-e) não é emitida.** Os dados fiscais do produto (NCM, origem, CEST) já são guardados para quando houver emissor; o comprovante avisa que não é documento fiscal.
- **O grafite do fundo é arte original**, gerada por `tests/arte/gerar-grafite.mjs`. As imagens de grafite da pasta `Imagens` são de banco de imagens, com marca d'água (iStock, 123RF e similares): não publique sem comprar a licença.
- **Só uma loja/estoque.** Multiloja e transferências ficaram para depois, como no roadmap do guia.

---

## Para desenvolver

```bash
node netlify/build.mjs                  # monta a dist/
cd tests && npm install
npm run test:db                         # schema.sql num Postgres de verdade: permissões e cada regra
npm run test:unit                       # fórmulas e código de barras
npm run test:e2e                        # roteiro completo no Chrome, com o banco imitado (nada vai para o Supabase real)
npm run test:security                   # ataque sem login contra o banco real
```

Regras do projeto:

- `supabase/schema.sql` é idempotente e **só acrescenta**. Mudou algo de que o app depende? Suba `schema_version` no `whoami()` e `APP.schemaVersion` em `assets/js/config.js`.
- Estoque e dinheiro só mudam por função do banco (RPC), numa transação, com trava em ordem de id.
- `assets/js/core/data.js` é o único lugar que fala com o Supabase. Nomes iguais aos do banco (snake_case).
- Cada tela exporta `mount(host, ctx)`. Todo dado digitado passa por `esc()`.
- Preço tem espelho: `public._variant_price` no banco e `priceOf` em `core/calc.js`.
- Só a chave **publishable** fica no código. A chave secreta nunca.

```
index.html              catálogo público
sistema.html            sistema
netlify.toml            publicação; netlify/build.mjs monta a dist/ e os cabeçalhos de segurança
supabase/               schema.sql, seeds, primeiro_admin.sql, backup_prelude.sql
assets/css/             tokens (cores e temas), base, layout, components, app, rota (identidade), mobile, catalog
assets/brand/           escudo em vetor, ícones, grafite (claro e escuro), prévia do link
assets/js/catalog.js    catálogo
assets/js/app.js        sistema: login, menu por perfil, rotas
assets/js/core/         data (banco), calc (fórmulas), barcode, utils, errors, telemetry
assets/js/ui/           uma tela por arquivo + kit, common, pickers, charts
tests/                  db, unit, e2e, security, arte (gera escudo, grafite e prévia)
```
