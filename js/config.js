// ==============================================================================
// CONFIGURAÇÃO CENTRAL DO CLIENTE SUPABASE (SDK OFICIAL)
// ==============================================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Chaves para o LocalStorage
const STORAGE_KEY_URL = 'almoxarifado_supabase_url';
const STORAGE_KEY_KEY = 'almoxarifado_supabase_anon_key';

// Credenciais padrão do projeto Supabase
const DEFAULT_URL = 'https://vmejwbfwyrbucsbjetxh.supabase.co';
const DEFAULT_KEY = 'sb_publishable_glM9Kx4YJDRpqL9R9AdtoA_dmnak0Om';

export function sanitizeSupabaseUrl(url) {
  if (!url) return '';
  let clean = url.trim().replace(/\/+$/, '');
  const dashboardMatch = clean.match(/supabase\.com\/dashboard\/project\/([a-z0-9]+)/i);
  if (dashboardMatch) {
    return `https://${dashboardMatch[1]}.supabase.co`;
  }
  return clean;
}

// Obtém do LocalStorage ou utiliza os padrões configurados
let storedRawUrl = localStorage.getItem(STORAGE_KEY_URL);
let SUPABASE_URL = sanitizeSupabaseUrl(storedRawUrl) || DEFAULT_URL;
let SUPABASE_ANON_KEY = localStorage.getItem(STORAGE_KEY_KEY) || DEFAULT_KEY;

let supabaseInstance = null;

function initializeSupabase(url, key) {
  const finalUrl = sanitizeSupabaseUrl(url);
  if (!finalUrl || !key) return null;
  try {
    return createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      },
      realtime: {
        params: {
          eventsPerSecond: 10
        }
      }
    });
  } catch (err) {
    console.error('Falha ao inicializar o cliente Supabase:', err);
    return null;
  }
}

// Inicializa a instância se os dados existirem
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabaseInstance = initializeSupabase(SUPABASE_URL, SUPABASE_ANON_KEY);
}

export function getSupabase() {
  return supabaseInstance;
}

export function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && supabaseInstance);
}

export function saveSupabaseConfig(url, anonKey) {
  if (!url || !anonKey) {
    throw new Error('URL e Anon Key do Supabase são obrigatórias.');
  }

  const cleanUrl = url.trim().replace(/\/+$/, '');
  const cleanKey = anonKey.trim();

  // Testar inicialização básica
  const client = initializeSupabase(cleanUrl, cleanKey);
  if (!client) {
    throw new Error('Credenciais inválidas para o Supabase SDK.');
  }

  SUPABASE_URL = cleanUrl;
  SUPABASE_ANON_KEY = cleanKey;
  supabaseInstance = client;

  localStorage.setItem(STORAGE_KEY_URL, cleanUrl);
  localStorage.setItem(STORAGE_KEY_KEY, cleanKey);

  return true;
}

export function getStoredConfig() {
  return {
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY
  };
}

export const supabase = {
  get client() {
    return supabaseInstance;
  }
};
