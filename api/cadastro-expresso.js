// api/cadastro-expresso.js
// Função de servidor (Vercel) — grava loja/produto de cortesia com permissão total,
// contornando o RLS que bloqueia gravação direta do navegador.
//
// IMPORTANTE: essa função só funciona se você configurar a variável de ambiente
// SUPABASE_SERVICE_ROLE_KEY no painel da Vercel (Project Settings → Environment Variables).
// Use a "Secret key" (a de baixo, sb_secret_...) que você viu no Supabase — NUNCA
// coloque essa chave num arquivo .html, só aqui, como variável de ambiente do servidor.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://rgcclordmqjmwuzrrfbd.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
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
    let { data: usuarioExistente, error: errBusca } = await supabase
      .from('vendai_usuarios').select('id').eq('telefone', telefone).maybeSingle();
    if (errBusca) throw errBusca;

    let usuarioId, usuarioNovo = false, pinGerado = null;

    if (usuarioExistente) {
      usuarioId = usuarioExistente.id;
    } else {
      pinGerado = telefone.slice(-4);
      const { data: novoUsuario, error: errCriar } = await supabase
        .from('vendai_usuarios')
        .insert({ telefone, nome: nomeLojista, criado_via_lancamento: true, pin_hash: pinGerado })
        .select('id').single();
      if (errCriar) throw errCriar;
      usuarioId = novoUsuario.id;
      usuarioNovo = true;
    }

    // 2. teste grátis
    let testeExpiraEm = null;
    const dias = parseInt(diasTeste || '0', 10);
    if (dias > 0 && planoTeste !== 'gratis') {
      testeExpiraEm = new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString();
    }

    // 3. cria a loja
    const { data: loja, error: errLoja } = await supabase.from('vendai_lojas').insert({
      usuario_id: usuarioId,
      nome: nomeLoja,
      cidade,
      whatsapp: telefone,
      descricao: descricaoLoja || null,
      logo_url: logoUrl || null,
      cnpj: cnpj || null,
      status: 'ativo',
      origem_cadastro: 'lancamento',
      teste_gratis_plano_slug: planoTeste !== 'gratis' ? planoTeste : null,
      teste_gratis_expira_em: testeExpiraEm
    }).select('id').single();
    if (errLoja) throw errLoja;
    const lojaId = loja.id;

    // 4. produto de cortesia
    if (produtoTitulo) {
      await supabase.from('vendai_produtos_loja').insert({
        loja_id: lojaId,
        titulo: produtoTitulo,
        categoria: produtoCategoria || null,
        preco: produtoPreco ? parseFloat(produtoPreco) : null,
        descricao: produtoDescricao || null,
        fotos: produtoFoto ? [produtoFoto] : [],
        status: 'ativo'
      });
    }

    return res.status(200).json({ lojaId, usuarioNovo, pinGerado, testeExpiraEm });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Erro desconhecido' });
  }
}
