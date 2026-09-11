// ==============================================================================
// MÓDULO DE INTERFACE E MANIPULAÇÃO DO DOM (ui.js)
// ==============================================================================

// Elementos Principais do DOM
const views = {
  login: document.getElementById('loginView'),
  dashboard: document.getElementById('dashboardView')
};

const elements = {
  // Login
  loginForm: document.getElementById('loginForm'),
  loginEmail: document.getElementById('loginEmail'),
  loginPassword: document.getElementById('loginPassword'),
  loginSubmitBtn: document.getElementById('loginSubmitBtn'),
  btnOpenConfigFromLogin: document.getElementById('btnOpenConfigFromLogin'),
  
  // Dashboard Header & Nav
  userEmailDisplay: document.getElementById('userEmailDisplay'),
  btnLogout: document.getElementById('btnLogout'),
  btnOpenConfigFromNav: document.getElementById('btnOpenConfigFromNav'),
  realtimeStatusPill: document.getElementById('realtimeStatusPill'),
  realtimeStatusText: document.getElementById('realtimeStatusText'),
  
  // Métricas
  metricTotalItems: document.getElementById('metricTotalItems'),
  metricTotalStock: document.getElementById('metricTotalStock'),
  metricTotalValue: document.getElementById('metricTotalValue'),
  metricAvgPrice: document.getElementById('metricAvgPrice'),
  metricZeroStock: document.getElementById('metricZeroStock'),
  
  // Tabela & Toolbar
  searchInput: document.getElementById('searchInput'),
  statusFilter: document.getElementById('statusFilter'),
  btnOpenNewPartModal: document.getElementById('btnOpenNewPartModal'),
  partsTableBody: document.getElementById('partsTableBody'),
  tableEmptyState: document.getElementById('tableEmptyState'),
  
  // Modal Nova Peça
  modalNewPart: document.getElementById('modalNewPart'),
  formNewPart: document.getElementById('formNewPart'),
  inputNewPartCode: document.getElementById('newPartCode'),
  inputNewPartDesc: document.getElementById('newPartDesc'),
  inputNewPartQty: document.getElementById('newPartQty'),
  inputNewPartPrice: document.getElementById('newPartPrice'),
  btnCloseNewPartModal: document.getElementById('btnCloseNewPartModal'),
  btnCancelNewPart: document.getElementById('btnCancelNewPart'),

  // Modal Editar Peça
  modalEditPart: document.getElementById('modalEditPart'),
  formEditPart: document.getElementById('formEditPart'),
  editPartId: document.getElementById('editPartId'),
  editPartCode: document.getElementById('editPartCode'),
  editPartDesc: document.getElementById('editPartDesc'),
  editPartQty: document.getElementById('editPartQty'),
  editPartPrice: document.getElementById('editPartPrice'),
  btnCloseEditPartModal: document.getElementById('btnCloseEditPartModal'),
  btnCancelEditPart: document.getElementById('btnCancelEditPart'),
  
  // Modal Movimentação (Entrada / Baixa)
  modalMovement: document.getElementById('modalMovement'),
  modalMovementTitle: document.getElementById('modalMovementTitle'),
  movementPartCode: document.getElementById('movementPartCode'),
  movementPartDesc: document.getElementById('movementPartDesc'),
  movementPartPrice: document.getElementById('movementPartPrice'),
  movementCurrentStock: document.getElementById('movementCurrentStock'),
  movementAmountInput: document.getElementById('movementAmountInput'),
  movementPreviewBox: document.getElementById('movementPreviewBox'),
  movementPreviewValue: document.getElementById('movementPreviewValue'),
  movementValueBox: document.getElementById('movementValueBox'),
  movementTotalValue: document.getElementById('movementTotalValue'),
  movementConfirmBtn: document.getElementById('movementConfirmBtn'),
  btnCloseMovementModal: document.getElementById('btnCloseMovementModal'),
  btnCancelMovement: document.getElementById('btnCancelMovement'),
  movementQuickChips: document.querySelectorAll('.quick-chip'),
  movementPriceGroup: document.getElementById('movementPriceGroup'),
  movementNewPrice: document.getElementById('movementNewPrice'),
  
  // Modal Configurações Supabase
  modalConfig: document.getElementById('modalConfig'),
  formConfig: document.getElementById('formConfig'),
  inputSupabaseUrl: document.getElementById('supabaseUrl'),
  inputSupabaseKey: document.getElementById('supabaseKey'),
  btnCloseConfigModal: document.getElementById('btnCloseConfigModal'),
  btnCancelConfig: document.getElementById('btnCancelConfig'),
  
  // Toast Container
  get toastContainer() {
    return document.getElementById('toastContainer') || document.body;
  }
};

/**
 * Converte qualquer entrada de preço (com vírgula, ponto, prefixo R$, etc.) em número float
 * Suporta formatos: "35,50", "35.50", "R$ 35,50", "1.250,00", "0"
 * @param {string|number} value 
 * @returns {number}
 */
export function parseCurrencyInput(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') {
    return isNaN(value) || value < 0 ? 0 : Number(value.toFixed(2));
  }
  let str = String(value).trim().replace(/[R$\s]/g, '');
  if (!str) return 0;
  if (str.includes(',') && str.includes('.')) {
    str = str.replace(/\./g, '').replace(',', '.');
  } else if (str.includes(',')) {
    str = str.replace(',', '.');
  }
  const num = parseFloat(str);
  return isNaN(num) || num < 0 ? 0 : Number(num.toFixed(2));
}

/**
 * Utilitário de formatação de moeda para padrão brasileiro (R$ 0,00)
 * @param {number|string} value 
 * @returns {string}
 */
export function formatCurrency(value) {
  const num = parseCurrencyInput(value);
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Estado local da UI para cálculo de modais
let currentMovementItem = null;
let currentMovementType = 'entrada'; // 'entrada' ou 'baixa'

// ==============================================================================
// 1. ALTERNÂNCIA DE TELAS
// ==============================================================================
export function showLoginView() {
  views.dashboard.classList.add('hidden');
  views.login.classList.remove('hidden');
  views.login.classList.add('fade-in');
}

export function showDashboardView(user) {
  views.login.classList.add('hidden');
  views.dashboard.classList.remove('hidden');
  views.dashboard.classList.add('fade-in');

  if (user && user.email) {
    elements.userEmailDisplay.textContent = user.email;
  }
}

// ==============================================================================
// 2. RENDERIZAÇÃO DA TABELA DE PEÇAS
// ==============================================================================
export function renderTable(pecas, handlers = {}) {
  const tbody = elements.partsTableBody;
  tbody.innerHTML = '';

  if (!pecas || pecas.length === 0) {
    elements.tableEmptyState.classList.remove('hidden');
    return;
  }

  elements.tableEmptyState.classList.add('hidden');

  pecas.forEach(peca => {
    const tr = createTableRow(peca, handlers);
    tbody.appendChild(tr);
  });
}

function createTableRow(peca, handlers = {}) {
  const tr = document.createElement('tr');
  tr.setAttribute('data-id', peca.id);
  tr.setAttribute('data-codigo', peca.codigo);

  // Status visual da quantidade
  let stockClass = 'normal';
  let stockLabel = `${peca.quantidade} un.`;
  if (peca.quantidade === 0) {
    stockClass = 'zero';
    stockLabel = '0 (Zerado)';
  } else if (peca.quantidade <= 5) {
    stockClass = 'low';
    stockLabel = `${peca.quantidade} (Baixo)`;
  }

  tr.innerHTML = `
    <td>
      <span class="code-badge">${escapeHtml(peca.codigo)}</span>
    </td>
    <td>
      <div class="part-description">${escapeHtml((peca.descricao || '').toUpperCase())}</div>
    </td>
    <td class="col-right" style="text-align: right;">
      <span class="price-badge" style="cursor: pointer;" title="Clique para editar o preço desta peça">${formatCurrency(peca.preco)}</span>
    </td>
    <td class="col-center" style="text-align: center;">
      <span class="stock-pill ${stockClass}">
        <span class="stock-val">${peca.quantidade}</span> un.
      </span>
    </td>
    <td class="col-center" style="text-align: center;">
      <div class="table-actions-cell" style="justify-content: center;">
        <button class="btn btn-action-entrada" title="Dar Entrada de Estoque" data-action="entrada">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          Entrada
        </button>

        <button class="btn btn-action-baixa" title="Dar Baixa de Estoque" data-action="baixa">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          Baixa
        </button>

        <button class="btn btn-action-edit" title="Editar Peça" data-action="edit">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
          Editar
        </button>

        <button class="btn btn-action-delete" title="Excluir Peça" data-action="delete">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    </td>
  `;

  // Vinculação de eventos dos botões independentes
  const btnEntrada = tr.querySelector('[data-action="entrada"]');
  const btnBaixa = tr.querySelector('[data-action="baixa"]');
  const btnEdit = tr.querySelector('[data-action="edit"]');
  const btnDelete = tr.querySelector('[data-action="delete"]');
  const priceBadge = tr.querySelector('.price-badge');

  if (priceBadge && handlers.onEdit) {
    priceBadge.addEventListener('click', () => handlers.onEdit(peca));
  }
  if (btnEntrada && handlers.onEntrada) {
    btnEntrada.addEventListener('click', () => handlers.onEntrada(peca));
  }
  if (btnBaixa && handlers.onBaixa) {
    btnBaixa.addEventListener('click', () => handlers.onBaixa(peca));
  }
  if (btnEdit && handlers.onEdit) {
    btnEdit.addEventListener('click', () => handlers.onEdit(peca));
  }
  if (btnDelete && handlers.onDelete) {
    btnDelete.addEventListener('click', () => handlers.onDelete(peca));
  }

  return tr;
}

// ==============================================================================
// 3. ATUALIZAÇÃO EM TEMPO REAL NO DOM (REALTIME DISPATCH)
// ==============================================================================
export function updateTableRowRealtime(newPeca, oldPeca, handlers) {
  const tr = elements.partsTableBody.querySelector(`tr[data-id="${newPeca.id}"]`);
  if (!tr) return false;

  // Determinar se foi Entrada ou Baixa para a animação de pulso
  const diff = newPeca.quantidade - (oldPeca?.quantidade ?? newPeca.quantidade);
  const pulseClass = diff >= 0 ? 'realtime-pulse-entrada' : 'realtime-pulse-baixa';

  // Atualizar código e descrição caso tenham mudado
  const codeBadge = tr.querySelector('.code-badge');
  if (codeBadge) codeBadge.textContent = newPeca.codigo;

  const descDiv = tr.querySelector('.part-description');
  if (descDiv) descDiv.textContent = newPeca.descricao;

  // Atualizar preço
  const priceBadge = tr.querySelector('.price-badge');
  if (priceBadge) {
    priceBadge.textContent = formatCurrency(newPeca.preco);
    if (handlers.onEdit) {
      priceBadge.style.cursor = 'pointer';
      priceBadge.title = 'Clique para editar o preço desta peça';
      priceBadge.onclick = () => handlers.onEdit(newPeca);
    }
  }

  // Atualizar badge de quantidade
  const stockPill = tr.querySelector('.stock-pill');
  if (stockPill) {
    stockPill.className = 'stock-pill';
    if (newPeca.quantidade === 0) {
      stockPill.classList.add('zero');
    } else if (newPeca.quantidade <= 5) {
      stockPill.classList.add('low');
    } else {
      stockPill.classList.add('normal');
    }
    const valSpan = stockPill.querySelector('.stock-val');
    if (valSpan) valSpan.textContent = newPeca.quantidade;
  }

  // Disparar animação de pulso
  tr.classList.remove('realtime-pulse-entrada', 'realtime-pulse-baixa');
  void tr.offsetWidth; // Força reflow do navegador
  tr.classList.add(pulseClass);

  // Atualizar listeners de clique com o novo objeto peca
  const btnEntrada = tr.querySelector('[data-action="entrada"]');
  const btnBaixa = tr.querySelector('[data-action="baixa"]');
  const btnEdit = tr.querySelector('[data-action="edit"]');
  if (btnEntrada && handlers?.onEntrada) {
    btnEntrada.onclick = () => handlers.onEntrada(newPeca);
  }
  if (btnBaixa && handlers?.onBaixa) {
    btnBaixa.onclick = () => handlers.onBaixa(newPeca);
  }
  if (btnEdit && handlers?.onEdit) {
    btnEdit.onclick = () => handlers.onEdit(newPeca);
  }

  return true;
}

export function insertTableRowRealtime(newPeca, handlers) {
  elements.tableEmptyState.classList.add('hidden');
  const tr = createTableRow(newPeca, handlers);
  tr.classList.add('realtime-pulse-new');
  elements.partsTableBody.prepend(tr);
}

export function removeTableRowRealtime(id) {
  const tr = elements.partsTableBody.querySelector(`tr[data-id="${id}"]`);
  if (tr) {
    tr.style.opacity = '0';
    tr.style.transform = 'scale(0.95)';
    setTimeout(() => tr.remove(), 250);
  }
}

// ==============================================================================
// 4. ATUALIZAÇÃO DOS CARDS DE MÉTRICAS
// ==============================================================================
export function updateMetrics(pecas) {
  if (!pecas) return;

  const totalItems = pecas.length;
  const totalStock = pecas.reduce((acc, p) => acc + (p.quantidade || 0), 0);
  const zeroStock = pecas.filter(p => (p.quantidade || 0) === 0).length;

  const totalValue = pecas.reduce((acc, p) => acc + ((p.quantidade || 0) * (Number(p.preco) || 0)), 0);
  const avgPrice = totalItems > 0 ? (pecas.reduce((acc, p) => acc + (Number(p.preco) || 0), 0) / totalItems) : 0;

  if (elements.metricTotalItems) elements.metricTotalItems.textContent = totalItems;
  if (elements.metricTotalStock) elements.metricTotalStock.textContent = totalStock;
  if (elements.metricZeroStock) elements.metricZeroStock.textContent = zeroStock;
  if (elements.metricTotalValue) elements.metricTotalValue.textContent = formatCurrency(totalValue);
  if (elements.metricAvgPrice) elements.metricAvgPrice.textContent = formatCurrency(avgPrice);
}

// ==============================================================================
// 5. MODAL DE CADASTRO DE NOVA PEÇA
// ==============================================================================
export function openNewPartModal() {
  elements.formNewPart.reset();
  if (elements.inputNewPartQty) {
    elements.inputNewPartQty.value = '0';
  }
  if (elements.inputNewPartPrice) {
    elements.inputNewPartPrice.value = '0,00';
  }
  elements.modalNewPart.classList.add('active');
  setTimeout(() => elements.inputNewPartCode.focus(), 50);
}

export function closeNewPartModal() {
  elements.modalNewPart.classList.remove('active');
}

// ==============================================================================
// 5.1 MODAL DE EDIÇÃO DE PEÇA
// ==============================================================================
export function openEditPartModal(peca) {
  if (!peca) return;
  if (elements.editPartId) elements.editPartId.value = peca.id || '';
  if (elements.editPartCode) elements.editPartCode.value = peca.codigo || '';
  if (elements.editPartDesc) elements.editPartDesc.value = (peca.descricao || '').toUpperCase();
  if (elements.editPartQty) elements.editPartQty.value = peca.quantidade ?? 0;
  if (elements.editPartPrice) {
    const p = Number(peca.preco) || 0;
    elements.editPartPrice.value = p.toFixed(2).replace('.', ',');
  }

  if (elements.modalEditPart) {
    elements.modalEditPart.classList.add('active');
    setTimeout(() => {
      if (elements.editPartPrice) {
        elements.editPartPrice.focus();
        elements.editPartPrice.select();
      }
    }, 50);
  }
}

export function closeEditPartModal() {
  if (elements.modalEditPart) {
    elements.modalEditPart.classList.remove('active');
  }
}

// ==============================================================================
// 6. MODAL DE MOVIMENTAÇÃO RÁPIDA (ENTRADA / BAIXA)
// ==============================================================================
export function openMovementModal(arg1, arg2) {
  let peca, type;
  if (typeof arg1 === 'string') {
    type = arg1;
    peca = arg2;
  } else {
    peca = arg1;
    type = arg2;
  }

  currentMovementItem = peca;
  currentMovementType = type;

  const isEntrada = type === 'entrada';
  elements.modalMovementTitle.innerHTML = isEntrada 
    ? `<span style="color: var(--accent-success)">▲ Dar Entrada de Estoque</span>` 
    : `<span style="color: var(--accent-warning)">▼ Dar Baixa de Estoque</span>`;

  elements.movementPartCode.textContent = peca?.codigo || '---';
  elements.movementPartDesc.textContent = (peca?.descricao || '').toUpperCase();
  elements.movementCurrentStock.textContent = `${peca?.quantidade ?? 0} un.`;
  if (elements.movementPartPrice) {
    elements.movementPartPrice.textContent = formatCurrency(peca?.preco);
  }

  if (elements.movementPriceGroup) {
    elements.movementPriceGroup.style.display = isEntrada ? 'block' : 'none';
  }
  if (elements.movementNewPrice) {
    const p = Number(peca?.preco) || 0;
    elements.movementNewPrice.value = p > 0 ? p.toFixed(2).replace('.', ',') : '';
  }

  elements.movementAmountInput.value = 1;
  elements.movementConfirmBtn.className = `btn ${isEntrada ? 'btn-action-entrada' : 'btn-action-baixa'}`;
  elements.movementConfirmBtn.textContent = isEntrada ? 'Confirmar Entrada' : 'Confirmar Baixa';

  updateMovementPreview();

  elements.modalMovement.classList.add('active');
  setTimeout(() => {
    elements.movementAmountInput.focus();
    elements.movementAmountInput.select();
  }, 50);
}

export function closeMovementModal() {
  elements.modalMovement.classList.remove('active');
  currentMovementItem = null;
}

export function updateMovementPreview() {
  if (!currentMovementItem) return;

  const currentQty = currentMovementItem.quantidade || 0;
  const enteredQty = parseInt(elements.movementAmountInput.value, 10) || 0;
  const unitPrice = Number(currentMovementItem.preco) || 0;

  let effectiveUnitPrice = unitPrice;
  if (currentMovementType === 'entrada' && elements.movementNewPrice && elements.movementNewPrice.value) {
    const customP = parseCurrencyInput(elements.movementNewPrice.value);
    if (customP > 0) effectiveUnitPrice = customP;
  }

  let newBalance = currentMovementType === 'entrada' 
    ? currentQty + enteredQty 
    : currentQty - enteredQty;

  elements.movementPreviewValue.textContent = `${newBalance} un.`;

  if (newBalance < 0) {
    elements.movementPreviewBox.classList.add('invalid');
    elements.movementPreviewBox.classList.remove('valid');
    elements.movementPreviewValue.innerHTML = `${newBalance} un. <span style="font-size: 0.75rem; color: #f87171;">(Violação de Estoque Negativo)</span>`;
  } else {
    elements.movementPreviewBox.classList.remove('invalid');
    elements.movementPreviewBox.classList.add('valid');
  }

  // Atualiza valor total financeiro da movimentação
  if (elements.movementTotalValue) {
    const totalMovVal = enteredQty * effectiveUnitPrice;
    elements.movementTotalValue.textContent = formatCurrency(totalMovVal);
  }
}

export function getCurrentMovementContext() {
  return {
    item: currentMovementItem,
    type: currentMovementType,
    amount: parseInt(elements.movementAmountInput.value, 10) || 0
  };
}

// ==============================================================================
// 7. MODAL DE CONFIGURAÇÃO DO SUPABASE
// ==============================================================================
export function openConfigModal(currentUrl = '', currentKey = '') {
  elements.inputSupabaseUrl.value = currentUrl;
  elements.inputSupabaseKey.value = currentKey;
  elements.modalConfig.classList.add('active');
}

export function closeConfigModal() {
  elements.modalConfig.classList.remove('active');
}

// ==============================================================================
// 8. INDICADOR DE STATUS REALTIME
// ==============================================================================
export function setRealtimeStatus(status) {
  if (status === 'SUBSCRIBED') {
    elements.realtimeStatusPill.style.display = 'inline-flex';
    elements.realtimeStatusText.textContent = 'Realtime Conectado';
  } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
    elements.realtimeStatusPill.style.display = 'inline-flex';
    elements.realtimeStatusText.textContent = 'Realtime Desconectado';
  } else {
    elements.realtimeStatusText.textContent = `Realtime: ${status}`;
  }
}

// ==============================================================================
// 9. SISTEMA DE TOASTS NOTIFICATION
// ==============================================================================
export function showToast({ type = 'info', title, message, duration = 4500 }) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const iconSvg = getToastIcon(type);

  toast.innerHTML = `
    <div class="toast-icon">${iconSvg}</div>
    <div class="toast-content">
      <div class="toast-title">${escapeHtml(title)}</div>
      <div class="toast-message">${escapeHtml(message)}</div>
    </div>
  `;

  elements.toastContainer.appendChild(toast);

  const dismiss = () => {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 250);
  };

  const timer = setTimeout(dismiss, duration);
  toast.addEventListener('click', () => {
    clearTimeout(timer);
    dismiss();
  });
}

function getToastIcon(type) {
  switch (type) {
    case 'success':
      return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
    case 'error':
      return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
    case 'warning':
      return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
    default:
      return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
