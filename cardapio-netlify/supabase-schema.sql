-- ============================================================
-- EXECUTE ESTE SQL NO SUPABASE: Dashboard > SQL Editor > New Query
-- ============================================================

-- Usuários admin
CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  senha TEXT NOT NULL,
  role TEXT DEFAULT 'admin',
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

-- Categorias do cardápio
CREATE TABLE IF NOT EXISTS categorias (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  icone TEXT DEFAULT 'restaurant',
  ordem INTEGER DEFAULT 0,
  ativo BOOLEAN DEFAULT true
);

-- Produtos
CREATE TABLE IF NOT EXISTS produtos (
  id SERIAL PRIMARY KEY,
  categoria_id INTEGER REFERENCES categorias(id),
  nome TEXT NOT NULL,
  descricao TEXT,
  preco NUMERIC(10,2) NOT NULL,
  imagem TEXT,
  disponivel BOOLEAN DEFAULT true,
  destaque BOOLEAN DEFAULT false,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

-- Pedidos
CREATE TABLE IF NOT EXISTS pedidos (
  id SERIAL PRIMARY KEY,
  codigo TEXT UNIQUE NOT NULL,
  cliente_nome TEXT NOT NULL,
  cliente_telefone TEXT,
  mesa TEXT,
  tipo TEXT DEFAULT 'local',
  subtotal NUMERIC(10,2) NOT NULL,
  taxa_servico NUMERIC(10,2) DEFAULT 0,
  desconto NUMERIC(10,2) DEFAULT 0,
  total NUMERIC(10,2) NOT NULL,
  status TEXT DEFAULT 'pendente',
  pagamento_status TEXT DEFAULT 'aguardando',
  pagamento_metodo TEXT,
  mp_preference_id TEXT,
  mp_payment_id TEXT,
  observacoes TEXT,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

-- Itens dos pedidos
CREATE TABLE IF NOT EXISTS itens_pedido (
  id SERIAL PRIMARY KEY,
  pedido_id INTEGER REFERENCES pedidos(id) ON DELETE CASCADE,
  produto_id INTEGER REFERENCES produtos(id),
  nome_produto TEXT NOT NULL,
  preco_unitario NUMERIC(10,2) NOT NULL,
  quantidade INTEGER NOT NULL,
  observacao TEXT,
  subtotal NUMERIC(10,2) NOT NULL
);

-- Configurações gerais
CREATE TABLE IF NOT EXISTS configuracoes (
  chave TEXT PRIMARY KEY,
  valor TEXT
);

-- ============================================================
-- DADOS INICIAIS
-- ============================================================

INSERT INTO configuracoes (chave, valor) VALUES
  ('taxa_servico', '10'),
  ('aceita_pix', 'true'),
  ('aceita_cartao', 'true'),
  ('aceita_dinheiro', 'true'),
  ('restaurante_aberto', 'true'),
  ('restaurante_nome', 'Sabor & Arte'),
  ('restaurante_telefone', '(21) 99999-9999'),
  ('restaurante_endereco', 'Rua das Flores, 123')
ON CONFLICT (chave) DO NOTHING;

INSERT INTO categorias (nome, icone, ordem) VALUES
  ('Entradas', 'dinner_dining', 1),
  ('Pratos Principais', 'restaurant', 2),
  ('Sobremesas', 'cake', 3),
  ('Bebidas', 'local_bar', 4),
  ('Combos', 'fastfood', 5)
ON CONFLICT DO NOTHING;

INSERT INTO produtos (categoria_id, nome, descricao, preco, disponivel, destaque) VALUES
  (1, 'Bruschetta Clássica', 'Pão italiano tostado com tomate, manjericão e azeite', 18.90, true, false),
  (1, 'Carpaccio de Carne', 'Carne crua com molho de mostarda e alcaparras', 32.50, true, false),
  (2, 'Frango Grelhado', 'Frango grelhado com ervas finas, arroz e salada', 38.90, true, true),
  (2, 'Filé ao Molho Madeira', 'Medalhão de filé mignon ao molho madeira', 59.90, true, true),
  (2, 'Massa ao Pesto', 'Espaguete ao molho pesto com pinhões e parmesão', 34.90, true, false),
  (3, 'Pudim de Leite', 'Pudim de leite condensado com calda de caramelo', 14.90, true, true),
  (3, 'Petit Gâteau', 'Bolinho de chocolate quente com sorvete de creme', 22.90, true, true),
  (4, 'Suco Natural', 'Laranja, limão, abacaxi ou morango 300ml', 9.90, true, false),
  (4, 'Refrigerante', 'Lata 350ml - Coca-Cola, Guaraná ou Sprite', 6.90, true, false),
  (4, 'Água Mineral', 'Com ou sem gás 500ml', 4.90, true, false),
  (5, 'Combo Casal', '2 pratos principais + 2 bebidas + sobremesa', 89.90, true, true)
ON CONFLICT DO NOTHING;

-- RLS desabilitado para service_key (acesso apenas pelo backend)
ALTER TABLE usuarios DISABLE ROW LEVEL SECURITY;
ALTER TABLE categorias DISABLE ROW LEVEL SECURITY;
ALTER TABLE produtos DISABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos DISABLE ROW LEVEL SECURITY;
ALTER TABLE itens_pedido DISABLE ROW LEVEL SECURITY;
ALTER TABLE configuracoes DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- MIGRAÇÃO: Entrega por KM + Retirada na loja
-- Execute no Supabase > SQL Editor
-- ============================================================

-- Novos campos na tabela pedidos
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS tipo_entrega TEXT DEFAULT 'local';
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS endereco_entrega TEXT;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS bairro_entrega TEXT;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cep_entrega TEXT;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS distancia_km NUMERIC(6,2) DEFAULT 0;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS taxa_entrega NUMERIC(10,2) DEFAULT 0;

-- Configurações de entrega
INSERT INTO configuracoes (chave, valor) VALUES
  ('entrega_ativa',       'true'),
  ('retirada_ativa',      'true'),
  ('taxa_por_km',         '3.00'),
  ('km_gratis',           '1'),
  ('distancia_maxima_km', '15'),
  ('pedido_minimo_entrega','20.00'),
  ('lat_restaurante',     '-22.9068'),
  ('lng_restaurante',     '-43.1729')
ON CONFLICT (chave) DO NOTHING;

-- ============================================================
-- MIGRAÇÃO: Novo modelo de taxa de entrega + categorias CRUD
-- Execute no Supabase > SQL Editor
-- ============================================================

-- Novos campos de entrega (substitui taxa_por_km e km_gratis)
INSERT INTO configuracoes (chave, valor) VALUES
  ('km_minimo',             '1'),
  ('taxa_minima',           '5.00'),
  ('taxa_por_km_adicional', '2.00')
ON CONFLICT (chave) DO NOTHING;
