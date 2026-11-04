-- =====================================================================
--  PRIMEIRO ADMINISTRADOR
--
--  A conta siterota44@gmail.com já foi criada no Supabase. Rode este arquivo no
--  SQL Editor, depois do schema.sql e do seed_base.sql: ele dá o acesso de
--  administrador e confirma o e-mail da conta. Deve aparecer "OK: ... é administrador."
--
--  Se um dia precisar de mais gente na equipe: crie o login em
--  Authentication → Users → Add user e inclua em Ajustes → Equipe.
-- =====================================================================

select public.bootstrap_admin('siterota44@gmail.com', 'Rota 44');
