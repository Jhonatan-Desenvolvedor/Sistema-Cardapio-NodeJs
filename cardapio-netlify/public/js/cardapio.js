// ─── Estado global ───────────────────────────────────────────
let carrinho = JSON.parse(localStorage.getItem('carrinho') || '[]');
let cardapioData = null;
let lojaAberta = true;
let entregaConfig = {};     // configurações de entrega
let taxaEntregaAtual = 0;   // taxa calculada para o endereço atual
let distanciaAtual = 0;     // km calculado
let tipoEntregaAtual = 'local';

// ─── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  carregarCardapio();
  verificarStatusLoja();
  carregarConfigEntrega();
  atualizarBadge();

  // Selecionar forma de pagamento
  document.querySelectorAll('.payment-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.payment-opt').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      opt.querySelector('input').checked = true;
    });
  });

  // Selecionar tipo de entrega
  document.querySelectorAll('[name="tipoEntrega"]').forEach(r => {
    r.addEventListener('change', () => mudarTipoEntrega(r.value));
  });

  // Resetar modal ao fechar (garante estado limpo para próxima abertura)
  const modalEl = document.getElementById('modalCheckout');
  if (modalEl) {
    modalEl.addEventListener('hidden.bs.modal', () => {
      resetarModal();
    });
  }

  // Retorno do Mercado Pago (back_url)
  const params = new URLSearchParams(window.location.search);
  const retornoStatus = params.get('status');
  const retornoCodigo = params.get('codigo');
  if (retornoStatus && retornoCodigo) {
    window.history.replaceState({}, '', '/');
    atualizarStatusPorRetornoMP(retornoStatus, retornoCodigo);
  }
});

// ─── Cardápio ─────────────────────────────────────────────────
async function carregarCardapio() {
  try {
    const res = await fetch('/api/cardapio');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    cardapioData = await res.json();
    renderizarCardapio(cardapioData.categorias);
    renderizarPills(cardapioData.categorias);
    document.getElementById('loadingState').style.display = 'none';
  } catch(e) {
    document.getElementById('loadingState').innerHTML = `
      <span class="material-icons-round" style="font-size:48px;color:#ccc">error_outline</span>
      <p class="text-muted mt-2">Erro ao carregar cardápio.<br><small>${e.message}</small></p>
      <button onclick="carregarCardapio()" style="margin-top:12px;padding:8px 20px;border-radius:8px;border:none;background:#C8973A;color:white;cursor:pointer">Tentar novamente</button>`;
  }
}

function renderizarPills(categorias) {
  const inner = document.getElementById('catPillsInner');
  categorias.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'cat-pill';
    btn.dataset.cat = cat.id;
    btn.innerHTML = `<span class="material-icons-round">${cat.icone || 'restaurant'}</span> ${cat.nome}`;
    btn.addEventListener('click', () => filtrarCategoria(cat.id, btn));
    inner.appendChild(btn);
  });
  document.querySelector('[data-cat="all"]').addEventListener('click', function() {
    filtrarCategoria('all', this);
  });
}

function filtrarCategoria(catId, btn) {
  document.querySelectorAll('.cat-pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.categoria-section').forEach(sec => {
    sec.style.display = (catId === 'all' || sec.dataset.catId == catId) ? '' : 'none';
  });
  if (catId !== 'all') {
    document.querySelector(`[data-cat-id="${catId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function renderizarCardapio(categorias) {
  const content = document.getElementById('cardapioContent');
  content.innerHTML = '';
  categorias.forEach(cat => {
    if (!cat.produtos?.length) return;
    const section = document.createElement('div');
    section.className = 'categoria-section';
    section.dataset.catId = cat.id;
    section.innerHTML = `
      <div class="section-title">
        <div class="cat-icon"><span class="material-icons-round">${cat.icone || 'restaurant'}</span></div>
        <h2>${cat.nome}</h2>
      </div>
      <div class="produtos-grid">${cat.produtos.map(renderProdutoCard).join('')}</div>`;
    content.appendChild(section);
  });
}

function renderProdutoCard(produto) {
  const temImagem = produto.imagem && produto.imagem.trim() !== '';
  const imgHtml = temImagem
    ? `<img src="${produto.imagem}" alt="${produto.nome}" loading="lazy"
          onerror="this.style.display='none';this.parentElement.querySelector('.img-placeholder').style.display='flex'">`
    : '';
  const placeholderStyle = temImagem ? 'display:none' : '';

  return `
    <div class="produto-card" onclick="adicionarAoCarrinho(${produto.id})">
      ${produto.destaque ? '<div class="destaque-badge">✦ Destaque</div>' : ''}
      <div class="produto-img-wrap">
        ${imgHtml}
        <div class="img-placeholder" style="${placeholderStyle}">
          <span class="material-icons-round">lunch_dining</span>
        </div>
      </div>
      <div class="produto-body">
        <div class="produto-nome">${produto.nome}</div>
        ${produto.descricao ? `<div class="produto-desc">${produto.descricao}</div>` : ''}
        <div class="produto-footer">
          <div class="produto-preco"><small>R$</small> ${Number(produto.preco).toFixed(2).replace('.', ',')}</div>
          <button class="btn-add" onclick="event.stopPropagation();adicionarAoCarrinho(${produto.id})">
            <span class="material-icons-round">add</span>
          </button>
        </div>
      </div>
    </div>`;
}

// ─── Carrinho ─────────────────────────────────────────────────
function adicionarAoCarrinho(produtoId) {
  if (!lojaAberta) {
    mostrarBannerFechado();
    return;
  }
  let produto = null;
  for (const cat of (cardapioData?.categorias || [])) {
    produto = cat.produtos?.find(p => p.id == produtoId);
    if (produto) break;
  }
  if (!produto) return;

  const item = carrinho.find(i => i.produto_id == produtoId);
  if (item) item.quantidade++;
  else carrinho.push({ produto_id: produto.id, nome: produto.nome, preco: Number(produto.preco), quantidade: 1 });

  salvarCarrinho();
  atualizarBadge();
  renderizarCarrinho();
  animarBtnCarrinho();
}

function removerDoCarrinho(produtoId) {
  const idx = carrinho.findIndex(i => i.produto_id == produtoId);
  if (idx === -1) return;
  if (carrinho[idx].quantidade > 1) carrinho[idx].quantidade--;
  else carrinho.splice(idx, 1);
  salvarCarrinho(); atualizarBadge(); renderizarCarrinho();
}

function limparCarrinho() { carrinho = []; salvarCarrinho(); atualizarBadge(); renderizarCarrinho(); }
function salvarCarrinho() { localStorage.setItem('carrinho', JSON.stringify(carrinho)); }

function atualizarBadge() {
  const total = carrinho.reduce((s, i) => s + i.quantidade, 0);
  const badge = document.getElementById('badgeCarrinho');
  badge.textContent = total;
  badge.style.transform = 'scale(1.4)';
  setTimeout(() => badge.style.transform = 'scale(1)', 200);
}

function animarBtnCarrinho() {
  const btn = document.querySelector('.btn-carrinho');
  btn.style.transform = 'scale(1.2)'; btn.style.background = '#C8973A';
  setTimeout(() => { btn.style.transform = ''; btn.style.background = ''; }, 300);
}

function calcularTotais() {
  const subtotal = carrinho.reduce((s, i) => s + (i.preco * i.quantidade), 0);
  const entrega  = (tipoEntregaAtual === 'delivery' && taxaEntregaAtual > 0) ? taxaEntregaAtual : 0;
  return { subtotal, entrega, total: subtotal + entrega };
}

function renderizarCarrinho() {
  const itensEl = document.getElementById('carrinhoItens');
  const footerEl = document.getElementById('carrinhoFooter');
  if (!carrinho.length) {
    itensEl.innerHTML = `<div class="carrinho-vazio">
      <span class="material-icons-round">shopping_bag</span>
      <p>Seu carrinho está vazio</p><small>Adicione itens do cardápio</small></div>`;
    footerEl.style.display = 'none'; return;
  }
  itensEl.innerHTML = carrinho.map(item => `
    <div class="item-carrinho">
      <div class="item-carrinho-info">
        <div class="item-carrinho-nome">${item.nome}</div>
        <div class="item-carrinho-preco">R$ ${(item.preco * item.quantidade).toFixed(2).replace('.', ',')}</div>
      </div>
      <div class="item-qtd-ctrl">
        <button class="btn-qtd" onclick="removerDoCarrinho(${item.produto_id})">−</button>
        <span class="qtd-num">${item.quantidade}</span>
        <button class="btn-qtd" onclick="adicionarAoCarrinho(${item.produto_id})">+</button>
      </div>
    </div>`).join('');
  const { subtotal, entrega, total } = calcularTotais();
  document.getElementById('subtotalValor').textContent = `R$ ${subtotal.toFixed(2).replace('.', ',')}`;
  document.getElementById('totalValor').textContent    = `R$ ${total.toFixed(2).replace('.', ',')}`;
  footerEl.style.display = 'block';
}

function abrirCarrinho() {
  if (!lojaAberta) {
    mostrarBannerFechado();
    return;
  }
  renderizarCarrinho();
  document.getElementById('carrinhoSidebar').classList.add('show');
  document.getElementById('carrinhoOverlay').classList.add('show');
  document.body.style.overflow = 'hidden';
}
function fecharCarrinho() {
  document.getElementById('carrinhoSidebar').classList.remove('show');
  document.getElementById('carrinhoOverlay').classList.remove('show');
  document.body.style.overflow = '';
}

// ─── Checkout ─────────────────────────────────────────────────

// ── Erros de formulário de entrega ───────────────────────────
function mostrarErroEntrega(campoId, mensagem) {
  const el = document.getElementById(campoId);
  if (!el) return;
  el.style.borderColor = '#dc3545';
  el.style.boxShadow   = '0 0 0 3px rgba(220,53,69,0.15)';
  // Remover erro anterior
  document.getElementById('erro-' + campoId)?.remove();
  const err = document.createElement('div');
  err.id = 'erro-' + campoId;
  err.style.cssText = 'color:#dc3545;font-size:12px;margin-top:5px;display:flex;align-items:center;gap:4px';
  err.innerHTML = '<span class="material-icons-round" style="font-size:15px">error</span>' + mensagem;
  el.parentElement.appendChild(err);
  // Auto-remover ao focar no campo
  el.addEventListener('focus', () => limparErroEntrega(campoId), { once: true });
}

function limparErroEntrega(campoId) {
  const el = document.getElementById(campoId);
  if (el) { el.style.borderColor = ''; el.style.boxShadow = ''; }
  document.getElementById('erro-' + campoId)?.remove();
}
function abrirCheckout() {
  if (!carrinho.length) return;
  fecharCarrinho();
  resetarModal();
  aplicarOpcoesEntregaNoModal();
  new bootstrap.Modal(document.getElementById('modalCheckout')).show();
  atualizarResumoCheckout();
}

function resetarModal() {
  // Reset estado global
  tipoEntregaAtual         = 'local';
  taxaEntregaAtual         = 0;
  distanciaAtual           = 0;
  _enderecoSelecionadoData = null;
  clearTimeout(_debounceTimer);
  clearTimeout(_debounceNumero);

  // Reset seleção de tipo de entrega — voltar para "local"
  document.querySelectorAll('.tipo-opt').forEach(o => o.classList.remove('active'));
  const optLocal = document.getElementById('optLocal');
  if (optLocal) optLocal.classList.add('active');
  const radioLocal = document.querySelector('[name="tipoEntrega"][value="local"]');
  if (radioLocal) radioLocal.checked = true;

  // Ocultar campos de entrega e restaurar campo mesa
  const campoMesa    = document.getElementById('campoMesa');
  const campoEntrega = document.getElementById('campoEntrega');
  const ckEntregaRow = document.getElementById('ckEntregaRow');
  if (campoMesa)    campoMesa.style.display    = '';
  if (campoEntrega) campoEntrega.style.display = 'none';
  if (ckEntregaRow) ckEntregaRow.style.display = 'none';

  // Limpar campos de endereço
  const campos = ['buscaEnderecoEntrega','ruaEntrega','bairroEntrega',
                  'cepEntrega','latEntrega','lngEntrega','numeroEntrega','complementoEntrega'];
  campos.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  // Ocultar endereço selecionado e sugestões
  const endSel = document.getElementById('enderecoSelecionado');
  const sugest = document.getElementById('sugestoesEntrega');
  const preview = document.getElementById('taxaEntregaPreview');
  if (endSel)  endSel.style.display   = 'none';
  if (sugest)  sugest.style.display   = 'none';
  if (preview) preview.style.display  = 'none';

  // Limpar erros visuais
  ['buscaEnderecoEntrega','numeroEntrega','ruaEntrega'].forEach(limparErroEntrega);
}

function aplicarOpcoesEntregaNoModal() {
  const optRetirada = document.getElementById('optRetirada');
  const optDelivery = document.getElementById('optDelivery');
  if (optRetirada) optRetirada.style.display = entregaConfig.retirada_ativa === 'false' ? 'none' : '';
  if (optDelivery) optDelivery.style.display  = entregaConfig.entrega_ativa  === 'false' ? 'none' : '';
}

async function confirmarPedido() {
  const nome = document.getElementById('clienteNome').value.trim();
  const telefone = document.getElementById('clienteTelefone').value.trim();
  if (!nome) {
    document.getElementById('clienteNome').style.borderColor = '#dc3545';
    document.getElementById('clienteNome').focus();
    return;
  }
  document.getElementById('clienteNome').style.borderColor = '';

  if (!telefone) {
    document.getElementById('clienteTelefone').style.borderColor = '#dc3545';
    document.getElementById('clienteTelefone').focus();
    return;
  }
  const telefoneLimpo = telefone.replace(/\D/g, '');
  if (telefoneLimpo.length < 10) {
    document.getElementById('clienteTelefone').style.borderColor = '#dc3545';
    document.getElementById('clienteTelefone').focus();
    alert('Informe um telefone válido com DDD.');
    return;
  }
  document.getElementById('clienteTelefone').style.borderColor = '';

  // Validar endereço se delivery
  if (tipoEntregaAtual === 'delivery') {
    const rua    = document.getElementById('ruaEntrega').value.trim();
    const numero = document.getElementById('numeroEntrega')?.value.trim() || '';
    const lat    = document.getElementById('latEntrega')?.value;

    // Rua obrigatória — verificar se selecionou da lista
    if (!rua) {
      mostrarErroEntrega('buscaEnderecoEntrega', 'Selecione um endereço da lista de sugestões.');
      document.getElementById('buscaEnderecoEntrega')?.focus();
      return;
    }

    // Número obrigatório
    if (!numero) {
      mostrarErroEntrega('numeroEntrega', 'O número da casa é obrigatório.');
      document.getElementById('numeroEntrega')?.focus();
      return;
    }

    // Verificar se endereço foi geocodificado (tem coords)
    if (!lat) {
      mostrarErroEntrega('buscaEnderecoEntrega', 'Selecione um endereço válido da lista de sugestões.');
      return;
    }

    if (taxaEntregaAtual === null) {
      mostrarErroEntrega('buscaEnderecoEntrega', 'Endereço fora da área de entrega. Escolha retirada ou outro endereço.');
      return;
    }
    // Verificar pedido mínimo
    const { subtotal } = calcularTotais();
    const minimo = parseFloat(entregaConfig.pedido_minimo_entrega || 0);
    if (minimo > 0 && subtotal < minimo) {
      alert(`Pedido mínimo para entrega é R$ ${minimo.toFixed(2).replace('.',',')}. Seu subtotal é R$ ${subtotal.toFixed(2).replace('.',',')}.`);
      return;
    }
  }

  const pagamento = document.querySelector('[name="pagamento"]:checked')?.value || 'pix';
  const pagarOnline = (pagamento === 'pix' || pagamento === 'cartao');

  const ruaVal    = document.getElementById('ruaEntrega').value.trim();
  const numeroVal = document.getElementById('numeroEntrega')?.value.trim() || '';
  const compVal   = document.getElementById('complementoEntrega')?.value.trim() || '';
  // Montar endereço completo: Rua X, Número, Complemento
  const ruaSemNum   = ruaVal.replace(/,?\s*\d+$/, '').trim();
  const enderecoCompleto = tipoEntregaAtual === 'delivery'
    ? [ruaSemNum, numeroVal, compVal].filter(Boolean).join(', ')
    : null;

  const payload = {
    cliente_nome: nome,
    cliente_telefone: telefone,
    mesa: tipoEntregaAtual === 'local' ? document.getElementById('clienteMesa').value : '',
    observacoes: document.getElementById('observacoes').value,
    pagamento_metodo: pagamento,
    tipo: tipoEntregaAtual,
    tipo_entrega: tipoEntregaAtual,
    endereco_entrega: enderecoCompleto,
    bairro_entrega: tipoEntregaAtual === 'delivery' ? document.getElementById('bairroEntrega').value : null,
    cep_entrega: tipoEntregaAtual === 'delivery' ? document.getElementById('cepEntrega').value : null,
    distancia_km: parseFloat(document.getElementById('latEntrega')?.value ? distanciaAtual : 0),
    taxa_entrega: tipoEntregaAtual === 'delivery' ? (taxaEntregaAtual || 0) : 0,
    itens: carrinho.map(i => ({ produto_id: i.produto_id, quantidade: i.quantidade }))
  };

  // Atualizar botão para loading
  const btn = document.querySelector('.modal-footer .btn-finalizar');
  const textoOriginal = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="material-icons-round spin">hourglass_top</span> ${pagarOnline ? 'Gerando link de pagamento...' : 'Confirmando pedido...'}`;

  try {
    const res = await fetch('/api/pedidos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (!data.sucesso) {
      alert('Erro ao criar pedido: ' + (data.erro || 'Tente novamente'));
      return;
    }

    // Fechar modal do checkout
    bootstrap.Modal.getInstance(document.getElementById('modalCheckout')).hide();
    limparCarrinho();

    // ── Decisão de roteamento pós-pedido ──────────────────────
    if (pagarOnline && data.mercadopago?.init_point) {
      // Tem link MP → redirecionar direto (sem mostrar modal antes)
      window.location.href = data.mercadopago.init_point;

    } else if (pagarOnline && !data.mercadopago?.init_point) {
      // Queria pagar online mas MP não está configurado → mostrar aviso
      setTimeout(() => mostrarConfirmacaoPedido(data.pedido.codigo, pagamento, false), 400);

    } else {
      // Dinheiro → mostrar confirmação simples
      setTimeout(() => mostrarConfirmacaoPedido(data.pedido.codigo, pagamento, false), 400);
    }

  } catch(e) {
    alert('Erro de conexão. Verifique sua internet e tente novamente.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = textoOriginal;
  }
}

// Modal de confirmação (para dinheiro ou quando MP não está configurado)
function mostrarConfirmacaoPedido(codigo, metodoPagamento, temMP) {
  const iconePag = metodoPagamento === 'dinheiro' ? 'payments' : 'credit_card';
  const msgPag = metodoPagamento === 'dinheiro'
    ? 'Seu pedido foi recebido! Realize o pagamento em dinheiro ao garçom.'
    : 'Seu pedido foi recebido! O pagamento será solicitado em breve.';

  document.getElementById('codigoPedido').textContent = codigo;
  document.getElementById('sucessoMsg').textContent = msgPag;
  document.getElementById('mpButton').innerHTML = '';

  new bootstrap.Modal(document.getElementById('modalSucesso')).show();
}

// Retorno do Mercado Pago (back_url) — atualiza status via API e mostra modal
async function atualizarStatusPorRetornoMP(status, codigo) {
  const aprovado = status === 'aprovado';
  const pendente  = status === 'pendente';
  const falhou    = status === 'falhou';

  // Atualizar status no banco via API
  if (aprovado || pendente || falhou) {
    try {
      await fetch(`/api/pedidos/codigo/${codigo}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pagamento_status: aprovado ? 'pago' : falhou ? 'cancelado' : 'aguardando',
          status:           aprovado ? 'confirmado' : falhou ? 'cancelado' : 'pendente'
        })
      });
      console.log(`[MP Retorno] Pedido ${codigo} atualizado: ${status}`);
    } catch(e) {
      console.warn('[MP Retorno] Falha ao atualizar status:', e.message);
    }
  }

  // Mostrar modal de resultado
  document.getElementById('codigoPedido').textContent = codigo;
  document.getElementById('mpButton').innerHTML = '';

  if (aprovado) {
    document.getElementById('sucessoMsg').textContent = '✅ Pagamento aprovado! Seu pedido está confirmado.';
  } else if (pendente) {
    document.getElementById('sucessoMsg').textContent = '⏳ Pagamento em análise. Confirmaremos em breve.';
  } else {
    document.getElementById('sucessoMsg').textContent = '❌ Pagamento não concluído. Tente novamente.';
  }

  new bootstrap.Modal(document.getElementById('modalSucesso')).show();
}

// CSS de animação
const style = document.createElement('style');
style.textContent = '.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}';
document.head.appendChild(style);

// ─── Status da Loja ──────────────────────────────────────────
async function verificarStatusLoja() {
  try {
    const res = await fetch('/api/config/loja');
    if (!res.ok) return;
    const data = await res.json();
    lojaAberta = data.aberto;
    aplicarEstadoLoja(data.aberto);
  } catch(e) {
    console.warn('[Loja] Erro ao verificar status:', e.message);
  }
}

function aplicarEstadoLoja(aberta) {
  lojaAberta = aberta;

  // Banner de loja fechada no topo
  document.getElementById('bannerFechado')?.remove();
  if (!aberta) {
    const banner = document.createElement('div');
    banner.id = 'bannerFechado';
    banner.innerHTML = `
      <div style="
        background:linear-gradient(135deg,#2C1A0E,#4A1010);
        color:white;text-align:center;
        padding:14px 20px;
        position:sticky;top:64px;z-index:150;
        display:flex;align-items:center;justify-content:center;gap:10px;
        font-family:'DM Sans',sans-serif;font-size:15px;font-weight:500;
        border-bottom:2px solid rgba(239,68,68,0.4);
      ">
        <span class="material-icons-round" style="color:#ef4444;font-size:22px">store_mall_directory</span>
        <span>🔴 Estamos fechados no momento. Voltamos em breve!</span>
      </div>`;
    const catPills = document.getElementById('catPills');
    if (catPills) catPills.after(banner);
    else document.getElementById('cardapio')?.before(banner);
  }

  // Estilo dos botões de adicionar e carrinho
  const btnCarrinho = document.querySelector('.btn-carrinho');
  if (btnCarrinho) {
    btnCarrinho.style.opacity   = aberta ? '' : '0.45';
    btnCarrinho.style.filter    = aberta ? '' : 'grayscale(1)';
    btnCarrinho.title           = aberta ? '' : 'Loja fechada';
  }

  // Escurecer botões + na grid de produtos (serão recriados, ok via CSS)
  document.documentElement.style.setProperty(
    '--btn-add-opacity', aberta ? '1' : '0.35'
  );
  document.documentElement.style.setProperty(
    '--btn-add-cursor', aberta ? 'pointer' : 'not-allowed'
  );
  document.documentElement.style.setProperty(
    '--card-cursor', aberta ? 'pointer' : 'default'
  );
}

function mostrarBannerFechado() {
  // Modal de loja fechada
  document.getElementById('modalLojaFechada')?.remove();

  const el = document.createElement('div');
  el.id = 'modalLojaFechada';
  el.innerHTML = `
    <div style="
      position:fixed;inset:0;background:rgba(0,0,0,0.6);
      z-index:1500;display:flex;align-items:center;justify-content:center;
      backdrop-filter:blur(4px);animation:fadeIn .2s ease;
    " onclick="this.parentElement.remove()">
      <div style="
        background:#FBF8F2;border-radius:24px;padding:40px 36px;
        text-align:center;max-width:360px;width:90%;
        box-shadow:0 20px 60px rgba(0,0,0,0.25);
        animation:popIn .3s cubic-bezier(.175,.885,.32,1.275);
      " onclick="event.stopPropagation()">
        <div style="
          width:80px;height:80px;background:linear-gradient(135deg,#fee2e2,#fecaca);
          border-radius:50%;display:flex;align-items:center;justify-content:center;
          margin:0 auto 20px;
        ">
          <span class="material-icons-round" style="font-size:40px;color:#ef4444">store_mall_directory</span>
        </div>
        <h3 style="font-family:'Playfair Display',serif;font-size:24px;font-weight:700;color:#2C1A0E;margin-bottom:10px">
          Estamos Fechados
        </h3>
        <p style="color:#8B7355;font-size:15px;line-height:1.6;margin-bottom:24px">
          No momento não estamos aceitando pedidos.<br>Voltamos em breve!
        </p>
        <button onclick="document.getElementById('modalLojaFechada').remove()" style="
          background:linear-gradient(135deg,#2C1A0E,#4A2E1A);
          color:white;border:none;border-radius:14px;
          padding:14px 32px;font-family:'DM Sans',sans-serif;
          font-size:15px;font-weight:600;cursor:pointer;
          box-shadow:0 4px 20px rgba(44,26,14,0.25);
        ">Entendido</button>
      </div>
    </div>`;

  document.body.appendChild(el);

  // Auto-remover após 5s
  setTimeout(() => el.remove(), 5000);
}

// ─── Entrega / Retirada ───────────────────────────────────────

async function carregarConfigEntrega() {
  try {
    const res = await fetch('/api/config/entrega');
    if (res.ok) entregaConfig = await res.json();
  } catch(e) {}
}

function mudarTipoEntrega(tipo) {
  tipoEntregaAtual = tipo;
  taxaEntregaAtual = 0;
  distanciaAtual = 0;

  document.querySelectorAll('.tipo-opt').forEach(o => o.classList.remove('active'));
  const radio = document.querySelector(`[name="tipoEntrega"][value="${tipo}"]`);
  if (radio) radio.closest('.tipo-opt').classList.add('active');

  // Mostrar/ocultar campos
  const campoMesa    = document.getElementById('campoMesa');
  const campoEntrega = document.getElementById('campoEntrega');
  const ckEntregaRow = document.getElementById('ckEntregaRow');

  if (campoMesa)    campoMesa.style.display    = tipo === 'local' ? '' : 'none';
  if (campoEntrega) campoEntrega.style.display = tipo === 'delivery' ? '' : 'none';
  if (ckEntregaRow) ckEntregaRow.style.display = tipo === 'delivery' ? 'flex' : 'none';

  // Limpar preview de taxa
  const preview = document.getElementById('taxaEntregaPreview');
  if (preview) preview.style.display = 'none';

  atualizarResumoCheckout();
}

function atualizarResumoCheckout() {
  const subtotal   = carrinho.reduce((s, i) => s + (i.preco * i.quantidade), 0);
  const entrega    = (tipoEntregaAtual === 'delivery' && taxaEntregaAtual > 0) ? taxaEntregaAtual : 0;
  const totalFinal = subtotal + entrega;

  const fmt = v => `R$ ${Number(v).toFixed(2).replace('.',',')}`;
  const el  = id => document.getElementById(id);

  if (el('ckSubtotal')) el('ckSubtotal').textContent = fmt(subtotal);
  if (el('ckEntrega'))  el('ckEntrega').textContent  = entrega > 0 ? fmt(entrega) : 'Grátis';
  if (el('ckTotal'))    el('ckTotal').textContent    = fmt(totalFinal);
}

// ── Busca de Endereço ────────────────────────────────────────

let _debounceTimer = null;
let _enderecoSelecionadoData = null;

function debounceSearchEndereco(valor) {
  clearTimeout(_debounceTimer);
  const lista = document.getElementById('sugestoesEntrega');
  if (!valor || valor.length < 4) { if (lista) lista.style.display = 'none'; return; }
  lista.style.display = 'block';
  lista.innerHTML = '<div class="sugestoes-loading"><span class="material-icons-round spin" style="font-size:16px;vertical-align:middle">sync</span> Buscando...</div>';
  _debounceTimer = setTimeout(() => buscarEnderecoPorTexto(valor), 600);
}

async function buscarEnderecoPorTexto(texto) {
  const lista = document.getElementById('sugestoesEntrega');
  if (!lista) return;
  try {
    // Nominatim — busca por texto com countrycodes=br
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(texto)}&format=json&addressdetails=1&limit=6&countrycodes=br&accept-language=pt-BR`;
    const res  = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } });
    const data = await res.json();

    if (!data.length) {
      lista.innerHTML = '<div class="sugestoes-loading">Nenhum endereço encontrado. Tente ser mais específico.</div>';
      return;
    }

    lista.innerHTML = data.map((item, idx) => {
      const addr = item.address || {};
      const rua    = addr.road || addr.pedestrian || addr.footway || '';
      const numero = addr.house_number || '';
      const bairro = addr.suburb || addr.neighbourhood || addr.city_district || addr.quarter || '';
      const cidade = addr.city || addr.town || addr.municipality || '';
      const estado = addr.state_code || addr.state || '';
      const cep    = addr.postcode || '';

      const linhaP = [rua, numero].filter(Boolean).join(', ');
      const linhaS = [bairro, cidade, estado].filter(Boolean).join(' — ');

      return `<div class="sugestao-item" onclick="selecionarEndereco(${idx})">
        <span class="material-icons-round">location_on</span>
        <div>
          <div class="sugestao-item-texto">${linhaP || item.display_name.split(',')[0]}</div>
          <div class="sugestao-item-sub">${linhaS}${cep ? ' · CEP ' + cep : ''}</div>
        </div>
      </div>`;
    }).join('');

    // Guardar dados para uso no clique
    lista._resultados = data;
  } catch(e) {
    lista.innerHTML = '<div class="sugestoes-loading">Erro na busca. Verifique sua conexão.</div>';
  }
}

function selecionarEndereco(idx) {
  const lista = document.getElementById('sugestoesEntrega');
  const item  = lista._resultados?.[idx];
  if (!item) return;

  const addr   = item.address || {};
  const rua    = addr.road || addr.pedestrian || addr.footway || '';
  const bairro = addr.suburb || addr.neighbourhood || addr.city_district || addr.quarter || '';
  const cidade = addr.city || addr.town || addr.municipality || '';
  const estado = addr.state || addr.state_code || '';
  const cep    = (addr.postcode || '').replace(/[^0-9]/g,'');
  const lat    = parseFloat(item.lat);
  const lng    = parseFloat(item.lon);

  // Preencher campos ocultos com coords da rua (estimativa inicial)
  document.getElementById('ruaEntrega').value    = rua;
  document.getElementById('bairroEntrega').value = bairro;
  document.getElementById('cepEntrega').value    = cep ? cep.replace(/(\d{5})(\d{3})/, '$1-$2') : '';
  document.getElementById('latEntrega').value    = lat;
  document.getElementById('lngEntrega').value    = lng;

  // Guardar dados para geocodificação precisa com número
  _enderecoSelecionadoData = { rua, bairro, cidade, estado, cep, lat, lng };

  // Box de rua selecionada — pedindo número
  const linhaEnd = [rua, bairro, cidade].filter(Boolean).join(', ');
  const cepFmt   = cep ? cep.replace(/(\d{5})(\d{3})/, '$1-$2') : '';
  document.getElementById('enderecoSelecionadoBox').innerHTML = `
    <span class="material-icons-round" style="color:#f59e0b">location_on</span>
    <div style="flex:1">
      <strong>${linhaEnd}</strong>
      <div style="font-size:12px;color:var(--text-muted);margin-top:3px">
        ${cepFmt ? 'CEP ' + cepFmt + ' · ' : ''}Digite o número para localização exata
      </div>
    </div>`;
  document.getElementById('enderecoSelecionado').style.display = 'block';

  // Fechar sugestões e atualizar campo de busca
  lista.style.display = 'none';
  document.getElementById('buscaEnderecoEntrega').value = linhaEnd;

  // Focar no número imediatamente
  const numInput = document.getElementById('numeroEntrega');
  if (numInput) { numInput.value = ''; numInput.focus(); }

  // Taxa estimada com lat/lng da rua (sem número ainda)
  calcularTaxaEntrega(lat, lng);
}

function fecharSugestoes() {
  document.getElementById('sugestoesEntrega').style.display = 'none';
}

// Ao digitar o número — debounce para não chamar a cada tecla
let _debounceNumero = null;
function onNumeroChange() {
  clearTimeout(_debounceNumero);
  const num = document.getElementById('numeroEntrega').value.trim();
  if (!_enderecoSelecionadoData || !num) return;
  // Aguardar 800ms após parar de digitar
  _debounceNumero = setTimeout(() => geocodificarEnderecoCompleto(num), 800);
}

async function geocodificarEnderecoCompleto(numero) {
  if (!_enderecoSelecionadoData) return;
  const { rua, cidade, estado, bairro, cep } = _enderecoSelecionadoData;
  if (!rua || !numero) return;

  const preview = document.getElementById('taxaEntregaPreview');
  if (preview) {
    preview.style.display = 'flex';
    preview.className = 'taxa-preview warning';
    preview.innerHTML = '<span class="material-icons-round spin">my_location</span> Localizando endereço exato...';
  }

  // Montar query com endereço completo + número
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

    if (data.length > 0) {
      const melhor = data[0];
      const latExato = parseFloat(melhor.lat);
      const lngExato = parseFloat(melhor.lon);

      // Atualizar campos ocultos com coords exatas
      document.getElementById('latEntrega').value = latExato;
      document.getElementById('lngEntrega').value = lngExato;
      document.getElementById('ruaEntrega').value = rua;

      // Atualizar box de confirmação com localização precisa
      const addrExato = melhor.address || {};
      const cepExato  = (addrExato.postcode || cep || '').replace(/[^0-9]/g,'');
      const linhaEnd  = [rua + ', ' + numero, bairro, cidade].filter(Boolean).join(', ');
      document.getElementById('enderecoSelecionadoBox').innerHTML = `
        <span class="material-icons-round" style="color:#22c55e">my_location</span>
        <div style="flex:1">
          <strong>${linhaEnd}</strong>
          <div style="font-size:12px;color:var(--text-muted);margin-top:3px">
            ${cepExato ? 'CEP ' + cepExato.replace(/(\d{5})(\d{3})/, '$1-$2') + ' · ' : ''}📍 Localização exata
          </div>
        </div>`;

      // Recalcular taxa com ponto exato
      await calcularTaxaEntrega(latExato, lngExato);
    } else {
      // Não encontrou o número — manter lat/lng da rua com aviso
      const ruaSemNum = rua.replace(/,?\s*\d+$/, '').trim();
      document.getElementById('enderecoSelecionadoBox').innerHTML = `
        <span class="material-icons-round" style="color:#f59e0b">location_on</span>
        <div style="flex:1">
          <strong>${ruaSemNum}, ${numero}</strong>
          <div style="font-size:12px;color:#f59e0b;margin-top:3px">
            ⚠️ Número não encontrado — usando localização aproximada da rua
          </div>
        </div>`;
      // Manter taxa da rua (já calculada ao selecionar)
    }
  } catch(e) {
    console.warn('[Geocode] Erro ao localizar número:', e.message);
    // Manter taxa da rua em caso de erro de rede
  }
}

// GPS — geocodificação reversa
async function usarLocalizacaoGPS() {
  const btn = document.getElementById('btnGPS');
  if (!navigator.geolocation) { alert('Seu navegador não suporta geolocalização.'); return; }
  btn.innerHTML = '<span class="material-icons-round spin">my_location</span> Obtendo...';
  btn.disabled  = true;

  navigator.geolocation.getCurrentPosition(
    async ({ coords: { latitude: lat, longitude: lng } }) => {
      try {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&accept-language=pt-BR`;
        const res  = await fetch(url);
        const geo  = await res.json();
        const addr = geo.address || {};

        const rua    = addr.road || addr.pedestrian || '';
        const numero = addr.house_number || '';
        const bairro = addr.suburb || addr.neighbourhood || addr.city_district || '';
        const cidade = addr.city || addr.town || '';
        const cep    = (addr.postcode || '').replace(/[^0-9]/g,'');

        document.getElementById('ruaEntrega').value    = [rua, numero].filter(Boolean).join(', ');
        document.getElementById('bairroEntrega').value = bairro;
        document.getElementById('cepEntrega').value    = cep ? cep.replace(/(\d{5})(\d{3})/, '$1-$2') : '';
        document.getElementById('latEntrega').value    = lat;
        document.getElementById('lngEntrega').value    = lng;

        const linhaEnd = [rua, numero, bairro, cidade].filter(Boolean).join(', ');
        document.getElementById('buscaEnderecoEntrega').value = linhaEnd;
        document.getElementById('enderecoSelecionadoBox').innerHTML = `
          <span class="material-icons-round">check_circle</span>
          <div><strong>${linhaEnd}</strong>
          <div style="font-size:12px;color:var(--text-muted)">${cep ? 'CEP ' + cep.replace(/(\d{5})(\d{3})/, '$1-$2') : 'Localização via GPS'}</div></div>`;
        document.getElementById('enderecoSelecionado').style.display = 'block';

        _enderecoSelecionadoData = { rua, bairro, cidade, cep, lat, lng };
        await calcularTaxaEntrega(lat, lng);
      } catch(e) {
        await calcularTaxaEntrega(lat, lng);
      }
      btn.innerHTML = '<span class="material-icons-round">my_location</span> Usar minha localização atual (GPS)';
      btn.disabled  = false;
    },
    () => {
      alert('Não foi possível obter sua localização. Use a busca por endereço.');
      btn.innerHTML = '<span class="material-icons-round">my_location</span> Usar minha localização atual (GPS)';
      btn.disabled  = false;
    },
    { timeout: 12000, enableHighAccuracy: true }
  );
}

// Fechar sugestões ao clicar fora
document.addEventListener('click', (e) => {
  if (!e.target.closest('#buscaEnderecoEntrega') && !e.target.closest('#sugestoesEntrega')) {
    fecharSugestoes();
  }
});

async function calcularTaxaEntregaPorCampos() {
  const lat = parseFloat(document.getElementById('latEntrega')?.value);
  const lng = parseFloat(document.getElementById('lngEntrega')?.value);
  if (isNaN(lat) || isNaN(lng)) return;
  await calcularTaxaEntrega(lat, lng);
}

async function calcularTaxaEntrega(lat, lng) {
  const preview = document.getElementById('taxaEntregaPreview');
  if (!preview) return;

  preview.style.display = 'flex';
  preview.className = 'taxa-preview warning';
  preview.innerHTML = '<span class="material-icons-round spin">sync</span> Calculando taxa...';

  try {
    const res = await fetch(`/api/config/distancia?lat=${lat}&lng=${lng}`);
    const data = await res.json();

    if (data.fora_de_area) {
      taxaEntregaAtual = null;
      preview.className = 'taxa-preview error';
      preview.innerHTML = `<span class="material-icons-round">location_off</span> ${data.mensagem}`;
    } else {
      taxaEntregaAtual = data.taxa_entrega;
      distanciaAtual   = data.distancia_km;
      if (data.taxa_entrega === 0) {
        preview.className = 'taxa-preview ok';
        preview.innerHTML = `<span class="material-icons-round">check_circle</span> ${data.mensagem}`;
      } else {
        preview.className = 'taxa-preview warning';
        preview.innerHTML = `<span class="material-icons-round">delivery_dining</span>
          Taxa de entrega: <strong>R$ ${data.taxa_entrega.toFixed(2).replace('.',',')}</strong>
          &nbsp;·&nbsp; ${data.distancia_km} km`;
      }
      atualizarResumoCheckout();
    }
  } catch(e) {
    preview.className = 'taxa-preview error';
    preview.innerHTML = '<span class="material-icons-round">error</span> Erro ao calcular taxa';
  }
}
