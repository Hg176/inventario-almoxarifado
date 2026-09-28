// ==============================================================================
// PONTO DE ENTRADA PRINCIPAL DA APLICAÇÃO (app.js)
// ORQUESTRAÇÃO DE AUTENTICAÇÃO, SUPABASE REALTIME E CRUD
// ==============================================================================
import { isSupabaseConfigured, saveSupabaseConfig, getStoredConfig } from './config.js?v=1.3.1';
import * as auth from './auth.js?v=1.3.1';
import * as api from './api.js?v=1.3.1';
import * as ui from './ui.js?v=1.3.1';

// Cache em memória das peças sincronizadas com o banco
let pecasList = [];

// Estado da tela de histórico
const HISTORICO_PAGINA = 50;
const historicoState = {
  peca: null,
  registros: [],
  total: 0,
  requisicao: 0
};

// ==============================================================================
// 1. INICIALIZAÇÃO DA APLICAÇÃO
// ==============================================================================
async function initApp() {
  setupEventListeners();

  // 1. Verifica se o Supabase possui credenciais configuradas
  if (!isSupabaseConfigured()) {
    ui.showLoginView();
    const stored = getStoredConfig();
    ui.openConfigModal(stored.url, stored.anonKey);
    ui.showToast({
      type: 'info',
      title: 'Configuração Inicial Necessária',
      message: 'Insira o Project URL e a Anon Key do seu projeto Supabase para iniciar.'
    });
    return;
  }

  // 2. Verifica se há uma sessão ativa do Supabase
  try {
    const session = await auth.getSession();
    if (session && session.user) {
      await handleAuthenticatedUser(session.user);
    } else {
      ui.showLoginView();
    }
  } catch (err) {
    console.error('Erro ao verificar sessão inicial:', err);
    ui.showLoginView();
  }

  // 3. Monitora mudanças de sessão (login/logout/refresh)
  auth.onAuthStateChange(async (event, session) => {
    console.log('[Auth State Change]', event);
    if (event === 'SIGNED_IN' && session) {
      await handleAuthenticatedUser(session.user);
    } else if (event === 'SIGNED_OUT') {
      handleUserSignedOut();
    }
  });
}

/**
 * Transiciona a UI para o modo autenticado e carrega dados
 */
async function handleAuthenticatedUser(user) {
  ui.showDashboardView(user);
  await carregarInventario();
  iniciarSincronizacaoRealtime();
}

/**
 * Transiciona a UI para o modo deslogado
 */
function handleUserSignedOut() {
  api.desinscreverRealtime();
  ui.closeHistoryModal();
  pecasList = [];
  ui.showLoginView();
}

// ==============================================================================
// 2. CARREGAMENTO DO INVENTÁRIO VIA SUPABASE
// ==============================================================================
async function carregarInventario() {
  try {
    pecasList = await api.listarPecas();
    ui.renderTable(pecasList, getTableHandlers());
    ui.updateMetrics(pecasList);
  } catch (err) {
    ui.showToast({
      type: 'error',
      title: 'Falha ao Carregar Almoxarifado',
      message: err.message
    });
  }
}

// Handlers de ação para cada linha da tabela
function getTableHandlers() {
  return {
    onEntrada: (peca) => {
      ui.openMovementModal(peca, 'entrada');
    },
    onBaixa: (peca) => {
      ui.openMovementModal(peca, 'baixa');
    },
    onEdit: (peca) => {
      ui.openEditPartModal(peca);
    },
    onHistorico: (peca) => {
      abrirHistorico(peca);
    },
    onDelete: async (peca) => {
      const confirmMsg = `Deseja realmente remover a peça "${peca.codigo} - ${peca.descricao}" do almoxarifado?\n\nO histórico de movimentações desta peça será mantido.`;
      if (confirm(confirmMsg)) {
        try {
          await api.excluirPeca(peca.id);
          ui.showToast({
            type: 'success',
            title: 'Peça Removida',
            message: `A peça ${peca.codigo} foi excluída com sucesso.`
          });
          // Remove localmente caso o Realtime demore milissegundos
          pecasList = pecasList.filter(p => p.id !== peca.id);
          ui.removeTableRowRealtime(peca.id);
          ui.updateMetrics(pecasList);
        } catch (err) {
          ui.showToast({
            type: 'error',
            title: 'Erro ao Excluir Peça',
            message: err.message
          });
        }
      }
    }
  };
}

// ==============================================================================
// 2.1 HISTÓRICO DE MOVIMENTAÇÕES
// ==============================================================================
function abrirHistorico(peca = null) {
  historicoState.peca = peca;
  ui.openHistoryModal(peca);
  carregarHistorico();
}

/**
 * Busca o histórico com os filtros atuais.
 * @param {boolean} append true = "Carregar mais" (próxima página)
 */
async function carregarHistorico(append = false) {
  const requisicao = ++historicoState.requisicao;
  const filtros = ui.getHistoryFilters();
  const offset = append ? historicoState.registros.length : 0;

  ui.setHistoryLoading(true);
  try {
    const { registros, total } = await api.listarMovimentacoes({
      ...filtros,
      pecaId: historicoState.peca?.id,
      limite: HISTORICO_PAGINA,
      offset
    });

    // Ignora respostas antigas se o usuário mudou o filtro nesse meio tempo
    if (requisicao !== historicoState.requisicao) return;

    historicoState.registros = append ? historicoState.registros.concat(registros) : registros;
    historicoState.total = total;
    ui.renderHistory(registros, {
      append,
      total,
      carregados: historicoState.registros.length
    });
  } catch (err) {
    if (requisicao !== historicoState.requisicao) return;
    ui.renderHistory([], { total: 0, carregados: 0 });
    ui.showToast({
      type: 'error',
      title: 'Falha ao Carregar Histórico',
      message: err.message,
      duration: err.isSchemaError ? 9000 : 6000
    });
  } finally {
    if (requisicao === historicoState.requisicao) ui.setHistoryLoading(false);
  }
}

// ==============================================================================
// 3. SINCRONIZAÇÃO EM TEMPO REAL (SUPABASE REALTIME)
// ==============================================================================
function iniciarSincronizacaoRealtime() {
  api.subscreverRealtime(
    (payload) => {
      const { eventType, new: newRecord, old: oldRecord } = payload;
      const handlers = getTableHandlers();

      if (eventType === 'UPDATE') {
        const index = pecasList.findIndex(p => p.id === newRecord.id);
        const previousRecord = index !== -1 ? pecasList[index] : oldRecord;

        if (index !== -1) {
          pecasList[index] = newRecord;
        }

        ui.updateTableRowRealtime(newRecord, previousRecord, handlers);
        ui.updateMetrics(pecasList);

        // Feedback sutil se a alteração foi gerada por outro terminal
        if (previousRecord && previousRecord.quantidade !== newRecord.quantidade) {
          console.log(`[Realtime Sync] Peça ${newRecord.codigo}: ${previousRecord.quantidade} -> ${newRecord.quantidade}`);
        }
      } 
      else if (eventType === 'INSERT') {
        // Evita duplicatas caso a inserção local já tenha adicionado
        if (!pecasList.some(p => p.id === newRecord.id)) {
          pecasList.unshift(newRecord);
          ui.insertTableRowRealtime(newRecord, handlers);
          ui.updateMetrics(pecasList);
          ui.showToast({
            type: 'info',
            title: 'Nova Peça Cadastrada no Sistema',
            message: `${newRecord.codigo} - ${newRecord.descricao}`,
            duration: 3500
          });
        }
      } 
      else if (eventType === 'DELETE') {
        pecasList = pecasList.filter(p => p.id !== oldRecord.id);
        ui.removeTableRowRealtime(oldRecord.id);
        ui.updateMetrics(pecasList);
      }
    },
    (status) => {
      ui.setRealtimeStatus(status);
    }
  );
}

// ==============================================================================
// 4. CONFIGURAÇÃO DE EVENT LISTENERS DO DOM
// ==============================================================================
function setupEventListeners() {
  // Login Form
  const formLogin = document.getElementById('loginForm');
  if (formLogin) {
    formLogin.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('loginEmail').value;
      const password = document.getElementById('loginPassword').value;
      const submitBtn = document.getElementById('loginSubmitBtn');

      try {
        submitBtn.disabled = true;
        submitBtn.innerHTML = 'Conectando ao Almoxarifado...';

        const { user } = await auth.signIn(email, password);
        ui.showToast({
          type: 'success',
          title: 'Autenticação Bem-Sucedida',
          message: `Bem-vindo à oficina, ${user.email}!`
        });
        await handleAuthenticatedUser(user);
      } catch (err) {
        ui.showToast({
          type: 'error',
          title: 'Falha no Acesso',
          message: err.message
        });
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
          Entrar no Almoxarifado
        `;
      }
    });
  }

  // Botão: Cadastrar Novo Operador
  const btnSignUp = document.getElementById('btnSignUp');
  if (btnSignUp) {
    btnSignUp.addEventListener('click', async () => {
      const email = document.getElementById('loginEmail').value;
      const password = document.getElementById('loginPassword').value;

      if (!email || !password) {
        ui.showToast({
          type: 'warning',
          title: 'Dados Incompletos',
          message: 'Preencha o e-mail e a senha desejados para cadastrar o operador.'
        });
        return;
      }

      try {
        btnSignUp.disabled = true;
        btnSignUp.textContent = 'Cadastrando operador...';

        const data = await auth.signUp(email, password);

        if (data.session) {
          ui.showToast({
            type: 'success',
            title: 'Operador Cadastrado!',
            message: `Acesso liberado para ${email}. Entrando...`
          });
          await handleAuthenticatedUser(data.user);
        } else {
          ui.showToast({
            type: 'success',
            title: 'Cadastro Criado!',
            message: `Operador ${email} registrado. Se a confirmação de e-mail estiver ativa no seu Supabase, valide o e-mail ou desative a confirmação no painel.`
          });
        }
      } catch (err) {
        ui.showToast({
          type: 'error',
          title: 'Falha no Cadastro',
          message: err.message
        });
      } finally {
        btnSignUp.disabled = false;
        btnSignUp.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
            <circle cx="8.5" cy="7" r="4"></circle>
            <line x1="20" y1="8" x2="20" y2="14"></line>
            <line x1="23" y1="11" x2="17" y2="11"></line>
          </svg>
          Cadastrar Novo Operador
        `;
      }
    });
  }

  // Logout Button
  const btnLogout = document.getElementById('btnLogout');
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      try {
        await auth.signOut();
        ui.showToast({
          type: 'info',
          title: 'Sessão Encerrada',
          message: 'Desconectado do almoxarifado com segurança.'
        });
      } catch (err) {
        console.error('Erro ao sair:', err);
      }
    });
  }

  // Modal: Cadastrar Nova Peça
  const btnOpenNewPart = document.getElementById('btnOpenNewPartModal');
  if (btnOpenNewPart) {
    btnOpenNewPart.addEventListener('click', () => ui.openNewPartModal());
  }

  const btnCloseNewPart = document.getElementById('btnCloseNewPartModal');
  const btnCancelNewPart = document.getElementById('btnCancelNewPart');
  [btnCloseNewPart, btnCancelNewPart].forEach(btn => {
    if (btn) btn.addEventListener('click', () => ui.closeNewPartModal());
  });

  // Sugestões de Descrição da Peça e Aplicações (Sempre em Maiúsculas)
  const descInput = document.getElementById('newPartDesc');
  if (descInput) {
    descInput.addEventListener('input', () => {
      descInput.value = descInput.value.toUpperCase();
    });
  }

  document.querySelectorAll('.modal-desc-chip, .modal-app-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (!descInput) return;
      const text = (chip.dataset.text || chip.textContent.trim()).toUpperCase();
      const current = descInput.value.trim().toUpperCase();
      if (!current) {
        descInput.value = text;
      } else {
        // Se ainda não estiver contido, adiciona como complemento
        if (!current.includes(text)) {
          descInput.value = `${current} - ${text}`;
        }
      }
      descInput.value = descInput.value.toUpperCase();
      descInput.focus();
    });
  });

  // Stepper e Chips de Quantidade Inicial
  const newPartQtyInput = document.getElementById('newPartQty');
  const btnDecNewQty = document.getElementById('btnDecNewQty');
  const btnIncNewQty = document.getElementById('btnIncNewQty');

  if (btnDecNewQty && newPartQtyInput) {
    btnDecNewQty.addEventListener('click', () => {
      const current = parseInt(newPartQtyInput.value, 10) || 0;
      newPartQtyInput.value = Math.max(0, current - 1);
    });
  }

  if (btnIncNewQty && newPartQtyInput) {
    btnIncNewQty.addEventListener('click', () => {
      const current = parseInt(newPartQtyInput.value, 10) || 0;
      newPartQtyInput.value = current + 1;
    });
  }

  document.querySelectorAll('.new-part-qty-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (!newPartQtyInput) return;
      const val = parseInt(chip.dataset.val, 10);
      newPartQtyInput.value = isNaN(val) ? 0 : Math.max(0, val);
    });
  });

  // Chips de Preço Unitário no Cadastro
  const newPartPriceInput = document.getElementById('newPartPrice');
  document.querySelectorAll('.new-part-price-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (!newPartPriceInput) return;
      const val = parseFloat(chip.dataset.val);
      newPartPriceInput.value = isNaN(val) ? '0,00' : val.toFixed(2).replace('.', ',');
    });
  });
  if (newPartPriceInput) {
    newPartPriceInput.addEventListener('blur', () => {
      const parsed = ui.parseCurrencyInput(newPartPriceInput.value);
      newPartPriceInput.value = parsed.toFixed(2).replace('.', ',');
    });
  }

  // Envio do Formulário de Nova Peça
  const formNewPart = document.getElementById('formNewPart');
  if (formNewPart) {
    formNewPart.addEventListener('submit', async (e) => {
      e.preventDefault();
      const codigo = document.getElementById('newPartCode').value.trim().toUpperCase();
      const descricao = document.getElementById('newPartDesc').value.trim().toUpperCase();
      const quantidade = newPartQtyInput ? (parseInt(newPartQtyInput.value, 10) || 0) : 0;
      const preco = newPartPriceInput ? ui.parseCurrencyInput(newPartPriceInput.value) : 0;

      try {
        const novaPeca = await api.cadastrarPeca({ codigo, descricao, quantidade, preco });
        ui.showToast({
          type: 'success',
          title: 'Peça Cadastrada no Almoxarifado',
          message: `${novaPeca.codigo} adicionada (Estoque: ${novaPeca.quantidade} un., Preço: ${ui.formatCurrency(novaPeca.preco)}).`
        });
        ui.closeNewPartModal();

        // Insere na tabela caso o Realtime ainda não tenha emitido
        if (!pecasList.some(p => p.id === novaPeca.id)) {
          pecasList.unshift(novaPeca);
          ui.insertTableRowRealtime(novaPeca, getTableHandlers());
          ui.updateMetrics(pecasList);
        }
      } catch (err) {
        ui.showToast({
          type: 'error',
          title: 'Erro no Cadastro',
          message: err.message
        });
      }
    });
  }

  // ==============================================================================
  // Modal: Editar Peça
  // ==============================================================================
  const btnCloseEditPart = document.getElementById('btnCloseEditPartModal');
  const btnCancelEditPart = document.getElementById('btnCancelEditPart');
  [btnCloseEditPart, btnCancelEditPart].forEach(btn => {
    if (btn) btn.addEventListener('click', () => ui.closeEditPartModal());
  });

  const editPartDescInput = document.getElementById('editPartDesc');
  if (editPartDescInput) {
    editPartDescInput.addEventListener('input', () => {
      editPartDescInput.value = editPartDescInput.value.toUpperCase();
    });
  }

  document.querySelectorAll('.edit-desc-chip, .edit-app-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (!editPartDescInput) return;
      const text = (chip.dataset.text || chip.textContent.trim()).toUpperCase();
      const current = editPartDescInput.value.trim().toUpperCase();
      if (!current) {
        editPartDescInput.value = text;
      } else {
        if (!current.includes(text)) {
          editPartDescInput.value = `${current} - ${text}`;
        }
      }
      editPartDescInput.value = editPartDescInput.value.toUpperCase();
      editPartDescInput.focus();
    });
  });

  // Stepper e Chips de Quantidade na Edição
  const editPartQtyInput = document.getElementById('editPartQty');
  const btnDecEditQty = document.getElementById('btnDecEditQty');
  const btnIncEditQty = document.getElementById('btnIncEditQty');

  if (btnDecEditQty && editPartQtyInput) {
    btnDecEditQty.addEventListener('click', () => {
      const current = parseInt(editPartQtyInput.value, 10) || 0;
      editPartQtyInput.value = Math.max(0, current - 1);
    });
  }

  if (btnIncEditQty && editPartQtyInput) {
    btnIncEditQty.addEventListener('click', () => {
      const current = parseInt(editPartQtyInput.value, 10) || 0;
      editPartQtyInput.value = current + 1;
    });
  }

  document.querySelectorAll('.edit-part-qty-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (!editPartQtyInput) return;
      const val = parseInt(chip.dataset.val, 10);
      editPartQtyInput.value = isNaN(val) ? 0 : Math.max(0, val);
    });
  });

  // Chips de Preço na Edição
  const editPartPriceInput = document.getElementById('editPartPrice');
  document.querySelectorAll('.edit-part-price-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (!editPartPriceInput) return;
      const val = parseFloat(chip.dataset.val);
      editPartPriceInput.value = isNaN(val) ? '0,00' : val.toFixed(2).replace('.', ',');
    });
  });
  if (editPartPriceInput) {
    editPartPriceInput.addEventListener('blur', () => {
      const parsed = ui.parseCurrencyInput(editPartPriceInput.value);
      editPartPriceInput.value = parsed.toFixed(2).replace('.', ',');
    });
  }

  // Envio do Formulário de Edição
  const formEditPart = document.getElementById('formEditPart');
  if (formEditPart) {
    formEditPart.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('editPartId').value;
      const codigo = document.getElementById('editPartCode').value.trim().toUpperCase();
      const descricao = document.getElementById('editPartDesc').value.trim().toUpperCase();
      const quantidade = editPartQtyInput ? (parseInt(editPartQtyInput.value, 10) || 0) : 0;
      const preco = editPartPriceInput ? ui.parseCurrencyInput(editPartPriceInput.value) : 0;

      try {
        const pecaAtualizada = await api.atualizarPeca(id, { codigo, descricao, quantidade, preco });
        ui.showToast({
          type: 'success',
          title: 'Peça Atualizada',
          message: `${pecaAtualizada.codigo} atualizada com sucesso (Preço: ${ui.formatCurrency(pecaAtualizada.preco)}).`
        });
        ui.closeEditPartModal();

        // Atualiza na lista local e UI
        const idx = pecasList.findIndex(p => p.id === pecaAtualizada.id);
        const prev = idx !== -1 ? pecasList[idx] : null;
        if (idx !== -1) {
          pecasList[idx] = pecaAtualizada;
        }
        ui.updateTableRowRealtime(pecaAtualizada, prev, getTableHandlers());
        ui.updateMetrics(pecasList);
      } catch (err) {
        ui.showToast({
          type: 'error',
          title: 'Erro ao Atualizar Peça',
          message: err.message
        });
      }
    });
  }

  // Modal: Movimentação (Entrada / Baixa)
  const btnCloseMovement = document.getElementById('btnCloseMovementModal');
  const btnCancelMovement = document.getElementById('btnCancelMovement');
  [btnCloseMovement, btnCancelMovement].forEach(btn => {
    if (btn) btn.addEventListener('click', () => ui.closeMovementModal());
  });

  const movementInput = document.getElementById('movementAmountInput');
  if (movementInput) {
    movementInput.addEventListener('input', () => ui.updateMovementPreview());
  }

  const movementNewPriceInput = document.getElementById('movementNewPrice');
  if (movementNewPriceInput) {
    movementNewPriceInput.addEventListener('input', () => {
      ui.updateMovementPreview();
    });
    movementNewPriceInput.addEventListener('blur', () => {
      if (movementNewPriceInput.value.trim()) {
        const parsed = ui.parseCurrencyInput(movementNewPriceInput.value);
        movementNewPriceInput.value = parsed.toFixed(2).replace('.', ',');
      }
      ui.updateMovementPreview();
    });
  }

  // Chips de incremento rápido no modal de movimentação (+1, +5, +10, +20)
  document.querySelectorAll('#modalMovement .quick-chip[data-step]').forEach(chip => {
    chip.addEventListener('click', () => {
      const step = parseInt(chip.dataset.step, 10) || 1;
      const current = parseInt(movementInput.value, 10) || 0;
      movementInput.value = Math.max(1, current + step);
      ui.updateMovementPreview();
    });
  });

  // Confirmação de Movimentação (Entrada / Baixa)
  const formMovement = document.getElementById('formMovement');
  if (formMovement) {
    formMovement.addEventListener('submit', async (e) => {
      e.preventDefault();
      const { item, type, amount, cliente, placa, veiculo, observacao } = ui.getCurrentMovementContext();
      if (!item) return;

      if (type !== 'entrada' && !cliente) {
        ui.flagMissingCliente();
        ui.showToast({
          type: 'error',
          title: 'Cliente Obrigatório',
          message: 'Informe o nome do cliente para registrar a baixa.'
        });
        return;
      }

      const confirmBtn = document.getElementById('movementConfirmBtn');
      const originalText = confirmBtn.textContent;

      try {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Enviando ao banco...';

        if (type === 'entrada') {
          let novoPreco = null;
          if (movementNewPriceInput && movementNewPriceInput.value.trim() !== '') {
            novoPreco = ui.parseCurrencyInput(movementNewPriceInput.value);
          }
          const updated = await api.darEntrada(item.id, amount, novoPreco, observacao);
          const priceMsg = novoPreco !== null ? ` (Preço: ${ui.formatCurrency(updated.preco)})` : '';
          ui.showToast({
            type: 'success',
            title: 'Entrada Confirmada',
            message: `+${amount} unidades registradas para ${item.codigo}. Novo saldo: ${updated.quantidade} un.${priceMsg}`
          });
          ui.closeMovementModal();

          // Sincroniza localmente caso o Realtime demore milissegundos
          const idx = pecasList.findIndex(p => p.id === updated.id);
          const prev = idx !== -1 ? pecasList[idx] : item;
          if (idx !== -1) pecasList[idx] = updated;
          ui.updateTableRowRealtime(updated, prev, getTableHandlers());
          ui.updateMetrics(pecasList);
        } else {
          // REGRA CRÍTICA: Baixa de estoque
          // A validação principal ocorre no PostgreSQL através da constraint CHECK (quantidade >= 0).
          // Se falhar, o PostgreSQL retorna erro 23514 e o api.js o traduz para nós.
          const updated = await api.darBaixa(item.id, amount, { cliente, placa, veiculo, observacao });
          const destino = [cliente, placa, veiculo].filter(Boolean).join(' · ');
          ui.showToast({
            type: 'warning',
            title: 'Baixa Confirmada',
            message: `-${amount} unidades de ${item.codigo} para ${destino}. Novo saldo: ${updated.quantidade} un.`
          });
          ui.closeMovementModal();

          const idx = pecasList.findIndex(p => p.id === updated.id);
          const prev = idx !== -1 ? pecasList[idx] : item;
          if (idx !== -1) pecasList[idx] = updated;
          ui.updateTableRowRealtime(updated, prev, getTableHandlers());
          ui.updateMetrics(pecasList);
        }
      } catch (err) {
        console.warn('Erro capturado na movimentação:', err);
        const title = err.isStockConstraint
          ? 'Regra de Estoque Violada'
          : (err.isSchemaError ? 'Erro no Banco de Dados (Supabase)' : 'Falha na Operação');

        ui.showToast({
          type: 'error',
          title: title,
          message: err.message,
          duration: err.isSchemaError ? 9000 : 7000
        });
      } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = originalText;
      }
    });
  }

  // Campos de destino da baixa
  const movementCliente = document.getElementById('movementCliente');
  if (movementCliente) {
    movementCliente.addEventListener('input', () => movementCliente.classList.remove('field-error'));
  }
  const movementPlaca = document.getElementById('movementPlaca');
  if (movementPlaca) {
    movementPlaca.addEventListener('input', () => {
      const pos = movementPlaca.selectionStart;
      movementPlaca.value = movementPlaca.value.toUpperCase();
      movementPlaca.setSelectionRange(pos, pos);
    });
  }

  // Modal: Histórico de Movimentações
  const btnOpenHistory = document.getElementById('btnOpenHistory');
  if (btnOpenHistory) btnOpenHistory.addEventListener('click', () => abrirHistorico(null));

  const btnCloseHistory = document.getElementById('btnCloseHistoryModal');
  if (btnCloseHistory) btnCloseHistory.addEventListener('click', () => ui.closeHistoryModal());

  const btnClearHistoryPart = document.getElementById('btnClearHistoryPart');
  if (btnClearHistoryPart) {
    btnClearHistoryPart.addEventListener('click', () => {
      historicoState.peca = null;
      ui.setHistoryPart(null);
      carregarHistorico();
    });
  }

  const btnHistoryMore = document.getElementById('btnHistoryMore');
  if (btnHistoryMore) btnHistoryMore.addEventListener('click', () => carregarHistorico(true));

  const historyFilters = document.getElementById('historyFilters');
  if (historyFilters) {
    let debounce = null;
    historyFilters.addEventListener('submit', (e) => {
      e.preventDefault();
      carregarHistorico();
    });
    document.getElementById('historySearch')?.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => carregarHistorico(), 350);
    });
    ['historyTipo', 'historyFrom', 'historyTo'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => carregarHistorico());
    });
  }

  // Barra de Pesquisa e Filtro de Status
  const searchInput = document.getElementById('searchInput');
  const statusFilter = document.getElementById('statusFilter');

  function filtrarTabela() {
    const query = (searchInput?.value || '').toLowerCase().trim();
    const status = statusFilter?.value || 'todos';

    const filtradas = pecasList.filter(peca => {
      const matchQuery = 
        peca.codigo.toLowerCase().includes(query) || 
        peca.descricao.toLowerCase().includes(query);

      if (!matchQuery) return false;

      if (status === 'normal') return peca.quantidade > 5;
      if (status === 'baixo') return peca.quantidade >= 1 && peca.quantidade <= 5;
      if (status === 'zerado') return peca.quantidade === 0;

      return true;
    });

    ui.renderTable(filtradas, getTableHandlers());
  }

  if (searchInput) searchInput.addEventListener('input', filtrarTabela);
  if (statusFilter) statusFilter.addEventListener('change', filtrarTabela);

  // Configurações Supabase Modal
  const btnOpenConfigLogin = document.getElementById('btnOpenConfigFromLogin');
  const btnOpenConfigNav = document.getElementById('btnOpenConfigFromNav');
  [btnOpenConfigLogin, btnOpenConfigNav].forEach(btn => {
    if (btn) {
      btn.addEventListener('click', () => {
        const stored = getStoredConfig();
        ui.openConfigModal(stored.url, stored.anonKey);
      });
    }
  });

  const btnCloseConfig = document.getElementById('btnCloseConfigModal');
  const btnCancelConfig = document.getElementById('btnCancelConfig');
  [btnCloseConfig, btnCancelConfig].forEach(btn => {
    if (btn) btn.addEventListener('click', () => ui.closeConfigModal());
  });

  const formConfig = document.getElementById('formConfig');
  if (formConfig) {
    formConfig.addEventListener('submit', (e) => {
      e.preventDefault();
      const url = document.getElementById('supabaseUrl').value;
      const key = document.getElementById('supabaseKey').value;

      try {
        saveSupabaseConfig(url, key);
        ui.closeConfigModal();
        ui.showToast({
          type: 'success',
          title: 'Configurações Salvas',
          message: 'As credenciais do Supabase foram atualizadas com sucesso.'
        });
        window.location.reload();
      } catch (err) {
        ui.showToast({
          type: 'error',
          title: 'Erro na Configuração',
          message: err.message
        });
      }
    });
  }
}

// Inicializa a aplicação ao carregar o DOM (ou imediatamente se já estiver carregado)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
