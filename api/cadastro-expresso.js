// api/cadastro-expresso.js
// Função de servidor (Vercel) — grava loja/produto de cortesia com permissão total,
// contornando o RLS que bloqueia gravação direta do navegador.
// Não depende de nenhuma biblioteca externa (usa fetch direto no Supabase).
//
// IMPORTANTE: configure a variável de ambiente SUPABASE_SERVICE_ROLE_KEY
// no painel da Vercel (Project Settings → Environments → Production).

const SUPABASE_URL = 'https://rgcclordmqjmwuzrrfbd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function sb(path, options = {}) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...(options.headers || {})
    }
  });
  const text = await resp.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { /* resposta vazia */ }
  if (!resp.ok) {
    throw new Error((data && (data.message || JSON.stringify(data))) || `Erro Supabase (${resp.status})`);
  }
  return data;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }
  if (!SERVICE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY não configurada no servidor' });
  }

  try {
    const {
      telefone, nomeLojista, nomeLoja, cidade, cnpj, descricaoLoja, logoUrl,
      planoTeste, diasTeste, produtoTitulo, produtoCategoria, produtoPreco,
      produtoDescricao, produtoFoto
    } = req.body;

    if (!telefone || !nomeLojista || !nomeLoja || !cidade) {
      return res.status(400).json({ error: 'Faltam campos obrigatórios' });
    }

    // 1. usuário já existe?
    const existentes = await sb(`vendai_usuarios?telefone=eq.${encodeURIComponent(telefone)}&select=id`);
    let usuarioId, usuarioNovo = false, pinGerado = null;

    if (existentes && existentes.length > 0) {
      usuarioId = existentes[0].id;
    } else {
      pinGerado = telefone.slice(-4);
      const novoUsuario = await sb('vendai_usuarios', {
        method: 'POST',
        body: JSON.stringify({
          telefone, nome: nomeLojista, criado_via_lancamento: true, pin_hash: pinGerado
        })
      });
      usuarioId = novoUsuario[0].id;
      usuarioNovo = true;
    }

    // 2. teste grátis
    let testeExpiraEm = null;
    const dias = parseInt(diasTeste || '0', 10);
    if (dias > 0 && planoTeste !== 'gratis') {
      testeExpiraEm = new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString();
    }

    // 3. cria a loja
    const novaLoja = await sb('vendai_lojas', {
      method: 'POST',
      body: JSON.stringify({
        usuario_id: usuarioId,
        nome: nomeLoja,
        cidade,
        whatsapp: telefone,
        descricao: descricaoLoja || null,
        logo_url: logoUrl || null,
        cnpj: cnpj || null,
        status: 'ativa',
        origem_cadastro: 'lancamento',
        teste_gratis_plano_slug: planoTeste !== 'gratis' ? planoTeste : null,
        teste_gratis_expira_em: testeExpiraEm
      })
    });
    const lojaId = novaLoja[0].id;

    // 4. produto de cortesia
    if (produtoTitulo) {
      await sb('vendai_produtos_loja', {
        method: 'POST',
        body: JSON.stringify({
          loja_id: lojaId,
          titulo: produtoTitulo,
          categoria: produtoCategoria || null,
          preco: produtoPreco ? parseFloat(produtoPreco) : null,
          descricao: produtoDescricao || null,
          fotos: produtoFoto ? [produtoFoto] : [],
          status: 'ativo'
        })
      });
    }

    return res.status(200).json({ lojaId, usuarioNovo, pinGerado, testeExpiraEm });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Erro desconhecido' });
  }
}
