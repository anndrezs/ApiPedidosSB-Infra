const schema = 'pediflow'
const table = (name) => `${schema}.${name}`

const databaseDate = (value) => {
  if (typeof value === 'string') return value.slice(0, 10)
  return value.toISOString().slice(0, 10)
}

const orderStatus = new Set(['pending', 'ready', 'delivered'])

async function getCompany(pool) {
  const result = await pool.query(`SELECT id FROM ${table('companies')} ORDER BY created_at LIMIT 1`)
  if (result.rows[0]) return result.rows[0].id
  const created = await pool.query(`INSERT INTO ${table('companies')} (name) VALUES ($1) RETURNING id`, ['Atelie da Nanda'])
  return created.rows[0].id
}

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

export function registerRoutes(app, pool) {
  app.use((request, response, next) => {
    const origin = process.env.FRONTEND_URL || '*'
    response.header('Access-Control-Allow-Origin', origin)
    response.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')
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

  app.get(['/api/clientes', '/clientes'], async (_request, response) => {
    try {
      const companyId = await getCompany(pool)
      const result = await pool.query(`SELECT id, name AS nome, phone AS telefone, active AS status FROM ${table('clients')} WHERE company_id = $1 ORDER BY created_at`, [companyId])
      response.json(result.rows)
    } catch (error) { sendError(response, error) }
  })

  app.post(['/api/clientes', '/clientes'], async (request, response) => {
    try {
      const companyId = await getCompany(pool)
      const { id, nome, name, telefone, phone, status, active } = request.body
      const result = await pool.query(`INSERT INTO ${table('clients')} (id, company_id, name, phone, active) VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5) RETURNING id, name AS nome, phone AS telefone, active AS status`, [id || null, companyId, nome || name, telefone || phone || null, status ?? active ?? true])
      response.status(201).json(result.rows[0])
    } catch (error) { sendError(response, error) }
  })

  app.put(['/api/clientes/:id', '/clientes/:id'], async (request, response) => {
    try {
      const companyId = await getCompany(pool)
      const { nome, name, telefone, phone, status, active } = request.body
      const result = await pool.query(`UPDATE ${table('clients')} SET name = $1, phone = $2, active = $3 WHERE id = $4 AND company_id = $5 RETURNING id, name AS nome, phone AS telefone, active AS status`, [nome || name, telefone || phone || null, status ?? active ?? true, request.params.id, companyId])
      if (!result.rows[0]) return response.status(404).json({ error: 'Cliente nao encontrado.' })
      response.json(result.rows[0])
    } catch (error) { sendError(response, error) }
  })

  app.delete(['/api/clientes/:id', '/clientes/:id'], async (request, response) => {
    try {
      const companyId = await getCompany(pool)
      const result = await pool.query(`DELETE FROM ${table('clients')} WHERE id = $1 AND company_id = $2`, [request.params.id, companyId])
      response.status(result.rowCount ? 204 : 404).end()
    } catch (error) { sendError(response, error) }
  })

  app.get(['/api/produtos', '/produtos'], async (_request, response) => {
    try {
      const companyId = await getCompany(pool)
      const result = await pool.query(`SELECT id, name AS nome, price AS preco_unitario FROM ${table('products')} WHERE company_id = $1 ORDER BY created_at`, [companyId])
      response.json(result.rows.map((item) => ({ ...item, preco_unitario: Number(item.preco_unitario) })))
    } catch (error) { sendError(response, error) }
  })

  app.post(['/api/produtos', '/produtos'], async (request, response) => {
    try {
      const companyId = await getCompany(pool)
      const { id, nome, name, preco_unitario, price } = request.body
      const result = await pool.query(`INSERT INTO ${table('products')} (id, company_id, name, price) VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4) RETURNING id, name AS nome, price AS preco_unitario`, [id || null, companyId, nome || name, preco_unitario ?? price])
      response.status(201).json({ ...result.rows[0], preco_unitario: Number(result.rows[0].preco_unitario) })
    } catch (error) { sendError(response, error) }
  })

  app.put(['/api/produtos/:id', '/produtos/:id'], async (request, response) => {
    try {
      const companyId = await getCompany(pool)
      const { nome, name, preco_unitario, price } = request.body
      const result = await pool.query(`UPDATE ${table('products')} SET name = $1, price = $2 WHERE id = $3 AND company_id = $4 RETURNING id, name AS nome, price AS preco_unitario`, [nome || name, preco_unitario ?? price, request.params.id, companyId])
      if (!result.rows[0]) return response.status(404).json({ error: 'Produto nao encontrado.' })
      response.json({ ...result.rows[0], preco_unitario: Number(result.rows[0].preco_unitario) })
    } catch (error) { sendError(response, error) }
  })

  app.delete(['/api/produtos/:id', '/produtos/:id'], async (request, response) => {
    try {
      const companyId = await getCompany(pool)
      const result = await pool.query(`DELETE FROM ${table('products')} WHERE id = $1 AND company_id = $2`, [request.params.id, companyId])
      response.status(result.rowCount ? 204 : 404).end()
    } catch (error) { sendError(response, error) }
  })

  app.get(['/api/pedidos', '/pedidos'], async (request, response) => {
    try {
      const companyId = await getCompany(pool)
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
    try { response.status(201).json(await saveOrder(pool, await getCompany(pool), null, request.body)) } catch (error) { sendError(response, error) }
  })

  app.put(['/api/pedidos/:id', '/pedidos/:id'], async (request, response) => {
    try { response.json(await saveOrder(pool, await getCompany(pool), request.params.id, request.body)) } catch (error) { sendError(response, error) }
  })

  app.delete(['/api/pedidos/:id', '/pedidos/:id'], async (request, response) => {
    try {
      const result = await pool.query(`DELETE FROM ${table('orders')} WHERE id = $1 AND company_id = $2`, [request.params.id, await getCompany(pool)])
      response.status(result.rowCount ? 204 : 404).end()
    } catch (error) { sendError(response, error) }
  })

  app.get(['/api/pedidos/:id', '/pedidos/:id'], async (request, response) => {
    try {
      const order = await getOrder(pool, await getCompany(pool), request.params.id)
      if (!order) return response.status(404).json({ error: 'Pedido nao encontrado.' })
      response.json(order)
    } catch (error) { sendError(response, error) }
  })

  app.patch(['/api/pedidos/:id/status', '/pedidos/:id/status'], async (request, response) => {
    try {
      if (!orderStatus.has(request.body.status)) return response.status(400).json({ error: 'Status invalido.' })
      const result = await pool.query(`UPDATE ${table('orders')} SET status = $1 WHERE id = $2 RETURNING id, status`, [request.body.status, request.params.id])
      if (!result.rows[0]) return response.status(404).json({ error: 'Pedido nao encontrado.' })
      response.json(result.rows[0])
    } catch (error) { sendError(response, error) }
  })

  app.get(['/api/separacao', '/separacao'], async (request, response) => {
    try {
      const query = request.query.data || request.query.date
      const orders = await pool.query(`SELECT o.id, o.client_id, o.delivery_date, o.created_at::date AS created_at, o.status, o.observation, COALESCE(json_agg(json_build_object('productId', oi.product_id, 'productName', oi.product_name, 'quantity', oi.quantity, 'unitPrice', oi.unit_price) ORDER BY oi.created_at) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items FROM ${table('orders')} o LEFT JOIN ${table('order_items')} oi ON oi.order_id = o.id WHERE o.delivery_date = $1 GROUP BY o.id ORDER BY o.created_at DESC`, [query])
      response.json(orders.rows.map(mapOrder))
    } catch (error) { sendError(response, error) }
  })

  app.get(['/api/compras', '/compras'], async (_request, response) => {
    try {
      const companyId = await getCompany(pool)
      const lists = await pool.query(`SELECT id, created_at FROM ${table('shopping_lists')} WHERE company_id = $1 ORDER BY created_at DESC`, [companyId])
      const items = await pool.query(`SELECT shopping_list_id, name, quantity FROM ${table('shopping_list_items')} WHERE shopping_list_id IN (SELECT id FROM ${table('shopping_lists')} WHERE company_id = $1) ORDER BY created_at`, [companyId])
      response.json(lists.rows.map((list) => ({ id: list.id, data_criacao: databaseDate(list.created_at), itens: items.rows.filter((item) => item.shopping_list_id === list.id).map(({ name, quantity }) => ({ nome: name, quantidade: quantity })) })))
    } catch (error) { sendError(response, error) }
  })

  app.post(['/api/compras', '/compras'], async (request, response) => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const companyId = await getCompany(pool)
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
      const companyId = await getCompany(pool)
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
      const result = await pool.query(`DELETE FROM ${table('shopping_lists')} WHERE id = $1 AND company_id = $2`, [request.params.id, await getCompany(pool)])
      response.status(result.rowCount ? 204 : 404).end()
    } catch (error) { sendError(response, error) }
  })

  app.get(['/api/relatorios', '/relatorios'], async (request, response) => {
    try {
      const companyId = await getCompany(pool)
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
