// Auth via JWT no localStorage (sem cookies de sessão server-side)
let pedidoAtual = null;
let cardapioCache = null;

// Token helper
const getToken = () => localStorage.getItem('admin_token') || '';
const authHeaders = () => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` });

document.addEventListener('DOMContentLoaded', async () => {
  await verificarAuth();

  document.getElementById('dataHoje').textContent = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  // Inicializar filtros de data com hoje
  const hoje = new Date().toISOString().split('T')[0];
  const di = document.getElementById('filtroDataInicio');
  const df = document.getElementById('filtroDataFim');
  if (di) di.value = hoje;
  if (df) df.value = hoje;

  // Carregar status da loja
  carregarStatusLoja();
  // Pré-carregar configs do restaurante para o cupom
  carregarConfigsImpressao();

  // Restaurar preferência de impressão automática
  const autoAtivo = localStorage.getItem('auto_impressao') === 'true';
  const toggle = document.getElementById('autoImpressaoToggle');
  if (toggle) {
    toggle.checked = autoAtivo;
    atualizarStatusAutoImpressao(autoAtivo);
  }

  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => { e.preventDefault(); mudarTab(item.dataset.tab); });
  });

  await carregarStats();

  // Polling normal das abas (30s)
  setInterval(() => {
    const tab = document.querySelector('.tab-content.active')?.id?.replace('tab-', '');
    if (tab === 'overview') carregarStats();
    else if (tab === 'pedidos') carregarPedidos();
    else if (tab === 'pagamentos') carregarPagamentos();
  }, 30000);

  // Monitor de impressão automática (polling a cada 8s)
  iniciarMonitorImpressao();
});

async function verificarAuth() {
  try {
    const res = await fetch('/auth/me', { headers: authHeaders() });
    const data = await res.json();
    if (!data.autenticado) { window.location.href = '/login'; return; }
    document.getElementById('userName').textContent = data.nome;
  } catch(e) { window.location.href = '/login'; }
}

function mudarTab(tab) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
  document.querySelector(`[data-tab="${tab}"]`)?.classList.add('active');
  document.getElementById('sidebar').classList.remove('show');
  document.getElementById('sidebarOverlay').classList.remove('show');

  if (tab === 'overview') carregarStats();
  else if (tab === 'pedidos') carregarPedidos();
  else if (tab === 'pagamentos') carregarPagamentos();
  else if (tab === 'produtos') carregarProdutos();
  else if (tab === 'entrega') carregarConfigEntrega();
}

// ===== STATS =====
async function carregarStats() {
  try {
    const res = await fetch('/api/dashboard/stats', { headers: authHeaders() });
    if (res.status === 401) { window.location.href = '/login'; return; }
    const data = await res.json();
    const { stats, ultimosPedidos } = data;

    document.getElementById('statPedidosHoje').textContent = stats.pedidos_hoje;
    document.getElementById('statReceitaHoje').textContent = `R$ ${Number(stats.receita_hoje).toFixed(2).replace('.', ',')}`;
    document.getElementById('statEmAndamento').textContent = stats.pedidos_pendentes;
    document.getElementById('statAguardando').textContent = stats.aguardando_pagamento_dia;
    document.getElementById('navBadgePendentes').textContent = stats.pedidos_pagos_dia;
    document.getElementById('navBadgePagamentos').textContent = stats.aguardando_pagamento_dia;

    renderizarUltimosPedidos(ultimosPedidos);
  } catch(e) { console.error('Erro stats:', e); }
}

function renderizarUltimosPedidos(pedidos) {
  const el = document.getElementById('ultimosPedidosLista');
  if (!pedidos?.length) {
    el.innerHTML = `<div class="empty-state py-4"><span class="material-icons-round">receipt_long</span><p class="text-muted">Nenhum pedido hoje</p></div>`;
    return;
  }
  el.innerHTML = pedidos.map(p => renderPedidoRow(p)).join('');
}

// ===== PEDIDOS =====
async function carregarPedidos() {
  const statusPedido    = document.getElementById('filtroStatus')?.value || '';
  const statusPagamento = document.getElementById('filtroPagamento')?.value || 'pago';
  const dataInicio      = document.getElementById('filtroDataInicio')?.value || '';
  const dataFim         = document.getElementById('filtroDataFim')?.value || '';
  const lista           = document.getElementById('pedidosLista');
  const resumoBar       = document.getElementById('pedidosResumo');

  lista.innerHTML = `<div class="section-card"><div class="loading-rows"><div class="loading-row"></div><div class="loading-row"></div></div></div>`;
  if (resumoBar) resumoBar.style.display = 'none';

  try {
    const params = new URLSearchParams();
    params.set('pagamento_status', statusPagamento);
    if (statusPedido)  params.set('status', statusPedido);
    if (dataInicio)    params.set('data_inicio', dataInicio);
    if (dataFim)       params.set('data_fim', dataFim);
    params.set('limit', '200');

    const res = await fetch(`/api/pedidos?${params}`, { headers: authHeaders() });
    const pedidos = await res.json();

    if (!Array.isArray(pedidos) || !pedidos.length) {
      const labelPag = { pago: 'pagos e dinheiro', aguardando: 'aguardando pagamento', cancelado: 'cancelados' }[statusPagamento] || statusPagamento;
      const periodoMsg = dataInicio === dataFim && dataInicio
        ? `em ${new Date(dataInicio + 'T12:00:00').toLocaleDateString('pt-BR')}`
        : dataInicio && dataFim ? `entre ${new Date(dataInicio+'T12:00:00').toLocaleDateString('pt-BR')} e ${new Date(dataFim+'T12:00:00').toLocaleDateString('pt-BR')}` : '';
      lista.innerHTML = `<div class="section-card"><div class="empty-state">
        <span class="material-icons-round">receipt_long</span>
        <h5>Nenhum pedido ${labelPag} ${periodoMsg}</h5>
        <p class="text-muted">Tente ajustar os filtros de data ou status.</p>
      </div></div>`;
      return;
    }

    // Barra de resumo
    if (resumoBar) {
      const totalValor = pedidos.reduce((s, p) => s + Number(p.total), 0);
      const totalItens = pedidos.reduce((s, p) => s + (p.itens?.length || 0), 0);
      const periodoLabel = dataInicio === dataFim && dataInicio
        ? new Date(dataInicio + 'T12:00:00').toLocaleDateString('pt-BR', { day:'2-digit', month:'short' })
        : `${dataInicio ? new Date(dataInicio+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'short'}) : '...'} → ${dataFim ? new Date(dataFim+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'short'}) : '...'}`;

      resumoBar.style.display = 'flex';
      resumoBar.innerHTML = `
        <div class="resumo-item"><span class="val">${pedidos.length}</span><span class="lbl">Pedidos</span></div>
        <div class="resumo-sep"></div>
        <div class="resumo-item"><span class="val">R$ ${totalValor.toFixed(2).replace('.',',')}</span><span class="lbl">Total recebido</span></div>
        <div class="resumo-sep"></div>
        <div class="resumo-item"><span class="val">${totalItens}</span><span class="lbl">Itens vendidos</span></div>
        <div class="resumo-sep"></div>
        <div class="resumo-item"><span class="val" style="font-size:14px">${periodoLabel}</span><span class="lbl">Período</span></div>`;
    }

    lista.innerHTML = `<div class="section-card">${pedidos.map(p => renderPedidoRow(p)).join('')}</div>`;
  } catch(e) {
    lista.innerHTML = `<div class="section-card"><div class="empty-state"><p>Erro ao carregar pedidos</p></div></div>`;
  }
}

// ===== PAGAMENTOS =====
async function carregarPagamentos() {
  const lista = document.getElementById('pagamentosLista');
  lista.innerHTML = `<div class="section-card"><div class="loading-rows"><div class="loading-row"></div></div></div>`;
  try {
    const res = await fetch('/api/pedidos?pagamento_status=aguardando', { headers: authHeaders() });
    const pedidos = await res.json();
    if (!pedidos.length) {
      lista.innerHTML = `<div class="section-card"><div class="empty-state"><span class="material-icons-round">check_circle</span><h5>Tudo em dia!</h5><p class="text-muted">Nenhum pagamento pendente</p></div></div>`;
      return;
    }
    lista.innerHTML = `<div class="section-card">${pedidos.map(p => renderPedidoRow(p)).join('')}</div>`;
  } catch(e) {
    lista.innerHTML = `<div class="section-card"><div class="empty-state"><p>Erro ao carregar</p></div></div>`;
  }
}

function renderPedidoRow(p) {
  const hora = new Date(p.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const data = new Date(p.criado_em).toLocaleDateString('pt-BR');
  return `
    <div class="pedido-row" onclick="abrirDetalhePedido(${p.id})">
      <div class="pedido-codigo">${p.codigo}</div>
      <div class="pedido-info">
        <div class="pedido-cliente">${p.cliente_nome}</div>
        <div class="pedido-meta">
          <span><span class="material-icons-round">schedule</span>${data} ${hora}</span>
          ${p.mesa ? `<span><span class="material-icons-round">table_restaurant</span>${p.mesa}</span>` : ''}
          <span><span class="material-icons-round">restaurant_menu</span>${p.itens?.length || 0} item(s)</span>
        </div>
      </div>
      <div class="d-flex flex-column align-items-end gap-1">
        <span class="badge-status badge-${p.status || 'pendente'}">${traduzirStatus(p.status)}</span>
        <span class="badge-status badge-${p.pagamento_status === 'pago' ? 'pago' : p.pagamento_status === 'dinheiro' ? 'dinheiro' : p.pagamento_status === 'cancelado' ? 'cancelado-pag' : 'aguardando'}">${traduzirPagamento(p.pagamento_status)}</span>
      </div>
      <div class="pedido-total">
        R$ ${Number(p.total).toFixed(2).replace('.', ',')}
        <small>${traduzirMetodo(p.pagamento_metodo)}</small>
        <small style="color:var(--gold)">${traduzirTipoEntrega(p.tipo_entrega || p.tipo)}</small>
      </div>
    </div>`;
}

// ===== DETALHE PEDIDO =====
async function abrirDetalhePedido(pedidoId) {
  const modal = new bootstrap.Modal(document.getElementById('modalPedido'));
  const body = document.getElementById('pedidoDetalheBody');
  const footer = document.getElementById('pedidoDetalheFooter');
  body.innerHTML = `<div class="text-center py-4"><div class="spinner-border" style="color:var(--gold)"></div></div>`;
  modal.show();

  try {
    // Busca o pedido diretamente pelo ID — funciona para qualquer status de pagamento
    const res = await fetch(`/api/pedidos/${pedidoId}`, { headers: authHeaders() });
    if (!res.ok) {
      body.innerHTML = `<div class="empty-state"><span class="material-icons-round text-danger">error</span><p>Pedido não encontrado (ID: ${pedidoId})</p></div>`;
      return;
    }
    const p = await res.json();
    if (!p || !p.id) {
      body.innerHTML = `<div class="empty-state"><p class="text-danger">Erro ao carregar pedido.</p></div>`;
      return;
    }
    pedidoAtual = p;

    const hora = new Date(p.criado_em).toLocaleString('pt-BR');
    body.innerHTML = `
      <div id="printArea">
        <div class="detalhe-header">
          <div><div class="detalhe-codigo">${p.codigo}</div><div class="text-muted small mt-1">${hora}</div></div>
          <div class="d-flex flex-column align-items-end gap-1">
            <span class="badge-status badge-${p.status}">${traduzirStatus(p.status)}</span>
            <span class="badge-status badge-${p.pagamento_status === 'pago' ? 'pago' : p.pagamento_status === 'dinheiro' ? 'dinheiro' : p.pagamento_status === 'cancelado' ? 'cancelado-pag' : 'aguardando'}">${traduzirPagamento(p.pagamento_status)}</span>
          </div>
        </div>
        <div class="detalhe-info-grid">
          <div class="info-box"><div class="info-box-label">Cliente</div><div class="info-box-value">${p.cliente_nome}</div></div>
          ${p.cliente_telefone ? `<div class="info-box"><div class="info-box-label">Telefone</div><div class="info-box-value">${p.cliente_telefone}</div></div>` : ''}
          ${p.mesa ? `<div class="info-box"><div class="info-box-label">Mesa</div><div class="info-box-value">${p.mesa}</div></div>` : ''}
          <div class="info-box"><div class="info-box-label">Tipo</div><div class="info-box-value">${traduzirTipoEntrega(p.tipo_entrega || p.tipo)}</div></div>
          <div class="info-box"><div class="info-box-label">Pagamento</div><div class="info-box-value">${traduzirMetodo(p.pagamento_metodo)}</div></div>
          ${p.tipo_entrega === 'delivery' && p.endereco_entrega ? `<div class="info-box" style="grid-column:1/-1"><div class="info-box-label">Endereço entrega</div><div class="info-box-value">${p.endereco_entrega}${p.bairro_entrega ? ' — ' + p.bairro_entrega : ''}${p.cep_entrega ? ' · CEP ' + p.cep_entrega : ''}</div></div>` : ''}
        </div>
        ${p.observacoes ? `<div class="info-box mb-3"><div class="info-box-label">Observações</div><div class="info-box-value" style="font-weight:400">${p.observacoes}</div></div>` : ''}
        <h6 class="fw-bold mb-2" style="font-family:'Playfair Display',serif">Itens do Pedido</h6>
        <div class="itens-lista">
          ${(p.itens || []).map(item => `
            <div class="item-linha">
              <span class="nome">${item.nome_produto}</span>
              <span class="qtd text-muted">x${item.quantidade}</span>
              <span class="subtotal">R$ ${Number(item.subtotal).toFixed(2).replace('.', ',')}</span>
            </div>`).join('')}
        </div>
        <div class="totais-resumo">
          <div class="linha"><span>Subtotal</span><span>R$ ${Number(p.subtotal).toFixed(2).replace('.', ',')}</span></div>

          ${Number(p.taxa_entrega) > 0 ? `<div class="linha"><span>🛵 Taxa de entrega${p.distancia_km > 0 ? ' (' + p.distancia_km + ' km)' : ''}</span><span>R$ ${Number(p.taxa_entrega).toFixed(2).replace('.', ',')}</span></div>` : ''}
          <div class="linha total"><span>TOTAL</span><span>R$ ${Number(p.total).toFixed(2).replace('.', ',')}</span></div>
        </div>
      </div>`;

    footer.innerHTML = `
      <div class="d-flex gap-2 flex-wrap w-100 justify-content-between">
        <button class="btn-imprimir" onclick="imprimirPedido()">
          <span class="material-icons-round">print</span> Imprimir
        </button>
        <button class="btn-imprimir" onclick="abrirWhatsAppCliente()" ${p.cliente_telefone ? '' : 'disabled'} style="background:#25D366;color:white;border-color:#25D366">
          <span class="material-icons-round">chat</span> WhatsApp
        </button>
        <div class="status-update">
          <select class="dash-select" id="novoStatus">
            <option value="pendente" ${p.status==='pendente'?'selected':''}>Pendente</option>
            <option value="confirmado" ${p.status==='confirmado'?'selected':''}>Confirmado</option>
            <option value="preparando" ${p.status==='preparando'?'selected':''}>Preparando</option>
            <option value="pronto" ${p.status==='pronto'?'selected':''}>Pronto</option>
            <option value="entregue" ${p.status==='entregue'?'selected':''}>Entregue</option>
            <option value="cancelado" ${p.status==='cancelado'?'selected':''}>Cancelado</option>
          </select>
          <select class="dash-select" id="novoPagStatus">
            <option value="aguardando" ${p.pagamento_status==='aguardando'?'selected':''}>Aguardando</option>
            <option value="dinheiro" ${p.pagamento_status==='dinheiro'?'selected':''}>Dinheiro</option>
            <option value="pago" ${p.pagamento_status==='pago'?'selected':''}>Pago</option>
            <option value="cancelado" ${p.pagamento_status==='cancelado'?'selected':''}>Cancelado</option>
          </select>
          <button class="btn-update-status" onclick="atualizarStatusPedido(${p.id})">
            <span class="material-icons-round">save</span> Salvar
          </button>
        </div>
      </div>`;
  } catch(e) {
    body.innerHTML = `<p class="text-danger">Erro ao carregar pedido</p>`;
  }
}

async function atualizarStatusPedido(pedidoId) {
  const status = document.getElementById('novoStatus').value;
  const pagamento_status = document.getElementById('novoPagStatus').value;
  try {
    const res = await fetch(`/api/pedidos/${pedidoId}/status`, {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ status, pagamento_status })
    });
    const data = await res.json();
    bootstrap.Modal.getInstance(document.getElementById('modalPedido')).hide();
    const tab = document.querySelector('.tab-content.active')?.id?.replace('tab-', '');
    if (tab === 'pedidos') carregarPedidos();
    else if (tab === 'pagamentos') carregarPagamentos();
    else carregarStats();

    if (data?.whatsapp?.url && !data.whatsapp.enviado) {
      window.open(data.whatsapp.url, '_blank', 'noopener,noreferrer');
    }
  } catch(e) { alert('Erro ao atualizar status'); }
}

function abrirWhatsAppCliente() {
  if (!pedidoAtual?.cliente_telefone) {
    alert('Este pedido não possui telefone cadastrado.');
    return;
  }

  const telefone = String(pedidoAtual.cliente_telefone).replace(/\D/g, '');
  if (!telefone) {
    alert('Telefone inválido.');
    return;
  }

  const telefoneWhats = telefone.startsWith('55') ? telefone : `55${telefone}`;
  const mensagem = `Olá, ${pedidoAtual.cliente_nome}! Seu pedido ${pedidoAtual.codigo} está ${traduzirStatus(pedidoAtual.status).toLowerCase()}.`;
  const url = `https://wa.me/${telefoneWhats}?text=${encodeURIComponent(mensagem)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

// ══════════════════════════════════════════════════════════
// IMPRESSÃO OTIMIZADA — Térmica 80mm + Chrome --kiosk-printing
// ══════════════════════════════════════════════════════════

function imprimirPedido(pedido) {
  const p = pedido || pedidoAtual;
  if (!p) return;

  // Buscar nome do restaurante das configs (ou usar padrão)
  const nomeRestaurante = window._nomeRestaurante || 'Big Dinho Lanches';
  const enderecoRestaurante = window._enderecoRestaurante || '';
  const telefoneRestaurante = window._telefoneRestaurante || '';

  // ── Montar linhas dos itens ──────────────────────────────
  // Largura 80mm ≈ 42 caracteres em fonte monospace 12px
  const COL = 42;

  function linha(esq, dir) {
    const espaco = COL - esq.length - dir.length;
    return esq + (espaco > 0 ? ' '.repeat(espaco) : ' ') + dir;
  }

  function centralizar(txt) {
    const pad = Math.max(0, Math.floor((COL - txt.length) / 2));
    return ' '.repeat(pad) + txt;
  }

  function separador(char = '-') {
    return char.repeat(COL);
  }

  function truncar(txt, max) {
    return txt.length > max ? txt.substring(0, max - 1) + '…' : txt;
  }

  // ── Tipo de entrega ──────────────────────────────────────
  const tipoEntregaLabel = {
    local:    '🍽️  CONSUMO NO LOCAL',
    retirada: '🛍️  RETIRADA NO BALCÃO',
    delivery: '🛵  DELIVERY'
  }[p.tipo_entrega || p.tipo] || '🍽️  CONSUMO NO LOCAL';

  // ── Itens formatados ─────────────────────────────────────
  const itensLinhas = (p.itens || []).map(item => {
    const nomeMax = 28;
    const nome    = truncar(item.nome_produto, nomeMax);
    const qtdPreco = `${item.quantidade}x R$${Number(item.preco_unitario).toFixed(2).replace('.', ',')}`;
    const total    = `R$${Number(item.subtotal).toFixed(2).replace('.', ',')}`;
    const l1 = linha(nome, total);
    const l2 = `   ${qtdPreco}`;
    return `<div class="item-linha">${l1}</div><div class="item-qtd">${l2}</div>`;
  }).join('');

  // ── Observação por item ──────────────────────────────────
  const obsItens = (p.itens || [])
    .filter(i => i.observacao)
    .map(i => `   ⚠ ${truncar(i.nome_produto, 18)}: ${i.observacao}`)
    .join('\n');

  // ── Endereço entrega ─────────────────────────────────────
  const endEntregaHtml = p.tipo_entrega === 'delivery' && p.endereco_entrega
    ? `<div class="bloco-entrega">
        <div class="label-entrega">ENDEREÇO DE ENTREGA:</div>
        <div>${p.endereco_entrega}</div>
        ${p.bairro_entrega ? `<div>${p.bairro_entrega}</div>` : ''}
        ${p.cep_entrega ? `<div>CEP: ${p.cep_entrega}</div>` : ''}
        ${p.distancia_km ? `<div>Distância: ${p.distancia_km} km</div>` : ''}
       </div>`
    : '';

  // ── Data/hora ────────────────────────────────────────────
  const agora = new Date(p.criado_em);
  const dataStr = agora.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' });
  const horaStr = agora.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });

  // ── HTML do cupom ────────────────────────────────────────
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>Cupom ${p.codigo}</title>
  <style>
    /* ── Reset e base 80mm ── */
    * { margin:0; padding:0; box-sizing:border-box; }

    @page {
      size: 80mm auto;       /* largura fixa 80mm, altura automática */
      margin: 0;
    }

    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: 11px;
      line-height: 1.4;
      color: #000;
      background: #fff;
      width: 76mm;           /* 80mm - 4mm margens laterais */
      margin: 0 auto;
      padding: 4mm 0 6mm;
    }

    /* ── Cabeçalho ── */
    .cabecalho {
      text-align: center;
      padding-bottom: 3mm;
      border-bottom: 1px dashed #000;
      margin-bottom: 3mm;
    }
    .nome-restaurante {
      font-size: 16px;
      font-weight: bold;
      letter-spacing: 1px;
      text-transform: uppercase;
    }
    .sub-restaurante {
      font-size: 10px;
      margin-top: 1mm;
      color: #333;
    }

    /* ── Separadores ── */
    .sep {
      border: none;
      border-top: 1px dashed #000;
      margin: 3mm 0;
    }
    .sep-solid {
      border: none;
      border-top: 2px solid #000;
      margin: 3mm 0;
    }

    /* ── Número do pedido (destaque) ── */
    .numero-pedido {
      text-align: center;
      font-size: 20px;
      font-weight: bold;
      letter-spacing: 2px;
      padding: 2mm 0;
      border: 2px solid #000;
      margin: 3mm 0;
    }
    .numero-pedido-label {
      text-align: center;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #555;
      margin-bottom: 1mm;
    }

    /* ── Tipo de entrega (destaque) ── */
    .tipo-entrega {
      text-align: center;
      font-size: 12px;
      font-weight: bold;
      padding: 1.5mm 0;
      margin-bottom: 2mm;
    }

    /* ── Dados do cliente ── */
    .bloco-dados { margin-bottom: 2mm; }
    .dado-linha {
      display: flex;
      gap: 4px;
      font-size: 10.5px;
      margin-bottom: 1px;
    }
    .dado-label { font-weight: bold; min-width: 14mm; flex-shrink: 0; }
    .dado-val   { flex: 1; }

    /* ── Endereço entrega ── */
    .bloco-entrega {
      background: #f0f0f0;
      border: 1px dashed #000;
      padding: 1.5mm 2mm;
      margin: 2mm 0;
      font-size: 10px;
    }
    .label-entrega {
      font-weight: bold;
      font-size: 9px;
      text-transform: uppercase;
      margin-bottom: 1mm;
    }

    /* ── Itens ── */
    .titulo-itens {
      font-size: 10px;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 2mm;
    }
    .item-linha {
      font-size: 11px;
      font-weight: bold;
      white-space: pre;
    }
    .item-qtd {
      font-size: 10px;
      color: #444;
      white-space: pre;
      margin-bottom: 1.5mm;
    }
    .obs-item {
      font-size: 9.5px;
      color: #333;
      font-style: italic;
      margin-left: 3mm;
      margin-bottom: 2mm;
      white-space: pre-wrap;
    }

    /* ── Totais ── */
    .bloco-totais { margin-top: 2mm; }
    .total-linha {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      margin-bottom: 1px;
    }
    .total-final {
      display: flex;
      justify-content: space-between;
      font-size: 15px;
      font-weight: bold;
      padding-top: 2mm;
      margin-top: 1mm;
      border-top: 2px solid #000;
    }

    /* ── Pagamento ── */
    .bloco-pagamento {
      text-align: center;
      font-size: 11px;
      font-weight: bold;
      margin: 2mm 0;
      padding: 1.5mm;
      border: 1px solid #000;
    }

    /* ── Observação geral ── */
    .obs-geral {
      font-size: 10px;
      font-style: italic;
      border: 1px dashed #000;
      padding: 1.5mm;
      margin: 2mm 0;
    }
    .obs-geral-label {
      font-weight: bold;
      font-size: 9px;
      text-transform: uppercase;
    }

    /* ── Rodapé ── */
    .rodape {
      text-align: center;
      font-size: 10px;
      color: #444;
      margin-top: 3mm;
      padding-top: 3mm;
      border-top: 1px dashed #000;
    }
    .rodape-obrigado {
      font-size: 12px;
      font-weight: bold;
      color: #000;
      margin-bottom: 1mm;
    }

    /* ── Data/hora rodapé ── */
    .data-hora {
      text-align: center;
      font-size: 9px;
      color: #666;
      margin-top: 2mm;
    }
  </style>
</head>
<body>

  <!-- CABEÇALHO -->
  <div class="cabecalho">
    <div class="nome-restaurante">${nomeRestaurante}</div>
    ${enderecoRestaurante ? `<div class="sub-restaurante">${enderecoRestaurante}</div>` : ''}
    ${telefoneRestaurante ? `<div class="sub-restaurante">Tel: ${telefoneRestaurante}</div>` : ''}
  </div>

  <!-- NÚMERO DO PEDIDO -->
  <div class="numero-pedido-label">Número do Pedido</div>
  <div class="numero-pedido">${p.codigo}</div>

  <!-- TIPO DE ENTREGA -->
  <div class="tipo-entrega">${tipoEntregaLabel}</div>

  <hr class="sep" />

  <!-- DADOS DO CLIENTE -->
  <div class="bloco-dados">
    <div class="dado-linha">
      <span class="dado-label">Cliente:</span>
      <span class="dado-val">${p.cliente_nome}</span>
    </div>
    ${p.cliente_telefone ? `
    <div class="dado-linha">
      <span class="dado-label">Tel:</span>
      <span class="dado-val">${p.cliente_telefone}</span>
    </div>` : ''}
    ${p.mesa ? `
    <div class="dado-linha">
      <span class="dado-label">Mesa:</span>
      <span class="dado-val">${p.mesa}</span>
    </div>` : ''}
    <div class="dado-linha">
      <span class="dado-label">Data:</span>
      <span class="dado-val">${dataStr} ${horaStr}</span>
    </div>
  </div>

  <!-- ENDEREÇO ENTREGA (se delivery) -->
  ${endEntregaHtml}

  <hr class="sep" />

  <!-- ITENS -->
  <div class="titulo-itens">▪ Itens do Pedido</div>
  ${itensLinhas}

  ${obsItens ? `<div class="obs-item">${obsItens}</div>` : ''}

  <hr class="sep" />

  <!-- TOTAIS -->
  <div class="bloco-totais">
    <div class="total-linha">
      <span>Subtotal</span>
      <span>R$${Number(p.subtotal).toFixed(2).replace('.', ',')}</span>
    </div>
    ${Number(p.taxa_entrega) > 0 ? `
    <div class="total-linha">
      <span>Taxa de entrega${p.distancia_km ? ' (' + p.distancia_km + 'km)' : ''}</span>
      <span>R$${Number(p.taxa_entrega).toFixed(2).replace('.', ',')}</span>
    </div>` : ''}
    <div class="total-final">
      <span>TOTAL</span>
      <span>R$${Number(p.total).toFixed(2).replace('.', ',')}</span>
    </div>
  </div>

  <hr class="sep" />

  <!-- FORMA DE PAGAMENTO -->
  <div class="bloco-pagamento">
    PAGAMENTO: ${traduzirMetodo(p.pagamento_metodo).toUpperCase()}
    ${p.pagamento_status === 'pago' ? ' ✓ PAGO' : p.pagamento_status === 'dinheiro' ? ' • DINHEIRO' : ''}
  </div>

  <!-- OBSERVAÇÃO GERAL -->
  ${p.observacoes ? `
  <div class="obs-geral">
    <div class="obs-geral-label">⚠ Observações:</div>
    ${p.observacoes}
  </div>` : ''}

  <!-- RODAPÉ -->
  <div class="rodape">
    <div class="rodape-obrigado">Obrigado pela preferência! 🍔</div>
    <div>${nomeRestaurante}</div>
    ${enderecoRestaurante ? `<div>${enderecoRestaurante}</div>` : ''}
  </div>

  <div class="data-hora">Impresso em ${dataStr} às ${horaStr}</div>

  <script>
    window.onload = function() {
      window.print();
      // Com --kiosk-printing o Chrome fecha sozinho após imprimir
      // Sem kiosk, fecha após 2s para dar tempo do diálogo aparecer
      setTimeout(function() { window.close(); }, 2000);
    };
  </script>

</body>
</html>`;

  // Abrir janela de impressão
  const w = window.open('', '_blank', 'width=320,height=600,toolbar=0,menubar=0,scrollbars=0');
  if (!w) {
    // Popup bloqueado — fallback inline
    alert('Permita pop-ups para este site para imprimir automaticamente.');
    return;
  }
  w.document.write(html);
  w.document.close();
}

// ── Carregar configs do restaurante para o cupom ──────────
async function carregarConfigsImpressao() {
  try {
    const res  = await fetch('/api/config/entrega', { headers: authHeaders() });
    const data = await res.json();
    window._nomeRestaurante    = data.restaurante_nome    || 'Restaurante';
    window._enderecoRestaurante = data.restaurante_endereco || '';
    window._telefoneRestaurante = data.restaurante_telefone || '';
  } catch(e) {}
}




function atualizarStatusAutoImpressao(ativo) {
  localStorage.setItem('auto_impressao', ativo ? 'true' : 'false');
  const el = document.getElementById('autoPrintStatus');
  if (!el) return;
  if (ativo) {
    el.innerHTML = '<span class="auto-print-pulse"></span>Ativa — verificando...';
    el.classList.add('ativo');
  } else {
    el.innerHTML = 'Desativada';
    el.classList.remove('ativo');
  }
}



// ════════════════════════════════════════════════════════════
// CONFIGURAÇÕES DE ENTREGA (Dashboard)
// ════════════════════════════════════════════════════════════

async function carregarConfigEntrega() {
  try {
    const res = await fetch('/api/config/entrega', { headers: authHeaders() });
    if (!res.ok) return;
    const c = await res.json();

    const el = id => document.getElementById(id);
    if (el('cfgEntregaAtiva'))        el('cfgEntregaAtiva').checked        = c.entrega_ativa !== 'false';
    if (el('cfgRetiradaAtiva'))       el('cfgRetiradaAtiva').checked       = c.retirada_ativa !== 'false';
    if (el('cfgKmMinimo'))            el('cfgKmMinimo').value            = c.km_minimo || '1';
    if (el('cfgTaxaMinima'))          el('cfgTaxaMinima').value            = c.taxa_minima || '5.00';
    if (el('cfgTaxaKmAdicional'))     el('cfgTaxaKmAdicional').value       = c.taxa_por_km_adicional || '2.00';
    if (el('cfgDistMax'))             el('cfgDistMax').value               = c.distancia_maxima_km || '15';
    if (el('cfgPedidoMin'))           el('cfgPedidoMin').value             = c.pedido_minimo_entrega || '20.00';
    if (el('cfgLat'))  el('cfgLat').value  = c.lat_restaurante || '';
    if (el('cfgLng'))  el('cfgLng').value  = c.lng_restaurante || '';
    if (el('cfgEnderecoRestaurante')) el('cfgEnderecoRestaurante').value = c.restaurante_endereco || '';
    // Preencher o campo de busca visível e o box de confirmação se já tiver coords
    if (c.lat_restaurante && c.lng_restaurante && el('cfgBuscaEndereco')) {
      const endSalvo = c.restaurante_endereco || '';
      // Mostrar endereço no campo de busca (sem número — já está no endFull)
      el('cfgBuscaEndereco').value = endSalvo;
      if (endSalvo) {
        el('enderecoRestauranteTexto').textContent = endSalvo;
        el('coordsRestauranteTexto').textContent   =
          `Lat: ${parseFloat(c.lat_restaurante).toFixed(6)}  ·  Lng: ${parseFloat(c.lng_restaurante).toFixed(6)}`;
        el('enderecoRestauranteConfirmado').style.display = 'flex';
        // Ocultar campo de número (já foi salvo dentro do endFull)
        if (el('campoNumeroRestaurante')) el('campoNumeroRestaurante').style.display = 'none';
      }
    }

    atualizarPreviewTaxa();
  } catch(e) { console.error('Erro ao carregar config entrega:', e); }
}

async function salvarConfigEntrega() {
  const el = id => document.getElementById(id);
  const payload = {
    entrega_ativa:          el('cfgEntregaAtiva')?.checked  ? 'true' : 'false',
    retirada_ativa:         el('cfgRetiradaAtiva')?.checked ? 'true' : 'false',
    km_minimo:              el('cfgKmMinimo')?.value         || '1',
    taxa_minima:            el('cfgTaxaMinima')?.value       || '5.00',
    taxa_por_km_adicional:  el('cfgTaxaKmAdicional')?.value  || '2.00',
    distancia_maxima_km:    el('cfgDistMax')?.value          || '15',
    pedido_minimo_entrega:  el('cfgPedidoMin')?.value        || '20.00',
    lat_restaurante:        el('cfgLat')?.value             || '',
    lng_restaurante:        el('cfgLng')?.value             || '',
  };

  const btn = document.querySelector('[onclick="salvarConfigEntrega()"]');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="material-icons-round spin">hourglass_top</span> Salvando...'; }

  try {
    // Salvar entrega configs
    await fetch('/api/config/entrega', {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify(payload)
    });

    // Salvar endereço do restaurante (vai em configuracoes também)
    const endVal = el('cfgEnderecoRestaurante')?.value;
    if (endVal !== undefined) {
      await fetch('/api/config/loja', {
        method: 'PUT', headers: authHeaders(),
        // reutilizamos rota genérica via configuracoes direto
      });
      await fetch('/api/config/entrega', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ restaurante_endereco: endVal })
      });
    }

    mostrarToastLoja(true); // reutiliza toast
    document.getElementById('toast-loja-status').querySelector('div > div > div:first-child').textContent = '✅ Configurações salvas!';

  } catch(e) { alert('Erro ao salvar: ' + e.message); }
  finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<span class="material-icons-round">save</span> Salvar configurações'; }
  }
}

function atualizarPreviewTaxa() {
  const kmMin    = parseFloat(document.getElementById('cfgKmMinimo')?.value || 1);
  const taxaMin  = parseFloat(document.getElementById('cfgTaxaMinima')?.value || 5);
  const taxaKmAd = parseFloat(document.getElementById('cfgTaxaKmAdicional')?.value || 2);
  const distMax  = parseFloat(document.getElementById('cfgDistMax')?.value || 15);

  // Atualizar label inline
  const labelEl = document.getElementById('cfgKmMinimoLabel');
  if (labelEl) labelEl.textContent = `${kmMin} km`;

  const preview = document.getElementById('cfgTaxaPreview');
  if (!preview) return;

  // Simular para 1, kmMin, kmMin+1, kmMin+2, distMax
  const distancias = [...new Set([1, kmMin, kmMin + 1, kmMin + 2, Math.round(distMax / 2), distMax])]
    .filter(d => d > 0 && d <= distMax)
    .sort((a, b) => a - b);

  const calcTaxa = (d) => {
    if (d <= kmMin) return taxaMin;
    return taxaMin + ((d - kmMin) * taxaKmAd);
  };

  preview.innerHTML = distancias.map(d => {
    const taxa = calcTaxa(d);
    const eMinimo = d <= kmMin;
    return `<div class="taxa-preview-row ${eMinimo ? 'minimo' : ''}">
      <span class="dist">${d} km${eMinimo ? ' (mínimo)' : ''}</span>
      <span class="valor">R$ ${taxa.toFixed(2).replace('.',',')}</span>
    </div>`;
  }).join('');
}

async function geocodificarRestaurante() {
  const texto = document.getElementById('cfgBuscaEndereco')?.value.trim();
  if (!texto || texto.length < 5) { alert('Digite o endereço do restaurante para buscar.'); return; }

  const btn = document.getElementById('btnBuscarEnd');
  btn.innerHTML = '<span class="material-icons-round spin">sync</span>';
  btn.disabled = true;

  try {
    const url  = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(texto)}&format=json&addressdetails=1&limit=6&countrycodes=br&accept-language=pt-BR`;
    const res  = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } });
    const data = await res.json();

    const lista = document.getElementById('sugestoesRestaurante');
    if (!data.length) {
      lista.style.display = 'block';
      lista.innerHTML = '<div style="padding:12px;font-size:13px;color:var(--text-muted)">Nenhum resultado. Tente um endereço mais completo.</div>';
    } else {
      lista.style.display = 'block';
      lista.innerHTML = data.map((item, idx) => {
        const addr   = item.address || {};
        const rua    = addr.road || addr.pedestrian || '';
        const numero = addr.house_number || '';
        const bairro = addr.suburb || addr.neighbourhood || addr.city_district || '';
        const cidade = addr.city || addr.town || '';
        const cep    = addr.postcode || '';
        const linhaP = [rua, numero].filter(Boolean).join(', ') || item.display_name.split(',')[0];
        const linhaS = [bairro, cidade].filter(Boolean).join(' — ');
        return `<div class="sugestao-dash" onclick="confirmarEnderecoRestaurante(${idx})">
          <span class="material-icons-round">store</span>
          <div>
            <div class="sugestao-dash-texto">${linhaP}</div>
            <div class="sugestao-dash-sub">${linhaS}${cep ? ' · CEP ' + cep : ''}</div>
          </div>
        </div>`;
      }).join('');
      lista._resultados = data;
    }
  } catch(e) {
    alert('Erro ao buscar endereço: ' + e.message);
  } finally {
    btn.innerHTML = '<span class="material-icons-round">search</span>';
    btn.disabled  = false;
  }
}

// Dados temporários da rua selecionada (aguardando número)
let _dadosRuaRestaurante = null;

function confirmarEnderecoRestaurante(idx) {
  const lista = document.getElementById('sugestoesRestaurante');
  const item  = lista._resultados?.[idx];
  if (!item) return;

  const addr   = item.address || {};
  const rua    = addr.road || addr.pedestrian || '';
  const numero = addr.house_number || ''; // número se já vier na sugestão
  const bairro = addr.suburb || addr.neighbourhood || addr.city_district || '';
  const cidade = addr.city || addr.town || '';
  const estado = addr.state || '';
  const cep    = addr.postcode || '';
  const lat    = parseFloat(item.lat);
  const lng    = parseFloat(item.lon);

  // Guardar dados da rua
  _dadosRuaRestaurante = { rua, bairro, cidade, estado, cep, lat, lng };

  // Fechar sugestões
  lista.style.display = 'none';

  // Se a sugestão já trouxe número (ex: buscou "Rua X, 123"), confirmar direto
  if (numero) {
    document.getElementById('cfgNumeroRestaurante').value = numero;
    document.getElementById('campoNumeroRestaurante').style.display = 'block';
    geocodificarEnderecoExatoRestaurante(numero);
    return;
  }

  // Caso contrário, mostrar campo de número para o admin digitar
  const linhaRua = [rua, bairro, cidade].filter(Boolean).join(', ');
  document.getElementById('cfgBuscaEndereco').value = linhaRua;
  document.getElementById('cfgNumeroRestaurante').value = '';
  document.getElementById('campoNumeroRestaurante').style.display = 'block';
  document.getElementById('numeroRestauranteStatus').innerHTML =
    '<span class="material-icons-round" style="color:var(--gold)">pin</span> Digite o número do estabelecimento';

  // Ocultar confirmado enquanto aguarda número
  document.getElementById('enderecoRestauranteConfirmado').style.display = 'none';

  // Focar no número
  setTimeout(() => document.getElementById('cfgNumeroRestaurante')?.focus(), 100);
}

let _debounceNumRest = null;
function onNumeroRestauranteChange() {
  clearTimeout(_debounceNumRest);
  const num = document.getElementById('cfgNumeroRestaurante')?.value.trim();
  if (!num) return;
  _debounceNumRest = setTimeout(() => geocodificarEnderecoExatoRestaurante(num), 800);
}

async function geocodificarEnderecoExatoRestaurante(numero) {
  if (!_dadosRuaRestaurante) return;
  const { rua, bairro, cidade, estado, cep } = _dadosRuaRestaurante;

  const statusEl = document.getElementById('numeroRestauranteStatus');
  if (statusEl) {
    statusEl.innerHTML = '<span class="material-icons-round spin">my_location</span> Localizando endereço exato...';
  }

  // Montar query com número
  const queryPartes = [rua + ', ' + numero];
  if (cep)    queryPartes.push(cep);
  else {
    if (bairro) queryPartes.push(bairro);
    if (cidade) queryPartes.push(cidade);
    if (estado) queryPartes.push(estado);
    queryPartes.push('Brasil');
  }
  const query = queryPartes.join(', ');

  try {
    const url  = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=3&countrycodes=br&accept-language=pt-BR`;
    const res  = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } });
    const data = await res.json();

    let latFinal, lngFinal, endFull, cepFinal;

    if (data.length > 0) {
      // Encontrou localização exata
      const melhor   = data[0];
      latFinal       = parseFloat(melhor.lat);
      lngFinal       = parseFloat(melhor.lon);
      const addrEx   = melhor.address || {};
      cepFinal       = addrEx.postcode || cep || '';
      endFull        = [rua, numero, bairro, cidade].filter(Boolean).join(', ');

      if (statusEl) {
        statusEl.className = 'entrega-info-box';
        statusEl.style.cssText = 'padding:8px 12px;font-size:12px;background:rgba(34,197,94,0.08);border-color:rgba(34,197,94,0.3)';
        statusEl.innerHTML = '<span class="material-icons-round" style="color:#22c55e">my_location</span> 📍 Localização exata encontrada!';
      }
    } else {
      // Não encontrou número — usar lat/lng da rua
      latFinal  = _dadosRuaRestaurante.lat;
      lngFinal  = _dadosRuaRestaurante.lng;
      cepFinal  = cep;
      endFull   = [rua, numero, bairro, cidade].filter(Boolean).join(', ');

      if (statusEl) {
        statusEl.className = 'entrega-info-box';
        statusEl.style.cssText = 'padding:8px 12px;font-size:12px;background:rgba(245,158,11,0.08);border-color:rgba(245,158,11,0.3)';
        statusEl.innerHTML = '<span class="material-icons-round" style="color:#f59e0b">location_on</span> Número não encontrado — usando localização aproximada da rua';
      }
    }

    // Preencher campos ocultos
    document.getElementById('cfgLat').value                = latFinal.toFixed(7);
    document.getElementById('cfgLng').value                = lngFinal.toFixed(7);
    document.getElementById('cfgEnderecoRestaurante').value = endFull;

    // Mostrar box de confirmação
    const cepFmt = cepFinal ? cepFinal.replace(/[^0-9]/g,'').replace(/(\d{5})(\d{3})/, '$1-$2') : '';
    document.getElementById('enderecoRestauranteTexto').textContent  = endFull;
    document.getElementById('coordsRestauranteTexto').textContent    =
      `Lat: ${latFinal.toFixed(6)}  ·  Lng: ${lngFinal.toFixed(6)}${cepFmt ? '  ·  CEP ' + cepFmt : ''}`;
    document.getElementById('enderecoRestauranteConfirmado').style.display = 'flex';

  } catch(e) {
    if (statusEl) {
      statusEl.innerHTML = '<span class="material-icons-round" style="color:#ef4444">error</span> Erro ao localizar. Tente novamente.';
    }
  }
}

function limparEnderecoRestaurante() {
  _dadosRuaRestaurante = null;
  clearTimeout(_debounceNumRest);
  document.getElementById('cfgLat').value = '';
  document.getElementById('cfgLng').value = '';
  document.getElementById('cfgEnderecoRestaurante').value = '';
  document.getElementById('cfgBuscaEndereco').value = '';
  document.getElementById('cfgNumeroRestaurante').value = '';
  document.getElementById('campoNumeroRestaurante').style.display = 'none';
  document.getElementById('enderecoRestauranteConfirmado').style.display = 'none';
  document.getElementById('sugestoesRestaurante').style.display = 'none';
  // Reset status do número
  const statusEl = document.getElementById('numeroRestauranteStatus');
  if (statusEl) {
    statusEl.className = 'entrega-info-box';
    statusEl.style.cssText = 'padding:8px 12px;font-size:12px';
    statusEl.innerHTML = '<span class="material-icons-round">info</span> Digite o número para localização exata';
  }
}

function usarGPSRestaurante() {
  if (!navigator.geolocation) { alert('Geolocalização não suportada.'); return; }
  const btn = document.getElementById('btnGPSRest');
  btn.innerHTML = '<span class="material-icons-round spin">sync</span>';
  btn.disabled  = true;

  navigator.geolocation.getCurrentPosition(
    async ({ coords: { latitude: lat, longitude: lng } }) => {
      try {
        const url  = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&accept-language=pt-BR`;
        const res  = await fetch(url);
        const geo  = await res.json();
        const addr = geo.address || {};

        const rua    = addr.road || addr.pedestrian || '';
        const numero = addr.house_number || '';
        const bairro = addr.suburb || addr.neighbourhood || addr.city_district || '';
        const cidade = addr.city || addr.town || '';
        const estado = addr.state || '';
        const cep    = addr.postcode || '';
        const cepFmt = cep.replace(/[^0-9]/g,'').replace(/(\d{5})(\d{3})/, '$1-$2');
        const endFull = [rua, numero, bairro, cidade].filter(Boolean).join(', ');

        // Salvar dados da rua para uso posterior
        _dadosRuaRestaurante = { rua, bairro, cidade, estado, cep, lat, lng };

        document.getElementById('cfgLat').value                 = lat.toFixed(7);
        document.getElementById('cfgLng').value                 = lng.toFixed(7);
        document.getElementById('cfgEnderecoRestaurante').value  = endFull;
        document.getElementById('cfgBuscaEndereco').value        = rua;

        // Se GPS retornou número, preencher e confirmar
        if (numero) {
          document.getElementById('cfgNumeroRestaurante').value = numero;
          document.getElementById('campoNumeroRestaurante').style.display = 'block';
        }

        document.getElementById('enderecoRestauranteTexto').textContent = endFull;
        document.getElementById('coordsRestauranteTexto').textContent   =
          `Lat: ${lat.toFixed(6)}  ·  Lng: ${lng.toFixed(6)}${cepFmt ? '  ·  CEP ' + cepFmt : ''} · 📍 Via GPS`;
        document.getElementById('enderecoRestauranteConfirmado').style.display = 'flex';
      } catch(e) {
        document.getElementById('cfgLat').value = lat.toFixed(7);
        document.getElementById('cfgLng').value = lng.toFixed(7);
        document.getElementById('coordsRestauranteTexto').textContent = `Lat: ${lat.toFixed(6)}  ·  Lng: ${lng.toFixed(6)}`;
        document.getElementById('enderecoRestauranteConfirmado').style.display = 'flex';
        document.getElementById('enderecoRestauranteTexto').textContent = 'Localização obtida via GPS';
      }
      btn.innerHTML = '<span class="material-icons-round">my_location</span>';
      btn.disabled  = false;
    },
    () => {
      alert('Não foi possível obter sua localização.');
      btn.innerHTML = '<span class="material-icons-round">my_location</span>';
      btn.disabled  = false;
    },
    { timeout: 12000, enableHighAccuracy: true }
  );
}

// Fechar sugestões ao clicar fora
document.addEventListener('click', (e) => {
  if (!e.target.closest('#cfgBuscaEndereco') && !e.target.closest('#sugestoesRestaurante')) {
    const lista = document.getElementById('sugestoesRestaurante');
    if (lista) lista.style.display = 'none';
  }
});

// ════════════════════════════════════════════════════════════
// CONTROLE DE STATUS DA LOJA (Aberta / Fechada)
// ════════════════════════════════════════════════════════════

let _lojaAberta = true; // cache local

async function carregarStatusLoja() {
  try {
    const res = await fetch('/api/config/loja', { headers: authHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    _lojaAberta = data.aberto;
    atualizarUILoja(data.aberto);
  } catch(e) {
    console.warn('[Loja] Erro ao carregar status:', e.message);
  }
}

async function alternarLoja() {
  const btn = document.getElementById('lojaToggleBtn');
  btn.style.opacity = '0.5';
  btn.style.pointerEvents = 'none';

  const novoStatus = !_lojaAberta;

  try {
    const res = await fetch('/api/config/loja', {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ aberto: novoStatus })
    });
    const data = await res.json();
    if (data.sucesso) {
      _lojaAberta = data.aberto;
      atualizarUILoja(data.aberto);
      mostrarToastLoja(data.aberto);
    }
  } catch(e) {
    alert('Erro ao alterar status da loja');
  } finally {
    btn.style.opacity = '';
    btn.style.pointerEvents = '';
  }
}

function atualizarUILoja(aberta) {
  const wrap  = document.getElementById('lojaStatusWrap');
  const label = document.getElementById('lojaStatusLabel');
  const sub   = document.getElementById('lojaStatusSub');
  const icon  = document.getElementById('lojaToggleIcon');
  if (!wrap) return;

  wrap.className = `loja-status-wrap ${aberta ? 'aberta' : 'fechada'}`;
  label.textContent = aberta ? 'Loja Aberta' : 'Loja Fechada';
  sub.textContent   = aberta ? 'clique para fechar' : 'clique para abrir';
  icon.textContent  = aberta ? 'toggle_on' : 'toggle_off';
}

function mostrarToastLoja(aberta) {
  document.getElementById('toast-loja-status')?.remove();
  const toast = document.createElement('div');
  toast.id = 'toast-loja-status';
  const cor   = aberta ? '#22c55e' : '#ef4444';
  const icone = aberta ? 'store'   : 'store_mall_directory';
  const msg   = aberta ? 'Loja aberta! Clientes já podem fazer pedidos.' : 'Loja fechada. Pedidos bloqueados para os clientes.';
  toast.innerHTML = `
    <div style="
      position:fixed;bottom:24px;right:24px;z-index:9999;
      background:var(--espresso);color:white;
      border-radius:16px;padding:16px 20px;
      box-shadow:0 8px 32px rgba(0,0,0,0.3);
      display:flex;align-items:center;gap:14px;
      max-width:340px;animation:slideToast .4s ease;
      border-left:4px solid ${cor};
    ">
      <span class="material-icons-round" style="font-size:28px;color:${cor}">${icone}</span>
      <div>
        <div style="font-weight:700;font-size:14px;margin-bottom:3px">${aberta ? '✅ Loja Aberta' : '🔴 Loja Fechada'}</div>
        <div style="font-size:12px;opacity:.8">${msg}</div>
      </div>
      <button onclick="this.closest('#toast-loja-status').remove()"
        style="background:none;border:none;color:rgba(255,255,255,.5);cursor:pointer;margin-left:auto;font-size:20px">×</button>
    </div>`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

// ════════════════════════════════════════════════════════════
// MONITOR DE IMPRESSÃO AUTOMÁTICA
// Detecta pedidos pagos ou em dinheiro e imprime sozinho
// ════════════════════════════════════════════════════════════

// IDs já processados — evita reimprimir o mesmo pedido
const _jaImpressos = new Set(
  JSON.parse(localStorage.getItem('ja_impressos') || '[]')
);

// Marcar como impresso e persistir
function marcarImpresso(id) {
  _jaImpressos.add(id);
  // Manter só os últimos 500 para não crescer infinito
  const arr = Array.from(_jaImpressos).slice(-500);
  localStorage.setItem('ja_impressos', JSON.stringify(arr));
}

// Som de notificação (beep via WebAudio — sem arquivo externo)
function tocarSomNotificacao() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notas = [880, 1100, 1320];
    notas.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.2);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.2);
    });
  } catch(e) { /* AudioContext pode não estar disponível */ }
}

// Notificação toast no canto da tela
function mostrarToastPedido(pedido) {
  // Remover toast anterior se existir
  document.getElementById('toast-auto-print')?.remove();

  const toast = document.createElement('div');
  toast.id = 'toast-auto-print';
  toast.innerHTML = `
    <div style="
      position:fixed; bottom:24px; right:24px; z-index:9999;
      background:var(--espresso); color:white;
      border-radius:16px; padding:16px 20px;
      box-shadow:0 8px 32px rgba(0,0,0,0.3);
      display:flex; align-items:center; gap:14px;
      max-width:340px; animation:slideToast 0.4s ease;
      border-left:4px solid var(--gold);
    ">
      <span class="material-icons-round" style="font-size:32px;color:var(--gold)">print</span>
      <div>
        <div style="font-weight:700;font-size:15px;margin-bottom:3px">
          🖨️ Imprimindo pedido...
        </div>
        <div style="font-size:13px;opacity:0.8">${pedido.cliente_nome}</div>
        <div style="font-size:12px;opacity:0.6">${pedido.codigo} · R$ ${Number(pedido.total).toFixed(2).replace('.',',')}</div>
      </div>
      <button onclick="this.closest('#toast-auto-print').remove()"
        style="background:none;border:none;color:rgba(255,255,255,0.5);cursor:pointer;margin-left:auto;font-size:20px;line-height:1">×</button>
    </div>`;

  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 6000);
}

async function checarNovosPagementos() {
  if (!document.getElementById('autoImpressaoToggle')?.checked) return;

  try {
    // Buscar pedidos pagos nos últimos 15 minutos
    const agora = new Date();
    const quinzeMinAtras = new Date(agora.getTime() - 15 * 60 * 1000);
    const dataHoje = agora.toISOString().split('T')[0];

    const res = await fetch(
      `/api/pedidos?pagamento_status=pago&incluir_dinheiro=true&data_inicio=${dataHoje}&data_fim=${dataHoje}&limit=50`,
      { headers: authHeaders() }
    );
    if (!res.ok) return;
    const pedidos = await res.json();
    if (!Array.isArray(pedidos)) return;

    // Filtrar: pagos recentemente E ainda não impressos
    const novos = pedidos.filter(p => {
      if (_jaImpressos.has(p.id)) return false;
      const atualizado = new Date(p.atualizado_em || p.criado_em);
      return atualizado >= quinzeMinAtras;
    });

    for (const pedido of novos) {
      marcarImpresso(pedido.id);

      // Buscar itens do pedido
      let pedidoCompleto = pedido;
      if (!pedido.itens || pedido.itens.length === 0) {
        try {
          const r2 = await fetch(`/api/pedidos/${pedido.id}`, { headers: authHeaders() });
          if (r2.ok) pedidoCompleto = await r2.json();
        } catch(e) {}
      }

      tocarSomNotificacao();
      mostrarToastPedido(pedidoCompleto);

      // Pequeno delay entre impressões se houver vários pedidos
      await new Promise(r => setTimeout(r, 800));
      imprimirPedido(pedidoCompleto);
    }
  } catch(e) {
    console.warn('[Monitor impressão] Erro:', e.message);
  }
}

function iniciarMonitorImpressao() {
  // Checar a cada 8 segundos
  setInterval(checarNovosPagementos, 8000);
  console.log('[Monitor impressão] Iniciado — verificando a cada 8s');
}


// ════════════════════════════════════════════════════════════
// GERENCIAR CATEGORIAS
// ════════════════════════════════════════════════════════════

function abrirModalCategoria() {
  const modal = new bootstrap.Modal(document.getElementById('modalCategorias'));
  modal.show();
  carregarListaCategorias();
}

async function carregarListaCategorias() {
  const lista = document.getElementById('listaCategorias');
  lista.innerHTML = '<div class="loading-rows"><div class="loading-row"></div><div class="loading-row"></div></div>';
  try {
    const res  = await fetch('/api/categorias', { headers: authHeaders() });
    const cats = await res.json();
    if (!cats.length) {
      lista.innerHTML = '<div class="empty-state py-3"><span class="material-icons-round">category</span><p>Nenhuma categoria</p></div>';
      return;
    }
    lista.innerHTML = cats.map(c => `
      <div class="cat-item ${c.ativo ? '' : 'inativo'}" id="cat-item-${c.id}">
        <div class="cat-item-icon">
          <span class="material-icons-round">${c.icone || 'restaurant'}</span>
        </div>
        <div class="cat-item-info">
          <div class="cat-item-nome">${c.nome}</div>
          <div class="cat-item-sub">Ordem ${c.ordem}</div>
        </div>
        <div class="cat-item-actions">
          <button class="btn-icon" onclick="editarCategoria(${c.id}, '${c.nome.replace(/'/g,"\'")}', '${c.icone}')" title="Editar">
            <span class="material-icons-round">edit</span>
          </button>
          <button class="btn-icon" onclick="toggleCategoriaAtivo(${c.id}, ${c.ativo})" title="${c.ativo ? 'Ocultar' : 'Exibir'}">
            <span class="material-icons-round">${c.ativo ? 'visibility_off' : 'visibility'}</span>
          </button>
          <button class="btn-icon danger" onclick="removerCategoria(${c.id}, '${c.nome.replace(/'/g,"\'")}');" title="Remover">
            <span class="material-icons-round">delete_outline</span>
          </button>
        </div>
      </div>`).join('');
  } catch(e) {
    lista.innerHTML = '<div class="empty-state py-3"><p class="text-danger">Erro ao carregar categorias</p></div>';
  }
}

async function criarCategoria() {
  const nome  = document.getElementById('novaCatNome')?.value.trim();
  const icone = document.getElementById('novaCatIcone')?.value || 'restaurant';
  if (!nome) {
    document.getElementById('novaCatNome').style.borderColor = '#dc3545';
    document.getElementById('novaCatNome').focus();
    return;
  }
  document.getElementById('novaCatNome').style.borderColor = '';
  try {
    const res = await fetch('/api/categorias', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ nome, icone })
    });
    const data = await res.json();
    if (data.sucesso) {
      document.getElementById('novaCatNome').value = '';
      carregarListaCategorias();
      carregarProdutos(); // Atualizar lista de produtos também
    } else {
      alert('Erro: ' + data.erro);
    }
  } catch(e) { alert('Erro ao criar categoria'); }
}

function editarCategoria(id, nome, icone) {
  document.getElementById('editCatId').value  = id;
  document.getElementById('editCatNome').value = nome;
  document.getElementById('editCatIcone').value = icone;
  new bootstrap.Modal(document.getElementById('modalEditarCategoria')).show();
}

async function salvarEdicaoCategoria() {
  const id    = document.getElementById('editCatId').value;
  const nome  = document.getElementById('editCatNome').value.trim();
  const icone = document.getElementById('editCatIcone').value;
  if (!nome) return;
  try {
    await fetch(`/api/categorias/${id}`, {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ nome, icone })
    });
    bootstrap.Modal.getInstance(document.getElementById('modalEditarCategoria')).hide();
    carregarListaCategorias();
    carregarProdutos();
  } catch(e) { alert('Erro ao salvar'); }
}

async function toggleCategoriaAtivo(id, ativo) {
  try {
    await fetch(`/api/categorias/${id}`, {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ ativo: !ativo })
    });
    carregarListaCategorias();
    carregarProdutos();
  } catch(e) { alert('Erro ao alterar visibilidade'); }
}

async function removerCategoria(id, nome) {
  if (!confirm(`Remover a categoria "${nome}"?\n\nAtenção: só é possível remover categorias sem produtos ativos.`)) return;
  try {
    const res  = await fetch(`/api/categorias/${id}`, { method: 'DELETE', headers: authHeaders() });
    const data = await res.json();
    if (data.sucesso) {
      carregarListaCategorias();
      carregarProdutos();
    } else {
      alert('Não é possível remover:\n' + data.erro);
    }
  } catch(e) { alert('Erro ao remover categoria'); }
}

// ===== PRODUTOS =====
async function carregarProdutos() {
  const lista = document.getElementById('produtosLista');
  lista.innerHTML = `<div class="section-card"><div class="loading-rows"><div class="loading-row"></div></div></div>`;
  try {
    const res = await fetch('/api/cardapio');
    cardapioCache = await res.json();
    lista.innerHTML = '';
    cardapioCache.categorias.forEach(cat => {
      // Mostrar todas as categorias, mesmo as sem produtos
      const section = document.createElement('div');
      section.className = 'section-card mb-4';
      section.innerHTML = `
        <div class="section-card-header">
          <h3><span class="material-icons-round">${cat.icone||'restaurant'}</span>${cat.nome}</h3>
        </div>
        ${!cat.produtos?.length ? `
          <div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px">
            <span class="material-icons-round" style="font-size:36px;opacity:0.3;display:block;margin-bottom:8px">inventory_2</span>
            Nenhum produto nesta categoria.
            <button onclick="abrirModalProduto()" style="display:block;margin:8px auto 0;background:none;border:none;color:var(--gold);font-size:13px;cursor:pointer;text-decoration:underline">+ Adicionar produto</button>
          </div>` : cat.produtos.map(p => `
          <div class="produto-linha">
            <div class="prod-icon" style="overflow:hidden;border-radius:10px">
              ${p.imagem
                ? `<img src="${p.imagem}" alt="${p.nome}" style="width:44px;height:44px;object-fit:cover;border-radius:10px" onerror="this.style.display='none'">`
                : '<span class=\"material-icons-round\">lunch_dining</span>'}
            </div>
            <div class="prod-info">
              <div class="prod-nome">${p.nome} ${p.destaque?'⭐':''}</div>
              <div class="prod-cat">${p.descricao||'—'}</div>
            </div>
            <div class="prod-preco">R$ ${Number(p.preco).toFixed(2).replace('.', ',')}</div>
            <div class="prod-actions">
              <button class="btn-icon" onclick='editarProduto(${JSON.stringify(p)})' title="Editar"><span class="material-icons-round">edit</span></button>
              <button class="btn-icon danger" onclick="removerProduto(${p.id})" title="Remover"><span class="material-icons-round">delete_outline</span></button>
            </div>
          </div>`).join('')}`;
      lista.appendChild(section);
    });
  } catch(e) {
    lista.innerHTML = `<div class="section-card"><div class="empty-state"><p>Erro ao carregar</p></div></div>`;
  }
}

function abrirModalProduto() {
  document.getElementById('produtoId').value = '';
  document.getElementById('produtoNome').value = '';
  document.getElementById('produtoDescricao').value = '';
  document.getElementById('produtoPreco').value = '';
  document.getElementById('produtoDisponivel').checked = true;
  document.getElementById('produtoDestaque').checked = false;
  document.getElementById('produtoImagemUrl').value = '';
  document.getElementById('produtoImagemUrlInput').value = '';
  document.getElementById('imgPreviewWrap').style.display = 'none';
  document.getElementById('imgUploadLabel').textContent = 'Clique para escolher uma imagem';
  document.getElementById('modalProdutoTitulo').innerHTML = '<span class="material-icons-round">add_circle</span> Novo Produto';
  preencherSelectCategorias();
  new bootstrap.Modal(document.getElementById('modalProduto')).show();
}

function editarProduto(prod) {
  document.getElementById('produtoId').value = prod.id;
  document.getElementById('produtoNome').value = prod.nome;
  document.getElementById('produtoDescricao').value = prod.descricao || '';
  document.getElementById('produtoPreco').value = prod.preco;
  document.getElementById('produtoDisponivel').checked = prod.disponivel;
  document.getElementById('produtoDestaque').checked = prod.destaque;
  // Imagem
  const imgUrl = prod.imagem || '';
  document.getElementById('produtoImagemUrl').value = imgUrl;
  document.getElementById('produtoImagemUrlInput').value = imgUrl;
  if (imgUrl) {
    document.getElementById('imgPreview').src = imgUrl;
    document.getElementById('imgPreviewWrap').style.display = 'block';
    document.getElementById('imgUploadLabel').textContent = 'Trocar imagem';
  } else {
    document.getElementById('imgPreviewWrap').style.display = 'none';
    document.getElementById('imgUploadLabel').textContent = 'Clique para escolher uma imagem';
  }
  document.getElementById('modalProdutoTitulo').innerHTML = '<span class="material-icons-round">edit</span> Editar Produto';
  preencherSelectCategorias(prod.categoria_id);
  new bootstrap.Modal(document.getElementById('modalProduto')).show();
}

function preencherSelectCategorias(selectedId = null) {
  const sel = document.getElementById('produtoCategoria');
  sel.innerHTML = '<option value="">— Selecionar —</option>';
  (cardapioCache?.categorias || []).forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id; opt.textContent = c.nome;
    if (c.id == selectedId) opt.selected = true;
    sel.appendChild(opt);
  });
}

async function salvarProduto() {
  const id = document.getElementById('produtoId').value;
  const nome = document.getElementById('produtoNome').value.trim();
  const preco = parseFloat(document.getElementById('produtoPreco').value);
  if (!nome || isNaN(preco)) { alert('Preencha nome e preço'); return; }

  const payload = { nome, descricao: document.getElementById('produtoDescricao').value, preco,
    categoria_id: document.getElementById('produtoCategoria').value || null,
    disponivel: document.getElementById('produtoDisponivel').checked,
    destaque: document.getElementById('produtoDestaque').checked,
    imagem: document.getElementById('produtoImagemUrl').value || null };

  try {
    const res = id
      ? await fetch(`/api/cardapio/produtos/${id}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(payload) })
      : await fetch('/api/cardapio/produtos', { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
    const data = await res.json();
    if (data.sucesso || data.id) {
      bootstrap.Modal.getInstance(document.getElementById('modalProduto')).hide();
      carregarProdutos();
    }
  } catch(e) { alert('Erro ao salvar produto'); }
}

async function removerProduto(id) {
  if (!confirm('Remover este produto do cardápio?')) return;
  await fetch(`/api/cardapio/produtos/${id}`, { method: 'DELETE', headers: authHeaders() });
  carregarProdutos();
}

// ===== HELPERS =====
const traduzirTipoEntrega = t => ({ local:'🍽️ Local', retirada:'🛍️ Retirada', delivery:'🛵 Delivery' }[t] || t || 'Local');
const traduzirStatus = s => ({ pendente:'Pendente', confirmado:'Confirmado', preparando:'Preparando', pronto:'Pronto', entregue:'Entregue', cancelado:'Cancelado' }[s] || s);
const traduzirPagamento = s => ({ aguardando:'💳 Aguardando', dinheiro:'💵 Dinheiro', pago:'✅ Pago', cancelado:'❌ Cancelado' }[s] || s);
const traduzirMetodo = m => ({ pix:'PIX', cartao:'Cartão', dinheiro:'Dinheiro', credit_card:'Cartão', debit_card:'Débito', account_money:'MP' }[m] || m || '—');

async function fazerLogout() {
  await fetch('/auth/logout', { method: 'POST' });
  localStorage.removeItem('admin_token');
  window.location.href = '/login';
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('show');
  document.getElementById('sidebarOverlay').classList.toggle('show');
}

// Atualiza o subtítulo da aba de pedidos conforme filtro selecionado
function atualizarSubtitle() {
  const val = document.getElementById('filtroPagamento')?.value || 'pago';
  const labels = { pago: 'Exibindo pedidos pagos e dinheiro', aguardando: 'Exibindo pedidos aguardando pagamento', cancelado: 'Exibindo pedidos cancelados' };
  const el = document.getElementById('pedidosSubtitle');
  if (el) el.textContent = labels[val] || '';
}

// ── Imagem helpers ────────────────────────────────────────────
function previewImagem(input) {
  const file = input.files[0];
  if (!file) return;

  // Validar tamanho (max 2MB)
  if (file.size > 2 * 1024 * 1024) {
    alert('Imagem muito grande. Use uma imagem menor que 2MB ou cole uma URL.');
    input.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const base64 = e.target.result;
    document.getElementById('produtoImagemUrl').value = base64;
    document.getElementById('produtoImagemUrlInput').value = '';
    document.getElementById('imgPreview').src = base64;
    document.getElementById('imgPreviewWrap').style.display = 'block';
    document.getElementById('imgUploadLabel').textContent = file.name;
  };
  reader.readAsDataURL(file);
}

function usarUrlImagem(url) {
  document.getElementById('produtoImagemUrl').value = url;
  if (url && (url.startsWith('http') || url.startsWith('/'))) {
    document.getElementById('imgPreview').src = url;
    document.getElementById('imgPreviewWrap').style.display = 'block';
  } else {
    document.getElementById('imgPreviewWrap').style.display = 'none';
  }
}
