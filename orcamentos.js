/* Vendaí Orçamentos 15/09/2026 */
(function(){
'use strict';
var itens=[];

function n(v){return Number(String(v==null?0:v).replace(',','.'))||0}
function wtel(v){var d=String(v||'').replace(/\D/g,'');if(d&&!d.startsWith('55')&&(d.length===10||d.length===11))d='55'+d;return d}
function st(s){return ({rascunho:'Rascunho',enviado:'Enviado',visualizado:'Visualizado',aceito:'Aceito',recusado:'Recusado',pago:'Pago',cancelado:'Cancelado'})[s]||s||'Rascunho'}
function box(){return document.getElementById('lojaPainelLista')}
function mais7(){var d=new Date(Date.now()+7*86400000);return d.toISOString().slice(0,10)}

function botao(){
 var t=document.querySelector('#lojaContent .lojaToolbar');
 if(!t||t.querySelector('[data-orc]'))return;
 var b=document.createElement('button');b.type='button';b.setAttribute('data-orc','1');b.innerHTML='🧾 Orçamentos';b.onclick=function(){renderOrcamentosLoja()};
 t.insertBefore(b,t.children[2]||null);
}
var original=window.renderPainelLoja;
if(typeof original==='function')window.renderPainelLoja=async function(){var r=await original.apply(this,arguments);botao();return r};
setTimeout(botao,900);

window.renderOrcamentosLoja=async function(){
 var e=box();if(!e)return;e.innerHTML='<div class="orcLoading">Carregando orçamentos...</div>';
 var r=await sb.rpc('vendai_orcamentos_loja',{p_token:currentSessionToken});
 if(r.error){console.error(r.error);e.innerHTML='<div class="orcEmpty">Não consegui carregar os orçamentos.</div>';return}
 var a=r.data||[],html='';
 for(var i=0;i<a.length;i++){
  var o=a[i];
  html+='<div class="orcCard"><div class="orcTop"><div><b>'+escHtml(o.cliente_nome)+'</b><small>'+new Date(o.criado_em).toLocaleDateString('pt-BR')+'</small></div><span class="orcStatus '+escHtml(o.status)+'">'+escHtml(st(o.status))+'</span></div><strong class="orcTotal">'+formatPrice(o.total)+'</strong><div class="orcActions"><button onclick="abrirOrcamentoLoja(\''+o.id+'\')">Ver</button><button onclick="compartilharOrcamentoLoja(\''+o.id+'\')">📲 WhatsApp</button></div></div>';
 }
 if(!html)html='<div class="orcEmpty"><b>Nenhum orçamento ainda.</b><br>Monte um pedido com vários móveis e envie para o cliente.</div>';
 e.innerHTML='<div class="orcHead"><div><div class="merchantKicker" style="color:var(--green-dark)">🧾 Venda pelo WhatsApp</div><div class="detailTitle" style="font-size:17px">Orçamentos</div><div class="tinyHint">Monte combos de móveis, frete e desconto. O cliente recebe um link e pode aceitar.</div></div><button class="orcNew" onclick="abrirNovoOrcamento()">＋ Novo orçamento</button></div>'+html;
};

window.abrirNovoOrcamento=function(){
 itens=[];
 var e=box();if(!e)return;
 var opts='<option value="">Item manual / outro produto</option>',ps=lojaProdutosMeus||[];
 for(var i=0;i<ps.length;i++)if(ps[i].status==='ativo')opts+='<option value="'+ps[i].id+'">'+escHtml(ps[i].titulo)+' — '+formatPrice(ps[i].preco)+'</option>';
 e.innerHTML='<button class="orcBack" onclick="renderOrcamentosLoja()">← Voltar</button><div class="detailTitle" style="font-size:17px;margin-top:10px">Novo orçamento</div>'+
 '<div class="orcSection"><label>Cliente</label><input id="onome" placeholder="Nome do cliente"><label>WhatsApp</label><input id="owhats" inputmode="tel" placeholder="DDD + número"><label>Validade</label><input id="oval" type="date" value="'+mais7()+'"><label>Entrega / prazo</label><input id="oent" placeholder="Ex.: entrega amanhã à tarde"></div>'+
 '<div class="orcSection"><label>Produto da sua loja</label><select id="oprod" onchange="orcProdutoMudou()">'+opts+'</select><label>Descrição</label><input id="odesc" placeholder="Ex.: Sofá Barcelona marrom"><div class="orcGrid"><div><label>Qtd.</label><input id="oqtd" type="number" min="1" value="1"></div><div><label>Valor unitário</label><input id="ovalor" type="number" min="0" step="0.01"></div></div><button class="orcAdd" onclick="orcAdicionarItem()">＋ Adicionar item</button></div>'+
 '<div class="orcSection"><b>Itens</b><div id="oitens"></div></div>'+
 '<div class="orcSection"><div class="orcGrid"><div><label>Frete</label><input id="ofrete" type="number" min="0" step="0.01" value="0" oninput="orcResumo()"></div><div><label>Desconto</label><input id="odesconto" type="number" min="0" step="0.01" value="0" oninput="orcResumo()"></div></div><label>Observações</label><textarea id="oobs" placeholder="Ex.: montagem inclusa, pagamento no ato da entrega..."></textarea><div id="oresumo" class="orcResumo"></div><button id="osalvar" class="publishBtn" onclick="salvarOrcamento()">Criar orçamento</button></div>';
 desenhaItens();
};

window.orcProdutoMudou=function(){
 var id=document.getElementById('oprod').value,p=(lojaProdutosMeus||[]).find(function(x){return String(x.id)===String(id)});
 document.getElementById('odesc').value=p?p.titulo:'';
 document.getElementById('ovalor').value=p?Number(p.preco||0).toFixed(2):'';
};
window.orcAdicionarItem=function(){
 var id=document.getElementById('oprod').value||null,d=document.getElementById('odesc').value.trim(),q=Math.max(1,parseInt(document.getElementById('oqtd').value||'1',10)||1),v=n(document.getElementById('ovalor').value);
 if(d.length<2){showToast('Informe o móvel ou produto');return}
 itens.push({produto_id:id,descricao:d,quantidade:q,valor_unitario:v});
 document.getElementById('oprod').value='';document.getElementById('odesc').value='';document.getElementById('oqtd').value='1';document.getElementById('ovalor').value='';desenhaItens();
};
window.orcRemover=function(i){itens.splice(i,1);desenhaItens()};
function desenhaItens(){
 var e=document.getElementById('oitens');if(!e)return;var h='';
 for(var i=0;i<itens.length;i++){var x=itens[i];h+='<div class="orcItem"><span><b>'+escHtml(x.descricao)+'</b><small>'+x.quantidade+' × '+formatPrice(x.valor_unitario)+'</small></span><strong>'+formatPrice(x.quantidade*x.valor_unitario)+'</strong><button onclick="orcRemover('+i+')">×</button></div>'}
 e.innerHTML=h||'<div class="orcEmpty">Adicione pelo menos um produto.</div>';orcResumo();
}
window.orcResumo=function(){
 var e=document.getElementById('oresumo');if(!e)return;var sub=0;for(var i=0;i<itens.length;i++)sub+=itens[i].quantidade*itens[i].valor_unitario;
 var f=n(document.getElementById('ofrete').value),d=n(document.getElementById('odesconto').value),t=Math.max(0,sub+f-d);
 e.innerHTML='<div><span>Produtos</span><b>'+formatPrice(sub)+'</b></div><div><span>Frete</span><b>'+formatPrice(f)+'</b></div>'+(d?'<div><span>Desconto</span><b>- '+formatPrice(d)+'</b></div>':'')+'<div class="grand"><span>Total</span><strong>'+formatPrice(t)+'</strong></div>';
};
window.salvarOrcamento=async function(){
 var nome=document.getElementById('onome').value.trim();if(nome.length<2){showToast('Informe o nome do cliente');return}if(!itens.length){showToast('Adicione pelo menos um produto');return}
 var b=document.getElementById('osalvar');b.disabled=true;b.textContent='Criando...';
 var r=await sb.rpc('vendai_orcamento_criar',{p_token:currentSessionToken,p_cliente_nome:nome,p_cliente_whatsapp:document.getElementById('owhats').value,p_validade:document.getElementById('oval').value,p_observacoes:document.getElementById('oobs').value,p_entrega_descricao:document.getElementById('oent').value,p_frete:n(document.getElementById('ofrete').value),p_desconto:n(document.getElementById('odesconto').value),p_itens:itens});
 if(r.error){console.error(r.error);showToast('Não consegui criar o orçamento');b.disabled=false;b.textContent='Criar orçamento';return}
 showToast('Orçamento criado ✓');var o=r.data&&r.data[0];if(o)abrirOrcamentoLoja(o.id);else renderOrcamentosLoja();
};

window.abrirOrcamentoLoja=async function(id){
 var e=box();e.innerHTML='<div class="orcLoading">Abrindo...</div>';var r=await sb.rpc('vendai_orcamento_detalhe',{p_token:currentSessionToken,p_id:id});
 if(r.error||!r.data){e.innerHTML='<div class="orcEmpty">Não consegui abrir.</div>';return}var o=r.data,a=o.itens||[],h='';
 for(var i=0;i<a.length;i++)h+='<div class="orcLinha"><span><b>'+escHtml(a[i].descricao)+'</b><small>'+a[i].quantidade+' × '+formatPrice(a[i].valor_unitario)+'</small></span><strong>'+formatPrice(a[i].total)+'</strong></div>';
 e.innerHTML='<button class="orcBack" onclick="renderOrcamentosLoja()">← Orçamentos</button><div class="orcPaper"><small>ORÇAMENTO PARA</small><h3>'+escHtml(o.cliente_nome)+'</h3>'+h+'<div class="orcResumo"><div><span>Produtos</span><b>'+formatPrice(o.subtotal)+'</b></div>'+(Number(o.frete)>0?'<div><span>Frete</span><b>'+formatPrice(o.frete)+'</b></div>':'')+(Number(o.desconto)>0?'<div><span>Desconto</span><b>- '+formatPrice(o.desconto)+'</b></div>':'')+'<div class="grand"><span>Total</span><strong>'+formatPrice(o.total)+'</strong></div></div>'+(o.entrega_descricao?'<p><b>Entrega:</b> '+escHtml(o.entrega_descricao)+'</p>':'')+(o.observacoes?'<p><b>Observações:</b> '+escHtml(o.observacoes)+'</p>':'')+'<div class="orcStatus '+escHtml(o.status)+'">'+escHtml(st(o.status))+'</div></div><div class="orcActions big"><button onclick="compartilharOrcamentoLoja(\''+o.id+'\')">📲 Enviar no WhatsApp</button>'+(o.status!=='pago'?'<button onclick="marcarOrcamentoPago(\''+o.id+'\')">✓ Marcar pago</button>':'')+'</div>';
};
window.compartilharOrcamentoLoja=async function(id){
 var p=null;try{p=window.open('about:blank','_blank')}catch(e){}
 var r=await sb.rpc('vendai_orcamento_detalhe',{p_token:currentSessionToken,p_id:id});if(r.error||!r.data){if(p)p.close();showToast('Não consegui abrir');return}
 var o=r.data;sb.rpc('vendai_orcamento_marcar_enviado',{p_token:currentSessionToken,p_id:id});
 var link=VENDAI_URL_OFICIAL+'/?orcamento='+encodeURIComponent(o.public_token),txt='Olá, '+o.cliente_nome+'! Preparei seu orçamento na '+(lojaAtual?lojaAtual.nome:'nossa loja')+'.\n\nTotal: '+formatPrice(o.total)+'\n\nVeja os itens e aceite pelo link:\n'+link,tel=wtel(o.cliente_whatsapp);
 if(tel){var u='https://wa.me/'+tel+'?text='+encodeURIComponent(txt);if(p)p.location.href=u;else location.href=u}else{if(p)p.close();try{await navigator.clipboard.writeText(link);showToast('Link copiado ✓')}catch(e){}}
};
window.marcarOrcamentoPago=async function(id){var ok=await vendaiConfirmacao('Marcar este orçamento como pago?',{titulo:'Pagamento recebido',confirmar:'Marcar como pago'});if(!ok)return;var r=await sb.rpc('vendai_orcamento_atualizar_status',{p_token:currentSessionToken,p_id:id,p_status:'pago'});if(r.error){showToast('Não consegui atualizar');return}showToast('Marcado como pago ✓');abrirOrcamentoLoja(id)};

function publico(o){
 var c=document.getElementById('lojaContent'),a=o.itens||[],l=o.loja||{},h='';for(var i=0;i<a.length;i++)h+='<div class="orcLinha"><span><b>'+escHtml(a[i].descricao)+'</b><small>'+a[i].quantidade+' × '+formatPrice(a[i].valor_unitario)+'</small></span><strong>'+formatPrice(a[i].total)+'</strong></div>';
 var decidiu=['aceito','recusado','pago','cancelado'].indexOf(o.status)>=0,exp=o.validade&&new Date(o.validade+'T23:59:59')<new Date();
 c.innerHTML='<div class="orcPublic"><div class="merchantKicker" style="color:var(--green-dark)">ORÇAMENTO VENDAÍ</div><h2>'+escHtml(l.nome||'Loja')+'</h2><p>Olá, <b>'+escHtml(o.cliente_nome)+'</b>. Confira:</p><div class="orcPaper">'+h+'<div class="orcResumo"><div><span>Produtos</span><b>'+formatPrice(o.subtotal)+'</b></div>'+(Number(o.frete)>0?'<div><span>Frete</span><b>'+formatPrice(o.frete)+'</b></div>':'')+(Number(o.desconto)>0?'<div><span>Desconto</span><b>- '+formatPrice(o.desconto)+'</b></div>':'')+'<div class="grand"><span>Total</span><strong>'+formatPrice(o.total)+'</strong></div></div>'+(o.entrega_descricao?'<p><b>Entrega:</b> '+escHtml(o.entrega_descricao)+'</p>':'')+(o.observacoes?'<p><b>Observações:</b> '+escHtml(o.observacoes)+'</p>':'')+'<small>Válido até '+(o.validade?new Date(o.validade+'T12:00:00').toLocaleDateString('pt-BR'):'—')+'</small></div>'+(o.status==='aceito'||o.status==='pago'?'<div class="orcOk">✓ Orçamento aceito</div>':'')+(o.status==='recusado'?'<div class="orcNo">Orçamento recusado</div>':'')+(!exp&&!decidiu?'<button class="publishBtn" onclick="aceitarOrcamentoPublico(\''+o.public_token+'\')">✓ Aceitar orçamento</button><button class="orcRecusa" onclick="recusarOrcamentoPublico(\''+o.public_token+'\')">Não vou aceitar</button>':'')+(l.whatsapp?'<button class="orcWhats" onclick="falarOrcamentoWhatsapp(\''+escHtml(l.whatsapp)+'\')">💬 Falar com a loja</button>':'')+'</div>';
}
window.abrirOrcamentoPublico=async function(t){document.getElementById('lojaOverlay').classList.add('show');var c=document.getElementById('lojaContent');c.innerHTML='<div class="orcLoading">Abrindo seu orçamento...</div>';var r=await sb.rpc('vendai_orcamento_publico',{p_public_token:t});if(r.error||!r.data){c.innerHTML='<div class="orcEmpty">Orçamento indisponível.</div>';return}publico(r.data)};
window.aceitarOrcamentoPublico=async function(t){var r=await sb.rpc('vendai_orcamento_aceitar',{p_public_token:t});if(r.error){showToast('Não consegui aceitar agora');return}showToast('Orçamento aceito ✓');abrirOrcamentoPublico(t)};
window.recusarOrcamentoPublico=async function(t){var ok=await vendaiConfirmacao('Deseja recusar este orçamento?',{titulo:'Recusar orçamento',confirmar:'Recusar',estilo:'danger'});if(!ok)return;var r=await sb.rpc('vendai_orcamento_recusar',{p_public_token:t});if(!r.error)abrirOrcamentoPublico(t)};
window.falarOrcamentoWhatsapp=function(v){var d=wtel(v);if(d)window.open('https://wa.me/'+d+'?text='+encodeURIComponent('Olá! Estou falando sobre o orçamento que recebi pelo Vendaí.'),'_blank')};

setTimeout(function(){try{var t=new URLSearchParams(location.search).get('orcamento');if(t&&!window.__orc){window.__orc=1;abrirOrcamentoPublico(t)}}catch(e){}},700);
})();