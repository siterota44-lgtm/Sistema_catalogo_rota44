-- =====================================================================
--  ROTA 44 - cadastros iniciais: grades, cores, categorias, marca, contas.
--  Rode depois do schema.sql. Pode rodar de novo: não duplica nem apaga.
--  Tudo aqui pode ser editado depois pela tela Cadastros.
-- =====================================================================

-- ------------------------------------------------------------ grades --

insert into public.size_grids (name, sort) values
  ('Letra adulto', 1), ('Numérica', 2), ('Calçados', 3), ('Bonés', 4), ('Tamanho único', 5)
on conflict (name) do nothing;

insert into public.sizes (grid_id, label, sort)
select g.id, s.label, s.ord
from public.size_grids g
join (values
  ('Letra adulto', 'PP', 1), ('Letra adulto', 'P', 2), ('Letra adulto', 'M', 3), ('Letra adulto', 'G', 4),
  ('Letra adulto', 'GG', 5), ('Letra adulto', 'XG', 6), ('Letra adulto', 'XGG', 7),
  ('Numérica', '36', 1), ('Numérica', '38', 2), ('Numérica', '40', 3), ('Numérica', '42', 4),
  ('Numérica', '44', 5), ('Numérica', '46', 6), ('Numérica', '48', 7),
  ('Calçados', '34', 1), ('Calçados', '35', 2), ('Calçados', '36', 3), ('Calçados', '37', 4), ('Calçados', '38', 5), ('Calçados', '39', 6),
  ('Calçados', '40', 7), ('Calçados', '41', 8), ('Calçados', '42', 9), ('Calçados', '43', 10), ('Calçados', '44', 11),
  ('Bonés', 'Ajustável', 1), ('Bonés', '56', 2), ('Bonés', '57', 3), ('Bonés', '58', 4), ('Bonés', '59', 5), ('Bonés', '60', 6),
  ('Tamanho único', 'U', 1)
) as s(grid, label, ord) on s.grid = g.name
on conflict (grid_id, label) do nothing;

-- ------------------------------------------------------------- cores --

insert into public.colors (name, hex, code) values
  ('Preto', '#111111', 'PRT'), ('Branco', '#f7f7f7', 'BRC'), ('Off-white', '#f1ecdf', 'OFF'), ('Cinza', '#8b8d91', 'CIN'),
  ('Cinza mescla', '#b6b8bb', 'MES'), ('Grafite', '#3b3d42', 'GRF'), ('Vermelho', '#d40000', 'VRM'), ('Vinho', '#5e1420', 'VIN'),
  ('Azul marinho', '#1a2545', 'MAR'), ('Azul', '#2456c6', 'AZL'), ('Azul claro', '#8fb8de', 'AZC'), ('Verde', '#2e6b3f', 'VRD'),
  ('Verde militar', '#4b5320', 'MIL'), ('Bege', '#d6c6a5', 'BGE'), ('Caqui', '#a89770', 'CAQ'), ('Marrom', '#5a3a22', 'MRM'),
  ('Amarelo', '#e8c200', 'AMA'), ('Laranja', '#e0691a', 'LAR'), ('Rosa', '#e58fb0', 'RSA'), ('Roxo', '#5d3a9b', 'RXO'),
  ('Jeans escuro', '#2a3548', 'JES'), ('Jeans claro', '#7f9bbd', 'JCL'), ('Preto estonado', '#34363a', 'EST'), ('Única', '#888888', 'UNI')
on conflict (name) do nothing;

-- ------------------------------------------------------------- marca --

insert into public.brands (name, is_own) values ('Rota 44', true) on conflict (name) do nothing;

-- -------------------------------------------------------- categorias --
-- Árvore do guia da loja. code = as três letras da categoria no SKU.

insert into public.categories (name, slug, code, sort) values
  ('Roupas', 'roupas', 'ROU', 1),
  ('Calçados', 'calcados', 'CLC', 2),
  ('Acessórios', 'acessorios', 'ACE', 3)
on conflict (slug) do nothing;

insert into public.categories (parent_id, name, slug, code, sort)
select p.id, c.name, c.slug, c.code, c.ord
from (values
  ('roupas', 'Camisetas', 'camisetas', 'CAM', 1),
  ('roupas', 'Moletons', 'moletons', 'MOL', 2),
  ('roupas', 'Jaquetas e casacos', 'jaquetas', 'JAQ', 3),
  ('roupas', 'Calças', 'calcas', 'CAL', 4),
  ('roupas', 'Bermudas e shorts', 'bermudas', 'BER', 5),
  ('roupas', 'Camisas', 'camisas', 'CMS', 6),
  ('roupas', 'Conjuntos', 'conjuntos', 'CON', 7),
  ('roupas', 'Feminino', 'feminino', 'FEM', 8),
  ('calcados', 'Tênis', 'tenis', 'TEN', 1),
  ('calcados', 'Chinelos e slides', 'chinelos', 'CHI', 2),
  ('calcados', 'Meias', 'meias', 'MEI', 3),
  ('acessorios', 'Bonés', 'bones', 'BON', 1),
  ('acessorios', 'Toucas e gorros', 'toucas', 'TOU', 2),
  ('acessorios', 'Bags', 'bags', 'BAG', 3),
  ('acessorios', 'Correntes e joias', 'correntes', 'COR', 4),
  ('acessorios', 'Óculos', 'oculos', 'OCU', 5),
  ('acessorios', 'Cintos', 'cintos', 'CIN', 6)
) as c(parent, name, slug, code, ord)
join public.categories p on p.slug = c.parent
on conflict (slug) do nothing;

insert into public.categories (parent_id, name, slug, code, sort)
select p.id, c.name, c.slug, c.code, c.ord
from (values
  ('camisetas', 'Oversized', 'camisetas-oversized', 'CAM', 1), ('camisetas', 'Regular', 'camisetas-regular', 'CAM', 2),
  ('camisetas', 'Boxy', 'camisetas-boxy', 'CAM', 3), ('camisetas', 'Regata', 'regatas', 'REG', 4), ('camisetas', 'Manga longa', 'manga-longa', 'CML', 5),
  ('moletons', 'Canguru (hoodie)', 'moletom-canguru', 'MOL', 1), ('moletons', 'Careca (crewneck)', 'moletom-careca', 'MOL', 2), ('moletons', 'Zíper', 'moletom-ziper', 'MOL', 3),
  ('jaquetas', 'Corta-vento', 'corta-vento', 'JAQ', 1), ('jaquetas', 'Puffer', 'puffer', 'JAQ', 2), ('jaquetas', 'Jaqueta jeans', 'jaqueta-jeans', 'JAQ', 3), ('jaquetas', 'Varsity / college', 'varsity', 'JAQ', 4),
  ('calcas', 'Cargo', 'calca-cargo', 'CAL', 1), ('calcas', 'Jeans', 'calca-jeans', 'CAL', 2), ('calcas', 'Jogger / moletom', 'calca-jogger', 'CAL', 3), ('calcas', 'Tactel / nylon', 'calca-tactel', 'CAL', 4),
  ('bermudas', 'Jeans', 'bermuda-jeans', 'BER', 1), ('bermudas', 'Moletom', 'bermuda-moletom', 'BER', 2), ('bermudas', 'Tactel / nylon', 'bermuda-tactel', 'BER', 3), ('bermudas', 'Basquete (mesh)', 'bermuda-mesh', 'BER', 4),
  ('camisas', 'Camisa de time / jersey', 'jersey', 'CMS', 1), ('camisas', 'Botão / flanela', 'flanela', 'CMS', 2)
) as c(parent, name, slug, code, ord)
join public.categories p on p.slug = c.parent
on conflict (slug) do nothing;

-- grade padrão por categoria (o cadastro de produto já vem com ela marcada)
update public.categories c set default_grid_id = g.id
  from public.size_grids g
 where c.default_grid_id is null and (
      (g.name = 'Letra adulto' and c.slug in ('roupas', 'camisetas', 'moletons', 'jaquetas', 'camisas', 'conjuntos', 'feminino', 'camisetas-oversized', 'camisetas-regular', 'camisetas-boxy', 'regatas', 'manga-longa', 'moletom-canguru', 'moletom-careca', 'moletom-ziper', 'corta-vento', 'puffer', 'jaqueta-jeans', 'varsity', 'jersey', 'flanela', 'calca-jogger', 'bermuda-moletom', 'bermuda-tactel', 'bermuda-mesh', 'calca-tactel'))
   or (g.name = 'Numérica' and c.slug in ('calcas', 'bermudas', 'calca-cargo', 'calca-jeans', 'bermuda-jeans'))
   or (g.name = 'Calçados' and c.slug in ('calcados', 'tenis', 'chinelos'))
   or (g.name = 'Bonés' and c.slug = 'bones')
   or (g.name = 'Tamanho único' and c.slug in ('acessorios', 'meias', 'toucas', 'bags', 'correntes', 'oculos', 'cintos')));

-- ------------------------------------------------- tabela de medidas --

insert into public.size_charts (name, columns, rows, notes) values
  ('Camiseta boxy', '["Largura (cm)", "Comprimento (cm)"]',
   '[{"size":"P","values":["56","66"]},{"size":"M","values":["58","68"]},{"size":"G","values":["60","70"]},{"size":"GG","values":["62","72"]}]',
   'Medidas aproximadas, com a peça aberta sobre a mesa. Exemplo: troque pelas medidas reais.'),
  ('Calça baggy', '["Cintura (cm)", "Quadril (cm)", "Comprimento (cm)"]',
   '[{"size":"38","values":["78","110","104"]},{"size":"40","values":["82","114","105"]},{"size":"42","values":["86","118","106"]},{"size":"44","values":["90","122","107"]}]',
   'Medidas aproximadas, com a peça aberta sobre a mesa. Exemplo: troque pelas medidas reais.')
on conflict (name) do nothing;

-- -------------------------------------------------- contas (financeiro) --

insert into public.finance_categories (name, kind) values
  ('Compra de mercadoria', 'despesa'), ('Aluguel', 'despesa'), ('Folha e pró-labore', 'despesa'), ('Energia', 'despesa'),
  ('Internet e telefone', 'despesa'), ('Marketing', 'despesa'), ('Embalagens', 'despesa'), ('Sistema e assinaturas', 'despesa'),
  ('Frete', 'despesa'), ('Impostos', 'despesa'), ('Outras despesas', 'despesa'),
  ('Crediário', 'receita'), ('Outras receitas', 'receita')
on conflict (name) do nothing;

-- ------------------------------------------------- textos iniciais da loja --

update public.store_settings set
  exchange_policy = case when exchange_policy = '' then
    'Trocas em até 30 dias com a peça sem uso, etiqueta e nota. Compras feitas fora da loja física podem ser devolvidas em até 7 dias corridos (direito de arrependimento, Código de Defesa do Consumidor). Confirme as regras com o contador/advogado da loja.'
    else exchange_policy end,
  shipping_info = case when shipping_info = '' then
    'Retirada na loja, motoboy na região ou envio pelos Correios. O valor do frete é combinado no WhatsApp.'
    else shipping_info end,
  privacy_policy = case when privacy_policy = '' then
    'Usamos seu nome e WhatsApp só para atender o seu pedido. Não vendemos nem passamos seus dados para terceiros. Para pedir a exclusão dos seus dados, fale com a loja pelo WhatsApp.'
    else privacy_policy end,
  about = case when about = '' then
    'A Rota 44 é streetwear de verdade: rap, skate, trap e a cultura das ruas em cada peça.'
    else about end
where id = 1;
