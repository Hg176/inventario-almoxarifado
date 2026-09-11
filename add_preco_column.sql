-- ==============================================================================
-- MIGRAÇÃO: ADIÇÃO DO CAMPO DE PREÇO NA TABELA DE PEÇAS
-- ==============================================================================
-- Execute este script no SQL Editor do seu projeto Supabase:
-- https://supabase.com/dashboard/project/_/sql
-- ==============================================================================

-- 1. Adiciona a coluna preco se ainda não existir (padrão 0.00)
ALTER TABLE public.pecas 
ADD COLUMN IF NOT EXISTS preco NUMERIC(10,2) NOT NULL DEFAULT 0.00;

-- 2. Adiciona a constraint de validação de preço não-negativo
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'pecas_preco_check'
    ) THEN
        ALTER TABLE public.pecas ADD CONSTRAINT pecas_preco_check CHECK (preco >= 0);
    END IF;
END $$;

-- 3. Atualiza os preços dos itens de catálogo iniciais existentes (opcional)
UPDATE public.pecas SET preco = 38.50 WHERE codigo = 'FL-0144' AND (preco IS NULL OR preco = 0);
UPDATE public.pecas SET preco = 149.90 WHERE codigo = 'PF-2088' AND (preco IS NULL OR preco = 0);
UPDATE public.pecas SET preco = 280.00 WHERE codigo = 'VI-3012' AND (preco IS NULL OR preco = 0);
UPDATE public.pecas SET preco = 85.00 WHERE codigo = 'CD-5501' AND (preco IS NULL OR preco = 0);
UPDATE public.pecas SET preco = 450.00 WHERE codigo = 'AM-9020' AND (preco IS NULL OR preco = 0);
UPDATE public.pecas SET preco = 320.00 WHERE codigo = 'DF-1102' AND (preco IS NULL OR preco = 0);
UPDATE public.pecas SET preco = 32.00 WHERE codigo = 'FB-0045' AND (preco IS NULL OR preco = 0);
UPDATE public.pecas SET preco = 58.00 WHERE codigo = 'FA-8812' AND (preco IS NULL OR preco = 0);
UPDATE public.pecas SET preco = 210.00 WHERE codigo = 'BP-4430' AND (preco IS NULL OR preco = 0);
UPDATE public.pecas SET preco = 48.00 WHERE codigo = 'BL-7701' AND (preco IS NULL OR preco = 0);
