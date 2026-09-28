-- ==============================================================================
-- MIGRAÇÃO 001: HISTÓRICO DE MOVIMENTAÇÕES (AUDITORIA DE ESTOQUE)
-- ==============================================================================
-- O que este script faz (somente ADICIONA objetos novos):
--   1. Cria a tabela public.movimentacoes (histórico somente-inserção)
--   2. Cria um trigger em public.pecas que registra automaticamente TODA
--      alteração de saldo, cadastro e exclusão de peça (quem, quando, quanto)
--   3. Cria a função public.registrar_movimentacao, usada pelo app para
--      entradas e baixas com cliente / placa / veículo
--
-- O que este script NÃO faz:
--   - Não altera nem apaga nenhuma linha existente da tabela pecas
--   - Não altera a função existente movimentar_estoque (o site atual continua
--     funcionando até o frontend novo ser publicado)
--
-- COMO EXECUTAR COM SEGURANÇA NO SQL EDITOR DO SUPABASE:
--   1. ENSAIO: rode o script inteiro como está (termina com ROLLBACK).
--      Se aparecer "Success. No rows returned", nada foi gravado e o script
--      está válido para o seu banco.
--   2. APLICAR: troque a última linha "ROLLBACK;" por "COMMIT;" e rode de novo.
--   Para desfazer depois: migrations/001_historico_movimentacoes_reverter.sql
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. TABELA DE HISTÓRICO
-- ------------------------------------------------------------------------------
-- Sem chave estrangeira para pecas de propósito: se uma peça for excluída,
-- o histórico dela continua existindo (código e descrição ficam gravados).
CREATE TABLE IF NOT EXISTS public.movimentacoes (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    peca_id           UUID NOT NULL,
    peca_codigo       VARCHAR(50)  NOT NULL,
    peca_descricao    VARCHAR(255) NOT NULL,
    tipo              VARCHAR(10)  NOT NULL,
    quantidade        INTEGER      NOT NULL,
    saldo_anterior    INTEGER      NOT NULL,
    saldo_posterior   INTEGER      NOT NULL,
    preco_unitario    NUMERIC(10,2),
    cliente_nome      VARCHAR(150),
    veiculo_placa     VARCHAR(10),
    veiculo_descricao VARCHAR(150),
    observacao        VARCHAR(500),
    usuario_id        UUID,
    usuario_email     VARCHAR(255),
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT movimentacoes_tipo_check
        CHECK (tipo IN ('ENTRADA', 'BAIXA', 'AJUSTE', 'CADASTRO', 'EXCLUSAO')),
    CONSTRAINT movimentacoes_quantidade_check CHECK (quantidade >= 0)
);

COMMENT ON TABLE public.movimentacoes IS
    'Histórico de movimentações de estoque (somente inserção via trigger em pecas).';
COMMENT ON COLUMN public.movimentacoes.tipo IS
    'ENTRADA/BAIXA = feitas pelo modal de movimentação; AJUSTE = saldo alterado pela edição da peça; CADASTRO/EXCLUSAO = ciclo de vida da peça.';

CREATE INDEX IF NOT EXISTS movimentacoes_created_at_idx
    ON public.movimentacoes (created_at DESC);
CREATE INDEX IF NOT EXISTS movimentacoes_peca_idx
    ON public.movimentacoes (peca_id, created_at DESC);
CREATE INDEX IF NOT EXISTS movimentacoes_placa_idx
    ON public.movimentacoes (veiculo_placa) WHERE veiculo_placa IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 2. SEGURANÇA DA TABELA DE HISTÓRICO
-- ------------------------------------------------------------------------------
-- Operadores logados podem LER. Ninguém insere, altera ou apaga pela API:
-- as linhas só nascem pelo trigger abaixo.
ALTER TABLE public.movimentacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Leitura do historico para autenticados" ON public.movimentacoes;
CREATE POLICY "Leitura do historico para autenticados"
    ON public.movimentacoes FOR SELECT
    TO authenticated
    USING (true);

REVOKE ALL ON public.movimentacoes FROM anon, authenticated;
GRANT SELECT ON public.movimentacoes TO authenticated;

-- ------------------------------------------------------------------------------
-- 3. TRIGGER DE AUDITORIA EM pecas
-- ------------------------------------------------------------------------------
-- Registra qualquer mudança de saldo, venha de onde vier (modal novo, modal de
-- edição, função antiga movimentar_estoque ou SQL direto). Quem fez é lido do
-- token JWT do Supabase, no servidor, e não pode ser forjado pelo navegador.
-- Os dados de cliente/placa/veículo chegam pela função registrar_movimentacao
-- através de variáveis locais da transação (almox.*).
CREATE OR REPLACE FUNCTION public.registrar_historico_peca()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_claims  JSONB;
    v_uid     UUID;
    v_email   TEXT;
    v_tipo    TEXT;
BEGIN
    -- Identifica o operador pelo JWT da requisição (vazio quando roda no SQL Editor)
    BEGIN
        v_claims := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
    EXCEPTION WHEN others THEN
        v_claims := NULL;
    END;
    v_uid   := NULLIF(v_claims ->> 'sub', '')::uuid;
    v_email := NULLIF(v_claims ->> 'email', '');

    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.movimentacoes (
            peca_id, peca_codigo, peca_descricao, tipo, quantidade,
            saldo_anterior, saldo_posterior, preco_unitario,
            usuario_id, usuario_email
        ) VALUES (
            NEW.id, NEW.codigo, NEW.descricao, 'CADASTRO', NEW.quantidade,
            0, NEW.quantidade, NEW.preco,
            v_uid, v_email
        );
        RETURN NEW;

    ELSIF TG_OP = 'UPDATE' THEN
        -- Só registra quando o saldo muda (edição de descrição/preço não gera linha)
        IF NEW.quantidade IS NOT DISTINCT FROM OLD.quantidade THEN
            RETURN NEW;
        END IF;

        v_tipo := NULLIF(current_setting('almox.tipo', true), '');
        IF v_tipo IS NULL OR v_tipo NOT IN ('ENTRADA', 'BAIXA') THEN
            v_tipo := 'AJUSTE';
        END IF;

        INSERT INTO public.movimentacoes (
            peca_id, peca_codigo, peca_descricao, tipo, quantidade,
            saldo_anterior, saldo_posterior, preco_unitario,
            cliente_nome, veiculo_placa, veiculo_descricao, observacao,
            usuario_id, usuario_email
        ) VALUES (
            NEW.id, NEW.codigo, NEW.descricao, v_tipo, abs(NEW.quantidade - OLD.quantidade),
            OLD.quantidade, NEW.quantidade, NEW.preco,
            NULLIF(current_setting('almox.cliente_nome', true), ''),
            NULLIF(current_setting('almox.veiculo_placa', true), ''),
            NULLIF(current_setting('almox.veiculo_descricao', true), ''),
            NULLIF(current_setting('almox.observacao', true), ''),
            v_uid, v_email
        );
        RETURN NEW;

    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO public.movimentacoes (
            peca_id, peca_codigo, peca_descricao, tipo, quantidade,
            saldo_anterior, saldo_posterior, preco_unitario,
            usuario_id, usuario_email
        ) VALUES (
            OLD.id, OLD.codigo, OLD.descricao, 'EXCLUSAO', OLD.quantidade,
            OLD.quantidade, 0, OLD.preco,
            v_uid, v_email
        );
        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_historico_peca() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_pecas_historico ON public.pecas;
CREATE TRIGGER trg_pecas_historico
    AFTER INSERT OR UPDATE OF quantidade OR DELETE ON public.pecas
    FOR EACH ROW
    EXECUTE FUNCTION public.registrar_historico_peca();

-- ------------------------------------------------------------------------------
-- 4. FUNÇÃO USADA PELO APP PARA ENTRADA E BAIXA
-- ------------------------------------------------------------------------------
-- SECURITY INVOKER: roda com as permissões do operador logado, então o RLS de
-- pecas continua valendo. Soma/subtrai o saldo numa única instrução (sem
-- condição de corrida entre terminais) e a constraint pecas_quantidade_check
-- continua impedindo estoque negativo (erro 23514).
CREATE OR REPLACE FUNCTION public.registrar_movimentacao(
    p_peca_id           UUID,
    p_tipo              TEXT,
    p_quantidade        INTEGER,
    p_cliente_nome      TEXT    DEFAULT NULL,
    p_veiculo_placa     TEXT    DEFAULT NULL,
    p_veiculo_descricao TEXT    DEFAULT NULL,
    p_observacao        TEXT    DEFAULT NULL,
    p_novo_preco        NUMERIC DEFAULT NULL
)
RETURNS public.pecas
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tipo    TEXT    := upper(btrim(coalesce(p_tipo, '')));
    v_cliente TEXT    := NULLIF(btrim(coalesce(p_cliente_nome, '')), '');
    v_placa   TEXT    := NULLIF(upper(regexp_replace(coalesce(p_veiculo_placa, ''), '[^A-Za-z0-9]', '', 'g')), '');
    v_veiculo TEXT    := NULLIF(btrim(coalesce(p_veiculo_descricao, '')), '');
    v_obs     TEXT    := NULLIF(btrim(coalesce(p_observacao, '')), '');
    v_claims  JSONB;
    v_delta   INTEGER;
    v_peca    public.pecas;
BEGIN
    v_claims := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
    IF v_claims IS NULL OR NULLIF(v_claims ->> 'sub', '') IS NULL THEN
        RAISE EXCEPTION 'Faça login para movimentar o estoque.' USING ERRCODE = '42501';
    END IF;

    IF v_tipo NOT IN ('ENTRADA', 'BAIXA') THEN
        RAISE EXCEPTION 'Tipo de movimentação inválido: %', p_tipo USING ERRCODE = '22023';
    END IF;

    IF p_quantidade IS NULL OR p_quantidade <= 0 THEN
        RAISE EXCEPTION 'A quantidade deve ser maior que zero.' USING ERRCODE = '22023';
    END IF;

    IF v_tipo = 'BAIXA' AND v_cliente IS NULL THEN
        RAISE EXCEPTION 'Informe o nome do cliente para registrar a baixa.' USING ERRCODE = '22023';
    END IF;

    IF v_placa IS NOT NULL AND length(v_placa) > 10 THEN
        RAISE EXCEPTION 'Placa inválida: %', p_veiculo_placa USING ERRCODE = '22023';
    END IF;

    IF p_novo_preco IS NOT NULL AND v_tipo <> 'ENTRADA' THEN
        RAISE EXCEPTION 'O preço só pode ser ajustado numa entrada.' USING ERRCODE = '22023';
    END IF;

    v_delta := CASE WHEN v_tipo = 'BAIXA' THEN -p_quantidade ELSE p_quantidade END;

    -- Contexto lido pelo trigger de auditoria (vale só dentro desta transação)
    PERFORM set_config('almox.tipo',              v_tipo,                    true);
    PERFORM set_config('almox.cliente_nome',      coalesce(left(v_cliente, 150), ''), true);
    PERFORM set_config('almox.veiculo_placa',     coalesce(v_placa, ''),     true);
    PERFORM set_config('almox.veiculo_descricao', coalesce(left(v_veiculo, 150), ''), true);
    PERFORM set_config('almox.observacao',        coalesce(left(v_obs, 500), ''),     true);

    UPDATE public.pecas
       SET quantidade = quantidade + v_delta,
           preco      = coalesce(round(p_novo_preco, 2), preco)
     WHERE id = p_peca_id
    RETURNING * INTO v_peca;

    -- Limpa o contexto para não vazar para outro UPDATE na mesma transação
    PERFORM set_config('almox.tipo', '', true);
    PERFORM set_config('almox.cliente_nome', '', true);
    PERFORM set_config('almox.veiculo_placa', '', true);
    PERFORM set_config('almox.veiculo_descricao', '', true);
    PERFORM set_config('almox.observacao', '', true);

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Peça não encontrada no almoxarifado (ID: %)', p_peca_id USING ERRCODE = 'P0002';
    END IF;

    RETURN v_peca;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_movimentacao(UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_movimentacao(UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, NUMERIC) TO authenticated;

-- Faz a API REST do Supabase enxergar a tabela e a função novas
NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------------------------
-- ENSAIO: deixe ROLLBACK para testar sem gravar nada.
-- APLICAR: troque a linha abaixo por  COMMIT;
-- ------------------------------------------------------------------------------
ROLLBACK;
