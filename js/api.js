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

  // REGRA CRÍTICA: Código PostgreSQL 23514 = check_violation (pecas_quantidade_check)
  const isCheckViolation = 
    error?.code === '23514' || 
    error?.message?.includes('violates check constraint') ||
    error?.message?.includes('pecas_quantidade_check');

  if (isCheckViolation) {
    const customErr = new Error('Operação recusada pelo banco de dados: A quantidade solicitada excede o saldo físico disponível em estoque.');
    customErr.isStockConstraint = true;
    customErr.code = '23514';
    return customErr;
  }

  // Código 23505 = unique_violation (código de peça duplicado)
  if (error?.code === '23505') {
    const customErr = new Error('Conflito no banco: Já existe uma peça cadastrada com este código no almoxarifado.');
    customErr.code = '23505';
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
    .select('id, codigo, descricao, quantidade, created_at')
    .order('descricao', { ascending: true });

  if (error) {
    throw handleDatabaseError(error, 'consultar peças');
  }

  return data || [];
}

/**
 * CREATE: Cadastra uma nova peça automotiva
 * Permite definir a quantidade inicial de estoque (mínimo 0).
 * @param {Object} param0 
 * @param {string} param0.codigo
 * @param {string} param0.descricao
 * @param {number} [param0.quantidade=0]
 * @returns {Promise<Object>}
 */
export async function cadastrarPeca({ codigo, descricao, quantidade = 0 }) {
  const supabase = ensureClient();

  if (!codigo || !descricao) {
    throw new Error('Código e Descrição da peça são obrigatórios.');
  }

  const qtd = parseInt(quantidade, 10);
  if (isNaN(qtd) || qtd < 0) {
    throw new Error('A quantidade inicial deve ser um número inteiro maior ou igual a zero.');
  }

  const novaPeca = {
    codigo: codigo.trim().toUpperCase(),
    descricao: descricao.trim(),
    quantidade: qtd
  };

  const { data, error } = await supabase
    .from('pecas')
    .insert([novaPeca])
    .select()
    .single();

  if (error) {
    throw handleDatabaseError(error, 'cadastrar nova peça');
  }

  return data;
}

/**
 * UPDATE (ENTRADA): Registra entrada de estoque
 * Envia a alteração diretamente ao Supabase.
 * @param {string} id UUID da peça
 * @param {number} quantidadeAdicionar Valor a somar (> 0)
 * @returns {Promise<Object>}
 */
export async function darEntrada(id, quantidadeAdicionar) {
  const supabase = ensureClient();
  const qtd = parseInt(quantidadeAdicionar, 10);

  if (isNaN(qtd) || qtd <= 0) {
    throw new Error('Informe uma quantidade válida superior a zero para dar entrada.');
  }

  // Tenta executar via RPC atômico caso o script SQL tenha sido executado com a função
  const { data: rpcData, error: rpcError } = await supabase.rpc('movimentar_estoque', {
    p_id: id,
    p_quantidade: qtd
  });

  if (!rpcError && rpcData) {
    return rpcData;
  }

  // Fallback padrão direto na tabela via SDK Supabase
  const { data: pecaAtual, error: fetchError } = await supabase
    .from('pecas')
    .select('quantidade')
    .eq('id', id)
    .single();

  if (fetchError) {
    throw handleDatabaseError(fetchError, 'consultar saldo para entrada');
  }

  const novoSaldo = (pecaAtual.quantidade || 0) + qtd;

  const { data, error } = await supabase
    .from('pecas')
    .update({ quantidade: novoSaldo })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw handleDatabaseError(error, 'efetuar entrada de estoque');
  }

  return data;
}

/**
 * UPDATE (BAIXA): Registra baixa de estoque
 * A validação principal ocorre no PostgreSQL através da constraint:
 * CONSTRAINT pecas_quantidade_check CHECK (quantidade >= 0)
 * O frontend envia a transação ao banco e intercepta o erro 23514 do PostgreSQL.
 * @param {string} id UUID da peça
 * @param {number} quantidadeSubtrair Valor a subtrair (> 0)
 * @returns {Promise<Object>}
 */
export async function darBaixa(id, quantidadeSubtrair) {
  const supabase = ensureClient();
  const qtd = parseInt(quantidadeSubtrair, 10);

  if (isNaN(qtd) || qtd <= 0) {
    throw new Error('Informe uma quantidade válida superior a zero para dar baixa.');
  }

  // Tenta executar via RPC atômico que dispara o check constraint
  const { data: rpcData, error: rpcError } = await supabase.rpc('movimentar_estoque', {
    p_id: id,
    p_quantidade: -qtd
  });

  if (!rpcError && rpcData) {
    return rpcData;
  }

  if (rpcError && (rpcError.code === '23514' || rpcError.message?.includes('pecas_quantidade_check'))) {
    throw handleDatabaseError(rpcError, 'efetuar baixa de estoque');
  }

  // Fallback direto na tabela via SDK Supabase
  const { data: pecaAtual, error: fetchError } = await supabase
    .from('pecas')
    .select('quantidade')
    .eq('id', id)
    .single();

  if (fetchError) {
    throw handleDatabaseError(fetchError, 'consultar saldo para baixa');
  }

  const novoSaldo = (pecaAtual.quantidade || 0) - qtd;

  // Enviamos o novoSaldo ao PostgreSQL. Se novoSaldo < 0, o PostgreSQL dispara o erro 23514
  const { data, error } = await supabase
    .from('pecas')
    .update({ quantidade: novoSaldo })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw handleDatabaseError(error, 'efetuar baixa de estoque');
  }

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
