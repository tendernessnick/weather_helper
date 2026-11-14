-- Idempotent online upgrade: add monotonic release generations to the writer lease.
-- Requires the existing weather_helper metadata/functions. No business table
-- DDL, business row mutations, revision reset, or import-marker reset occurs.
BEGIN;
ALTER TABLE weather_helper._state ADD COLUMN IF NOT EXISTS generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0);
CREATE OR REPLACE FUNCTION public.weather_helper_sync(request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $rpc$
DECLARE
    action_name text;
    business_specs jsonb := weather_helper._table_specs();
    spec jsonb;
    table_name text;
    pk_name text;
    owner_id uuid;
    tx text;
    expected bigint;
    ttl integer;
    requested_generation bigint := 0;
    allow_takeover boolean := false;
    lease_allowed boolean;
    batch integer;
    batch_total integer;
    state_row weather_helper._state%ROWTYPE;
    transaction_row weather_helper._transactions%ROWTYPE;
    stage_row weather_helper._staging%ROWTYPE;
    import_row weather_helper._imports%ROWTYPE;
    change jsonb;
    table_manifest jsonb := '{}'::jsonb;
    row_count bigint;
    rows_json jsonb;
    cursor_json jsonb;
    cursor_text text;
    page_limit integer;
    update_columns text;
    comparison_cast text;
    group_table text;
    key_collation text;
    group_op text;
    group_rows jsonb;
    group_keys jsonb;
BEGIN
    IF jsonb_typeof(request) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'request must be an object' USING ERRCODE='22023';
    END IF;
    action_name := request->>'action';
    IF action_name IN ('manifest','snapshot') THEN
        -- Every authoritative writer locks this singleton FOR UPDATE. Holding
        -- SHARE keeps revision + business rows consistent throughout this call.
        SELECT * INTO STRICT state_row FROM weather_helper._state WHERE singleton FOR SHARE;
        IF action_name='manifest' THEN
            FOR table_name, spec IN SELECT key, value FROM jsonb_each(business_specs) LOOP
                EXECUTE format('SELECT count(*) FROM weather_helper.%I', table_name) INTO row_count;
                table_manifest := table_manifest || jsonb_build_object(table_name,
                    jsonb_build_object('count',row_count,'pk',spec->>'pk'));
            END LOOP;
            SELECT * INTO import_row FROM weather_helper._imports WHERE singleton;
            RETURN jsonb_build_object('revision',state_row.revision,'schema_version',1,'tables',table_manifest,
                'import_in_progress',coalesce(NOT import_row.completed,false),
                'import_source_sha256',import_row.source_sha256,
                'release_generation',state_row.generation);
        END IF;
        IF jsonb_typeof(request->'revision') IS DISTINCT FROM 'number'
           OR (request->>'revision') !~ '^[0-9]+$' THEN
            RAISE EXCEPTION 'snapshot revision is required' USING ERRCODE='22023';
        END IF;
        IF (request->>'revision')::bigint <> state_row.revision THEN
            RAISE EXCEPTION 'revision conflict' USING ERRCODE='40001';
        END IF;
        table_name := request->>'table';
        spec := business_specs->table_name;
        IF spec IS NULL THEN RAISE EXCEPTION 'unknown business table' USING ERRCODE='22023'; END IF;
        pk_name := spec->>'pk';
        page_limit := coalesce((request->>'limit')::integer,500);
        IF page_limit < 1 OR page_limit > 5000 THEN
            RAISE EXCEPTION 'snapshot limit must be 1..5000' USING ERRCODE='22023';
        END IF;
        cursor_json := request->'after';
        cursor_text := request->>'after';
        IF cursor_json IS NOT NULL AND cursor_json <> 'null'::jsonb THEN
            -- Reuse the same strict primary-key validation as writes.
            PERFORM weather_helper._validate_change(jsonb_build_object(
                'table',table_name,'op','delete','key',cursor_json));
        END IF;
        comparison_cast := CASE WHEN spec->>'key_type'='integer' THEN 'integer' ELSE 'text' END;
        key_collation := CASE WHEN spec->>'key_type'='integer' THEN '' ELSE ' COLLATE "C"' END;
        EXECUTE format(
            'SELECT coalesce(jsonb_agg(to_jsonb(_wh_snapshot_row.*) ORDER BY _wh_snapshot_row.%1$I%4$s),''[]''::jsonb) '
            'FROM (SELECT * FROM weather_helper.%2$I WHERE $1 IS NULL OR %1$I%4$s > $1::%3$s '
            'ORDER BY %1$I%4$s LIMIT $2) _wh_snapshot_row', pk_name, table_name, comparison_cast, key_collation
        ) INTO rows_json USING cursor_text,page_limit;
        cursor_json := CASE WHEN jsonb_array_length(rows_json)>0
            THEN (rows_json->(jsonb_array_length(rows_json)-1))->pk_name ELSE 'null'::jsonb END;
        RETURN jsonb_build_object('revision',state_row.revision,'rows',rows_json,'next_cursor',cursor_json);
    END IF;

    IF action_name NOT IN ('lease_acquire','heartbeat','lease_release','stage','commit','import_begin','import_finish') OR action_name IS NULL THEN
        RAISE EXCEPTION 'unknown action' USING ERRCODE='22023';
    END IF;
    IF jsonb_typeof(request->'owner') IS DISTINCT FROM 'string'
       OR request->>'owner' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        RAISE EXCEPTION 'owner must be a UUID string' USING ERRCODE='22023';
    END IF;
    owner_id := (request->>'owner')::uuid;
    SELECT * INTO STRICT state_row FROM weather_helper._state WHERE singleton FOR UPDATE;
    SELECT * INTO import_row FROM weather_helper._imports WHERE singleton;
    IF action_name IN ('lease_acquire','heartbeat','lease_release') THEN
        IF request ? 'generation' THEN
            IF jsonb_typeof(request->'generation') IS DISTINCT FROM 'number'
               OR request->>'generation' !~ '^[0-9]+$'
               OR (request->>'generation')::numeric > 9223372036854775807 THEN
                RAISE EXCEPTION 'generation must be a nonnegative 64-bit integer' USING ERRCODE='22023';
            END IF;
            requested_generation := (request->>'generation')::bigint;
        END IF;
        IF request ? 'allow_takeover' THEN
            IF jsonb_typeof(request->'allow_takeover') IS DISTINCT FROM 'boolean' THEN
                RAISE EXCEPTION 'allow_takeover must be a boolean' USING ERRCODE='22023';
            END IF;
            allow_takeover := (request->>'allow_takeover')::boolean;
        END IF;
    END IF;
    IF action_name IN ('lease_acquire','heartbeat') THEN
        ttl := coalesce((request->>'ttl_seconds')::integer,90);
        IF ttl < 15 OR ttl > 300 THEN RAISE EXCEPTION 'lease TTL must be 15..300 seconds' USING ERRCODE='22023'; END IF;
        IF import_row.singleton IS NOT NULL AND NOT import_row.completed AND import_row.owner<>owner_id THEN
            RETURN jsonb_build_object('acquired',false,'revision',state_row.revision,'expires_at',state_row.expires_at,
                'release_generation',state_row.generation);
        END IF;
        -- Generations never go backwards, including after expiry or release.
        -- An inactive candidate cannot steal a valid lease without the explicit
        -- flag that its client sends only after checking public traffic routing.
        lease_allowed := requested_generation>=state_row.generation AND (
            (requested_generation=state_row.generation AND state_row.owner=owner_id
                AND state_row.expires_at>clock_timestamp())
            OR (action_name='lease_acquire' AND (
                state_row.owner IS NULL OR state_row.expires_at<=clock_timestamp()
                OR (requested_generation>state_row.generation AND allow_takeover)
            ))
        );
        IF lease_allowed THEN
            UPDATE weather_helper._state SET owner=owner_id,generation=requested_generation,
                expires_at=clock_timestamp()+make_interval(secs=>ttl)
                WHERE singleton RETURNING * INTO state_row;
            -- Fragments abandoned by a previous instance cannot be committed
            -- under the new owner. Committed transaction IDs remain durable.
            DELETE FROM weather_helper._staging WHERE owner<>owner_id;
            RETURN jsonb_build_object('acquired',true,'revision',state_row.revision,'expires_at',state_row.expires_at,
                'release_generation',state_row.generation);
        END IF;
        RETURN jsonb_build_object('acquired',false,'revision',state_row.revision,'expires_at',state_row.expires_at,
            'release_generation',state_row.generation);
    END IF;
    IF action_name='lease_release' THEN
        IF state_row.owner=owner_id AND state_row.generation=requested_generation THEN
            UPDATE weather_helper._state SET owner=NULL,expires_at=NULL WHERE singleton;
            RETURN jsonb_build_object('released',true,'revision',state_row.revision,'release_generation',state_row.generation);
        END IF;
        RETURN jsonb_build_object('released',false,'revision',state_row.revision,'release_generation',state_row.generation);
    END IF;

    IF import_row.singleton IS NOT NULL AND NOT import_row.completed AND import_row.owner<>owner_id THEN
        RAISE EXCEPTION 'initial import is owned by another operator' USING ERRCODE='42501';
    END IF;
    IF action_name IN ('import_begin','import_finish') THEN
        IF state_row.owner IS DISTINCT FROM owner_id OR state_row.expires_at IS NULL
           OR state_row.expires_at<=clock_timestamp() THEN
            RAISE EXCEPTION 'writer lease unavailable' USING ERRCODE='42501';
        END IF;
        IF action_name='import_begin' THEN
            IF jsonb_typeof(request->'source_sha256') IS DISTINCT FROM 'string'
               OR request->>'source_sha256' !~ '^[0-9a-f]{64}$'
               OR jsonb_typeof(request->'source_manifest') IS DISTINCT FROM 'object' THEN
                RAISE EXCEPTION 'invalid source manifest' USING ERRCODE='22023';
            END IF;
            IF ARRAY(SELECT jsonb_object_keys(request->'source_manifest') ORDER BY 1)
               IS DISTINCT FROM ARRAY(SELECT jsonb_object_keys(business_specs) ORDER BY 1) THEN
                RAISE EXCEPTION 'source manifest must cover exactly twelve tables' USING ERRCODE='22023';
            END IF;
            FOR table_name, spec IN SELECT key,value FROM jsonb_each(request->'source_manifest') LOOP
                IF jsonb_typeof(spec->'rows') IS DISTINCT FROM 'number' OR spec->>'rows' !~ '^[0-9]+$'
                   OR jsonb_typeof(spec->'sha256') IS DISTINCT FROM 'string' OR spec->>'sha256' !~ '^[0-9a-f]{64}$' THEN
                    RAISE EXCEPTION 'invalid source table fingerprint' USING ERRCODE='22023';
                END IF;
            END LOOP;
            IF jsonb_typeof(request->'rows_per_transaction') IS DISTINCT FROM 'number'
               OR request->>'rows_per_transaction' !~ '^[0-9]+$'
               OR (request->>'rows_per_transaction')::integer NOT BETWEEN 1 AND 10000 THEN
                RAISE EXCEPTION 'invalid import transaction size' USING ERRCODE='22023';
            END IF;
            IF import_row.singleton IS NOT NULL THEN
                IF import_row.source_sha256<>request->>'source_sha256' OR import_row.owner<>owner_id
                   OR import_row.rows_per_transaction<>(request->>'rows_per_transaction')::integer
                   OR import_row.source_manifest IS DISTINCT FROM request->'source_manifest' THEN
                    RAISE EXCEPTION 'import metadata differs from durable resume marker' USING ERRCODE='22023';
                END IF;
            ELSE
                FOR table_name IN SELECT jsonb_object_keys(business_specs) LOOP
                    EXECUTE format('SELECT count(*) FROM weather_helper.%I',table_name) INTO row_count;
                    IF row_count<>0 THEN RAISE EXCEPTION 'initial import requires empty business tables' USING ERRCODE='22023'; END IF;
                END LOOP;
                INSERT INTO weather_helper._imports(singleton,source_sha256,source_manifest,owner,rows_per_transaction,started_revision)
                    VALUES(true,request->>'source_sha256',request->'source_manifest',owner_id,
                           (request->>'rows_per_transaction')::integer,state_row.revision)
                    RETURNING * INTO import_row;
            END IF;
            RETURN jsonb_build_object('revision',state_row.revision,'completed',import_row.completed,
                                     'source_sha256',import_row.source_sha256);
        END IF;
        IF import_row.singleton IS NULL OR import_row.owner<>owner_id
           OR import_row.source_sha256 IS DISTINCT FROM request->>'source_sha256'
           OR import_row.source_manifest IS DISTINCT FROM request->'verified_manifest' THEN
            RAISE EXCEPTION 'verified import manifest differs from the durable source marker' USING ERRCODE='22023';
        END IF;
        FOR table_name, spec IN SELECT key,value FROM jsonb_each(import_row.source_manifest) LOOP
            EXECUTE format('SELECT count(*) FROM weather_helper.%I',table_name) INTO row_count;
            IF row_count<>(spec->>'rows')::bigint THEN
                RAISE EXCEPTION 'import row count differs from the source manifest' USING ERRCODE='22023';
            END IF;
        END LOOP;
        UPDATE weather_helper._imports SET completed=true,completed_at=coalesce(completed_at,clock_timestamp()) WHERE singleton;
        RETURN jsonb_build_object('revision',state_row.revision,'completed',true,'source_sha256',import_row.source_sha256);
    END IF;

    tx := request->>'tx_id';
    IF tx IS NULL OR length(tx) NOT BETWEEN 1 AND 128 OR tx !~ '^[a-zA-Z0-9_-]+$' THEN
        RAISE EXCEPTION 'invalid transaction ID' USING ERRCODE='22023';
    END IF;
    SELECT * INTO transaction_row FROM weather_helper._transactions WHERE tx_id=tx;
    IF FOUND THEN
        IF transaction_row.owner<>owner_id THEN
            RAISE EXCEPTION 'transaction belongs to another owner' USING ERRCODE='42501';
        END IF;
        IF action_name='stage' AND transaction_row.batch_digests IS NOT NULL THEN
            IF jsonb_typeof(request->'batch_index') IS DISTINCT FROM 'number'
               OR request->>'batch_index' !~ '^[0-9]+$'
               OR jsonb_typeof(request->'changes') IS DISTINCT FROM 'array'
               OR (transaction_row.batch_digests->>(request->>'batch_index'))
                  IS DISTINCT FROM md5((request->'changes')::text) THEN
                RAISE EXCEPTION 'committed batch differs from retry' USING ERRCODE='22023';
            END IF;
        ELSIF action_name='commit' AND transaction_row.batch_count IS NOT NULL THEN
            IF jsonb_typeof(request->'batch_count') IS DISTINCT FROM 'number'
               OR request->>'batch_count' !~ '^[0-9]+$'
               OR (request->>'batch_count')::integer<>transaction_row.batch_count THEN
                RAISE EXCEPTION 'committed batch count differs from retry' USING ERRCODE='22023';
            END IF;
        END IF;
        -- A commit response may have been lost after the transaction committed.
        -- The original owner can confirm it even after the lease has expired.
        RETURN jsonb_build_object('revision',transaction_row.result_revision,'tx_id',tx,'already_applied',true);
    END IF;
    IF state_row.owner IS DISTINCT FROM owner_id OR state_row.expires_at IS NULL
       OR state_row.expires_at<=clock_timestamp() THEN
        RAISE EXCEPTION 'writer lease unavailable' USING ERRCODE='42501';
    END IF;
    IF jsonb_typeof(request->'expected_revision') IS DISTINCT FROM 'number'
       OR request->>'expected_revision' !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'expected_revision is required' USING ERRCODE='22023';
    END IF;
    expected := (request->>'expected_revision')::bigint;
    IF expected<>state_row.revision THEN RAISE EXCEPTION 'revision conflict' USING ERRCODE='40001'; END IF;

    IF action_name='stage' THEN
        IF jsonb_typeof(request->'batch_index') IS DISTINCT FROM 'number'
           OR request->>'batch_index' !~ '^[0-9]+$' THEN
            RAISE EXCEPTION 'invalid batch_index' USING ERRCODE='22023';
        END IF;
        batch := (request->>'batch_index')::integer;
        IF batch>=10000 OR jsonb_typeof(request->'changes') IS DISTINCT FROM 'array'
           OR jsonb_array_length(request->'changes') NOT BETWEEN 1 AND 400 THEN
            RAISE EXCEPTION 'stage requires 1..400 changes and batch_index<10000' USING ERRCODE='22023';
        END IF;
        FOR change IN SELECT value FROM jsonb_array_elements(request->'changes') LOOP
            PERFORM weather_helper._validate_change(change);
        END LOOP;
        SELECT * INTO stage_row FROM weather_helper._staging WHERE tx_id=tx AND batch_index=batch;
        IF FOUND THEN
            IF stage_row.owner<>owner_id OR stage_row.base_revision<>expected
               OR stage_row.changes IS DISTINCT FROM request->'changes' THEN
                RAISE EXCEPTION 'staged batch differs from retry' USING ERRCODE='22023';
            END IF;
        ELSE
            IF EXISTS(SELECT 1 FROM weather_helper._staging WHERE tx_id=tx
                      AND (owner<>owner_id OR base_revision<>expected)) THEN
                RAISE EXCEPTION 'staged transaction metadata differs' USING ERRCODE='22023';
            END IF;
            INSERT INTO weather_helper._staging(tx_id,batch_index,owner,base_revision,changes)
                VALUES(tx,batch,owner_id,expected,request->'changes');
        END IF;
        RETURN jsonb_build_object('staged',true,'batch_index',batch,'revision',expected,'tx_id',tx);
    END IF;

    IF jsonb_typeof(request->'batch_count') IS DISTINCT FROM 'number'
       OR request->>'batch_count' !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'invalid batch_count' USING ERRCODE='22023';
    END IF;
    batch_total := (request->>'batch_count')::integer;
    IF batch_total NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'invalid batch_count' USING ERRCODE='22023'; END IF;
    SELECT count(*) INTO row_count FROM weather_helper._staging WHERE tx_id=tx;
    IF row_count<>batch_total OR EXISTS(SELECT 1 FROM weather_helper._staging
        WHERE tx_id=tx AND (batch_index>=batch_total OR owner<>owner_id OR base_revision<>expected)) THEN
        RAISE EXCEPTION 'staged batch sequence is incomplete' USING ERRCODE='22023';
    END IF;
    -- PRIMARY KEY(tx_id,batch_index), nonnegative indices, count=N and all<N
    -- prove that every index in 0..N-1 is present exactly once.
    FOR stage_row IN SELECT * FROM weather_helper._staging WHERE tx_id=tx ORDER BY batch_index LOOP
        group_table := NULL;
        group_op := NULL;
        group_rows := '[]'::jsonb;
        group_keys := '[]'::jsonb;
        FOR change IN SELECT value FROM jsonb_array_elements(stage_row.changes) LOOP
            PERFORM weather_helper._validate_change(change);
            table_name := change->>'table';
            IF group_table IS NOT NULL AND (group_table<>table_name OR group_op<>change->>'op'
                OR group_keys @> jsonb_build_array(change->'key')) THEN
                PERFORM weather_helper._apply_group(group_table,group_op,group_rows,group_keys);
                group_rows := '[]'::jsonb;
                group_keys := '[]'::jsonb;
            END IF;
            group_table := table_name;
            group_op := change->>'op';
            group_keys := group_keys || jsonb_build_array(change->'key');
            IF group_op='upsert' THEN group_rows := group_rows || jsonb_build_array(change->'row'); END IF;
        END LOOP;
        IF group_table IS NOT NULL THEN
            PERFORM weather_helper._apply_group(group_table,group_op,group_rows,group_keys);
        END IF;
    END LOOP;
    UPDATE weather_helper._state SET revision=revision+1,
        expires_at=greatest(expires_at,clock_timestamp()+interval '90 seconds')
        WHERE singleton RETURNING * INTO state_row;
    INSERT INTO weather_helper._transactions(tx_id,owner,base_revision,result_revision,batch_count,batch_digests)
        SELECT tx,owner_id,expected,state_row.revision,batch_total,
            jsonb_object_agg(batch_index::text,md5(changes::text))
        FROM weather_helper._staging WHERE tx_id=tx;
    DELETE FROM weather_helper._staging WHERE tx_id=tx;
    RETURN jsonb_build_object('revision',state_row.revision,'tx_id',tx,'already_applied',false);
END;
$rpc$;
REVOKE ALL ON FUNCTION public.weather_helper_sync(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.weather_helper_sync(jsonb) TO service_role;
COMMIT;
