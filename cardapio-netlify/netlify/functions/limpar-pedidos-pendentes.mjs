import { createClient } from '@supabase/supabase-js';

const headers = {
  'content-type': 'application/json',
};

export default async function handler() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    return new Response(JSON.stringify({
      ok: false,
      erro: 'SUPABASE_URL e SUPABASE_SERVICE_KEY são obrigatórios',
    }), {
      status: 500,
      headers,
    });
  }

  const supabase = createClient(url, key);
  const corte = new Date();
  corte.setDate(corte.getDate() - 30);
  const corteIso = corte.toISOString();

  const { data: pedidosAntigos, error: selectError } = await supabase
    .from('pedidos')
    .select('id')
    .eq('status', 'pendente')
    .lt('criado_em', corteIso);

  if (selectError) {
    return new Response(JSON.stringify({
      ok: false,
      erro: selectError.message,
    }), {
      status: 500,
      headers,
    });
  }

  const ids = (pedidosAntigos || []).map(p => p.id);
  if (!ids.length) {
    return new Response(JSON.stringify({
      ok: true,
      removidos: 0,
      mensagem: 'Nenhum pedido pendente antigo encontrado.',
    }), {
      status: 200,
      headers,
    });
  }

  const { error: deleteError } = await supabase
    .from('pedidos')
    .delete()
    .in('id', ids);

  if (deleteError) {
    return new Response(JSON.stringify({
      ok: false,
      erro: deleteError.message,
    }), {
      status: 500,
      headers,
    });
  }

  return new Response(JSON.stringify({
    ok: true,
    removidos: ids.length,
    corte: corteIso,
  }), {
    status: 200,
    headers,
  });
}
