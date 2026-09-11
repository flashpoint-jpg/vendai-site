
const SUPABASE_URL = 'https://rgcclordmqjmwuzrrfbd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_g5Tcimge2aiMX8JE3ml1dg_6zbR3uXi';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const CATEGORIES = [
  {id:'todos', label:'Todos'},
  {id:'moveis', label:'🛋️ Móveis'},
  {id:'eletronicos', label:'📱 Eletrônicos'},
  {id:'veiculos', label:'🚗 Veículos'},
  {id:'roupas', label:'👕 Roupas'},
  {id:'casa', label:'🏠 Casa'},
  {id:'bebe', label:'🍼 Bebê'},
  {id:'outros', label:'📦 Outros'},
];

const CATEGORY_ICON = {moveis:'🛋️', eletronicos:'📱', veiculos:'🚗', roupas:'👕', casa:'🏠', bebe:'🍼', outros:'📦'};
const CATEGORY_COLOR = {moveis:'#E7D9B8', eletronicos:'#CFE0D8', veiculos:'#EAC9B8', roupas:'#E3D2E0', casa:'#D8E2C4', bebe:'#F2DCC9', outros:'#DCD5C8'};
const PRECO_DESTAQUE = 5.90;

const CITIES = [
  {id:'toda', label:'Toda a região'},
  {id:'Muzambinho', label:'Muzambinho, MG'},
  {id:'Alfenas', label:'Alfenas, MG'},
  {id:'Poços de Caldas', label:'Poços de Caldas, MG'},
  {id:'Machado', label:'Machado, MG'},
];

let activeCity = 'toda';
let ads = [];
let activeCategory = 'todos';
let searchTerm = '';
let currentUser = null;
let pendingAction = null;
let pendingChat = null;
let currentChat = null;
let chatPollingInterval = null;
let selectedFotos = [];
let inboxPollingInterval = null;
let inboxUltimoId = null;
let inboxPrimeiraLeitura = true;
let audioCtx = null;
let lightboxIndex = 0;
let currentSessionToken = null;

function normalizarTelefone(valor){
  return String(valor || '').replace(/\D/g,'');
}

function telefoneValido(valor){
  const n = normalizarTelefone(valor);
  return n.length === 10 || n.length === 11;
}

function formatarTelefone(valor){
  const n = normalizarTelefone(valor);
  if(n.length===11) return `(${n.slice(0,2)}) ${n.slice(2,7)}-${n.slice(7)}`;
  if(n.length===10) return `(${n.slice(0,2)}) ${n.slice(2,6)}-${n.slice(6)}`;
  return n;
}

function salvarSessao(){
  if(!currentUser || !currentSessionToken) return;
  localStorage.setItem('vendai_sessao', JSON.stringify({
    token: currentSessionToken,
    id: currentUser.id,
    telefone: normalizarTelefone(currentUser.telefone),
    nome: currentUser.nome
  }));
}

async function restaurarSessao(){
  try{
    const raw = localStorage.getItem('vendai_sessao');
    if(!raw) return;
    const s = JSON.parse(raw);
    if(!s || !s.token){ localStorage.removeItem('vendai_sessao'); return; }
    const { data, error } = await sb.rpc('vendai_validar_sessao', { p_token: s.token });
    if(error || !data || !data.length){ localStorage.removeItem('vendai_sessao'); return; }
    currentSessionToken = s.token;
    currentUser = data[0];
    iniciarMonitorMensagens();
  }catch(e){
    console.warn('Sessão inválida', e);
    localStorage.removeItem('vendai_sessao');
  }
}

async function sairConta(){
  const token = currentSessionToken;
  currentUser = null;
  currentSessionToken = null;
  localStorage.removeItem('vendai_sessao');
  if(token){ try{ await sb.rpc('vendai_logout', { p_token: token }); }catch(e){} }
  if(inboxPollingInterval){ clearInterval(inboxPollingInterval); inboxPollingInterval = null; }
  inboxUltimoId = null;
  inboxPrimeiraLeitura = true;
  atualizarBadgeMensagens(0);
  closeSheet('profileOverlay');
  showToast('Você saiu da conta');
}

function prepararSom(){
  try{
    if(!audioCtx){ audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    if(audioCtx.state === 'suspended') audioCtx.resume();
  }catch(e){}
}

function tocarSomMensagem(){
  try{
    prepararSom();
    if(!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type='sine';
    osc.frequency.setValueAtTime(740, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, audioCtx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.26);
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.start(); osc.stop(audioCtx.currentTime + 0.28);
  }catch(e){}
}

function atualizarBadgeMensagens(qtd){
  const badge = document.getElementById('msgBadge');
  if(!badge) return;
  if(qtd>0){
    badge.textContent = qtd>99 ? '99+' : String(qtd);
    badge.classList.add('show');
  }else{
    badge.classList.remove('show');
    badge.textContent='0';
  }
}

async function checarMensagensNovas(){
  if(!currentUser || !currentSessionToken) return;
  const { data, error } = await sb.rpc('vendai_inbox_segura', { p_token: currentSessionToken });
  if(error || !data) return;
  const naoLidas = data.filter(m => !m.lida_em).length;
  atualizarBadgeMensagens(naoLidas);
  if(data.length===0) return;
  const maisNova = data[0];
  if(inboxPrimeiraLeitura){
    inboxUltimoId = maisNova.id;
    inboxPrimeiraLeitura = false;
    return;
  }
  if(inboxUltimoId && maisNova.id !== inboxUltimoId){
    const chatAbertoMesmoRemetente = currentChat && currentChat.outroId === maisNova.remetente_id && document.getElementById('chatOverlay').classList.contains('show');
    if(!chatAbertoMesmoRemetente){
      tocarSomMensagem();
      showToast(`💬 Nova mensagem de ${maisNova.remetente_nome || 'alguém'}`);
      if('Notification' in window && Notification.permission === 'granted'){
        try{ new Notification('Vendaí • Nova mensagem', { body: `${maisNova.remetente_nome || 'Alguém'}: ${maisNova.texto}` }); }catch(e){}
      }
    }
    inboxUltimoId = maisNova.id;
  }
}

function iniciarMonitorMensagens(){
  if(!currentUser) return;
  if(inboxPollingInterval) clearInterval(inboxPollingInterval);
  inboxPrimeiraLeitura = true;
  checarMensagensNovas();
  inboxPollingInterval = setInterval(checarMensagensNovas, 3500);
}

async function ativarNotificacoes(){
  prepararSom();
  if('Notification' in window && Notification.permission === 'default'){
    try{ await Notification.requestPermission(); }catch(e){}
  }
  showToast('Alertas de mensagem ativados 🔔');
}

function openLoginSheet(){
  document.getElementById('loginOverlay').classList.add('show');
}

async function entrar(){
  prepararSom();
  const telefone = normalizarTelefone(document.getElementById('lTelefone').value);
  const nome = document.getElementById('lNome').value.trim();
  const pin = String(document.getElementById('lPin').value || '').replace(/\D/g,'');
  const status = document.getElementById('loginStatus');
  if(status){ status.style.display='none'; status.textContent=''; }

  if(!nome || !telefone || !pin){ showToast('Preencha telefone, nome e PIN'); return; }
  if(!telefoneValido(telefone)){ showToast('Digite o telefone completo com DDD'); return; }
  if(!/^\d{4,6}$/.test(pin)){ showToast('O PIN deve ter de 4 a 6 números'); return; }

  const btn = document.querySelector('#loginOverlay .publishBtn');
  if(btn){ btn.textContent='Aguarde...'; btn.disabled=true; }
  let data=null, error=null;
  try{
    const resp = await sb.rpc('vendai_login_seguro', { p_telefone: telefone, p_nome: nome, p_pin: pin });
    data = resp.data; error = resp.error;
  }catch(e){ error=e; }
  if(btn){ btn.textContent='Entrar / Criar conta'; btn.disabled=false; }

  if(error || !data || !data.length){
    const msg = String(error?.message || '');
    let aviso = 'Não consegui entrar ou criar a conta agora. Tente novamente.';
    if(msg.includes('pin_incorreto')) aviso='PIN incorreto para esse telefone.';
    else if(msg.includes('conta_ja_existe')) aviso='Esse telefone já tem uma conta antiga. Digite o mesmo nome cadastrado e escolha o PIN para protegê-la.';
    else if(msg.includes('telefone_invalido')) aviso='Digite o telefone completo com DDD.';
    else if(msg.includes('pin_invalido')) aviso='Use um PIN de 4 a 6 números.';
    if(status){ status.textContent=aviso; status.style.display='block'; }
    showToast(aviso);
    console.error('Falha no acesso Vendaí', error);
    return;
  }

  const u = data[0];
  currentUser = { id:u.id, telefone:u.telefone, nome:u.nome };
  currentSessionToken = u.sessao_token;
  salvarSessao();
  iniciarMonitorMensagens();
  document.getElementById('lPin').value='';
  closeSheet('loginOverlay');
  await carregarAnuncios();
  showToast(u.primeiro_acesso ? 'Conta criada/protegida e acesso liberado ✓' : `Bem-vindo(a), ${currentUser.nome} 👋`);

  if(pendingAction === 'post'){ pendingAction=null; openPostSheet(); }
  else if(pendingAction === 'profile'){ pendingAction=null; openProfileSheet(); }
  else if(pendingAction === 'conversas'){ pendingAction=null; abrirConversas(); }
  else if(pendingAction === 'loja'){ pendingAction=null; openLojaPainel(); }
  else if(pendingAction === 'buy_loja' && produtoLojaAtual){ pendingAction=null; abrirProdutoLoja(produtoLojaAtual.id); }
  else if(pendingAction === 'chat' && pendingChat){
    pendingAction=null; const c=pendingChat; pendingChat=null;
    iniciarChat(c.anuncioId,c.titulo,c.outroId,c.outroNome);
  }
}

function openProfileSheet(){
  if(!currentUser || !currentSessionToken){
    pendingAction = 'profile';
    openLoginSheet();
    return;
  }
  renderProfile();
  document.getElementById('profileOverlay').classList.add('show');
}

async function renderProfile(){
  const content = document.getElementById('profileContent');
  content.innerHTML = `
    <div class="sellerRow" style="margin-bottom:16px;">
      <div class="sellerAvatar">🙂</div>
      <div><div class="sellerName">${currentUser.nome}</div><div class="sellerLoc">${formatarTelefone(currentUser.telefone)}</div></div>
    </div>
    <div style="display:flex; gap:8px; margin:0 0 14px; flex-wrap:wrap;">
      <button onclick="ativarNotificacoes()" style="border:none;border-radius:999px;background:var(--green-soft);color:var(--green-dark);padding:8px 12px;font-weight:700;cursor:pointer;">🔔 Ativar alertas</button>
      <button onclick="openSupportSheet()" style="border:none;border-radius:999px;background:#FFF7D9;color:#8A6500;padding:8px 12px;font-weight:700;cursor:pointer;">🧪 Suporte</button>
      <button onclick="closeSheet('profileOverlay');openLojaPainel()" style="border:none;border-radius:999px;background:#E8F1EB;color:var(--green-dark);padding:8px 12px;font-weight:700;cursor:pointer;">🏪 Minha loja</button>
      <button onclick="sairConta()" style="border:none;border-radius:999px;background:#FBE9E9;color:var(--danger);padding:8px 12px;font-weight:700;cursor:pointer;">Sair</button>
    </div>
    <div class="detailTitle" style="font-size:15px;margin-bottom:10px;">Meus anúncios</div>
    <div id="meusAnunciosList" style="font-size:13px;color:var(--ink-soft);">Carregando...</div>`;

  const { data, error } = await sb.rpc('vendai_meus_anuncios', { p_token: currentSessionToken });
  const list = document.getElementById('meusAnunciosList');
  if(error){ list.textContent='Não consegui carregar seus anúncios.'; return; }
  if(!data || data.length===0){ list.textContent='Você ainda não publicou nenhum anúncio.'; return; }
  list.innerHTML='';
  data.forEach(ad=>{
    const row=document.createElement('div'); row.className='sellerRow'; row.style.marginBottom='10px'; row.style.alignItems='flex-start';
    row.innerHTML=`<div style="width:34px;height:34px;border-radius:10px;background:${CATEGORY_COLOR[ad.categoria]};display:flex;align-items:center;justify-content:center;font-size:16px;flex:0 0 auto;">${CATEGORY_ICON[ad.categoria]}</div>
      <div style="flex:1;"><div class="sellerName">${ad.titulo}</div><div class="sellerLoc">${formatPrice(ad.preco)} · ${ad.status==='vendido'?'Vendido':(ad.destaque?'🔥 Destacado':'Ativo')}</div></div>
      <div style="display:flex;flex-direction:column;gap:6px;">${ad.status==='vendido'?'':`<button style="font-size:11px;border:none;background:var(--green-soft);color:var(--green-dark);border-radius:8px;padding:5px 8px;font-weight:700;cursor:pointer;" onclick="marcarVendido('${ad.id}')">Marcar vendido</button>`}<button style="font-size:11px;border:none;background:#FBE9E9;color:var(--danger);border-radius:8px;padding:5px 8px;font-weight:700;cursor:pointer;" onclick="excluirAnuncio('${ad.id}')">Excluir</button></div>`;
    list.appendChild(row);
  });
}

async function marcarVendido(id){
  const { error } = await sb.rpc('vendai_atualizar_status_anuncio', { p_token:currentSessionToken, p_id:id, p_status:'vendido' });
  if(error){ showToast('Não consegui alterar o anúncio'); return; }
  await renderProfile(); await carregarAnuncios(); showToast('Anúncio marcado como vendido ✓');
}

async function excluirAnuncio(id){
  const { error } = await sb.rpc('vendai_atualizar_status_anuncio', { p_token:currentSessionToken, p_id:id, p_status:'removido' });
  if(error){ showToast('Não consegui remover o anúncio'); return; }
  await renderProfile(); await carregarAnuncios(); showToast('Anúncio removido ✓');
}

function renderCityList(){
  const list = document.getElementById('cityList');
  list.innerHTML = '';
  CITIES.forEach(c=>{
    const row = document.createElement('div');
    row.className = 'cityOption' + (c.id===activeCity ? ' active' : '');
    row.innerHTML = `<span>${c.label}</span><span class="cityCheck">✓</span>`;
    row.onclick = () => selecionarCidade(c.id, c.label);
    list.appendChild(row);
  });
}

function openLocationSheet(){
  renderCityList();
  document.getElementById('locationOverlay').classList.add('show');
}

function selecionarCidade(id, label){
  activeCity = id;
  document.getElementById('locationBtn').textContent = '📍 ' + label + ' ▾';
  closeSheet('locationOverlay');
  renderGrid();
}

async function carregarAnuncios(){
  let data=null, error=null;
  try{
    const resp = await sb.rpc('vendai_listar_anuncios');
    data=resp.data; error=resp.error;
  }catch(e){ error=e; }

  // Fallback de leitura pública: evita o feed vazio em navegador com cache/versão anterior.
  if(error){
    console.warn('RPC do feed falhou, tentando leitura pública', error);
    try{
      const direto = await sb.from('vendai_anuncios')
        .select('id,titulo,preco,categoria,cidade,descricao,vendedor_nome,vendedor_id,fotos,destaque,destaque_expira_em,status,criado_em')
        .eq('status','ativo')
        .order('destaque',{ascending:false})
        .order('criado_em',{ascending:false});
      data=direto.data; error=direto.error;
    }catch(e){ error=e; }
  }

  if(error){
    console.error(error);
    ads=[]; renderGrid();
    showToast('Não consegui carregar os anúncios agora');
    return;
  }
  ads = data || [];
  renderGrid();
}

function renderChips(){
  const row = document.getElementById('chipRow');
  row.innerHTML = '';
  CATEGORIES.forEach(cat=>{
    const chip = document.createElement('button');
    chip.className = 'chip' + (cat.id===activeCategory ? ' active' : '');
    chip.textContent = cat.label;
    chip.onclick = () => { activeCategory = cat.id; renderChips(); renderGrid(); };
    row.appendChild(chip);
  });
}

function formatPrice(n){
  return 'R$ ' + Number(n).toLocaleString('pt-BR', {minimumFractionDigits:0});
}

function tempoDecorrido(dataISO){
  const diffMs = Date.now() - new Date(dataISO).getTime();
  const min = Math.floor(diffMs/60000);
  if(min < 1) return 'agora mesmo';
  if(min < 60) return `há ${min} min`;
  const h = Math.floor(min/60);
  if(h < 24) return `há ${h}h`;
  const d = Math.floor(h/24);
  return `há ${d} dia${d>1?'s':''}`;
}

function renderGrid(){
  const grid = document.getElementById('grid');
  const empty = document.getElementById('emptyState');
  grid.innerHTML = '';

  const filtered = ads.filter(ad=>{
    const matchCat = activeCategory==='todos' || ad.categoria===activeCategory;
    const matchSearch = ad.titulo.toLowerCase().includes(searchTerm.toLowerCase());
    const matchCity = activeCity==='toda' || ad.cidade.includes(activeCity);
    return matchCat && matchSearch && matchCity;
  });

  if(filtered.length===0){
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  filtered.forEach(ad=>{
    const card = document.createElement('div');
    card.className = 'card';
    card.onclick = () => openDetail(ad.id);
    card.innerHTML = `
      <div class="thumb" style="background:${CATEGORY_COLOR[ad.categoria]}; position:relative; padding:0; overflow:hidden;">
        ${ad.fotos && ad.fotos.length>0
          ? `<img src="${ad.fotos[0]}" style="width:100%;height:100%;object-fit:cover;">`
          : CATEGORY_ICON[ad.categoria]}
        ${ad.destaque ? '<div style="position:absolute; top:8px; left:8px; background:var(--yellow); border-radius:8px; font-size:9.5px; font-weight:700; padding:3px 7px; color:var(--ink);">🔥 Destaque</div>' : ''}
      </div>
      <div class="cardBody">
        <div class="cardTitle">${ad.titulo}</div>
        <div class="cardPrice">${formatPrice(ad.preco)}</div>
        <div class="cardMeta">${ad.cidade} · ${tempoDecorrido(ad.criado_em)}</div>
      </div>
    `;
    grid.appendChild(card);
  });
}

function openDetail(id){
  const ad = ads.find(a=>a.id===id);
  if(!ad) return;
  window._anuncioAtual = ad;
  window._fotoAtual = 0;
  const content = document.getElementById('detailContent');
  const temFotos = ad.fotos && ad.fotos.length>0;
  const qtdFotos = temFotos ? ad.fotos.length : 0;

  const galeria = temFotos ? `
    <div class="detailGallery">
      <img id="detailMainPhoto" class="detailGalleryMain" src="${ad.fotos[0]}" onclick="abrirLightbox(window._fotoAtual || 0)" alt="${ad.titulo}">
      ${qtdFotos>1 ? `<button class="galleryArrow prev" onclick="event.stopPropagation(); mudarFotoDetalhe(-1)">‹</button><button class="galleryArrow next" onclick="event.stopPropagation(); mudarFotoDetalhe(1)">›</button>` : ''}
      <div class="galleryCounter" id="detailGalleryCounter">1 / ${qtdFotos}</div>
    </div>
    ${qtdFotos>1 ? `<div class="galleryThumbs" id="detailThumbs">${ad.fotos.map((f,i)=>`<img class="galleryThumb ${i===0?'active':''}" data-index="${i}" src="${f}" onclick="selecionarFotoDetalhe(${i})" alt="Foto ${i+1}">`).join('')}</div>` : ''}
  ` : `<div class="detailThumb" style="background:${CATEGORY_COLOR[ad.categoria]};">${CATEGORY_ICON[ad.categoria]}</div>`;

  content.innerHTML = `
    ${galeria}
    <div class="detailTitle" style="margin-top:14px;">${ad.titulo}</div>
    <div class="detailPrice">${formatPrice(ad.preco)}</div>
    <div class="detailMeta">${ad.cidade} · publicado ${tempoDecorrido(ad.criado_em)}</div>
    <div class="detailDesc">${ad.descricao || 'Sem descrição.'}</div>
    <div class="sellerRow">
      <div class="sellerAvatar">🙂</div>
      <div>
        <div class="sellerName">${ad.vendedor_nome || 'Anônimo'}</div>
        <div class="sellerLoc">${ad.cidade}</div>
      </div>
    </div>
    <div class="btnRow">
      <div class="btnPrimary" onclick="iniciarChatFromDetail()">💬 Chamar no chat</div>
      <div class="btnGhost" onclick="showToast('Denúncia registrada (simulação)')">🚩 Denunciar</div>
    </div>
    ${(!ad.destaque && currentUser && currentUser.id===ad.vendedor_id) ? `<div class="publishBtn" style="margin-top:12px; background:var(--card); border:1.5px solid #E2E9E3; box-shadow:none; color:var(--green-dark);" onclick="destacarAnuncio('${ad.id}')">🏷️ Destacar este anúncio — ${formatPrice(PRECO_DESTAQUE)}</div>` : ''}
  `;
  document.getElementById('detailOverlay').classList.add('show');
}

function iniciarChatFromDetail(){
  const ad = window._anuncioAtual;
  if(!ad) return;
  iniciarChat(ad.id, ad.titulo, ad.vendedor_id || '', ad.vendedor_nome || 'Anônimo');
}

function selecionarFotoDetalhe(index){
  const ad = window._anuncioAtual;
  if(!ad || !ad.fotos || !ad.fotos[index]) return;
  window._fotoAtual = index;
  const img = document.getElementById('detailMainPhoto');
  if(img) img.src = ad.fotos[index];
  const counter = document.getElementById('detailGalleryCounter');
  if(counter) counter.textContent = `${index+1} / ${ad.fotos.length}`;
  document.querySelectorAll('#detailThumbs .galleryThumb').forEach(el=>el.classList.toggle('active', Number(el.dataset.index)===index));
}

function mudarFotoDetalhe(delta){
  const ad = window._anuncioAtual;
  if(!ad || !ad.fotos || ad.fotos.length<2) return;
  const atual = Number(window._fotoAtual || 0);
  selecionarFotoDetalhe((atual + delta + ad.fotos.length) % ad.fotos.length);
}

function abrirLightbox(index){
  const ad = window._anuncioAtual;
  if(!ad || !ad.fotos || ad.fotos.length===0) return;
  lightboxIndex = Math.max(0, Math.min(index, ad.fotos.length-1));
  atualizarLightbox();
  document.getElementById('lightboxOverlay').classList.add('show');
}

function atualizarLightbox(){
  const ad = window._anuncioAtual;
  if(!ad || !ad.fotos || ad.fotos.length===0) return;
  document.getElementById('lightboxImg').src = ad.fotos[lightboxIndex];
  document.getElementById('lightboxCount').textContent = `${lightboxIndex+1} / ${ad.fotos.length}`;
  const showArrows = ad.fotos.length>1;
  document.getElementById('lightboxPrev').style.display = showArrows ? 'block' : 'none';
  document.getElementById('lightboxNext').style.display = showArrows ? 'block' : 'none';
}

function mudarFotoLightbox(delta){
  const ad = window._anuncioAtual;
  if(!ad || !ad.fotos || ad.fotos.length<2) return;
  lightboxIndex = (lightboxIndex + delta + ad.fotos.length) % ad.fotos.length;
  window._fotoAtual = lightboxIndex;
  atualizarLightbox();
  selecionarFotoDetalhe(lightboxIndex);
}

async function destacarAnuncio(id){
  const { error } = await sb.rpc('vendai_destacar_anuncio_seguro', { p_token:currentSessionToken, p_id:id });
  if(error){ showToast('Não consegui destacar agora'); return; }
  closeSheet('detailOverlay'); await carregarAnuncios(); showToast('Anúncio destacado por 7 dias (teste) ✓');
}

function openPostSheet(){
  if(!currentUser || !currentSessionToken){
    pendingAction = 'post';
    openLoginSheet();
    return;
  }
  document.getElementById('postOverlay').classList.add('show');
}

function closeSheet(id){
  document.getElementById(id).classList.remove('show');
}

function closeOverlayBg(e, id){
  if(e.target.id===id) closeSheet(id);
}

async function publishAd(){
  if(!currentUser || !currentSessionToken){ pendingAction='post'; openLoginSheet(); return; }
  const titulo=document.getElementById('fTitle').value.trim();
  const preco=parseFloat(document.getElementById('fPrice').value);
  const categoria=document.getElementById('fCategory').value;
  const descricao=document.getElementById('fDesc').value.trim();
  if(!titulo || !preco){ showToast('Preencha pelo menos título e preço'); return; }
  const btn=document.getElementById('btnPublicar'); btn.textContent='Publicando...'; btn.style.opacity='.65'; btn.style.pointerEvents='none';
  let fotosUrls=[];
  for(const file of selectedFotos){
    try{
      const form=new FormData();
      form.append('token',currentSessionToken);
      form.append('file',file,file.name);
      const resp=await fetch(`${SUPABASE_URL}/functions/v1/vendai-upload`,{method:'POST',headers:{apikey:SUPABASE_KEY},body:form});
      const up=await resp.json();
      if(resp.ok && up.publicUrl) fotosUrls.push(up.publicUrl);
      else console.warn('Falha ao enviar foto',up);
    }catch(e){ console.warn('Falha ao enviar foto',e); }
  }
  if(selectedFotos.length && fotosUrls.length===0){
    btn.textContent='Publicar anúncio'; btn.style.opacity='1'; btn.style.pointerEvents='auto';
    showToast('Não consegui enviar as fotos. Tente novamente.'); return;
  }
  const { error }=await sb.rpc('vendai_publicar_anuncio',{p_token:currentSessionToken,p_titulo:titulo,p_preco:preco,p_categoria:categoria,p_descricao:descricao||'',p_cidade:'Muzambinho, MG',p_fotos:fotosUrls});
  btn.textContent='Publicar anúncio'; btn.style.opacity='1'; btn.style.pointerEvents='auto';
  if(error){
    console.error(error);
    const msg=String(error.message||'');
    if(msg.includes('sessao_invalida')){
      currentUser=null; currentSessionToken=null; localStorage.removeItem('vendai_sessao');
      closeSheet('postOverlay'); pendingAction='post'; openLoginSheet();
      showToast('Sua sessão venceu. Entre novamente para publicar.');
    }else showToast('Não consegui publicar agora. Tente novamente.');
    return;
  }
  document.getElementById('fTitle').value=''; document.getElementById('fPrice').value=''; document.getElementById('fDesc').value=''; document.getElementById('fFoto').value=''; document.getElementById('fotoPreview').innerHTML=''; document.getElementById('photoBox').textContent='📷 Toque pra adicionar fotos'; selectedFotos=[];
  closeSheet('postOverlay'); activeCategory='todos'; renderChips(); await carregarAnuncios(); showToast('Anúncio publicado ✓');
}

function previewFotos(){
  selectedFotos = Array.from(document.getElementById('fFoto').files);
  if(selectedFotos.length > 4){
    selectedFotos = selectedFotos.slice(0,4);
    showToast('No plano grátis, o limite é 4 fotos por anúncio');
  }
  const preview = document.getElementById('fotoPreview');
  preview.innerHTML = '';
  selectedFotos.forEach(file=>{
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    img.className = 'fotoThumbPreview';
    preview.appendChild(img);
  });
  document.getElementById('photoBox').textContent = selectedFotos.length>0
    ? `📷 ${selectedFotos.length}/4 foto(s) selecionada(s) — toque pra trocar`
    : '📷 Toque pra adicionar fotos (até 4 no plano grátis)';
}

async function iniciarChat(anuncioId, titulo, outroId, outroNome){
  if(!currentUser || !currentSessionToken){
    pendingChat={anuncioId,titulo,outroId,outroNome}; pendingAction='chat'; openLoginSheet(); return;
  }
  if(!outroId){ showToast('Não consegui identificar o vendedor deste anúncio'); return; }
  if(outroId===currentUser.id){ showToast('Esse é o seu próprio anúncio 🙂'); return; }
  currentChat={anuncioId,titulo,outroId,outroNome};
  document.getElementById('chatHeader').textContent=outroNome+' · '+titulo;
  closeSheet('detailOverlay'); closeSheet('conversasOverlay'); document.getElementById('chatOverlay').classList.add('show');
  await carregarMensagens(); if(chatPollingInterval) clearInterval(chatPollingInterval); chatPollingInterval=setInterval(carregarMensagens,3000);
}

function fecharChat(){
  closeSheet('chatOverlay');
  if(chatPollingInterval){ clearInterval(chatPollingInterval); chatPollingInterval = null; }
  const painel=document.getElementById('chatOfferPanel'); if(painel){ painel.innerHTML=''; painel.classList.remove('show'); }
  currentChat = null;
}

async function carregarMensagens(){
  if(!currentChat || !currentUser || !currentSessionToken) return;
  const box=document.getElementById('chatMensagens');
  const { data, error } = await sb.rpc('vendai_chat_seguro',{p_token:currentSessionToken,p_anuncio_id:currentChat.anuncioId,p_outro_id:currentChat.outroId});
  if(error){
    console.error('Erro ao carregar chat', error);
    box.innerHTML='<div class="chatLoadError">Não consegui abrir as mensagens agora.<br>Feche e abra a conversa novamente.</div>';
    return;
  }
  const mensagens=data||[];
  box.innerHTML='';
  if(mensagens.length===0){
    box.innerHTML='<div style="text-align:center;color:var(--ink-soft);font-size:12.5px;margin-top:20px;">Envie a primeira mensagem</div>';
  }else{
    mensagens.forEach(m=>{
      const bubble=document.createElement('div');
      const ehMinha=m.remetente_id===currentUser.id;
      const ehOferta=String(m.texto||'').startsWith('💰');
      const ehRespostaOferta=String(m.texto||'').startsWith('✅ Oferta') || String(m.texto||'').startsWith('❌ Oferta');
      bubble.className='msgBubble '+(ehMinha?'mine':'theirs')+((ehOferta||ehRespostaOferta)?' oferta':'');
      bubble.textContent=m.texto;
      box.appendChild(bubble);
    });
    box.scrollTop=box.scrollHeight;
  }
  await carregarOfertasChat();
  checarMensagensNovas();
}

async function carregarOfertasChat(){
  const painel=document.getElementById('chatOfferPanel');
  if(!painel || !currentChat || !currentUser || !currentSessionToken) return;
  const { data, error }=await sb.rpc('vendai_ofertas_conversa',{p_token:currentSessionToken,p_anuncio_id:currentChat.anuncioId,p_outro_id:currentChat.outroId});
  if(error){ console.error('Erro ao carregar ofertas',error); painel.classList.remove('show'); painel.innerHTML=''; return; }
  const ofertas=data||[];
  if(ofertas.length===0){ painel.classList.remove('show'); painel.innerHTML=''; return; }
  painel.innerHTML='<div style="font-size:11px;font-weight:800;color:#7A5A00;margin-bottom:4px;">💰 OFERTAS DESTA CONVERSA</div>';
  ofertas.slice(0,3).forEach(o=>{
    const card=document.createElement('div');
    card.className='offerCard';
    const souVendedor=o.vendedor_id===currentUser.id;
    const statusLabel=o.status==='aceita'?'Aceita':(o.status==='recusada'?'Recusada':'Aguardando');
    card.innerHTML=`
      <div style="min-width:0;flex:1;">
        <div class="offerValue">${formatPrice(o.valor)}</div>
        <div class="offerMeta">${souVendedor ? 'Oferta de '+(o.comprador_nome||'comprador') : 'Sua oferta'}</div>
      </div>
      ${souVendedor && o.status==='pendente'
        ? `<div class="offerActions"><button class="offerAccept" onclick="responderOferta('${o.id}',true)">Aceitar</button><button class="offerReject" onclick="responderOferta('${o.id}',false)">Recusar</button></div>`
        : `<div class="offerStatus ${o.status}">${statusLabel}</div>`}
    `;
    painel.appendChild(card);
  });
  painel.classList.add('show');
}

async function responderOferta(ofertaId, aceitar){
  if(!currentSessionToken) return;
  const { data, error }=await sb.rpc('vendai_responder_oferta',{p_token:currentSessionToken,p_oferta_id:ofertaId,p_aceitar:aceitar});
  if(error){ console.error(error); showToast('Não consegui responder a oferta'); return; }
  showToast(aceitar?'Oferta aceita ✓':'Oferta recusada');
  await carregarMensagens();
}

async function fazerOferta(){
  if(!currentChat || !currentSessionToken) return;
  const valor=prompt('Qual valor você quer oferecer? (só números, ex: 400)'); if(!valor) return;
  const num=parseFloat(valor.replace(',','.')); if(isNaN(num)||num<=0){ showToast('Valor inválido'); return; }
  const { error }=await sb.rpc('vendai_criar_oferta',{p_token:currentSessionToken,p_anuncio_id:currentChat.anuncioId,p_valor:num});
  if(error){ console.error(error); showToast('Não consegui enviar a oferta'); return; }
  showToast('Oferta enviada ✓');
  await carregarMensagens();
}

async function enviarMensagem(){
  const input=document.getElementById('chatInput'); const texto=input.value.trim(); if(!texto||!currentChat||!currentSessionToken) return;
  input.value='';
  const { error }=await sb.rpc('vendai_enviar_mensagem_segura',{p_token:currentSessionToken,p_anuncio_id:currentChat.anuncioId,p_destinatario_id:currentChat.outroId,p_texto:texto});
  if(error){ showToast('Mensagem não enviada'); input.value=texto; return; }
  await carregarMensagens();
}

async function abrirConversas(){
  if(!currentUser || !currentSessionToken){ pendingAction='conversas'; openLoginSheet(); return; }
  const box=document.getElementById('listaConversas');
  const { data, error }=await sb.rpc('vendai_conversas_seguras',{p_token:currentSessionToken});
  if(error){ box.innerHTML='<div class="emptyMsg">Não consegui carregar as conversas.</div>'; document.getElementById('conversasOverlay').classList.add('show'); return; }
  if(!data || data.length===0){ box.innerHTML='<div style="text-align:center;color:var(--ink-soft);padding:30px 10px;font-size:13.5px;">Nenhuma conversa ainda. Chame alguém pelo chat de um anúncio.</div>'; document.getElementById('conversasOverlay').classList.add('show'); return; }
  const ultimaPorConversa={};
  data.forEach(m=>{
    const outro=m.remetente_id===currentUser.id ? m.destinatario_id : m.remetente_id;
    const nome=m.remetente_id===currentUser.id ? (m.destinatario_nome||'Usuário') : (m.remetente_nome||'Usuário');
    ultimaPorConversa[m.anuncio_id+'|'+outro]={...m,outro,nome};
  });
  const lista=Object.values(ultimaPorConversa).sort((a,b)=>new Date(b.criado_em)-new Date(a.criado_em));
  box.innerHTML='';
  lista.forEach(m=>{ const row=document.createElement('div'); row.className='sellerRow'; row.style.cursor='pointer'; row.style.marginBottom='10px'; row.onclick=()=>iniciarChat(m.anuncio_id,m.anuncio_titulo||'Anúncio',m.outro,m.nome); row.innerHTML=`<div class="sellerAvatar">🙂</div><div style="flex:1;min-width:0;"><div class="sellerName">${m.nome} · ${m.anuncio_titulo||''}</div><div class="sellerLoc" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${m.texto}</div></div>`; box.appendChild(row); });
  document.getElementById('conversasOverlay').classList.add('show');
  await checarMensagensNovas();
}

function openSupportSheet(){
  document.getElementById('supportStatus').style.display='none';
  document.getElementById('supportOverlay').classList.add('show');
}

async function enviarSuporte(){
  const tipo=document.getElementById('supportTipo').value;
  const mensagem=document.getElementById('supportMensagem').value.trim();
  if(mensagem.length<5){ showToast('Conte um pouco mais sobre o problema ou sugestão'); return; }
  const btn=document.getElementById('supportEnviarBtn'); btn.textContent='Enviando...'; btn.disabled=true;
  const { data, error }=await sb.rpc('vendai_enviar_suporte',{p_token:currentSessionToken||null,p_tipo:tipo,p_mensagem:mensagem,p_pagina:location.href,p_user_agent:navigator.userAgent});
  btn.textContent='Enviar para o suporte'; btn.disabled=false;
  if(error){ showToast('Não consegui enviar agora'); return; }
  document.getElementById('supportMensagem').value='';
  const st=document.getElementById('supportStatus'); st.textContent='✓ Recebido. Obrigado por ajudar a testar o Vendaí.'; st.style.display='block';
  showToast('Relato enviado ao suporte ✓');
}


let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
});

async function instalarVendaI(){
  prepararSom();
  // Se o navegador oferecer instalação PWA nativa, ela é a experiência mais limpa.
  if(deferredInstallPrompt){
    try{
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      if(choice && choice.outcome === 'accepted'){
        deferredInstallPrompt = null;
        showToast('Vendaí instalado ✓');
        return;
      }
    }catch(e){}
  }
  // APK oficial de teste incluído no pacote.
  const note = document.getElementById('apkNote');
  if(note) note.classList.add('show');
  showToast('Baixando o app Vendaí…');
  const a=document.createElement('a');
  a.href='/vendai.apk?v=final-20260909';
  a.download='vendai.apk';
  a.rel='noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

window.addEventListener('appinstalled', ()=>{
  const box=document.getElementById('installHero');
  if(box) box.style.display='none';
});

function showToast(msg){
  const toast = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  toast.classList.add('show');
  setTimeout(()=> toast.classList.remove('show'), 2200);
}

document.getElementById('searchInput').addEventListener('input', (e)=>{
  searchTerm = e.target.value;
  renderGrid();
});

document.addEventListener('pointerdown', ()=>prepararSom(), { once:true });

document.addEventListener('keydown', (e)=>{
  const lb = document.getElementById('lightboxOverlay');
  if(!lb || !lb.classList.contains('show')) return;
  if(e.key==='ArrowLeft') mudarFotoLightbox(-1);
  if(e.key==='ArrowRight') mudarFotoLightbox(1);
  if(e.key==='Escape') closeSheet('lightboxOverlay');
});



// ===== Marketplace para lojistas + Entrega Flash =====
let lojasPublicas=[];
let produtosLojas=[];
let lojaAtual=null;
let lojaProdutosMeus=[];
let lojaProdutoFotos=[];
let produtoLojaAtual=null;
let taxaVendai=8;
let ultimaCotacaoFlash=null;

function escHtml(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function nomeVeiculo(v){return ({bicicleta:'Bicicleta',moto:'Moto',carro:'Carro',carroaberto:'Carro aberto',fiorino:'Fiorino',van:'Van',caminhao:'Caminhão'})[v]||v||'Moto';}
function nomeEntrega(t){return ({entrega_flash:'Entrega Flash',retirada_loja:'Retirada na loja',entrega_propria:'Entrega própria da loja'})[t]||t||'';}
function nomeStatusEntrega(s){return ({aguardando_pagamento:'Aguardando pagamento',buscando:'Procurando entregador',entregador_a_caminho_da_loja:'Entregador a caminho da loja',coletado:'Produto coletado',a_caminho:'A caminho do cliente',entregue:'Entregue',cancelada:'Entrega cancelada',retirada_loja:'Retirada na loja',entrega_propria:'Entrega da loja',nao_solicitada:'Não solicitada'})[s]||s||'';}

async function vendaiEntrega(action,body={}){
  const resp=await fetch(`${SUPABASE_URL}/functions/v1/vendai-entrega`,{method:'POST',headers:{apikey:SUPABASE_KEY,'Content-Type':'application/json'},body:JSON.stringify({token:currentSessionToken,action,...body})});
  const j=await resp.json().catch(()=>({})); if(!resp.ok)throw new Error(j.error||'falha_entrega'); return j;
}
async function carregarMarketplaceLojas(){
  try{
    const [cfg,ls,ps]=await Promise.all([sb.rpc('vendai_loja_config_publica'),sb.rpc('vendai_lojas_publicas'),sb.rpc('vendai_produtos_loja_publicos_v2',{p_loja_id:null})]);
    if(cfg.data?.[0]?.taxa_comissao!=null) taxaVendai=Number(cfg.data[0].taxa_comissao);
    lojasPublicas=ls.data||[]; produtosLojas=ps.data||[]; renderMarketplaceLojas();
  }catch(e){console.warn('Lojas indisponíveis',e);}
}
function renderMarketplaceLojas(){
  const section=document.getElementById('lojasSection'),rail=document.getElementById('storeRail'),grid=document.getElementById('storeProductsGrid');
  if(!section||!rail||!grid)return;
  if(!lojasPublicas.length&&!produtosLojas.length){section.style.display='none';return;}
  section.style.display='block';rail.innerHTML='';grid.innerHTML='';
  lojasPublicas.slice(0,12).forEach(l=>{const el=document.createElement('div');el.className='storeCard';el.onclick=()=>filtrarLojaPublica(l.id,l.nome);el.innerHTML=`<div class="storeLogo">${l.logo_url?`<img src="${escHtml(l.logo_url)}" alt="">`:'🏪'}</div><div class="storeName">${escHtml(l.nome)}</div><div class="storeCity">📍 ${escHtml(l.cidade)}</div><div class="storeCount">${Number(l.qtd_produtos||0)} produto${Number(l.qtd_produtos||0)===1?'':'s'}</div>`;rail.appendChild(el);});
  produtosLojas.slice(0,10).forEach(p=>grid.appendChild(cardProdutoLoja(p)));
}
function cardProdutoLoja(p){
  const el=document.createElement('div');el.className='storeProductCard';el.onclick=()=>abrirProdutoLoja(p.id);const foto=p.fotos?.[0];
  const entrega=p.entrega_flash_ativa?'⚡ Entrega Flash':(p.retirada_loja_ativa?'🏪 Retirada':'🚚 Entrega da loja');
  el.innerHTML=`<div class="storeProductImg">${foto?`<img src="${escHtml(foto)}" alt="">`:(CATEGORY_ICON[p.categoria]||'📦')}<span class="officialBadge">🏪 Loja</span></div><div class="storeProductBody"><div class="storeProductTitle">${escHtml(p.titulo)}</div><div class="storeProductPrice">${formatPrice(p.preco)}</div><div class="storeProductMeta">${escHtml(p.loja_nome)} · ${escHtml(p.loja_cidade)}<br>${entrega}</div></div>`;return el;
}
function filtrarLojaPublica(lojaId,nome){const grid=document.getElementById('storeProductsGrid');if(!grid)return;const itens=produtosLojas.filter(p=>p.loja_id===lojaId);grid.innerHTML='';itens.forEach(p=>grid.appendChild(cardProdutoLoja(p)));if(!itens.length)grid.innerHTML='<div class="shopEmpty" style="grid-column:1/-1">Essa loja ainda não tem produtos disponíveis.</div>';showToast(`Vitrine: ${nome}`);grid.scrollIntoView({behavior:'smooth',block:'start'});}
function abrirComoFuncionaLojista(){
  const c=document.getElementById('lojaContent');
  c.innerHTML=`<div class="detailTitle">Como funciona para lojistas</div><div class="feeBox"><strong>1. Crie a loja e informe o endereço de retirada</strong><br>Esse endereço vira a origem da corrida no Entrega Flash.<br><br><strong>2. Cadastre o produto e o veículo necessário</strong><br>Ex.: moto para pacote pequeno, carro/van para produto maior.<br><br><strong>3. O cliente escolhe a entrega</strong><br>Entrega Flash, retirada na loja ou entrega própria, conforme as opções ativadas por você.<br><br><strong>4. Pagamento</strong><br>A comissão de ${taxaVendai.toFixed(0)}% incide somente no produto. Se houver Entrega Flash, o frete é cobrado junto e fica separado para a operação da entrega.<br><br><strong>5. Produto pronto</strong><br>Depois do pagamento e da sua aceitação, toque em “Produto pronto — chamar Entrega Flash”. Só aí a corrida é aberta para os motoristas.</div><button class="publishBtn" onclick="openLojaPainel()">Quero criar minha loja</button>`;
  document.getElementById('lojaOverlay').classList.add('show');
}

async function vendaiMP(action,body={}){
  const resp=await fetch(`${SUPABASE_URL}/functions/v1/vendai-mercadopago?action=${encodeURIComponent(action)}`,{method:'POST',headers:{apikey:SUPABASE_KEY,'Content-Type':'application/json'},body:JSON.stringify({token:currentSessionToken,return_url:location.origin+'/',...body})});
  const j=await resp.json().catch(()=>({}));if(!resp.ok)throw new Error(j.error||'falha_mercadopago');return j;
}
async function conectarMercadoPago(){try{const j=await vendaiMP('authorize');location.href=j.url;}catch(e){showToast(String(e.message).includes('nao_configurado')?'Falta configurar a aplicação Mercado Pago do Vendaí':'Não consegui iniciar a conexão Mercado Pago');}}
async function desconectarMercadoPago(){if(!confirm('Desconectar o Mercado Pago desta loja? O botão Comprar online ficará indisponível.'))return;const r=await sb.rpc('vendai_loja_mp_desconectar',{p_token:currentSessionToken});if(r.error){showToast('Não consegui desconectar');return;}showToast('Mercado Pago desconectado');await openLojaPainel();}
async function openLojaPainel(){
  if(!currentUser||!currentSessionToken){pendingAction='loja';openLoginSheet();return;}
  document.getElementById('lojaOverlay').classList.add('show');const c=document.getElementById('lojaContent');c.innerHTML='<div class="detailTitle">Área do lojista</div><div class="shopEmpty">Carregando sua loja...</div>';
  const r=await sb.rpc('vendai_minha_loja_v2',{p_token:currentSessionToken});if(r.error){c.innerHTML='<div class="detailTitle">Área do lojista</div><div class="shopEmpty">Não consegui carregar sua loja.</div>';return;}
  lojaAtual=r.data?.[0]||null;if(!lojaAtual){renderCriarLoja();return;}await renderPainelLoja();
}
function renderCriarLoja(){
  const c=document.getElementById('lojaContent');
  c.innerHTML=`<div class="merchantKicker" style="color:var(--green-dark)">🏪 Venda profissionalmente</div><div class="detailTitle">Crie sua loja no Vendaí</div><div style="font-size:12px;color:var(--ink-soft);line-height:1.45;margin:6px 0 14px">A comissão atual é de <strong>${taxaVendai.toFixed(0)}% sobre o produto</strong>. Para usar Entrega Flash, informe o endereço real onde o motorista fará a retirada.</div><label>Nome da loja</label><input id="lojaNome" type="text" placeholder="Ex: Móveis Central"><label>Cidade</label><input id="lojaCidade" type="text" placeholder="Ex: Santo André, SP"><label>WhatsApp da loja</label><input id="lojaWhats" type="text" value="${escHtml(currentUser.telefone||'')}" placeholder="DDD + número"><label>Endereço de retirada</label><input id="lojaEndereco" type="text" placeholder="Rua, número, bairro, cidade, CEP"><label>Complemento (opcional)</label><input id="lojaComplemento" type="text" placeholder="Loja 2, galpão, sala..."><label>Referência (opcional)</label><input id="lojaReferencia" type="text" placeholder="Próximo a..."><label>Sobre a loja</label><textarea id="lojaDesc" placeholder="O que sua loja vende, horário..."></textarea><div class="feeBox"><strong>Formas de entrega</strong><br><label style="display:block;margin:8px 0"><input id="lojaFlash" type="checkbox" checked> ⚡ Entrega Flash</label><label style="display:block;margin:8px 0"><input id="lojaRetirada" type="checkbox" checked> 🏪 Retirada na loja</label><label style="display:block;margin:8px 0"><input id="lojaPropria" type="checkbox"> 🚚 Entrega própria da loja</label></div><label>Logo (opcional)</label><input id="lojaLogo" type="file" accept="image/*"><button class="publishBtn" id="lojaSalvarBtn" onclick="salvarLoja()">Criar minha loja</button>`;
}
async function uploadVendai(file){if(!file)return null;const form=new FormData();form.append('token',currentSessionToken);form.append('file',file,file.name);const resp=await fetch(`${SUPABASE_URL}/functions/v1/vendai-upload`,{method:'POST',headers:{apikey:SUPABASE_KEY},body:form});const j=await resp.json();if(!resp.ok||!j.publicUrl)throw new Error('upload_falhou');return j.publicUrl;}
async function geocodificarLojaSeNecessario(endereco,flash){if(!flash)return {lat:null,lng:null};if(String(endereco||'').trim().length<5)throw new Error('endereco_obrigatorio');return await vendaiEntrega('geocode',{endereco});}
async function salvarLoja(){
  const nome=document.getElementById('lojaNome').value.trim(),cidade=document.getElementById('lojaCidade').value.trim(),whatsapp=document.getElementById('lojaWhats').value.trim(),endereco=document.getElementById('lojaEndereco').value.trim(),complemento=document.getElementById('lojaComplemento').value.trim(),referencia=document.getElementById('lojaReferencia').value.trim(),descricao=document.getElementById('lojaDesc').value.trim(),file=document.getElementById('lojaLogo').files?.[0],flash=document.getElementById('lojaFlash').checked,retirada=document.getElementById('lojaRetirada').checked,propria=document.getElementById('lojaPropria').checked;
  if(nome.length<2||cidade.length<2){showToast('Informe nome e cidade da loja');return;}if(!flash&&!retirada&&!propria){showToast('Escolha pelo menos uma forma de entrega');return;}
  const btn=document.getElementById('lojaSalvarBtn');btn.disabled=true;btn.textContent=flash?'Localizando endereço...':'Criando loja...';
  try{const geo=await geocodificarLojaSeNecessario(endereco,flash);btn.textContent='Criando loja...';const logo=file?await uploadVendai(file):null;const r=await sb.rpc('vendai_salvar_loja_v2',{p_token:currentSessionToken,p_nome:nome,p_cidade:cidade,p_whatsapp:whatsapp,p_descricao:descricao,p_logo_url:logo,p_endereco_retirada:endereco,p_endereco_complemento:complemento,p_endereco_referencia:referencia,p_endereco_lat:geo.lat??null,p_endereco_lng:geo.lng??null,p_entrega_flash_ativa:flash,p_retirada_loja_ativa:retirada,p_entrega_propria_ativa:propria});if(r.error)throw r.error;showToast('Sua loja foi criada ✓');await carregarMarketplaceLojas();await openLojaPainel();}catch(e){console.error(e);showToast(String(e.message).includes('endereco')?'Não consegui localizar o endereço de retirada':'Não consegui criar a loja agora');btn.disabled=false;btn.textContent='Criar minha loja';}
}
async function renderPainelLoja(){
  const c=document.getElementById('lojaContent');
  if(lojaAtual?.status==='excluida'){c.innerHTML=`<div class="merchantKicker" style="color:var(--danger)">🏪 Loja encerrada</div><div class="detailTitle">${escHtml(lojaAtual.nome)}</div><div class="feeBox">Sua loja foi removida da vitrine. O histórico de pedidos, pagamentos e comissões foi preservado.</div><button class="publishBtn" onclick="reativarMinhaLoja()">Reativar minha loja</button><button class="secondary" style="width:100%;margin-top:8px" onclick="renderComprasUsuario()">Ver minhas compras</button>`;return;}
  const [pr,ord,fin,mpr]=await Promise.all([sb.rpc('vendai_loja_meus_produtos_v2',{p_token:currentSessionToken}),sb.rpc('vendai_loja_pedidos_lojista_v2',{p_token:currentSessionToken}),sb.rpc('vendai_loja_financeiro',{p_token:currentSessionToken}),sb.rpc('vendai_loja_mp_status',{p_token:currentSessionToken})]);
  lojaProdutosMeus=pr.data||[];const pedidos=ord.data||[];const f=fin.data?.[0]||{};const mp=mpr.data?.[0]||{conectado:false};
  c.innerHTML=`<div class="merchantKicker" style="color:var(--green-dark)">🏪 Minha loja</div><div class="detailTitle">${escHtml(lojaAtual.nome)}</div><div style="font-size:11px;color:var(--ink-soft)">📍 ${escHtml(lojaAtual.cidade)} · ${escHtml(lojaAtual.endereco_retirada||'Endereço de retirada não informado')}</div><div class="lojaStatGrid"><div class="lojaStat"><b>${Number(lojaAtual.qtd_produtos||0)}</b><span>Produtos</span></div><div class="lojaStat"><b>${Number(lojaAtual.pedidos_abertos||0)}</b><span>Pedidos abertos</span></div><div class="lojaStat"><b>${Number(lojaAtual.vendas_concluidas||0)}</b><span>Vendas concluídas</span></div></div><div class="feeBox"><strong>Financeiro</strong><br>Vendas concluídas: <strong>${formatPrice(f.vendas_valor||0)}</strong><br>Comissão Vendaí: <strong>${taxaVendai.toFixed(0)}%</strong><br>Comissão recebida/registrada: <strong>${formatPrice(f.comissao_paga||0)}</strong><br>Seu líquido registrado: <strong>${formatPrice(f.liquido_total||0)}</strong></div><div class="feeBox"><strong>Entrega</strong><br>${lojaAtual.entrega_flash_ativa?'⚡ Entrega Flash ativa':'Entrega Flash desativada'} · ${lojaAtual.retirada_loja_ativa?'🏪 retirada ativa':'retirada desativada'} · ${lojaAtual.entrega_propria_ativa?'🚚 entrega própria ativa':'entrega própria desativada'}</div><div class="feeBox"><strong>Mercado Pago</strong><br>${mp.conectado?`<span style="color:var(--green-dark)">✓ Conectado para pagamento online e split.</span><br><button class="secondary" style="margin-top:8px" onclick="desconectarMercadoPago()">Desconectar Mercado Pago</button>`:`<span style="color:#8B6500">Conecte para receber pedidos pagos online.</span><br><button class="publishBtn" style="margin-top:8px" onclick="conectarMercadoPago()">Conectar Mercado Pago</button>`}</div><div class="lojaToolbar"><button onclick="abrirNovoProdutoLoja()">＋ Novo produto</button><button onclick="renderPedidosLoja()">📦 Pedidos (${pedidos.filter(p=>['novo','aceito'].includes(p.status)).length})</button><button onclick="renderProdutosMinhaLoja()">🛍️ Produtos</button><button onclick="renderEditarLoja()">✏️ Dados/entrega</button><button onclick="renderComprasUsuario()">🧾 Minhas compras</button><button style="background:#FBE9E9;color:var(--danger)" onclick="excluirMinhaLoja()">🗑️ Excluir loja</button></div><div id="lojaPainelLista"></div>`;
  window._pedidosLoja=pedidos;renderPedidosLoja();
}
function renderPedidosLoja(){
  const box=document.getElementById('lojaPainelLista');if(!box)return;const pedidos=window._pedidosLoja||[];box.innerHTML='<div class="detailTitle" style="font-size:14px;margin-bottom:9px">Pedidos recebidos</div>';
  if(!pedidos.length){box.innerHTML+='<div class="shopEmpty">Sua loja ainda não recebeu pedidos.</div>';return;}
  pedidos.forEach(o=>{const el=document.createElement('div');el.className='lojaRow';const st={novo:'Novo pedido',aceito:'Aceito',recusado:'Recusado',cancelado:'Cancelado',concluido:'Concluído'}[o.status]||o.status;const pago=o.pagamento_status==='pago';let actions='';if(o.status==='novo')actions=`<button class="btnOk" onclick="responderPedidoLoja('${o.id}',true)">Aceitar</button><button class="btnDanger" onclick="responderPedidoLoja('${o.id}',false)">${pago?'Recusar e estornar':'Recusar'}</button>`;if(o.status==='aceito'&&pago&&o.entrega_tipo==='entrega_flash'&&!o.entrega_flash_pedido_id)actions+=`<button class="btnOk" onclick="chamarEntregaFlashLoja('${o.id}')">⚡ Produto pronto — chamar Entrega Flash</button>`;if(o.status==='aceito'&&pago&&o.entrega_tipo!=='entrega_flash')actions+=`<button class="btnOk" onclick="concluirPedidoLoja('${o.id}')">Concluir venda</button>`;
    el.innerHTML=`<div class="lojaRowTop"><div><div class="lojaRowTitle">${escHtml(o.produto_titulo)} × ${o.quantidade}</div><div class="lojaRowMeta">Cliente: ${escHtml(o.comprador_nome)} · ${st}<br>Produto: ${formatPrice(o.subtotal)} · Frete: ${formatPrice(o.frete_valor||0)} · <strong>Total: ${formatPrice(o.total_pagamento||o.subtotal)}</strong><br>Pagamento: <strong>${escHtml(o.pagamento_status)}</strong> · Comissão: ${formatPrice(o.taxa_valor)}<br>${nomeEntrega(o.entrega_tipo)}${o.entrega_tipo==='entrega_flash'?` · ${nomeStatusEntrega(o.entrega_status)} · ${nomeVeiculo(o.frete_veiculo)}`:''}${o.entrega_motorista_nome?`<br>Entregador: ${escHtml(o.entrega_motorista_nome)}`:''}${o.endereco_entrega?`<br>Destino: ${escHtml(o.endereco_entrega)}`:''}</div></div></div>${o.observacao?`<div class="lojaRowMeta" style="margin-top:6px">Obs.: ${escHtml(o.observacao)}</div>`:''}<div class="lojaRowActions">${actions}</div>`;box.appendChild(el);});
}
async function responderPedidoLoja(id,aceitar){
  const o=(window._pedidosLoja||[]).find(x=>x.id===id);if(!o)return;
  if(!aceitar&&o.pagamento_status==='pago'){
    if(!confirm('O cliente já pagou. Recusar este pedido e solicitar o estorno total pelo Mercado Pago?'))return;
    try{await vendaiMP('refund_reject',{pedido_id:id});showToast('Pedido recusado e estorno solicitado ✓');await openLojaPainel();}catch(e){showToast('Não consegui concluir o estorno. Não entregue o produto; verifique o pagamento no painel.');}return;
  }
  const r=await sb.rpc('vendai_responder_pedido_v2',{p_token:currentSessionToken,p_pedido_id:id,p_aceitar:aceitar});if(r.error){showToast('Não consegui atualizar o pedido');return;}showToast(aceitar?'Pedido aceito ✓':'Pedido recusado');await openLojaPainel();
}
async function chamarEntregaFlashLoja(id){if(!confirm('O produto está realmente pronto para retirada? Ao confirmar, o Entrega Flash começa a procurar motorista.'))return;try{const r=await vendaiEntrega('dispatch',{pedido_id:id});showToast(r.entrega?.ja_criado?'Entrega já estava aberta':'Entrega Flash acionado ✓');await openLojaPainel();}catch(e){const m=String(e.message||'');showToast(m.includes('pedido_nao_liberado')?'Aceite o pedido e aguarde o pagamento aprovado antes de chamar a entrega':'Não consegui chamar o Entrega Flash');}}
async function concluirPedidoLoja(id){if(!confirm('Confirmar que este pedido foi entregue/retirado e a venda está concluída?'))return;const r=await sb.rpc('vendai_loja_concluir_pedido_v2',{p_token:currentSessionToken,p_pedido_id:id});if(r.error){showToast(String(r.error.message||'').includes('entrega_ainda')?'A Entrega Flash ainda não marcou como entregue':'Não consegui concluir a venda');return;}showToast('Venda concluída ✓');await openLojaPainel();}
function renderProdutosMinhaLoja(){const box=document.getElementById('lojaPainelLista');if(!box)return;box.innerHTML='<div class="detailTitle" style="font-size:14px;margin-bottom:9px">Meus produtos</div>';if(!lojaProdutosMeus.length){box.innerHTML+='<div class="shopEmpty">Cadastre seu primeiro produto.</div>';return;}lojaProdutosMeus.forEach(p=>{const el=document.createElement('div');el.className='lojaRow';el.innerHTML=`<div class="lojaRowTitle">${escHtml(p.titulo)}</div><div class="lojaRowMeta">${formatPrice(p.preco)} · estoque ${p.estoque} · ${p.status}<br>Entrega Flash: ${nomeVeiculo(p.veiculo_entrega)}</div><div class="lojaRowActions"><button class="btnOk" onclick="editarProdutoLoja('${p.id}')">Editar</button>${p.status==='ativo'?`<button class="btnWarn" onclick="statusProdutoLoja('${p.id}','pausado')">Pausar</button>`:`<button class="btnOk" onclick="statusProdutoLoja('${p.id}','ativo')">Ativar</button>`}<button class="btnDanger" onclick="statusProdutoLoja('${p.id}','removido')">Remover</button></div>`;box.appendChild(el);});}
function abrirNovoProdutoLoja(){document.getElementById('lpFormTitle').textContent='Cadastrar produto';document.getElementById('lpId').value='';document.getElementById('lpTitulo').value='';document.getElementById('lpPreco').value='';document.getElementById('lpEstoque').value='1';document.getElementById('lpDescricao').value='';document.getElementById('lpCategoria').value='outros';document.getElementById('lpVeiculo').value='moto';document.getElementById('lpFoto').value='';document.getElementById('lpFotoPreview').innerHTML='';lojaProdutoFotos=[];document.getElementById('lojaProdutoOverlay').classList.add('show');}
function editarProdutoLoja(id){const p=lojaProdutosMeus.find(x=>x.id===id);if(!p)return;document.getElementById('lpFormTitle').textContent='Editar produto';document.getElementById('lpId').value=p.id;document.getElementById('lpTitulo').value=p.titulo;document.getElementById('lpPreco').value=p.preco;document.getElementById('lpEstoque').value=p.estoque;document.getElementById('lpDescricao').value=p.descricao||'';document.getElementById('lpCategoria').value=p.categoria||'outros';document.getElementById('lpVeiculo').value=p.veiculo_entrega||'moto';document.getElementById('lpFoto').value='';document.getElementById('lpFotoPreview').innerHTML=(p.fotos||[]).map(f=>`<img src="${escHtml(f)}" style="width:54px;height:54px;object-fit:cover;border-radius:9px">`).join('');lojaProdutoFotos=[];document.getElementById('lojaProdutoOverlay').classList.add('show');}
function previewFotosLojaProduto(){const files=Array.from(document.getElementById('lpFoto').files||[]).slice(0,4);lojaProdutoFotos=files;document.getElementById('lpFotoPreview').innerHTML='';files.forEach(f=>{const i=document.createElement('img');i.src=URL.createObjectURL(f);i.style='width:54px;height:54px;object-fit:cover;border-radius:9px';document.getElementById('lpFotoPreview').appendChild(i);});}
async function salvarProdutoLoja(){const id=document.getElementById('lpId').value||null,titulo=document.getElementById('lpTitulo').value.trim(),preco=Number(document.getElementById('lpPreco').value),estoque=Number(document.getElementById('lpEstoque').value),categoria=document.getElementById('lpCategoria').value,veiculo=document.getElementById('lpVeiculo').value,descricao=document.getElementById('lpDescricao').value.trim();if(titulo.length<3||preco<=0||estoque<0){showToast('Revise nome, preço e estoque');return;}const b=document.getElementById('lpSalvarBtn');b.disabled=true;b.textContent='Salvando...';try{const fotos=[];for(const f of lojaProdutoFotos)fotos.push(await uploadVendai(f));const r=await sb.rpc('vendai_loja_salvar_produto_v2',{p_token:currentSessionToken,p_id:id,p_titulo:titulo,p_descricao:descricao,p_categoria:categoria,p_preco:preco,p_estoque:estoque,p_fotos:fotos,p_veiculo_entrega:veiculo});if(r.error)throw r.error;closeSheet('lojaProdutoOverlay');showToast('Produto salvo ✓');await carregarMarketplaceLojas();await openLojaPainel();renderProdutosMinhaLoja();}catch(e){console.error(e);showToast('Não consegui salvar o produto');}finally{b.disabled=false;b.textContent='Salvar produto';}}
async function statusProdutoLoja(id,status){const r=await sb.rpc('vendai_loja_status_produto',{p_token:currentSessionToken,p_id:id,p_status:status});if(r.error){showToast('Não consegui alterar o produto');return;}await carregarMarketplaceLojas();await openLojaPainel();renderProdutosMinhaLoja();}
function renderEditarLoja(){const box=document.getElementById('lojaPainelLista');if(!box||!lojaAtual)return;box.innerHTML=`<div class="detailTitle" style="font-size:14px">Dados e entrega da loja</div><label>Nome da loja</label><input id="lojaENome" value="${escHtml(lojaAtual.nome)}"><label>Cidade</label><input id="lojaECidade" value="${escHtml(lojaAtual.cidade)}"><label>WhatsApp</label><input id="lojaEWhats" value="${escHtml(lojaAtual.whatsapp||'')}"><label>Endereço de retirada</label><input id="lojaEEndereco" value="${escHtml(lojaAtual.endereco_retirada||'')}" placeholder="Rua, número, bairro, cidade, CEP"><label>Complemento</label><input id="lojaEComplemento" value="${escHtml(lojaAtual.endereco_complemento||'')}"><label>Referência</label><input id="lojaEReferencia" value="${escHtml(lojaAtual.endereco_referencia||'')}"><label>Sobre a loja</label><textarea id="lojaEDesc">${escHtml(lojaAtual.descricao||'')}</textarea><div class="feeBox"><strong>Formas de entrega</strong><br><label style="display:block;margin:8px 0"><input id="lojaEFlash" type="checkbox" ${lojaAtual.entrega_flash_ativa?'checked':''}> ⚡ Entrega Flash</label><label style="display:block;margin:8px 0"><input id="lojaERetirada" type="checkbox" ${lojaAtual.retirada_loja_ativa?'checked':''}> 🏪 Retirada na loja</label><label style="display:block;margin:8px 0"><input id="lojaEPropria" type="checkbox" ${lojaAtual.entrega_propria_ativa?'checked':''}> 🚚 Entrega própria</label></div><label>Nova logo (opcional)</label><input id="lojaELogo" type="file" accept="image/*"><button class="publishBtn" onclick="salvarEdicaoLoja()">Salvar dados</button>`;}
async function salvarEdicaoLoja(){try{const flash=document.getElementById('lojaEFlash').checked,retirada=document.getElementById('lojaERetirada').checked,propria=document.getElementById('lojaEPropria').checked;if(!flash&&!retirada&&!propria){showToast('Escolha ao menos uma forma de entrega');return;}const endereco=document.getElementById('lojaEEndereco').value.trim();const mudouEndereco=endereco!==String(lojaAtual.endereco_retirada||'').trim();let geo={lat:lojaAtual.endereco_lat??null,lng:lojaAtual.endereco_lng??null};if(flash&&(mudouEndereco||geo.lat==null||geo.lng==null))geo=await geocodificarLojaSeNecessario(endereco,true);if(!flash)geo={lat:null,lng:null};const f=document.getElementById('lojaELogo').files?.[0],logo=f?await uploadVendai(f):null;const r=await sb.rpc('vendai_salvar_loja_v2',{p_token:currentSessionToken,p_nome:document.getElementById('lojaENome').value,p_cidade:document.getElementById('lojaECidade').value,p_whatsapp:document.getElementById('lojaEWhats').value,p_descricao:document.getElementById('lojaEDesc').value,p_logo_url:logo,p_endereco_retirada:endereco,p_endereco_complemento:document.getElementById('lojaEComplemento').value,p_endereco_referencia:document.getElementById('lojaEReferencia').value,p_endereco_lat:geo.lat,p_endereco_lng:geo.lng,p_entrega_flash_ativa:flash,p_retirada_loja_ativa:retirada,p_entrega_propria_ativa:propria});if(r.error)throw r.error;showToast('Loja atualizada ✓');await carregarMarketplaceLojas();await openLojaPainel();}catch(e){console.error(e);showToast(String(e.message).includes('endereco')?'Não consegui localizar o endereço':'Não consegui salvar os dados');}}
async function excluirMinhaLoja(){if(!lojaAtual)return;if(!confirm('Excluir sua loja do Vendaí? Ela sairá da vitrine e os produtos serão pausados. O histórico de vendas e comissões será preservado.'))return;const r=await sb.rpc('vendai_excluir_minha_loja',{p_token:currentSessionToken});if(r.error){const m=String(r.error.message||'');showToast(m.includes('loja_tem_pedidos_abertos')?'Finalize ou recuse os pedidos abertos antes de excluir a loja.':'Não consegui excluir a loja.');return;}showToast('Loja excluída da vitrine');await carregarMarketplaceLojas();await openLojaPainel();}
async function reativarMinhaLoja(){const r=await sb.rpc('vendai_reativar_minha_loja',{p_token:currentSessionToken});if(r.error){showToast('Não consegui reativar a loja.');return;}showToast('Loja reativada ✓');await carregarMarketplaceLojas();await openLojaPainel();}
function atualizarCamposEntregaCompra(){const tipo=document.getElementById('compraEntregaTipo')?.value;const b=document.getElementById('compraFlashCampos');if(b)b.style.display=tipo==='entrega_flash'?'block':'none';ultimaCotacaoFlash=null;const q=document.getElementById('compraCotacao');if(q)q.innerHTML=tipo==='entrega_flash'?'Informe o endereço e calcule o frete.':tipo==='retirada_loja'?'Sem frete. Retirada combinada com a loja.':'O valor/condição da entrega própria será combinado com a loja.';}
function abrirProdutoLoja(id){
  const p=produtosLojas.find(x=>x.id===id);if(!p)return;produtoLojaAtual=p;ultimaCotacaoFlash=null;const c=document.getElementById('lojaProdutoDetailContent');const foto=p.fotos?.[0];const opts=[];if(p.entrega_flash_ativa)opts.push('<option value="entrega_flash">⚡ Entrega Flash</option>');if(p.retirada_loja_ativa)opts.push('<option value="retirada_loja">🏪 Retirar na loja</option>');if(p.entrega_propria_ativa)opts.push('<option value="entrega_propria">🚚 Entrega própria da loja</option>');
  c.innerHTML=`${foto?`<img src="${escHtml(foto)}" style="width:100%;max-height:280px;object-fit:cover;border-radius:15px;margin-bottom:12px">`:''}<div class="merchantKicker" style="color:var(--green-dark)">🏪 ${escHtml(p.loja_nome)}</div><div class="detailTitle">${escHtml(p.titulo)}</div><div class="detailPrice">${formatPrice(p.preco)}</div><div class="detailMeta">${escHtml(p.loja_cidade)} · estoque ${p.estoque}</div><div class="detailDesc">${escHtml(p.descricao||'Sem descrição.')}</div><div class="feeBox">A comissão de ${taxaVendai.toFixed(0)}% é cobrada do lojista. Se escolher Entrega Flash, o frete aparece antes de pagar e é cobrado junto com o produto.</div><label>Quantidade</label><input id="compraQtdLoja" type="number" min="1" max="${p.estoque}" value="1" onchange="ultimaCotacaoFlash=null"><label>Como quer receber?</label><select id="compraEntregaTipo" onchange="atualizarCamposEntregaCompra()">${opts.join('')}</select><div id="compraFlashCampos" style="display:none"><label>Endereço de entrega</label><input id="compraEndereco" type="text" placeholder="Rua, número, bairro, cidade, CEP"><label>Complemento (opcional)</label><input id="compraComplemento" type="text" placeholder="Apto, bloco..."><label>Referência (opcional)</label><input id="compraReferencia" type="text" placeholder="Portaria, comércio próximo..."><button class="secondary" style="width:100%;margin-top:8px" onclick="calcularFreteCompra()">⚡ Calcular Entrega Flash</button></div><div id="compraCotacao" class="feeBox" style="margin-top:10px"></div><label>Observação para a loja (opcional)</label><textarea id="compraObsLoja" placeholder="Cor, tamanho, horário..."></textarea><button class="publishBtn" id="compraFinalBtn" onclick="criarPedidoProdutoLoja()">🛒 Ir para pagamento</button>`;document.getElementById('lojaProdutoDetailOverlay').classList.add('show');atualizarCamposEntregaCompra();
}
async function calcularFreteCompra(){const p=produtoLojaAtual;if(!p)return;const qtd=Number(document.getElementById('compraQtdLoja').value)||1,end=document.getElementById('compraEndereco').value.trim(),box=document.getElementById('compraCotacao');if(end.length<5){showToast('Informe o endereço completo');return;}box.textContent='Calculando frete e verificando motorista na região...';try{const q=await vendaiEntrega('quote',{produto_id:p.id,quantidade:qtd,endereco_entrega:end});ultimaCotacaoFlash=q;box.innerHTML=`<strong>Entrega Flash: ${formatPrice(q.frete_valor)}</strong><br>${q.distancia_km} km · ${nomeVeiculo(q.veiculo)} · ${q.motoristas_disponiveis} entregador(es) disponível(is) na região<br><strong>Total estimado: ${formatPrice(Number(p.preco)*qtd+Number(q.frete_valor))}</strong>`;}catch(e){ultimaCotacaoFlash=null;const m=String(e.message||'');box.textContent=m.includes('sem_motorista')?'Entrega Flash indisponível nessa região neste momento. Escolha retirada/entrega própria ou tente depois.':m.includes('endereco')?'Não consegui localizar esse endereço. Confira rua, número, cidade e CEP.':'Não consegui calcular o frete agora.';}}
async function criarPedidoProdutoLoja(){
  if(!currentUser||!currentSessionToken){pendingAction='buy_loja';closeSheet('lojaProdutoDetailOverlay');openLoginSheet();return;}const p=produtoLojaAtual;if(!p)return;const qtd=Number(document.getElementById('compraQtdLoja').value)||1,obs=document.getElementById('compraObsLoja').value.trim(),tipo=document.getElementById('compraEntregaTipo').value,end=tipo==='entrega_flash'?document.getElementById('compraEndereco').value.trim():'',comp=tipo==='entrega_flash'?document.getElementById('compraComplemento').value.trim():'',ref=tipo==='entrega_flash'?document.getElementById('compraReferencia').value.trim():'';
  if(tipo==='entrega_flash'&&end.length<5){showToast('Informe o endereço de entrega');return;}const btn=document.getElementById('compraFinalBtn');btn.disabled=true;btn.textContent='Confirmando valores...';
  try{const r=await vendaiEntrega('create_order',{produto_id:p.id,quantidade:qtd,observacao:obs,entrega_tipo:tipo,endereco_entrega:end,complemento_entrega:comp,referencia_entrega:ref});const d=r.pedido||{};btn.textContent='Abrindo Mercado Pago...';const ck=await vendaiMP('checkout',{pedido_id:d.id});location.href=ck.checkout_url;}catch(e){const m=String(e.message||'');showToast(m.includes('sem_motorista')?'Não há Entrega Flash disponível nessa região agora':m.includes('mercadopago')?'A loja ainda não conectou o Mercado Pago':m.includes('endereco')?'Não consegui localizar o endereço':'Não consegui criar o pedido');btn.disabled=false;btn.textContent='🛒 Ir para pagamento';}
}
async function renderComprasUsuario(){
  const box=document.getElementById('lojaPainelLista');if(!box)return;box.innerHTML='<div class="detailTitle" style="font-size:14px">Minhas compras em lojas</div><div class="shopEmpty">Carregando...</div>';const r=await sb.rpc('vendai_loja_pedidos_comprador_v2',{p_token:currentSessionToken});if(r.error){box.innerHTML='<div class="shopEmpty">Não consegui carregar suas compras.</div>';return;}const ds=r.data||[];box.innerHTML='<div class="detailTitle" style="font-size:14px;margin-bottom:9px">Minhas compras em lojas</div>';if(!ds.length){box.innerHTML+='<div class="shopEmpty">Você ainda não fez pedidos em lojas.</div>';return;}ds.forEach(o=>{const e=document.createElement('div');e.className='lojaRow';const continua=o.pagamento_status==='aguardando_pagamento'&&o.mp_checkout_url?`<button class="btnOk" onclick="location.href='${escHtml(o.mp_checkout_url)}'">Continuar pagamento</button>`:'';e.innerHTML=`<div class="lojaRowTitle">${escHtml(o.produto_titulo)} × ${o.quantidade}</div><div class="lojaRowMeta">${escHtml(o.loja_nome)} · Produto ${formatPrice(o.subtotal)} · Frete ${formatPrice(o.frete_valor||0)} · <strong>Total ${formatPrice(o.total_pagamento||o.subtotal)}</strong><br>Pagamento: ${escHtml(o.pagamento_status)} · Pedido: ${escHtml(o.status)}<br>${nomeEntrega(o.entrega_tipo)}${o.entrega_tipo==='entrega_flash'?` · <strong>${nomeStatusEntrega(o.entrega_status)}</strong>`:''}${o.entrega_motorista_nome?`<br>Entregador: ${escHtml(o.entrega_motorista_nome)}`:''}</div><div class="lojaRowActions">${continua}</div>`;box.appendChild(e);});
}

restaurarSessao();
renderChips();
carregarAnuncios();
carregarMarketplaceLojas();
try{const qp=new URLSearchParams(location.search);if(qp.get('mp')==='conectado')setTimeout(()=>showToast('Mercado Pago conectado ✓'),500);if(qp.get('pagamento')==='sucesso')setTimeout(()=>showToast('Pagamento enviado. Assim que o Mercado Pago confirmar, a loja verá como pago.'),500);if(qp.get('pagamento')==='pendente')setTimeout(()=>showToast('Pagamento pendente no Mercado Pago.'),500);}catch(e){}

// Atalhos do ícone instalado.
try{
  const acao = new URLSearchParams(location.search).get('action');
  if(acao==='anunciar') setTimeout(()=>openPostSheet(), 350);
  if(acao==='conversas') setTimeout(()=>abrirConversas(), 350);
}catch(e){}



// PWA: registra o service worker. Usa rede primeiro para evitar versão antiga presa em cache.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
      reg.update().catch(()=>{});
    } catch (err) {
      console.warn('Service worker não registrado:', err);
    }
  });
}
