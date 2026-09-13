// api/loja-info.js
// Função de servidor (Vercel) — lê loja, produtos e planos com permissão total,
// contornando o RLS que bloqueia leitura direta do navegador.
// Também marca "boas_vindas_vista_em" na primeira visita.
//
// Usa a mesma variável de ambiente SUPABASE_SERVICE_ROLE_KEY já configurada.

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
  try { data = text ? JSON.parse(text) : null; } catch (e) { /* vazio */ }
  if (!resp.ok) {
    throw new Error((data && (data.message || JSON.stringify(data))) || `Erro Supabase (${resp.status})`);
  }
  return data;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' });
  }
  if (!SERVICE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY não configurada no servidor' });
  }

  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Falta o id da loja' });

    const lojas = await sb(`vendai_lojas?id=eq.${id}&select=*`);
    if (!lojas || lojas.length === 0) {
      return res.status(404).json({ error: 'Loja não encontrada' });
    }
    const loja = lojas[0];

    const produtos = await sb(
      `vendai_produtos_loja?loja_id=eq.${id}&status=neq.removido&order=criado_em.desc`
    );

    const planos = await sb(`vendai_planos?ativo=eq.true&order=preco_mensal.asc`);

    const usuarios = await sb(`vendai_usuarios?id=eq.${loja.usuario_id}&select=telefone,criado_via_lancamento`);
    const usuario = (usuarios && usuarios[0]) || null;

    // marca primeiro acesso, se ainda não tiver visto
    if (!loja.boas_vindas_vista_em) {
      await sb(`vendai_lojas?id=eq.${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ boas_vindas_vista_em: new Date().toISOString() })
      });
    }

    return res.status(200).json({ loja, produtos: produtos || [], planos: planos || [], usuario });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Erro desconhecido' });
  }
}
