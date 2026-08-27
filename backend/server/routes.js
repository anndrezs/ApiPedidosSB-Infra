import { authenticateToken, comparePassword, createToken, hashPassword } from './auth.js'
import crypto from 'node:crypto'

const schema = 'pediflowsb'
const table = (name) => `${schema}.${name}`

const databaseDate = (value) => {
  if (typeof value === 'string') return value.slice(0, 10)
  return value.toISOString().slice(0, 10)
}

const orderStatus = new Set(['pending', 'ready', 'delivered'])

async function getOrder(pool, companyId, orderId) {
  const result = await pool.query(`
    SELECT o.id, o.client_id, o.delivery_date, o.created_at::date AS created_at, o.status, o.observation,
      COALESCE(json_agg(json_build_object('id', oi.id, 'productId', oi.product_id, 'productName', oi.product_name, 'quantity', oi.quantity, 'unitPrice', oi.unit_price) ORDER BY oi.created_at) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
    FROM ${table('orders')} o
    LEFT JOIN ${table('order_items')} oi ON oi.order_id = o.id
    WHERE o.company_id = $1 AND o.id = $2
    GROUP BY o.id
  `, [companyId, orderId])
  return result.rows[0] ? mapOrder(result.rows[0]) : null
}

function mapOrder(order) {
  return {
    id: order.id,
    clientId: order.client_id,
    createdAt: databaseDate(order.created_at),
    delivery: databaseDate(order.delivery_date),
    status: order.status,
    observation: order.observation || '',
    items: (order.items || []).map((item) => ({ ...item, unitPrice: Number(item.unitPrice || 0), quantity: Number(item.quantity) })),
  }
}

function sendError(response, error) {
  console.error(error)
  response.status(500).json({ error: 'Erro interno ao processar a requisicao.' })
}

function requireAdmin(request, response, next) {
  if (request.user.role !== 'owner') return response.status(403).json({ error: 'Acesso restrito ao administrador.' })
  next()
}

export function registerRoutes(app, pool) {
  app.use((request, response, next) => {
    const origin = process.env.FRONTEND_URL || '*'
    response.header('Access-Control-Allow-Origin', origin)
    response.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization')
    response.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    if (request.method === 'OPTIONS') return response.sendStatus(204)
    next()
  })

  app.get(['/api/health', '/health'], async (_request, response) => {
    try {
      await pool.query('SELECT 1')
      response.json({ ok: true })
    } catch (error) {
      response.status(503).json({ ok: false, error: error.message })
    }
  })

  app.post('/api/auth/login', async (request, response) => {
    try {
      const username = String(request.body.user || '').trim().toLowerCase()
      const password = String(request.body.password || '')
      if (!username || !password) return response.status(400).json({ error: 'Informe usuario e senha.' })
      const result = await pool.query(`SELECT u.id, u.company_id, u.name, u.email, u."user", u.password_hash, u.role, c.name AS company_name FROM ${table('users')} u JOIN ${table('companies')} c ON c.id = u.company_id WHERE lower(u."user") = $1 AND u.active = TRUE`, [username])
      const user = result.rows[0]
      if (!user || !(await comparePassword(password, user.password_hash))) return response.status(401).json({ error: 'Usuario ou senha invalidos.' })
      response.json({ token: createToken(user), user: { id: user.id, name: user.name, email: user.email, role: user.role, company: user.company_name } })
    } catch (error) { sendError(response, error) }
  })

  app.get('/api/auth/me', authenticateToken, async (request, response) => {
    try {
      const result = await pool.query(`SELECT u.id, u.name, u.email, u.role, c.name AS company FROM ${table('users')} u JOIN ${table('companies')} c ON c.id = u.company_id WHERE u.id = $1 AND u.company_id = $2 AND u.active = TRUE`, [request.user.userId, request.user.companyId])
      if (!result.rows[0]) return response.status(401).json({ error: 'Usuario nao encontrado.' })
      response.json(result.rows[0])
    } catch (error) { sendError(response, error) }
  })

  app.put('/api/auth/password', authenticateToken, async (request, response) => {
    try {
      const currentPassword = String(request.body.currentPassword || '')
      const newPassword = String(request.body.newPassword || '')
      if (!currentPassword || !newPassword) return response.status(400).json({ error: 'Informe a senha atual e a nova senha.' })
      if (newPassword.length < 8) return response.status(400).json({ error: 'A nova senha deve ter pelo menos 8 caracteres.' })
      const result = await pool.query(`SELECT password_hash FROM ${table('users')} WHERE id = $1 AND company_id = $2 AND active = TRUE`, [request.user.userId, request.user.companyId])
      const user = result.rows[0]
      if (!user || !(await comparePassword(currentPassword, user.password_hash))) return response.status(400).json({ error: 'A senha atual esta incorreta.' })
      await pool.query(`UPDATE ${table('users')} SET password_hash = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3`, [await hashPassword(newPassword), request.user.userId, request.user.companyId])
      response.json({ message: 'Senha alterada com sucesso.' })
    } catch (error) { sendError(response, error) }
  })

  app.get('/api/admin/users', authenticateToken, requireAdmin, async (_request, response) => {
    try {
      const result = await pool.query(`SELECT u.id, u.company_id, u.name, u."user", u.email, u.role, u.active, u.created_at, c.name AS company_name FROM ${table('users')} u JOIN ${table('companies')} c ON c.id = u.company_id ORDER BY u.created_at`)
      response.json(result.rows)
    } catch (error) { sendError(response, error) }
  })

  app.get('/api/admin/companies', authenticateToken, requireAdmin, async (request, response) => {
    try {
      const result = await pool.query(`SELECT id, name FROM ${table('companies')} WHERE id <> $1 ORDER BY created_at`, [request.user.companyId])
      response.json(result.rows)
    } catch (error) { sendError(response, error) }
  })

  app.post('/api/admin/companies', authenticateToken, requireAdmin, async (request, response) => {
    try {
      const name = String(request.body.name || '').trim()
      if (!name) return response.status(400).json({ error: 'Informe o nome da empresa.' })
      const result = await pool.query(`INSERT INTO ${table('companies')} (name) VALUES ($1) RETURNING id, name, created_at`, [name])
      response.status(201).json(result.rows[0])
    } catch (error) { sendError(response, error) }
  })

  app.post('/api/admin/users', authenticateToken, requireAdmin, async (request, response) => {
    const client = await pool.connect()
    try {
      const name = String(request.body.name || '').trim()
      const username = String(request.body.user || '').trim().toLowerCase()
      const email = String(request.body.email || '').trim().toLowerCase()
      const password = String(request.body.password || '')
      const role = request.body.role === 'owner' ? 'owner' : 'user'
      if (!name || !username || !email || password.length < 8) return response.status(400).json({ error: 'Informe nome, usuario, email e uma senha de pelo menos 8 caracteres.' })
      await client.query('BEGIN')
      const company = await client.query(`SELECT id FROM ${table('companies')} WHERE id = $1 AND id <> $2`, [request.body.companyId, request.user.companyId])
      if (!company.rows[0]) { await client.query('ROLLBACK'); return response.status(400).json({ error: 'Selecione uma empresa valida.' }) }
      const companyId = company.rows[0].id
      const user = await client.query(`INSERT INTO ${table('users')} (company_id, name, "user", email, password_hash, role, active) VALUES ($1, $2, $3, $4, $5, $6, TRUE) RETURNING id, company_id, name, "user", email, role, active, created_at`, [companyId, name, username, email, await hashPassword(password), role])
      await client.query('COMMIT')
      response.status(201).json(user.rows[0])
    } catch (error) {
      await client.query('ROLLBACK')
      if (error.code === '23505') return response.status(409).json({ error: 'Usuario ou email ja cadastrado.' })
      sendError(response, error)
    } finally { client.release() }
  })

  app.put('/api/admin/users/:id', authenticateToken, requireAdmin, async (request, response) => {
    try {
      const name = String(request.body.name || '').trim()
      const username = String(request.body.user || '').trim().toLowerCase()
      const email = String(request.body.email || '').trim().toLowerCase()
      const role = request.body.role === 'owner' ? 'owner' : 'user'
      if (!name || !username || !email) return response.status(400).json({ error: 'Nome, usuario e email sao obrigatorios.' })
      const result = await pool.query(`UPDATE ${table('users')} SET name = $1, "user" = $2, email = $3, role = $4, updated_at = NOW() WHERE id = $5 RETURNING id, company_id, name, "user", email, role, active`, [name, username, email, role, request.params.id])
      if (!result.rows[0]) return response.status(404).json({ error: 'Usuario nao encontrado.' })
      response.json(result.rows[0])
    } catch (error) {
      if (error.code === '23505') return response.status(409).json({ error: 'Usuario ou email ja cadastrado.' })
      sendError(response, error)
    }
  })

  app.post('/api/admin/users/:id/reset-password', authenticateToken, requireAdmin, async (request, response) => {
    try {
      const temporaryPassword = crypto.randomBytes(6).toString('base64url').slice(0, 8)
      const result = await pool.query(`UPDATE ${table('users')} SET password_hash = $1, updated_at = NOW() WHERE id = $2 RETURNING id`, [await hashPassword(temporaryPassword), request.params.id])
      if (!result.rows[0]) return response.status(404).json({ error: 'Usuario nao encontrado.' })
      response.json({ id: result.rows[0].id, temporaryPassword })
    } catch (error) { sendError(response, error) }
  })

  app.patch('/api/admin/users/:id/status', authenticateToken, requireAdmin, async (request, response) => {
    try {
      if (request.params.id === request.user.userId) return response.status(400).json({ error: 'O administrador nao pode inativar a propria conta.' })
      const result = await pool.query(`UPDATE ${table('users')} SET active = $1, updated_at = NOW() WHERE id = $2 RETURNING id, active`, [request.body.active === true, request.params.id])
      if (!result.rows[0]) return response.status(404).json({ error: 'Usuario nao encontrado.' })
      response.json(result.rows[0])
    } catch (error) { sendError(response, error) }
  })

  app.delete('/api/admin/users/:id', authenticateToken, requireAdmin, async (request, response) => {
    try {
      if (request.params.id === request.user.userId) return response.status(400).json({ error: 'O administrador nao pode excluir a propria conta.' })
      const result = await pool.query(`DELETE FROM ${table('users')} WHERE id = $1 RETURNING id`, [request.params.id])
      response.status(204).end()
    } catch (error) { sendError(response, error) }
  })

  app.use(authenticateToken)
  app.use((request, _response, next) => { request.companyId = request.user.companyId; next() })

  app.get(['/api/clientes', '/clientes'], async (request, response) => {
    try {
      const companyId = request.companyId
      const result = await pool.query(`SELECT id, name AS nome, phone AS telefone, active AS status FROM ${table('clients')} WHERE company_id = $1 ORDER BY created_at`, [companyId])
      response.json(result.rows)
    } catch (error) { sendError(response, error) }
  })

  app.post(['/api/clientes', '/clientes'], async (request, response) => {
    try {
      const companyId = request.companyId
      const { id, nome, name, telefone, phone, status, active } = request.body
      const result = await pool.query(`INSERT INTO ${table('clients')} (id, company_id, name, phone, active) VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5) RETURNING id, name AS nome, phone AS telefone, active AS status`, [id || null, companyId, nome || name, telefone || phone || null, status ?? active ?? true])
      response.status(201).json(result.rows[0])
    } catch (error) { sendError(response, error) }
  })

  app.put(['/api/clientes/:id', '/clientes/:id'], async (request, response) => {
    try {
      const companyId = request.companyId
      const { nome, name, telefone, phone, status, active } = request.body
      const result = await pool.query(`UPDATE ${table('clients')} SET name = $1, phone = $2, active = $3 WHERE id = $4 AND company_id = $5 RETURNING id, name AS nome, phone AS telefone, active AS status`, [nome || name, telefone || phone || null, status ?? active ?? true, request.params.id, companyId])
      if (!result.rows[0]) return response.status(404).json({ error: 'Cliente nao encontrado.' })
      response.json(result.rows[0])
    } catch (error) { sendError(response, error) }
  })

  app.delete(['/api/clientes/:id', '/clientes/:id'], async (request, response) => {
    try {
      const companyId = request.companyId
      const result = await pool.query(`DELETE FROM ${table('clients')} WHERE id = $1 AND company_id = $2`, [request.params.id, companyId])
      response.status(result.rowCount ? 204 : 404).end()
    } catch (error) { sendError(response, error) }
  })

  app.get(['/api/produtos', '/produtos'], async (request, response) => {
    try {
      const companyId = request.companyId
      const result = await pool.query(`SELECT id, name AS nome, price AS preco_unitario FROM ${table('products')} WHERE company_id = $1 ORDER BY created_at`, [companyId])
      response.json(result.rows.map((item) => ({ ...item, preco_unitario: Number(item.preco_unitario) })))
    } catch (error) { sendError(response, error) }
  })

  app.post(['/api/produtos', '/produtos'], async (request, response) => {
    try {
      const companyId = request.companyId
      const { id, nome, name, preco_unitario, price } = request.body
      const result = await pool.query(`INSERT INTO ${table('products')} (id, company_id, name, price) VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4) RETURNING id, name AS nome, price AS preco_unitario`, [id || null, companyId, nome || name, preco_unitario ?? price])
      response.status(201).json({ ...result.rows[0], preco_unitario: Number(result.rows[0].preco_unitario) })
    } catch (error) { sendError(response, error) }
  })

  app.put(['/api/produtos/:id', '/produtos/:id'], async (request, response) => {
    try {
      const companyId = request.companyId
      const { nome, name, preco_unitario, price } = request.body
      const result = await pool.query(`UPDATE ${table('products')} SET name = $1, price = $2 WHERE id = $3 AND company_id = $4 RETURNING id, name AS nome, price AS preco_unitario`, [nome || name, preco_unitario ?? price, request.params.id, companyId])
      if (!result.rows[0]) return response.status(404).json({ error: 'Produto nao encontrado.' })
      response.json({ ...result.rows[0], preco_unitario: Number(result.rows[0].preco_unitario) })
    } catch (error) { sendError(response, error) }
  })

  app.delete(['/api/produtos/:id', '/produtos/:id'], async (request, response) => {
    try {
      const companyId = request.companyId
      const result = await pool.query(`DELETE FROM ${table('products')} WHERE id = $1 AND company_id = $2`, [request.params.id, companyId])
      response.status(result.rowCount ? 204 : 404).end()
    } catch (error) { sendError(response, error) }
  })

  app.get(['/api/pedidos', '/pedidos'], async (request, response) => {
    try {
      const companyId = request.companyId
      const filters = []
      const values = [companyId]
      if (request.query.createdAt) { values.push(request.query.createdAt); filters.push(`o.created_at::date = $${values.length}`) }
      if (request.query.delivery) { values.push(request.query.delivery); filters.push(`o.delivery_date = $${values.length}`) }
      const result = await pool.query(`SELECT o.id, o.client_id, o.delivery_date, o.created_at::date AS created_at, o.status, o.observation, COALESCE(json_agg(json_build_object('productId', oi.product_id, 'productName', oi.product_name, 'quantity', oi.quantity, 'unitPrice', oi.unit_price) ORDER BY oi.created_at) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items FROM ${table('orders')} o LEFT JOIN ${table('order_items')} oi ON oi.order_id = o.id WHERE o.company_id = $1 ${filters.length ? `AND ${filters.join(' AND ')}` : ''} GROUP BY o.id ORDER BY o.created_at DESC`, values)
      response.json(result.rows.map(mapOrder))
    } catch (error) { sendError(response, error) }
  })

  async function saveOrder(pool, companyId, orderId, payload) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const order = payload
      if (!order.clientId || !order.delivery || !Array.isArray(order.items) || !order.items.length) throw new Error('Pedido invalido.')
      const id = orderId || order.id || (await client.query('SELECT gen_random_uuid() AS id')).rows[0].id
      const existing = orderId ? await client.query(`SELECT created_at FROM ${table('orders')} WHERE id = $1 AND company_id = $2`, [orderId, companyId]) : null
      if (orderId && !existing?.rows[0]) throw new Error('Pedido nao encontrado.')
      await client.query(`DELETE FROM ${table('order_items')} WHERE order_id = $1`, [id])
      await client.query(`DELETE FROM ${table('orders')} WHERE id = $1 AND company_id = $2`, [id, companyId])
      await client.query(`INSERT INTO ${table('orders')} (id, company_id, client_id, delivery_date, created_at, status, observation) VALUES ($1, $2, $3, $4, $5::date, $6, $7)`, [id, companyId, order.clientId, order.delivery, order.createdAt || existing?.rows[0]?.created_at || order.delivery, order.status || 'pending', order.observation || null])
      for (const item of order.items) {
        const product = (await client.query(`SELECT name, price FROM ${table('products')} WHERE id = $1 AND company_id = $2`, [item.productId, companyId])).rows[0]
        if (!product) throw new Error('Produto do pedido nao encontrado.')
        await client.query(`INSERT INTO ${table('order_items')} (order_id, product_id, product_name, quantity, unit_price) VALUES ($1, $2, $3, $4, $5)`, [id, item.productId, product.name, item.quantity, item.unitPrice || product.price])
      }
      await client.query('COMMIT')
      return getOrder(pool, companyId, id)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally { client.release() }
  }

  app.post(['/api/pedidos', '/pedidos'], async (request, response) => {
    try { response.status(201).json(await saveOrder(pool, request.companyId, null, request.body)) } catch (error) { sendError(response, error) }
  })

  app.put(['/api/pedidos/:id', '/pedidos/:id'], async (request, response) => {
    try { response.json(await saveOrder(pool, request.companyId, request.params.id, request.body)) } catch (error) { sendError(response, error) }
  })

  app.delete(['/api/pedidos/:id', '/pedidos/:id'], async (request, response) => {
    try {
      const result = await pool.query(`DELETE FROM ${table('orders')} WHERE id = $1 AND company_id = $2`, [request.params.id, request.companyId])
      response.status(result.rowCount ? 204 : 404).end()
    } catch (error) { sendError(response, error) }
  })

  app.get(['/api/pedidos/:id', '/pedidos/:id'], async (request, response) => {
    try {
      const order = await getOrder(pool, request.companyId, request.params.id)
      if (!order) return response.status(404).json({ error: 'Pedido nao encontrado.' })
      response.json(order)
    } catch (error) { sendError(response, error) }
  })

  app.patch(['/api/pedidos/:id/status', '/pedidos/:id/status'], async (request, response) => {
    try {
      if (!orderStatus.has(request.body.status)) return response.status(400).json({ error: 'Status invalido.' })
      const result = await pool.query(`UPDATE ${table('orders')} SET status = $1 WHERE id = $2 AND company_id = $3 RETURNING id, status`, [request.body.status, request.params.id, request.companyId])
      if (!result.rows[0]) return response.status(404).json({ error: 'Pedido nao encontrado.' })
      response.json(result.rows[0])
    } catch (error) { sendError(response, error) }
  })

  app.get(['/api/separacao', '/separacao'], async (request, response) => {
    try {
      const query = request.query.data || request.query.date
      const orders = await pool.query(`SELECT o.id, o.client_id, o.delivery_date, o.created_at::date AS created_at, o.status, o.observation, COALESCE(json_agg(json_build_object('productId', oi.product_id, 'productName', oi.product_name, 'quantity', oi.quantity, 'unitPrice', oi.unit_price) ORDER BY oi.created_at) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items FROM ${table('orders')} o LEFT JOIN ${table('order_items')} oi ON oi.order_id = o.id WHERE o.delivery_date = $1 AND o.company_id = $2 GROUP BY o.id ORDER BY o.created_at DESC`, [query, request.companyId])
      response.json(orders.rows.map(mapOrder))
    } catch (error) { sendError(response, error) }
  })

  app.get(['/api/compras', '/compras'], async (request, response) => {
    try {
      const companyId = request.companyId
      const lists = await pool.query(`SELECT id, created_at FROM ${table('shopping_lists')} WHERE company_id = $1 ORDER BY created_at DESC`, [companyId])
      const items = await pool.query(`SELECT shopping_list_id, name, quantity FROM ${table('shopping_list_items')} WHERE shopping_list_id IN (SELECT id FROM ${table('shopping_lists')} WHERE company_id = $1) ORDER BY created_at`, [companyId])
      response.json(lists.rows.map((list) => ({ id: list.id, data_criacao: databaseDate(list.created_at), itens: items.rows.filter((item) => item.shopping_list_id === list.id).map(({ name, quantity }) => ({ nome: name, quantidade: quantity })) })))
    } catch (error) { sendError(response, error) }
  })

  app.post(['/api/compras', '/compras'], async (request, response) => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const companyId = request.companyId
      const list = request.body
      const id = list.id || (await client.query('SELECT gen_random_uuid() AS id')).rows[0].id
      await client.query(`INSERT INTO ${table('shopping_lists')} (id, company_id, created_at) VALUES ($1, $2, $3)`, [id, companyId, list.data_criacao || list.createdAt || databaseDate(new Date())])
      for (const item of list.itens || list.items || []) await client.query(`INSERT INTO ${table('shopping_list_items')} (shopping_list_id, name, quantity) VALUES ($1, $2, $3)`, [id, item.nome || item.name, item.quantidade || item.quantity])
      await client.query('COMMIT')
      response.status(201).json({ id })
    } catch (error) { await client.query('ROLLBACK'); sendError(response, error) } finally { client.release() }
  })

  app.put(['/api/compras/:id', '/compras/:id'], async (request, response) => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const companyId = request.companyId
      const list = request.body
      const existing = await client.query(`SELECT id FROM ${table('shopping_lists')} WHERE id = $1 AND company_id = $2`, [request.params.id, companyId])
      if (!existing.rows[0]) { await client.query('ROLLBACK'); return response.status(404).json({ error: 'Lista de compras nao encontrada.' }) }
      await client.query(`UPDATE ${table('shopping_lists')} SET created_at = $1 WHERE id = $2`, [list.data_criacao || list.createdAt || databaseDate(new Date()), request.params.id])
      await client.query(`DELETE FROM ${table('shopping_list_items')} WHERE shopping_list_id = $1`, [request.params.id])
      for (const item of list.itens || list.items || []) await client.query(`INSERT INTO ${table('shopping_list_items')} (shopping_list_id, name, quantity) VALUES ($1, $2, $3)`, [request.params.id, item.nome || item.name, item.quantidade || item.quantity])
      await client.query('COMMIT')
      response.json({ id: request.params.id })
    } catch (error) { await client.query('ROLLBACK'); sendError(response, error) } finally { client.release() }
  })

  app.delete(['/api/compras/:id', '/compras/:id'], async (request, response) => {
    try {
      const result = await pool.query(`DELETE FROM ${table('shopping_lists')} WHERE id = $1 AND company_id = $2`, [request.params.id, request.companyId])
      response.status(result.rowCount ? 204 : 404).end()
    } catch (error) { sendError(response, error) }
  })

  app.get(['/api/relatorios', '/relatorios'], async (request, response) => {
    try {
      const companyId = request.companyId
      const type = request.query.tipo || 'diario'
      const period = request.query.periodo || databaseDate(new Date())
      const date = new Date(`${period}T12:00:00`)
      const start = type === 'mensal' ? new Date(date.getFullYear(), date.getMonth(), 1) : type === 'semanal' ? new Date(date.getTime() - ((date.getDay() + 6) % 7) * 86400000) : date
      const end = type === 'mensal' ? new Date(date.getFullYear(), date.getMonth() + 1, 0) : type === 'semanal' ? new Date(start.getTime() + 6 * 86400000) : date
      const startDate = databaseDate(start)
      const endDate = databaseDate(end)
      const result = await pool.query(`SELECT delivery_date::date, status, COUNT(*)::integer AS pedidos, COALESCE(SUM(total), 0)::numeric AS valor FROM ${table('order_totals')} WHERE company_id = $1 AND delivery_date BETWEEN $2 AND $3 GROUP BY delivery_date, status ORDER BY delivery_date`, [companyId, startDate, endDate])
      response.json({ tipo: type, periodo: period, inicio: startDate, fim: endDate, dados: result.rows.map((row) => ({ ...row, delivery_date: databaseDate(row.delivery_date), valor: Number(row.valor) })) })
    } catch (error) { sendError(response, error) }
  })
}
