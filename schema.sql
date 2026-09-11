-- ==============================================================================
-- SISTEMA DE CONTROLE DE ALMOXARIFADO DE PEÇAS AUTOMOTIVAS
-- SCRIPT DE INFRAESTRUTURA POSTGRESQL / SUPABASE (DIA ZERO)
-- ==============================================================================
-- Execute este script no SQL Editor do seu projeto Supabase:
-- https://supabase.com/dashboard/project/_/sql

-- 1. CRIAÇÃO DA TABELA DE PEÇAS
CREATE TABLE IF NOT EXISTS public.pecas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo VARCHAR(50) NOT NULL UNIQUE,
    descricao VARCHAR(255) NOT NULL,
    quantidade INTEGER NOT NULL DEFAULT 0,
    preco NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,

    -- REGRAS DE NEGÓCIO CRÍTICAS ENFORÇADAS NO POSTGRESQL:
    -- 1. O saldo de estoque físico nunca pode ser menor que zero.
    -- 2. O preço unitário da peça nunca pode ser negativo.
    CONSTRAINT pecas_quantidade_check CHECK (quantidade >= 0),
    CONSTRAINT pecas_preco_check CHECK (preco >= 0)
);

-- Garante que as colunas updated_at e preco existem caso a tabela já tenha sido criada anteriormente
ALTER TABLE public.pecas 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now());

ALTER TABLE public.pecas 
ADD COLUMN IF NOT EXISTS preco NUMERIC(10,2) NOT NULL DEFAULT 0.00;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'pecas_preco_check'
    ) THEN
        ALTER TABLE public.pecas ADD CONSTRAINT pecas_preco_check CHECK (preco >= 0);
    END IF;
END $$;

-- 2. TRIGGER PARA ATUALIZAÇÃO AUTOMÁTICA DE updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_pecas_updated_at ON public.pecas;
CREATE TRIGGER set_pecas_updated_at
    BEFORE UPDATE ON public.pecas
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- 3. SEGURANÇA E ROW LEVEL SECURITY (RLS)
ALTER TABLE public.pecas ENABLE ROW LEVEL SECURITY;

-- Política de Leitura: Usuários autenticados podem consultar o inventário
DROP POLICY IF EXISTS "Permitir leitura para autenticados" ON public.pecas;
CREATE POLICY "Permitir leitura para autenticados"
    ON public.pecas FOR SELECT
    TO authenticated
    USING (true);

-- Política de Inserção: Usuários autenticados podem cadastrar novas peças
DROP POLICY IF EXISTS "Permitir cadastro para autenticados" ON public.pecas;
CREATE POLICY "Permitir cadastro para autenticados"
    ON public.pecas FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Política de Atualização: Usuários autenticados podem movimentar estoque
DROP POLICY IF EXISTS "Permitir atualizacao para autenticados" ON public.pecas;
CREATE POLICY "Permitir atualizacao para autenticados"
    ON public.pecas FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Política de Exclusão: Usuários autenticados podem remover peças
DROP POLICY IF EXISTS "Permitir exclusao para autenticados" ON public.pecas;
CREATE POLICY "Permitir exclusao para autenticados"
    ON public.pecas FOR DELETE
    TO authenticated
    USING (true);

-- 4. ATIVAÇÃO DO SUPABASE REALTIME
-- Adiciona a tabela à publicação para que clientes conectados recebam postgres_changes
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND schemaname = 'public' 
        AND tablename = 'pecas'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.pecas;
    END IF;
END $$;

-- 5. FUNCTION ATÔMICA PARA MOVIMENTAÇÃO DE ESTOQUE (OPCIONAL / RECOMENDADA)
-- Garante concorrência segura em múltiplos terminais e ativa a constraint pecas_quantidade_check
CREATE OR REPLACE FUNCTION public.movimentar_estoque(
    p_id UUID,
    p_quantidade INT
)
RETURNS public.pecas AS $$
DECLARE
    v_peca public.pecas;
BEGIN
    UPDATE public.pecas
    SET quantidade = quantidade + p_quantidade
    WHERE id = p_id
    RETURNING * INTO v_peca;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Peça não encontrada no almoxarifado (ID: %)', p_id;
    END IF;

    RETURN v_peca;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. DADOS INICIAIS DE TESTE (CATÁLOGO AUTOMOTIVO REALISTA)
INSERT INTO public.pecas (codigo, descricao, quantidade, preco) VALUES
    ('FL-0144', 'Filtro de Óleo Fram PH5949 (Linha GM/Fiat 1.0-1.8)', 24, 38.50),
    ('PF-2088', 'Jogo Pastilhas Freio Dianteiro Bosch Cerâmica (HB20 / Creta)', 12, 149.90),
    ('VI-3012', 'Jogo de Velas de Ignição NGK Laser Iridium (Civic / Corolla)', 8, 280.00),
    ('CD-5501', 'Correia Dentada Continental Contitech CT1044 (VW Gol/Fox)', 15, 85.00),
    ('AM-9020', 'Amortecedor Dianteiro Pressurizado Monroe OESpectrum (Renegade)', 4, 450.00),
    ('DF-1102', 'Par Discos de Freio Ventilados Fremax Dianteiro (Onix 1.0 Turbo)', 6, 320.00),
    ('FB-0045', 'Fluido de Freio DOT 4 Bosch 500ml', 30, 32.00),
    ('FA-8812', 'Filtro de Ar do Motor Mahle LX3418 (Compass 2.0 Flex)', 0, 58.00),
    ('BP-4430', 'Bomba de Combustível Eletroeletrônica Bosch 3.5 Bar (Universal)', 3, 210.00),
    ('BL-7701', 'Bieleta da Barra Estabilizadora Dianteira Nakata (Palio / Uno)', 0, 48.00)
ON CONFLICT (codigo) DO UPDATE SET preco = EXCLUDED.preco;

-- 7. USUÁRIOS E AUTENTICAÇÃO (SUPABASE AUTH)
-- Os usuários ficam armazenados no esquema seguro "auth.users" gerenciado pelo Supabase.
-- Você pode criar o login de 2 formas simples:
-- 1. No painel do Supabase: Acesse Authentication -> Users -> Add User -> Create User
--    (Ex: mecanico@oficina.com / senha: sua-senha)
-- 2. Na própria tela do sistema: Preencha o e-mail e senha e clique em "Cadastrar Novo Operador".

