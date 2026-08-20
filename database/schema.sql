-- @delimiter ;
-- Pediflow - schema PostgreSQL
-- Estrutura persistente usada pela API do sistema.

CREATE SCHEMA IF NOT EXISTS pediflow;
SET search_path TO pediflow;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

--/
DO $$
BEGIN
  CREATE TYPE order_status AS ENUM ('pending', 'ready', 'delivered');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
/

--/
DO $$
BEGIN
  CREATE TYPE theme_mode AS ENUM ('light', 'dark');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
/

--/
DO $$
BEGIN
  CREATE TYPE accent_color AS ENUM ('purple', 'green', 'blue', 'red', 'gray', 'pink', 'yellow', 'orange');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
/

--/
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
/

CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(160) NOT NULL CHECK (length(trim(name)) > 0),
  theme theme_mode NOT NULL DEFAULT 'light',
  accent accent_color NOT NULL DEFAULT 'orange',
  avatar_data TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL CHECK (length(trim(name)) > 0),
  phone VARCHAR(40),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL CHECK (length(trim(name)) > 0),
  price NUMERIC(12, 2) NOT NULL CHECK (price > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  delivery_date DATE NOT NULL,
  status order_status NOT NULL DEFAULT 'pending',
  observation VARCHAR(240),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (observation IS NULL OR length(trim(observation)) <= 240)
);

CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name VARCHAR(160) NOT NULL CHECK (length(trim(product_name)) > 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shopping_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at DATE NOT NULL DEFAULT CURRENT_DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shopping_list_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shopping_list_id UUID NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL CHECK (length(trim(name)) > 0),
  quantity VARCHAR(80) NOT NULL CHECK (length(trim(quantity)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS relatorios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('diario', 'semanal', 'mensal')),
  periodo DATE NOT NULL,
  dados JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_company_active ON clients(company_id, active);
CREATE INDEX IF NOT EXISTS idx_products_company ON products(company_id);
CREATE INDEX IF NOT EXISTS idx_orders_company_delivery ON orders(company_id, delivery_date);
CREATE INDEX IF NOT EXISTS idx_orders_company_status ON orders(company_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_client ON orders(client_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_shopping_lists_company ON shopping_lists(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shopping_list_items_list ON shopping_list_items(shopping_list_id);
CREATE INDEX IF NOT EXISTS idx_relatorios_tipo_periodo ON relatorios(tipo, periodo);

DROP TRIGGER IF EXISTS companies_set_updated_at ON companies;
CREATE TRIGGER companies_set_updated_at
BEFORE UPDATE ON companies
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS clients_set_updated_at ON clients;
CREATE TRIGGER clients_set_updated_at
BEFORE UPDATE ON clients
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS products_set_updated_at ON products;
CREATE TRIGGER products_set_updated_at
BEFORE UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS orders_set_updated_at ON orders;
CREATE TRIGGER orders_set_updated_at
BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS shopping_lists_set_updated_at ON shopping_lists;
CREATE TRIGGER shopping_lists_set_updated_at
BEFORE UPDATE ON shopping_lists
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE VIEW order_totals AS
SELECT
  o.id AS order_id,
  o.company_id,
  o.client_id,
  o.delivery_date,
  o.status,
  o.observation,
  COALESCE(SUM(oi.quantity * oi.unit_price), 0)::NUMERIC(12, 2) AS total
FROM orders o
LEFT JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.id, o.company_id, o.client_id, o.delivery_date, o.status, o.observation;

CREATE OR REPLACE VIEW daily_sales_by_client AS
SELECT
  o.company_id,
  o.delivery_date,
  o.client_id,
  COALESCE(c.name, 'Cliente removido') AS client_name,
  COUNT(o.id)::INTEGER AS order_count,
  COALESCE(SUM(oi.quantity * oi.unit_price), 0)::NUMERIC(12, 2) AS total
FROM orders o
LEFT JOIN clients c ON c.id = o.client_id
LEFT JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.company_id, o.delivery_date, o.client_id, c.name;

COMMENT ON TABLE companies IS 'Empresa e preferencias globais da conta.';
COMMENT ON TABLE clients IS 'Clientes cadastrados, ativos ou inativos.';
COMMENT ON TABLE products IS 'Catalogo de produtos e precos unitarios.';
COMMENT ON TABLE orders IS 'Pedidos e seus dados de entrega, status e observacao.';
COMMENT ON TABLE order_items IS 'Itens do pedido com snapshot do nome e preco no momento da venda.';
COMMENT ON TABLE shopping_lists IS 'Listas de compras salvas pela empresa.';
COMMENT ON TABLE shopping_list_items IS 'Itens e quantidades das listas de compras.';
COMMENT ON COLUMN companies.avatar_data IS 'Imagem do perfil em Data URL ou referencia futura para storage.';
COMMENT ON COLUMN order_items.unit_price IS 'Preco praticado no pedido; nao depende de alteracoes futuras no catalogo.';
