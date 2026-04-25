// netlify/functions/_shared.js
// Utilitários compartilhados entre todas as funções

const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// ── Supabase client ──────────────────────────────────────────
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL e SUPABASE_SERVICE_KEY são obrigatórios');
  return createClient(url, key);
}

// ── JWT simples (sem biblioteca extra) ───────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'cardapio_secret_fallback';

function base64url(str) {
  return Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function criarToken(payload) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 86400 }));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${header}.${body}.${sig}`;
}

function verificarToken(token) {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(`${parts[0]}.${parts[1]}`).digest('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    if (expectedSig !== parts[2]) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch(e) { return null; }
}

function getTokenFromEvent(event) {
  const auth = event.headers?.authorization || event.headers?.Authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  // Também checar cookie
  const cookies = event.headers?.cookie || '';
  const match = cookies.match(/admin_token=([^;]+)/);
  return match ? match[1] : null;
}

// ── Respostas HTTP ────────────────────────────────────────────
function resp(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      ...headers
    },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  };
}

function ok(data, extra = {}) { return resp(200, data, extra); }
function err(msg, status = 400) { return resp(status, { erro: msg }); }
function unauth() { return resp(401, { erro: 'Não autorizado' }); }

// ── Seed admin inicial ────────────────────────────────────────
async function garantirAdmin(supabase) {
  const { data } = await supabase.from('usuarios').select('id').eq('role', 'admin').limit(1);
  if (!data || data.length === 0) {
    const email = process.env.ADMIN_EMAIL || 'admin@restaurante.com';
    const senha = process.env.ADMIN_SENHA || 'admin123';
    const hash = bcrypt.hashSync(senha, 10);
    await supabase.from('usuarios').insert({ nome: 'Administrador', email, senha: hash, role: 'admin' });
    console.log('Admin criado:', email);
  }
}

// ── Código de pedido ──────────────────────────────────────────
function gerarCodigo() {
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `PED-${ts}-${rnd}`;
}

module.exports = { getSupabase, criarToken, verificarToken, getTokenFromEvent, ok, err, unauth, garantirAdmin, gerarCodigo, bcrypt };
