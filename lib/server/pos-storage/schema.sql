CREATE SCHEMA IF NOT EXISTS pos;
CREATE TABLE IF NOT EXISTS pos.datasets (
  id integer PRIMARY KEY,
  title text UNIQUE NOT NULL,
  headers jsonb NOT NULL CHECK (jsonb_typeof(headers) = 'array'),
  row_count integer NOT NULL DEFAULT 1000,
  column_count integer NOT NULL DEFAULT 26,
  next_row integer NOT NULL DEFAULT 2 CHECK (next_row >= 2)
);
CREATE TABLE IF NOT EXISTS pos.records (
  dataset_id integer NOT NULL REFERENCES pos.datasets(id),
  row_number integer NOT NULL CHECK (row_number >= 2),
  cells jsonb NOT NULL CHECK (jsonb_typeof(cells) = 'array'),
  raw_cells jsonb NOT NULL CHECK (jsonb_typeof(raw_cells) = 'array'),
  version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dataset_id, row_number)
);
CREATE TABLE IF NOT EXISTS pos.imports (
  source_sha256 text PRIMARY KEY,
  source_id text NOT NULL,
  manifest jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pos.audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dataset_id integer NOT NULL,
  row_number integer NOT NULL,
  action text NOT NULL,
  before_cells jsonb,
  after_cells jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
-- SQL-readable named fields coexist with exact source row positions/control numbers.
CREATE OR REPLACE VIEW pos.named_records AS
SELECT r.dataset_id, d.title, r.row_number, r.version,
  COALESCE((SELECT jsonb_object_agg(h.value #>> '{}', COALESCE(r.raw_cells->(h.ordinality::int-1),'null'::jsonb))
   FROM jsonb_array_elements(d.headers) WITH ORDINALITY h(value,ordinality)
   WHERE h.value #>> '{}' <> ''),'{}'::jsonb) AS fields
FROM pos.records r JOIN pos.datasets d ON d.id=r.dataset_id;
CREATE OR REPLACE VIEW pos.stock_balances AS
SELECT fields->>'SKU (Барааны код)' AS sku,
 SUM(CASE fields->>'Type (Хөдөлгөөн)' WHEN 'Орлого' THEN 1 WHEN 'Буцаалт' THEN 1 WHEN 'Зарлага' THEN -1 ELSE 0 END *
 CASE WHEN replace(COALESCE(fields->>'Quantity (Тоо)',''),' ','') ~ '^-?[0-9]+([.][0-9]+)?$'
 THEN replace(fields->>'Quantity (Тоо)',' ','')::numeric ELSE 0 END) AS quantity
FROM pos.named_records WHERE title IN ('Inventory_Log','inventory_log')
GROUP BY fields->>'SKU (Барааны код)';
