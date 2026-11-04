-- =====================================================================
--  ROTA 44 - esquema do banco (Supabase / PostgreSQL)
--
--  Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run.
--  Pode rodar de novo sem medo: tudo é idempotente e NADA é apagado.
--  Depois rode o supabase/seed_base.sql (categorias, cores, grades...) e o
--  supabase/primeiro_admin.sql (quem é o dono). Passo a passo no README.
--
--  Regras do projeto:
--    - estoque e dinheiro só mudam por FUNÇÃO (RPC), numa transação, com trava
--      de linha em ordem de id. O navegador nunca grava saldo direto;
--    - estoque é a soma de movimentações: toda mudança deixa rastro em
--      stock_movements (tipo, quantidade, quem, quando e por quê);
--    - custo e margem moram em tabelas separadas (variant_costs,
--      sale_item_costs), que o vendedor não consegue ler nem pela API;
--    - preço e custo são copiados para a venda na hora em que ela acontece;
--    - venda não se apaga: cancela, com motivo e usuário;
--    - catálogo público só fala com public_catalog() e catalog_request():
--      nunca lê tabela, nunca vê custo nem saldo exato;
--    - quem não está em store_members não enxerga nenhuma linha.
--
--  Versão do banco: 3 (whoami().schema_version). Subiu? Suba junto o
--  APP.schemaVersion em assets/js/config.js.
-- =====================================================================

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- =====================================================================
--  EQUIPE E PERMISSÕES
-- =====================================================================

create table if not exists public.store_members (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  nome            text not null check (length(btrim(nome)) between 1 and 80),
  role            text not null default 'vendedor' check (role in ('admin', 'gerente', 'vendedor', 'estoquista')),
  active          boolean not null default true,
  commission_pct  numeric(5,2) not null default 0 check (commission_pct between 0 and 100),
  discount_limit  numeric(5,2) check (discount_limit is null or discount_limit between 0 and 100),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Senha do gerente para liberar desconto. Ninguém lê esta tabela: só funções.
create table if not exists public.member_secrets (
  user_id    uuid primary key references public.store_members (user_id) on delete cascade,
  pin_salt   text not null,
  pin_hash   text not null,
  failed     int not null default 0,
  failed_at  timestamptz
);

/*
 * SECURITY DEFINER: se a política de store_members consultasse a própria
 * tabela, o Postgres entraria em recursão. Toda permissão passa por aqui.
 * Login desativado volta null: é como se não existisse.
 */
create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.store_members where user_id = auth.uid() and active;
$$;

create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.my_role() is not null;
$$;

create or replace function public.has_role(variadic roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.my_role() = any (roles), false);
$$;

/* Custo: quem precisa lançar entrada também vê. Margem e lucro, só admin e gerente. */
create or replace function public.can_see_cost()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('admin', 'gerente', 'estoquista');
$$;

create or replace function public.can_see_margin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('admin', 'gerente');
$$;

/* Primeira linha de toda função que grava. */
create or replace function public.require_role(variadic roles text[])
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_member() then
    raise exception 'Acesso negado: este login não está autorizado na loja.' using errcode = '42501';
  end if;
  if not (public.my_role() = any (roles)) then
    raise exception 'Seu perfil não tem permissão para isso. Peça a um gerente.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.require_member()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_member() then
    raise exception 'Acesso negado: este login não está autorizado na loja.' using errcode = '42501';
  end if;
end;
$$;

drop trigger if exists store_members_touch on public.store_members;
create trigger store_members_touch before update on public.store_members
  for each row execute function public.touch_updated_at();

-- =====================================================================
--  CONFIGURAÇÕES DA LOJA
-- =====================================================================

create table if not exists public.store_settings (
  id                      int primary key default 1 check (id = 1),
  store_name              text not null default 'Rota 44',
  tagline                 text not null default 'Streetwear pra quem vive a rua.',
  whatsapp                text not null default '',
  instagram               text not null default '',
  tiktok                  text not null default '',
  email                   text not null default '',
  address                 text not null default '',
  hours                   text not null default '',
  pix_key                 text not null default '',
  pix_name                text not null default '',
  about                   text not null default '',
  exchange_policy         text not null default '',
  shipping_info           text not null default '',
  privacy_policy          text not null default '',
  announcement            text not null default '',
  hero_title              text not null default '',
  hero_subtitle           text not null default '',
  hero_image              text not null default '',
  receipt_footer          text not null default 'Obrigado pela preferência. Tamo junto!',
  catalog_open            boolean not null default true,
  sold_out_behavior       text not null default 'mostrar' check (sold_out_behavior in ('mostrar', 'ocultar')),
  show_low_count          boolean not null default false,
  low_stock_threshold     int not null default 3 check (low_stock_threshold >= 0),
  new_days                int not null default 30 check (new_days >= 0),
  pix_discount_pct        numeric(5,2) not null default 0 check (pix_discount_pct between 0 and 100),
  max_installments        int not null default 3 check (max_installments between 1 and 24),
  free_shipping_over      numeric(12,2) not null default 0 check (free_shipping_over >= 0),
  block_negative_stock    boolean not null default true,
  reservation_hours       int not null default 24 check (reservation_hours between 1 and 720),
  require_cash_session    boolean not null default true,
  discount_limit_vendedor numeric(5,2) not null default 10 check (discount_limit_vendedor between 0 and 100),
  discount_limit_gerente  numeric(5,2) not null default 25 check (discount_limit_gerente between 0 and 100),
  fee_debit_pct           numeric(5,2) not null default 0 check (fee_debit_pct between 0 and 100),
  fee_credit_pct          numeric(5,2) not null default 0 check (fee_credit_pct between 0 and 100),
  fee_credit_inst_pct     numeric(5,2) not null default 0 check (fee_credit_inst_pct between 0 and 100),
  debit_days              int not null default 1 check (debit_days >= 0),
  credit_days             int not null default 30 check (credit_days >= 0),
  exchange_days           int not null default 30 check (exchange_days >= 0),
  credit_valid_days       int not null default 180 check (credit_valid_days >= 0),
  default_markup_pct      numeric(7,2) not null default 100 check (default_markup_pct >= 0),
  round_prices_to         numeric(4,2) not null default 0.90 check (round_prices_to between 0 and 0.99),
  updated_at              timestamptz not null default now()
);

insert into public.store_settings (id) values (1) on conflict (id) do nothing;

-- textos de fábrica que mudaram: só troca se a loja não tiver mexido neles
update public.store_settings set tagline = 'Streetwear pra quem vive a rua.' where tagline = 'Streetwear das ruas: rap, skate e trap.';
update public.store_settings set exchange_policy = replace(exchange_policy, ' Confirme as regras com o contador/advogado da loja.', '')
 where exchange_policy like '%Confirme as regras com o contador/advogado da loja.%';

drop trigger if exists store_settings_touch on public.store_settings;
create trigger store_settings_touch before update on public.store_settings
  for each row execute function public.touch_updated_at();

-- =====================================================================
--  CADASTROS BASE
-- =====================================================================

create table if not exists public.size_charts (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (length(btrim(name)) between 1 and 80),
  columns    jsonb not null default '[]'::jsonb check (jsonb_typeof(columns) = 'array'),
  rows       jsonb not null default '[]'::jsonb check (jsonb_typeof(rows) = 'array'),
  notes      text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.size_grids (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (length(btrim(name)) between 1 and 60),
  sort       int not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.sizes (
  id      uuid primary key default gen_random_uuid(),
  grid_id uuid not null references public.size_grids (id) on delete cascade,
  label   text not null check (length(btrim(label)) between 1 and 12),
  sort    int not null default 0,
  unique (grid_id, label)
);

create table if not exists public.colors (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (length(btrim(name)) between 1 and 40),
  hex        text not null default '#888888' check (hex ~* '^#[0-9a-f]{6}$'),
  code       text not null unique check (code ~ '^[A-Z0-9]{2,4}$'),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.brands (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (length(btrim(name)) between 1 and 60),
  is_own     boolean not null default false,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id              uuid primary key default gen_random_uuid(),
  parent_id       uuid references public.categories (id) on delete restrict,
  name            text not null check (length(btrim(name)) between 1 and 60),
  slug            text not null unique check (slug ~ '^[a-z0-9-]{1,80}$'),
  code            text not null default 'GER' check (code ~ '^[A-Z0-9]{2,4}$'),
  description     text not null default '',
  image_url       text not null default '',
  sort            int not null default 0,
  visible         boolean not null default true,
  active          boolean not null default true,
  size_chart_id   uuid references public.size_charts (id) on delete set null,
  default_grid_id uuid references public.size_grids (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists categories_parent_idx on public.categories (parent_id);
drop trigger if exists categories_touch on public.categories;
create trigger categories_touch before update on public.categories
  for each row execute function public.touch_updated_at();

/* Drops: data de lançamento, edição limitada, limite por cliente, collab. */
create table if not exists public.collections (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (length(btrim(name)) between 1 and 80),
  slug               text not null unique check (slug ~ '^[a-z0-9-]{1,90}$'),
  description        text not null default '',
  banner_url         text not null default '',
  lookbook           jsonb not null default '[]'::jsonb check (jsonb_typeof(lookbook) = 'array'),
  launch_at          timestamptz,
  ends_at            timestamptz,
  limited            boolean not null default false,
  total_qty          int check (total_qty is null or total_qty >= 0),
  limit_per_customer int check (limit_per_customer is null or limit_per_customer >= 1),
  collab             text not null default '',
  visible            boolean not null default true,
  active             boolean not null default true,
  sort               int not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
drop trigger if exists collections_touch on public.collections;
create trigger collections_touch before update on public.collections
  for each row execute function public.touch_updated_at();

create table if not exists public.suppliers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(btrim(name)) between 1 and 120),
  doc           text not null default '',
  kind          text not null default 'fabricante' check (kind in ('fabricante', 'confeccao', 'estamparia', 'bordado', 'atacadista', 'revenda', 'outro')),
  contact       text not null default '',
  whatsapp      text not null default '',
  email         text not null default '',
  address       text not null default '',
  lead_days     int check (lead_days is null or lead_days >= 0),
  payment_terms text not null default '',
  rating        int check (rating is null or rating between 1 and 5),
  notes         text not null default '',
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
drop trigger if exists suppliers_touch on public.suppliers;
create trigger suppliers_touch before update on public.suppliers
  for each row execute function public.touch_updated_at();

create table if not exists public.customers (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (length(btrim(name)) between 1 and 120),
  cpf               text not null default '',
  phone             text not null default '',
  email             text not null default '',
  birthday          date,
  instagram         text not null default '',
  cep               text not null default '',
  address           text not null default '',
  city              text not null default '',
  size_top          text not null default '',
  size_bottom       text not null default '',
  size_shoes        text not null default '',
  marketing_consent boolean not null default false,
  consent_at        timestamptz,
  consent_channel   text not null default '',
  notes             text not null default '',
  deleted_at        timestamptz,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists customers_phone_idx on public.customers (phone);
create index if not exists customers_name_idx on public.customers (name);
drop trigger if exists customers_touch on public.customers;
create trigger customers_touch before update on public.customers
  for each row execute function public.touch_updated_at();

-- =====================================================================
--  PRODUTOS: o produto é o modelo; a variação é a combinação cor × tamanho
-- =====================================================================

create table if not exists public.products (
  id               uuid primary key default gen_random_uuid(),
  seq              int generated by default as identity unique,
  name             text not null check (length(btrim(name)) between 1 and 120),
  slug             text not null unique check (slug ~ '^[a-z0-9-]{1,140}$'),
  short_desc       text not null default '' check (length(short_desc) <= 300),
  description      text not null default '',
  category_id      uuid references public.categories (id) on delete set null,
  brand_id         uuid references public.brands (id) on delete set null,
  collection_id    uuid references public.collections (id) on delete set null,
  grid_id          uuid references public.size_grids (id) on delete set null,
  size_chart_id    uuid references public.size_charts (id) on delete set null,
  gender           text not null default 'unissex' check (gender in ('masculino', 'feminino', 'unissex', 'infantil')),
  fit              text not null default '' check (length(fit) <= 30),
  fabric           text not null default '' check (length(fabric) <= 120),
  gsm              int check (gsm is null or gsm between 1 and 2000),
  print_type       text not null default '' check (length(print_type) <= 60),
  wash_care        text not null default '',
  tags             text[] not null default '{}',
  status           text not null default 'ativo' check (status in ('rascunho', 'ativo', 'inativo', 'arquivado')),
  catalog_visible  boolean not null default true,
  featured         boolean not null default false,
  base_price       numeric(12,2) not null default 0 check (base_price >= 0),
  promo_price      numeric(12,2) check (promo_price is null or promo_price >= 0),
  promo_from       timestamptz,
  promo_to         timestamptz,
  cover_url        text not null default '',
  seo_title        text not null default '' check (length(seo_title) <= 120),
  seo_desc         text not null default '' check (length(seo_desc) <= 300),
  ncm              text not null default '' check (length(ncm) <= 12),
  origin           text not null default '0' check (length(origin) <= 2),
  cest             text not null default '' check (length(cest) <= 12),
  weight_g         int check (weight_g is null or weight_g >= 0),
  dimensions       text not null default '' check (length(dimensions) <= 40),
  deleted_at       timestamptz,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists products_category_idx on public.products (category_id);
create index if not exists products_collection_idx on public.products (collection_id);
create index if not exists products_name_idx on public.products (name);
drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();

create table if not exists public.product_categories (
  product_id  uuid not null references public.products (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  primary key (product_id, category_id)
);

create table if not exists public.product_images (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  color_id   uuid references public.colors (id) on delete set null,
  url        text not null check (length(url) between 1 and 600),
  sort       int not null default 0
);
create index if not exists product_images_product_idx on public.product_images (product_id, sort);

create table if not exists public.product_variants (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete cascade,
  color_id    uuid not null references public.colors (id) on delete restrict,
  size_id     uuid not null references public.sizes (id) on delete restrict,
  sku         text not null unique check (length(btrim(sku)) between 1 and 60),
  barcode     text not null unique check (length(btrim(barcode)) between 1 and 40),
  price       numeric(12,2) check (price is null or price >= 0),
  promo_price numeric(12,2) check (promo_price is null or promo_price >= 0),
  stock_min   int not null default 1 check (stock_min >= 0),
  on_hand     int not null default 0,
  reserved    int not null default 0 check (reserved >= 0),
  damaged     int not null default 0 check (damaged >= 0),
  available   int generated always as (on_hand - reserved) stored,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (product_id, color_id, size_id)
);
create index if not exists product_variants_product_idx on public.product_variants (product_id);
drop trigger if exists product_variants_touch on public.product_variants;
create trigger product_variants_touch before update on public.product_variants
  for each row execute function public.touch_updated_at();

/* Vendedor não lê esta tabela: é assim que o custo fica fora do alcance dele. */
create table if not exists public.variant_costs (
  variant_id uuid primary key references public.product_variants (id) on delete cascade,
  avg_cost   numeric(12,4) not null default 0 check (avg_cost >= 0),
  last_cost  numeric(12,2) not null default 0 check (last_cost >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.stock_movements (
  id             bigint generated always as identity primary key,
  variant_id     uuid not null references public.product_variants (id) on delete cascade,
  type           text not null check (type in (
    'estoque_inicial', 'entrada_compra', 'entrada_producao', 'venda', 'cancelamento_venda', 'devolucao_cliente',
    'devolucao_fornecedor', 'ajuste', 'inventario', 'perda', 'avaria', 'brinde', 'reserva', 'libera_reserva')),
  qty            int not null default 0,
  reserved_delta int not null default 0,
  balance_after  int not null,
  unit_cost      numeric(12,4),
  reason         text not null default '' check (length(reason) <= 300),
  ref_type       text,
  ref_id         uuid,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now()
);
create index if not exists stock_movements_variant_idx on public.stock_movements (variant_id, id desc);
create index if not exists stock_movements_created_idx on public.stock_movements (created_at desc);

/* "De/por" honesto: toda mudança de preço fica guardada. */
create table if not exists public.price_history (
  id          bigint generated always as identity primary key,
  product_id  uuid references public.products (id) on delete cascade,
  variant_id  uuid references public.product_variants (id) on delete cascade,
  field       text not null,
  old_value   numeric(12,2),
  new_value   numeric(12,2),
  changed_by  uuid default auth.uid(),
  changed_at  timestamptz not null default now()
);
create index if not exists price_history_product_idx on public.price_history (product_id, changed_at desc);

create or replace function public._price_history_products()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.base_price is distinct from old.base_price then
    insert into public.price_history (product_id, field, old_value, new_value) values (new.id, 'base_price', old.base_price, new.base_price);
  end if;
  if new.promo_price is distinct from old.promo_price then
    insert into public.price_history (product_id, field, old_value, new_value) values (new.id, 'promo_price', old.promo_price, new.promo_price);
  end if;
  return null;
end;
$$;
drop trigger if exists products_price_history on public.products;
create trigger products_price_history after update on public.products
  for each row execute function public._price_history_products();

create or replace function public._price_history_variants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.price is distinct from old.price then
    insert into public.price_history (product_id, variant_id, field, old_value, new_value) values (new.product_id, new.id, 'price', old.price, new.price);
  end if;
  if new.promo_price is distinct from old.promo_price then
    insert into public.price_history (product_id, variant_id, field, old_value, new_value) values (new.product_id, new.id, 'promo_price', old.promo_price, new.promo_price);
  end if;
  return null;
end;
$$;
drop trigger if exists variants_price_history on public.product_variants;
create trigger variants_price_history after update on public.product_variants
  for each row execute function public._price_history_variants();

-- =====================================================================
--  PROMOÇÕES E CUPONS
-- =====================================================================

create table if not exists public.promotions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 80),
  percent     numeric(5,2) not null check (percent > 0 and percent <= 90),
  target_type text not null default 'tudo' check (target_type in ('tudo', 'categoria', 'colecao', 'produto')),
  target_id   uuid,
  starts_at   timestamptz,
  ends_at     timestamptz,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.coupons (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique check (code ~ '^[A-Z0-9_-]{3,24}$'),
  kind              text not null default 'percent' check (kind in ('percent', 'valor')),
  value             numeric(12,2) not null check (value > 0),
  min_total         numeric(12,2) not null default 0 check (min_total >= 0),
  starts_at         timestamptz,
  ends_at           timestamptz,
  max_uses          int check (max_uses is null or max_uses >= 1),
  max_per_customer  int check (max_per_customer is null or max_per_customer >= 1),
  active            boolean not null default true,
  notes             text not null default '',
  created_at        timestamptz not null default now()
);

-- =====================================================================
--  CLIENTE: VALE-TROCA
-- =====================================================================

create table if not exists public.store_credits (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  customer_id uuid references public.customers (id) on delete set null,
  amount      numeric(12,2) not null check (amount > 0),
  balance     numeric(12,2) not null check (balance >= 0),
  expires_on  date,
  notes       text not null default '',
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

-- =====================================================================
--  CAIXA
-- =====================================================================

create table if not exists public.cash_sessions (
  id             uuid primary key default gen_random_uuid(),
  number         int generated by default as identity unique,
  opened_by      uuid not null default auth.uid(),
  opened_at      timestamptz not null default now(),
  opening_amount numeric(12,2) not null default 0 check (opening_amount >= 0),
  closed_at      timestamptz,
  closed_by      uuid,
  counted        jsonb,
  expected       jsonb,
  difference     numeric(12,2),
  notes          text not null default ''
);
-- um caixa aberto por operador
create unique index if not exists cash_sessions_one_open on public.cash_sessions (opened_by) where closed_at is null;

create table if not exists public.cash_movements (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.cash_sessions (id) on delete cascade,
  type       text not null check (type in ('suprimento', 'sangria')),
  amount     numeric(12,2) not null check (amount > 0),
  reason     text not null default '' check (length(reason) <= 200),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists cash_movements_session_idx on public.cash_movements (session_id);

-- =====================================================================
--  VENDAS (balcão e online)
-- =====================================================================

create table if not exists public.catalog_requests (
  id             uuid primary key default gen_random_uuid(),
  number         int generated by default as identity unique,
  created_at     timestamptz not null default now(),
  customer_name  text not null check (length(btrim(customer_name)) between 1 and 80),
  customer_phone text check (customer_phone is null or length(customer_phone) <= 30),
  delivery_pref  text check (delivery_pref is null or length(delivery_pref) <= 40),
  notes          text check (notes is null or length(notes) <= 500),
  coupon_code    text check (coupon_code is null or length(coupon_code) <= 24),
  items          jsonb not null check (jsonb_typeof(items) = 'array' and pg_column_size(items) <= 20000),
  total          numeric(12,2) not null default 0,
  discount       numeric(12,2) not null default 0,
  status         text not null default 'novo' check (status in ('novo', 'convertido', 'descartado')),
  sale_id        uuid,
  client_key     text check (client_key is null or length(client_key) <= 40)
);
create index if not exists catalog_requests_created_idx on public.catalog_requests (created_at desc);
create index if not exists catalog_requests_key_idx on public.catalog_requests (client_key, created_at);

create table if not exists public.sales (
  id              uuid primary key default gen_random_uuid(),
  number          int generated by default as identity unique,
  client_ref      uuid unique,
  channel         text not null default 'balcao' check (channel in ('balcao', 'whatsapp', 'instagram', 'site', 'marketplace', 'outro')),
  status          text not null default 'entregue' check (status in (
    'aguardando_pagamento', 'pago', 'em_separacao', 'enviado', 'pronto_retirada', 'entregue', 'cancelado')),
  stock_state     text not null default 'none' check (stock_state in ('none', 'reserved', 'out')),
  sale_date       date not null,
  customer_id     uuid references public.customers (id) on delete set null,
  customer_name   text not null default '',
  customer_phone  text not null default '',
  seller_id       uuid default auth.uid(),
  items_total     numeric(12,2) not null default 0,
  items_discount  numeric(12,2) not null default 0,
  discount_value  numeric(12,2) not null default 0 check (discount_value >= 0),
  coupon_id       uuid references public.coupons (id) on delete set null,
  coupon_discount numeric(12,2) not null default 0,
  pix_discount    numeric(12,2) not null default 0,
  shipping_fee    numeric(12,2) not null default 0 check (shipping_fee >= 0),
  total           numeric(12,2) not null default 0,
  paid_total      numeric(12,2) not null default 0,
  returned_total  numeric(12,2) not null default 0,
  balance         numeric(12,2) generated always as (total - returned_total - paid_total) stored,
  delivery_method text not null default 'balcao' check (delivery_method in ('balcao', 'retirada', 'motoboy', 'correios', 'transportadora')),
  tracking_code   text not null default '' check (length(tracking_code) <= 60),
  address         text not null default '' check (length(address) <= 300),
  notes           text not null default '' check (length(notes) <= 800),
  reserved_until  timestamptz,
  approved_by     uuid,
  request_id      uuid references public.catalog_requests (id) on delete set null,
  cancel_reason   text,
  canceled_at     timestamptz,
  canceled_by     uuid,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists sales_date_idx on public.sales (sale_date desc);
create index if not exists sales_status_idx on public.sales (status);
create index if not exists sales_customer_idx on public.sales (customer_id);
create index if not exists sales_seller_idx on public.sales (seller_id);
drop trigger if exists sales_touch on public.sales;
create trigger sales_touch before update on public.sales
  for each row execute function public.touch_updated_at();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'catalog_requests_sale_fk') then
    alter table public.catalog_requests add constraint catalog_requests_sale_fk
      foreign key (sale_id) references public.sales (id) on delete set null;
  end if;
end;
$$;

create table if not exists public.sale_items (
  id             uuid primary key default gen_random_uuid(),
  sale_id        uuid not null references public.sales (id) on delete cascade,
  variant_id     uuid references public.product_variants (id) on delete set null,
  product_id     uuid references public.products (id) on delete set null,
  product_name   text not null,
  color_name     text not null default '',
  size_label     text not null default '',
  sku            text not null default '',
  qty            int not null check (qty > 0),
  list_price     numeric(12,2) not null default 0,
  unit_price     numeric(12,2) not null check (unit_price >= 0),
  discount_value numeric(12,2) not null default 0 check (discount_value >= 0),
  total          numeric(12,2) generated always as (qty * unit_price - discount_value) stored,
  returned_qty   int not null default 0 check (returned_qty >= 0),
  sort           int not null default 0,
  sale_date      date not null
);
create index if not exists sale_items_sale_idx on public.sale_items (sale_id);
create index if not exists sale_items_date_idx on public.sale_items (sale_date);
create index if not exists sale_items_variant_idx on public.sale_items (variant_id);
create index if not exists sale_items_product_idx on public.sale_items (product_id);

/* Custo da venda: separado do item pelo mesmo motivo do variant_costs. */
create table if not exists public.sale_item_costs (
  sale_item_id uuid primary key references public.sale_items (id) on delete cascade,
  unit_cost    numeric(12,4) not null default 0,
  sale_date    date not null
);
create index if not exists sale_item_costs_date_idx on public.sale_item_costs (sale_date);

create table if not exists public.sale_payments (
  id              uuid primary key default gen_random_uuid(),
  sale_id         uuid not null references public.sales (id) on delete cascade,
  method          text not null check (method in ('dinheiro', 'pix', 'debito', 'credito', 'vale_troca', 'crediario', 'outro')),
  amount          numeric(12,2) not null check (amount <> 0),
  installments    int not null default 1 check (installments between 1 and 24),
  fee_amount      numeric(12,2) not null default 0,
  expected_on     date,
  paid_on         date not null,
  tendered        numeric(12,2),
  change_given    numeric(12,2),
  credit_id       uuid references public.store_credits (id) on delete set null,
  cash_session_id uuid references public.cash_sessions (id) on delete set null,
  reverses_id     uuid references public.sale_payments (id) on delete set null,
  notes           text not null default '' check (length(notes) <= 200),
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now()
);
create index if not exists sale_payments_sale_idx on public.sale_payments (sale_id);
create index if not exists sale_payments_paid_idx on public.sale_payments (paid_on);
create index if not exists sale_payments_session_idx on public.sale_payments (cash_session_id);

create table if not exists public.sale_status_history (
  id          bigint generated always as identity primary key,
  sale_id     uuid not null references public.sales (id) on delete cascade,
  from_status text,
  to_status   text not null,
  note        text not null default '',
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists sale_status_history_sale_idx on public.sale_status_history (sale_id, id);

create table if not exists public.coupon_uses (
  id          uuid primary key default gen_random_uuid(),
  coupon_id   uuid not null references public.coupons (id) on delete cascade,
  sale_id     uuid not null references public.sales (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (coupon_id, sale_id)
);

/* Liberação de desconto pelo gerente: vale uma vez, por poucos minutos, e fica registrada. */
create table if not exists public.discount_approvals (
  id           uuid primary key default gen_random_uuid(),
  manager_id   uuid not null references public.store_members (user_id) on delete cascade,
  requested_by uuid not null,
  limit_pct    numeric(5,2) not null,
  expires_at   timestamptz not null,
  used_at      timestamptz,
  sale_id      uuid references public.sales (id) on delete set null,
  created_at   timestamptz not null default now()
);

/* Trocas e devoluções */
create table if not exists public.returns (
  id            uuid primary key default gen_random_uuid(),
  number        int generated by default as identity unique,
  sale_id       uuid not null references public.sales (id) on delete restrict,
  customer_id   uuid references public.customers (id) on delete set null,
  kind          text not null check (kind in ('troca', 'devolucao')),
  reason        text not null check (reason in ('tamanho', 'defeito', 'cor', 'arrependimento', 'outro')),
  notes         text not null default '' check (length(notes) <= 500),
  amount        numeric(12,2) not null default 0,
  refund_method text,
  credit_id     uuid references public.store_credits (id) on delete set null,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now()
);
create index if not exists returns_sale_idx on public.returns (sale_id);

create table if not exists public.return_items (
  id           uuid primary key default gen_random_uuid(),
  return_id    uuid not null references public.returns (id) on delete cascade,
  sale_item_id uuid not null references public.sale_items (id) on delete restrict,
  variant_id   uuid references public.product_variants (id) on delete set null,
  qty          int not null check (qty > 0),
  condition    text not null check (condition in ('vendavel', 'avaria')),
  unit_value   numeric(12,2) not null default 0
);
create index if not exists return_items_return_idx on public.return_items (return_id);

/* "Avise-me quando chegar" */
create table if not exists public.stock_alerts (
  id            uuid primary key default gen_random_uuid(),
  variant_id    uuid not null references public.product_variants (id) on delete cascade,
  customer_name text not null check (length(btrim(customer_name)) between 1 and 80),
  phone         text not null check (length(phone) between 10 and 15),
  client_key    text,
  created_at    timestamptz not null default now(),
  notified_at   timestamptz
);
create unique index if not exists stock_alerts_once on public.stock_alerts (variant_id, phone) where notified_at is null;

-- =====================================================================
--  FORNECEDORES: PEDIDOS DE COMPRA
-- =====================================================================

create table if not exists public.purchases (
  id          uuid primary key default gen_random_uuid(),
  number      int generated by default as identity unique,
  supplier_id uuid references public.suppliers (id) on delete set null,
  status      text not null default 'rascunho' check (status in ('rascunho', 'enviado', 'parcial', 'recebido', 'cancelado')),
  kind        text not null default 'compra' check (kind in ('compra', 'producao')),
  ordered_on  date,
  expected_on date,
  freight     numeric(12,2) not null default 0 check (freight >= 0),
  total       numeric(12,2) not null default 0,
  notes       text not null default '' check (length(notes) <= 800),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
drop trigger if exists purchases_touch on public.purchases;
create trigger purchases_touch before update on public.purchases
  for each row execute function public.touch_updated_at();

create table if not exists public.purchase_items (
  id           uuid primary key default gen_random_uuid(),
  purchase_id  uuid not null references public.purchases (id) on delete cascade,
  variant_id   uuid not null references public.product_variants (id) on delete restrict,
  qty_ordered  int not null check (qty_ordered > 0),
  qty_received int not null default 0 check (qty_received >= 0),
  unit_cost    numeric(12,2) not null default 0 check (unit_cost >= 0),
  unique (purchase_id, variant_id)
);
create index if not exists purchase_items_purchase_idx on public.purchase_items (purchase_id);

-- =====================================================================
--  FINANCEIRO
-- =====================================================================

create table if not exists public.finance_categories (
  id     uuid primary key default gen_random_uuid(),
  name   text not null unique check (length(btrim(name)) between 1 and 60),
  kind   text not null default 'despesa' check (kind in ('despesa', 'receita')),
  active boolean not null default true
);

create table if not exists public.bills (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('pagar', 'receber')),
  description    text not null check (length(btrim(description)) between 1 and 160),
  category_id    uuid references public.finance_categories (id) on delete set null,
  supplier_id    uuid references public.suppliers (id) on delete set null,
  customer_id    uuid references public.customers (id) on delete set null,
  sale_id        uuid references public.sales (id) on delete set null,
  purchase_id    uuid references public.purchases (id) on delete set null,
  due_date       date not null,
  amount         numeric(12,2) not null check (amount > 0),
  status         text not null default 'aberta' check (status in ('aberta', 'paga', 'cancelada')),
  paid_on        date,
  paid_method    text,
  recurring      text not null default 'nao' check (recurring in ('nao', 'mensal')),
  installment_no int,
  installments   int,
  attachment_url text not null default '',
  notes          text not null default '' check (length(notes) <= 500),
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists bills_due_idx on public.bills (due_date);
create index if not exists bills_sale_idx on public.bills (sale_id);
drop trigger if exists bills_touch on public.bills;
create trigger bills_touch before update on public.bills
  for each row execute function public.touch_updated_at();

-- =====================================================================
--  INVENTÁRIO (contagem física)
-- =====================================================================

create table if not exists public.inventories (
  id          uuid primary key default gen_random_uuid(),
  number      int generated by default as identity unique,
  status      text not null default 'aberto' check (status in ('aberto', 'aplicado', 'cancelado')),
  category_id uuid references public.categories (id) on delete set null,
  notes       text not null default '' check (length(notes) <= 300),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  applied_at  timestamptz,
  applied_by  uuid
);

create table if not exists public.inventory_items (
  inventory_id uuid not null references public.inventories (id) on delete cascade,
  variant_id   uuid not null references public.product_variants (id) on delete cascade,
  expected     int not null,
  counted      int check (counted is null or counted >= 0),
  counted_at   timestamptz,
  primary key (inventory_id, variant_id)
);

-- =====================================================================
--  AUDITORIA, DIAGNÓSTICO E FREIOS
-- =====================================================================

create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  table_name text not null,
  row_id     text,
  action     text not null,
  before     jsonb,
  after      jsonb,
  user_id    uuid,
  at         timestamptz not null default now()
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);

create or replace function public._audit_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
begin
  insert into public.audit_log (table_name, row_id, action, before, after, user_id)
  values (tg_table_name, coalesce(v_row ->> 'id', v_row ->> 'user_id'), tg_op, v_old, v_new, auth.uid());
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['store_settings', 'store_members', 'products', 'coupons', 'promotions', 'bills', 'purchases', 'returns'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public._audit_row()', t || '_audit', t);
  end loop;
end;
$$;

-- variação: só o que importa (preço, ativo, código). Saldo já tem o histórico próprio.
drop trigger if exists product_variants_audit on public.product_variants;
create trigger product_variants_audit after update on public.product_variants
  for each row when (old.price is distinct from new.price or old.promo_price is distinct from new.promo_price
                     or old.active is distinct from new.active or old.sku is distinct from new.sku or old.barcode is distinct from new.barcode)
  execute function public._audit_row();

-- venda: mudança de situação, desconto e cancelamento
drop trigger if exists sales_audit on public.sales;
create trigger sales_audit after update on public.sales
  for each row when (old.status is distinct from new.status or old.discount_value is distinct from new.discount_value or old.total is distinct from new.total)
  execute function public._audit_row();

create table if not exists public.client_errors (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  message     text not null check (length(message) <= 500),
  stack       text check (stack is null or length(stack) <= 4000),
  url         text check (url is null or length(url) <= 300),
  user_agent  text check (user_agent is null or length(user_agent) <= 300),
  app_version text check (app_version is null or length(app_version) <= 20),
  context     jsonb check (context is null or pg_column_size(context) <= 4000)
);
create index if not exists client_errors_created_idx on public.client_errors (created_at desc);

create or replace function public.client_errors_prune()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.client_errors where created_at < now() - interval '90 days';
  return null;
end;
$$;
drop trigger if exists client_errors_prune_trg on public.client_errors;
create trigger client_errors_prune_trg after insert on public.client_errors
  for each statement execute function public.client_errors_prune();

/* Freio contra robô nas funções públicas (por aparelho, hash do IP). */
create table if not exists public.public_throttle (
  key    text not null,
  action text not null,
  at     timestamptz not null default now()
);
create index if not exists public_throttle_idx on public.public_throttle (action, key, at);

create or replace function public._client_key()
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_hdr jsonb;
  v_ip  text;
begin
  begin
    v_hdr := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_hdr := null;
  end;
  v_ip := coalesce(nullif(v_hdr ->> 'cf-connecting-ip', ''), nullif(btrim(split_part(v_hdr ->> 'x-forwarded-for', ',', 1)), ''),
                   nullif(v_hdr ->> 'x-real-ip', ''));
  return case when v_ip is not null then md5('rota44:' || v_ip) end;
end;
$$;

create or replace function public._throttle(p_action text, p_key_limit int, p_window interval, p_global_limit int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := public._client_key();
begin
  delete from public.public_throttle where at < now() - interval '1 day';
  if (v_key is not null and (select count(*) from public.public_throttle
        where action = p_action and key = v_key and at > now() - p_window) >= p_key_limit)
     or (select count(*) from public.public_throttle where action = p_action and at > now() - p_window) >= p_global_limit then
    raise exception 'Muitas tentativas agora. Mande uma mensagem direto no WhatsApp da loja.';
  end if;
  insert into public.public_throttle (key, action) values (coalesce(v_key, '-'), p_action);
end;
$$;

-- =====================================================================
--  PREÇO: uma regra só, usada pela venda e pelo catálogo
-- =====================================================================

/*
 * Devolve {preço de lista, preço que vale agora}. A lista é o preço da variação
 * ou o do produto. O promocional da variação/produto respeita as datas, e a
 * melhor promoção ativa (loja, categoria, coleção ou produto) entra se for
 * melhor. O espelho em JavaScript está em assets/js/core/calc.js (priceOf).
 */
create or replace function public._variant_price(v public.product_variants, pr public.products, p_at timestamptz default now())
returns numeric[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_list  numeric(12,2) := coalesce(v.price, pr.base_price);
  v_best  numeric(12,2) := v_list;
  v_promo numeric(12,2) := coalesce(v.promo_price, pr.promo_price);
  v_pct   numeric;
begin
  if v_promo is not null and v_promo > 0 and v_promo < v_best
     and (pr.promo_from is null or pr.promo_from <= p_at) and (pr.promo_to is null or pr.promo_to > p_at) then
    v_best := v_promo;
  end if;
  select max(percent) into v_pct
    from public.promotions m
   where m.active
     and (m.starts_at is null or m.starts_at <= p_at) and (m.ends_at is null or m.ends_at > p_at)
     and (m.target_type = 'tudo'
       or (m.target_type = 'produto' and m.target_id = pr.id)
       or (m.target_type = 'colecao' and m.target_id = pr.collection_id)
       or (m.target_type = 'categoria' and (m.target_id = pr.category_id
            or exists (select 1 from public.categories c where c.id = pr.category_id and c.parent_id = m.target_id))));
  if v_pct is not null then
    v_best := least(v_best, round(v_list * (1 - v_pct / 100), 2));
  end if;
  return array[v_list, v_best];
end;
$$;

-- =====================================================================
--  ESTOQUE: o único caminho para o saldo mudar
-- =====================================================================

create sequence if not exists public.barcode_seq start 1;

/* Código interno de 13 dígitos (faixa 2xx, de uso interno da loja) com dígito verificador. */
create or replace function public._next_barcode()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text;
  v_sum  int := 0;
  i      int;
begin
  v_base := '244' || lpad(nextval('public.barcode_seq')::text, 9, '0');
  for i in 1..12 loop
    v_sum := v_sum + substr(v_base, i, 1)::int * case when i % 2 = 0 then 3 else 1 end;
  end loop;
  return v_base || ((10 - v_sum % 10) % 10)::text;
end;
$$;

/*
 * Aplica um movimento: delta em on_hand e/ou em reserved, confere o bloqueio de
 * saldo negativo e grava a linha do histórico. Quem chama já travou as linhas.
 */
create or replace function public._stock_move(
  p_variant uuid, p_type text, p_qty int, p_reserved int default 0, p_cost numeric default null,
  p_reason text default '', p_ref_type text default null, p_ref_id uuid default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v   public.product_variants;
  s   public.store_settings;
  lbl text;
begin
  select * into v from public.product_variants where id = p_variant for update;
  if not found then
    raise exception 'Variação não encontrada.';
  end if;
  select * into s from public.store_settings where id = 1;
  -- reserva não pode passar do físico; e saída não pode deixar disponível negativo
  if s.block_negative_stock and (p_qty < 0 or p_reserved > 0) and (v.on_hand + p_qty) - (v.reserved + p_reserved) < 0 then
    select pr.name || ' ' || c.name || ' ' || z.label into lbl
      from public.products pr, public.colors c, public.sizes z
     where pr.id = v.product_id and c.id = v.color_id and z.id = v.size_id;
    raise exception 'Estoque insuficiente: % (disponível: %).', lbl, greatest(v.on_hand - v.reserved, 0);
  end if;
  update public.product_variants
     set on_hand = on_hand + p_qty, reserved = greatest(reserved + p_reserved, 0)
   where id = p_variant
   returning * into v;
  insert into public.stock_movements (variant_id, type, qty, reserved_delta, balance_after, unit_cost, reason, ref_type, ref_id)
  values (p_variant, p_type, p_qty, p_reserved, v.on_hand, p_cost, left(coalesce(p_reason, ''), 300), p_ref_type, p_ref_id);
  return v.on_hand;
end;
$$;

/* Custo médio ponderado: atualizado a cada entrada. */
create or replace function public._cost_entry(p_variant uuid, p_qty int, p_cost numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hand int;
  v_avg  numeric(12,4);
begin
  select greatest(on_hand, 0) into v_hand from public.product_variants where id = p_variant;
  select avg_cost into v_avg from public.variant_costs where variant_id = p_variant for update;
  if v_avg is null then
    insert into public.variant_costs (variant_id, avg_cost, last_cost) values (p_variant, p_cost, p_cost);
  elsif p_qty > 0 then
    -- o saldo aqui ainda não contém a entrada
    update public.variant_costs
       set avg_cost = case when v_hand + p_qty > 0 then (v_hand * v_avg + p_qty * p_cost) / (v_hand + p_qty) else p_cost end,
           last_cost = p_cost, updated_at = now()
     where variant_id = p_variant;
  end if;
end;
$$;

/*
 * Ajuste manual / perda / brinde / produção. O novo saldo é consequência do
 * movimento - e motivo é obrigatório.
 *   p = { variant_id, type, qty (positivo; o tipo define o sinal), unit_cost?, reason }
 *   ajuste: { variant_id, type: 'ajuste', new_on_hand, reason }
 */
create or replace function public.adjust_stock(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid := (p ->> 'variant_id')::uuid;
  v_type  text := coalesce(p ->> 'type', 'ajuste');
  v_qty   int := coalesce((p ->> 'qty')::int, 0);
  v_cost  numeric := nullif(p ->> 'unit_cost', '')::numeric;
  v_why   text := btrim(coalesce(p ->> 'reason', ''));
  v_hand  int;
  v_delta int;
begin
  perform public.require_role('admin', 'gerente', 'estoquista');
  if v_type not in ('ajuste', 'perda', 'brinde', 'entrada_producao', 'devolucao_fornecedor') then
    raise exception 'Tipo de movimentação inválido.';
  end if;
  if length(v_why) = 0 then
    raise exception 'Informe o motivo da movimentação.';
  end if;
  if v_type = 'perda' and not public.has_role('admin', 'gerente') then
    raise exception 'Perda precisa de um gerente.';
  end if;
  select on_hand into v_hand from public.product_variants where id = v_id for update;
  if not found then
    raise exception 'Variação não encontrada.';
  end if;
  if v_type = 'ajuste' then
    v_delta := coalesce((p ->> 'new_on_hand')::int, v_hand) - v_hand;
    if coalesce((p ->> 'new_on_hand')::int, 0) < 0 then
      raise exception 'O saldo não pode ser negativo.';
    end if;
    if v_delta = 0 then
      return jsonb_build_object('on_hand', v_hand, 'changed', false);
    end if;
  elsif v_type = 'entrada_producao' then
    if v_qty <= 0 then raise exception 'Informe a quantidade.'; end if;
    v_delta := v_qty;
    if v_cost is not null then
      perform public._cost_entry(v_id, v_qty, v_cost);
    end if;
  else
    if v_qty <= 0 then raise exception 'Informe a quantidade.'; end if;
    v_delta := -v_qty;
  end if;
  v_hand := public._stock_move(v_id, v_type, v_delta, 0, v_cost, v_why, 'ajuste', null);
  return jsonb_build_object('on_hand', v_hand, 'changed', true);
end;
$$;

-- =====================================================================
--  PRODUTO COM VARIAÇÕES: tudo numa transação
-- =====================================================================

create or replace function public._slugify(p text)
returns text
language sql
immutable
as $$
  select trim(both '-' from left(regexp_replace(lower(translate(coalesce(p, ''),
    'áàãâäéèêëíìîïóòõôöúùûüçñÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇÑ',
    'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')), '[^a-z0-9]+', '-', 'g'), 120));
$$;

create or replace function public._fit_code(p_fit text)
returns text
language sql
immutable
as $$
  select case public._slugify(p_fit)
    when 'oversized' then 'OVS' when 'regular' then 'REG' when 'boxy' then 'BOX' when 'baggy' then 'BAG'
    when 'slim' then 'SLM' when 'cropped' then 'CRP' when 'wide' then 'WID' when 'reta' then 'RET' else 'GEN' end;
$$;

/*
 * Salva produto + categorias + imagens + variações.
 *   p = { id?, name, ..., category_ids: [], images: [{url,color_id}],
 *         variants: [{ id?, color_id, size_id, sku?, barcode?, price?, promo_price?,
 *                      stock_min?, active?, initial_stock?, cost? }], cost? }
 * Variação que saiu da lista: se tem histórico, desativa; senão, apaga.
 * Custo só é gravado por quem pode ver custo.
 */
create or replace function public.save_product(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid := nullif(p ->> 'id', '')::uuid;
  v_prod   public.products;
  v_slug   text;
  v_code   text;
  v_keep   uuid[] := '{}';
  it       jsonb;
  v_var    public.product_variants;
  v_vid    uuid;
  v_sku    text;
  v_bar    text;
  v_cost   numeric;
  v_qty    int;
  v_ccode  text;
  v_size   text;
  v_img    jsonb;
  v_i      int := 0;
  v_cover  text := '';
  v_cat    uuid := nullif(p ->> 'category_id', '')::uuid;
  v_can_cost boolean := public.can_see_cost();
  r        record;
  v_base   text;
  v_n      int;
begin
  perform public.require_role('admin', 'gerente');
  if length(btrim(coalesce(p ->> 'name', ''))) = 0 then
    raise exception 'Informe o nome do produto.';
  end if;
  if jsonb_array_length(coalesce(p -> 'images', '[]'::jsonb)) > 4 then
    raise exception 'Cada peça pode ter até 4 fotos.';
  end if;
  v_slug := nullif(public._slugify(coalesce(nullif(p ->> 'slug', ''), p ->> 'name')), '');
  if v_slug is null then v_slug := 'produto'; end if;
  -- slug único: acrescenta -2, -3... se já existir em outro produto
  v_i := 1;
  while exists (select 1 from public.products where slug = (case when v_i = 1 then v_slug else v_slug || '-' || v_i end)
                  and (v_id is null or id <> v_id)) loop
    v_i := v_i + 1;
  end loop;
  if v_i > 1 then v_slug := v_slug || '-' || v_i; end if;

  if v_id is not null then
    update public.products set
      name = btrim(p ->> 'name'), slug = v_slug,
      short_desc = coalesce(p ->> 'short_desc', ''), description = coalesce(p ->> 'description', ''),
      category_id = v_cat, brand_id = nullif(p ->> 'brand_id', '')::uuid,
      collection_id = nullif(p ->> 'collection_id', '')::uuid, grid_id = nullif(p ->> 'grid_id', '')::uuid,
      size_chart_id = nullif(p ->> 'size_chart_id', '')::uuid,
      gender = coalesce(nullif(p ->> 'gender', ''), 'unissex'), fit = coalesce(p ->> 'fit', ''),
      fabric = coalesce(p ->> 'fabric', ''), gsm = nullif(p ->> 'gsm', '')::int, print_type = coalesce(p ->> 'print_type', ''),
      wash_care = coalesce(p ->> 'wash_care', ''),
      tags = coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p -> 'tags', '[]'::jsonb)) x), '{}'),
      status = coalesce(nullif(p ->> 'status', ''), 'ativo'),
      catalog_visible = coalesce((p ->> 'catalog_visible')::boolean, true), featured = coalesce((p ->> 'featured')::boolean, false),
      base_price = coalesce(nullif(p ->> 'base_price', '')::numeric, 0), promo_price = nullif(p ->> 'promo_price', '')::numeric,
      promo_from = nullif(p ->> 'promo_from', '')::timestamptz, promo_to = nullif(p ->> 'promo_to', '')::timestamptz,
      seo_title = coalesce(p ->> 'seo_title', ''), seo_desc = coalesce(p ->> 'seo_desc', ''),
      ncm = coalesce(p ->> 'ncm', ''), origin = coalesce(nullif(p ->> 'origin', ''), '0'), cest = coalesce(p ->> 'cest', ''),
      weight_g = nullif(p ->> 'weight_g', '')::int, dimensions = coalesce(p ->> 'dimensions', '')
    where id = v_id and deleted_at is null
    returning * into v_prod;
    if not found then
      raise exception 'Produto não encontrado.';
    end if;
  else
    insert into public.products (name, slug, short_desc, description, category_id, brand_id, collection_id, grid_id, size_chart_id,
      gender, fit, fabric, gsm, print_type, wash_care, tags, status, catalog_visible, featured, base_price, promo_price, promo_from, promo_to,
      seo_title, seo_desc, ncm, origin, cest, weight_g, dimensions)
    values (btrim(p ->> 'name'), v_slug, coalesce(p ->> 'short_desc', ''), coalesce(p ->> 'description', ''), v_cat,
      nullif(p ->> 'brand_id', '')::uuid, nullif(p ->> 'collection_id', '')::uuid, nullif(p ->> 'grid_id', '')::uuid, nullif(p ->> 'size_chart_id', '')::uuid,
      coalesce(nullif(p ->> 'gender', ''), 'unissex'), coalesce(p ->> 'fit', ''), coalesce(p ->> 'fabric', ''), nullif(p ->> 'gsm', '')::int,
      coalesce(p ->> 'print_type', ''), coalesce(p ->> 'wash_care', ''),
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p -> 'tags', '[]'::jsonb)) x), '{}'),
      coalesce(nullif(p ->> 'status', ''), 'ativo'), coalesce((p ->> 'catalog_visible')::boolean, true), coalesce((p ->> 'featured')::boolean, false),
      coalesce(nullif(p ->> 'base_price', '')::numeric, 0), nullif(p ->> 'promo_price', '')::numeric,
      nullif(p ->> 'promo_from', '')::timestamptz, nullif(p ->> 'promo_to', '')::timestamptz,
      coalesce(p ->> 'seo_title', ''), coalesce(p ->> 'seo_desc', ''), coalesce(p ->> 'ncm', ''), coalesce(nullif(p ->> 'origin', ''), '0'),
      coalesce(p ->> 'cest', ''), nullif(p ->> 'weight_g', '')::int, coalesce(p ->> 'dimensions', ''))
    returning * into v_prod;
    v_id := v_prod.id;
  end if;

  -- categorias secundárias
  if p ? 'category_ids' then
    delete from public.product_categories where product_id = v_id;
    insert into public.product_categories (product_id, category_id)
    select distinct v_id, x::uuid from jsonb_array_elements_text(p -> 'category_ids') x
    where nullif(x, '') is not null and x::uuid is distinct from v_cat;
  end if;

  -- imagens: a ordem da lista é a ordem de exibição; a primeira é a capa
  if p ? 'images' then
    delete from public.product_images where product_id = v_id;
    v_i := 0;
    for v_img in select * from jsonb_array_elements(p -> 'images') loop
      continue when length(coalesce(v_img ->> 'url', '')) = 0;
      insert into public.product_images (product_id, color_id, url, sort)
      values (v_id, nullif(v_img ->> 'color_id', '')::uuid, v_img ->> 'url', v_i);
      if v_i = 0 then v_cover := v_img ->> 'url'; end if;
      v_i := v_i + 1;
    end loop;
    update public.products set cover_url = v_cover where id = v_id;
  end if;

  -- variações
  v_code := coalesce((select c.code from public.categories c where c.id = v_cat), 'GER');
  for it in select * from jsonb_array_elements(coalesce(p -> 'variants', '[]'::jsonb)) loop
    v_vid := nullif(it ->> 'id', '')::uuid;
    if v_vid is null then
      select id into v_vid from public.product_variants
       where product_id = v_id and color_id = (it ->> 'color_id')::uuid and size_id = (it ->> 'size_id')::uuid;
    end if;
    select code into v_ccode from public.colors where id = (it ->> 'color_id')::uuid;
    select upper(regexp_replace(label, '\s+', '', 'g')) into v_size from public.sizes where id = (it ->> 'size_id')::uuid;
    if v_ccode is null or v_size is null then
      raise exception 'Cor ou tamanho inválido em uma das variações.';
    end if;
    v_sku := nullif(btrim(coalesce(it ->> 'sku', '')), '');
    if v_sku is null then
      v_base := 'R44-' || v_code || '-' || public._fit_code(v_prod.fit) || '-' || lpad(v_prod.seq::text, 3, '0') || '-' || v_ccode || '-' || v_size;
      v_sku := v_base;
      -- trocou de grade: a variação antiga segue desativada com o mesmo código
      v_n := 1;
      while exists (select 1 from public.product_variants x where x.sku = v_sku and (v_vid is null or x.id <> v_vid)) loop
        v_n := v_n + 1;
        v_sku := v_base || '-' || v_n;
      end loop;
    end if;
    v_bar := nullif(btrim(coalesce(it ->> 'barcode', '')), '');

    if v_vid is null then
      insert into public.product_variants (product_id, color_id, size_id, sku, barcode, price, promo_price, stock_min, active)
      values (v_id, (it ->> 'color_id')::uuid, (it ->> 'size_id')::uuid, v_sku, coalesce(v_bar, public._next_barcode()),
              nullif(it ->> 'price', '')::numeric, nullif(it ->> 'promo_price', '')::numeric,
              coalesce(nullif(it ->> 'stock_min', '')::int, 1), coalesce((it ->> 'active')::boolean, true))
      returning * into v_var;
    else
      update public.product_variants set
        color_id = (it ->> 'color_id')::uuid, size_id = (it ->> 'size_id')::uuid, sku = v_sku,
        barcode = coalesce(v_bar, barcode), price = nullif(it ->> 'price', '')::numeric, promo_price = nullif(it ->> 'promo_price', '')::numeric,
        stock_min = coalesce(nullif(it ->> 'stock_min', '')::int, stock_min), active = coalesce((it ->> 'active')::boolean, active)
      where id = v_vid and product_id = v_id
      returning * into v_var;
      if not found then
        raise exception 'Variação não pertence a este produto.';
      end if;
    end if;
    v_keep := v_keep || v_var.id;

    -- custo e estoque inicial (só para quem pode)
    if v_can_cost then
      v_cost := nullif(it ->> 'cost', '')::numeric;
      v_qty := coalesce(nullif(it ->> 'initial_stock', '')::int, 0);
      if v_qty > 0 then
        perform public._cost_entry(v_var.id, v_qty, coalesce(v_cost, 0));
        perform public._stock_move(v_var.id, 'estoque_inicial', v_qty, 0, coalesce(v_cost, 0), 'Estoque inicial no cadastro', 'produto', v_id);
      elsif v_cost is not null and not exists (select 1 from public.variant_costs where variant_id = v_var.id) then
        insert into public.variant_costs (variant_id, avg_cost, last_cost) values (v_var.id, v_cost, v_cost);
      elsif v_cost is not null and coalesce((it ->> 'cost_override')::boolean, false) then
        update public.variant_costs set avg_cost = v_cost, last_cost = v_cost, updated_at = now() where variant_id = v_var.id;
      end if;
    end if;
  end loop;

  -- variação fora da lista: apaga se nunca teve movimento; senão só desativa
  if p ? 'variants' then
    for r in select v.id from public.product_variants v where v.product_id = v_id and not (v.id = any (v_keep)) loop
      if exists (select 1 from public.stock_movements m where m.variant_id = r.id)
         or exists (select 1 from public.sale_items i where i.variant_id = r.id)
         or exists (select 1 from public.purchase_items i where i.variant_id = r.id) then
        update public.product_variants set active = false where id = r.id;
      else
        delete from public.product_variants where id = r.id;
      end if;
    end loop;
  end if;

  return jsonb_build_object('id', v_id, 'slug', v_slug);
end;
$$;

/* Exclui a categoria. Peça que estava nela vai para a categoria escolhida. */
create or replace function public.delete_category(p_id uuid, p_move_to uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_role('admin', 'gerente');
  if exists (select 1 from public.categories where parent_id = p_id) then
    raise exception 'Esta categoria tem subcategorias: mova ou exclua elas antes.';
  end if;
  if p_move_to = p_id then
    raise exception 'Escolha outra categoria para as peças.';
  end if;
  if p_move_to is null and exists (select 1 from public.products where category_id = p_id and deleted_at is null) then
    raise exception 'Escolha para qual categoria as peças vão.';
  end if;
  update public.products set category_id = p_move_to where category_id = p_id;
  delete from public.categories where id = p_id;
end;
$$;

/* Excluir = esconder. Produto vendido continua nos relatórios. */
create or replace function public.delete_product(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_role('admin', 'gerente');
  update public.products set deleted_at = now(), status = 'arquivado', catalog_visible = false where id = p_id;
  update public.product_variants set active = false where product_id = p_id;
end;
$$;

/* Reajuste de preço em lote. p = { items: [{ product_id, base_price?, promo_price? }] } */
create or replace function public.set_prices(p jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  it jsonb;
  n  int := 0;
begin
  perform public.require_role('admin', 'gerente');
  for it in select * from jsonb_array_elements(coalesce(p -> 'items', '[]'::jsonb)) order by (value ->> 'product_id') loop
    update public.products set
      base_price = coalesce(nullif(it ->> 'base_price', '')::numeric, base_price),
      promo_price = case when it ? 'promo_price' then nullif(it ->> 'promo_price', '')::numeric else promo_price end
    where id = (it ->> 'product_id')::uuid;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- =====================================================================
--  VENDAS: funções
-- =====================================================================

/* Efeito da venda no estoque, de um estado para outro. */
create or replace function public._sale_stock(p_sale uuid, p_target text, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text;
  i       record;
begin
  select stock_state into v_state from public.sales where id = p_sale;
  if v_state = p_target then
    return;
  end if;
  -- trava em ordem de id: duas vendas da mesma peça nunca se bloqueiam em cruz
  perform 1 from public.product_variants
    where id in (select variant_id from public.sale_items where sale_id = p_sale and variant_id is not null)
    order by id for update;
  for i in select variant_id, qty, returned_qty from public.sale_items where sale_id = p_sale and variant_id is not null order by variant_id loop
    if v_state = 'none' and p_target = 'reserved' then
      perform public._stock_move(i.variant_id, 'reserva', 0, i.qty, null, p_reason, 'venda', p_sale);
    elsif v_state = 'none' and p_target = 'out' then
      perform public._stock_move(i.variant_id, 'venda', -i.qty, 0, null, p_reason, 'venda', p_sale);
    elsif v_state = 'reserved' and p_target = 'out' then
      perform public._stock_move(i.variant_id, 'venda', -i.qty, -i.qty, null, p_reason, 'venda', p_sale);
    elsif v_state = 'reserved' and p_target = 'none' then
      perform public._stock_move(i.variant_id, 'libera_reserva', 0, -i.qty, null, p_reason, 'venda', p_sale);
    elsif v_state = 'out' and p_target = 'none' then
      -- o que já voltou por troca/devolução não volta de novo
      if i.qty - i.returned_qty > 0 then
        perform public._stock_move(i.variant_id, 'cancelamento_venda', i.qty - i.returned_qty, 0, null, p_reason, 'venda', p_sale);
      end if;
    end if;
  end loop;
  update public.sales set stock_state = p_target where id = p_sale;
end;
$$;

create or replace function public._payment_fee(s public.store_settings, p_method text, p_amount numeric, p_installments int)
returns numeric
language sql
stable
as $$
  select round(p_amount * (case
    when p_method = 'debito' then s.fee_debit_pct
    when p_method = 'credito' and p_installments > 1 then s.fee_credit_inst_pct
    when p_method = 'credito' then s.fee_credit_pct
    else 0 end) / 100, 2);
$$;

create or replace function public._payment_expected(s public.store_settings, p_method text, p_paid date)
returns date
language sql
stable
as $$
  select case
    when p_method = 'debito' then p_paid + s.debit_days
    when p_method = 'credito' then p_paid + s.credit_days
    else p_paid end;
$$;

/* paid_total é sempre a soma dos lançamentos: ninguém digita "já recebido". */
create or replace function public._payments_sync_sale()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale uuid := coalesce(new.sale_id, old.sale_id);
begin
  update public.sales
     set paid_total = coalesce((select sum(amount) from public.sale_payments where sale_id = v_sale), 0)
   where id = v_sale;
  return null;
end;
$$;
drop trigger if exists sale_payments_sync on public.sale_payments;
create trigger sale_payments_sync after insert or update or delete on public.sale_payments
  for each row execute function public._payments_sync_sale();

/* Lança um pagamento. Vale-troca debita o saldo do vale na mesma transação. */
create or replace function public._add_payment(
  p_sale uuid, p jsonb, s public.store_settings, p_paid date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_method  text := coalesce(p ->> 'method', 'dinheiro');
  v_amount  numeric(12,2) := coalesce(nullif(p ->> 'amount', '')::numeric, 0);
  v_inst    int := coalesce(nullif(p ->> 'installments', '')::int, 1);
  v_id      uuid := coalesce(nullif(p ->> 'id', '')::uuid, gen_random_uuid());
  v_credit  public.store_credits;
  v_session uuid;
begin
  if v_amount <= 0 then
    raise exception 'Valor do pagamento precisa ser maior que zero.';
  end if;
  if exists (select 1 from public.sale_payments where id = v_id) then
    return;   -- reenvio do mesmo lançamento (internet caiu no meio): não lança duas vezes
  end if;
  select id into v_session from public.cash_sessions where opened_by = auth.uid() and closed_at is null;
  if v_method = 'dinheiro' and s.require_cash_session and v_session is null then
    raise exception 'Abra o caixa antes de receber em dinheiro.';
  end if;
  if v_method = 'vale_troca' then
    select * into v_credit from public.store_credits where code = upper(btrim(coalesce(p ->> 'credit_code', ''))) for update;
    if not found then
      raise exception 'Vale-troca não encontrado.';
    end if;
    if v_credit.expires_on is not null and v_credit.expires_on < p_paid then
      raise exception 'Este vale-troca venceu em %.', to_char(v_credit.expires_on, 'DD/MM/YYYY');
    end if;
    if v_credit.balance < v_amount then
      raise exception 'Saldo do vale-troca insuficiente (R$ %).', replace(to_char(v_credit.balance, 'FM999990.00'), '.', ',');
    end if;
    update public.store_credits set balance = balance - v_amount where id = v_credit.id;
  end if;
  insert into public.sale_payments (id, sale_id, method, amount, installments, fee_amount, expected_on, paid_on, tendered, change_given,
                                    credit_id, cash_session_id, notes)
  values (v_id, p_sale, v_method, v_amount, v_inst, public._payment_fee(s, v_method, v_amount, v_inst),
          public._payment_expected(s, v_method, p_paid), p_paid,
          nullif(p ->> 'tendered', '')::numeric, nullif(p ->> 'change_given', '')::numeric,
          v_credit.id, v_session, left(coalesce(p ->> 'notes', ''), 200));
end;
$$;

/* Limite de desconto de quem está logado: o do cadastro ou o padrão do perfil. */
create or replace function public._my_discount_limit()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(m.discount_limit, case m.role
      when 'admin' then 100
      when 'gerente' then (select discount_limit_gerente from public.store_settings where id = 1)
      when 'vendedor' then (select discount_limit_vendedor from public.store_settings where id = 1)
      else 0 end)
    from public.store_members m where m.user_id = auth.uid();
$$;

/*
 * Senha do gerente: devolve uma liberação que vale uma vez e dura 10 minutos.
 * Errou 5 vezes seguidas num login de gerente: esse login fica 15 minutos sem
 * poder liberar. Aqui não pode dar raise: o rollback apagaria a tentativa.
 */
create or replace function public.check_manager_pin(p_pin text, p_pct numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r      record;
  v_id   uuid;
  v_lim  numeric;
begin
  perform public.require_member();
  for r in
    select m.user_id, m.nome, m.role, m.discount_limit, x.pin_salt, x.pin_hash, x.failed, x.failed_at
      from public.member_secrets x join public.store_members m on m.user_id = x.user_id
     where m.active and m.role in ('admin', 'gerente')
  loop
    continue when r.failed >= 5 and r.failed_at > now() - interval '15 minutes';
    if encode(sha256(convert_to(r.pin_salt || coalesce(p_pin, ''), 'UTF8')), 'hex') = r.pin_hash then
      update public.member_secrets set failed = 0, failed_at = null where user_id = r.user_id;
      v_lim := coalesce(r.discount_limit, case r.role when 'admin' then 100
        else (select discount_limit_gerente from public.store_settings where id = 1) end);
      if coalesce(p_pct, 0) > v_lim + 0.001 then
        return jsonb_build_object('ok', false, 'error', format('O limite de %s é %s%%.', r.nome, v_lim));
      end if;
      insert into public.discount_approvals (manager_id, requested_by, limit_pct, expires_at)
      values (r.user_id, auth.uid(), v_lim, now() + interval '10 minutes')
      returning id into v_id;
      return jsonb_build_object('ok', true, 'approval_id', v_id, 'manager', r.nome);
    end if;
  end loop;
  update public.member_secrets
     set failed = case when failed_at > now() - interval '15 minutes' then failed + 1 else 1 end, failed_at = now();
  return jsonb_build_object('ok', false, 'error', 'Senha incorreta.');
end;
$$;

create or replace function public.set_my_pin(p_pin text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_salt text := md5(gen_random_uuid()::text);
begin
  perform public.require_role('admin', 'gerente');
  if coalesce(p_pin, '') !~ '^\d{4,8}$' then
    raise exception 'Use de 4 a 8 números na senha de liberação.';
  end if;
  insert into public.member_secrets (user_id, pin_salt, pin_hash)
  values (auth.uid(), v_salt, encode(sha256(convert_to(v_salt || p_pin, 'UTF8')), 'hex'))
  on conflict (user_id) do update set pin_salt = excluded.pin_salt, pin_hash = excluded.pin_hash, failed = 0, failed_at = null;
end;
$$;

/* Confere um cupom e devolve o desconto. Lança erro em português se não valer. */
create or replace function public._coupon_discount(p_code text, p_base numeric, p_customer uuid)
returns table (coupon_id uuid, discount numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.coupons;
begin
  select * into c from public.coupons where code = upper(btrim(coalesce(p_code, '')));
  if not found or not c.active then
    raise exception 'Cupom inválido.';
  end if;
  if (c.starts_at is not null and c.starts_at > now()) or (c.ends_at is not null and c.ends_at <= now()) then
    raise exception 'Este cupom está fora da validade.';
  end if;
  if p_base < c.min_total then
    raise exception 'Este cupom vale para compras a partir de R$ %.', replace(to_char(c.min_total, 'FM999990.00'), '.', ',');
  end if;
  if c.max_uses is not null and (select count(*) from public.coupon_uses u where u.coupon_id = c.id) >= c.max_uses then
    raise exception 'Este cupom já foi todo usado.';
  end if;
  if c.max_per_customer is not null and p_customer is not null
     and (select count(*) from public.coupon_uses u where u.coupon_id = c.id and u.customer_id = p_customer) >= c.max_per_customer then
    raise exception 'Este cliente já usou o cupom o máximo de vezes.';
  end if;
  coupon_id := c.id;
  discount := least(p_base, case when c.kind = 'percent' then round(p_base * c.value / 100, 2) else c.value end);
  return next;
end;
$$;

/* Vendedor no balcão confere o cupom antes de fechar. */
create or replace function public.check_coupon(p_code text, p_base numeric, p_customer uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
begin
  perform public.require_member();
  select * into r from public._coupon_discount(p_code, p_base, p_customer);
  return jsonb_build_object('coupon_id', r.coupon_id, 'discount', r.discount);
end;
$$;

/* Consulta de vale-troca: o vendedor não lê a tabela, só o vale que tem em mãos. */
create or replace function public.find_credit(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when public.is_member() then (
    select jsonb_build_object('id', id, 'code', code, 'balance', balance, 'expires_on', expires_on, 'customer_id', customer_id)
      from public.store_credits where code = upper(btrim(coalesce(p_code, ''))))
  end;
$$;

/*
 * Grava uma venda, numa transação só. Serve para o PDV e para os pedidos.
 *   p = { client_ref, sale_date, channel, status, customer_id, customer_name,
 *         customer_phone, seller_id?, items: [{ variant_id, qty, discount_value }],
 *         discount_value, coupon_code, use_pix_discount, shipping_fee,
 *         delivery_method, address, notes, approval_id, request_id,
 *         payments: [{ id, method, amount, installments, tendered, change_given, credit_code }],
 *         crediario: { installments, first_due } }
 * O preço vem SEMPRE do banco. O navegador só diz o que vendeu e o desconto.
 */
create or replace function public.save_sale(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s          public.store_settings;
  v_ref      uuid := nullif(p ->> 'client_ref', '')::uuid;
  v_sale     public.sales;
  v_status   text := coalesce(nullif(p ->> 'status', ''), 'entregue');
  v_date     date := coalesce(nullif(p ->> 'sale_date', '')::date, (now() at time zone 'America/Sao_Paulo')::date);
  v_customer uuid := nullif(p ->> 'customer_id', '')::uuid;
  v_cname    text := left(btrim(coalesce(p ->> 'customer_name', '')), 120);
  v_cphone   text := left(regexp_replace(coalesce(p ->> 'customer_phone', ''), '\D', '', 'g'), 20);
  v_seller   uuid := coalesce(nullif(p ->> 'seller_id', '')::uuid, auth.uid());
  v_items    jsonb := coalesce(p -> 'items', '[]'::jsonb);
  it         jsonb;
  v_ids      uuid[];
  r          record;
  v_prices   numeric[];
  v_qty      int;
  v_disc     numeric(12,2);
  v_gross    numeric(12,2) := 0;
  v_idisc    numeric(12,2) := 0;
  v_sdisc    numeric(12,2) := greatest(coalesce(nullif(p ->> 'discount_value', '')::numeric, 0), 0);
  v_ship     numeric(12,2) := greatest(coalesce(nullif(p ->> 'shipping_fee', '')::numeric, 0), 0);
  v_coupon   uuid;
  v_cdisc    numeric(12,2) := 0;
  v_pdisc    numeric(12,2) := 0;
  v_total    numeric(12,2);
  v_pct      numeric;
  v_limit    numeric;
  v_approval public.discount_approvals;
  v_approved uuid;
  v_paysum   numeric(12,2) := 0;
  v_cred     jsonb := p -> 'crediario';
  v_rest     numeric(12,2);
  v_inst     int;
  v_due      date;
  v_each     numeric(12,2);
  v_item_id  uuid;
  v_sort     int := 0;
  v_target   text;
  v_lim_qty  int;
  v_done     int;
  c          record;
  v_req      text;
begin
  perform public.require_role('admin', 'gerente', 'vendedor');

  -- internet caiu depois de gravar e o aparelho reenviou: devolve a mesma venda
  if v_ref is not null then
    select * into v_sale from public.sales where client_ref = v_ref;
    if found then
      return jsonb_build_object('id', v_sale.id, 'number', v_sale.number, 'total', v_sale.total, 'duplicate', true);
    end if;
  end if;

  select * into s from public.store_settings where id = 1;

  if nullif(p ->> 'request_id', '') is not null then
    select status into v_req from public.catalog_requests where id = (p ->> 'request_id')::uuid for update;
    if v_req = 'convertido' then
      raise exception 'Este pedido do catálogo já virou venda.';
    end if;
  end if;

  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'A venda precisa ter ao menos um item.';
  end if;
  if v_status not in ('aguardando_pagamento', 'pago', 'em_separacao', 'pronto_retirada', 'enviado', 'entregue') then
    raise exception 'Situação inválida para uma venda nova.';
  end if;
  if not public.has_role('admin', 'gerente') then
    v_seller := auth.uid();   -- vendedor só lança em nome dele
    v_date := (now() at time zone 'America/Sao_Paulo')::date;   -- e só na data de hoje
  end if;

  -- venda com telefone e sem cadastro: acha o cliente, ou cria. O CRM enche sem ninguém digitar de novo
  if v_customer is null and length(v_cphone) >= 10 then
    select id into v_customer from public.customers where phone = v_cphone and deleted_at is null order by created_at limit 1;
    if v_customer is null and length(v_cname) > 0 then
      insert into public.customers (name, phone) values (v_cname, v_cphone) returning id into v_customer;
    end if;
  end if;

  if v_customer is not null then
    select name, phone into c from public.customers where id = v_customer and deleted_at is null;
    if not found then
      raise exception 'Cliente não encontrado.';
    end if;
    v_cname := c.name;
    v_cphone := c.phone;
  end if;

  -- trava as peças em ordem de id
  select array_agg(distinct (x ->> 'variant_id')::uuid) into v_ids from jsonb_array_elements(v_items) x;
  perform 1 from public.product_variants where id = any (v_ids) order by id for update;

  -- cabeçalho primeiro: os itens precisam do id
  insert into public.sales (client_ref, channel, status, sale_date, customer_id, customer_name, customer_phone, seller_id,
                            shipping_fee, delivery_method, address, notes, request_id)
  values (v_ref, coalesce(nullif(p ->> 'channel', ''), 'balcao'), v_status, v_date, v_customer, v_cname, v_cphone, v_seller, v_ship,
          coalesce(nullif(p ->> 'delivery_method', ''), 'balcao'), left(coalesce(p ->> 'address', ''), 300),
          left(coalesce(p ->> 'notes', ''), 800), nullif(p ->> 'request_id', '')::uuid)
  returning * into v_sale;

  for it in select * from jsonb_array_elements(v_items) loop
    v_qty := coalesce(nullif(it ->> 'qty', '')::int, 0);
    if v_qty <= 0 then
      raise exception 'Quantidade inválida em um dos itens.';
    end if;
    select v.*, pr.name as pname, c2.name as cname, z.label as slabel, col.limit_per_customer as climit, col.launch_at as launch, col.id as col_id, col.name as col_name
      into r
      from public.product_variants v
      join public.products pr on pr.id = v.product_id
      join public.colors c2 on c2.id = v.color_id
      join public.sizes z on z.id = v.size_id
      left join public.collections col on col.id = pr.collection_id
     where v.id = (it ->> 'variant_id')::uuid;
    if not found then
      raise exception 'Um dos itens não existe mais no cadastro.';
    end if;
    -- drop ainda fechado: só gerente pode vender antes da hora
    if r.launch is not null and r.launch > now() and not public.has_role('admin', 'gerente') then
      raise exception 'O drop "%" ainda não foi lançado.', r.col_name;
    end if;
    -- limite por cliente do drop
    if r.climit is not null and v_customer is not null then
      select coalesce(sum(i.qty - i.returned_qty), 0) into v_done
        from public.sale_items i
        join public.sales sa on sa.id = i.sale_id
        join public.products p3 on p3.id = i.product_id
       where sa.customer_id = v_customer and sa.status <> 'cancelado' and p3.collection_id = r.col_id;
      if v_done + v_qty > r.climit then
        raise exception 'Limite do drop "%": no máximo % por cliente (este já levou %).', r.col_name, r.climit, v_done;
      end if;
    end if;

    select public._variant_price(v, pr) into v_prices
      from public.product_variants v join public.products pr on pr.id = v.product_id
     where v.id = (it ->> 'variant_id')::uuid;
    v_disc := least(greatest(coalesce(nullif(it ->> 'discount_value', '')::numeric, 0), 0), v_qty * v_prices[2]);
    v_gross := v_gross + v_qty * v_prices[2];
    v_idisc := v_idisc + v_disc;

    insert into public.sale_items (sale_id, variant_id, product_id, product_name, color_name, size_label, sku, qty, list_price, unit_price, discount_value, sort, sale_date)
    values (v_sale.id, r.id, r.product_id, r.pname, r.cname, r.slabel, r.sku, v_qty, v_prices[1], v_prices[2], v_disc, v_sort, v_date)
    returning id into v_item_id;
    v_sort := v_sort + 1;

    -- custo do momento: fica na tabela que o vendedor não lê
    insert into public.sale_item_costs (sale_item_id, unit_cost, sale_date)
    values (v_item_id, coalesce((select avg_cost from public.variant_costs where variant_id = r.id), 0), v_date);
  end loop;

  if v_sdisc > v_gross - v_idisc then
    raise exception 'O desconto é maior que o valor dos produtos.';
  end if;

  -- limite de desconto do perfil (promoção e cupom não contam: quem deu foi a loja)
  v_pct := case when v_gross > 0 then round((v_idisc + v_sdisc) / v_gross * 100, 2) else 0 end;
  v_limit := public._my_discount_limit();
  if v_pct > v_limit + 0.001 then
    select * into v_approval from public.discount_approvals
     where id = nullif(p ->> 'approval_id', '')::uuid and requested_by = auth.uid() and used_at is null and expires_at > now() for update;
    if not found or v_approval.limit_pct + 0.001 < v_pct then
      raise exception 'DESCONTO_ACIMA: Desconto de %%% acima do seu limite (%%%). Peça a senha do gerente.', v_pct, v_limit;
    end if;
    update public.discount_approvals set used_at = now(), sale_id = v_sale.id where id = v_approval.id;
    v_approved := v_approval.manager_id;
  end if;

  -- cupom
  if length(btrim(coalesce(p ->> 'coupon_code', ''))) > 0 then
    -- duas vendas ao mesmo tempo não passam do limite de usos
    perform 1 from public.coupons where code = upper(btrim(p ->> 'coupon_code')) for update;
    select d.coupon_id, d.discount into v_coupon, v_cdisc
      from public._coupon_discount(p ->> 'coupon_code', v_gross - v_idisc - v_sdisc, v_customer) d;
    insert into public.coupon_uses (coupon_id, sale_id, customer_id) values (v_coupon, v_sale.id, v_customer);
  end if;

  -- desconto do Pix: só com tudo pago no Pix
  if coalesce((p ->> 'use_pix_discount')::boolean, false) and s.pix_discount_pct > 0 then
    if exists (select 1 from jsonb_array_elements(coalesce(p -> 'payments', '[]'::jsonb)) x where x ->> 'method' <> 'pix')
       or v_cred is not null then
      raise exception 'O desconto do Pix vale só para pagamento todo no Pix.';
    end if;
    v_pdisc := round((v_gross - v_idisc - v_sdisc - v_cdisc) * s.pix_discount_pct / 100, 2);
  end if;

  v_total := v_gross - v_idisc - v_sdisc - v_cdisc - v_pdisc + v_ship;

  update public.sales set
    items_total = v_gross, items_discount = v_idisc, discount_value = v_sdisc, coupon_id = v_coupon, coupon_discount = v_cdisc,
    pix_discount = v_pdisc, total = v_total, approved_by = v_approved,
    reserved_until = case when v_status = 'aguardando_pagamento' then now() + make_interval(hours => s.reservation_hours) end
  where id = v_sale.id;

  insert into public.sale_status_history (sale_id, from_status, to_status, note) values (v_sale.id, null, v_status, 'Venda criada');

  -- estoque
  v_target := case when v_status = 'aguardando_pagamento' then 'reserved' else 'out' end;
  perform public._sale_stock(v_sale.id, v_target, 'Venda #' || v_sale.number);

  -- pagamentos
  for it in select * from jsonb_array_elements(coalesce(p -> 'payments', '[]'::jsonb)) loop
    perform public._add_payment(v_sale.id, it, s, v_date);
    v_paysum := v_paysum + coalesce(nullif(it ->> 'amount', '')::numeric, 0);
  end loop;
  if v_paysum > v_total + 0.005 then
    raise exception 'Os pagamentos passam do total da venda.';
  end if;
  v_rest := v_total - v_paysum;

  -- crediário: o que falta vira parcelas a receber
  if v_cred is not null and v_rest > 0.005 then
    if v_customer is null then
      raise exception 'Crediário precisa de um cliente cadastrado.';
    end if;
    v_inst := least(greatest(coalesce(nullif(v_cred ->> 'installments', '')::int, 1), 1), 24);
    v_due := coalesce(nullif(v_cred ->> 'first_due', '')::date, v_date + 30);
    for v_sort in 1..v_inst loop
      v_each := case when v_sort = v_inst then v_rest - round(v_rest / v_inst, 2) * (v_inst - 1) else round(v_rest / v_inst, 2) end;
      insert into public.bills (kind, description, customer_id, sale_id, due_date, amount, installment_no, installments)
      values ('receber', format('Venda #%s - parcela %s/%s', v_sale.number, v_sort, v_inst), v_customer, v_sale.id,
              (v_due + make_interval(months => v_sort - 1))::date, v_each, v_sort, v_inst);
    end loop;
  elsif v_status <> 'aguardando_pagamento' and v_rest > 0.005 then
    raise exception 'Falta receber R$ %. Lance o pagamento ou use o crediário.', replace(to_char(v_rest, 'FM999990.00'), '.', ',');
  end if;

  -- pedido do catálogo vira venda
  if nullif(p ->> 'request_id', '') is not null then
    update public.catalog_requests set status = 'convertido', sale_id = v_sale.id where id = (p ->> 'request_id')::uuid;
  end if;

  return jsonb_build_object('id', v_sale.id, 'number', v_sale.number, 'total', v_total);
end;
$$;

/* Anda com a venda no funil, mexendo no estoque quando precisa. */
create or replace function public.set_sale_status(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid := (p ->> 'sale_id')::uuid;
  v_to     text := p ->> 'status';
  v        public.sales;
begin
  perform public.require_role('admin', 'gerente', 'vendedor');
  select * into v from public.sales where id = v_id for update;
  if not found or (not public.has_role('admin', 'gerente') and v.seller_id is distinct from auth.uid()) then
    raise exception 'Venda não encontrada.';
  end if;
  if v.status = 'cancelado' then
    raise exception 'Esta venda está cancelada.';
  end if;
  if v_to not in ('aguardando_pagamento', 'pago', 'em_separacao', 'pronto_retirada', 'enviado', 'entregue') then
    raise exception 'Para cancelar, use o botão Cancelar venda.';
  end if;
  if v_to = v.status then
    return jsonb_build_object('status', v.status);
  end if;
  if v.status <> 'aguardando_pagamento' and v_to = 'aguardando_pagamento' then
    raise exception 'A venda não pode voltar para aguardando pagamento.';
  end if;
  if v_to <> 'aguardando_pagamento' and v.balance > 0.005
     and not exists (select 1 from public.bills b where b.sale_id = v_id and b.kind = 'receber' and b.status <> 'cancelada') then
    raise exception 'Falta receber R$ %. Lance o pagamento antes.', replace(to_char(v.balance, 'FM999990.00'), '.', ',');
  end if;
  if v_to <> 'aguardando_pagamento' then
    perform public._sale_stock(v_id, 'out', 'Venda #' || v.number);
  end if;
  update public.sales set
    status = v_to,
    reserved_until = null,
    tracking_code = coalesce(nullif(p ->> 'tracking_code', ''), tracking_code)
  where id = v_id;
  insert into public.sale_status_history (sale_id, from_status, to_status, note)
  values (v_id, v.status, v_to, left(coalesce(p ->> 'note', ''), 200));
  return jsonb_build_object('status', v_to);
end;
$$;

/* Recebe um pagamento depois da venda (sinal, Pix que caiu, resto na entrega). */
create or replace function public.add_payment(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := (p ->> 'sale_id')::uuid;
  v    public.sales;
  s    public.store_settings;
  v_paid date := coalesce(nullif(p ->> 'paid_on', '')::date, (now() at time zone 'America/Sao_Paulo')::date);
begin
  perform public.require_role('admin', 'gerente', 'vendedor');
  select * into v from public.sales where id = v_id for update;
  if not found or (not public.has_role('admin', 'gerente') and v.seller_id is distinct from auth.uid()) then
    raise exception 'Venda não encontrada.';
  end if;
  if v.status = 'cancelado' then
    raise exception 'Esta venda está cancelada.';
  end if;
  if exists (select 1 from public.bills b where b.sale_id = v_id and b.kind = 'receber' and b.status = 'aberta') then
    raise exception 'Esta venda está no crediário: dê baixa nas parcelas em Financeiro → A receber.';
  end if;
  if coalesce(nullif(p ->> 'amount', '')::numeric, 0) > v.balance + 0.005
     and not exists (select 1 from public.sale_payments where id = nullif(p ->> 'id', '')::uuid) then
    raise exception 'O valor passa do que falta receber (R$ %).', replace(to_char(v.balance, 'FM999990.00'), '.', ',');
  end if;
  select * into s from public.store_settings where id = 1;
  perform public._add_payment(v_id, p, s, v_paid);
  select * into v from public.sales where id = v_id;
  -- pagou tudo: sai de "aguardando pagamento" e a peça sai do estoque
  if v.status = 'aguardando_pagamento' and v.balance <= 0.005 then
    perform public._sale_stock(v_id, 'out', 'Venda #' || v.number);
    update public.sales set status = 'pago', reserved_until = null where id = v_id;
    insert into public.sale_status_history (sale_id, from_status, to_status, note) values (v_id, 'aguardando_pagamento', 'pago', 'Pagamento completo');
  end if;
  select * into v from public.sales where id = v_id;
  return jsonb_build_object('status', v.status, 'paid_total', v.paid_total, 'balance', v.balance);
end;
$$;

/* Estorno: lançamento negativo por forma, na data de hoje. O vale volta a ter saldo. */
create or replace function public._reverse_payment(q public.sale_payments, p_date date, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session uuid;
begin
  select id into v_session from public.cash_sessions where opened_by = auth.uid() and closed_at is null;
  if q.method = 'dinheiro' and v_session is null and (select require_cash_session from public.store_settings where id = 1) then
    raise exception 'Abra o caixa antes de devolver dinheiro.';
  end if;
  insert into public.sale_payments (sale_id, method, amount, installments, fee_amount, expected_on, paid_on, credit_id, cash_session_id, reverses_id, notes)
  values (q.sale_id, q.method, -q.amount, q.installments, -q.fee_amount, p_date, p_date, q.credit_id,
          case when q.method = 'dinheiro' then v_session end, q.id, left(p_note, 200));
  if q.credit_id is not null then
    update public.store_credits set balance = balance + q.amount where id = q.credit_id;
  end if;
end;
$$;

create or replace function public.reverse_payment(p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  q public.sale_payments;
begin
  perform public.require_role('admin', 'gerente');
  select * into q from public.sale_payments where id = (p ->> 'payment_id')::uuid for update;
  if not found or q.amount <= 0 then
    raise exception 'Lançamento não encontrado.';
  end if;
  if exists (select 1 from public.sale_payments where reverses_id = q.id) then
    raise exception 'Este lançamento já foi estornado.';
  end if;
  perform public._reverse_payment(q, coalesce(nullif(p ->> 'date', '')::date, (now() at time zone 'America/Sao_Paulo')::date),
                                  coalesce(nullif(p ->> 'reason', ''), 'Estorno'));
  -- parcela do crediário paga por engano volta a ficar em aberto
  update public.bills set status = 'aberta', paid_on = null, paid_method = null
   where id = (select b.id from public.bills b
                where b.sale_id = q.sale_id and b.kind = 'receber' and b.status = 'paga' and b.amount = q.amount and b.description = q.notes
                order by b.installment_no desc nulls last limit 1);
end;
$$;

/*
 * Cancela a venda (nunca apaga). Devolve a peça ao estoque, solta a reserva e
 * cancela as parcelas. refund=true: estorna cada pagamento na data de hoje.
 */
create or replace function public.cancel_sale(p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   uuid := (p ->> 'sale_id')::uuid;
  v_why  text := btrim(coalesce(p ->> 'reason', ''));
  v      public.sales;
  q      public.sale_payments;
  v_date date := coalesce(nullif(p ->> 'date', '')::date, (now() at time zone 'America/Sao_Paulo')::date);
begin
  perform public.require_role('admin', 'gerente', 'vendedor');
  select * into v from public.sales where id = v_id for update;
  if not found then
    raise exception 'Venda não encontrada.';
  end if;
  -- vendedor só cancela pedido dele que ainda não foi pago
  if not public.has_role('admin', 'gerente') and (v.seller_id is distinct from auth.uid() or v.status <> 'aguardando_pagamento') then
    raise exception 'Para cancelar esta venda, chame um gerente.' using errcode = '42501';
  end if;
  if v.status = 'cancelado' then
    return;
  end if;
  if length(v_why) = 0 then
    raise exception 'Informe o motivo do cancelamento.';
  end if;
  if v.returned_total > 0 then
    raise exception 'Esta venda já teve troca ou devolução: não dá para cancelar. Devolva só as peças que faltam.';
  end if;
  perform public._sale_stock(v_id, 'none', 'Cancelamento da venda #' || v.number || ': ' || v_why);
  if coalesce((p ->> 'refund')::boolean, false) then
    for q in select * from public.sale_payments x where x.sale_id = v_id and x.amount > 0
               and not exists (select 1 from public.sale_payments y where y.reverses_id = x.id) loop
      perform public._reverse_payment(q, v_date, 'Estorno do cancelamento');
    end loop;
  end if;
  update public.bills set status = 'cancelada' where sale_id = v_id and status = 'aberta';
  delete from public.coupon_uses where sale_id = v_id;
  update public.sales set status = 'cancelado', cancel_reason = left(v_why, 300), canceled_at = now(), canceled_by = auth.uid(), reserved_until = null
   where id = v_id;
  insert into public.sale_status_history (sale_id, from_status, to_status, note) values (v_id, v.status, 'cancelado', left(v_why, 200));
end;
$$;

/* Reserva que passou do prazo: cancela sozinha e a peça volta a ficar disponível. */
create or replace function public.release_expired_reservations()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  for r in select id, number, status from public.sales
            where status = 'aguardando_pagamento' and reserved_until is not null and reserved_until < now()
              and paid_total <= 0 order by id for update skip locked loop
    perform public._sale_stock(r.id, 'none', 'Reserva expirada da venda #' || r.number);
    delete from public.coupon_uses where sale_id = r.id;
    update public.bills set status = 'cancelada' where sale_id = r.id and status = 'aberta';
    update public.sales set status = 'cancelado', cancel_reason = 'Reserva expirada: pagamento não confirmado no prazo', canceled_at = now(), reserved_until = null
     where id = r.id;
    insert into public.sale_status_history (sale_id, from_status, to_status, note) values (r.id, r.status, 'cancelado', 'Reserva expirada');
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- =====================================================================
--  TROCAS E DEVOLUÇÕES
-- =====================================================================

/*
 * p = { sale_id, kind: 'troca'|'devolucao', reason, notes, refund_method?,
 *       items: [{ sale_item_id, qty, condition: 'vendavel'|'avaria' }] }
 * Peça vendável volta ao estoque. Com defeito vai para "avaria": conta à parte
 * e nunca aparece como disponível. Troca gera vale-troca; devolução estorna
 * no meio escolhido.
 */
create or replace function public.create_return(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s        public.store_settings;
  v        public.sales;
  v_kind   text := p ->> 'kind';
  v_reason text := p ->> 'reason';
  v_ret    public.returns;
  it       jsonb;
  i        public.sale_items;
  v_qty    int;
  v_cond   text;
  v_unit   numeric(12,2);
  v_value  numeric(12,2) := 0;
  v_factor numeric;
  v_gross  numeric(12,2);
  v_code   text;
  v_credit uuid;
  v_method text := nullif(p ->> 'refund_method', '');
  v_date   date := coalesce(nullif(p ->> 'date', '')::date, (now() at time zone 'America/Sao_Paulo')::date);
  v_session uuid;
begin
  perform public.require_role('admin', 'gerente');
  select * into s from public.store_settings where id = 1;
  select * into v from public.sales where id = (p ->> 'sale_id')::uuid for update;
  if not found then
    raise exception 'Venda não encontrada.';
  end if;
  if v.status = 'cancelado' then
    raise exception 'Esta venda está cancelada.';
  end if;
  if v.stock_state <> 'out' then
    raise exception 'A peça desta venda ainda não saiu do estoque. Cancele a venda em vez de trocar.';
  end if;
  if v_kind not in ('troca', 'devolucao') then
    raise exception 'Escolha troca ou devolução.';
  end if;
  if v_reason not in ('tamanho', 'defeito', 'cor', 'arrependimento', 'outro') then
    raise exception 'Informe o motivo.';
  end if;
  if jsonb_array_length(coalesce(p -> 'items', '[]'::jsonb)) = 0 then
    raise exception 'Escolha ao menos uma peça.';
  end if;
  if v_kind = 'devolucao' and v_method is null then
    raise exception 'Escolha como o dinheiro volta para o cliente.';
  end if;
  if v_kind = 'devolucao' and exists (select 1 from public.bills b where b.sale_id = v.id and b.kind = 'receber' and b.status = 'aberta') then
    raise exception 'Esta venda tem parcelas em aberto: cancele ou dê baixa em Financeiro → A receber antes de devolver o dinheiro.';
  end if;

  -- o desconto da venda (cupom, Pix, manual) já foi rateado no valor que volta
  v_gross := v.items_total - v.items_discount;
  v_factor := case when v_gross > 0 then (v.total - v.shipping_fee) / v_gross else 1 end;

  insert into public.returns (sale_id, customer_id, kind, reason, notes, refund_method)
  values (v.id, v.customer_id, v_kind, v_reason, left(coalesce(p ->> 'notes', ''), 500), v_method)
  returning * into v_ret;

  perform 1 from public.product_variants
    where id in (select si.variant_id from public.sale_items si where si.sale_id = v.id and si.variant_id is not null)
    order by id for update;

  for it in select * from jsonb_array_elements(p -> 'items') loop
    v_qty := coalesce(nullif(it ->> 'qty', '')::int, 0);
    v_cond := coalesce(nullif(it ->> 'condition', ''), 'vendavel');
    continue when v_qty <= 0;
    select * into i from public.sale_items where id = (it ->> 'sale_item_id')::uuid and sale_id = v.id for update;
    if not found then
      raise exception 'Item não pertence a esta venda.';
    end if;
    if v_qty > i.qty - i.returned_qty then
      raise exception 'Só restam % de "%" para devolver.', i.qty - i.returned_qty, i.product_name;
    end if;
    v_unit := round((i.total / i.qty) * v_factor, 2);
    v_value := v_value + v_unit * v_qty;
    insert into public.return_items (return_id, sale_item_id, variant_id, qty, condition, unit_value)
    values (v_ret.id, i.id, i.variant_id, v_qty, v_cond, v_unit);
    update public.sale_items set returned_qty = returned_qty + v_qty where id = i.id;
    if i.variant_id is not null then
      if v_cond = 'vendavel' then
        perform public._stock_move(i.variant_id, 'devolucao_cliente', v_qty, 0, null, v_kind || ': ' || v_reason, 'troca', v_ret.id);
      else
        update public.product_variants set damaged = damaged + v_qty where id = i.variant_id;
        perform public._stock_move(i.variant_id, 'avaria', 0, 0, null, v_kind || ': peça com defeito (' || v_qty || ')', 'troca', v_ret.id);
      end if;
    end if;
  end loop;
  if v_value <= 0 then
    raise exception 'Escolha ao menos uma peça.';
  end if;

  update public.sales set returned_total = returned_total + v_value where id = v.id;

  if v_kind = 'troca' then
    v_code := 'VT' || upper(substr(md5(gen_random_uuid()::text), 1, 8));
    insert into public.store_credits (code, customer_id, amount, balance, expires_on, notes)
    values (v_code, v.customer_id, v_value, v_value,
            case when s.credit_valid_days > 0 then v_date + s.credit_valid_days end, 'Troca da venda #' || v.number)
    returning id into v_credit;
    update public.returns set credit_id = v_credit where id = v_ret.id;
  else
    select id into v_session from public.cash_sessions where opened_by = auth.uid() and closed_at is null;
    if v_method = 'dinheiro' and v_session is null and s.require_cash_session then
      raise exception 'Abra o caixa antes de devolver dinheiro.';
    end if;
    insert into public.sale_payments (sale_id, method, amount, expected_on, paid_on, cash_session_id, notes)
    values (v.id, v_method, -v_value, v_date, v_date, case when v_method = 'dinheiro' then v_session end, 'Devolução #' || v_ret.number);
  end if;
  update public.returns set amount = v_value where id = v_ret.id;

  return jsonb_build_object('id', v_ret.id, 'number', v_ret.number, 'amount', v_value, 'credit_code', v_code);
end;
$$;

-- =====================================================================
--  CAIXA: abertura, sangria, suprimento, fechamento
-- =====================================================================

create or replace function public.open_cash(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.cash_sessions;
begin
  perform public.require_role('admin', 'gerente', 'vendedor');
  if exists (select 1 from public.cash_sessions where opened_by = auth.uid() and closed_at is null) then
    raise exception 'Você já tem um caixa aberto.';
  end if;
  insert into public.cash_sessions (opening_amount, notes)
  values (greatest(coalesce(nullif(p ->> 'opening_amount', '')::numeric, 0), 0), left(coalesce(p ->> 'notes', ''), 300))
  returning * into v;
  return jsonb_build_object('id', v.id, 'number', v.number);
end;
$$;

create or replace function public.cash_move(p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.cash_sessions;
begin
  perform public.require_role('admin', 'gerente', 'vendedor');
  select * into v from public.cash_sessions where id = (p ->> 'session_id')::uuid and closed_at is null for update;
  if not found or (v.opened_by <> auth.uid() and not public.has_role('admin', 'gerente')) then
    raise exception 'Caixa não encontrado ou já fechado.';
  end if;
  if length(btrim(coalesce(p ->> 'reason', ''))) = 0 then
    raise exception 'Informe o motivo.';
  end if;
  insert into public.cash_movements (session_id, type, amount, reason)
  values (v.id, p ->> 'type', (p ->> 'amount')::numeric, left(p ->> 'reason', 200));
end;
$$;

/* O esperado é sempre calculado pelo banco; o operador só informa o que contou. */
create or replace function public._cash_expected(p_session uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with pay as (
    select method, coalesce(sum(amount), 0) as total from public.sale_payments where cash_session_id = p_session group by method
  ), mv as (
    select coalesce(sum(case when type = 'suprimento' then amount else -amount end), 0) as total from public.cash_movements where session_id = p_session
  )
  select jsonb_build_object(
    'dinheiro', (select opening_amount from public.cash_sessions where id = p_session)
                + coalesce((select total from pay where method = 'dinheiro'), 0) + (select total from mv),
    'pix', coalesce((select total from pay where method = 'pix'), 0),
    'debito', coalesce((select total from pay where method = 'debito'), 0),
    'credito', coalesce((select total from pay where method = 'credito'), 0),
    'vale_troca', coalesce((select total from pay where method = 'vale_troca'), 0),
    'outro', coalesce((select total from pay where method = 'outro'), 0));
$$;

create or replace function public.cash_summary(p_session uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v public.cash_sessions;
begin
  perform public.require_role('admin', 'gerente', 'vendedor');
  select * into v from public.cash_sessions where id = p_session;
  if not found or (v.opened_by <> auth.uid() and not public.has_role('admin', 'gerente')) then
    raise exception 'Caixa não encontrado.';
  end if;
  return public._cash_expected(p_session);
end;
$$;

create or replace function public.close_cash(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v        public.cash_sessions;
  v_exp    jsonb;
  v_count  jsonb := coalesce(p -> 'counted', '{}'::jsonb);
  v_diff   numeric(12,2);
begin
  perform public.require_role('admin', 'gerente', 'vendedor');
  select * into v from public.cash_sessions where id = (p ->> 'session_id')::uuid and closed_at is null for update;
  if not found or (v.opened_by <> auth.uid() and not public.has_role('admin', 'gerente')) then
    raise exception 'Caixa não encontrado ou já fechado.';
  end if;
  v_exp := public._cash_expected(v.id);
  v_diff := coalesce((v_count ->> 'dinheiro')::numeric, 0) - (v_exp ->> 'dinheiro')::numeric;
  update public.cash_sessions set closed_at = now(), closed_by = auth.uid(), counted = v_count, expected = v_exp, difference = v_diff,
    notes = concat_ws(' · ', nullif(notes, ''), nullif(left(coalesce(p ->> 'notes', ''), 300), ''))
   where id = v.id;
  return jsonb_build_object('expected', v_exp, 'difference', v_diff);
end;
$$;

-- =====================================================================
--  COMPRAS
-- =====================================================================

/* p = { id?, supplier_id, kind, status, ordered_on, expected_on, freight, notes, items: [{ variant_id, qty_ordered, unit_cost }] } */
create or replace function public.save_purchase(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   uuid := nullif(p ->> 'id', '')::uuid;
  v      public.purchases;
  v_st   text := coalesce(nullif(p ->> 'status', ''), 'rascunho');
  v_sum  numeric(12,2);
begin
  perform public.require_role('admin', 'gerente', 'estoquista');
  if v_st not in ('rascunho', 'enviado') then
    raise exception 'Situação inválida.';
  end if;
  if jsonb_array_length(coalesce(p -> 'items', '[]'::jsonb)) = 0 then
    raise exception 'O pedido precisa ter ao menos um item.';
  end if;
  if v_id is not null then
    select * into v from public.purchases where id = v_id for update;
    if not found then
      raise exception 'Pedido de compra não encontrado.';
    end if;
    if v.status not in ('rascunho', 'enviado') then
      raise exception 'Este pedido já foi recebido ou cancelado: não dá para editar.';
    end if;
    update public.purchases set
      supplier_id = nullif(p ->> 'supplier_id', '')::uuid, kind = coalesce(nullif(p ->> 'kind', ''), 'compra'), status = v_st,
      ordered_on = nullif(p ->> 'ordered_on', '')::date, expected_on = nullif(p ->> 'expected_on', '')::date,
      freight = coalesce(nullif(p ->> 'freight', '')::numeric, 0), notes = left(coalesce(p ->> 'notes', ''), 800)
    where id = v_id;
    delete from public.purchase_items where purchase_id = v_id;
  else
    insert into public.purchases (supplier_id, kind, status, ordered_on, expected_on, freight, notes)
    values (nullif(p ->> 'supplier_id', '')::uuid, coalesce(nullif(p ->> 'kind', ''), 'compra'), v_st, nullif(p ->> 'ordered_on', '')::date,
            nullif(p ->> 'expected_on', '')::date, coalesce(nullif(p ->> 'freight', '')::numeric, 0), left(coalesce(p ->> 'notes', ''), 800))
    returning id into v_id;
  end if;
  insert into public.purchase_items (purchase_id, variant_id, qty_ordered, unit_cost)
  select v_id, (x ->> 'variant_id')::uuid, sum((x ->> 'qty_ordered')::int), max(coalesce(nullif(x ->> 'unit_cost', '')::numeric, 0))
    from jsonb_array_elements(p -> 'items') x
   where coalesce(nullif(x ->> 'qty_ordered', '')::int, 0) > 0
   group by (x ->> 'variant_id')::uuid;
  select coalesce(sum(qty_ordered * unit_cost), 0) into v_sum from public.purchase_items where purchase_id = v_id;
  update public.purchases set total = v_sum + freight where id = v_id;
  select * into v from public.purchases where id = v_id;
  return jsonb_build_object('id', v.id, 'number', v.number, 'total', v.total);
end;
$$;

/*
 * Recebimento (pode ser parcial, conferência item a item). Entra no estoque,
 * recalcula o custo médio (frete rateado pelo valor) e cria a conta a pagar.
 *   p = { purchase_id, items: [{ item_id, qty }], create_bill, due_date, installments }
 */
create or replace function public.receive_purchase(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v       public.purchases;
  it      jsonb;
  i       public.purchase_items;
  v_qty   int;
  v_goods numeric(12,2);
  v_fr    numeric;
  v_cost  numeric;
  v_value numeric(12,2) := 0;
  v_type  text;
  v_pending int;
  v_inst  int := least(greatest(coalesce(nullif(p ->> 'installments', '')::int, 1), 1), 24);
  v_due   date := coalesce(nullif(p ->> 'due_date', '')::date, (now() at time zone 'America/Sao_Paulo')::date + 30);
  v_cat   uuid;
  n       int;
  v_each  numeric(12,2);
begin
  perform public.require_role('admin', 'gerente', 'estoquista');
  select * into v from public.purchases where id = (p ->> 'purchase_id')::uuid for update;
  if not found then
    raise exception 'Pedido de compra não encontrado.';
  end if;
  if v.status in ('recebido', 'cancelado') then
    raise exception 'Este pedido já foi recebido ou cancelado.';
  end if;
  select coalesce(sum(qty_ordered * unit_cost), 0) into v_goods from public.purchase_items where purchase_id = v.id;
  v_fr := case when v_goods > 0 then v.freight / v_goods else 0 end;
  v_type := case when v.kind = 'producao' then 'entrada_producao' else 'entrada_compra' end;

  perform 1 from public.product_variants where id in (select variant_id from public.purchase_items where purchase_id = v.id) order by id for update;

  for it in select * from jsonb_array_elements(coalesce(p -> 'items', '[]'::jsonb)) loop
    v_qty := coalesce(nullif(it ->> 'qty', '')::int, 0);
    continue when v_qty <= 0;
    select * into i from public.purchase_items where id = (it ->> 'item_id')::uuid and purchase_id = v.id for update;
    if not found then
      raise exception 'Item não pertence a este pedido.';
    end if;
    if v_qty > i.qty_ordered - i.qty_received then
      raise exception 'Recebendo mais do que falta em um dos itens (falta %).', i.qty_ordered - i.qty_received;
    end if;
    v_cost := i.unit_cost * (1 + v_fr);     -- custo real: peça + frete rateado
    perform public._cost_entry(i.variant_id, v_qty, v_cost);
    perform public._stock_move(i.variant_id, v_type, v_qty, 0, v_cost, 'Pedido de compra #' || v.number, 'compra', v.id);
    update public.purchase_items set qty_received = qty_received + v_qty where id = i.id;
    v_value := v_value + v_qty * v_cost;
  end loop;

  if v_value <= 0 then
    raise exception 'Informe a quantidade recebida em ao menos um item.';
  end if;

  select count(*) into v_pending from public.purchase_items where purchase_id = v.id and qty_received < qty_ordered;
  update public.purchases set status = case when v_pending = 0 then 'recebido' else 'parcial' end where id = v.id;

  if coalesce((p ->> 'create_bill')::boolean, true) then
    select id into v_cat from public.finance_categories where name = 'Compra de mercadoria';
    for n in 1..v_inst loop
      v_each := case when n = v_inst then v_value - round(v_value / v_inst, 2) * (v_inst - 1) else round(v_value / v_inst, 2) end;
      insert into public.bills (kind, description, category_id, supplier_id, purchase_id, due_date, amount, installment_no, installments)
      values ('pagar', format('Compra #%s%s', v.number, case when v_inst > 1 then format(' - parcela %s/%s', n, v_inst) else '' end),
              v_cat, v.supplier_id, v.id, (v_due + make_interval(months => n - 1))::date, v_each, n, v_inst);
    end loop;
  end if;
  return jsonb_build_object('status', case when v_pending = 0 then 'recebido' else 'parcial' end, 'value', v_value);
end;
$$;

create or replace function public.cancel_purchase(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.purchases;
begin
  perform public.require_role('admin', 'gerente');
  select * into v from public.purchases where id = p_id for update;
  if not found then
    raise exception 'Pedido de compra não encontrado.';
  end if;
  if v.status in ('recebido', 'parcial') then
    raise exception 'Este pedido já teve recebimento: não dá para cancelar. Lance a devolução ao fornecedor pelo estoque.';
  end if;
  update public.purchases set status = 'cancelado' where id = p_id;
end;
$$;

-- =====================================================================
--  FINANCEIRO: baixa de conta
-- =====================================================================

/*
 * p = { bill_id, paid_on, method }. Conta de venda (crediário) também lança o
 * pagamento na venda. Conta mensal cria a do mês seguinte ao ser paga.
 */
create or replace function public.pay_bill(p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b      public.bills;
  s      public.store_settings;
  v_paid date := coalesce(nullif(p ->> 'paid_on', '')::date, (now() at time zone 'America/Sao_Paulo')::date);
  v_meth text := coalesce(nullif(p ->> 'method', ''), 'pix');
  v      public.sales;
begin
  perform public.require_role('admin', 'gerente', 'vendedor');
  select * into b from public.bills where id = (p ->> 'bill_id')::uuid for update;
  if not found then
    raise exception 'Conta não encontrada.';
  end if;
  -- parcela de venda o balcão recebe; o resto do financeiro é só do admin
  if not public.has_role('admin') then
    if b.kind <> 'receber' or b.sale_id is null then
      raise exception 'Seu perfil não tem permissão para isso. Peça a um gerente.' using errcode = '42501';
    end if;
    if not public.has_role('gerente') and not exists (select 1 from public.sales x where x.id = b.sale_id and x.seller_id = auth.uid()) then
      raise exception 'Conta não encontrada.';
    end if;
  end if;
  if b.status <> 'aberta' then
    raise exception 'Esta conta já foi baixada ou cancelada.';
  end if;
  update public.bills set status = 'paga', paid_on = v_paid, paid_method = v_meth where id = b.id;
  if b.kind = 'receber' and b.sale_id is not null then
    select * into s from public.store_settings where id = 1;
    perform public._add_payment(b.sale_id, jsonb_build_object('method', v_meth, 'amount', b.amount,
      'notes', coalesce(b.description, '')), s, v_paid);
    select * into v from public.sales where id = b.sale_id for update;
    if v.status = 'aguardando_pagamento' and v.balance <= 0.005 then
      perform public._sale_stock(v.id, 'out', 'Venda #' || v.number);
      update public.sales set status = 'pago', reserved_until = null where id = v.id;
      insert into public.sale_status_history (sale_id, from_status, to_status, note) values (v.id, 'aguardando_pagamento', 'pago', 'Parcelas pagas');
    end if;
  end if;
  if b.recurring = 'mensal' then
    insert into public.bills (kind, description, category_id, supplier_id, due_date, amount, recurring, notes)
    values (b.kind, b.description, b.category_id, b.supplier_id, (b.due_date + interval '1 month')::date, b.amount, 'mensal', b.notes);
  end if;
end;
$$;

-- =====================================================================
--  INVENTÁRIO
-- =====================================================================

create or replace function public.start_inventory(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.inventories;
  v_cat uuid := nullif(p ->> 'category_id', '')::uuid;
begin
  perform public.require_role('admin', 'gerente', 'estoquista');
  if exists (select 1 from public.inventories where status = 'aberto') then
    raise exception 'Já existe uma contagem aberta. Termine ou cancele antes de começar outra.';
  end if;
  insert into public.inventories (category_id, notes) values (v_cat, left(coalesce(p ->> 'notes', ''), 300)) returning * into v;
  insert into public.inventory_items (inventory_id, variant_id, expected)
  select v.id, x.id, x.on_hand
    from public.product_variants x
    join public.products pr on pr.id = x.product_id
   where x.active and pr.deleted_at is null
     and (v_cat is null or pr.category_id = v_cat or pr.category_id in (select id from public.categories where parent_id = v_cat));
  return jsonb_build_object('id', v.id, 'number', v.number);
end;
$$;

create or replace function public.save_inventory_counts(p jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  it jsonb;
  n  int := 0;
  v_id uuid := (p ->> 'inventory_id')::uuid;
begin
  perform public.require_role('admin', 'gerente', 'estoquista');
  if not exists (select 1 from public.inventories where id = v_id and status = 'aberto') then
    raise exception 'Esta contagem já foi encerrada.';
  end if;
  for it in select * from jsonb_array_elements(coalesce(p -> 'counts', '[]'::jsonb)) loop
    update public.inventory_items set counted = nullif(it ->> 'counted', '')::int, counted_at = now()
     where inventory_id = v_id and variant_id = (it ->> 'variant_id')::uuid;
    n := n + 1;
  end loop;
  return n;
end;
$$;

/* Aprova a contagem: só o que foi contado e divergiu vira movimento. Exige gerente. */
create or replace function public.apply_inventory(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id  uuid := (p ->> 'inventory_id')::uuid;
  v_why text := btrim(coalesce(p ->> 'reason', ''));
  v     public.inventories;
  r     record;
  n     int := 0;
begin
  perform public.require_role('admin', 'gerente');
  select * into v from public.inventories where id = v_id and status = 'aberto' for update;
  if not found then
    raise exception 'Esta contagem já foi encerrada.';
  end if;
  perform 1 from public.product_variants where id in (select variant_id from public.inventory_items where inventory_id = v_id) order by id for update;
  for r in select i.variant_id, i.counted, x.on_hand from public.inventory_items i
             join public.product_variants x on x.id = i.variant_id
            where i.inventory_id = v_id and i.counted is not null and i.counted <> x.on_hand order by i.variant_id loop
    if r.counted - r.on_hand < 0 then
      -- contagem mandou o saldo ficar abaixo do reservado? o físico manda
      update public.product_variants set reserved = least(reserved, r.counted) where id = r.variant_id;
    end if;
    update public.product_variants set on_hand = r.counted where id = r.variant_id;
    insert into public.stock_movements (variant_id, type, qty, balance_after, reason, ref_type, ref_id)
    values (r.variant_id, 'inventario', r.counted - r.on_hand, r.counted,
            left(concat_ws(': ', 'Inventário #' || v.number, nullif(v_why, '')), 300), 'inventario', v_id);
    n := n + 1;
  end loop;
  update public.inventories set status = 'aplicado', applied_at = now(), applied_by = auth.uid() where id = v_id;
  return jsonb_build_object('adjusted', n);
end;
$$;

create or replace function public.cancel_inventory(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_role('admin', 'gerente', 'estoquista');
  update public.inventories set status = 'cancelado' where id = p_id and status = 'aberto';
end;
$$;

/* Pedido parcial cujo resto nunca vai chegar: encerra com o que veio. */
create or replace function public.close_purchase(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_role('admin', 'gerente');
  update public.purchases set status = 'recebido', notes = left(concat_ws(' · ', nullif(notes, ''), 'Encerrado sem o restante'), 800)
   where id = p_id and status = 'parcial';
  if not found then
    raise exception 'Só dá para encerrar pedido recebido em parte.';
  end if;
end;
$$;

/*
 * Chegou peça e não tem pedido de compra: soma ao estoque em uma tela.
 *   p = { reason?, items: [{ variant_id, qty, unit_cost? }] }
 * Custo médio atualizado, como numa compra.
 */
create or replace function public.quick_stock_entry(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  it     jsonb;
  v_qty  int;
  v_cost numeric;
  v_ids  uuid[];
  n      int := 0;
  total  int := 0;
  v_why  text := left(coalesce(nullif(btrim(p ->> 'reason'), ''), 'Entrada rápida'), 300);
begin
  perform public.require_role('admin', 'gerente', 'estoquista');
  select array_agg(distinct (x ->> 'variant_id')::uuid) into v_ids from jsonb_array_elements(coalesce(p -> 'items', '[]'::jsonb)) x;
  perform 1 from public.product_variants where id = any (v_ids) order by id for update;
  for it in select * from jsonb_array_elements(coalesce(p -> 'items', '[]'::jsonb)) loop
    v_qty := coalesce(nullif(it ->> 'qty', '')::int, 0);
    continue when v_qty <= 0;
    v_cost := nullif(it ->> 'unit_cost', '')::numeric;
    if v_cost is not null then
      perform public._cost_entry((it ->> 'variant_id')::uuid, v_qty, v_cost);
    end if;
    perform public._stock_move((it ->> 'variant_id')::uuid, 'entrada_compra', v_qty, 0, v_cost, v_why, 'entrada', null);
    n := n + 1;
    total := total + v_qty;
  end loop;
  if n = 0 then
    raise exception 'Digite a quantidade em ao menos um tamanho.';
  end if;
  return jsonb_build_object('lines', n, 'pieces', total);
end;
$$;

/*
 * LGPD: apaga os dados pessoais do cadastro E da cópia guardada nas vendas.
 * As vendas continuam nos relatórios, sem identificação.
 */
create or replace function public.anonymize_customer(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
begin
  perform public.require_role('admin', 'gerente');
  select phone into v_phone from public.customers where id = p_id;
  if length(coalesce(v_phone, '')) >= 10 then
    update public.catalog_requests set customer_name = 'Cliente removido', customer_phone = null, notes = null where customer_phone = v_phone;
    delete from public.stock_alerts where phone = v_phone;
  end if;
  update public.customers set name = 'Cliente removido', phone = '', cpf = '', email = '', instagram = '', birthday = null, cep = '', address = '', city = '',
    size_top = '', size_bottom = '', size_shoes = '', notes = '', marketing_consent = false, deleted_at = now()
   where id = p_id;
  update public.sales set customer_name = 'Cliente removido', customer_phone = '', address = '' where customer_id = p_id;
end;
$$;

-- =====================================================================
--  EQUIPE: funções
-- =====================================================================

/*
 * Só o SQL Editor do Supabase (dono do banco) chama esta: é por onde entra o
 * primeiro administrador. Veja supabase/primeiro_admin.sql.
 */
create or replace function public.bootstrap_admin(p_email text, p_nome text default 'Administrador')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(btrim(p_email));
  if v_id is null then
    raise exception 'Não existe usuário %. Crie primeiro em Authentication → Users.', p_email;
  end if;
  -- conta criada pelo cadastro público ainda sem confirmar o e-mail: quem roda
  -- isto é o dono do banco, então a confirmação por e-mail não é necessária
  begin
    update auth.users set email_confirmed_at = now() where id = v_id and email_confirmed_at is null;
  exception when others then
    raise notice 'Não consegui confirmar o e-mail por aqui: confirme em Authentication → Users.';
  end;
  insert into public.store_members (user_id, nome, role, active) values (v_id, p_nome, 'admin', true)
  on conflict (user_id) do update set role = 'admin', active = true, nome = excluded.nome;
  return 'OK: ' || p_email || ' é administrador.';
end;
$$;

/*
 * O admin coloca alguém na equipe pela tela. A conta nasce antes, no painel do
 * Supabase (Authentication → Users), porque criar login exige a chave secreta,
 * que nunca fica no navegador.
 */
create or replace function public.member_upsert(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   uuid := nullif(p ->> 'user_id', '')::uuid;
  v_role text := coalesce(nullif(p ->> 'role', ''), 'vendedor');
  v_act  boolean := coalesce((p ->> 'active')::boolean, true);
begin
  perform public.require_role('admin');
  if v_id is null then
    select id into v_id from auth.users where lower(email) = lower(btrim(coalesce(p ->> 'email', '')));
    if v_id is null then
      raise exception 'Não encontrei esse e-mail. Crie o login antes no painel do Supabase: Authentication → Users → Add user.';
    end if;
  end if;
  if length(btrim(coalesce(p ->> 'nome', ''))) = 0 then
    raise exception 'Informe o nome.';
  end if;
  -- a loja nunca fica sem administrador
  if (v_role <> 'admin' or not v_act)
     and exists (select 1 from public.store_members where user_id = v_id and role = 'admin' and active)
     and (select count(*) from public.store_members where role = 'admin' and active) <= 1 then
    raise exception 'A loja precisa de ao menos um administrador ativo.';
  end if;
  insert into public.store_members (user_id, nome, role, active, commission_pct, discount_limit)
  values (v_id, btrim(p ->> 'nome'), v_role, v_act, coalesce(nullif(p ->> 'commission_pct', '')::numeric, 0), nullif(p ->> 'discount_limit', '')::numeric)
  on conflict (user_id) do update set nome = excluded.nome, role = excluded.role, active = excluded.active,
    commission_pct = excluded.commission_pct, discount_limit = excluded.discount_limit;
  return jsonb_build_object('user_id', v_id);
end;
$$;

/* Quem está na equipe, com e-mail (só o admin lê auth.users, e só por aqui). */
create or replace function public.members_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_role('admin');
  return coalesce((select jsonb_agg(jsonb_build_object(
      'user_id', m.user_id, 'nome', m.nome, 'role', m.role, 'active', m.active, 'commission_pct', m.commission_pct,
      'discount_limit', m.discount_limit, 'email', u.email,
      'has_pin', exists (select 1 from public.member_secrets x where x.user_id = m.user_id)) order by m.active desc, m.nome)
    from public.store_members m join auth.users u on u.id = m.user_id), '[]'::jsonb);
end;
$$;

/* A tela pergunta "quem sou eu" logo após o login. */
create or replace function public.whoami()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'email', (select email from auth.users where id = auth.uid()),
    'member', public.is_member(),
    'name', (select nome from public.store_members where user_id = auth.uid()),
    'role', public.my_role(),
    'can_see_cost', public.can_see_cost(),
    'can_see_margin', public.can_see_margin(),
    'discount_limit', public._my_discount_limit(),
    'has_pin', exists (select 1 from public.member_secrets where user_id = auth.uid()),
    -- O app confere: banco mais antigo que o app = tela "rode o schema.sql".
    'schema_version', 3
  );
$$;

/*
 * Sinal de vida do GitHub Actions: o plano grátis do Supabase pausa o projeto
 * sem acesso. Não recebe nada nem devolve dado; aproveita para soltar reservas
 * vencidas uma vez por dia, mesmo que ninguém abra o sistema.
 */
create or replace function public.keepalive()
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  perform public.release_expired_reservations();
  return now();
end;
$$;

-- =====================================================================
--  CATÁLOGO PÚBLICO
-- =====================================================================
--
--  index.html é aberto por qualquer pessoa, sem login. Ele NUNCA lê tabela:
--  só chama as funções abaixo, que devolvem o mínimo. Custo, saldo exato,
--  clientes e pedidos nunca saem daqui.

create or replace function public.public_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.store_settings;
  v_now timestamptz := now();
  v_store jsonb;
begin
  -- estoque e preço mudam a toda hora: o Safari não pode reaproveitar a resposta antiga
  perform set_config('response.headers', '[{"Cache-Control": "no-store"}]', true);
  select * into s from public.store_settings where id = 1;
  v_store := jsonb_build_object(
    'store_name', s.store_name, 'tagline', s.tagline, 'whatsapp', s.whatsapp, 'instagram', s.instagram, 'tiktok', s.tiktok,
    'email', s.email, 'address', s.address, 'hours', s.hours, 'about', s.about, 'exchange_policy', s.exchange_policy,
    'shipping_info', s.shipping_info, 'privacy_policy', s.privacy_policy, 'announcement', s.announcement,
    'hero_title', s.hero_title, 'hero_subtitle', s.hero_subtitle, 'hero_image', s.hero_image,
    'pix_discount_pct', s.pix_discount_pct, 'max_installments', s.max_installments, 'free_shipping_over', s.free_shipping_over,
    'exchange_days', s.exchange_days, 'show_low_count', s.show_low_count);
  if not s.catalog_open then
    return jsonb_build_object('open', false, 'store', v_store);
  end if;

  return jsonb_build_object(
    'open', true,
    'now', v_now,
    'store', v_store,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'parent_id', c.parent_id, 'name', c.name, 'slug', c.slug,
               'description', c.description, 'image_url', c.image_url) order by c.sort, c.name)
        from public.categories c where c.visible and c.active), '[]'::jsonb),
    'collections', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'slug', d.slug, 'description', d.description,
               'banner_url', d.banner_url, 'lookbook', d.lookbook, 'launch_at', d.launch_at, 'ends_at', d.ends_at,
               'limited', d.limited, 'total_qty', d.total_qty, 'limit_per_customer', d.limit_per_customer, 'collab', d.collab) order by d.sort, d.launch_at desc nulls last)
        from public.collections d where d.visible and d.active and (d.ends_at is null or d.ends_at > v_now)), '[]'::jsonb),
    'brands', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) order by b.name) from public.brands b where b.active), '[]'::jsonb),
    'colors', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'hex', c.hex) order by c.name) from public.colors c where c.active), '[]'::jsonb),
    'sizes', coalesce((select jsonb_agg(jsonb_build_object('id', z.id, 'label', z.label, 'sort', z.sort, 'grid_id', z.grid_id) order by z.sort) from public.sizes z), '[]'::jsonb),
    'size_charts', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'columns', t.columns, 'rows', t.rows, 'notes', t.notes)) from public.size_charts t), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(item order by item ->> 'created_at' desc)
      from (
        select jsonb_strip_nulls(jsonb_build_object(
          'id', pr.id, 'slug', pr.slug, 'name', pr.name, 'short_desc', pr.short_desc, 'description', pr.description,
          'category_id', pr.category_id,
          'category_ids', coalesce((select jsonb_agg(pc.category_id) from public.product_categories pc where pc.product_id = pr.id), '[]'::jsonb),
          'brand_id', pr.brand_id, 'collection_id', pr.collection_id, 'size_chart_id', coalesce(pr.size_chart_id, cat.size_chart_id),
          'gender', pr.gender, 'fit', pr.fit, 'fabric', pr.fabric, 'gsm', pr.gsm, 'print_type', pr.print_type, 'wash_care', pr.wash_care,
          'tags', pr.tags, 'featured', pr.featured, 'cover_url', pr.cover_url, 'seo_title', pr.seo_title, 'seo_desc', pr.seo_desc,
          'created_at', pr.created_at,
          'is_new', pr.created_at > v_now - make_interval(days => s.new_days),
          'coming_soon', case when col.launch_at > v_now then true end,
          'launch_at', case when col.launch_at > v_now then col.launch_at end,
          'sold_rank', (select coalesce(sum(i.qty), 0) from public.sale_items i join public.sales sa on sa.id = i.sale_id
                         where i.product_id = pr.id and sa.status <> 'cancelado' and sa.sale_date > (v_now - interval '90 days')::date),
          'images', coalesce((select jsonb_agg(jsonb_build_object('url', im.url, 'color_id', im.color_id) order by im.sort)
                                from public.product_images im where im.product_id = pr.id), '[]'::jsonb),
          -- drop fechado: mostra a peça, mas sem o que permite pedir
          'variants', case when col.launch_at > v_now then '[]'::jsonb else coalesce((
             select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'id', x.id, 'color_id', x.color_id, 'size_id', x.size_id,
               'list_price', (public._variant_price(x, pr))[1], 'price', (public._variant_price(x, pr))[2],
               'available', x.on_hand - x.reserved > 0,
               'low', case when x.on_hand - x.reserved between 1 and s.low_stock_threshold then true end,
               'left', case when s.show_low_count and x.on_hand - x.reserved between 1 and s.low_stock_threshold then x.on_hand - x.reserved end
             )) order by z.sort)
             from public.product_variants x join public.sizes z on z.id = x.size_id
             where x.product_id = pr.id and x.active), '[]'::jsonb) end,
          'from_price', (select min((public._variant_price(x, pr))[2]) from public.product_variants x where x.product_id = pr.id and x.active)
        )) as item
        from public.products pr
        left join public.categories cat on cat.id = pr.category_id
        left join public.collections col on col.id = pr.collection_id
        where pr.status = 'ativo' and pr.catalog_visible and pr.deleted_at is null
          and (pr.category_id is null or (cat.visible and cat.active))
          and (pr.collection_id is null or (col.visible and col.active and (col.ends_at is null or col.ends_at > v_now)))
          and (s.sold_out_behavior = 'mostrar' or col.launch_at > v_now
               or exists (select 1 from public.product_variants x where x.product_id = pr.id and x.active and x.on_hand - x.reserved > 0))
      ) t), '[]'::jsonb)
  );
end;
$$;

/*
 * O pedido do catálogo (sem login). Só aceita variação à mostra, o PREÇO vem do
 * banco e não reserva estoque: reserva aberta ao público deixaria qualquer um
 * segurar a loja inteira. A reserva nasce quando o atendente transforma em venda.
 */
create or replace function public.catalog_request(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  s        public.store_settings;
  v_name   text := left(btrim(coalesce(p ->> 'customer_name', '')), 80);
  v_phone  text := nullif(left(regexp_replace(coalesce(p ->> 'customer_phone', ''), '\D', '', 'g'), 30), '');
  v_items  jsonb := '[]'::jsonb;
  v_total  numeric(12,2) := 0;
  v_disc   numeric(12,2) := 0;
  v_coupon text := nullif(upper(btrim(coalesce(p ->> 'coupon_code', ''))), '');
  it       jsonb;
  r        record;
  v_qty    int;
  v_row    public.catalog_requests;
  v_prices numeric[];
begin
  select * into s from public.store_settings where id = 1;
  if not s.catalog_open then
    raise exception 'O catálogo está fechado no momento.';
  end if;
  if length(v_name) = 0 then
    raise exception 'Informe seu nome.';
  end if;
  if jsonb_typeof(p -> 'items') is distinct from 'array'
     or jsonb_array_length(p -> 'items') = 0 or jsonb_array_length(p -> 'items') > 30 then
    raise exception 'A sacola precisa ter de 1 a 30 itens.';
  end if;
  perform public._throttle('pedido', 8, interval '1 hour', 300);
  if v_phone is not null and (select count(*) from public.catalog_requests
       where customer_phone = v_phone and created_at > now() - interval '1 hour') >= 8 then
    raise exception 'Muitos pedidos agora. Mande a mensagem direto no WhatsApp da loja.';
  end if;

  for it in select * from jsonb_array_elements(p -> 'items') loop
    v_qty := least(greatest(coalesce(nullif(it ->> 'qty', '')::int, 1), 1), 20);
    select x.id, x.on_hand - x.reserved as avail, pr.name, c.name as cname, z.label as slabel, col.limit_per_customer as climit, col.launch_at as launch, col.ends_at as ends
      into r
      from public.product_variants x
      join public.products pr on pr.id = x.product_id
      join public.colors c on c.id = x.color_id
      join public.sizes z on z.id = x.size_id
      left join public.categories cat on cat.id = pr.category_id
      left join public.collections col on col.id = pr.collection_id
     where x.id = nullif(it ->> 'variant_id', '')::uuid
       and x.active and pr.status = 'ativo' and pr.catalog_visible and pr.deleted_at is null
       and (pr.category_id is null or (cat.visible and cat.active));
    continue when not found;
    continue when r.launch is not null and r.launch > now();
    continue when r.ends is not null and r.ends <= now();
    if r.climit is not null then
      v_qty := least(v_qty, r.climit);
    end if;
    select public._variant_price(x, pr) into v_prices
      from public.product_variants x join public.products pr on pr.id = x.product_id where x.id = r.id;
    continue when coalesce(v_prices[2], 0) <= 0;
    v_items := v_items || jsonb_build_object(
      'variant_id', r.id, 'name', r.name, 'color', r.cname, 'size', r.slabel, 'qty', v_qty, 'unit_price', v_prices[2],
      'available', r.avail >= v_qty);
    v_total := v_total + v_qty * v_prices[2];
  end loop;

  if jsonb_array_length(v_items) = 0 then
    raise exception 'Os produtos da sacola não estão mais disponíveis.';
  end if;

  if v_coupon is not null then
    begin
      select d.discount into v_disc from public._coupon_discount(v_coupon, v_total, null) d;
    exception when others then
      v_disc := 0;
      v_coupon := null;
    end;
  end if;

  insert into public.catalog_requests (customer_name, customer_phone, delivery_pref, notes, coupon_code, items, total, discount, client_key)
  values (v_name, v_phone, left(nullif(btrim(coalesce(p ->> 'delivery_pref', '')), ''), 40), nullif(left(btrim(coalesce(p ->> 'notes', '')), 500), ''),
          v_coupon, v_items, v_total - coalesce(v_disc, 0), coalesce(v_disc, 0), public._client_key())
  returning * into v_row;

  return jsonb_build_object('number', v_row.number, 'total', v_row.total, 'discount', v_row.discount, 'coupon_code', v_row.coupon_code, 'items', v_row.items);
end;
$$;

/* Confere o cupom na sacola. Com freio: senão dava para testar códigos em massa. */
create or replace function public.public_coupon(p_code text, p_total numeric)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  r record;
begin
  perform public._throttle('cupom', 15, interval '10 minutes', 400);
  begin
    select * into r from public._coupon_discount(p_code, greatest(coalesce(p_total, 0), 0), null);
    return jsonb_build_object('ok', true, 'discount', r.discount, 'code', upper(btrim(p_code)));
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
end;
$$;

/* "Avise-me quando chegar" */
create or replace function public.notify_me(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_name  text := left(btrim(coalesce(p ->> 'name', '')), 80);
  v_phone text := left(regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g'), 15);
  v_id    uuid := nullif(p ->> 'variant_id', '')::uuid;
begin
  if length(v_name) = 0 or length(v_phone) < 10 then
    raise exception 'Informe seu nome e WhatsApp com DDD.';
  end if;
  perform public._throttle('avise', 10, interval '1 hour', 300);
  if not exists (select 1 from public.product_variants x join public.products pr on pr.id = x.product_id
                  where x.id = v_id and x.active and pr.status = 'ativo' and pr.catalog_visible and pr.deleted_at is null) then
    raise exception 'Essa peça não está mais disponível.';
  end if;
  insert into public.stock_alerts (variant_id, customer_name, phone, client_key)
  values (v_id, v_name, v_phone, public._client_key())
  on conflict (variant_id, phone) where notified_at is null do nothing;
  return jsonb_build_object('ok', true);
end;
$$;

/* Erros do celular do cliente (sem login). Teto de 100 por dia e 10 por chamada. */
create or replace function public.log_client_error(p jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.client_errors
       where created_at > now() - interval '1 day' and context ->> 'source' = 'catalogo') >= 100 then
    return;
  end if;
  insert into public.client_errors (message, stack, url, user_agent, app_version, context)
  select left(btrim(x ->> 'message'), 500), left(x ->> 'stack', 1500), left(x ->> 'url', 300),
         left(x ->> 'user_agent', 300), left(x ->> 'app_version', 20),
         case when jsonb_typeof(x -> 'context') = 'object' and pg_column_size(x -> 'context') < 2000
              then x -> 'context' else '{}'::jsonb end || jsonb_build_object('source', 'catalogo')
    from (select e from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else jsonb_build_array(p) end) e limit 10) t(x)
   where length(btrim(coalesce(x ->> 'message', ''))) > 0;
end;
$$;

-- =====================================================================
--  RLS E PERMISSÕES
-- =====================================================================

do $$
declare
  t text;
begin
  -- tudo trancado por padrão: anônimo não lê nem grava nenhuma tabela
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated, public', t);
  end loop;
end;
$$;

-- helper: recria uma política
create or replace function public._policy(p_table text, p_name text, p_cmd text, p_expr text)
returns void
language plpgsql
as $$
begin
  execute format('drop policy if exists %I on public.%I', p_name, p_table);
  if p_cmd = 'insert' then
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)', p_name, p_table, p_expr);
  elsif p_cmd = 'select' or p_cmd = 'delete' then
    execute format('create policy %I on public.%I for %s to authenticated using (%s)', p_name, p_table, p_cmd, p_expr);
  else
    execute format('create policy %I on public.%I for %s to authenticated using (%s) with check (%s)', p_name, p_table, p_cmd, p_expr, p_expr);
  end if;
end;
$$;

do $$
declare
  t text;
  member_ text := '(select public.is_member())';
  mgr     text := '(select public.has_role(''admin'', ''gerente''))';
  adm     text := '(select public.has_role(''admin''))';
  stock   text := '(select public.can_see_cost())';
  sellers text := '(select public.has_role(''admin'', ''gerente'', ''vendedor''))';
begin
  -- leitura para toda a equipe; escrita para gerente e admin (cadastros)
  foreach t in array array['categories', 'brands', 'collections', 'colors', 'size_grids', 'sizes', 'size_charts', 'promotions'] loop
    perform public._policy(t, 'equipe_le', 'select', member_);
    perform public._policy(t, 'gerente_escreve', 'all', mgr);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;

  -- produto: leitura direta; escrita só pelas funções
  foreach t in array array['products', 'product_categories', 'product_images', 'product_variants'] loop
    perform public._policy(t, 'equipe_le', 'select', member_);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
  perform public._policy('products', 'gerente_edita', 'update', mgr);
  grant update (catalog_visible, featured, status) on public.products to authenticated;
  perform public._policy('product_variants', 'gerente_edita', 'update', mgr);
  grant update (stock_min, active) on public.product_variants to authenticated;

  -- custo: a porta que o vendedor não tem
  perform public._policy('variant_costs', 'custo_le', 'select', stock);
  grant select on public.variant_costs to authenticated;
  perform public._policy('stock_movements', 'custo_le', 'select', stock);
  grant select on public.stock_movements to authenticated;
  perform public._policy('price_history', 'gerente_le', 'select', mgr);
  grant select on public.price_history to authenticated;
  perform public._policy('sale_item_costs', 'margem_le', 'select', '(select public.can_see_margin())');
  grant select on public.sale_item_costs to authenticated;

  -- configurações: todos leem, só o admin muda
  perform public._policy('store_settings', 'equipe_le', 'select', member_);
  perform public._policy('store_settings', 'admin_muda', 'update', adm);
  grant select, update on public.store_settings to authenticated;

  -- equipe: nomes para todos; mudanças só por função
  perform public._policy('store_members', 'equipe_le', 'select', member_);
  grant select on public.store_members to authenticated;

  -- clientes: estoquista não vê dado pessoal (LGPD)
  perform public._policy('customers', 'vendas_le', 'select', sellers);
  perform public._policy('customers', 'vendas_cria', 'insert', sellers);
  perform public._policy('customers', 'vendas_edita', 'update', sellers);
  grant select, insert, update on public.customers to authenticated;

  -- fornecedores e compras
  perform public._policy('suppliers', 'estoque_tudo', 'all', stock);
  grant select, insert, update, delete on public.suppliers to authenticated;
  foreach t in array array['purchases', 'purchase_items'] loop
    perform public._policy(t, 'estoque_le', 'select', stock);
    execute format('grant select on public.%I to authenticated', t);
  end loop;

  -- vendas: gerente vê todas; vendedor, só as dele
  perform public._policy('sales', 'vendas_le', 'select', '(select public.has_role(''admin'', ''gerente'')) or seller_id = (select auth.uid()) and (select public.has_role(''vendedor''))');
  grant select on public.sales to authenticated;
  perform public._policy('sale_items', 'vendas_le', 'select', 'exists (select 1 from public.sales v where v.id = sale_id)');
  grant select on public.sale_items to authenticated;
  perform public._policy('sale_payments', 'vendas_le', 'select', 'exists (select 1 from public.sales v where v.id = sale_id)');
  grant select on public.sale_payments to authenticated;
  perform public._policy('sale_status_history', 'vendas_le', 'select', 'exists (select 1 from public.sales v where v.id = sale_id)');
  grant select on public.sale_status_history to authenticated;

  -- trocas, vales e cupons: gerência
  foreach t in array array['returns', 'return_items', 'store_credits', 'coupon_uses', 'discount_approvals'] loop
    perform public._policy(t, 'gerente_le', 'select', mgr);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
  perform public._policy('coupons', 'gerente_tudo', 'all', mgr);
  grant select, insert, update, delete on public.coupons to authenticated;

  -- caixa: cada operador vê o dele; gerente, todos
  perform public._policy('cash_sessions', 'caixa_le', 'select', '(select public.has_role(''admin'', ''gerente'')) or opened_by = (select auth.uid())');
  grant select on public.cash_sessions to authenticated;
  perform public._policy('cash_movements', 'caixa_le', 'select', 'exists (select 1 from public.cash_sessions c where c.id = session_id)');
  grant select on public.cash_movements to authenticated;

  -- financeiro: só admin
  perform public._policy('bills', 'admin_tudo', 'all', adm);
  perform public._policy('bills', 'vendas_le_parcelas', 'select',
    'kind = ''receber'' and sale_id is not null and (select public.has_role(''gerente'', ''vendedor'')) and exists (select 1 from public.sales v where v.id = sale_id)');
  grant select, insert, update, delete on public.bills to authenticated;
  perform public._policy('finance_categories', 'admin_tudo', 'all', adm);
  grant select, insert, update, delete on public.finance_categories to authenticated;

  -- inventário
  foreach t in array array['inventories', 'inventory_items'] loop
    perform public._policy(t, 'estoque_le', 'select', stock);
    execute format('grant select on public.%I to authenticated', t);
  end loop;

  -- catálogo: pedidos e avise-me nascem pela função pública
  perform public._policy('catalog_requests', 'vendas_le', 'select', sellers);
  perform public._policy('catalog_requests', 'vendas_muda', 'update', sellers);
  grant select on public.catalog_requests to authenticated;
  grant update (status, sale_id) on public.catalog_requests to authenticated;
  perform public._policy('stock_alerts', 'vendas_le', 'select', sellers);
  perform public._policy('stock_alerts', 'vendas_muda', 'update', sellers);
  perform public._policy('stock_alerts', 'vendas_apaga', 'delete', sellers);
  grant select, delete on public.stock_alerts to authenticated;
  grant update (notified_at) on public.stock_alerts to authenticated;

  -- auditoria e diagnóstico
  perform public._policy('audit_log', 'admin_le', 'select', adm);
  grant select on public.audit_log to authenticated;
  perform public._policy('client_errors', 'admin_le', 'select', adm);
  perform public._policy('client_errors', 'admin_apaga', 'delete', adm);
  perform public._policy('client_errors', 'equipe_grava', 'insert', member_);
  grant select, insert, delete on public.client_errors to authenticated;
end;
$$;

drop function if exists public._policy(text, text, text, text);

-- identidade gerada na tabela de erros; anônimo não mexe em sequência nenhuma
revoke all on all sequences in schema public from anon;
grant usage, select on all sequences in schema public to authenticated;

-- =====================================================================
--  FUNÇÕES: tranca geral
-- =====================================================================
--  O Supabase dá EXECUTE de toda função nova para "anon" e "public". Aqui a
--  porta fecha para todas e só reabre o necessário. As abertas ao mundo são
--  exatamente estas (o teste tests/db confere a lista):
--    keepalive, public_catalog, catalog_request, public_coupon, notify_me, log_client_error

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end;
$$;

grant execute on function public.keepalive() to anon, authenticated;
grant execute on function public.public_catalog() to anon, authenticated;
grant execute on function public.catalog_request(jsonb) to anon, authenticated;
grant execute on function public.public_coupon(text, numeric) to anon, authenticated;
grant execute on function public.notify_me(jsonb) to anon, authenticated;
grant execute on function public.log_client_error(jsonb) to anon, authenticated;

-- as políticas de RLS chamam estas com o papel de quem está logado
grant execute on function public.my_role() to authenticated;
grant execute on function public.is_member() to authenticated;
grant execute on function public.has_role(text[]) to authenticated;
grant execute on function public.can_see_cost() to authenticated;
grant execute on function public.can_see_margin() to authenticated;

-- as telas chamam estas (cada uma confere o perfil na primeira linha)
grant execute on function public.whoami() to authenticated;
grant execute on function public.adjust_stock(jsonb) to authenticated;
grant execute on function public.save_product(jsonb) to authenticated;
grant execute on function public.delete_product(uuid) to authenticated;
grant execute on function public.delete_category(uuid, uuid) to authenticated;
grant execute on function public.set_prices(jsonb) to authenticated;
grant execute on function public.check_manager_pin(text, numeric) to authenticated;
grant execute on function public.set_my_pin(text) to authenticated;
grant execute on function public.check_coupon(text, numeric, uuid) to authenticated;
grant execute on function public.find_credit(text) to authenticated;
grant execute on function public.save_sale(jsonb) to authenticated;
grant execute on function public.set_sale_status(jsonb) to authenticated;
grant execute on function public.add_payment(jsonb) to authenticated;
grant execute on function public.reverse_payment(jsonb) to authenticated;
grant execute on function public.cancel_sale(jsonb) to authenticated;
grant execute on function public.release_expired_reservations() to authenticated;
grant execute on function public.create_return(jsonb) to authenticated;
grant execute on function public.open_cash(jsonb) to authenticated;
grant execute on function public.cash_move(jsonb) to authenticated;
grant execute on function public.cash_summary(uuid) to authenticated;
grant execute on function public.close_cash(jsonb) to authenticated;
grant execute on function public.save_purchase(jsonb) to authenticated;
grant execute on function public.receive_purchase(jsonb) to authenticated;
grant execute on function public.cancel_purchase(uuid) to authenticated;
grant execute on function public.close_purchase(uuid) to authenticated;
grant execute on function public.quick_stock_entry(jsonb) to authenticated;
grant execute on function public.anonymize_customer(uuid) to authenticated;
grant execute on function public.pay_bill(jsonb) to authenticated;
grant execute on function public.start_inventory(jsonb) to authenticated;
grant execute on function public.save_inventory_counts(jsonb) to authenticated;
grant execute on function public.apply_inventory(jsonb) to authenticated;
grant execute on function public.cancel_inventory(uuid) to authenticated;
grant execute on function public.member_upsert(jsonb) to authenticated;
grant execute on function public.members_list() to authenticated;

-- =====================================================================
--  FOTOS (Supabase Storage)
-- =====================================================================
--  Pasta pública para leitura (o catálogo mostra as fotos sem login); só
--  gerente e admin enviam, trocam ou apagam. As fotos são reduzidas no aparelho
--  antes de subir: o plano grátis tem 1 GB.

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('produtos', 'produtos', true, 1048576, array['image/webp', 'image/jpeg', 'image/png'])
    on conflict (id) do update set public = true, file_size_limit = 1048576,
      allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png'];

    -- Apagar uma foto pela API exige poder "enxergar" o arquivo (select) além do delete.
    execute 'drop policy if exists produtos_select on storage.objects';
    execute 'create policy produtos_select on storage.objects for select to authenticated
             using (bucket_id = ''produtos'' and public.has_role(''admin'', ''gerente''))';
    execute 'drop policy if exists produtos_insert on storage.objects';
    execute 'create policy produtos_insert on storage.objects for insert to authenticated
             with check (bucket_id = ''produtos'' and public.has_role(''admin'', ''gerente''))';
    execute 'drop policy if exists produtos_update on storage.objects';
    execute 'create policy produtos_update on storage.objects for update to authenticated
             using (bucket_id = ''produtos'' and public.has_role(''admin'', ''gerente''))';
    execute 'drop policy if exists produtos_delete on storage.objects';
    execute 'create policy produtos_delete on storage.objects for delete to authenticated
             using (bucket_id = ''produtos'' and public.has_role(''admin'', ''gerente''))';
  end if;
end;
$$;

-- =====================================================================
--  TEMPO REAL (celular e computador sincronizados)
-- =====================================================================

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['products', 'product_variants', 'sales', 'sale_payments', 'catalog_requests',
                             'stock_alerts', 'store_settings', 'cash_sessions', 'customers', 'categories'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;
