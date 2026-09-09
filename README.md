# Almoxarifado Pontual - Controle de Peças Automotivas

Frontend responsivo de alta precisão para controle de estoque de almoxarifado automotivo, construído no padrão **Dia Zero** com integração nativa ao **Supabase** via SDK oficial (`@supabase/supabase-js`).

---

## 🛠️ Arquitetura e Estrutura dos Arquivos

A aplicação foi desenvolvida em **ES6 Modules nativos**, sem necessidade de build complexo ou dependências de runtime pesadas:

```
Inventario Pontual/
├── index.html              # Shell da aplicação (Views de Login e Dashboard de Estoque)
├── schema.sql              # Script DDL PostgreSQL (Tabela pecas, CHECK constraint, RLS e Realtime)
├── README.md               # Documentação técnica de uso e implantação
├── css/
│   ├── variables.css      # Design tokens (paleta automotiva dark, tipografia, elevações)
│   ├── main.css           # Estrutura global, tela de login, métricas e grid responsivo
│   └── components.css     # Tabela estilizada, botões de ação, modais rápidos e toasts
└── js/
    ├── config.js          # Inicialização do SDK Supabase e persistência de credenciais
    ├── auth.js            # Autenticação (Login, Logout, Sessão ativa, Listeners)
    ├── api.js             # Operações CRUD diretas no Supabase e canais Realtime
    ├── ui.js              # Manipulação do DOM, renderização de tabela, modais e toasts
    └── app.js             # Orquestrador do ciclo de vida da aplicação
```

---

## 🚀 Como Executar o Projeto

### 1. Executar um Servidor Local
Por utilizar módulos JavaScript (`import` / `export`), abra a pasta através de qualquer servidor HTTP estático local:

**Opção A (Node.js / npx):**
```bash
npx serve .
```

**Opção B (Python):**
```bash
python -m http.server 3000
```

**Opção C (VS Code):**
Utilize a extensão **Live Server** clicando com o botão direito no `index.html` e escolhendo "Open with Live Server".

---

## 🗄️ Configuração do Supabase (Dia Zero)

### 1. Criar Tabelas e Regras de Negócio no Supabase
1. Acesse o painel do seu projeto no Supabase: [supabase.com](https://supabase.com).
2. Vá até o menu **SQL Editor** &rarr; **New query**.
3. Copie o conteúdo do arquivo [`schema.sql`](./schema.sql) e clique em **Run**.
4. O script criará:
   - Tabela `pecas` com as colunas `codigo`, `descricao`, `quantidade`, `created_at` e `updated_at`.
   - **Regra Crítica**: Constraint `CHECK (quantidade >= 0)` que impede estoque negativo diretamente no PostgreSQL.
   - Políticas de **Row Level Security (RLS)** para operadores autenticados.
   - Publicação na tabela `supabase_realtime` para sincronização instantânea.
   - Catálogo inicial de peças automotivas reais (Filtros Fram, Pastilhas Bosch, Velas NGK, etc.).

### 2. Conectar o Frontend
1. Ao abrir o sistema no navegador, caso não esteja configurado, o modal **Configurações da Conexão Supabase** abrirá automaticamente.
2. Informe o **Project URL** e a **Anon / Public API Key** (encontrados em *Project Settings &rarr; API*).
3. Clique em **Salvar Conexão**.

### 3. Autenticação dos Operadores
- Crie um usuário mecânico/gestor no painel do Supabase (*Authentication &rarr; Users &rarr; Add User*) ou via API.
- Faça login na tela inicial com o e-mail e senha cadastrados.

---

## ⚙️ Regras de Negócio Implementadas

1. **Autenticação Obrigatória**:
   - A inicialização verifica se há sessão ativa (`supabase.auth.getSession()`).
   - Somente operadores logados visualizam a tabela e podem realizar entradas ou baixas.
2. **Cadastro com Quantidade Inicial Zero**:
   - Ao cadastrar uma peça informando apenas Código e Descrição, a quantidade é gravada obrigatoriamente como `0`.
3. **Validação de Estoque Negativo no PostgreSQL**:
   - As baixas são submetidas diretamente ao banco.
   - Caso a quantidade solicitada seja maior que o saldo em estoque, o PostgreSQL aciona a constraint `pecas_quantidade_check` e rejeita a transação com o código de erro `23514`.
   - O `api.js` intercepta esse erro e o traduz para o toast:
     > *"Operação recusada pelo banco de dados: A quantidade solicitada excede o saldo físico disponível em estoque."*
4. **Sincronização em Tempo Real (Supabase Realtime)**:
   - A tabela escuta eventos de `INSERT`, `UPDATE` e `DELETE` via `postgres_changes`.
   - Quando um operador no Terminal A efetua uma baixa, o Terminal B atualiza a quantidade imediatamente na linha correspondente com uma animação de pulso luminoso, sem recarregar a página.
