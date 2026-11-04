/**
 * Roda antes de tudo: aplica tema e modo privacidade já salvos para a página
 * não "piscar" branco antes do app carregar.
 *
 * Fica num arquivo separado (em vez de inline no HTML) porque a política de
 * segurança do site proíbe script embutido.
 */
try {
  // no catálogo vale a escolha do cliente (botão sol/lua); no sistema, a da loja
  var catalog = !/sistema/.test(location.pathname);
  var theme = catalog ? localStorage.getItem('rota44.catalog.theme') : localStorage.getItem('rota44.theme');
  if (theme === 'dark' || theme === 'light') {
    document.documentElement.setAttribute('data-theme', theme);
  } else if (catalog) {
    // catálogo abre no escuro: é a cara da marca (o cliente pode trocar)
    document.documentElement.setAttribute('data-theme', 'dark');
  }
  if (localStorage.getItem('rota44.privacy') === 'on') {
    document.documentElement.setAttribute('data-privacy', 'on');
  }
} catch (e) {
  /* navegador com armazenamento bloqueado - segue no tema automático */
}
