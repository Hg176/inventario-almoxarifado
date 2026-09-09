# Walkthrough: Frontend de Almoxarifado Automotivo (Supabase Day-Zero)

Desenvolvemos o frontend completo e responsivo para o controle de almoxarifado de peças automotivas, integrado nativamente ao **Supabase** via SDK oficial (`@supabase/supabase-js`), sem mocks locais.

---

## 1. O que Foi Construído

| Módulo / Arquivo | Responsabilidade |
| :--- | :--- |
| [`index.html`](file:///e:/Users/Hugo%20dos%20Santos/Documents/Inventario%20Pontual/index.html) | Shell da aplicação com Views alternadas (Login obrigatório e Dashboard de Peças). |
| [`schema.sql`](file:///e:/Users/Hugo%20dos%20Santos/Documents/Inventario%20Pontual/schema.sql) | Script DDL do PostgreSQL: Tabela `pecas`, `CONSTRAINT pecas_quantidade_check CHECK (quantidade >= 0)`, RLS, Realtime e dados de exemplo. |
| [`js/config.js`](file:///e:/Users/Hugo%20dos%20Santos/Documents/Inventario%20Pontual/js/config.js) | Inicialização do SDK Supabase, persistência local de credenciais e utilitários de conexão. |
| [`js/auth.js`](file:///e:/Users/Hugo%20dos%20Santos/Documents/Inventario%20Pontual/js/auth.js) | Controle de sessão com `signInWithPassword`, `signOut`, `getSession` e `onAuthStateChange`. |
| [`js/api.js`](file:///e:/Users/Hugo%20dos%20Santos/Documents/Inventario%20Pontual/js/api.js) | Operações CRUD diretas, captura e tradução do erro `23514` do PostgreSQL e canais Realtime. |
| [`js/ui.js`](file:///e:/Users/Hugo%20dos%20Santos/Documents/Inventario%20Pontual/js/ui.js) | Renderização do DOM, modais de confirmação rápida com preview de saldo, badges de estoque e toasts. |
| [`js/app.js`](file:///e:/Users/Hugo%20dos%20Santos/Documents/Inventario%20Pontual/js/app.js) | Orquestração do ciclo de vida, eventos de formulário, busca em tempo real e filtros de status. |
| [`css/`](file:///e:/Users/Hugo%20dos%20Santos/Documents/Inventario%20Pontual/css) | Design system moderno para oficina automotiva: Dark Slate, paleta semântica, microanimações e responsividade. |

---

## 2. Demonstração Visual das Interfaces e Fluxos

````carousel
![Tela de Autenticação Segura para Operadores](C:\Users\Hugo dos Santos\.gemini\antigravity-ide\brain\4285ec80-4cbe-495c-a0a5-b5c61af43766\screenshot_login.png)
<!-- slide -->
![Modal de Conexão Supabase no Padrão Dia Zero](C:\Users\Hugo dos Santos\.gemini\antigravity-ide\brain\4285ec80-4cbe-495c-a0a5-b5c61af43766\screenshot_login_config.png)
<!-- slide -->
![Dashboard do Almoxarifado com Métricas e Tabela de Peças](C:\Users\Hugo dos Santos\.gemini\antigravity-ide\brain\4285ec80-4cbe-495c-a0a5-b5c61af43766\screenshot_dashboard.png)
<!-- slide -->
![Modal de Entrada Rápida de Estoque com Botões de Incremento](C:\Users\Hugo dos Santos\.gemini\antigravity-ide\brain\4285ec80-4cbe-495c-a0a5-b5c61af43766\screenshot_modal_entrada.png)
<!-- slide -->
![Modal de Baixa com Alerta Prévia de Estoque Negativo](C:\Users\Hugo dos Santos\.gemini\antigravity-ide\brain\4285ec80-4cbe-495c-a0a5-b5c61af43766\screenshot_modal_baixa_warning.png)
<!-- slide -->
![Alerta Visual (Toast) Capturando o Erro 23514 do PostgreSQL](C:\Users\Hugo dos Santos\.gemini\antigravity-ide\brain\4285ec80-4cbe-495c-a0a5-b5c61af43766\screenshot_error_toast.png)
<!-- slide -->
![Modal de Cadastro de Nova Peça com Quantidade Inicial Zero](C:\Users\Hugo dos Santos\.gemini\antigravity-ide\brain\4285ec80-4cbe-495c-a0a5-b5c61af43766\screenshot_modal_nova_peca.png)
<!-- slide -->
![Sincronização em Tempo Real (Realtime) com Destaque Luminoso](C:\Users\Hugo dos Santos\.gemini\antigravity-ide\brain\4285ec80-4cbe-495c-a0a5-b5c61af43766\screenshot_realtime_sync.png)
````

---

## 3. Validação das Regras de Negócio Técnicas

### 3.1 Autenticação e Segurança
- O sistema inicializa bloqueado em tela de login (`#loginView`).
- `auth.js` verifica a existência de sessão ativa com `supabase.auth.getSession()`.
- Se a sessão for válida, transiciona automaticamente para o dashboard e exibe o e-mail do mecânico logado.

### 3.2 Cadastro com Quantidade Inicial Zero
- O formulário em `modalNewPart` recebe apenas **Código** e **Descrição**.
- A inserção enviada ao Supabase define compulsoriamente `quantidade: 0`.

### 3.3 Regra Crítica: Integridade de Estoque no PostgreSQL
- A validação ocorre a nível de banco de dados através da constraint DDL:
  ```sql
  CONSTRAINT pecas_quantidade_check CHECK (quantidade >= 0)
  ```
- Ao tentar subtrair mais peças do que o saldo físico disponível, a transação é abortada pelo PostgreSQL, retornando o código de erro **`23514`**.
- O módulo `api.js` intercepta esse erro e o repassa ao sistema de toasts:
  > *"Operação recusada pelo banco de dados: A quantidade solicitada excede o saldo físico disponível em estoque."*

### 3.4 Sincronização em Tempo Real (Supabase Realtime)
- O canal `postgres_changes` escuta mutações na tabela `pecas`:
  ```javascript
  supabase.channel('almoxarifado-pecas-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pecas' }, callback)
    .subscribe();
  ```
- Ao receber atualizações disparadas por outros terminais (ex: Terminal B alterando a quantidade de filtros de óleo), o DOM é atualizado em tempo real na linha com animação luminosa de pulso (`.realtime-pulse-entrada` ou `.realtime-pulse-baixa`), sem recarregar a página.

---

## 4. Como Executar na Oficina

1. **Executar o Servidor Local**:
   ```bash
   python -m http.server 3333
   ```
2. **Configurar o Supabase**:
   - Execute o script [`schema.sql`](file:///e:/Users/Hugo%20dos%20Santos/Documents/Inventario%20Pontual/schema.sql) no SQL Editor do seu projeto Supabase.
   - Acesse `http://localhost:3333` e clique em **Configurar Chaves** para inserir o `Project URL` e `Anon Key`.
3. **Login**:
   - Crie um usuário mecânico no painel do Supabase Auth e realize o login para gerenciar o estoque.
