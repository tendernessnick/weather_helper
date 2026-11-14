-- Weather Helper PostgreSQL persistence through CloudBase's service-only RPC.
-- Business rows are private. Install with an administrative connection; do not
-- grant the browser an API key or privileges on this schema/function.
-- The business DDL/specification below is generated from the reviewed models.
BEGIN;
CREATE SCHEMA IF NOT EXISTS weather_helper;
REVOKE ALL ON SCHEMA weather_helper FROM PUBLIC, anon, authenticated;


CREATE TABLE IF NOT EXISTS weather_helper.checkins (
	id SERIAL NOT NULL,
	court_id VARCHAR(32) NOT NULL,
	device_id VARCHAR(64) NOT NULL,
	played_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
	duration_hours FLOAT NOT NULL,
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
	PRIMARY KEY (id)
)

;
CREATE INDEX IF NOT EXISTS ix_weather_helper_checkins_court_id ON weather_helper.checkins (court_id);
CREATE INDEX IF NOT EXISTS ix_weather_helper_checkins_device_id ON weather_helper.checkins (device_id);
CREATE INDEX IF NOT EXISTS ix_weather_helper_checkins_played_at ON weather_helper.checkins (played_at);


CREATE TABLE IF NOT EXISTS weather_helper.climatology (
	id SERIAL NOT NULL,
	court_id VARCHAR(32) NOT NULL,
	month INTEGER NOT NULL,
	hour INTEGER NOT NULL,
	samples INTEGER NOT NULL,
	rain_count INTEGER NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_clim_court_mh UNIQUE (court_id, month, hour)
)

;
CREATE INDEX IF NOT EXISTS ix_weather_helper_climatology_court_id ON weather_helper.climatology (court_id);


CREATE TABLE IF NOT EXISTS weather_helper.courts (
	id VARCHAR(32) NOT NULL,
	name_en VARCHAR(200) NOT NULL,
	name_tc VARCHAR(200) NOT NULL,
	name_sc VARCHAR(200) NOT NULL,
	district_en VARCHAR(100) NOT NULL,
	district_tc VARCHAR(100) NOT NULL,
	address_en TEXT NOT NULL,
	address_tc TEXT NOT NULL,
	court_no VARCHAR(200) NOT NULL,
	opening_hours TEXT NOT NULL,
	phone VARCHAR(100) NOT NULL,
	lat FLOAT NOT NULL,
	lon FLOAT NOT NULL,
	letter VARCHAR(1) NOT NULL,
	PRIMARY KEY (id)
)

;
CREATE INDEX IF NOT EXISTS ix_weather_helper_courts_letter ON weather_helper.courts (letter);


CREATE TABLE IF NOT EXISTS weather_helper.feedback (
	id SERIAL NOT NULL,
	device_id VARCHAR(64) NOT NULL,
	court_id VARCHAR(32),
	category VARCHAR(20) NOT NULL,
	message TEXT NOT NULL,
	page VARCHAR(200) NOT NULL,
	status VARCHAR(20) NOT NULL,
	admin_note TEXT NOT NULL,
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
	PRIMARY KEY (id)
)

;
CREATE INDEX IF NOT EXISTS ix_weather_helper_feedback_court_id ON weather_helper.feedback (court_id);
CREATE INDEX IF NOT EXISTS ix_weather_helper_feedback_created_at ON weather_helper.feedback (created_at);
CREATE INDEX IF NOT EXISTS ix_weather_helper_feedback_device_id ON weather_helper.feedback (device_id);
CREATE INDEX IF NOT EXISTS ix_weather_helper_feedback_status ON weather_helper.feedback (status);


CREATE TABLE IF NOT EXISTS weather_helper.forecast_leads (
	id SERIAL NOT NULL,
	court_id VARCHAR(32) NOT NULL,
	target_hour TIMESTAMP WITHOUT TIME ZONE NOT NULL,
	lead_bucket VARCHAR(4) NOT NULL,
	precip_prob INTEGER NOT NULL,
	precip_mm FLOAT NOT NULL,
	fetched_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_fl_court_hour_bucket UNIQUE (court_id, target_hour, lead_bucket)
)

;
CREATE INDEX IF NOT EXISTS ix_weather_helper_forecast_leads_court_id ON weather_helper.forecast_leads (court_id);
CREATE INDEX IF NOT EXISTS ix_weather_helper_forecast_leads_target_hour ON weather_helper.forecast_leads (target_hour);


CREATE TABLE IF NOT EXISTS weather_helper.forecast_snapshots (
	id SERIAL NOT NULL,
	court_id VARCHAR(32) NOT NULL,
	source VARCHAR(20) NOT NULL,
	target_hour TIMESTAMP WITHOUT TIME ZONE NOT NULL,
	precip_prob INTEGER NOT NULL,
	precip_mm FLOAT NOT NULL,
	weather_code INTEGER NOT NULL,
	wind_kmh FLOAT NOT NULL,
	apparent_temp FLOAT,
	humidity FLOAT,
	fetched_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_fc_court_hour UNIQUE (court_id, target_hour)
)

;
CREATE INDEX IF NOT EXISTS ix_weather_helper_forecast_snapshots_court_id ON weather_helper.forecast_snapshots (court_id);
CREATE INDEX IF NOT EXISTS ix_weather_helper_forecast_snapshots_fetched_at ON weather_helper.forecast_snapshots (fetched_at);
CREATE INDEX IF NOT EXISTS ix_weather_helper_forecast_snapshots_target_hour ON weather_helper.forecast_snapshots (target_hour);


CREATE TABLE IF NOT EXISTS weather_helper.kv_cache (
	key VARCHAR(50) NOT NULL,
	value_json TEXT NOT NULL,
	updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
	PRIMARY KEY (key)
)

;



CREATE TABLE IF NOT EXISTS weather_helper.nowcast_snapshots (
	id SERIAL NOT NULL,
	court_id VARCHAR(32) NOT NULL,
	fetched_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
	steps_json TEXT NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_nc_court_fetch UNIQUE (court_id, fetched_at)
)

;
CREATE INDEX IF NOT EXISTS ix_weather_helper_nowcast_snapshots_court_id ON weather_helper.nowcast_snapshots (court_id);
CREATE INDEX IF NOT EXISTS ix_weather_helper_nowcast_snapshots_fetched_at ON weather_helper.nowcast_snapshots (fetched_at);


CREATE TABLE IF NOT EXISTS weather_helper.observations (
	id SERIAL NOT NULL,
	court_id VARCHAR(32) NOT NULL,
	observed_hour TIMESTAMP WITHOUT TIME ZONE NOT NULL,
	station_name VARCHAR(100) NOT NULL,
	rainfall_mm FLOAT NOT NULL,
	rain BOOLEAN NOT NULL,
	fetched_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_obs_court_hour UNIQUE (court_id, observed_hour)
)

;
CREATE INDEX IF NOT EXISTS ix_weather_helper_observations_court_id ON weather_helper.observations (court_id);
CREATE INDEX IF NOT EXISTS ix_weather_helper_observations_observed_hour ON weather_helper.observations (observed_hour);


CREATE TABLE IF NOT EXISTS weather_helper.persistence (
	id SERIAL NOT NULL,
	court_id VARCHAR(32) NOT NULL,
	month INTEGER NOT NULL,
	wet_to_wet INTEGER NOT NULL,
	wet_to_dry INTEGER NOT NULL,
	dry_to_wet INTEGER NOT NULL,
	dry_to_dry INTEGER NOT NULL,
	survival_json TEXT NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_persist_court_month UNIQUE (court_id, month)
)

;
CREATE INDEX IF NOT EXISTS ix_weather_helper_persistence_court_id ON weather_helper.persistence (court_id);


CREATE TABLE IF NOT EXISTS weather_helper.push_subscriptions (
	id SERIAL NOT NULL,
	device_id VARCHAR(64) NOT NULL,
	endpoint TEXT NOT NULL,
	p256dh VARCHAR(200) NOT NULL,
	auth VARCHAR(100) NOT NULL,
	court_id VARCHAR(32) NOT NULL,
	play_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
	hours_before FLOAT NOT NULL,
	notified_at TIMESTAMP WITHOUT TIME ZONE,
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (endpoint)
)

;
CREATE INDEX IF NOT EXISTS ix_weather_helper_push_subscriptions_court_id ON weather_helper.push_subscriptions (court_id);
CREATE INDEX IF NOT EXISTS ix_weather_helper_push_subscriptions_device_id ON weather_helper.push_subscriptions (device_id);


CREATE TABLE IF NOT EXISTS weather_helper.user_reports (
	id SERIAL NOT NULL,
	court_id VARCHAR(32) NOT NULL,
	device_id VARCHAR(64) NOT NULL,
	was_raining BOOLEAN NOT NULL,
	intensity VARCHAR(10) NOT NULL,
	lat FLOAT NOT NULL,
	lon FLOAT NOT NULL,
	accuracy_m FLOAT,
	distance_m FLOAT,
	status VARCHAR(30) NOT NULL,
	created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
	PRIMARY KEY (id)
)

;
CREATE INDEX IF NOT EXISTS ix_weather_helper_user_reports_court_id ON weather_helper.user_reports (court_id);
CREATE INDEX IF NOT EXISTS ix_weather_helper_user_reports_created_at ON weather_helper.user_reports (created_at);
CREATE INDEX IF NOT EXISTS ix_weather_helper_user_reports_device_id ON weather_helper.user_reports (device_id);
CREATE INDEX IF NOT EXISTS ix_weather_helper_user_reports_status ON weather_helper.user_reports (status);

CREATE TABLE IF NOT EXISTS weather_helper._state (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
    owner uuid,
    expires_at timestamptz
);
INSERT INTO weather_helper._state(singleton) VALUES (true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS weather_helper._transactions (
    tx_id text PRIMARY KEY,
    owner uuid NOT NULL,
    base_revision bigint NOT NULL,
    result_revision bigint NOT NULL,
    committed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE weather_helper._transactions ADD COLUMN IF NOT EXISTS batch_count integer;
ALTER TABLE weather_helper._transactions ADD COLUMN IF NOT EXISTS batch_digests jsonb;
CREATE TABLE IF NOT EXISTS weather_helper._staging (
    tx_id text NOT NULL,
    batch_index integer NOT NULL CHECK (batch_index >= 0),
    owner uuid NOT NULL,
    base_revision bigint NOT NULL,
    changes jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tx_id, batch_index)
);
CREATE TABLE IF NOT EXISTS weather_helper._imports (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
    source_manifest jsonb NOT NULL,
    owner uuid NOT NULL,
    rows_per_transaction integer NOT NULL CHECK (rows_per_transaction BETWEEN 1 AND 10000),
    completed boolean NOT NULL DEFAULT false,
    started_revision bigint NOT NULL,
    started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    completed_at timestamptz
);

CREATE OR REPLACE FUNCTION weather_helper._table_specs()
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $specs$ SELECT '{"checkins":{"pk":"id","key_type":"integer","key_length":null,"columns":["id","court_id","device_id","played_at","duration_hours","created_at"],"nullable":[],"types":{"id":"integer","court_id":"string","device_id":"string","played_at":"timestamp","duration_hours":"number","created_at":"timestamp"},"lengths":{"court_id":32,"device_id":64}},"climatology":{"pk":"id","key_type":"integer","key_length":null,"columns":["id","court_id","month","hour","samples","rain_count"],"nullable":[],"types":{"id":"integer","court_id":"string","month":"integer","hour":"integer","samples":"integer","rain_count":"integer"},"lengths":{"court_id":32}},"courts":{"pk":"id","key_type":"string","key_length":32,"columns":["id","name_en","name_tc","name_sc","district_en","district_tc","address_en","address_tc","court_no","opening_hours","phone","lat","lon","letter"],"nullable":[],"types":{"id":"string","name_en":"string","name_tc":"string","name_sc":"string","district_en":"string","district_tc":"string","address_en":"string","address_tc":"string","court_no":"string","opening_hours":"string","phone":"string","lat":"number","lon":"number","letter":"string"},"lengths":{"id":32,"name_en":200,"name_tc":200,"name_sc":200,"district_en":100,"district_tc":100,"court_no":200,"phone":100,"letter":1}},"feedback":{"pk":"id","key_type":"integer","key_length":null,"columns":["id","device_id","court_id","category","message","page","status","admin_note","created_at"],"nullable":["court_id"],"types":{"id":"integer","device_id":"string","court_id":"string","category":"string","message":"string","page":"string","status":"string","admin_note":"string","created_at":"timestamp"},"lengths":{"device_id":64,"court_id":32,"category":20,"page":200,"status":20}},"forecast_leads":{"pk":"id","key_type":"integer","key_length":null,"columns":["id","court_id","target_hour","lead_bucket","precip_prob","precip_mm","fetched_at"],"nullable":[],"types":{"id":"integer","court_id":"string","target_hour":"timestamp","lead_bucket":"string","precip_prob":"integer","precip_mm":"number","fetched_at":"timestamp"},"lengths":{"court_id":32,"lead_bucket":4}},"forecast_snapshots":{"pk":"id","key_type":"integer","key_length":null,"columns":["id","court_id","source","target_hour","precip_prob","precip_mm","weather_code","wind_kmh","apparent_temp","humidity","fetched_at"],"nullable":["apparent_temp","humidity"],"types":{"id":"integer","court_id":"string","source":"string","target_hour":"timestamp","precip_prob":"integer","precip_mm":"number","weather_code":"integer","wind_kmh":"number","apparent_temp":"number","humidity":"number","fetched_at":"timestamp"},"lengths":{"court_id":32,"source":20}},"kv_cache":{"pk":"key","key_type":"string","key_length":50,"columns":["key","value_json","updated_at"],"nullable":[],"types":{"key":"string","value_json":"string","updated_at":"timestamp"},"lengths":{"key":50}},"nowcast_snapshots":{"pk":"id","key_type":"integer","key_length":null,"columns":["id","court_id","fetched_at","steps_json"],"nullable":[],"types":{"id":"integer","court_id":"string","fetched_at":"timestamp","steps_json":"string"},"lengths":{"court_id":32}},"observations":{"pk":"id","key_type":"integer","key_length":null,"columns":["id","court_id","observed_hour","station_name","rainfall_mm","rain","fetched_at"],"nullable":[],"types":{"id":"integer","court_id":"string","observed_hour":"timestamp","station_name":"string","rainfall_mm":"number","rain":"boolean","fetched_at":"timestamp"},"lengths":{"court_id":32,"station_name":100}},"persistence":{"pk":"id","key_type":"integer","key_length":null,"columns":["id","court_id","month","wet_to_wet","wet_to_dry","dry_to_wet","dry_to_dry","survival_json"],"nullable":[],"types":{"id":"integer","court_id":"string","month":"integer","wet_to_wet":"integer","wet_to_dry":"integer","dry_to_wet":"integer","dry_to_dry":"integer","survival_json":"string"},"lengths":{"court_id":32}},"push_subscriptions":{"pk":"id","key_type":"integer","key_length":null,"columns":["id","device_id","endpoint","p256dh","auth","court_id","play_at","hours_before","notified_at","created_at"],"nullable":["notified_at"],"types":{"id":"integer","device_id":"string","endpoint":"string","p256dh":"string","auth":"string","court_id":"string","play_at":"timestamp","hours_before":"number","notified_at":"timestamp","created_at":"timestamp"},"lengths":{"device_id":64,"p256dh":200,"auth":100,"court_id":32}},"user_reports":{"pk":"id","key_type":"integer","key_length":null,"columns":["id","court_id","device_id","was_raining","intensity","lat","lon","accuracy_m","distance_m","status","created_at"],"nullable":["accuracy_m","distance_m"],"types":{"id":"integer","court_id":"string","device_id":"string","was_raining":"boolean","intensity":"string","lat":"number","lon":"number","accuracy_m":"number","distance_m":"number","status":"string","created_at":"timestamp"},"lengths":{"court_id":32,"device_id":64,"intensity":10,"status":30}}}'::jsonb $specs$;

CREATE OR REPLACE FUNCTION weather_helper._validate_change(change jsonb)
RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog AS $validate$
DECLARE
    spec jsonb;
    row_data jsonb;
    column_name text;
    cell jsonb;
    kind text;
BEGIN
    IF jsonb_typeof(change) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'change must be an object' USING ERRCODE='22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(change) AS keys(k)
               WHERE k NOT IN ('table','op','key','row')) THEN
        RAISE EXCEPTION 'unknown change fields' USING ERRCODE='22023';
    END IF;
    spec := weather_helper._table_specs()->(change->>'table');
    IF spec IS NULL OR change->>'op' NOT IN ('upsert','delete') OR change->>'op' IS NULL THEN
        RAISE EXCEPTION 'unknown business table or operation' USING ERRCODE='22023';
    END IF;
    cell := change->'key';
    IF spec->>'key_type' = 'integer' THEN
        IF jsonb_typeof(cell) IS DISTINCT FROM 'number' OR (cell::text) !~ '^-?[0-9]+$'
           OR (cell::text)::numeric < -2147483648 OR (cell::text)::numeric > 2147483647 THEN
            RAISE EXCEPTION 'primary key must be a 32-bit integer' USING ERRCODE='22023';
        END IF;
    ELSIF jsonb_typeof(cell) IS DISTINCT FROM 'string' OR length(change->>'key') > (spec->>'key_length')::integer THEN
        RAISE EXCEPTION 'invalid string primary key' USING ERRCODE='22023';
    END IF;
    IF change->>'op' = 'delete' THEN
        IF change ? 'row' AND change->'row' <> 'null'::jsonb THEN
            RAISE EXCEPTION 'delete does not accept row data' USING ERRCODE='22023';
        END IF;
        RETURN;
    END IF;
    row_data := change->'row';
    IF jsonb_typeof(row_data) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'upsert requires a complete row object' USING ERRCODE='22023';
    END IF;
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(row_data) AS keys(k))
       IS DISTINCT FROM ARRAY(SELECT jsonb_array_elements_text(spec->'columns') ORDER BY 1) THEN
        RAISE EXCEPTION 'row columns differ from the fixed business schema' USING ERRCODE='22023';
    END IF;
    IF row_data->(spec->>'pk') IS DISTINCT FROM change->'key' THEN
        RAISE EXCEPTION 'row primary key differs from change key' USING ERRCODE='22023';
    END IF;
    FOR column_name, kind IN SELECT key, value FROM jsonb_each_text(spec->'types') LOOP
        cell := row_data->column_name;
        IF cell = 'null'::jsonb THEN
            IF NOT (spec->'nullable' ? column_name) THEN
                RAISE EXCEPTION 'null in required business column' USING ERRCODE='22023';
            END IF;
            CONTINUE;
        END IF;
        IF (kind='boolean' AND jsonb_typeof(cell) IS DISTINCT FROM 'boolean')
           OR (kind='string' AND jsonb_typeof(cell) IS DISTINCT FROM 'string')
           OR (kind='number' AND jsonb_typeof(cell) IS DISTINCT FROM 'number')
           OR (kind='integer' AND (jsonb_typeof(cell) IS DISTINCT FROM 'number' OR cell::text !~ '^-?[0-9]+$'))
           OR (kind='timestamp' AND (jsonb_typeof(cell) IS DISTINCT FROM 'string'
               OR row_data->>column_name !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?$')) THEN
            RAISE EXCEPTION 'invalid business column type or non-naive Hong Kong timestamp' USING ERRCODE='22023';
        END IF;
        IF kind='string' AND (spec->'lengths'->>column_name) IS NOT NULL
           AND length(row_data->>column_name) > (spec->'lengths'->>column_name)::integer THEN
            RAISE EXCEPTION 'business string exceeds column length' USING ERRCODE='22023';
        END IF;
    END LOOP;
END;
$validate$;

CREATE OR REPLACE FUNCTION weather_helper._apply_group(table_name text, operation text, rows_data jsonb, keys_data jsonb)
RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog AS $apply$
DECLARE
    spec jsonb := weather_helper._table_specs()->table_name;
    update_columns text;
    comparison_cast text;
BEGIN
    IF spec IS NULL OR operation NOT IN ('upsert','delete') OR operation IS NULL THEN
        RAISE EXCEPTION 'invalid fixed business operation' USING ERRCODE='22023';
    END IF;
    IF operation='delete' THEN
        comparison_cast := CASE WHEN spec->>'key_type'='integer' THEN 'integer' ELSE 'text' END;
        EXECUTE format('DELETE FROM weather_helper.%I WHERE %I IN '
            '(SELECT (value #>> ''{}'')::%s FROM jsonb_array_elements($1))',table_name,spec->>'pk',comparison_cast)
            USING keys_data;
    ELSE
        SELECT string_agg(format('%1$I=EXCLUDED.%1$I',name),',') INTO update_columns
            FROM jsonb_array_elements_text(spec->'columns') AS columns(name) WHERE name<>spec->>'pk';
        EXECUTE format('INSERT INTO weather_helper.%1$I '
            'SELECT * FROM jsonb_populate_recordset(NULL::weather_helper.%1$I,$1) '
            'ON CONFLICT(%2$I) DO UPDATE SET %3$s',table_name,spec->>'pk',update_columns)
            USING rows_data;
    END IF;
END;
$apply$;

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
                'import_source_sha256',import_row.source_sha256);
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
    IF action_name IN ('lease_acquire','heartbeat') THEN
        ttl := coalesce((request->>'ttl_seconds')::integer,90);
        IF ttl < 15 OR ttl > 300 THEN RAISE EXCEPTION 'lease TTL must be 15..300 seconds' USING ERRCODE='22023'; END IF;
        IF import_row.singleton IS NOT NULL AND NOT import_row.completed AND import_row.owner<>owner_id THEN
            RETURN jsonb_build_object('acquired',false,'revision',state_row.revision,'expires_at',state_row.expires_at);
        END IF;
        IF (state_row.owner=owner_id AND state_row.expires_at>clock_timestamp())
           OR (action_name='lease_acquire' AND (state_row.owner IS NULL OR state_row.expires_at<=clock_timestamp())) THEN
            UPDATE weather_helper._state SET owner=owner_id,expires_at=clock_timestamp()+make_interval(secs=>ttl)
                WHERE singleton RETURNING * INTO state_row;
            -- Fragments abandoned by a previous instance cannot be committed
            -- under the new owner. Committed transaction IDs remain durable.
            DELETE FROM weather_helper._staging WHERE owner<>owner_id;
            RETURN jsonb_build_object('acquired',true,'revision',state_row.revision,'expires_at',state_row.expires_at);
        END IF;
        RETURN jsonb_build_object('acquired',false,'revision',state_row.revision,'expires_at',state_row.expires_at);
    END IF;
    IF action_name='lease_release' THEN
        IF state_row.owner=owner_id THEN
            UPDATE weather_helper._state SET owner=NULL,expires_at=NULL WHERE singleton;
            RETURN jsonb_build_object('released',true,'revision',state_row.revision);
        END IF;
        RETURN jsonb_build_object('released',false,'revision',state_row.revision);
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

REVOKE ALL ON ALL TABLES IN SCHEMA weather_helper FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA weather_helper FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION weather_helper._table_specs() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION weather_helper._validate_change(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION weather_helper._apply_group(text,text,jsonb,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.weather_helper_sync(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.weather_helper_sync(jsonb) TO service_role;
COMMIT;
