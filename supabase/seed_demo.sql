-- =====================================================================
--  ROTA 44 - PRODUTOS DE EXEMPLO (opcional)
--
--  Três peças com as fotos da pasta do projeto, para ver o catálogo cheio
--  antes do cadastro de verdade. NOMES, PREÇOS E ESTOQUE SÃO INVENTADOS.
--  Para tirar depois: Produtos → excluir cada uma (ou rode o bloco no fim).
--
--  Rode depois do schema.sql, do seed_base.sql e do primeiro_admin.sql.
-- =====================================================================

do $$
declare
  v_grid_l uuid := (select id from public.size_grids where name = 'Letra adulto');
  v_grid_n uuid := (select id from public.size_grids where name = 'Numérica');
  v_brand  uuid := (select id from public.brands where name = 'Rota 44');
  v_prod   uuid;
  v_seq    int;
  r        record;
  z        record;
  v_var    uuid;
  v_qty    int;
begin
  for r in select * from (values
    ('Camiseta Boxy Mira', 'camiseta-boxy-mira', 'camisetas-boxy', 'Boxy', 'Letra adulto', 'Off-white', 149.90::numeric, 62.00::numeric, '100% algodão', 240, 'Silk', 'assets/demo/camiseta-boxy.webp', 'Boxy com estampa de mira nas costas.'),
    ('Bermuda Jeans Cruz', 'bermuda-jeans-cruz', 'bermuda-jeans', 'Baggy', 'Numérica', 'Preto estonado', 219.90::numeric, 95.00::numeric, 'Jeans 100% algodão', 380, 'Bordado', 'assets/demo/bermuda-jeans.webp', 'Jeans estonado com cruz bordada nos bolsos.'),
    ('Calça Baggy Spike', 'calca-baggy-spike', 'calca-jeans', 'Baggy', 'Numérica', 'Preto estonado', 319.90::numeric, 140.00::numeric, 'Jeans 100% algodão', 380, 'Bordado', 'assets/demo/calca-baggy.webp', 'Baggy com bordado em toda a perna.')
  ) as t(name, slug, cat, fit, grid, color, price, cost, fabric, gsm, print_type, img, descr) loop
    continue when exists (select 1 from public.products where slug = r.slug);
    insert into public.products (name, slug, short_desc, description, category_id, brand_id, grid_id, gender, fit, fabric, gsm, print_type, base_price, cover_url, tags, featured, wash_care)
    values (r.name, r.slug, r.descr, r.descr || ' (Produto de exemplo: troque pelo cadastro real.)',
            (select id from public.categories where slug = r.cat), v_brand, (select id from public.size_grids where name = r.grid),
            'unissex', r.fit, r.fabric, r.gsm, r.print_type, r.price, r.img, array['lançamento'], true, 'Lavar do avesso, em água fria. Não usar secadora.')
    returning id, seq into v_prod, v_seq;
    insert into public.product_images (product_id, url, sort, color_id)
    values (v_prod, r.img, 0, (select id from public.colors where name = r.color));
    for z in select s.* from public.sizes s join public.size_grids g on g.id = s.grid_id
              where g.name = r.grid and s.label in ('P', 'M', 'G', 'GG', '38', '40', '42', '44') order by s.sort loop
      insert into public.product_variants (product_id, color_id, size_id, sku, barcode, stock_min)
      values (v_prod, (select id from public.colors where name = r.color), z.id,
              'R44-' || (select code from public.categories where slug = r.cat) || '-' || public._fit_code(r.fit) || '-' || lpad(v_seq::text, 3, '0') || '-' || (select code from public.colors where name = r.color) || '-' || z.label,
              public._next_barcode(), 1)
      returning id into v_var;
      v_qty := case when z.sort % 4 = 0 then 2 else 6 end;
      perform public._cost_entry(v_var, v_qty, r.cost);
      perform public._stock_move(v_var, 'estoque_inicial', v_qty, 0, r.cost, 'Produto de exemplo', 'produto', v_prod);
    end loop;
  end loop;
end;
$$;

-- Para remover os exemplos (descomente e rode). Só depois de conferir que não houve venda real deles:
-- update public.products set deleted_at = now(), status = 'arquivado', catalog_visible = false
--  where slug in ('camiseta-boxy-mira', 'bermuda-jeans-cruz', 'calca-baggy-spike');
