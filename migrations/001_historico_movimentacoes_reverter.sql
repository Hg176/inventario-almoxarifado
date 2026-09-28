-- ==============================================================================
-- REVERSÃO DA MIGRAÇÃO 001: HISTÓRICO DE MOVIMENTAÇÕES
-- ==============================================================================
-- Remove apenas o que a migração 001 criou. A tabela pecas e seus dados não
-- são tocados. Antes de rodar, volte o frontend para a versão anterior.
--
-- Por padrão o HISTÓRICO JÁ REGISTRADO É PRESERVADO (a tabela movimentacoes
-- fica no banco, apenas para consulta). Para apagá-lo também, descomente a
-- linha DROP TABLE no final — essa parte não tem volta.
-- ==============================================================================

BEGIN;

DROP TRIGGER IF EXISTS trg_pecas_historico ON public.pecas;
DROP FUNCTION IF EXISTS public.registrar_historico_peca();
DROP FUNCTION IF EXISTS public.registrar_movimentacao(UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, NUMERIC);

-- DROP TABLE IF EXISTS public.movimentacoes;   -- APAGA TODO O HISTÓRICO

NOTIFY pgrst, 'reload schema';

COMMIT;
