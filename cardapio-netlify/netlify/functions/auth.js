// netlify/functions/auth.js
const { getSupabase, criarToken, verificarToken, getTokenFromEvent, unauth, garantirAdmin, bcrypt } = require('./_shared');

exports.handler = async (event) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const fullPath = (event.rawUrl ? new URL(event.rawUrl).pathname : event.path) || '/';
  const path = fullPath.replace('/.netlify/functions/auth', '').replace(/^\/auth/, '') || '/';
  const method = event.httpMethod;

  console.log(`[AUTH] ${method} ${path}`);

  const respJson = (status, body, extra = {}) => ({
    statusCode: status,
    headers: { ...CORS, 'Content-Type': 'application/json', ...extra },
    body: JSON.stringify(body)
  });

  // Verificar variáveis de ambiente
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return respJson(500, { erro: 'SUPABASE_URL e SUPABASE_SERVICE_KEY não configurados no Netlify' });
  }

  try {
    const supabase = getSupabase();

    // GET /auth/me
    if (method === 'GET' && path === '/me') {
      const token = getTokenFromEvent(event);
      const payload = verificarToken(token);
      if (!payload) return respJson(401, { autenticado: false });
      return respJson(200, { autenticado: true, nome: payload.nome, role: payload.role, id: payload.id });
    }

    // POST /auth/login
    if (method === 'POST' && path === '/login') {
      await garantirAdmin(supabase);
      const { email, senha } = JSON.parse(event.body || '{}');
      if (!email || !senha) return respJson(400, { erro: 'Email e senha são obrigatórios' });

      const { data: users, error } = await supabase.from('usuarios').select('*').eq('email', email).limit(1);
      if (error) return respJson(500, { erro: error.message });
      const usuario = users?.[0];
      if (!usuario || !bcrypt.compareSync(senha, usuario.senha)) {
        return respJson(401, { erro: 'Email ou senha incorretos' });
      }

      const token = criarToken({ id: usuario.id, nome: usuario.nome, email: usuario.email, role: usuario.role });
      return respJson(200, { sucesso: true, token, redirect: '/dashboard' }, {
        'Set-Cookie': `admin_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`
      });
    }

    // POST /auth/logout
    if (method === 'POST' && path === '/logout') {
      return respJson(200, { sucesso: true }, {
        'Set-Cookie': 'admin_token=; Path=/; Max-Age=0'
      });
    }

    return respJson(404, { erro: 'Rota não encontrada', path_recebido: path });

  } catch(e) {
    console.error('Auth error:', e);
    return respJson(500, { erro: e.message });
  }
};
