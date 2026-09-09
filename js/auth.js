// ==============================================================================
// MÓDULO DE AUTENTICAÇÃO E SESSÃO SUPABASE (auth.js)
// ==============================================================================
import { getSupabase, isSupabaseConfigured } from './config.js';

/**
 * Realiza o login com E-mail e Senha
 * @param {string} email 
 * @param {string} password 
 * @returns {Promise<{ user, session }>}
 */
export async function signIn(email, password) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase não configurado. Defina a URL e a Anon Key nas configurações.');
  }

  const supabase = getSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password: password
  });

  if (error) {
    console.error('Erro de autenticação Supabase:', error);
    if (error.message.includes('Invalid login credentials')) {
      throw new Error('E-mail ou senha incorretos. Verifique suas credenciais de acesso à oficina.');
    }
    throw new Error(error.message || 'Falha ao autenticar no almoxarifado.');
  }

  return data;
}

/**
 * Cadastra um novo operador/mecânico no Supabase Auth
 * @param {string} email 
 * @param {string} password 
 * @returns {Promise<{ user, session }>}
 */
export async function signUp(email, password) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase não configurado.');
  }

  const supabase = getSupabase();
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password: password
  });

  if (error) {
    throw new Error(error.message || 'Erro ao cadastrar operador.');
  }

  return data;
}

/**
 * Encerra a sessão ativa do usuário
 */
export async function signOut() {
  const supabase = getSupabase();
  if (!supabase) return;

  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error('Erro ao deslogar:', error);
    throw new Error(error.message);
  }
}

/**
 * Obtém a sessão ativa no momento da inicialização
 * @returns {Promise<Session|null>}
 */
export async function getSession() {
  if (!isSupabaseConfigured()) return null;

  const supabase = getSupabase();
  const { data: { session }, error } = await supabase.auth.getSession();
  
  if (error) {
    console.warn('Erro ao consultar sessão ativa:', error);
    return null;
  }

  return session;
}

/**
 * Observa alterações no estado de autenticação (LOGIN, LOGOUT, TOKEN_REFRESHED)
 * @param {Function} callback 
 * @returns {Subscription|null}
 */
export function onAuthStateChange(callback) {
  if (!isSupabaseConfigured()) return null;

  const supabase = getSupabase();
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });

  return subscription;
}

/**
 * Retorna o usuário logado atualmente
 * @returns {Promise<User|null>}
 */
export async function getCurrentUser() {
  if (!isSupabaseConfigured()) return null;

  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}
