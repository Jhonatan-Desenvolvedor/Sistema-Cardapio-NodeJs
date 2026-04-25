# Cardápio Digital - Netlify + Supabase

URL = [sistema-cardapio.netlify.app](https://sistema-cardapio.netlify.app/)

USER = admin@seurestaurante.com

PASS = admin123

Aplicação serverless para cardápio digital com área administrativa, carrinho, pedidos e integração opcional com Mercado Pago.

O projeto roda com:
- frontend estático no Netlify
- funções serverless em `netlify/functions`
- banco de dados no Supabase

## Visão Geral

O sistema possui duas partes principais:
- `public/` para a experiência do cliente e do admin
- `netlify/functions/` para autenticação e API

Fluxo básico:
1. o cliente acessa o cardápio
2. monta o carrinho e finaliza o pedido
3. o pedido é salvo no Supabase
4. se Mercado Pago estiver configurado, é gerado um link de pagamento
5. o dashboard admin acompanha pedidos, produtos, categorias e entrega

## Funcionalidades

- cardápio público com categorias e produtos em destaque
- carrinho com controle de quantidade
- checkout com:
  - consumo no local
  - retirada no balcão
  - delivery
- cálculo de taxa de entrega por distância
- busca de endereço e geolocalização no navegador
- integração opcional com Mercado Pago
- login administrativo com JWT
- dashboard com:
  - visão geral
  - lista de pedidos
  - pedidos aguardando pagamento
  - CRUD de produtos
  - CRUD de categorias
  - configurações de entrega
  - abrir/fechar loja
- impressão de pedidos no painel

## Tecnologias

- HTML, CSS e JavaScript
- Netlify Functions
- Supabase
- `@supabase/supabase-js`
- `bcryptjs`
- `mercadopago`

## Estrutura do Projeto

```text
cardapio-netlify/
├── netlify.toml
├── package.json
├── supabase-schema.sql
├── .env.example
├── netlify/
│   └── functions/
│       ├── _shared.js
│       ├── auth.js
│       └── api.js
└── public/
    ├── index.html
    ├── login.html
    ├── dashboard.html
    ├── css/
    │   ├── cardapio.css
    │   └── dashboard.css
    └── js/
        ├── cardapio.js
        └── dashboard.js
```

## Requisitos

- Node.js instalado
- conta no Netlify
- conta no Supabase
- Netlify CLI para desenvolvimento local

## Instalação Local

1. Instale as dependências:

```bash
npm install
```

2. Instale o Netlify CLI, se ainda não tiver:

```bash
npm install -g netlify-cli
```

3. Crie um arquivo `.env` na raiz com base no `.env.example`

4. Rode o projeto:

```bash
netlify dev
```

O site local normalmente ficará disponível em `http://localhost:8888`.

## Variáveis de Ambiente

Configure as variáveis no Netlify em `Site Settings > Environment Variables`.

```env
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=sua_service_role_key
JWT_SECRET=um_segredo_longo_e_seguro

ADMIN_EMAIL=admin@seurestaurante.com
ADMIN_SENHA=admin123

MP_ACCESS_TOKEN=seu_access_token
MP_WEBHOOK_URL=https://SEU-SITE.netlify.app/api/webhook/mercadopago

RESTAURANTE_NOME=Sabor & Arte
RESTAURANTE_TELEFONE=(21) 99999-9999
RESTAURANTE_ENDERECO=Rua das Flores, 123 - Rio de Janeiro
```

Observações:
- `SUPABASE_URL` e `SUPABASE_SERVICE_KEY` são obrigatórias
- `MP_ACCESS_TOKEN` é opcional
- `ADMIN_EMAIL` e `ADMIN_SENHA` são usados para criar o primeiro admin automaticamente

## Banco de Dados

1. Abra o Supabase
2. Vá em `SQL Editor`
3. Crie uma nova query
4. Cole o conteúdo de [`supabase-schema.sql`](./supabase-schema.sql)
5. Execute o script

O schema cria:
- `usuarios`
- `categorias`
- `produtos`
- `pedidos`
- `itens_pedido`
- `configuracoes`

Também inclui os campos de delivery e a configuração inicial da loja.

## Deploy no Netlify

### Opção 1: via Git

1. Suba o projeto para um repositório Git
2. No Netlify, clique em `Add new site > Import from Git`
3. Escolha o repositório
4. Configure:
   - `Build command`: vazio
   - `Publish directory`: `public`
5. Faça o deploy

### Opção 2: arrastar e soltar

1. Acesse o Netlify
2. Arraste a pasta do projeto para a área de deploy
3. Aguarde o processamento

Depois, configure as variáveis de ambiente e faça um redeploy.

## Rotas

### Autenticação

- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`

### API pública e administrativa

- `GET /api/cardapio`
- `POST /api/cardapio/produtos`
- `PUT /api/cardapio/produtos/:id`
- `DELETE /api/cardapio/produtos/:id`
- `POST /api/pedidos`
- `GET /api/pedidos`
- `GET /api/pedidos/:id`
- `GET /api/pedidos/:codigo`
- `PUT /api/pedidos/:id/status`
- `PUT /api/pedidos/codigo/:codigo/status`
- `GET /api/dashboard/stats`
- `POST /api/webhook/mercadopago`
- `GET /api/config/entrega`
- `PUT /api/config/entrega`
- `GET /api/config/distancia?lat=X&lng=Y`
- `GET /api/categorias`
- `POST /api/categorias`
- `PUT /api/categorias/:id`
- `DELETE /api/categorias/:id`
- `GET /api/config/loja`
- `PUT /api/config/loja`

## Como Funciona a Autenticação

- o login é feito em `/login`
- o backend gera um JWT
- o token pode ser enviado por `Authorization: Bearer ...`
- o sistema também grava o token em cookie `admin_token`
- o dashboard salva o token em `localStorage`

## Integrações Externas

- **Supabase**: banco de dados e armazenamento de dados do sistema
- **Mercado Pago**: criação de preference e webhook de pagamento
- **OpenStreetMap Nominatim**: busca e geocodificação de endereços no checkout
- **Geolocalização do navegador**: opção para usar a posição atual no delivery

## Personalização

Alguns textos, nomes e imagens estão definidos diretamente nos arquivos HTML e JS do frontend. Para adaptar o projeto ao seu restaurante, revise principalmente:
- `public/index.html`
- `public/login.html`
- `public/dashboard.html`
- `public/js/cardapio.js`
- `public/js/dashboard.js`

## Observações Importantes

- o dashboard depende de `SUPABASE_URL` e `SUPABASE_SERVICE_KEY`
- pedidos com pagamento em dinheiro já entram como confirmados
- pedidos com PIX/cartão podem gerar link do Mercado Pago, se a integração estiver ativa
- o projeto usa funções serverless, então não há servidor tradicional para manter

