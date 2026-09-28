// ==============================================================================
// MÓDULO DE SERVIÇOS E OPERAÇÕES SUPABASE (api.js)
// INTEGRAÇÃO DIRETA "DIA ZERO" - SEM MOCKS OU ARRAYS LOCAIS
// ==============================================================================
import { getSupabase, isSupabaseConfigured } from './config.js';

let realtimeChannel = null;

/**
 * Garante que o cliente Supabase está ativo antes de qualquer operação
 */
function ensureClient() {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase não configurado. Por favor, conecte o projeto nas configurações.');
  }
  return getSupabase();
}

/**
 * Traduz erros do PostgreSQL em mensagens de fácil compreensão para a oficina
 * @param {Error|Object} error 
 */
function handleDatabaseError(error, customContext = '') {
  console.error('[Supabase DB Error]:', error);

  // Migração do histórico ainda não aplicada (função ou tabela inexistente na API)
  if (
    error?.code === 'PGRST202' ||
    error?.code === 'PGRST205' ||
    error?.code === '42P01' ||
    (error?.code === '42883' && error?.message?.includes('registrar_movimentacao'))
  ) {
    const customErr = new Error('O histórico de movimentações ainda não foi instalado no banco. Execute o script migrations/001_historico_movimentacoes.sql no SQL Editor do Supabase.');
    customErr.code = error.code;
    customErr.isSchemaError = true;
    return customErr;
  }

  // REGRA CRÍTICA: Código PostgreSQL 23514 = check_violation
  if (error?.code === '23514' || error?.message?.includes('violates check constraint')) {
    if (error?.message?.includes('pecas_preco_check')) {
      const customErr = new Error('Operação recusada pelo banco de dados: O preço unitário da peça não pode ser menor que zero.');
      customErr.isPriceConstraint = true;
      customErr.code = '23514';
      return customErr;
    }

    if (error?.message?.includes('pecas_quantidade_check')) {
      const customErr = new Error('Operação recusada pelo banco de dados: A quantidade solicitada excede o saldo físico disponível em estoque.');
      customErr.isStockConstraint = true;
      customErr.code = '23514';
      return customErr;
    }

    const customErr = new Error('Operação recusada pelo banco de dados: Violação de regra de integridade.');
    customErr.code = '23514';
    return customErr;
  }

  // Código 23505 = unique_violation (código de peça duplicado)
  if (error?.code === '23505') {
    const customErr = new Error('Conflito no banco: Já existe uma peça cadastrada com este código no almoxarifado.');
    customErr.code = '23505';
    return customErr;
  }

  // Erros de coluna inexistente ou schema cache desatualizado
  if (
    error?.code === '42703' || 
    error?.code === 'PGRST204' ||
    error?.code === 'PGRST200' ||
    error?.message?.includes('record "new" has no field') || 
    error?.message?.includes('update_at') ||
    error?.message?.includes('updated_at') ||
    error?.message?.includes('preco') ||
    error?.message?.includes('schema cache')
  ) {
    if (error?.message?.includes('preco') || error?.message?.includes('"preco"') || error?.details?.includes('preco')) {
      const customErr = new Error('A coluna "preco" ainda não foi sincronizada na API do Supabase. Execute o script add_preco_column.sql e rode NOTIFY pgrst, \'reload schema\'; no SQL Editor.');
      customErr.code = '42703';
      customErr.isSchemaError = true;
      return customErr;
    }

    const customErr = new Error('A tabela no Supabase não possui a coluna "updated_at", mas há um trigger tentando atualizá-la. Execute o script fix_updated_at.sql no SQL Editor do Supabase.');
    customErr.code = '42703';
    customErr.isSchemaError = true;
    return customErr;
  }

  // Erros de RLS / Permissão
  if (error?.code === '42501' || error?.message?.includes('permission denied')) {
    return new Error('Acesso negado pelas políticas de segurança (RLS). Faça login para continuar.');
  }

  return new Error(error?.message || `Erro de banco de dados ao ${customContext}`);
}

/**
 * READ: Consulta todas as peças cadastradas na tabela 'pecas' do Supabase
 * @returns {Promise<Array>}
 */
export async function listarPecas() {
  const supabase = ensureClient();

  const { data, error } = await supabase
    .from('pecas')
    .select('id, codigo, descricao, quantidade, preco, created_at')
    .order('descricao', { ascending: true });

  if (error) {
    throw handleDatabaseError(error, 'consultar peças');
  }

  return data || [];
}

/**
 * CREATE: Cadastra uma nova peça automotiva
 * Permite definir quantidade inicial e preço unitário.
 * @param {Object} param0 
 * @param {string} param0.codigo
 * @param {string} param0.descricao
 * @param {number} [param0.quantidade=0]
 * @param {number|string} [param0.preco=0]
 * @returns {Promise<Object>}
 */
export async function cadastrarPeca({ codigo, descricao, quantidade = 0, preco = 0 }) {
  const supabase = ensureClient();

  if (!codigo || !descricao) {
    throw new Error('Código e Descrição da peça são obrigatórios.');
  }

  const qtd = parseInt(quantidade, 10);
  if (isNaN(qtd) || qtd < 0) {
    throw new Error('A quantidade inicial deve ser um número inteiro maior ou igual a zero.');
  }

  let parsedPreco = 0;
  if (preco !== undefined && preco !== null && preco !== '') {
    if (typeof preco === 'number') {
      parsedPreco = preco;
    } else {
      let str = String(preco).trim().replace(/[R$\s]/g, '');
      if (str.includes(',') && str.includes('.')) {
        str = str.replace(/\./g, '').replace(',', '.');
      } else if (str.includes(',')) {
        str = str.replace(',', '.');
      }
      parsedPreco = parseFloat(str);
    }
  }
  if (isNaN(parsedPreco) || parsedPreco < 0) {
    throw new Error('O preço unitário deve ser um número maior ou igual a zero.');
  }
  parsedPreco = Number(parsedPreco.toFixed(2));

  const novaPeca = {
    codigo: codigo.trim().toUpperCase(),
    descricao: descricao.trim(),
    quantidade: qtd,
    preco: parsedPreco
  };

  console.log('[Supabase API] Enviando cadastro de peça:', novaPeca);

  const { data, error } = await supabase
    .from('pecas')
    .insert([novaPeca])
    .select()
    .single();

  if (error) {
    console.error('[Supabase API] Erro ao cadastrar:', error);
    throw handleDatabaseError(error, 'cadastrar nova peça');
  }

  console.log('[Supabase API] Peça salva com sucesso:', data);
  return data;
}

/**
 * Converte preço digitado (pt-BR ou en) em número com 2 casas. Retorna null se vazio/ inválido.
 * @param {number|string|null} valor
 * @returns {number|null}
 */
function parsePrecoOpcional(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  let parsed;
  if (typeof valor === 'number') {
    parsed = valor;
  } else {
    let str = String(valor).trim().replace(/[R$\s]/g, '');
    if (str.includes(',') && str.includes('.')) {
      str = str.replace(/\./g, '').replace(',', '.');
    } else if (str.includes(',')) {
      str = str.replace(',', '.');
    }
    parsed = parseFloat(str);
  }
  if (isNaN(parsed) || parsed < 0) return null;
  return Number(parsed.toFixed(2));
}

function textoOuNull(valor) {
  const t = (valor ?? '').toString().trim();
  return t === '' ? null : t;
}

/**
 * MOVIMENTAÇÃO AUDITADA (ENTRADA / BAIXA)
 * Chama a função registrar_movimentacao no PostgreSQL, que:
 *  - soma/subtrai o saldo numa única instrução (seguro entre terminais)
 *  - grava o histórico com operador (lido do login, no servidor), data/hora,
 *    cliente, placa e veículo
 *  - continua respeitando a constraint pecas_quantidade_check (erro 23514)
 * Requer a migração migrations/001_historico_movimentacoes.sql aplicada.
 * @param {string} id UUID da peça
 * @param {'ENTRADA'|'BAIXA'} tipo
 * @param {number} quantidade Valor positivo
 * @param {Object} [dados]
 * @returns {Promise<Object>} Peça atualizada
 */
export async function registrarMovimentacao(id, tipo, quantidade, dados = {}) {
  const supabase = ensureClient();
  const qtd = parseInt(quantidade, 10);

  if (isNaN(qtd) || qtd <= 0) {
    throw new Error('Informe uma quantidade válida superior a zero.');
  }

  const cliente = textoOuNull(dados.cliente);
  if (tipo === 'BAIXA' && !cliente) {
    throw new Error('Informe o nome do cliente para registrar a baixa.');
  }

  const payload = {
    p_peca_id: id,
    p_tipo: tipo,
    p_quantidade: qtd,
    p_cliente_nome: tipo === 'BAIXA' ? cliente : null,
    p_veiculo_placa: tipo === 'BAIXA' ? textoOuNull(dados.placa) : null,
    p_veiculo_descricao: tipo === 'BAIXA' ? textoOuNull(dados.veiculo) : null,
    p_observacao: textoOuNull(dados.observacao),
    p_novo_preco: tipo === 'ENTRADA' ? parsePrecoOpcional(dados.novoPreco) : null
  };

  const { data, error } = await supabase.rpc('registrar_movimentacao', payload);

  if (error) {
    throw handleDatabaseError(error, tipo === 'BAIXA' ? 'efetuar baixa de estoque' : 'efetuar entrada de estoque');
  }

  return data;
}

/**
 * UPDATE (ENTRADA): Registra entrada de estoque com histórico
 * @param {string} id UUID da peça
 * @param {number} quantidadeAdicionar Valor a somar (> 0)
 * @param {number|string|null} [novoPreco=null] Novo preço unitário se ajustado nesta entrada
 * @param {string|null} [observacao=null]
 * @returns {Promise<Object>}
 */
export async function darEntrada(id, quantidadeAdicionar, novoPreco = null, observacao = null) {
  return registrarMovimentacao(id, 'ENTRADA', quantidadeAdicionar, { novoPreco, observacao });
}

/**
 * UPDATE (BAIXA): Registra baixa de estoque com destino (cliente / placa / veículo)
 * Se a quantidade exceder o saldo, o PostgreSQL recusa com erro 23514.
 * @param {string} id UUID da peça
 * @param {number} quantidadeSubtrair Valor a subtrair (> 0)
 * @param {{cliente: string, placa?: string, veiculo?: string, observacao?: string}} destino
 * @returns {Promise<Object>}
 */
export async function darBaixa(id, quantidadeSubtrair, destino = {}) {
  return registrarMovimentacao(id, 'BAIXA', quantidadeSubtrair, destino);
}

/**
 * READ: Consulta o histórico de movimentações (mais recentes primeiro)
 * @param {Object} filtros
 * @param {string} [filtros.pecaId]
 * @param {string} [filtros.tipo] ENTRADA | BAIXA | AJUSTE | CADASTRO | EXCLUSAO
 * @param {string} [filtros.busca] Cliente, placa, veículo, código, descrição ou operador
 * @param {string} [filtros.de] Data inicial (YYYY-MM-DD, horário local)
 * @param {string} [filtros.ate] Data final (YYYY-MM-DD, inclusiva, horário local)
 * @param {number} [filtros.limite=50]
 * @param {number} [filtros.offset=0]
 * @returns {Promise<{ registros: Array, total: number }>}
 */
export async function listarMovimentacoes({ pecaId, tipo, busca, de, ate, limite = 50, offset = 0 } = {}) {
  const supabase = ensureClient();

  let query = supabase
    .from('movimentacoes')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limite - 1);

  if (pecaId) query = query.eq('peca_id', pecaId);
  if (tipo) query = query.eq('tipo', tipo);

  if (de) {
    const inicio = new Date(`${de}T00:00:00`);
    if (!isNaN(inicio)) query = query.gte('created_at', inicio.toISOString());
  }
  if (ate) {
    const fim = new Date(`${ate}T00:00:00`);
    if (!isNaN(fim)) {
      fim.setDate(fim.getDate() + 1);
      query = query.lt('created_at', fim.toISOString());
    }
  }

  // Remove caracteres que quebram a sintaxe do filtro "or" do PostgREST
  const termo = (busca || '').replace(/[,()*%\\:"]/g, ' ').trim();
  if (termo) {
    const placa = termo.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const condicoes = [
      `cliente_nome.ilike."*${termo}*"`,
      `veiculo_descricao.ilike."*${termo}*"`,
      `peca_codigo.ilike."*${termo}*"`,
      `peca_descricao.ilike."*${termo}*"`,
      `usuario_email.ilike."*${termo}*"`,
      `observacao.ilike."*${termo}*"`
    ];
    if (placa) condicoes.push(`veiculo_placa.ilike."*${placa}*"`);
    query = query.or(condicoes.join(','));
  }

  const { data, error, count } = await query;

  if (error) {
    throw handleDatabaseError(error, 'consultar histórico de movimentações');
  }

  return { registros: data || [], total: count ?? (data || []).length };
}

/**
 * UPDATE (CRUD COMPLETO): Atualiza os dados cadastrais da peça (código, descrição, quantidade e preço)
 * @param {string} id UUID da peça
 * @param {Object} dados
 * @param {string} dados.codigo
 * @param {string} dados.descricao
 * @param {number} dados.quantidade
 * @param {number|string} [dados.preco=0]
 * @returns {Promise<Object>}
 */
export async function atualizarPeca(id, { codigo, descricao, quantidade, preco }) {
  const supabase = ensureClient();

  if (!id) throw new Error('ID da peça é obrigatório para atualização.');
  if (!codigo || !descricao) {
    throw new Error('Código e Descrição da peça são obrigatórios.');
  }

  const qtd = parseInt(quantidade, 10);
  if (isNaN(qtd) || qtd < 0) {
    throw new Error('A quantidade deve ser um número inteiro maior ou igual a zero.');
  }

  let parsedPreco = 0;
  if (preco !== undefined && preco !== null && preco !== '') {
    if (typeof preco === 'number') {
      parsedPreco = preco;
    } else {
      let str = String(preco).trim().replace(/[R$\s]/g, '');
      if (str.includes(',') && str.includes('.')) {
        str = str.replace(/\./g, '').replace(',', '.');
      } else if (str.includes(',')) {
        str = str.replace(',', '.');
      }
      parsedPreco = parseFloat(str);
    }
  }
  if (isNaN(parsedPreco) || parsedPreco < 0) {
    throw new Error('O preço unitário deve ser um número maior ou igual a zero.');
  }
  parsedPreco = Number(parsedPreco.toFixed(2));

  const payload = {
    codigo: codigo.trim().toUpperCase(),
    descricao: descricao.trim().toUpperCase(),
    quantidade: qtd,
    preco: parsedPreco
  };

  console.log('[Supabase API] Enviando atualização de peça:', id, payload);

  const { data, error } = await supabase
    .from('pecas')
    .update(payload)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('[Supabase API] Erro ao atualizar:', error);
    throw handleDatabaseError(error, 'atualizar cadastro da peça');
  }

  console.log('[Supabase API] Peça atualizada com sucesso:', data);
  return data;
}

/**
 * DELETE: Remove uma peça do catálogo
 * @param {string} id UUID da peça
 * @returns {Promise<boolean>}
 */
export async function excluirPeca(id) {
  const supabase = ensureClient();

  const { error } = await supabase
    .from('pecas')
    .delete()
    .eq('id', id);

  if (error) {
    throw handleDatabaseError(error, 'excluir peça');
  }

  return true;
}

/**
 * REALTIME: Inscreve-se nas alterações em tempo real da tabela 'pecas'
 * Captura INSERT, UPDATE e DELETE disparados por outros operadores/terminais.
 * @param {Function} onPayload Callback que recebe o payload com { eventType, new, old }
 * @param {Function} onStatusChange Callback para monitorar o status do canal
 * @returns {Object} Canal do Supabase Realtime
 */
export function subscreverRealtime(onPayload, onStatusChange) {
  const supabase = ensureClient();

  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
  }

  realtimeChannel = supabase
    .channel('almoxarifado-pecas-live')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'pecas'
      },
      (payload) => {
        console.log('[Realtime Event]', payload.eventType, payload);
        if (onPayload) {
          onPayload(payload);
        }
      }
    )
    .subscribe((status) => {
      console.log('[Realtime Status]', status);
      if (onStatusChange) {
        onStatusChange(status);
      }
    });

  return realtimeChannel;
}

/**
 * Remove a inscrição do canal Realtime (usado no logout)
 */
export function desinscreverRealtime() {
  const supabase = getSupabase();
  if (supabase && realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}
