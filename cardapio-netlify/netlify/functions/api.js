// netlify/functions/api.js
const { getSupabase, verificarToken, getTokenFromEvent, gerarCodigo, ok, err, unauth } = require('./_shared');

function normalizarTelefoneWhatsApp(valor) {
  const digits = String(valor || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function mensagemWhatsAppPedido(pedido, status) {
  const nomeRestaurante = process.env.RESTAURANTE_NOME || 'Nosso restaurante';
  const statusLabel = {
    preparando: 'em preparo',
    pronto: 'pronto',
  }[status] || status;

  return [
    `Olá, ${pedido.cliente_nome}!`,
    `Seu pedido ${pedido.codigo} agora está ${statusLabel}.`
  ].join('\n');
}

function linkWhatsAppPedido(telefone, mensagem) {
  return `https://wa.me/${telefone}?text=${encodeURIComponent(mensagem)}`;
}

async function enviarWhatsAppPedido(pedido, status) {
  const telefone = normalizarTelefoneWhatsApp(pedido.cliente_telefone);
  if (!telefone) {
    return { enviado: false, url: null, motivo: 'cliente_sem_telefone' };
  }

  const mensagem = mensagemWhatsAppPedido(pedido, status);
  const url = linkWhatsAppPedido(telefone, mensagem);
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    return { enviado: false, url, motivo: 'whatsapp_api_nao_configurada' };
  }

  try {
    const resposta = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: telefone,
        type: 'text',
        text: { body: mensagem }
      })
    });

    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok) {
      return {
        enviado: false,
        url,
        motivo: 'whatsapp_api_erro',
        erro: dados?.error?.message || 'Falha ao enviar mensagem'
      };
    }

    return { enviado: true, url, via: 'api' };
  } catch (e) {
    return { enviado: false, url, motivo: 'whatsapp_api_excecao', erro: e.message };
  }
}

exports.handler = async (event) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const fullPath = (event.rawUrl ? new URL(event.rawUrl).pathname : event.path) || '/';
  const rawPath = fullPath
    .replace('/.netlify/functions/api', '')
    .replace(/^\/api/, '')
    .replace(/\/$/, '') || '/';

  const method = event.httpMethod;
  const qs = event.queryStringParameters || {};

  console.log(`[API] ${method} ${rawPath}`);

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ erro: 'Configure SUPABASE_URL e SUPABASE_SERVICE_KEY no Netlify.' })
    };
  }

  const supabase = getSupabase();
  const checkAuth = () => verificarToken(getTokenFromEvent(event));
  const respJson = (status, body) => ({
    statusCode: status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  try {

    // ══════════════════════════════════════════════════════════
    // CARDÁPIO
    // ══════════════════════════════════════════════════════════

    if (method === 'GET' && rawPath === '/cardapio') {
      const [{ data: categorias, error: e1 }, { data: produtos, error: e2 }, { data: configs }] = await Promise.all([
        supabase.from('categorias').select('*').eq('ativo', true).order('ordem'),
        supabase.from('produtos').select('*').eq('disponivel', true).order('destaque', { ascending: false }).order('nome'),
        supabase.from('configuracoes').select('*')
      ]);
      if (e1) console.error('categorias:', e1.message);
      if (e2) console.error('produtos:', e2.message);
      const configMap = {};
      (configs || []).forEach(c => configMap[c.chave] = c.valor);
      return respJson(200, {
        categorias: (categorias || []).map(cat => ({
          ...cat, produtos: (produtos || []).filter(p => p.categoria_id === cat.id)
        })),
        configuracoes: configMap
      });
    }

    if (method === 'POST' && rawPath === '/cardapio/produtos') {
      if (!checkAuth()) return respJson(401, { erro: 'Não autorizado' });
      const b = JSON.parse(event.body || '{}');
      const { data, error } = await supabase.from('produtos').insert({
        categoria_id: b.categoria_id || null, nome: b.nome, descricao: b.descricao || '',
        preco: Number(b.preco), disponivel: b.disponivel !== false, destaque: b.destaque === true,
        imagem: b.imagem || null
      }).select().single();
      if (error) return respJson(400, { erro: error.message });
      return respJson(200, { id: data.id, sucesso: true });
    }

    const prodMatch = rawPath.match(/^\/cardapio\/produtos\/(\d+)$/);
    if (prodMatch && method === 'PUT') {
      if (!checkAuth()) return respJson(401, { erro: 'Não autorizado' });
      const b = JSON.parse(event.body || '{}');
      const { error } = await supabase.from('produtos').update({
        nome: b.nome, descricao: b.descricao || '', preco: Number(b.preco),
        categoria_id: b.categoria_id || null, disponivel: b.disponivel !== false, destaque: b.destaque === true,
        imagem: b.imagem || null
      }).eq('id', prodMatch[1]);
      if (error) return respJson(400, { erro: error.message });
      return respJson(200, { sucesso: true });
    }
    if (prodMatch && method === 'DELETE') {
      if (!checkAuth()) return respJson(401, { erro: 'Não autorizado' });
      await supabase.from('produtos').update({ disponivel: false }).eq('id', prodMatch[1]);
      return respJson(200, { sucesso: true });
    }

    // ══════════════════════════════════════════════════════════
    // PEDIDOS
    // ══════════════════════════════════════════════════════════

    if (method === 'POST' && rawPath === '/pedidos') {
      const b = JSON.parse(event.body || '{}');
      const { cliente_nome, cliente_telefone, mesa, tipo, itens, observacoes, pagamento_metodo } = b;
      const telefoneNormalizado = normalizarTelefoneWhatsApp(cliente_telefone);
      if (!cliente_nome || !cliente_telefone?.trim() || !itens?.length) {
        return respJson(400, { erro: 'Nome, telefone e itens são obrigatórios' });
      }
      if (!telefoneNormalizado || telefoneNormalizado.length < 12) {
        return respJson(400, { erro: 'Informe um telefone válido com DDD' });
      }

      let subtotal = 0;
      const itensValidados = [];
      for (const item of itens) {
        const { data: produto } = await supabase.from('produtos').select('*').eq('id', item.produto_id).eq('disponivel', true).single();
        if (!produto) return respJson(400, { erro: `Produto ${item.produto_id} não encontrado` });
        const sub = Number(produto.preco) * item.quantidade;
        subtotal += sub;
        itensValidados.push({ produto_id: produto.id, nome_produto: produto.nome, preco_unitario: Number(produto.preco), quantidade: item.quantidade, observacao: item.observacao || '', subtotal: sub });
      }

      // Sem taxa de serviço — total = subtotal + entrega apenas
      const codigo = gerarCodigo();
      const tipoEntrega      = b.tipo_entrega || 'local';
      const taxaEntregaValor = tipoEntrega === 'delivery' ? (parseFloat(b.taxa_entrega) || 0) : 0;
      const total            = subtotal + taxaEntregaValor;

      const isDinheiro = pagamento_metodo === 'dinheiro';
      const { data: pedido, error: pedErr } = await supabase.from('pedidos').insert({
        codigo, cliente_nome, cliente_telefone: cliente_telefone || '',
        mesa: mesa || '', tipo: tipoEntrega,
        tipo_entrega: tipoEntrega,
        endereco_entrega: b.endereco_entrega || null,
        bairro_entrega:   b.bairro_entrega   || null,
        cep_entrega:      b.cep_entrega       || null,
        distancia_km:     parseFloat(b.distancia_km) || 0,
        taxa_entrega:     taxaEntregaValor,
        subtotal,
        taxa_servico:     0,
        total,
        observacoes: observacoes || '',
        pagamento_metodo: pagamento_metodo || 'pix',
        status: isDinheiro ? 'confirmado' : 'pendente',
        pagamento_status: isDinheiro ? 'dinheiro' : 'aguardando'
      }).select().single();

      if (pedErr) return respJson(500, { erro: pedErr.message });

      await supabase.from('itens_pedido').insert(
        itensValidados.map(i => ({ ...i, pedido_id: pedido.id }))
      );

      // Mercado Pago
      let mpData = null;
      const mpToken = process.env.MP_ACCESS_TOKEN;
      if (!isDinheiro && mpToken && !mpToken.includes('seu_access')) {
        try {
          const { MercadoPagoConfig, Preference } = require('mercadopago');
          const pref = new Preference(new MercadoPagoConfig({ accessToken: mpToken }));
          const baseUrl = process.env.URL || '';
          const pr = await pref.create({ body: {
            items: [
              ...itensValidados.map(i => ({
                title: i.nome_produto,
                unit_price: Number(Number(i.preco_unitario).toFixed(2)),
                quantity: Number(i.quantidade),
                currency_id: 'BRL'
              })),
              ...(taxaEntregaValor > 0 ? [{
                title: 'Taxa de entrega',
                unit_price: Number(Number(taxaEntregaValor).toFixed(2)),
                quantity: 1,
                currency_id: 'BRL'
              }] : [])
            ],
            // Total enviado ao MP inclui taxa de entrega
            payer: { name: cliente_nome },
            external_reference: codigo,
            notification_url: `${baseUrl}/api/webhook/mercadopago`,
            back_urls: {
              success: `${baseUrl}/?status=aprovado&codigo=${codigo}`,
              failure: `${baseUrl}/?status=falhou&codigo=${codigo}`,
              pending: `${baseUrl}/?status=pendente&codigo=${codigo}`
            },
            auto_return: 'approved'
          }});
          await supabase.from('pedidos').update({ mp_preference_id: pr.id }).eq('id', pedido.id);
          mpData = { preference_id: pr.id, init_point: pr.init_point };
          console.log(`[MP] Preference criada: ${pr.id} para pedido ${codigo}`);
        } catch(mpErr) {
          console.error('[MP] Erro ao criar preference:', mpErr.message);
          // Retornar erro claro se MP falhou mas era esperado
          return respJson(500, { erro: `Erro Mercado Pago: ${mpErr.message}` });
        }
      }

      return respJson(200, { sucesso: true, pedido, mercadopago: mpData });
    }

    // GET /pedidos — SOMENTE PAGOS por padrão no dashboard
    if (method === 'GET' && rawPath === '/pedidos') {
      if (!checkAuth()) return respJson(401, { erro: 'Não autorizado' });

      // pagamento_status=pago é o padrão agora, mas também mostramos pedidos em dinheiro
      const pagSt = qs.pagamento_status || 'pago';
      const incluirDinheiro = qs.incluir_dinheiro !== 'false';

      // Datas — padrão: hoje
      const hoje = new Date().toISOString().split('T')[0];
      const dataInicio = qs.data_inicio || hoje;
      const dataFim    = qs.data_fim    || hoje;

      const statuses = (pagSt === 'pago' && incluirDinheiro) ? ['pago', 'dinheiro'] : [pagSt];
      const limite = parseInt(qs.limit || 200);
      const pedidosMap = new Map();

      for (const statusPagamento of statuses) {
        let query = supabase.from('pedidos').select('*')
          .eq('pagamento_status', statusPagamento)
          .gte('criado_em', `${dataInicio}T00:00:00`)
          .lte('criado_em', `${dataFim}T23:59:59`)
          .order('criado_em', { ascending: false })
          .limit(limite);

        if (qs.status) query = query.eq('status', qs.status);

        const { data: pedidos, error } = await query;
        if (error) return respJson(500, { erro: error.message });
        (pedidos || []).forEach(p => pedidosMap.set(p.id, p));
      }

      const pedidos = Array.from(pedidosMap.values())
        .sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em))
        .slice(0, limite);

      const ids = (pedidos || []).map(p => p.id);
      const { data: todosItens } = ids.length
        ? await supabase.from('itens_pedido').select('*').in('pedido_id', ids)
        : { data: [] };

      return respJson(200, pedidos.map(p => ({
        ...p, itens: (todosItens || []).filter(i => i.pedido_id === p.id)
      })));
    }

    // GET /pedidos/:id — busca por ID numérico (usado no detalhe do dashboard)
    const pedIdMatch = rawPath.match(/^\/pedidos\/(\d+)$/);
    if (method === 'GET' && pedIdMatch) {
      if (!checkAuth()) return respJson(401, { erro: 'Não autorizado' });
      const { data: pedido, error } = await supabase.from('pedidos').select('*').eq('id', pedIdMatch[1]).single();
      if (error || !pedido) return respJson(404, { erro: 'Pedido não encontrado' });
      const { data: itens } = await supabase.from('itens_pedido').select('*').eq('pedido_id', pedido.id);
      return respJson(200, { ...pedido, itens: itens || [] });
    }

    // GET /pedidos/:codigo — busca por código alfanumérico (público, retorno MP)
    const pedCodigoMatch = rawPath.match(/^\/pedidos\/([A-Z0-9-]+)$/);
    if (method === 'GET' && pedCodigoMatch) {
      const { data: pedido } = await supabase.from('pedidos').select('*').eq('codigo', pedCodigoMatch[1]).single();
      if (!pedido) return respJson(404, { erro: 'Pedido não encontrado' });
      const { data: itens } = await supabase.from('itens_pedido').select('*').eq('pedido_id', pedido.id);
      return respJson(200, { ...pedido, itens: itens || [] });
    }

    const pedStatusMatch = rawPath.match(/^\/pedidos\/(\d+)\/status$/);
    if (method === 'PUT' && pedStatusMatch) {
      if (!checkAuth()) return respJson(401, { erro: 'Não autorizado' });
      const { status, pagamento_status } = JSON.parse(event.body || '{}');
      const { data: pedidoAtual } = await supabase.from('pedidos')
        .select('id, codigo, cliente_nome, cliente_telefone, status, pagamento_status')
        .eq('id', pedStatusMatch[1])
        .single();
      const upd = { atualizado_em: new Date().toISOString() };
      if (status) upd.status = status;
      if (pagamento_status) upd.pagamento_status = pagamento_status;
      await supabase.from('pedidos').update(upd).eq('id', pedStatusMatch[1]);
      let whatsapp = null;
      if (pedidoAtual && ['preparando', 'pronto'].includes(status) && status !== pedidoAtual.status) {
        whatsapp = await enviarWhatsAppPedido(pedidoAtual, status);
      }
      return respJson(200, { sucesso: true, whatsapp });
    }

    // ── Atualizar status pelo CÓDIGO do pedido (usado no retorno do MP via back_url)
    const pedCodigoStatusMatch = rawPath.match(/^\/pedidos\/codigo\/([A-Z0-9-]+)\/status$/);
    if (method === 'PUT' && pedCodigoStatusMatch) {
      const { status, pagamento_status } = JSON.parse(event.body || '{}');
      const { data: pedidoAtual } = await supabase.from('pedidos')
        .select('id, codigo, cliente_nome, cliente_telefone, status, pagamento_status')
        .eq('codigo', pedCodigoStatusMatch[1])
        .single();
      const upd = { atualizado_em: new Date().toISOString() };
      if (status) upd.status = status;
      if (pagamento_status) upd.pagamento_status = pagamento_status;
      const { error } = await supabase.from('pedidos').update(upd).eq('codigo', pedCodigoStatusMatch[1]);
      if (error) return respJson(500, { erro: error.message });
      let whatsapp = null;
      if (pedidoAtual && ['preparando', 'pronto'].includes(status) && status !== pedidoAtual.status) {
        whatsapp = await enviarWhatsAppPedido(pedidoAtual, status);
      }
      return respJson(200, { sucesso: true, whatsapp });
    }

    // ══════════════════════════════════════════════════════════
    // DASHBOARD STATS
    // ══════════════════════════════════════════════════════════

    if (method === 'GET' && rawPath === '/dashboard/stats') {
      if (!checkAuth()) return respJson(401, { erro: 'Não autorizado' });

      const hoje = new Date().toISOString().split('T')[0];
      const mesAtual = new Date().toISOString().substring(0, 7);

      const [
        { count: pedidosHoje },
        { count: pedidosPagosDia },
        { count: aguardandoDia },
        { data: recHoje },
        { count: pendentes },
        { count: aguardando },
        { data: recMes },
        { data: ultimosPedidos }
      ] = await Promise.all([
        supabase.from('pedidos').select('*', { count: 'exact', head: true }).gte('criado_em', `${hoje}T00:00:00`).lte('criado_em', `${hoje}T23:59:59`),
        supabase.from('pedidos').select('*', { count: 'exact', head: true }).gte('criado_em', `${hoje}T00:00:00`).lte('criado_em', `${hoje}T23:59:59`).in('pagamento_status', ['pago', 'dinheiro']),
        supabase.from('pedidos').select('*', { count: 'exact', head: true }).gte('criado_em', `${hoje}T00:00:00`).lte('criado_em', `${hoje}T23:59:59`).eq('pagamento_status', 'aguardando'),
        supabase.from('pedidos').select('total').gte('criado_em', `${hoje}T00:00:00`).lte('criado_em', `${hoje}T23:59:59`).in('pagamento_status', ['pago', 'dinheiro']),
        supabase.from('pedidos').select('*', { count: 'exact', head: true }).in('status', ['pendente','confirmado','preparando','pronto']),
        supabase.from('pedidos').select('*', { count: 'exact', head: true }).eq('pagamento_status', 'aguardando'),
        supabase.from('pedidos').select('total').gte('criado_em', `${mesAtual}-01T00:00:00`).in('pagamento_status', ['pago', 'dinheiro']),
        // Últimos 10 pedidos PAGOS para o overview
        supabase.from('pedidos').select('*').in('pagamento_status', ['pago', 'dinheiro']).order('criado_em', { ascending: false }).limit(10)
      ]);

      return respJson(200, {
        stats: {
          pedidos_hoje: pedidosHoje || 0,
          pedidos_pagos_dia: pedidosPagosDia || 0,
          aguardando_pagamento_dia: aguardandoDia || 0,
          receita_hoje: (recHoje||[]).reduce((s,p) => s + Number(p.total), 0),
          pedidos_pendentes: pendentes || 0,
          aguardando_pagamento: aguardando || 0,
          receita_mes: (recMes||[]).reduce((s,p) => s + Number(p.total), 0)
        },
        ultimosPedidos: ultimosPedidos || []
      });
    }

    // ══════════════════════════════════════════════════════════
    // WEBHOOK MERCADO PAGO
    // ══════════════════════════════════════════════════════════

    if (method === 'POST' && rawPath === '/webhook/mercadopago') {
      const b = JSON.parse(event.body || '{}');
      console.log('[WEBHOOK MP] Recebido:', JSON.stringify(b));

      // O MP pode enviar action = "payment.updated" ou type = "payment"
      const isPayment = b.type === 'payment' || b.action?.startsWith('payment');
      const paymentId = b.data?.id;

      if (isPayment && paymentId) {
        try {
          const mpToken = process.env.MP_ACCESS_TOKEN;
          if (!mpToken || mpToken.includes('seu_access')) {
            console.log('[WEBHOOK MP] Token não configurado');
            return respJson(200, { recebido: true });
          }

          const { MercadoPagoConfig, Payment } = require('mercadopago');
          const paymentClient = new Payment(new MercadoPagoConfig({ accessToken: mpToken }));
          const info = await paymentClient.get({ id: paymentId });

          console.log(`[WEBHOOK MP] Payment ${paymentId}: status=${info.status}, ref=${info.external_reference}`);

          if (info.external_reference) {
            let pagSt = 'aguardando';
            let pedSt  = 'pendente';

            if (info.status === 'approved') {
              pagSt = 'pago';
              pedSt  = 'confirmado';
            } else if (info.status === 'in_process' || info.status === 'pending') {
              pagSt = 'aguardando';
              pedSt  = 'pendente';
            } else if (['rejected', 'cancelled', 'refunded', 'charged_back'].includes(info.status)) {
              pagSt = 'cancelado';
              pedSt  = 'cancelado';
            }

            const { error: upErr } = await supabase.from('pedidos').update({
              pagamento_status: pagSt,
              status: pedSt,
              mp_payment_id: String(paymentId),
              pagamento_metodo: info.payment_type_id || info.payment_method_id || 'pix',
              atualizado_em: new Date().toISOString()
            }).eq('codigo', info.external_reference);

            if (upErr) {
              console.error('[WEBHOOK MP] Erro ao atualizar:', upErr.message);
            } else {
              console.log(`[WEBHOOK MP] Pedido ${info.external_reference} → pagamento_status=${pagSt}`);
            }
          }
        } catch(e) {
          console.error('[WEBHOOK MP] Erro:', e.message);
        }
      }

      // Sempre retornar 200 para o MP não reenviar
      return respJson(200, { recebido: true });
    }

    // GET /config/entrega — configurações públicas de entrega
    if (method === 'GET' && rawPath === '/config/entrega') {
      const { data: cfgs } = await supabase.from('configuracoes').select('*')
        .in('chave', ['entrega_ativa','retirada_ativa',
                      'km_minimo','taxa_minima','taxa_por_km_adicional',
                      'distancia_maxima_km','pedido_minimo_entrega',
                      'lat_restaurante','lng_restaurante',
                      'restaurante_endereco','restaurante_nome',
                      'restaurante_telefone']);
      const c = {};
      (cfgs||[]).forEach(x => c[x.chave] = x.valor);
      return respJson(200, c);
    }

    // PUT /config/entrega — salvar configurações (admin)
    if (method === 'PUT' && rawPath === '/config/entrega') {
      if (!checkAuth()) return respJson(401, { erro: 'Não autorizado' });
      const b = JSON.parse(event.body || '{}');
      const permitidos = ['entrega_ativa','retirada_ativa',
                          'km_minimo','taxa_minima','taxa_por_km_adicional',
                          'distancia_maxima_km','pedido_minimo_entrega',
                          'lat_restaurante','lng_restaurante',
                          'restaurante_endereco','restaurante_nome',
                          'restaurante_telefone'];
      for (const [chave, valor] of Object.entries(b)) {
        if (permitidos.includes(chave)) {
          await supabase.from('configuracoes')
            .upsert({ chave, valor: String(valor) });
        }
      }
      return respJson(200, { sucesso: true });
    }

    // GET /config/distancia?lat=X&lng=Y — calcula km e taxa para o cliente
    if (method === 'GET' && rawPath === '/config/distancia') {
      const clienteLat = parseFloat(qs.lat);
      const clienteLng = parseFloat(qs.lng);
      if (isNaN(clienteLat) || isNaN(clienteLng)) {
        return respJson(400, { erro: 'Parâmetros lat e lng são obrigatórios' });
      }

      const { data: cfgs } = await supabase.from('configuracoes').select('*')
        .in('chave', ['taxa_por_km','km_gratis','distancia_maxima_km',
                      'pedido_minimo_entrega','lat_restaurante','lng_restaurante']);
      const c = {};
      (cfgs||[]).forEach(x => c[x.chave] = x.valor);

      const latR = parseFloat(c.lat_restaurante || '-22.9068');
      const lngR = parseFloat(c.lng_restaurante || '-43.1729');

      // Fórmula de Haversine
      const R = 6371;
      const dLat = (clienteLat - latR) * Math.PI / 180;
      const dLng = (clienteLng - lngR) * Math.PI / 180;
      const a = Math.sin(dLat/2)**2
              + Math.cos(latR*Math.PI/180) * Math.cos(clienteLat*Math.PI/180)
              * Math.sin(dLng/2)**2;
      const distancia = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const distanciaArredondada = Math.round(distancia * 10) / 10;

      // Novo modelo: km mínimo com taxa mínima fixa + taxa por km adicional
      const kmMinimo          = parseFloat(c.km_minimo || 1);
      const taxaMinima        = parseFloat(c.taxa_minima || 5);
      const taxaPorKmAdicional = parseFloat(c.taxa_por_km_adicional || 2);
      const distMaxima        = parseFloat(c.distancia_maxima_km || 15);
      const pedidoMinimo      = parseFloat(c.pedido_minimo_entrega || 20);

      if (distanciaArredondada > distMaxima) {
        return respJson(200, {
          distancia_km: distanciaArredondada,
          taxa_entrega: null,
          fora_de_area: true,
          mensagem: `Fora da área de entrega (máx. ${distMaxima} km)`
        });
      }

      // Cálculo: taxa mínima cobre os primeiros kmMinimo
      // acima disso cobra taxa_por_km_adicional por km excedente
      let taxaEntrega;
      if (distanciaArredondada <= kmMinimo) {
        taxaEntrega = taxaMinima;
      } else {
        const kmExcedente = distanciaArredondada - kmMinimo;
        taxaEntrega = taxaMinima + (kmExcedente * taxaPorKmAdicional);
      }
      taxaEntrega = Math.round(taxaEntrega * 100) / 100;

      const dentroDoMinimo = distanciaArredondada <= kmMinimo;
      return respJson(200, {
        distancia_km: distanciaArredondada,
        taxa_entrega: taxaEntrega,
        km_minimo: kmMinimo,
        taxa_minima: taxaMinima,
        taxa_por_km_adicional: taxaPorKmAdicional,
        pedido_minimo: pedidoMinimo,
        fora_de_area: false,
        mensagem: dentroDoMinimo
          ? `R$ ${taxaEntrega.toFixed(2).replace('.',',')} (taxa mínima até ${kmMinimo}km)`
          : `R$ ${taxaEntrega.toFixed(2).replace('.',',')} (${distanciaArredondada} km)`
      });
    }

    // GET /categorias — listar todas (admin)
    if (method === 'GET' && rawPath === '/categorias') {
      if (!checkAuth()) return respJson(401, { erro: 'Não autorizado' });
      const { data } = await supabase.from('categorias').select('*').order('ordem');
      return respJson(200, data || []);
    }

    // POST /categorias — criar categoria
    if (method === 'POST' && rawPath === '/categorias') {
      if (!checkAuth()) return respJson(401, { erro: 'Não autorizado' });
      const b = JSON.parse(event.body || '{}');
      // Pegar próxima ordem
      const { data: ords } = await supabase.from('categorias').select('ordem').order('ordem', { ascending: false }).limit(1);
      const proxOrdem = (ords?.[0]?.ordem || 0) + 1;
      const { data, error } = await supabase.from('categorias').insert({
        nome: b.nome, icone: b.icone || 'restaurant', ordem: proxOrdem, ativo: true
      }).select().single();
      if (error) return respJson(400, { erro: error.message });
      return respJson(200, { sucesso: true, id: data.id });
    }

    // PUT /categorias/:id — editar categoria
    const catMatch = rawPath.match(/^\/categorias\/(\d+)$/);
    if (method === 'PUT' && catMatch) {
      if (!checkAuth()) return respJson(401, { erro: 'Não autorizado' });
      const b = JSON.parse(event.body || '{}');
      const upd = {};
      if (b.nome  !== undefined) upd.nome  = b.nome;
      if (b.icone !== undefined) upd.icone = b.icone;
      if (b.ordem !== undefined) upd.ordem = b.ordem;
      if (b.ativo !== undefined) upd.ativo = b.ativo;
      const { error } = await supabase.from('categorias').update(upd).eq('id', catMatch[1]);
      if (error) return respJson(400, { erro: error.message });
      return respJson(200, { sucesso: true });
    }

    // DELETE /categorias/:id — remover categoria (só se não tiver produtos)
    if (method === 'DELETE' && catMatch) {
      if (!checkAuth()) return respJson(401, { erro: 'Não autorizado' });
      // Verificar se tem produtos ativos
      const { count } = await supabase.from('produtos').select('*', { count: 'exact', head: true })
        .eq('categoria_id', catMatch[1]).eq('disponivel', true);
      if (count > 0) {
        return respJson(400, { erro: `Esta categoria possui ${count} produto(s) ativo(s). Remova ou mova os produtos antes de excluir a categoria.` });
      }
      await supabase.from('categorias').delete().eq('id', catMatch[1]);
      return respJson(200, { sucesso: true });
    }

    // GET /config/loja — status público da loja
    if (method === 'GET' && rawPath === '/config/loja') {
      const { data } = await supabase.from('configuracoes').select('valor').eq('chave', 'restaurante_aberto').single();
      const aberto = data?.valor === 'true';
      return respJson(200, { aberto, mensagem: aberto ? '' : 'A loja está fechada no momento.' });
    }

    // PUT /config/loja — abrir/fechar loja (admin)
    if (method === 'PUT' && rawPath === '/config/loja') {
      if (!checkAuth()) return respJson(401, { erro: 'Não autorizado' });
      const { aberto } = JSON.parse(event.body || '{}');
      await supabase.from('configuracoes')
        .upsert({ chave: 'restaurante_aberto', valor: aberto ? 'true' : 'false' });
      console.log(`[Loja] Status alterado para: ${aberto ? 'ABERTA' : 'FECHADA'}`);
      return respJson(200, { sucesso: true, aberto });
    }

    return respJson(404, { erro: 'Rota não encontrada', path: rawPath, method });

  } catch(e) {
    console.error('[API] Erro interno:', e.message);
    return respJson(500, { erro: e.message });
  }
};
