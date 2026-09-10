-- ==============================================================================
-- CORREÇÃO DO ERRO: record "new" has no field "updated_at" / "update_at"
-- Execute este script no SQL Editor do seu projeto Supabase:
-- https://supabase.com/dashboard/project/_/sql
-- ==============================================================================

-- 1. Garante que a coluna updated_at existe na tabela public.pecas
ALTER TABLE public.pecas 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now());

-- 2. Se por acaso a coluna existia com nome incorreto ("update_at"), renomeia para "updated_at"
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'pecas' 
        AND column_name = 'update_at'
    ) THEN
        ALTER TABLE public.pecas RENAME COLUMN update_at TO updated_at;
    END IF;
END $$;

-- 3. Atualiza ou recria a função do trigger para apontar para NEW.updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Recria o trigger set_pecas_updated_at
DROP TRIGGER IF EXISTS set_pecas_updated_at ON public.pecas;
CREATE TRIGGER set_pecas_updated_at
    BEFORE UPDATE ON public.pecas
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- ==============================================================================
-- DICA: Se você NÃO quiser usar o campo updated_at e quiser apenas desativar o trigger:
-- DROP TRIGGER IF EXISTS set_pecas_updated_at ON public.pecas;
-- ==============================================================================
