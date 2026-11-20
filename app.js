'use strict';
/*
 * Chamados – Posto do Pescador · telas (navegador)
 * Os dados ficam no servidor (Google Apps Script + Planilha Google). Esta página só exibe e envia pedidos.
 * Todas as permissões são conferidas de novo no servidor (apps-script/Codigo.gs).
 * Regras: docs/especificacao-v1.md. Versão local antiga (localStorage): legado/app-prototipo-local.js.
 */

// ===================== Configuração =====================
const API_URL = (window.CHAMADOS_CONFIG && window.CHAMADOS_CONFIG.apiUrl) || '';
const CHAVE_TOKEN = 'chamados.token';
const PERFIS = ['Gerente', 'Frentista', 'Motorista', 'Escritorio', 'Diretoria'];
const PERFIS_REDE = ['Escritorio', 'Diretoria'];
const PRIORIDADES = ['Normal', 'Alta', 'Baixa'];
const PRAZO_HORAS = { 'Alta': 24, 'Normal': 48, 'Baixa': 72 }; // passou do prazo sem fechar = EM ATRASO
const STATUS = ['Aberto', 'Em andamento', 'Aguardando terceiro', 'Fechado'];
const RESULTADOS = ['Resolvido', 'Resolvido parcialmente', 'Não procede'];
const PERIODICIDADES = ['Diária', 'Semanal', 'Quinzenal', 'Mensal', 'Anual'];
const PERFIS_DESTINO = ['Gerente', 'Frentista'];
const MAX_FOTOS = 5;
const MAX_ANEXOS = 5;
const MAX_ANEXO_BYTES = 5 * 1024 * 1024;
const FOTO_LADO_MAX = 1024;
const COR_UNIDADE = { sjb: 'var(--cor-sjb)', lza: 'var(--cor-lza)', aru: 'var(--cor-aru)' };

// ===================== Utilidades =====================
const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dois = (n) => String(n).padStart(2, '0');
function fmtData(iso) { if (!iso) return '—'; const d = new Date(iso); return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()}`; }
function fmtDataHora(iso) { if (!iso) return '—'; const d = new Date(iso); return `${fmtData(iso)} ${dois(d.getHours())}:${dois(d.getMinutes())}`; }
function fmtNum(n, casas = 0) { return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }); }
function fmtDuracao(horas) {
  if (horas == null || isNaN(horas)) return '—';
  if (horas < 1) return `${fmtNum(Math.round(horas * 60))} min`;
  if (horas < 48) return `${fmtNum(horas, 1)} h`;
  return `${fmtNum(horas / 24, 1)} dias`;
}
const numeroChamado = (c) => '#' + String(c.numero).padStart(4, '0');
const normaliza = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function aviso(msg, erro = false) {
  const el = $('#aviso');
  el.textContent = msg; el.className = 'aviso visivel' + (erro ? ' erro' : '');
  clearTimeout(aviso._t); aviso._t = setTimeout(() => { el.className = 'aviso'; }, erro ? 5000 : 3200);
}
function carregando(liga, texto = 'Carregando…') {
  let el = $('#carregando');
  if (!el) { el = document.createElement('div'); el.id = 'carregando'; el.className = 'carregando'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = texto; el.classList.toggle('visivel', liga);
}

// ===================== Comunicação com o servidor =====================
const token = () => { try { return localStorage.getItem(CHAVE_TOKEN) || ''; } catch (e) { return ''; } };
function guardarToken(t) { try { t ? localStorage.setItem(CHAVE_TOKEN, t) : localStorage.removeItem(CHAVE_TOKEN); } catch (e) { /* navegador sem armazenamento */ } }

/** Chama uma ação do servidor. Lança Error com a mensagem para o usuário. */
async function api(acao, dados = {}, { mostrar = true, texto } = {}) {
  if (!API_URL) throw new Error('Endereço do servidor não configurado (config.js).');
  if (mostrar) carregando(true, texto);
  try {
    const r = await fetch(API_URL, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // evita a checagem prévia de CORS
      body: JSON.stringify(Object.assign({ acao, token: token() }, dados)),
    });
    const res = await r.json();
    if (res.sessaoExpirada) { guardarToken(''); db = null; location.hash = '#/login'; throw new Error(res.erro); }
    if (res.trocarSenha && acao !== 'login') { location.hash = '#/senha'; throw new Error(res.erro); }
    if (!res.ok) throw new Error(res.erro || 'Erro no servidor.');
    return res;
  } catch (e) {
    if (e instanceof TypeError) throw new Error('Sem conexão com o servidor. Verifique a internet e tente de novo.');
    throw e;
  } finally { if (mostrar) carregando(false); }
}

// ===================== Dados em memória (vindos do servidor) =====================
let db = null;
async function recarregar(texto) { db = await api('dados', {}, { texto }); return db; }

const unidade = (id) => db.unidades.find((u) => u.id === id);
const setor = (id) => db.setores.find((s) => s.id === id);
const usuario = (id) => db.usuarios.find((u) => u.id === id);
const nomeUnidade = (id) => unidade(id)?.nome ?? '(unidade excluída)';
const nomeSetor = (id) => setor(id)?.nome ?? '(setor excluído)';
const nomeUsuario = (id) => (id ? usuario(id)?.nome ?? '(usuário excluído)' : '—');
const vencido = (c) => c.status !== 'Fechado' && new Date(c.prazoEm) < new Date();
const horasResolucao = (c) => (c.fechadoEm ? (new Date(c.fechadoEm) - new Date(c.abertoEm)) / 3600e3 : null);

// ===================== Sessão e permissões (espelho do servidor, só para a tela) =====================
const sessao = () => db && db.eu;
const ehRede = (u) => PERFIS_REDE.includes(u.perfil);
const podeGerirCadastros = (u) => ehRede(u);
const podeVerPainel = (u) => ehRede(u) || u.perfil === 'Gerente';
const unidadesDo = (u) => (ehRede(u) ? db.unidades.map((x) => x.id) : u.unidades.filter((id) => unidade(id)));
const gerenteDa = (u, unidadeId) => u.perfil === 'Gerente' && u.unidades.includes(unidadeId);
const podeGerirChamado = (u, c) => c.status !== 'Fechado' && (ehRede(u) || gerenteDa(u, c.unidade));
const podeDarAndamento = (u, c) => c.status !== 'Fechado' && (podeGerirChamado(u, c) || c.responsavel === u.id);
const podeFechar = podeDarAndamento;
const chamadosVisiveis = () => db.chamados; // o servidor já filtra

// ===================== Fotos =====================
/** Reduz a foto para no máximo FOTO_LADO_MAX px (JPEG) antes de enviar. */
function lerFoto(arquivo) {
  return new Promise((ok, falha) => {
    if (!arquivo.type.startsWith('image/')) return falha(new Error('O arquivo não é uma imagem.'));
    const leitor = new FileReader();
    leitor.onerror = () => falha(new Error('Não foi possível ler a foto.'));
    leitor.onload = () => {
      const img = new Image();
      img.onerror = () => falha(new Error('Formato de imagem não suportado pelo navegador.'));
      img.onload = () => {
        const escala = Math.min(1, FOTO_LADO_MAX / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * escala); cv.height = Math.round(img.height * escala);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        ok(cv.toDataURL('image/jpeg', 0.72));
      };
      img.src = leitor.result;
    };
    leitor.readAsDataURL(arquivo);
  });
}

/** Campo de fotos e anexos (abertura e fechamento): foto pela câmera ou qualquer arquivo (PDF, planilha…). */
function campoFotos(idCampo, rotulo) {
  return `<div class="campo"><span class="rotulo">${esc(rotulo)} <span class="obrig">*</span></span>
    <div class="fotos" id="${idCampo}"></div>
    <span class="pequeno mudo">Pelo menos 1 foto ou arquivo (até ${MAX_FOTOS}, 5 MB cada). “Foto” abre a câmera no celular; “Arquivo” aceita PDF, planilha ou qualquer outro tipo.</span>
    <span class="erro-campo" id="${idCampo}-erro"></span></div>`;
}
/** Lista para enviar ao servidor: [{ nome, dataUrl }]. */
const paraEnvio = (lista) => lista.map((a) => ({ nome: a.nome, dataUrl: a.dataUrl }));

// Fotos e anexos salvos no servidor: carregados sob demanda e guardados em memória
const cacheFotos = new Map();
const miniaturas = (ids) => `<div class="fotos">${(ids || []).map((id, i) => `<button type="button" data-foto-id="${esc(id)}" aria-label="Abrir anexo ${i + 1}"><span class="mudo pequeno">…</span></button>`).join('')}</div>`;
async function obterFoto(id) {
  if (!cacheFotos.has(id)) cacheFotos.set(id, api('foto', { fotoId: id }, { mostrar: false }));
  return cacheFotos.get(id);
}
function baixar(dataUrl, nome) { const a = document.createElement('a'); a.href = dataUrl; a.download = nome || 'anexo'; document.body.appendChild(a); a.click(); a.remove(); }
function carregarMiniaturas() {
  $$('[data-foto-id]').forEach(async (b) => {
    let r;
    try { r = await obterFoto(b.dataset.fotoId); } catch (e) { b.innerHTML = '<span class="mudo pequeno">erro</span>'; cacheFotos.delete(b.dataset.fotoId); return; }
    const imagem = /^data:image\//.test(r.dataUrl);
    b.innerHTML = imagem ? `<img src="${r.dataUrl}" alt="">` : `<span class="pequeno" style="padding:6px;word-break:break-all">📎 ${esc(r.nome || 'anexo')}</span>`;
    b.title = r.nome || '';
    b.onclick = () => (imagem ? verFoto(r.dataUrl) : baixar(r.dataUrl, r.nome));
  });
}
function verFoto(src) {
  const j = $('#janela');
  j.className = 'janela foto';
  j.innerHTML = `<img src="${src}" alt="Foto ampliada"><div class="pe"><button class="botao secundario" data-fechar style="color:#fff">Fechar</button></div>`;
  $('[data-fechar]', j).onclick = () => j.close();
  j.showModal();
}

// ===================== Janela (formulários) =====================
function abrirJanela(titulo, corpoHtml, { textoOk = 'Salvar', aoConfirmar, aoAbrir } = {}) {
  const j = $('#janela');
  j.className = 'janela';
  j.innerHTML = `<form method="dialog" novalidate><div class="corpo"><h2>${esc(titulo)}</h2>${corpoHtml}</div>
    <div class="pe"><button type="button" class="botao secundario" data-cancelar>Cancelar</button>
    ${aoConfirmar ? `<button type="submit" class="botao">${esc(textoOk)}</button>` : ''}</div></form>`;
  $('[data-cancelar]', j).onclick = () => j.close();
  $('form', j).onsubmit = async (ev) => {
    ev.preventDefault();
    if (!aoConfirmar) return;
    const btn = $('button[type=submit]', j); btn.disabled = true;
    try { if ((await aoConfirmar($('form', j))) !== false) j.close(); } finally { btn.disabled = false; }
  };
  if (aoAbrir) aoAbrir(j);
  j.showModal();
}
function confirmar(texto, aoSim, textoOk = 'Excluir') {
  abrirJanela('Confirmar', `<p>${esc(texto)}</p>`, { textoOk, aoConfirmar: aoSim });
}
const opcoes = (lista, sel) => lista.map((o) => {
  const v = typeof o === 'string' ? o : o.id; const t = typeof o === 'string' ? o : o.nome;
  return `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(t)}</option>`;
}).join('');

/** Executa uma ação no servidor, recarrega os dados e redesenha. Devolve false se falhou. */
async function executar(acao, dados, msgOk, depois) {
  try {
    const r = await api(acao, dados, { texto: 'Salvando…' });
    await recarregar('Atualizando…');
    if (msgOk) aviso(msgOk);
    if (depois) depois(r); else rotear();
    return r;
  } catch (e) { aviso(e.message, true); return false; }
}

// ===================== Selos e ícones =====================
const classeStatus = { 'Aberto': 'st-aberto', 'Em andamento': 'st-andamento', 'Aguardando terceiro': 'st-aguardando', 'Fechado': 'st-fechado' };
const classePrior = { 'Alta': 'pr-alta', 'Normal': 'pr-normal', 'Baixa': 'pr-baixa' };
const seloStatus = (s) => `<span class="selo ${classeStatus[s]}">${esc(s)}</span>`;
const seloPrior = (p) => `<span class="selo ${classePrior[p]}">${esc(p)}</span>`;
const seloVencido = (c) => (vencido(c) ? '<span class="selo vencido">EM ATRASO</span>' : '');
const seloTipo = (c) => (c.tipo === 'Recorrência' ? '<span class="selo st-andamento">Recorrência</span>' : c.tipo === 'Direcionado' ? '<span class="selo st-aguardando">Direcionado</span>' : '');
const ICONES = {
  painel: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>',
  chamados: '<path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  novo: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  relatorios: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  notificacoes: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  recorrentes: '<path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  cadastros: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21 20c0-2.5-1.4-4.6-3.5-5.5"/>',
};
const icone = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[n]}</svg>`;

// ===================== Moldura =====================
const LOGO = `<picture><source srcset="img/logo_posto_do_pescador_negativa.png" media="(prefers-color-scheme: dark)"><img class="logo" src="img/logo_posto_do_pescador.jpg" alt="Posto do Pescador"></picture>`;

function moldura(rota, html) {
  const u = sessao();
  const itens = [
    podeVerPainel(u) && ['#/painel', 'painel', 'Dashboard', 'painel'],
    ['#/chamados', 'chamados', 'Chamados', 'chamados'],
    // submenu "Recorrentes", logo abaixo de Chamados (só Escritorio/Diretoria; no celular o acesso é pela tela Chamados)
    ehRede(u) && ['#/recorrencias', 'recorrencias', 'Recorrentes', 'recorrentes', 'sub'],
    ['#/novo', 'novo', 'Novo chamado', 'novo'],
    podeVerPainel(u) && ['#/relatorios', 'relatorios', 'Relatórios', 'relatorios'],
    ehRede(u) && ['#/notificacoes', 'notificacoes', 'Notificações', 'notificacoes'],
    ['#/cadastros/unidades', 'cadastros', 'Cadastros', 'cadastros'],
  ].filter(Boolean);
  const escopo = ehRede(u) ? 'Rede – Consolidado' : unidadesDo(u).map(nomeUnidade).join(', ');
  $('#app').innerHTML = `
    <header class="topo">${LOGO}
      <div class="titulo"><strong>Chamados</strong><span>${esc(u.nome)} · ${esc(u.perfil)} · ${esc(escopo)}</span></div>
      <a class="sair" href="#/senha" title="Trocar senha">Senha</a>
      <button class="sair" id="sair" title="Sair">Sair</button></header>
    <div class="casca">
      <nav class="menu" aria-label="Menu principal">${itens.map(([h, chave, t, ic, sub]) => `<a href="${h}" class="${[rota === chave ? 'ativo' : '', sub || ''].join(' ').trim()}">${icone(ic)}<span>${t}</span></a>`).join('')}</nav>
      <div><main class="conteudo">${html}</main>
      <footer class="rodape"><span>Posto do Pescador – Rede · Chamados</span><span>${db.modoEnvio === 'real' ? '' : 'E-mails em modo ' + esc(db.modoEnvio)}</span></footer></div>
    </div>`;
  $('#sair').onclick = async () => { try { await api('logout', {}, { mostrar: false }); } catch (e) { /* sai mesmo assim */ } guardarToken(''); db = null; location.hash = '#/login'; };
  carregarMiniaturas();
}

// ===================== Login e troca de senha =====================
function telaLogin() {
  $('#app').innerHTML = `<div class="login"><div class="cartao">
    <img class="logo" src="img/logo_posto_do_pescador.jpg" alt="Posto do Pescador">
    <div class="faixa"></div>
    <h1>Chamados</h1>
    <form id="form-login" novalidate>
      <div class="campo"><label for="l-usuario">Usuário</label><input type="text" id="l-usuario" autocomplete="username" autocapitalize="none" required></div>
      <div class="campo"><label for="l-senha">Senha</label><input type="password" id="l-senha" autocomplete="current-password" required></div>
      <div class="erro-campo" id="l-erro"></div>
      <button class="botao" style="width:100%">Entrar</button>
    </form>
    <p style="text-align:center;margin:14px 0 0"><a href="#/esqueci">Esqueci a senha</a></p>
    ${API_URL ? '' : '<p class="erro-campo">Servidor não configurado: falta o endereço em config.js.</p>'}
  </div></div>`;
  $('#form-login').onsubmit = async (ev) => {
    ev.preventDefault();
    $('#l-erro').textContent = '';
    try {
      const r = await api('login', { usuario: $('#l-usuario').value.trim(), senha: $('#l-senha').value }, { texto: 'Entrando…' });
      guardarToken(r.token);
      if (r.trocarSenha) { location.hash = '#/senha'; return; }
      await recarregar();
      location.hash = podeVerPainel(sessao()) ? '#/painel' : '#/chamados';
    } catch (e) { $('#l-erro').textContent = e.message; }
  };
}

/** Esqueci a senha: pede o link de redefinição para o e-mail cadastrado. */
function telaEsqueci() {
  $('#app').innerHTML = `<div class="login"><div class="cartao">
    <img class="logo" src="img/logo_posto_do_pescador.jpg" alt="Posto do Pescador">
    <div class="faixa"></div>
    <h1>Esqueci a senha</h1>
    <p class="mudo pequeno">Informe seu usuário ou o e-mail cadastrado. Enviaremos para o e-mail cadastrado um link para criar uma nova senha (vale por 1 hora).</p>
    <form id="form-esqueci" novalidate>
      <div class="campo"><label for="e-ident">Usuário ou e-mail</label><input type="text" id="e-ident" autocomplete="username" autocapitalize="none"></div>
      <div class="erro-campo" id="e-erro"></div>
      <button class="botao" style="width:100%">Enviar link</button>
    </form>
    <p style="text-align:center;margin:14px 0 0"><a href="#/login">Voltar para a entrada</a></p>
  </div></div>`;
  $('#form-esqueci').onsubmit = async (ev) => {
    ev.preventDefault();
    $('#e-erro').textContent = '';
    try {
      const r = await api('pedirRedefinicao', { identificador: $('#e-ident').value.trim() }, { texto: 'Enviando…' });
      $('#form-esqueci').outerHTML = `<p class="faixa-leitura">${esc(r.mensagem)}</p>`;
    } catch (e) { $('#e-erro').textContent = e.message; }
  };
}

/** Tela aberta pelo link do e-mail: cria a nova senha. */
function telaRedefinir(codigo) {
  $('#app').innerHTML = `<div class="login"><div class="cartao">
    <img class="logo" src="img/logo_posto_do_pescador.jpg" alt="Posto do Pescador">
    <div class="faixa"></div>
    <h1>Criar nova senha</h1>
    <form id="form-redef" novalidate>
      <div class="campo"><label for="r-nova">Nova senha (mínimo 8 caracteres)</label><input type="password" id="r-nova" autocomplete="new-password"></div>
      <div class="campo"><label for="r-conf">Repita a nova senha</label><input type="password" id="r-conf" autocomplete="new-password"></div>
      <div class="erro-campo" id="r-erro"></div>
      <button class="botao" style="width:100%">Salvar nova senha</button>
    </form>
    <p style="text-align:center;margin:14px 0 0"><a href="#/login">Voltar para a entrada</a></p>
  </div></div>`;
  $('#form-redef').onsubmit = async (ev) => {
    ev.preventDefault();
    const nova = $('#r-nova').value;
    if (nova !== $('#r-conf').value) { $('#r-erro').textContent = 'As senhas não conferem.'; return; }
    try {
      const r = await api('redefinirSenha', { codigo, nova }, { texto: 'Salvando…' });
      guardarToken('');
      aviso(r.mensagem);
      location.hash = '#/login';
    } catch (e) { $('#r-erro').textContent = e.message; }
  };
}

function telaSenha() {
  const obrigatoria = !db;
  const html = `<div class="cartao" style="max-width:420px">
    <h1>Trocar senha</h1>
    ${obrigatoria ? '<p class="faixa-leitura">Sua senha é temporária. Crie uma senha pessoal para continuar.</p>' : ''}
    <form id="form-senha" novalidate>
      <div class="campo"><label for="s-atual">Senha atual</label><input type="password" id="s-atual" autocomplete="current-password"></div>
      <div class="campo"><label for="s-nova">Nova senha (mínimo 8 caracteres)</label><input type="password" id="s-nova" autocomplete="new-password"></div>
      <div class="campo"><label for="s-conf">Repita a nova senha</label><input type="password" id="s-conf" autocomplete="new-password"></div>
      <div class="erro-campo" id="s-erro"></div>
      <div class="acoes"><button class="botao">Salvar senha</button>${obrigatoria ? '' : '<a class="botao secundario" href="#/chamados">Cancelar</a>'}</div>
    </form></div>`;
  if (obrigatoria) $('#app').innerHTML = `<div class="login">${html}</div>`; else moldura('', html);
  $('#form-senha').onsubmit = async (ev) => {
    ev.preventDefault();
    const nova = $('#s-nova').value;
    if (nova !== $('#s-conf').value) { $('#s-erro').textContent = 'As senhas novas não conferem.'; return; }
    try {
      await api('trocarSenha', { atual: $('#s-atual').value, nova }, { texto: 'Salvando…' });
      aviso('Senha alterada.');
      await recarregar();
      location.hash = podeVerPainel(sessao()) ? '#/painel' : '#/chamados';
    } catch (e) { $('#s-erro').textContent = e.message; }
  };
}

// ===================== Dashboard =====================
const filtroPainel = { unidade: '', dias: '30' };

function barras(itens, { cor } = {}) {
  const max = Math.max(1, ...itens.map((i) => i.valor));
  if (!itens.length || itens.every((i) => i.valor === 0)) return '<div class="vazio">Sem chamados neste recorte.</div>';
  return `<div class="barras">${itens.map((i) => `<div class="barra" title="${esc(i.nome)}: ${fmtNum(i.valor)}">
    <span class="nome">${esc(i.nome)}</span>
    <span class="trilho"><span class="preench" style="display:block;width:${(i.valor / max) * 100}%;background:${i.cor || cor || 'var(--verde-pescador)'}"></span></span>
    <span class="val">${fmtNum(i.valor)}</span></div>`).join('')}</div>`;
}
const contar = (lista, chave) => lista.reduce((m, c) => { const k = chave(c); if (k) m[k] = (m[k] || 0) + 1; return m; }, {});
const topN = (mapa, nome, n = 5) => Object.entries(mapa).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ nome: nome(k), valor: v }));

function telaPainel() {
  const u = sessao();
  if (!podeVerPainel(u)) { location.hash = '#/chamados'; return; }
  const minhas = unidadesDo(u);
  if (filtroPainel.unidade && !minhas.includes(filtroPainel.unidade)) filtroPainel.unidade = '';
  const base = chamadosVisiveis().filter((c) => !filtroPainel.unidade || c.unidade === filtroPainel.unidade);
  const desde = filtroPainel.dias ? Date.now() - Number(filtroPainel.dias) * 86400e3 : 0;
  const noPeriodo = (iso) => iso && new Date(iso).getTime() >= desde;
  const pendentes = base.filter((c) => c.status !== 'Fechado');
  const vencidos = pendentes.filter(vencido);
  const altas = pendentes.filter((c) => c.prioridade === 'Alta');
  const fechadosPer = base.filter((c) => c.status === 'Fechado' && noPeriodo(c.fechadoEm));
  const abertosPer = base.filter((c) => noPeriodo(c.abertoEm));
  const mediaH = fechadosPer.length ? fechadosPer.reduce((s, c) => s + horasResolucao(c), 0) / fechadosPer.length : null;
  const rotuloPeriodo = filtroPainel.dias ? `últimos ${filtroPainel.dias} dias` : 'todo o histórico';
  const porUnidade = minhas.filter((id) => !filtroPainel.unidade || id === filtroPainel.unidade)
    .map((id) => ({ nome: nomeUnidade(id), valor: pendentes.filter((c) => c.unidade === id).length, cor: COR_UNIDADE[id] }));
  const porSetor = db.setores.map((s) => ({ nome: s.nome, valor: pendentes.filter((c) => c.setor === s.id).length })).sort((a, b) => b.valor - a.valor);
  const porStatus = STATUS.filter((s) => s !== 'Fechado').map((s) => ({ nome: s, valor: pendentes.filter((c) => c.status === s).length }));
  const quemAbre = topN(contar(abertosPer, (c) => c.abertoPor), nomeUsuario);
  const quemResolve = topN(contar(fechadosPer, (c) => c.fechadoPor), nomeUsuario);
  const criticos = pendentes.filter((c) => vencido(c) || c.prioridade === 'Alta').sort((a, b) => new Date(a.prazoEm) - new Date(b.prazoEm));
  const fonte = `<p class="grafico-fonte">Fonte: sistema de Chamados · ${esc(filtroPainel.unidade ? nomeUnidade(filtroPainel.unidade) : (ehRede(u) ? 'Rede' : 'suas unidades'))}</p>`;
  moldura('painel', `
    <div class="cabecalho-pagina"><div><h1>Dashboard</h1><p class="mudo">Pendentes = situação agora. Fechados, aberturas e tempo médio = ${esc(rotuloPeriodo)}.</p></div><button class="botao secundario" id="b-atualizar">Atualizar</button></div>
    <div class="filtros">
      <div class="campo"><label for="f-uni">Unidade</label><select id="f-uni"><option value="">${ehRede(u) ? 'Rede – todas' : 'Minhas unidades'}</option>${opcoes(minhas.map(unidade), filtroPainel.unidade)}</select></div>
      <div class="campo"><label for="f-dias">Período</label><select id="f-dias">${opcoes([{ id: '7', nome: 'Últimos 7 dias' }, { id: '30', nome: 'Últimos 30 dias' }, { id: '90', nome: 'Últimos 90 dias' }, { id: '', nome: 'Todo o histórico' }], filtroPainel.dias)}</select></div>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="valor">${fmtNum(pendentes.length)}</div><div class="rotulo">Chamados pendentes</div></div>
      <div class="kpi ${vencidos.length ? 'alerta' : ''}"><div class="valor">${fmtNum(vencidos.length)}</div><div class="rotulo">EM ATRASO (prazo estourado)</div></div>
      <div class="kpi ${altas.length ? 'atencao' : ''}"><div class="valor">${fmtNum(altas.length)}</div><div class="rotulo">Prioridade alta pendentes</div></div>
      <div class="kpi"><div class="valor">${fmtNum(fechadosPer.length)}</div><div class="rotulo">Fechados no período</div></div>
      <div class="kpi"><div class="valor">${fmtDuracao(mediaH)}</div><div class="rotulo">Tempo médio de resolução</div></div>
    </div>
    <div class="grade grade-2">
      <section class="cartao"><h2 class="grafico-titulo">Pendentes por unidade</h2>${barras(porUnidade)}${fonte}</section>
      <section class="cartao"><h2 class="grafico-titulo">Gargalos por setor (pendentes)</h2>${barras(porSetor)}${fonte}</section>
      <section class="cartao"><h2 class="grafico-titulo">Pendentes por status</h2>${barras(porStatus, { cor: 'var(--azul-rio)' })}${fonte}</section>
      <section class="cartao"><h2 class="grafico-titulo">Quem mais abre chamados</h2>${barras(quemAbre, { cor: 'var(--azul-rio)' })}${fonte}</section>
      <section class="cartao"><h2 class="grafico-titulo">Quem mais fecha chamados</h2>${barras(quemResolve)}${fonte}</section>
      <section class="cartao"><h2 class="grafico-titulo">EM ATRASO e de prioridade alta</h2>${criticos.length ? criticos.slice(0, 8).map((c) => `<a class="item-chamado" href="#/chamado/${c.id}"><strong>${numeroChamado(c)} · ${esc(c.titulo)}</strong><span class="mudo pequeno">${esc(nomeUnidade(c.unidade))} · ${esc(nomeSetor(c.setor))} · prazo ${fmtDataHora(c.prazoEm)}</span><div class="linha">${seloPrior(c.prioridade)}${seloStatus(c.status)}${seloVencido(c)}</div></a>`).join('') : '<div class="vazio">Nenhum chamado em atraso ou de prioridade alta.</div>'}</section>
    </div>`);
  $('#f-uni').onchange = (e) => { filtroPainel.unidade = e.target.value; telaPainel(); };
  $('#f-dias').onchange = (e) => { filtroPainel.dias = e.target.value; telaPainel(); };
  $('#b-atualizar').onclick = async () => { try { await recarregar('Atualizando…'); telaPainel(); } catch (e) { aviso(e.message, true); } };
}

// ===================== Lista de chamados =====================
const filtroLista = { status: 'pendentes', unidade: '', setor: '', prioridade: '', busca: '' };

function filtrarChamados(lista, f) {
  const b = normaliza(f.busca);
  return lista.filter((c) =>
    (f.status === '' || (f.status === 'pendentes' ? c.status !== 'Fechado' : f.status === 'fila' ? (c.status !== 'Fechado' && !c.responsavel)
      : f.status === 'vencidos' ? vencido(c) : c.status === f.status))
    && (!f.unidade || c.unidade === f.unidade)
    && (!f.setor || c.setor === f.setor)
    && (!f.prioridade || c.prioridade === f.prioridade)
    && (!b || normaliza(`${numeroChamado(c)} ${c.titulo} ${c.descricao}`).includes(b)));
}

// Ordenação da lista: clicar no título da coluna alterna crescente/decrescente (padrão: mais recentes primeiro)
const ordemLista = { coluna: 'abertoEm', crescente: false };
const ORDEM_PRIOR = { 'Alta': 1, 'Normal': 2, 'Baixa': 3 };
const COLUNAS_LISTA = [
  { id: 'numero', nome: 'Nº', valor: (c) => Number(c.numero) },
  { id: 'titulo', nome: 'Título', valor: (c) => normaliza(c.titulo) },
  { id: 'unidade', nome: 'Unidade', valor: (c) => normaliza(nomeUnidade(c.unidade)) },
  { id: 'setor', nome: 'Setor', valor: (c) => normaliza(nomeSetor(c.setor)) },
  { id: 'prioridade', nome: 'Prioridade', valor: (c) => ORDEM_PRIOR[c.prioridade] || 9 },
  { id: 'status', nome: 'Status', valor: (c) => STATUS.indexOf(c.status) },
  { id: 'abertoEm', nome: 'Aberto em', valor: (c) => new Date(c.abertoEm).getTime() },
  { id: 'prazoEm', nome: 'Prazo', valor: (c) => (c.status === 'Fechado' ? Infinity : new Date(c.prazoEm).getTime()) },
  { id: 'responsavel', nome: 'Responsável', valor: (c) => normaliza(c.responsavel ? nomeUsuario(c.responsavel) : '') },
];
function ordenarLista(lista) {
  const col = COLUNAS_LISTA.find((x) => x.id === ordemLista.coluna) || COLUNAS_LISTA[6];
  const s = ordemLista.crescente ? 1 : -1;
  return lista.slice().sort((a, b) => { const va = col.valor(a), vb = col.valor(b); return (va < vb ? -1 : va > vb ? 1 : Number(a.numero) - Number(b.numero)) * s; });
}

function telaChamados() {
  const u = sessao();
  const lista = ordenarLista(filtrarChamados(chamadosVisiveis(), filtroLista));
  const cab = COLUNAS_LISTA.map((col) => {
    const ativa = ordemLista.coluna === col.id;
    return `<th aria-sort="${ativa ? (ordemLista.crescente ? 'ascending' : 'descending') : 'none'}"><button type="button" class="ordenar" data-ordem="${col.id}" title="Ordenar por ${esc(col.nome)}" style="all:unset;cursor:pointer;font-weight:inherit;white-space:nowrap">${esc(col.nome)} ${ativa ? (ordemLista.crescente ? '▲' : '▼') : '<span class="mudo">↕</span>'}</button></th>`;
  }).join('');
  const escopo = ehRede(u) ? 'todos os chamados da rede' : u.perfil === 'Gerente' ? 'chamados das suas unidades' : 'chamados que você abriu ou dos quais é responsável';
  moldura('chamados', `
    <div class="cabecalho-pagina"><div><h1>Chamados</h1><p class="mudo">Você vê ${escopo}.</p></div><div class="acoes"><button class="botao secundario" id="b-atualizar">Atualizar</button>${ehRede(u) ? '<a class="botao secundario" href="#/recorrencias">↻ Recorrentes</a>' : ''}<a class="botao" href="#/novo">＋ Novo chamado</a></div></div>
    <div class="filtros">
      <div class="campo"><label for="f-st">Situação</label><select id="f-st">${opcoes([{ id: 'pendentes', nome: 'Todos, exceto fechados' }, { id: 'fila', nome: 'Fila do Escritório (sem responsável)' }, { id: 'vencidos', nome: 'EM ATRASO' }, ...STATUS.map((s) => ({ id: s, nome: s })), { id: '', nome: 'Todas' }], filtroLista.status)}</select></div>
      <div class="campo"><label for="f-un">Unidade</label><select id="f-un"><option value="">Todas</option>${opcoes(unidadesDo(u).map(unidade), filtroLista.unidade)}</select></div>
      <div class="campo"><label for="f-se">Setor</label><select id="f-se"><option value="">Todos</option>${opcoes(db.setores, filtroLista.setor)}</select></div>
      <div class="campo"><label for="f-pr">Prioridade</label><select id="f-pr"><option value="">Todas</option>${opcoes(PRIORIDADES, filtroLista.prioridade)}</select></div>
      <div class="campo"><label for="f-bu">Buscar</label><input type="search" id="f-bu" value="${esc(filtroLista.busca)}" placeholder="Número, título ou descrição"></div>
    </div>
    <p class="mudo pequeno">${fmtNum(lista.length)} chamado(s)</p>
    ${lista.length ? `
    <div class="tabela-rolagem so-desktop"><table><thead><tr>${cab}</tr></thead><tbody>
      ${lista.map((c) => `<tr class="clicavel" data-id="${c.id}"><td>${numeroChamado(c)}</td><td>${esc(c.titulo)}</td><td>${esc(nomeUnidade(c.unidade))}</td><td>${esc(nomeSetor(c.setor))}</td><td>${seloPrior(c.prioridade)}</td><td>${seloStatus(c.status)} ${seloVencido(c)} ${seloTipo(c)}</td><td>${fmtDataHora(c.abertoEm)}</td><td>${c.status === 'Fechado' ? '—' : fmtDataHora(c.prazoEm)}</td><td>${esc(nomeUsuario(c.responsavel))}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="lista-cartoes">${lista.map((c) => `<a class="item-chamado" href="#/chamado/${c.id}"><strong>${numeroChamado(c)} · ${esc(c.titulo)}</strong><span class="mudo pequeno">${esc(nomeUnidade(c.unidade))} · ${esc(nomeSetor(c.setor))} · ${fmtDataHora(c.abertoEm)}</span><div class="linha">${seloPrior(c.prioridade)}${seloStatus(c.status)}${seloVencido(c)}${seloTipo(c)}</div></a>`).join('')}</div>`
      : '<div class="vazio">Nenhum chamado com esses filtros.</div>'}`);
  const liga = (id, k) => { $(id).onchange = (e) => { filtroLista[k] = e.target.value; telaChamados(); }; };
  liga('#f-st', 'status'); liga('#f-un', 'unidade'); liga('#f-se', 'setor'); liga('#f-pr', 'prioridade');
  $$('[data-ordem]').forEach((b) => b.onclick = () => {
    const col = b.dataset.ordem;
    if (ordemLista.coluna === col) ordemLista.crescente = !ordemLista.crescente;
    else { ordemLista.coluna = col; ordemLista.crescente = true; }
    telaChamados();
  });
  $('#f-bu').oninput = (e) => { filtroLista.busca = e.target.value; clearTimeout(telaChamados._t); telaChamados._t = setTimeout(() => { telaChamados(); const el = $('#f-bu'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 250); };
  $$('tr[data-id]').forEach((tr) => tr.onclick = () => { location.hash = '#/chamado/' + tr.dataset.id; });
  $('#b-atualizar').onclick = async () => { try { await recarregar('Atualizando…'); telaChamados(); } catch (e) { aviso(e.message, true); } };
}

// ===================== Novo chamado =====================
function telaNovo() {
  const u = sessao();
  const minhas = unidadesDo(u);
  const fotos = [];
  if (!minhas.length) {
    moldura('novo', '<h1>Novo chamado</h1><div class="vazio">Seu usuário não tem unidade vinculada. Peça ao Escritorio ou à Diretoria para ajustar o cadastro.</div>');
    return;
  }
  const rede = ehRede(u);
  let ehRecorrente = false; // botão "Chamado Recorrente" (só Escritorio/Diretoria)
  // Gerente → frentistas da unidade; Frentista → gerente da unidade (decidido em 16/11/2026)
  const direcionaLocal = !rede && (u.perfil === 'Gerente' || u.perfil === 'Frentista');
  moldura('novo', `
    <div class="cabecalho-pagina"><div><h1>Novo chamado</h1><p class="mudo">${rede
      ? 'Abra para a fila do Escritório ou direto para gerentes/frentistas (um, um grupo ou todos). Quem recebe responde, dá andamento e fecha com foto ou anexo.'
      : 'Você mesmo classifica o chamado. Ele entra na fila do Escritório, que trata ou redireciona. Toda reclassificação fica no histórico.'}</p></div></div>
    <form id="form-novo" class="cartao" novalidate style="max-width:760px">
      ${rede ? `<div class="campo"><label for="n-para">Para quem <span class="obrig">*</span></label><select id="n-para" required></select>
        <span class="pequeno mudo" id="n-para-info"></span></div>` : ''}
      <div class="grade ${rede ? 'grade-2' : 'grade-3'}">
        ${rede ? '' : `<div class="campo"><label for="n-uni">Unidade <span class="obrig">*</span></label><select id="n-uni" required>${minhas.length > 1 ? '<option value="">Selecione</option>' : ''}${opcoes(minhas.map(unidade), minhas.length === 1 ? minhas[0] : '')}</select></div>`}
        <div class="campo"><label for="n-set">Setor <span class="obrig">*</span></label><select id="n-set" required><option value="">Selecione</option>${opcoes(db.setores)}</select></div>
        <div class="campo"><label for="n-pri">Prioridade <span class="obrig">*</span></label><select id="n-pri" required><option value="">Selecione</option>${opcoes(PRIORIDADES)}</select></div>
      </div>
      ${direcionaLocal ? `<div class="campo"><label for="n-para-local">Para quem</label><select id="n-para-local"></select>
        <span class="pequeno mudo">${u.perfil === 'Gerente' ? 'Você pode abrir direto para um frentista da sua unidade (ou todos).' : 'Você pode abrir direto para o gerente da sua unidade.'} Quem recebe responde, dá andamento e fecha com foto ou anexo.</span></div>` : ''}
      ${rede ? `
      <div class="campo"><button type="button" class="botao secundario" id="n-rec-botao" aria-pressed="false">↻ Chamado Recorrente</button>
        <span class="pequeno mudo" id="n-rec-dica"> Disponível ao escolher uma pessoa ou um grupo em “Para quem”.</span></div>
      <div class="grade grade-3" id="n-rec" hidden>
        <div class="campo"><label for="n-per">Periodicidade <span class="obrig">*</span></label><select id="n-per"><option value="">Selecione</option>${opcoes(PERIODICIDADES)}</select></div>
        <div class="campo"><label for="n-ini">Primeira ocorrência <span class="obrig">*</span></label><input type="date" id="n-ini"></div>
        <div class="campo"><label for="n-fim">Fim da recorrência <span class="obrig">*</span></label><input type="date" id="n-fim"></div>
      </div>
      <p class="mudo pequeno" id="n-rec-info" hidden>Cada ocorrência vira um chamado separado (selo “Recorrência”), aberto automaticamente no início do dia de cada data. O prazo conta pela prioridade a partir da abertura, em horas úteis (Alta 24 h, Normal 48 h, Baixa 72 h).</p>` : ''}
      <p class="mudo pequeno" id="n-prazo"></p>
      <div class="campo"><label for="n-tit">Título <span class="obrig">*</span></label><input type="text" id="n-tit" maxlength="80" placeholder="Ex.: Bomba 03 com vazamento" required></div>
      <div class="campo"><label for="n-desc">Descrição do problema <span class="obrig">*</span></label><textarea id="n-desc" required placeholder="O que aconteceu, onde, desde quando"></textarea></div>
      ${campoFotos('n-fotos', 'Fotos e anexos da abertura')}
      <div class="erro-campo" id="n-erro" style="margin-bottom:10px"></div>
      <div class="acoes"><button class="botao" id="n-enviar">Abrir chamado</button><a class="botao secundario" href="#/chamados">Cancelar</a></div>
    </form>`);
  ligarAnexos('n-fotos', fotos);
  if (rede) { // Escritorio/Diretoria abrem sem foto (decidido em 16/11/2026)
    $('#n-fotos').closest('.campo').querySelector('.obrig').hidden = true;
    $('#n-fotos').closest('.campo').querySelector('.pequeno.mudo').textContent = `Opcional para Escritório e Diretoria (até ${MAX_FOTOS} itens, 5 MB cada). “Foto” abre a câmera no celular; “Arquivo” aceita PDF, planilha ou qualquer outro tipo.`;
  }
  if (direcionaLocal) {
    const montarParaLocal = () => {
      const uni = $('#n-uni').value, atual = $('#n-para-local').value;
      const alvo = u.perfil === 'Gerente' ? 'Frentista' : 'Gerente';
      const pessoas = uni ? db.usuarios.filter((x) => x.perfil === alvo && x.unidades.includes(uni) && x.id !== u.id).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')) : [];
      const grupo = u.perfil === 'Gerente' && pessoas.length > 1 ? [{ id: 'grupo:frentistas:' + uni, nome: `Todos os frentistas de ${nomeUnidade(uni)} (${pessoas.length}) – um chamado para cada` }] : [];
      $('#n-para-local').innerHTML = '<option value="">Fila do Escritório (chamado normal)</option>' + opcoes(grupo.concat(pessoas.map((x) => ({ id: x.id, nome: `${x.nome} (${x.perfil})` }))), atual)
        + (uni && !pessoas.length ? `<option disabled>— nenhum ${alvo.toLowerCase()} cadastrado nesta unidade —</option>` : '');
    };
    $('#n-uni').addEventListener('change', montarParaLocal);
    montarParaLocal();
  }
  const recorrente = () => rede && ehRecorrente;
  const textoPrazo = () => {
    const p = $('#n-pri').value;
    $('#n-prazo').textContent = !p ? '' : recorrente() ? `Cada ocorrência abre no início do dia da data e tem ${PRAZO_HORAS[p]} h úteis para ser finalizada (sábados, domingos e feriados não contam).`
      : `Prazo para finalizar: ${PRAZO_HORAS[p]} h úteis (sábados, domingos e feriados nacionais não contam). Depois disso o chamado fica EM ATRASO.`;
  };
  $('#n-pri').onchange = textoPrazo;
  /**
   * Escritorio/Diretoria não escolhem "Unidade": ela sai do "Para quem" (pedido de 16/11/2026).
   * Valores: 'fila:<unidade>' (chamado normal), 'grupo:...' (um chamado por pessoa) ou '<usuário>@<unidade>'.
   */
  const lerPara = (v) => {
    if (!v) return { unidade: '', para: '' };
    if (v.startsWith('fila:')) return { unidade: v.slice(5), para: '' };
    if (v === 'grupo:gerentes' || v === 'grupo:frentistas') return { unidade: '', para: v };
    if (v.startsWith('grupo:frentistas:')) return { unidade: v.slice('grupo:frentistas:'.length), para: v };
    const [id, uni] = v.split('@'); return { unidade: uni, para: id };
  };
  if (rede) {
    const pessoas = (filtro) => db.usuarios.filter(filtro).length;
    const montarPara = () => {
      const filas = db.unidades.map((un) => ({ id: 'fila:' + un.id, nome: `Fila do Escritório – ${un.nome}` }));
      const grupos = [
        { id: 'grupo:gerentes', nome: `Todos os gerentes – todas as unidades (${pessoas((x) => x.perfil === 'Gerente')})` },
        { id: 'grupo:frentistas', nome: `Todos os frentistas – todas as unidades (${pessoas((x) => x.perfil === 'Frentista')})` },
        ...db.unidades.map((un) => ({ id: 'grupo:frentistas:' + un.id, nome: `Todos os frentistas – ${un.nome} (${pessoas((x) => x.perfil === 'Frentista' && x.unidades.includes(un.id))})` })),
      ];
      // cada pessoa aparece com a unidade; quem atende mais de uma unidade aparece uma vez por unidade
      const lista = db.usuarios.filter((x) => PERFIS_DESTINO.includes(x.perfil))
        .flatMap((x) => x.unidades.filter((id) => unidade(id)).map((id) => ({ id: `${x.id}@${id}`, nome: `${x.nome} (${x.perfil} – ${nomeUnidade(id)})` })))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      $('#n-para').innerHTML = '<option value="">Selecione</option>'
        + `<optgroup label="Chamado normal (fila do Escritório)">${opcoes(filas)}</optgroup>`
        + `<optgroup label="Grupos (um chamado para cada pessoa)">${opcoes(grupos)}</optgroup>`
        + `<optgroup label="Uma pessoa">${opcoes(lista)}</optgroup>`;
      atualizarFormulario();
    };
    const atualizarFormulario = () => {
      const v = $('#n-para').value, para = lerPara(v).para;
      const todos = para === 'grupo:gerentes' || para === 'grupo:frentistas';
      $('#n-para-info').textContent = todos ? 'A unidade de cada chamado será a da própria pessoa.' : para.startsWith('grupo:') ? 'Cada pessoa do grupo recebe um chamado separado.' : '';
      if (!para) ehRecorrente = false;
      $('#n-rec-botao').disabled = !para;
      $('#n-rec-dica').hidden = !!para;
      $('#n-rec-botao').setAttribute('aria-pressed', String(ehRecorrente));
      $('#n-rec-botao').className = 'botao ' + (ehRecorrente ? '' : 'secundario');
      $('#n-rec-botao').textContent = ehRecorrente ? '↻ Chamado Recorrente: SIM' : '↻ Chamado Recorrente';
      $('#n-rec').hidden = !recorrente(); $('#n-rec-info').hidden = !recorrente();
      // foto/anexo da abertura: obrigatório só no chamado normal
      $('#n-fotos').closest('.campo').querySelector('.obrig').hidden = true; // Escritorio/Diretoria: foto/anexo opcional
      textoPrazo();
    };
    $('#n-para').onchange = atualizarFormulario;
    $('#n-rec-botao').onclick = () => { ehRecorrente = !ehRecorrente; atualizarFormulario(); };
    const hoje = new Date(); $('#n-ini').min = $('#n-fim').min = `${hoje.getFullYear()}-${dois(hoje.getMonth() + 1)}-${dois(hoje.getDate())}`;
    montarPara();
  }
  $('#form-novo').onsubmit = async (ev) => {
    ev.preventDefault();
    const dados = { setor: $('#n-set').value, prioridade: $('#n-pri').value, titulo: $('#n-tit').value.trim(), descricao: $('#n-desc').value.trim() };
    const escolhaPara = rede ? $('#n-para').value : '';
    if (rede) { const p = lerPara(escolhaPara); dados.unidade = p.unidade; if (p.para) dados.para = p.para; } else dados.unidade = $('#n-uni').value;
    if (direcionaLocal && $('#n-para-local').value) dados.para = $('#n-para-local').value;
    const todos = dados.para === 'grupo:gerentes' || dados.para === 'grupo:frentistas';
    const rec = recorrente();
    if (rec) Object.assign(dados, { periodicidade: $('#n-per').value, inicio: $('#n-ini').value, fim: $('#n-fim').value });
    const faltam = [];
    if (rede && !escolhaPara) faltam.push('para quem');
    else if (!dados.unidade && !todos) faltam.push('unidade'); if (!dados.setor) faltam.push('setor'); if (!dados.prioridade) faltam.push('prioridade');
    if (!dados.titulo) faltam.push('título'); if (!dados.descricao) faltam.push('descrição');
    if (rec) { if (!dados.periodicidade) faltam.push('periodicidade'); if (!dados.inicio) faltam.push('primeira ocorrência'); if (!dados.fim) faltam.push('fim da recorrência'); }
    if (!rede && !fotos.length) { faltam.push('foto ou anexo'); $('#n-fotos-erro').textContent = 'Trava: nenhum chamado é aberto sem foto ou anexo.'; }
    if (faltam.length) { $('#n-erro').textContent = 'Preencha: ' + faltam.join(', ') + '.'; return; }
    if (rec && dados.fim < dados.inicio) { $('#n-erro').textContent = 'O fim da recorrência deve ser igual ou depois da primeira ocorrência.'; return; }
    $('#n-enviar').disabled = true;
    const envio = { chamado: dados, fotos: paraEnvio(fotos) };
    const r = rec
      ? await executar('abrirRecorrente', envio, null, (res) => {
        aviso(`Recorrência criada${res.pessoas > 1 ? ` para ${res.pessoas} pessoas` : ''}: ${res.total} ocorrência(s). ${res.abertos ? res.abertos + ' chamado(s) já aberto(s) agora.' : 'A primeira abre automaticamente perto da data.'}`);
        location.hash = '#/chamados';
      })
      : await executar('abrir', envio, null, (res) => {
        if (res.total > 1) { aviso(`${res.total} chamados abertos, um para cada pessoa do grupo.`); location.hash = '#/chamados'; return; }
        aviso(`Chamado ${'#' + String(res.numero).padStart(4, '0')} aberto${dados.para ? ' para ' + nomeUsuario(dados.para) : ' e enviado à fila do Escritório'}.`);
        location.hash = '#/chamado/' + res.id;
      });
    if (!r) $('#n-enviar').disabled = false;
  };
}

// ===================== Detalhe do chamado =====================
function responsaveisPossiveis(c) {
  return db.usuarios.filter((x) => ehRede(x) || x.unidades.includes(c.unidade)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

function telaDetalhe(id) {
  const u = sessao();
  const c = db.chamados.find((x) => x.id === id);
  if (!c) { moldura('chamados', '<h1>Chamado</h1><div class="vazio">Chamado não encontrado ou sem permissão de acesso.</div>'); return; }
  const gerir = podeGerirChamado(u, c);
  const andar = podeDarAndamento(u, c);
  const fechar = podeFechar(u, c);
  const rec = c.recorrencia ? (db.recorrencias || []).find((r) => r.id === c.recorrencia) : null;
  const encerrarRec = rec && rec.ativa && ehRede(u);
  const anexos = [];
  moldura('chamados', `
    <div class="cabecalho-pagina"><div><p class="mudo"><a href="#/chamados">← Chamados</a></p><h1>${numeroChamado(c)} · ${esc(c.titulo)}</h1>
      <div class="acoes">${seloStatus(c.status)}${seloPrior(c.prioridade)}${seloVencido(c)}${seloTipo(c)}</div></div>
      <div class="acoes">${encerrarRec ? '<button class="botao secundario" id="b-enc-rec">Encerrar recorrência</button>' : ''}${gerir ? '<button class="botao secundario" id="b-reclass">Reclassificar</button>' : ''}${fechar ? '<button class="botao" id="b-fechar">Fechar chamado</button>' : ''}</div></div>
    <div class="grade grade-2">
      <section class="cartao">
        <h2>Dados</h2>
        <dl class="info">
          <div><dt>Unidade</dt><dd>${esc(nomeUnidade(c.unidade))}</dd></div>
          <div><dt>Setor</dt><dd>${esc(nomeSetor(c.setor))}</dd></div>
          <div><dt>Aberto por</dt><dd>${esc(nomeUsuario(c.abertoPor))}</dd></div>
          <div><dt>Aberto em</dt><dd>${fmtDataHora(c.abertoEm)}</dd></div>
          ${c.tipo === 'Recorrência' ? `<div><dt>Data programada</dt><dd>${esc(c.dataProgramada.split('-').reverse().join('/'))}</dd></div>
          ${rec ? `<div><dt>Recorrência</dt><dd>${ehRede(u) ? `<a href="#/recorrencia/${rec.id}">ver recorrência</a> · ` : ''}${esc(rec.periodicidade)} · ${esc(rec.inicio.split('-').reverse().join('/'))} a ${esc(rec.fim.split('-').reverse().join('/'))}${rec.ativa ? '' : ' (encerrada)'}</dd></div>` : ''}` : ''}
          <div><dt>Prazo</dt><dd>${fmtDataHora(c.prazoEm)}${vencido(c) ? ' · <strong style="color:var(--erro,#c0392b)">EM ATRASO</strong>' : ''}</dd></div>
          <div><dt>Responsável</dt><dd>${c.responsavel ? esc(nomeUsuario(c.responsavel)) : 'Fila do Escritório'}</dd></div>
          ${c.status === 'Fechado' ? `<div><dt>Fechado por</dt><dd>${esc(nomeUsuario(c.fechadoPor))}</dd></div><div><dt>Fechado em</dt><dd>${fmtDataHora(c.fechadoEm)} (${fmtDuracao(horasResolucao(c))})</dd></div>` : ''}
        </dl>
        <h3 style="margin-top:14px">Descrição do problema</h3><p class="texto-livre">${esc(c.descricao)}</p>
        <h3>Fotos e anexos da abertura</h3>${miniaturas(c.fotosAbertura)}
        ${c.status === 'Fechado' ? `<h3 style="margin-top:14px">Solução · ${esc(c.resultado)}</h3><p class="texto-livre">${esc(c.solucao)}</p><h3>Fotos e anexos do fechamento</h3>${miniaturas(c.fotosFechamento)}` : ''}
      </section>
      <div class="grade">
        ${andar ? `<section class="cartao"><h2>Andamento</h2><form id="form-and" novalidate>
          <div class="grade grade-2">
            <div class="campo"><label for="a-st">Status</label><select id="a-st">${opcoes(STATUS.filter((s) => s !== 'Fechado'), c.status)}</select></div>
            ${gerir ? `<div class="campo"><label for="a-resp">Responsável</label><select id="a-resp"><option value="">— Fila do Escritório —</option>${opcoes(responsaveisPossiveis(c), c.responsavel)}</select></div>` : ''}
          </div><button class="botao secundario">Salvar andamento</button><span class="pequeno mudo"> Para fechar, use “Fechar chamado” (exige foto).</span></form></section>` : ''}
        <section class="cartao"><h2>Comentários e tratativa</h2>
          ${c.comentarios.length ? c.comentarios.map((m) => `<div class="comentario"><div class="pequeno mudo">${esc(nomeUsuario(m.usuario))} · ${fmtDataHora(m.em)}</div>${m.texto ? `<div class="texto-livre">${esc(m.texto)}</div>` : ''}${blocoAnexos(m.anexos)}</div>`).join('') : '<p class="mudo">Nenhum comentário.</p>'}
          <form id="form-com" novalidate><div class="campo"><label for="c-txt" class="pequeno">Novo comentário</label><textarea id="c-txt" style="min-height:70px" placeholder="O que foi feito, próximos passos…"></textarea></div>
            <div class="campo"><span class="rotulo pequeno">Fotos e anexos da tratativa (opcional, até ${MAX_ANEXOS}, 5 MB cada)</span><div class="fotos" id="c-anexos"></div></div>
            <button class="botao secundario">Comentar</button></form>
        </section>
        <section class="cartao"><h2>Histórico</h2><ul class="linha-tempo">
          ${c.historico.slice().reverse().map((h) => `<li><div class="quando">${fmtDataHora(h.em)} · ${h.usuario ? esc(nomeUsuario(h.usuario)) : 'Sistema'}</div><strong>${esc(h.acao)}</strong>${h.detalhe ? `<div class="pequeno texto-livre">${esc(h.detalhe)}</div>` : ''}</li>`).join('')}
        </ul></section>
      </div>
    </div>`);
  const voltar = () => telaDetalhe(id);
  if (andar) {
    $('#form-and').onsubmit = (ev) => {
      ev.preventDefault();
      const st = $('#a-st').value, resp = gerir ? $('#a-resp').value : (c.responsavel || '');
      if (st === c.status && resp === (c.responsavel || '')) { aviso('Nada mudou.'); return; }
      executar('andamento', { id, status: st, responsavel: resp }, st !== c.status ? 'Andamento salvo. Quem abriu foi notificado.' : 'Andamento salvo.', voltar);
    };
  }
  if (gerir) $('#b-reclass').onclick = () => janelaReclassificar(c);
  if (fechar) $('#b-fechar').onclick = () => janelaFechar(c);
  if (encerrarRec) $('#b-enc-rec').onclick = () => confirmar(`Encerrar a recorrência “${rec.titulo}”? Nenhuma nova ocorrência será aberta. As que já foram abertas continuam valendo.`,
    async () => (await executar('encerrarRecorrencia', { id: rec.id }, 'Recorrência encerrada.', voltar)) !== false, 'Encerrar');
  ligarAnexos('c-anexos', anexos);
  $('#form-com').onsubmit = (ev) => {
    ev.preventDefault();
    const t = $('#c-txt').value.trim();
    if (!t && !anexos.length) { aviso('Escreva o comentário ou anexe uma foto/arquivo.', true); return; }
    executar('comentar', { id, texto: t, anexos: anexos.map((a) => ({ nome: a.nome, dataUrl: a.dataUrl })) }, 'Comentário registrado.', voltar);
  };
  ligarBaixarAnexos();
}

// ===================== Anexos da tratativa (fotos e arquivos no comentário) =====================
const ehImagem = (tipo) => /^image\//.test(tipo || '');
function blocoAnexos(lista) {
  if (!lista || !lista.length) return '';
  const fotos = lista.filter((a) => ehImagem(a.tipo)), arqs = lista.filter((a) => !ehImagem(a.tipo));
  return (fotos.length ? miniaturas(fotos.map((a) => a.id)) : '')
    + (arqs.length ? `<div class="pequeno" style="margin-top:6px">${arqs.map((a) => `<button type="button" class="botao secundario" style="margin:2px 4px 2px 0;padding:4px 10px" data-anexo-id="${esc(a.id)}" data-anexo-nome="${esc(a.nome)}">📎 ${esc(a.nome)}</button>`).join('')}</div>` : '');
}
function ligarBaixarAnexos() {
  $$('[data-anexo-id]').forEach((b) => b.onclick = async () => {
    try {
      const r = await api('foto', { fotoId: b.dataset.anexoId }, { texto: 'Baixando…' });
      baixar(r.dataUrl, b.dataset.anexoNome || r.nome);
    } catch (e) { aviso(e.message, true); }
  });
}
function lerArquivo(arq) {
  return new Promise((ok, falha) => {
    if (arq.size > MAX_ANEXO_BYTES) return falha(new Error(`Arquivo grande demais (máx. 5 MB): ${arq.name}`));
    const l = new FileReader(); l.onerror = () => falha(new Error('Não foi possível ler o arquivo.')); l.onload = () => ok(l.result); l.readAsDataURL(arq);
  });
}
/** Campo de fotos/anexos (abertura, fechamento e comentário): botão de foto (abre a câmera) e de arquivo (PDF, planilha etc.). */
function ligarAnexos(idCampo, lista) {
  const caixa = document.getElementById(idCampo);
  const desenhar = () => {
    caixa.innerHTML = lista.map((a, i) => `<div class="miniatura">${ehImagem(a.tipo) ? `<img src="${a.dataUrl}" alt="">` : `<span class="pequeno" style="padding:6px;word-break:break-all">📎 ${esc(a.nome)}</span>`}<button type="button" class="remover" data-i="${i}" aria-label="Remover anexo ${i + 1}">×</button></div>`).join('')
      + (lista.length < MAX_ANEXOS ? `<label class="adicionar-foto">＋<br>Foto<input type="file" accept="image/*" capture="environment" multiple data-tipo="foto"></label>
        <label class="adicionar-foto">＋<br>Arquivo<input type="file" multiple data-tipo="arquivo"></label>` : '');
    $$('.remover', caixa).forEach((b) => b.addEventListener('click', () => { lista.splice(Number(b.dataset.i), 1); desenhar(); }));
    $$('input[type=file]', caixa).forEach((inp) => inp.addEventListener('change', async () => {
      for (const arq of Array.from(inp.files).slice(0, MAX_ANEXOS - lista.length)) {
        try {
          if (arq.type.startsWith('image/')) lista.push({ nome: arq.name.replace(/\.\w+$/, '') + '.jpg', tipo: 'image/jpeg', dataUrl: await lerFoto(arq) });
          else lista.push({ nome: arq.name, tipo: arq.type || 'application/octet-stream', dataUrl: await lerArquivo(arq) });
        } catch (e) { aviso(e.message, true); }
      }
      desenhar();
      const erro = document.getElementById(idCampo + '-erro'); if (erro) erro.textContent = '';
    }));
  };
  desenhar();
}

function janelaReclassificar(c) {
  const u = sessao();
  const unis = [...new Set([...unidadesDo(u), c.unidade])].filter((x) => unidade(x));
  abrirJanela(`Reclassificar ${numeroChamado(c)}`, `
    <p class="mudo pequeno">A alteração fica registrada no histórico com seu nome, data e hora. Mudar a prioridade recalcula o prazo a partir da abertura.</p>
    <div class="campo"><label for="r-uni">Unidade</label><select id="r-uni">${opcoes(unis.map(unidade), c.unidade)}</select></div>
    <div class="campo"><label for="r-set">Setor</label><select id="r-set">${opcoes(db.setores, c.setor)}</select></div>
    <div class="campo"><label for="r-pri">Prioridade</label><select id="r-pri">${opcoes(PRIORIDADES, c.prioridade)}</select></div>
    <div class="campo"><label for="r-mot">Motivo (opcional)</label><input type="text" id="r-mot" maxlength="140"></div>`, {
    textoOk: 'Reclassificar',
    aoConfirmar: async () => {
      const r = await executar('reclassificar', { id: c.id, unidade: $('#r-uni').value, setor: $('#r-set').value, prioridade: $('#r-pri').value, motivo: $('#r-mot').value.trim() },
        'Chamado reclassificado.', () => telaDetalhe(c.id));
      return r !== false;
    },
  });
}

function janelaFechar(c) {
  const fotos = [];
  abrirJanela(`Fechar ${numeroChamado(c)}`, `
    <div class="campo"><label for="f-sol">Descrição da solução <span class="obrig">*</span></label><textarea id="f-sol" placeholder="O que foi feito"></textarea></div>
    <div class="campo"><label for="f-res">Resultado final <span class="obrig">*</span></label><select id="f-res"><option value="">Selecione</option>${opcoes(RESULTADOS)}</select></div>
    ${campoFotos('f-fotos', 'Fotos e anexos do fechamento')}
    <div class="erro-campo" id="f-erro"></div>`, {
    textoOk: 'Fechar chamado',
    aoAbrir: () => ligarAnexos('f-fotos', fotos),
    aoConfirmar: async () => {
      const sol = $('#f-sol').value.trim(), res = $('#f-res').value;
      const faltam = [];
      if (!sol) faltam.push('descrição da solução'); if (!res) faltam.push('resultado final');
      if (!fotos.length) { faltam.push('foto ou anexo'); $('#f-fotos-erro').textContent = 'Trava: nenhum chamado é fechado sem foto ou anexo.'; }
      if (faltam.length) { $('#f-erro').textContent = 'Preencha: ' + faltam.join(', ') + '.'; return false; }
      const r = await executar('fechar', { id: c.id, solucao: sol, resultado: res, fotos: paraEnvio(fotos) }, `Chamado ${numeroChamado(c)} fechado.`, () => telaDetalhe(c.id));
      return r !== false;
    },
  });
}

// ===================== Relatórios =====================
const filtroRel = { de: '', ate: '', unidade: '', setor: '', status: '', prioridade: '' };

function telaRelatorios() {
  const u = sessao();
  if (!podeVerPainel(u)) { location.hash = '#/chamados'; return; }
  const de = filtroRel.de ? new Date(filtroRel.de + 'T00:00:00') : null;
  const ate = filtroRel.ate ? new Date(filtroRel.ate + 'T23:59:59') : null;
  const lista = chamadosVisiveis().filter((c) => {
    const a = new Date(c.abertoEm);
    return (!de || a >= de) && (!ate || a <= ate) && (!filtroRel.unidade || c.unidade === filtroRel.unidade)
      && (!filtroRel.setor || c.setor === filtroRel.setor) && (!filtroRel.status || c.status === filtroRel.status)
      && (!filtroRel.prioridade || c.prioridade === filtroRel.prioridade);
  }).sort((a, b) => new Date(a.abertoEm) - new Date(b.abertoEm));
  const fech = lista.filter((c) => c.status === 'Fechado');
  const mediaH = fech.length ? fech.reduce((s, c) => s + horasResolucao(c), 0) / fech.length : null;
  moldura('relatorios', `
    <div class="cabecalho-pagina"><div><h1>Relatórios</h1><p class="mudo">Período filtra pela data de abertura.</p></div><button class="botao secundario" id="b-csv" ${lista.length ? '' : 'disabled'}>Exportar CSV</button></div>
    <div class="filtros">
      <div class="campo"><label for="r-de">De</label><input type="date" id="r-de" value="${filtroRel.de}"></div>
      <div class="campo"><label for="r-ate">Até</label><input type="date" id="r-ate" value="${filtroRel.ate}"></div>
      <div class="campo"><label for="r-un">Unidade</label><select id="r-un"><option value="">Todas</option>${opcoes(unidadesDo(u).map(unidade), filtroRel.unidade)}</select></div>
      <div class="campo"><label for="r-se">Setor</label><select id="r-se"><option value="">Todos</option>${opcoes(db.setores, filtroRel.setor)}</select></div>
      <div class="campo"><label for="r-st">Status</label><select id="r-st"><option value="">Todos</option>${opcoes(STATUS, filtroRel.status)}</select></div>
      <div class="campo"><label for="r-pr">Prioridade</label><select id="r-pr"><option value="">Todas</option>${opcoes(PRIORIDADES, filtroRel.prioridade)}</select></div>
    </div>
    <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
      <div class="kpi"><div class="valor">${fmtNum(lista.length)}</div><div class="rotulo">Chamados no filtro</div></div>
      <div class="kpi"><div class="valor">${fmtNum(fech.length)}</div><div class="rotulo">Fechados</div></div>
      <div class="kpi"><div class="valor">${fmtNum(lista.filter(vencido).length)}</div><div class="rotulo">EM ATRASO</div></div>
      <div class="kpi"><div class="valor">${fmtDuracao(mediaH)}</div><div class="rotulo">Tempo médio de resolução</div></div>
    </div>
    ${lista.length ? `<div class="tabela-rolagem"><table><thead><tr><th>Nº</th><th>Aberto em</th><th>Unidade</th><th>Setor</th><th>Prioridade</th><th>Status</th><th>Título</th><th>Aberto por</th><th>Fechado em</th><th class="num">Resolução</th></tr></thead><tbody>
      ${lista.map((c) => `<tr class="clicavel" data-id="${c.id}"><td>${numeroChamado(c)}</td><td>${fmtDataHora(c.abertoEm)}</td><td>${esc(nomeUnidade(c.unidade))}</td><td>${esc(nomeSetor(c.setor))}</td><td>${esc(c.prioridade)}</td><td>${esc(c.status)}${vencido(c) ? ' (vencido)' : ''}</td><td>${esc(c.titulo)}</td><td>${esc(nomeUsuario(c.abertoPor))}</td><td>${fmtDataHora(c.fechadoEm)}</td><td class="num">${fmtDuracao(horasResolucao(c))}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="vazio">Nenhum chamado com esses filtros.</div>'}`);
  [['#r-de', 'de'], ['#r-ate', 'ate'], ['#r-un', 'unidade'], ['#r-se', 'setor'], ['#r-st', 'status'], ['#r-pr', 'prioridade']]
    .forEach(([sel, k]) => { $(sel).onchange = (e) => { filtroRel[k] = e.target.value; telaRelatorios(); }; });
  $$('tr[data-id]').forEach((tr) => tr.onclick = () => { location.hash = '#/chamado/' + tr.dataset.id; });
  $('#b-csv').onclick = () => exportarCSV(lista);
}

function exportarCSV(lista) {
  const cab = ['Numero', 'Aberto em', 'Unidade', 'Setor', 'Prioridade', 'Status', 'Em atraso', 'Titulo', 'Descricao', 'Aberto por', 'Responsavel', 'Prazo', 'Fechado em', 'Fechado por', 'Resultado', 'Solucao', 'Resolucao (h)'];
  const cel = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const linhas = lista.map((c) => [numeroChamado(c), fmtDataHora(c.abertoEm), nomeUnidade(c.unidade), nomeSetor(c.setor), c.prioridade, c.status, vencido(c) ? 'Sim' : 'Não', c.titulo, c.descricao,
    nomeUsuario(c.abertoPor), nomeUsuario(c.responsavel), fmtDataHora(c.prazoEm), c.fechadoEm ? fmtDataHora(c.fechadoEm) : '', c.fechadoPor ? nomeUsuario(c.fechadoPor) : '', c.resultado, c.solucao,
    c.fechadoEm ? fmtNum(horasResolucao(c), 1) : ''].map(cel).join(';'));
  const blob = new Blob(['﻿' + [cab.map(cel).join(';'), ...linhas].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  const d = new Date();
  a.href = URL.createObjectURL(blob); a.download = `chamados-${d.getFullYear()}${dois(d.getMonth() + 1)}${dois(d.getDate())}.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ===================== Notificações (registro do servidor) =====================
const filtroNotif = { canal: '', busca: '' };

function telaNotificacoes() {
  const u = sessao();
  if (!ehRede(u)) { location.hash = '#/chamados'; return; }
  const b = normaliza(filtroNotif.busca);
  const lista = db.notificacoes.filter((n) => (!filtroNotif.canal || n.canal === filtroNotif.canal)
    && (!b || normaliza(`${n.assunto} ${nomeUsuario(n.para)} ${n.endereco}`).includes(b)))
    .sort((a, b2) => new Date(b2.em) - new Date(a.em));
  const modo = { simulado: 'Modo simulado: as mensagens são registradas, mas nada é enviado.', teste: 'Modo teste: todos os e-mails vão só para o endereço de teste do administrador.', real: '' }[db.modoEnvio] || '';
  moldura('notificacoes', `
    <div class="cabecalho-pagina"><div><h1>Notificações</h1><p class="mudo">Registro de todo e-mail gerado pelo sistema (WhatsApp fica para uma segunda fase).</p></div></div>
    ${modo ? `<div class="faixa-leitura">${esc(modo)}</div>` : ''}
    <div class="filtros">
      <div class="campo"><label for="nt-busca">Buscar</label><input type="search" id="nt-busca" value="${esc(filtroNotif.busca)}" placeholder="Chamado, pessoa ou e-mail"></div>
    </div>
    <p class="mudo pequeno">${fmtNum(lista.length)} notificação(ões)</p>
    ${lista.length ? `<div class="tabela-rolagem"><table><thead><tr><th>Gerada em</th><th>Chamado</th><th>Evento</th><th>Para</th><th>Situação</th><th></th></tr></thead><tbody>
      ${lista.map((n) => { const c = db.chamados.find((x) => x.id === n.chamado); return `<tr><td>${fmtDataHora(n.em)}</td><td>${c ? `<a href="#/chamado/${c.id}">${numeroChamado(c)}</a>` : '—'}</td><td>${esc(n.evento)}</td>
        <td>${esc(nomeUsuario(n.para))}<div class="pequeno mudo">${esc(n.endereco || 'sem contato')}</div></td><td>${esc(n.situacao)}${n.erro ? `<div class="pequeno erro-campo">${esc(n.erro)}</div>` : ''}</td>
        <td><button class="botao secundario pequeno" data-ver="${n.id}">Ver</button></td></tr>`; }).join('')}
    </tbody></table></div>` : '<div class="vazio">Nenhuma notificação gerada ainda.</div>'}`);
  $('#nt-busca').onchange = (e) => { filtroNotif.busca = e.target.value; telaNotificacoes(); };
  $$('[data-ver]').forEach((bt) => bt.onclick = () => {
    const n = db.notificacoes.find((x) => x.id === bt.dataset.ver);
    abrirJanela(`E-mail · ${nomeUsuario(n.para)}`, `<p class="pequeno mudo">Para: ${esc(n.endereco || 'sem contato cadastrado')} · ${esc(n.situacao)}</p>
      <p><strong>Assunto:</strong> ${esc(n.assunto)}</p><div class="comentario texto-livre">${esc(n.texto)}</div>`);
  });
}

// ===================== Cadastros =====================
const filtroUsuarios = { unidade: '' };

function telaCadastros(aba) {
  const u = sessao();
  const pode = podeGerirCadastros(u);
  aba = ['unidades', 'setores', 'usuarios'].includes(aba) ? aba : 'unidades';
  let corpo = '';
  if (aba === 'unidades') {
    corpo = `<div class="tabela-rolagem"><table><thead><tr><th>Unidade</th><th>Município/UF</th><th>CNPJ</th>${pode ? '<th></th>' : ''}</tr></thead><tbody>
      ${db.unidades.map((x) => `<tr><td>${esc(x.nome)}</td><td>${esc(x.municipio)}</td><td>${esc(x.cnpj)}</td>${pode ? acoesLinha(x.id) : ''}</tr>`).join('')}</tbody></table></div>`;
  } else if (aba === 'setores') {
    corpo = `<div class="tabela-rolagem"><table><thead><tr><th>Setor</th>${pode ? '<th></th>' : ''}</tr></thead><tbody>
      ${db.setores.map((x) => `<tr><td>${esc(x.nome)}</td>${pode ? acoesLinha(x.id) : ''}</tr>`).join('')}</tbody></table></div>`;
  } else {
    const lista = db.usuarios.filter((x) => !filtroUsuarios.unidade || x.unidades.includes(filtroUsuarios.unidade)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    corpo = `<div class="filtros"><div class="campo" style="max-width:280px"><label for="fu-uni">Filtro de Unidades</label><select id="fu-uni"><option value="">Todas</option>${opcoes(db.unidades, filtroUsuarios.unidade)}</select></div><p class="mudo pequeno" style="margin:0 0 10px">${fmtNum(lista.length)} usuário(s)</p></div>
      ${lista.length ? `<div class="tabela-rolagem"><table><thead><tr><th>Nome Completo</th><th>Perfil</th><th>Unidade(s)</th>${pode ? '<th>WhatsApp</th><th>E-mail</th><th>Usuário</th><th>Senha</th><th></th>' : ''}</tr></thead><tbody>
      ${lista.map((x) => `<tr><td>${esc(x.nome)}</td><td>${esc(x.perfil)}</td><td>${esc(x.unidades.map(nomeUnidade).join(', '))}</td>${pode ? `<td>${esc(x.whatsapp)}</td><td>${esc(x.email)}</td><td>${esc(x.usuario)}</td><td>••••••</td>${acoesLinha(x.id)}` : ''}</tr>`).join('')}</tbody></table></div>` : '<div class="vazio">Nenhum usuário nesta unidade.</div>'}`;
  }
  const titulos = { unidades: 'Unidade', setores: 'Setor', usuarios: 'Usuário' };
  moldura('cadastros', `
    <div class="cabecalho-pagina"><div><h1>Cadastros</h1></div>
      <div class="acoes">${pode ? `<button class="botao" id="b-add">＋ Adicionar ${titulos[aba].toLowerCase()}</button>` : ''}</div></div>
    <nav class="abas">${['unidades', 'setores', 'usuarios'].map((a) => `<a href="#/cadastros/${a}" class="${a === aba ? 'ativo' : ''}">${{ unidades: 'Unidades', setores: 'Setores', usuarios: 'Usuários' }[a]}</a>`).join('')}</nav>
    ${pode ? '' : '<div class="faixa-leitura">Somente consulta. Apenas os perfis Escritorio e Diretoria podem adicionar, editar ou excluir cadastros.</div>'}
    ${corpo}`);
  if (aba === 'usuarios') $('#fu-uni').onchange = (e) => { filtroUsuarios.unidade = e.target.value; telaCadastros('usuarios'); };
  if (!pode) return;
  const form = { unidades: formUnidade, setores: formSetor, usuarios: formUsuario }[aba];
  $('#b-add').onclick = () => form(null);
  $$('[data-editar]').forEach((b) => b.onclick = () => form(b.dataset.editar));
  $$('[data-excluir]').forEach((b) => b.onclick = () => {
    const nomeItem = { unidades: nomeUnidade, setores: nomeSetor, usuarios: nomeUsuario }[aba](b.dataset.excluir);
    confirmar(`Excluir "${nomeItem}"? Cadastros em uso não podem ser excluídos.`, () =>
      executar('excluir', { tipo: aba, id: b.dataset.excluir }, 'Excluído.', () => telaCadastros(aba)).then((r) => r !== false));
  });
}
const acoesLinha = (id) => `<td style="white-space:nowrap;text-align:right"><button class="botao secundario pequeno" data-editar="${id}">Editar</button> <button class="botao perigo pequeno" data-excluir="${id}">Excluir</button></td>`;

function formUnidade(id) {
  const x = id ? unidade(id) : { nome: '', municipio: '', cnpj: '' };
  abrirJanela(id ? 'Editar unidade' : 'Nova unidade', `
    <div class="campo"><label for="cu-nome">Nome <span class="obrig">*</span></label><input type="text" id="cu-nome" value="${esc(x.nome)}"></div>
    <div class="campo"><label for="cu-mun">Município/UF <span class="obrig">*</span></label><input type="text" id="cu-mun" value="${esc(x.municipio)}" placeholder="Ex.: Aruanã – GO"></div>
    <div class="campo"><label for="cu-cnpj">CNPJ <span class="obrig">*</span></label><input type="text" id="cu-cnpj" value="${esc(x.cnpj)}" inputmode="numeric" placeholder="00.000.000/0000-00"></div>`, {
    aoConfirmar: async () => (await executar('salvarUnidade', { item: { id, nome: $('#cu-nome').value, municipio: $('#cu-mun').value, cnpj: $('#cu-cnpj').value } }, 'Unidade salva.', () => telaCadastros('unidades'))) !== false,
  });
}

function formSetor(id) {
  const x = id ? setor(id) : { nome: '' };
  abrirJanela(id ? 'Editar setor' : 'Novo setor', `
    <div class="campo"><label for="cs-nome">Nome <span class="obrig">*</span></label><input type="text" id="cs-nome" value="${esc(x.nome)}"></div>`, {
    aoConfirmar: async () => (await executar('salvarSetor', { item: { id, nome: $('#cs-nome').value } }, 'Setor salvo.', () => telaCadastros('setores'))) !== false,
  });
}

function formUsuario(id) {
  const x = id ? usuario(id) : { nome: '', unidades: [], whatsapp: '', email: '', perfil: '', usuario: '' };
  abrirJanela(id ? 'Editar usuário' : 'Novo usuário', `
    <div class="campo"><label for="cx-nome">Nome Completo <span class="obrig">*</span></label><input type="text" id="cx-nome" value="${esc(x.nome)}"></div>
    <div class="campo"><span class="rotulo">Unidade <span class="obrig">*</span> <span class="mudo pequeno">(pode marcar mais de uma)</span></span>
      <div class="checks">${db.unidades.map((un) => `<label><input type="checkbox" name="cx-uni" value="${un.id}" ${x.unidades.includes(un.id) ? 'checked' : ''}> ${esc(un.nome)}</label>`).join('')}</div></div>
    <div class="grade grade-2">
      <div class="campo"><label for="cx-wpp">Número do WhatsApp <span class="obrig">*</span></label><input type="tel" id="cx-wpp" value="${esc(x.whatsapp)}" placeholder="(62) 99999-9999"></div>
      <div class="campo"><label for="cx-mail">E-mail <span class="obrig">*</span></label><input type="email" id="cx-mail" value="${esc(x.email)}"></div>
    </div>
    <div class="campo"><label for="cx-perfil">Perfil <span class="obrig">*</span></label><select id="cx-perfil"><option value="">Selecione</option>${opcoes(PERFIS, x.perfil)}</select></div>
    <div class="grade grade-2">
      <div class="campo"><label for="cx-user">Usuário <span class="obrig">*</span></label><input type="text" id="cx-user" value="${esc(x.usuario)}" autocapitalize="none" autocomplete="off"></div>
      <div class="campo"><label for="cx-senha">Senha ${id ? '<span class="mudo pequeno">(em branco = mantém)</span>' : '<span class="obrig">*</span>'}</label><input type="password" id="cx-senha" autocomplete="new-password"></div>
    </div>
    <p class="mudo pequeno">A senha definida aqui é temporária: a pessoa cria a própria senha no primeiro acesso. Mínimo de 8 caracteres.</p>`, {
    aoConfirmar: async () => {
      const item = {
        id, nome: $('#cx-nome').value, unidades: $$('input[name=cx-uni]:checked').map((i) => i.value), whatsapp: $('#cx-wpp').value,
        email: $('#cx-mail').value, perfil: $('#cx-perfil').value, usuario: $('#cx-user').value, senha: $('#cx-senha').value,
      };
      return (await executar('salvarUsuario', { item }, 'Usuário salvo.', () => telaCadastros('usuarios'))) !== false;
    },
  });
}

// ===================== Chamados recorrentes (só Escritorio/Diretoria) =====================
const dataBR = (s) => (s ? s.split('-').reverse().join('/') : '—');
function somarDiasISO(s, n) { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const subsDe = (r) => db.chamados.filter((c) => c.recorrencia === r.id).sort((a, b) => (a.dataProgramada < b.dataProgramada ? -1 : 1));
const situacaoRec = (r) => (r.ativa ? '<span class="selo st-andamento">Ativa</span>' : '<span class="selo st-fechado">Encerrada</span>');
const filtroRec = { visao: 'recorrencias', situacao: 'pendentes', busca: '' };

/** Todas as ocorrências: as já abertas (com o chamado) e as programadas (ainda não abertas, com a data em que abrem). */
function todasOcorrencias() {
  const lista = [];
  (db.recorrencias || []).forEach((r) => {
    subsDe(r).forEach((c) => lista.push({ data: c.dataProgramada, r, c }));
    (r.proximas || []).forEach((dt) => lista.push({ data: dt, r, abre: somarDiasISO(dt, -(r.antecedencia || 0)) }));
  });
  return lista.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.r.titulo.localeCompare(b.r.titulo, 'pt-BR')));
}

function telaRecorrencias() {
  const u = sessao();
  if (!ehRede(u)) { location.hash = '#/chamados'; return; }
  const b = normaliza(filtroRec.busca);
  const casa = (r) => !b || normaliza(`${r.titulo} ${nomeUsuario(r.para)} ${nomeUnidade(r.unidade)}`).includes(b);
  const recs = (db.recorrencias || []).filter(casa).sort((a, b2) => (b2.ativa - a.ativa) || a.titulo.localeCompare(b2.titulo, 'pt-BR'));
  const ocorr = todasOcorrencias().filter((o) => casa(o.r)).filter((o) => {
    const s = filtroRec.situacao;
    if (s === 'programadas') return !o.c;
    if (s === 'abertas') return o.c && o.c.status !== 'Fechado';
    if (s === 'fechadas') return o.c && o.c.status === 'Fechado';
    if (s === 'pendentes') return !o.c || o.c.status !== 'Fechado';
    return true;
  });
  const linhaRec = (r) => {
    const subs = subsDe(r);
    return `<tr class="clicavel" data-rec="${r.id}"><td><strong>${esc(r.titulo)}</strong></td><td>${esc(nomeUsuario(r.para))}</td><td>${esc(nomeUnidade(r.unidade))}</td>
      <td>${esc(r.periodicidade)}</td><td>${dataBR(r.inicio)} a ${dataBR(r.fim)}</td><td class="num">${subs.length} / ${r.totalOcorrencias ?? '—'}</td>
      <td>${r.proximas && r.proximas.length ? dataBR(r.proximas[0]) : '—'}</td><td>${situacaoRec(r)}</td></tr>`;
  };
  const linhaOc = (o) => `<tr class="clicavel" ${o.c ? `data-ch="${o.c.id}"` : `data-rec="${o.r.id}"`}><td>${dataBR(o.data)}</td><td>${esc(o.r.titulo)}</td>
    <td>${esc(nomeUsuario(o.r.para))}</td><td>${esc(nomeUnidade(o.r.unidade))}</td><td>${esc(o.r.periodicidade)}</td>
    <td>${o.c ? `${numeroChamado(o.c)} ${seloStatus(o.c.status)}${seloVencido(o.c)}` : `<span class="selo st-aguardando">Programada</span> <span class="pequeno mudo">abre em ${dataBR(o.abre)}</span>`}</td></tr>`;
  moldura('recorrencias', `
    <div class="cabecalho-pagina"><div><h1>Chamados recorrentes</h1><p class="mudo">Todas as recorrências e todas as ocorrências: as já abertas e as programadas, que o sistema abre sozinho no início do dia de cada data; o prazo conta pela prioridade a partir dela.</p></div>
      <div class="acoes"><button class="botao secundario" id="b-atualizar">Atualizar</button><a class="botao" href="#/novo">＋ Novo recorrente</a></div></div>
    <div class="filtros">
      <div class="campo"><label for="r-visao">Ver</label><select id="r-visao">${opcoes([{ id: 'recorrencias', nome: 'Por recorrência' }, { id: 'ocorrencias', nome: 'Todas as ocorrências (abertas e programadas)' }], filtroRec.visao)}</select></div>
      ${filtroRec.visao === 'ocorrencias' ? `<div class="campo"><label for="r-sit">Situação</label><select id="r-sit">${opcoes([{ id: 'pendentes', nome: 'Programadas e abertas (exceto fechadas)' }, { id: 'programadas', nome: 'Só programadas (ainda não abertas)' }, { id: 'abertas', nome: 'Só abertas' }, { id: 'fechadas', nome: 'Fechadas' }, { id: '', nome: 'Todas' }], filtroRec.situacao)}</select></div>` : ''}
      <div class="campo"><label for="r-bu">Buscar</label><input type="search" id="r-bu" value="${esc(filtroRec.busca)}" placeholder="Título, pessoa ou unidade"></div>
    </div>
    ${filtroRec.visao === 'recorrencias'
      ? `<p class="mudo pequeno">${fmtNum(recs.length)} recorrência(s)</p>${recs.length ? `<div class="tabela-rolagem"><table><thead><tr><th>Título</th><th>Para quem</th><th>Unidade</th><th>Periodicidade</th><th>Período</th><th class="num">Abertos / total</th><th>Próxima data</th><th>Situação</th></tr></thead><tbody>${recs.map(linhaRec).join('')}</tbody></table></div>` : '<div class="vazio">Nenhum chamado recorrente. Crie em Novo chamado → “Para quem” → botão “Chamado Recorrente”.</div>'}`
      : `<p class="mudo pequeno">${fmtNum(ocorr.length)} ocorrência(s)</p>${ocorr.length ? `<div class="tabela-rolagem"><table><thead><tr><th>Data programada</th><th>Título</th><th>Para quem</th><th>Unidade</th><th>Periodicidade</th><th>Situação</th></tr></thead><tbody>${ocorr.map(linhaOc).join('')}</tbody></table></div>` : '<div class="vazio">Nenhuma ocorrência com esses filtros.</div>'}`}`);
  $('#r-visao').onchange = (e) => { filtroRec.visao = e.target.value; telaRecorrencias(); };
  if ($('#r-sit')) $('#r-sit').onchange = (e) => { filtroRec.situacao = e.target.value; telaRecorrencias(); };
  $('#r-bu').oninput = (e) => { filtroRec.busca = e.target.value; clearTimeout(telaRecorrencias._t); telaRecorrencias._t = setTimeout(() => { telaRecorrencias(); const el = $('#r-bu'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 250); };
  $$('tr[data-rec]').forEach((tr) => tr.onclick = () => { location.hash = '#/recorrencia/' + tr.dataset.rec; });
  $$('tr[data-ch]').forEach((tr) => tr.onclick = () => { location.hash = '#/chamado/' + tr.dataset.ch; });
  $('#b-atualizar').onclick = async () => { try { await recarregar('Atualizando…'); telaRecorrencias(); } catch (e) { aviso(e.message, true); } };
}

function telaRecorrencia(id) {
  const u = sessao();
  if (!ehRede(u)) { location.hash = '#/chamados'; return; }
  const r = (db.recorrencias || []).find((x) => x.id === id);
  if (!r) { moldura('recorrencias', '<p class="mudo"><a href="#/recorrencias">← Chamados recorrentes</a></p><div class="vazio">Recorrência não encontrada (pode ter sido apagada).</div>'); return; }
  const subs = subsDe(r);
  moldura('recorrencias', `
    <div class="cabecalho-pagina"><div><p class="mudo"><a href="#/recorrencias">← Chamados recorrentes</a></p><h1>${esc(r.titulo)}</h1>
      <div class="acoes">${situacaoRec(r)}${seloPrior(r.prioridade)}<span class="selo st-andamento">Recorrência</span></div></div>
      <div class="acoes"><button class="botao secundario" id="b-editar">Editar</button><button class="botao secundario" id="b-apagar" style="color:var(--erro,#c0392b)">Apagar</button></div></div>
    <div class="grade grade-2">
      <section class="cartao"><h2>Dados</h2>
        <dl class="info">
          <div><dt>Para quem</dt><dd>${esc(nomeUsuario(r.para))}</dd></div>
          <div><dt>Unidade</dt><dd>${esc(nomeUnidade(r.unidade))}</dd></div>
          <div><dt>Setor</dt><dd>${esc(nomeSetor(r.setor))}</dd></div>
          <div><dt>Periodicidade</dt><dd>${esc(r.periodicidade)}</dd></div>
          <div><dt>Período</dt><dd>${dataBR(r.inicio)} a ${dataBR(r.fim)} · ${r.totalOcorrencias} ocorrência(s)</dd></div>
          <div><dt>Abertura automática</dt><dd>${r.antecedencia ? `${r.antecedencia} dias antes da data programada` : 'no início do dia da data programada'} · prazo de ${PRAZO_HORAS[r.prioridade] || '—'} h úteis (${esc(r.prioridade)})</dd></div>
          <div><dt>Criado por</dt><dd>${esc(nomeUsuario(r.criadoPor))} em ${fmtDataHora(r.criadoEm)}</dd></div>
        </dl>
        <h3 style="margin-top:14px">Descrição</h3><p class="texto-livre">${esc(r.descricao)}</p>
        ${(r.fotos || []).length ? `<h3>Fotos e anexos</h3>${miniaturas(r.fotos)}` : ''}
      </section>
      <div class="grade">
        <section class="cartao"><h2>Já abertos (${subs.length})</h2>
          ${subs.length ? subs.slice().reverse().map((c) => `<a class="item-chamado" href="#/chamado/${c.id}"><strong>${numeroChamado(c)} · data ${dataBR(c.dataProgramada)}</strong><div class="linha">${seloStatus(c.status)}${seloVencido(c)}</div></a>`).join('') : '<p class="mudo">Nenhuma ocorrência aberta ainda.</p>'}
        </section>
        <section class="cartao"><h2>Programados – ainda não abertos (${(r.proximas || []).length})</h2>
          ${(r.proximas || []).length ? `<ul class="pequeno" style="margin:0;padding-left:18px;max-height:320px;overflow:auto">${r.proximas.map((dt) => `<li>${dataBR(dt)} <span class="mudo">· abre em ${dataBR(somarDiasISO(dt, -(r.antecedencia || 0)))}</span></li>`).join('')}</ul>` : `<p class="mudo">${r.ativa ? 'Nenhuma.' : 'Recorrência encerrada: nada mais será aberto.'}</p>`}
        </section>
      </div>
    </div>`);
  $('#b-editar').onclick = () => janelaEditarRecorrencia(r);
  $('#b-apagar').onclick = () => janelaApagarRecorrencia(r);
}

function janelaEditarRecorrencia(r) {
  // pessoa@unidade, como no "Para quem" da abertura (só pessoas: grupo vira uma recorrência por pessoa já na criação)
  const pessoas = db.usuarios.filter((x) => PERFIS_DESTINO.includes(x.perfil))
    .flatMap((x) => x.unidades.filter((id) => unidade(id)).map((id) => ({ id: `${x.id}@${id}`, nome: `${x.nome} (${x.perfil} – ${nomeUnidade(id)})` })))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  abrirJanela('Editar chamado recorrente', `
    <p class="mudo pequeno">As mudanças valem para as próximas ocorrências. Os chamados já abertos não mudam.</p>
    <div class="campo"><label for="e-tit">Título</label><input type="text" id="e-tit" maxlength="80" value="${esc(r.titulo)}"></div>
    <div class="campo"><label for="e-desc">Descrição</label><textarea id="e-desc">${esc(r.descricao)}</textarea></div>
    <div class="campo"><label for="e-para">Para quem</label><select id="e-para">${opcoes(pessoas, `${r.para}@${r.unidade}`)}</select></div>
    <div class="grade grade-2">
      <div class="campo"><label for="e-set">Setor</label><select id="e-set">${opcoes(db.setores, r.setor)}</select></div>
      <div class="campo"><label for="e-pri">Prioridade</label><select id="e-pri">${opcoes(PRIORIDADES, r.prioridade)}</select></div>
      <div class="campo"><label for="e-per">Periodicidade</label><select id="e-per">${opcoes(PERIODICIDADES, r.periodicidade)}</select></div>
      <div class="campo"><label for="e-ativa">Situação</label><select id="e-ativa">${opcoes([{ id: 'true', nome: 'Ativa' }, { id: 'false', nome: 'Encerrada (não abre mais)' }], String(r.ativa))}</select></div>
      <div class="campo"><label for="e-ini">Primeira ocorrência</label><input type="date" id="e-ini" value="${esc(r.inicio)}"></div>
      <div class="campo"><label for="e-fim">Fim da recorrência</label><input type="date" id="e-fim" value="${esc(r.fim)}"></div>
    </div>`, {
    textoOk: 'Salvar',
    aoConfirmar: async () => {
      const [para, uni] = $('#e-para').value.split('@');
      const item = { id: r.id, titulo: $('#e-tit').value.trim(), descricao: $('#e-desc').value.trim(), para, unidade: uni, setor: $('#e-set').value,
        prioridade: $('#e-pri').value, periodicidade: $('#e-per').value, inicio: $('#e-ini').value, fim: $('#e-fim').value, ativa: $('#e-ativa').value === 'true' };
      const res = await executar('salvarRecorrencia', { item }, 'Recorrência salva.', (x) => { if (x.abertos) aviso(`Recorrência salva. ${x.abertos} ocorrência(s) aberta(s) agora.`); telaRecorrencia(r.id); });
      return res !== false;
    },
  });
}

function janelaApagarRecorrencia(r) {
  const subs = subsDe(r), abertos = subs.filter((c) => c.status !== 'Fechado');
  abrirJanela('Apagar chamado recorrente', `
    <p>Apagar a recorrência <strong>“${esc(r.titulo)}”</strong>? As ocorrências programadas deixam de existir e nada mais será aberto. Não dá para desfazer.</p>
    <p class="pequeno mudo">Chamados já fechados desta recorrência (${subs.length - abertos.length}) ficam guardados no histórico.</p>
    ${abertos.length ? `<label class="pequeno" style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" id="ap-abertos"> Apagar também os ${abertos.length} chamado(s) desta recorrência que ainda estão abertos (${abertos.map(numeroChamado).join(', ')}). Sem marcar, eles continuam valendo.</label>` : ''}`, {
    textoOk: 'Apagar',
    aoConfirmar: async () => {
      const apagarAbertos = !!($('#ap-abertos') && $('#ap-abertos').checked);
      const res = await executar('apagarRecorrencia', { id: r.id, apagarAbertos }, null, (x) => {
        aviso(`Recorrência apagada.${x.apagados ? ` ${x.apagados} chamado(s) aberto(s) apagado(s).` : ''}${x.mantidos ? ` ${x.mantidos} chamado(s) mantido(s).` : ''}`);
        location.hash = '#/recorrencias';
      });
      return res !== false;
    },
  });
}

// ===================== Roteador =====================
async function rotear() {
  const [rota, param] = location.hash.replace(/^#\/?/, '').split('/');
  if (rota === 'esqueci') { telaEsqueci(); return; }
  if (rota === 'redefinir') { telaRedefinir(param || ''); return; }
  if (!token()) { if (rota !== 'login') { location.hash = '#/login'; return; } telaLogin(); return; }
  if (rota === 'login') { location.hash = '#/chamados'; return; }
  if (rota === 'senha') { telaSenha(); return; }
  if (!db) {
    try { await recarregar(); } catch (e) {
      if (location.hash.startsWith('#/senha') || location.hash.startsWith('#/login')) return;
      $('#app').innerHTML = `<div class="login"><div class="cartao"><h1>Chamados</h1><p class="erro-campo">${esc(e.message)}</p><button class="botao" onclick="location.reload()">Tentar de novo</button></div></div>`;
      return;
    }
  }
  const u = sessao();
  window.scrollTo(0, 0);
  switch (rota) {
    case 'painel': return telaPainel();
    case 'chamados': return telaChamados();
    case 'novo': return telaNovo();
    case 'chamado': return telaDetalhe(param);
    case 'recorrencias': return telaRecorrencias();
    case 'recorrencia': return telaRecorrencia(param);
    case 'relatorios': return telaRelatorios();
    case 'notificacoes': return telaNotificacoes();
    case 'cadastros': return telaCadastros(param);
    default: location.hash = podeVerPainel(u) ? '#/painel' : '#/chamados';
  }
}

window.addEventListener('hashchange', rotear);
rotear();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker não registrado', e));
}
