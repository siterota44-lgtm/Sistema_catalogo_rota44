# Rota 44 — Especificação Fundamental do Sistema de Gestão, Controle e Catálogo

> Documento-base com tudo o que um sistema para loja de roupas **streetwear** precisa para funcionar: catálogo, estoque, vendas, clientes, financeiro, fiscal e a vitrine pública.
> Use como guia de requisitos, modelagem de dados e roadmap de desenvolvimento.

---

## Sumário

1. [Visão geral e módulos](#1-visão-geral-e-módulos)
2. [Usuários, perfis e permissões](#2-usuários-perfis-e-permissões)
3. [Catálogo de produtos](#3-catálogo-de-produtos)
4. [Categorias, coleções e atributos streetwear](#4-categorias-coleções-e-atributos-streetwear)
5. [Estoque](#5-estoque)
6. [Fornecedores e compras](#6-fornecedores-e-compras)
7. [Precificação e promoções](#7-precificação-e-promoções)
8. [Vendas, PDV e pedidos](#8-vendas-pdv-e-pedidos)
9. [Trocas e devoluções](#9-trocas-e-devoluções)
10. [Clientes (CRM)](#10-clientes-crm)
11. [Catálogo público / vitrine](#11-catálogo-público--vitrine)
12. [Financeiro](#12-financeiro)
13. [Fiscal](#13-fiscal)
14. [Etiquetas e código de barras](#14-etiquetas-e-código-de-barras)
15. [Relatórios e dashboard](#15-relatórios-e-dashboard)
16. [Integrações](#16-integrações)
17. [Modelo de dados (entidades principais)](#17-modelo-de-dados-entidades-principais)
18. [Regras de negócio essenciais](#18-regras-de-negócio-essenciais)
19. [Requisitos não funcionais](#19-requisitos-não-funcionais)
20. [Roadmap sugerido (MVP → completo)](#20-roadmap-sugerido-mvp--completo)
21. [Checklist final](#21-checklist-final)

---

## 1. Visão geral e módulos

O sistema tem duas faces:

| Face | Público | Objetivo |
|---|---|---|
| **Painel de gestão (admin)** | Dono, gerente, vendedores, estoquista | Controlar produtos, estoque, vendas, clientes, caixa e relatórios |
| **Catálogo / vitrine (público)** | Clientes | Navegar pelos produtos, ver disponibilidade e comprar ou pedir pelo WhatsApp |

**Módulos obrigatórios**

- Autenticação e permissões
- Produtos e variações (grade cor × tamanho)
- Categorias, coleções/drops e marcas
- Estoque e movimentações
- Fornecedores e compras
- Vendas (PDV físico + pedidos online)
- Trocas e devoluções
- Clientes
- Financeiro (caixa, contas a pagar/receber)
- Relatórios e dashboard
- Catálogo público

**Módulos recomendados (fase 2+)**

- Fiscal (NF-e / NFC-e)
- Cupons e fidelidade
- Integração com marketplaces e redes sociais
- Multiloja / multiestoque

---

## 2. Usuários, perfis e permissões

### Perfis padrão

| Perfil | Pode |
|---|---|
| **Admin / Dono** | Tudo, incluindo configurações, custos, margens, financeiro e usuários |
| **Gerente** | Produtos, estoque, vendas, relatórios, aprovar descontos acima do limite e trocas |
| **Vendedor** | PDV, consultar estoque, cadastrar cliente, ver as próprias vendas e comissões. **Não vê custo** |
| **Estoquista** | Entradas, transferências, inventário, etiquetas. Não acessa financeiro |

### Requisitos

- Controle de acesso por **papel (RBAC)** e, se possível, por permissão granular (`produto.editar`, `estoque.ajustar`, `venda.desconto.acima_limite`...).
- **Limite de desconto por perfil** (ex.: vendedor até 10%, gerente até 25%).
- **Log de auditoria**: quem fez, o quê, quando e valores antes/depois (principalmente em preço, estoque e cancelamentos).
- Login com senha forte, opção de 2FA para admin, sessão com expiração.
- Desativar usuário em vez de excluir (preserva histórico de vendas).

---

## 3. Catálogo de produtos

Em loja de roupa, o **produto** é o "modelo" e a **variação (SKU)** é a combinação vendável de cor + tamanho. Estoque e código de barras ficam **na variação**, nunca no produto pai.

```
Produto: Camiseta Oversized "Rota" Preta/Branca
 ├── SKU R44-CAM-OVS-001-PRT-P   (Preto, P)   estoque: 4
 ├── SKU R44-CAM-OVS-001-PRT-M   (Preto, M)   estoque: 7
 ├── SKU R44-CAM-OVS-001-PRT-G   (Preto, G)   estoque: 0  → esgotado
 └── SKU R44-CAM-OVS-001-BRC-M   (Branco, M)  estoque: 3
```

### Campos do produto (pai)

| Campo | Observação |
|---|---|
| Nome | Ex.: "Moletom Canguru Heavy" |
| Slug | URL amigável para o catálogo |
| Descrição curta e longa | Longa aceita texto rico |
| Categoria principal + categorias secundárias | Ver seção 4 |
| Marca | Própria (Rota 44) ou de terceiros |
| Coleção / Drop | Ex.: "Drop 07 — Verão 26" |
| Gênero | Masculino, feminino, unissex |
| Modelagem / fit | Oversized, regular, boxy, slim, baggy, cropped |
| Composição / tecido | Ex.: 100% algodão, moletom 3 cabos, dry-fit |
| Gramatura | Ex.: 220 g/m², 300 g/m² (muito valorizado no streetwear) |
| Tipo de estampa / acabamento | Silk, DTF, bordado, puff, estonado, lavagem ácida |
| Tabela de medidas | Vinculada ao produto ou à categoria |
| Instruções de lavagem | |
| Imagens | Várias por cor; ordem; imagem de capa |
| Tags | "lançamento", "mais vendido", "edição limitada", "collab" |
| Status | Rascunho, ativo, inativo, arquivado |
| Visível no catálogo | Sim/não, independente do status interno |
| SEO | Título, meta descrição |
| Dados fiscais | NCM, origem, CEST (se houver) — ver seção 13 |
| Peso e dimensões da embalagem | Para cálculo de frete |

### Campos da variação (SKU)

| Campo | Observação |
|---|---|
| SKU | Código interno único e legível |
| Código de barras (EAN-13 ou interno) | Único |
| Cor | Nome + hexadecimal (para mostrar bolinha de cor) |
| Tamanho | Da grade escolhida |
| Preço de custo | Oculto para vendedor |
| Preço de venda | Herda do produto, pode sobrescrever |
| Preço promocional | Com data de início/fim |
| Estoque atual / reservado / disponível | Calculados por movimentação |
| Estoque mínimo | Para alerta de reposição |
| Imagens específicas da cor | |
| Ativo | Permite desativar só uma variação |

### Padrão de SKU sugerido

```
R44 - CAT - MOD - SEQ - COR - TAM
R44 - CAM - OVS - 001 - PRT - M
```

- `CAT`: CAM (camiseta), MOL (moletom), CAL (calça), BER (bermuda), BON (boné), JAQ (jaqueta), ACE (acessório)...
- `MOD`: OVS (oversized), REG (regular), BOX (boxy), BAG (baggy)...
- `COR`: códigos de 3 letras padronizados em tabela.

### Grades de tamanho

Cadastrar **grades reutilizáveis**, cada uma com ordem de exibição:

| Grade | Tamanhos |
|---|---|
| Letra adulto | PP, P, M, G, GG, XG, XGG |
| Numérica (calças/bermudas) | 36, 38, 40, 42, 44, 46, 48 |
| Calçados | 34 a 44 |
| Bonés | Único / Ajustável, ou 56–60 |
| Tamanho único | U |

> Ao criar o produto, o usuário escolhe a grade e as cores, e o sistema **gera todas as variações automaticamente** (com opção de remover combinações que não existem).

---

## 4. Categorias, coleções e atributos streetwear

### Árvore de categorias sugerida

```
Roupas
├── Camisetas
│   ├── Oversized
│   ├── Regular
│   ├── Boxy
│   ├── Regata
│   └── Manga longa
├── Moletons
│   ├── Canguru (hoodie)
│   ├── Careca (crewneck)
│   └── Zíper
├── Jaquetas e casacos
│   ├── Corta-vento
│   ├── Puffer
│   ├── Jaqueta jeans
│   └── Varsity / college
├── Calças
│   ├── Cargo
│   ├── Jeans (baggy, wide, reta)
│   ├── Jogger / moletom
│   └── Tactel / nylon
├── Bermudas e shorts
│   ├── Jeans
│   ├── Moletom
│   ├── Tactel / nylon
│   └── Basquete (mesh)
├── Camisas
│   ├── Camisa de time / jersey
│   └── Camisa de botão / flanela
├── Conjuntos
└── Feminino (cropped, baby look, etc.)

Calçados
├── Tênis
├── Chinelos e slides
└── Meias

Acessórios
├── Bonés (aba reta, dad hat, trucker)
├── Toucas / gorros
├── Bags (shoulder bag, pochete, mochila)
├── Correntes e joias
├── Óculos
└── Cintos
```

**Requisitos da categoria**

- Hierarquia ilimitada (pai/filho), com ordem de exibição.
- Imagem/banner e descrição por categoria.
- Vínculo opcional com **tabela de medidas** e **grade padrão**.
- Pode ficar oculta no catálogo sem sumir do sistema.
- Um produto tem uma categoria principal e pode aparecer em outras.

### Coleções e drops

Streetwear vive de **drops** e edições limitadas. Tratar como entidade própria:

| Campo | Uso |
|---|---|
| Nome | "Drop 07 — Night Run" |
| Data/hora de lançamento | Produtos ficam ocultos ou em "em breve" até a hora |
| Data de encerramento | Opcional |
| Edição limitada | Sim/não + quantidade total produzida |
| Limite por cliente | Ex.: máximo 2 unidades por CPF |
| Banner, descrição, lookbook | Para a vitrine |
| Collab | Parceiro / artista envolvido |

### Atributos filtráveis

Cadastráveis pelo admin (não fixos no código), usados nos filtros do catálogo:

- Cor, tamanho, modelagem, tecido, gramatura, tipo de estampa, gênero, marca, coleção, faixa de preço, "em promoção", "em estoque".

---

## 5. Estoque

### Princípio central

> **O estoque nunca é editado diretamente.** Ele é sempre o resultado da soma de **movimentações**. Toda alteração gera um registro com tipo, quantidade, usuário, data e motivo.

### Tipos de movimentação

| Tipo | Efeito | Origem |
|---|---|---|
| Entrada por compra | + | Recebimento de pedido de compra / nota do fornecedor |
| Entrada por produção | + | Peças próprias que chegaram da confecção/estamparia |
| Saída por venda | − | PDV ou pedido online confirmado |
| Devolução de cliente | + | Troca/devolução aceita (se a peça voltar vendável) |
| Devolução a fornecedor | − | Defeito de fábrica |
| Ajuste de inventário | ± | Contagem física divergente (exige motivo) |
| Perda / avaria / furto | − | Exige motivo e perfil autorizado |
| Transferência | − origem / + destino | Entre lojas ou depósito |
| Brinde / uso interno / mostruário | − | Fotos, influenciadores, manequim |
| Reserva | reservado + | Pedido aguardando pagamento |
| Liberação de reserva | reservado − | Pedido cancelado ou expirado |

### Quantidades por variação

- **Físico**: o que está na prateleira.
- **Reservado**: separado para pedidos não finalizados.
- **Disponível** = físico − reservado → é o que o catálogo mostra.

### Funções obrigatórias

- **Estoque mínimo** por variação e alerta de reposição.
- **Curva de grade**: ver de relance quais tamanhos de um modelo estão acabando (ex.: M e G zerados, PP sobrando).
- **Inventário** (contagem física): gerar lista, contar (com leitor de código de barras ou celular), comparar com o sistema e aprovar ajustes.
- **Inventário rotativo**: contar uma categoria por semana.
- **Custo médio ponderado** atualizado a cada entrada.
- **Histórico (kardex)** por SKU: todas as entradas e saídas com saldo após cada uma.
- **Bloqueio de estoque negativo** (configurável; padrão: bloqueado).
- **Multi-local** (opcional): loja física, depósito, estoque do e-commerce.
- **Produtos parados**: relatório de itens sem venda há X dias (candidatos a promoção).
- **Reserva com expiração** para pedidos online (ex.: 30 min para Pix, libera automaticamente).

---

## 6. Fornecedores e compras

### Fornecedor

- Razão social / nome, CNPJ ou CPF, contato, WhatsApp, e-mail, endereço.
- Tipo: fabricante, confecção, estamparia, bordado, atacadista, revenda de marca.
- Prazo médio de entrega, condições de pagamento, observações.
- Histórico de compras e avaliação (atraso, defeitos).

### Pedido de compra

- Status: **rascunho → enviado → parcialmente recebido → recebido → cancelado**.
- Itens por variação (cor × tamanho), quantidade e custo unitário.
- **Lançamento em grade**: tela em matriz (cores nas linhas, tamanhos nas colunas) para digitar quantidades rapidamente.
- Recebimento parcial (conferência item a item).
- Ao receber: gera entrada no estoque, atualiza custo médio e cria conta a pagar.
- Importação de XML de NF-e do fornecedor (fase 2).

### Produção própria (marca própria)

Se a Rota 44 produz peças:

- Ordem de produção: modelo, grade, quantidade, fornecedor de cada etapa (tecido, corte, costura, estampa).
- Custo composto: tecido + mão de obra + estampa + etiqueta/tag + embalagem.
- Status por etapa e previsão de chegada (útil para anunciar o drop).

---

## 7. Precificação e promoções

### Formação de preço

- Custo → **markup** ou **margem desejada** → preço sugerido.
- Exibir margem real (%) e lucro bruto (R$) na tela do produto (só para admin/gerente).
- Considerar na fórmula: impostos, taxa da maquininha/gateway, frete, embalagem e comissão.
- Arredondamento psicológico configurável (ex.: terminar em ,90).

### Tabelas de preço (opcional)

- Varejo, atacado (quantidade mínima por peça ou por pedido), revendedor, funcionário.

### Promoções

| Tipo | Exemplo |
|---|---|
| Preço promocional por SKU/produto | De R$ 189,90 por R$ 149,90 |
| Desconto por categoria ou coleção | 20% em toda a coleção anterior |
| Leve X pague Y | 3 camisetas por R$ 200 |
| Desconto progressivo | 2ª peça com 30% off |
| Cupom | `ROTA10`, uso único, por cliente, validade, valor mínimo |
| Desconto por forma de pagamento | 5% no Pix |
| Frete grátis acima de R$ X | |

**Regras**: datas de início/fim, se acumula com outras promoções, limite de uso total e por cliente, categorias/produtos excluídos.

---

## 8. Vendas, PDV e pedidos

### PDV (loja física)

- Busca por nome, SKU ou **leitura de código de barras**.
- Seleção rápida de cor/tamanho com estoque visível.
- Vincular cliente (CPF/telefone) ou venda sem cadastro.
- Vendedor responsável (para comissão).
- Descontos por item ou no total, respeitando limite do perfil (acima disso, pede senha do gerente).
- **Pagamentos múltiplos** na mesma venda: dinheiro (com troco), Pix, débito, crédito à vista e parcelado, vale-troca, crediário (opcional).
- Impressão/envio do comprovante (impressora térmica, WhatsApp ou e-mail).
- Cancelamento de venda com motivo, devolvendo estoque automaticamente.
- **Abertura e fechamento de caixa**, sangria e suprimento (ver seção 12).
- Funcionamento em queda de internet (fase 2: modo offline com sincronização).

### Pedidos online / catálogo

Status sugeridos:

```
Aguardando pagamento → Pago → Em separação → Enviado / Pronto para retirada → Entregue
                    ↘ Cancelado (pagamento expirado ou desistência)
Entregue → Troca/Devolução solicitada
```

- Canais: site, WhatsApp, Instagram, marketplace — **registrar o canal de origem**.
- Formas de entrega: retirada na loja, motoboy/entrega local, Correios/transportadora.
- Código de rastreio e notificações ao cliente a cada mudança de status.
- Pedido via WhatsApp: o catálogo monta a mensagem com itens e o atendente converte em pedido no painel.

### Comissões

- Percentual por vendedor (fixo ou por categoria).
- Calculada sobre o valor líquido (após descontos e devoluções).
- Relatório mensal por vendedor.

---

## 9. Trocas e devoluções

Ponto crítico em loja de roupa (tamanho errado é o motivo nº 1).

- **Troca**: devolve peça → estoque volta (se em condição de venda) → cliente leva outra ou recebe **vale-troca**.
- **Devolução com reembolso**: estorno no mesmo meio de pagamento.
- **Prazo configurável** para loja física; compras online/fora do estabelecimento seguem o **direito de arrependimento de 7 dias** do Código de Defesa do Consumidor (confirmar regras com contador/advogado).
- Motivo obrigatório: tamanho, defeito, cor, arrependimento, outro → vira relatório (ex.: "modelo X tem muita troca por tamanho → revisar tabela de medidas").
- Peça com defeito vai para status **avaria** (não volta ao disponível) ou devolução ao fornecedor.
- **Vale-troca/crédito**: código único, saldo, validade, vinculado ao cliente, usável no PDV e online.

---

## 10. Clientes (CRM)

### Cadastro

- Nome, CPF (opcional, mas necessário para nota e limite por drop), telefone/WhatsApp, e-mail, data de nascimento, endereço(s), Instagram.
- **Tamanhos preferidos** (camiseta, calça, calçado) — ajuda o vendedor e o marketing.
- Consentimento de marketing (LGPD) com data e canal.

### Funções

- Histórico de compras, ticket médio, última compra, total gasto.
- Créditos / vale-trocas.
- Segmentação: VIP, recorrente, inativo há 90 dias, aniversariantes do mês.
- Lista de espera / **"avise-me quando chegar"** por SKU esgotado.
- Programa de fidelidade (fase 2): pontos ou cashback.

---

## 11. Catálogo público / vitrine

### Páginas

- **Home**: banner do drop atual, lançamentos, mais vendidos, categorias em destaque.
- **Listagem por categoria / coleção** com filtros e ordenação.
- **Página do produto**: galeria por cor, seletor de cor e tamanho, disponibilidade, tabela de medidas, composição, gramatura, produtos relacionados, "compre o look".
- **Página do drop**: contagem regressiva até o lançamento, lookbook.
- **Busca** com tolerância a erro de digitação.
- Carrinho e checkout (ou botão "Pedir no WhatsApp").
- Páginas institucionais: sobre, trocas e devoluções, frete, contato, política de privacidade.

### Filtros e ordenação

- Filtros: categoria, tamanho, cor, preço, modelagem, marca, coleção, em promoção, **somente disponíveis**.
- Ordenar: lançamentos, mais vendidos, menor/maior preço.

### Regras de exibição

- Mostrar **apenas estoque disponível** (físico − reservado).
- Tamanho sem estoque aparece **riscado/desabilitado**, não some (o cliente precisa ver a grade).
- Produto com todas as variações zeradas: selo **"Esgotado"** + "avise-me", ou ocultar (configurável).
- Selos automáticos: "Novo" (até X dias do cadastro), "Últimas unidades" (abaixo de N), "Promo", "Edição limitada".
- **Nunca exibir custo**, estoque exato (opcional mostrar "restam 2") ou dados internos.

### Requisitos técnicos da vitrine

- Mobile first (a maior parte do público vem do Instagram/celular).
- Imagens otimizadas (WebP/AVIF, tamanhos responsivos, lazy loading, CDN).
- SEO: URLs amigáveis, meta tags, dados estruturados `Product` (schema.org), sitemap.
- Open Graph para o link ficar bonito no WhatsApp e Instagram.
- Integração com Pixel/Analytics para medir conversão.
- Alta carga em lançamento de drop: cache, fila de checkout e controle de concorrência no estoque.

---

## 12. Financeiro

### Caixa (loja física)

- Abertura com valor inicial, **sangria** (retirada), **suprimento** (reforço), fechamento.
- Conferência por forma de pagamento: esperado × contado, com diferença registrada.
- Um caixa por operador/terminal.

### Contas a receber

- Vendas no cartão com **previsão de recebimento** e desconto da taxa da adquirente (crédito D+30, parcelado em N vezes, antecipação).
- Crediário (se houver): parcelas, vencimentos, inadimplência.

### Contas a pagar

- Fornecedores (geradas pelas compras), aluguel, folha, energia, internet, marketing, sistema.
- Vencimento, status (aberta, paga, vencida), recorrência, anexo de boleto/nota.

### Fluxo de caixa e resultado

- Fluxo diário/mensal (realizado + previsto).
- DRE simplificado: receita bruta − devoluções − impostos − CMV (custo das mercadorias vendidas) − despesas = lucro.
- Plano de contas / categorias de despesa configuráveis.

---

## 13. Fiscal

> Valide toda a parte fiscal com o **contador da loja** — regime tributário, alíquotas e obrigações variam por estado e enquadramento.

- Emissão de **NFC-e** (venda ao consumidor no balcão) e **NF-e** (vendas online, atacado, devoluções a fornecedor).
- Normalmente feita via integração com um emissor/API fiscal em vez de implementação direta com a SEFAZ.
- Dados necessários no produto: **NCM**, origem da mercadoria, CEST (quando aplicável), unidade.
- Dados na operação: CFOP, regime tributário (Simples Nacional é comum em lojas desse porte), CSOSN/CST.
- Certificado digital A1 da empresa.
- Cancelamento e carta de correção dentro dos prazos legais.
- Armazenamento dos XML pelo prazo legal.
- Nota de devolução para trocas/devoluções quando exigido.

---

## 14. Etiquetas e código de barras

- Gerar código de barras para cada SKU (EAN-13 com prefixo GS1 se for vender em marketplace/atacado; caso contrário, código interno Code128).
- Impressão de etiquetas em lote (após recebimento de compra) em impressora térmica (ex.: Zebra, Elgin, Argox).
- Conteúdo da etiqueta: nome curto, cor, tamanho, preço, SKU e código de barras.
- Reimpressão individual e etiqueta de promoção.
- Leitor de código de barras no PDV, no recebimento e no inventário (inclusive câmera do celular).

---

## 15. Relatórios e dashboard

### Dashboard inicial

- Vendas de hoje / semana / mês (valor, nº de vendas, ticket médio, peças por atendimento).
- Comparativo com período anterior.
- Top 10 produtos e categorias.
- Alertas: estoque baixo, pedidos aguardando separação, contas vencendo, reservas expirando.

### Relatórios essenciais

| Área | Relatórios |
|---|---|
| Vendas | Por período, vendedor, canal, forma de pagamento, categoria, coleção, hora do dia |
| Produtos | Mais vendidos, menos vendidos, **giro de estoque**, **sell-through por drop** (% vendido do lote), margem por produto |
| Estoque | Posição atual (quantidade e valor a custo/venda), abaixo do mínimo, parados há X dias, curva ABC, ruptura por tamanho |
| Trocas | Taxa de troca por produto/categoria e por motivo |
| Clientes | Novos × recorrentes, ranking, inativos, aniversariantes |
| Financeiro | Fluxo de caixa, DRE, contas a pagar/receber, taxas de cartão |
| Equipe | Comissões, metas × realizado |

- Exportação em CSV/Excel e PDF.
- Filtros por período, loja, vendedor e canal em todos os relatórios.

---

## 16. Integrações

| Integração | Uso | Prioridade |
|---|---|---|
| Gateway de pagamento (Pix, cartão, boleto) | Checkout online e conciliação | Alta |
| Maquininha / TEF | PDV integrado | Média |
| WhatsApp (link `wa.me` → depois API oficial) | Pedidos, notificações, "avise-me" | Alta |
| Cálculo de frete (Correios / Melhor Envio / similares) | Checkout | Alta (se vender online) |
| Emissor fiscal (API de NF-e/NFC-e) | Notas | Média |
| Instagram / Facebook Shopping (feed de produtos) | Marcar produtos nos posts | Média |
| Google Analytics / Meta Pixel | Conversão e anúncios | Média |
| Marketplaces | Sincronizar estoque e pedidos | Baixa (fase 3) |
| E-mail transacional | Confirmação de pedido, recuperação de senha | Alta |
| Armazenamento de imagens (S3/R2 + CDN) | Fotos dos produtos | Alta |

---

## 17. Modelo de dados (entidades principais)

```
usuarios ─┬─ perfis ── permissoes
          └─ logs_auditoria

categorias (auto-relacionamento: parent_id)
marcas
colecoes (drops)
grades ── grade_tamanhos
cores
atributos ── atributo_valores

produtos ─┬─ produto_categorias (N:N)
          ├─ produto_imagens (por cor)
          ├─ produto_atributos (N:N com atributo_valores)
          └─ variacoes (SKU) ── estoque_saldos (por local)
                              └─ estoque_movimentacoes

locais_estoque
inventarios ── inventario_itens

fornecedores
pedidos_compra ── pedidos_compra_itens
ordens_producao (opcional)

clientes ─┬─ enderecos
          ├─ creditos / vales_troca
          └─ avise_me (cliente × variacao)

vendas (PDV e online) ─┬─ venda_itens
                       ├─ venda_pagamentos
                       ├─ venda_status_historico
                       └─ entregas
trocas_devolucoes ── troca_itens

promocoes ── promocao_regras / alvos
cupons ── cupom_usos

caixas ── caixa_movimentos (abertura, sangria, suprimento, fechamento)
contas_pagar
contas_receber
categorias_financeiras

notas_fiscais (opcional, fase 2)
configuracoes (dados da loja, limites, regras)
```

### Chaves e cuidados de modelagem

- `variacoes.sku` e `variacoes.codigo_barras` **únicos**.
- Unicidade de `(produto_id, cor_id, tamanho_id)`.
- **Gravar preço, custo e desconto em `venda_itens` no momento da venda** (snapshot) — mudanças futuras de preço não podem alterar vendas antigas.
- Valores monetários em **centavos (inteiro)** ou `DECIMAL(12,2)`; nunca `float`.
- Soft delete (`deleted_at`) em produtos, clientes e usuários.
- `created_at`, `updated_at`, `created_by` em todas as tabelas operacionais.
- Saldo de estoque pode ser materializado em `estoque_saldos` para performance, mas atualizado **na mesma transação** da movimentação.

---

## 18. Regras de negócio essenciais

1. Estoque só muda por movimentação registrada; nunca por edição direta do número.
2. Venda, cancelamento, troca e recebimento de compra **atualizam o estoque na mesma transação** do banco.
3. Use **bloqueio/controle de concorrência** (ex.: `SELECT ... FOR UPDATE` ou update condicional `WHERE disponivel >= qtd`) para que duas pessoas não comprem a última peça ao mesmo tempo — essencial em drop.
4. Estoque negativo bloqueado por padrão.
5. Pedido online reserva estoque; reserva expira se o pagamento não for confirmado no prazo.
6. Desconto acima do limite do perfil exige autorização de gerente (registrada).
7. Vendas não são excluídas, apenas canceladas com motivo e usuário.
8. Custo e margem visíveis só para perfis autorizados — inclusive na API (não basta esconder no front).
9. Preço e custo são registrados na venda no momento em que ela acontece.
10. Produto de drop não aparece (ou aparece como "em breve") antes da data/hora de lançamento; respeitar limite por cliente.
11. Troca devolve ao estoque somente se a peça estiver em condição de venda; senão, vai para avaria.
12. Ajustes de inventário, perdas e cancelamentos exigem motivo e geram log de auditoria.
13. Toda alteração de preço fica no histórico (útil para provar "de/por" honesto em promoções).

---

## 19. Requisitos não funcionais

- **Segurança**: senhas com hash (bcrypt/argon2), HTTPS, validação no back-end, proteção contra SQL injection/XSS/CSRF, rate limiting no login e no checkout, permissões checadas no servidor.
- **LGPD**: coletar só o necessário, consentimento para marketing, política de privacidade, possibilidade de o cliente pedir exclusão/exportação dos dados, acesso a dados pessoais restrito por perfil.
- **Backup** automático diário do banco + imagens, com teste de restauração.
- **Auditoria** de ações sensíveis.
- **Performance**: catálogo carregando rápido no 4G; cache de listagens; paginação; índices em SKU, código de barras, nome e categoria.
- **Escalabilidade em drop**: aguentar picos de acesso no horário de lançamento.
- **Responsividade**: painel utilizável no celular (consultar estoque, receber mercadoria).
- **Disponibilidade**: monitoramento e alertas de erro (ex.: Sentry) e uptime.
- **Ambientes**: desenvolvimento, homologação e produção separados.
- **Testes** automatizados nas regras críticas: cálculo de estoque, totais de venda, promoções, trocas.

---

## 20. Roadmap sugerido (MVP → completo)

### Fase 1 — MVP (loja funcionando)

- [ ] Login, perfis e permissões básicas
- [ ] Categorias, marcas, cores, grades
- [ ] Produtos com variações (geração automática da grade) e imagens
- [ ] Estoque por movimentação: entrada, venda, ajuste, kardex
- [ ] PDV simples com múltiplas formas de pagamento
- [ ] Cadastro de clientes
- [ ] Catálogo público com filtros, disponibilidade e pedido via WhatsApp
- [ ] Etiquetas com código de barras
- [ ] Dashboard e relatório de vendas e estoque

### Fase 2 — Operação completa

- [ ] Fornecedores e pedidos de compra com lançamento em grade
- [ ] Trocas, devoluções e vale-troca
- [ ] Caixa (abertura, sangria, fechamento) e financeiro básico
- [ ] Promoções e cupons
- [ ] Coleções/drops com data de lançamento e limite por cliente
- [ ] Checkout online com pagamento e frete
- [ ] Comissões
- [ ] Emissão fiscal (NFC-e / NF-e)
- [ ] Inventário com contagem por leitor/celular

### Fase 3 — Crescimento

- [ ] "Avise-me" e lista de espera automatizada
- [ ] Fidelidade / cashback
- [ ] Integração com Instagram Shopping e marketplaces
- [ ] Multiloja / multiestoque com transferências
- [ ] Ordens de produção para marca própria
- [ ] Relatórios avançados (curva ABC, sell-through por drop, previsão de reposição)
- [ ] PDV offline

---

## 21. Checklist final

**Catálogo**
- [ ] Produto pai + variações cor × tamanho com SKU e código de barras únicos
- [ ] Categorias hierárquicas, coleções/drops, marcas e atributos filtráveis
- [ ] Tabela de medidas, composição, gramatura e modelagem

**Estoque**
- [ ] Movimentações tipadas com usuário e motivo
- [ ] Físico, reservado e disponível
- [ ] Estoque mínimo, curva de grade, inventário e custo médio

**Vendas**
- [ ] PDV com leitor, múltiplos pagamentos e limite de desconto
- [ ] Pedidos online com status, reserva e notificações
- [ ] Trocas, devoluções e vale-troca

**Gestão**
- [ ] Clientes com histórico e tamanhos preferidos
- [ ] Fornecedores e compras
- [ ] Caixa, contas a pagar/receber e DRE simples
- [ ] Relatórios e dashboard

**Vitrine**
- [ ] Mobile first, filtros, disponibilidade em tempo real
- [ ] Página de drop com contagem regressiva
- [ ] SEO, Open Graph e analytics

**Base técnica**
- [ ] Permissões checadas no back-end
- [ ] Transações e controle de concorrência no estoque
- [ ] Snapshot de preço/custo na venda
- [ ] Auditoria, backup, LGPD e monitoramento
