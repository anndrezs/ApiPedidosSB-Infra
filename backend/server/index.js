import 'dotenv/config'
import express from 'express'
import { Pool } from 'pg'
import databaseConfig from '../../database/database.config.js'
import { registerRoutes } from './routes.js'

const app = express()
const pool = new Pool(databaseConfig)
const port = Number(process.env.API_PORT || 3000)
const table = (name) => `pediflowsb.${name}`
const databaseDate = (value) => {
  if (typeof value === 'string') return value.slice(0, 10)
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

app.use(express.json({ limit: '8mb' }))

async function getCompany(client, companyId) {
  const result = await client.query(`SELECT id, name, theme, accent, avatar_data FROM ${table('companies')} WHERE id = $1`, [companyId])
  if (!result.rows[0]) throw new Error('Empresa nao encontrada.')
  return result.rows[0]
}

async function readState(client, companyId) {
  const company = await getCompany(client, companyId)
  const clients = await client.query(`SELECT id, name, phone, active FROM ${table('clients')} WHERE company_id = $1 ORDER BY created_at`, [company.id])
  const products = await client.query(`SELECT id, name, price FROM ${table('products')} WHERE company_id = $1 ORDER BY created_at`, [company.id])
  const orders = await client.query(`SELECT id, client_id, delivery_date, created_at::date AS created_at, status, observation FROM ${table('orders')} WHERE company_id = $1 ORDER BY created_at DESC`, [company.id])
  const items = await client.query(`SELECT order_id, product_id, product_name, quantity, unit_price FROM ${table('order_items')} WHERE order_id IN (SELECT id FROM ${table('orders')} WHERE company_id = $1) ORDER BY created_at`, [company.id])
  const lists = await client.query(`SELECT id, created_at FROM ${table('shopping_lists')} WHERE company_id = $1 ORDER BY created_at DESC`, [company.id])
  const listItems = await client.query(`SELECT shopping_list_id, name, quantity FROM ${table('shopping_list_items')} WHERE shopping_list_id IN (SELECT id FROM ${table('shopping_lists')} WHERE company_id = $1) ORDER BY created_at`, [company.id])

  return {
    company: company.name,
    theme: company.theme,
    accent: company.accent,
    avatar: company.avatar_data || '',
    clients: clients.rows,
    products: products.rows.map((item) => ({ ...item, price: Number(item.price) })),
    orders: orders.rows.map((order) => ({
      id: order.id,
      clientId: order.client_id,
      createdAt: databaseDate(order.created_at),
      delivery: databaseDate(order.delivery_date),
      status: order.status,
      observation: order.observation || '',
      items: items.rows.filter((item) => item.order_id === order.id).map((item) => ({
        productId: item.product_id,
        productName: item.product_name,
        quantity: item.quantity,
        unitPrice: Number(item.unit_price),
      })),
    })),
    shopping: lists.rows.map((list) => ({
      id: list.id,
      createdAt: databaseDate(list.created_at),
      items: listItems.rows.filter((item) => item.shopping_list_id === list.id).map(({ name, quantity }) => ({ name, quantity })),
    })),
  }
}

async function writeState(state, companyId) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const company = await getCompany(client, companyId)
    await client.query(`UPDATE ${table('companies')} SET name = $1, theme = $2, accent = $3, avatar_data = $4 WHERE id = $5`, [state.company?.trim() || 'Empresa', state.theme || 'light', state.accent || 'orange', state.avatar || null, company.id])
    await client.query(`DELETE FROM ${table('order_items')} WHERE order_id IN (SELECT id FROM ${table('orders')} WHERE company_id = $1)`, [company.id])
    await client.query(`DELETE FROM ${table('orders')} WHERE company_id = $1`, [company.id])
    await client.query(`DELETE FROM ${table('shopping_list_items')} WHERE shopping_list_id IN (SELECT id FROM ${table('shopping_lists')} WHERE company_id = $1)`, [company.id])
    await client.query(`DELETE FROM ${table('shopping_lists')} WHERE company_id = $1`, [company.id])
    await client.query(`DELETE FROM ${table('clients')} WHERE company_id = $1`, [company.id])
    await client.query(`DELETE FROM ${table('products')} WHERE company_id = $1`, [company.id])

    for (const item of state.clients || []) {
      await client.query(`INSERT INTO ${table('clients')} (id, company_id, name, phone, active) VALUES ($1, $2, $3, $4, $5)`, [item.id, company.id, item.name, item.phone || null, item.active !== false])
    }
    for (const item of state.products || []) {
      await client.query(`INSERT INTO ${table('products')} (id, company_id, name, price) VALUES ($1, $2, $3, $4)`, [item.id, company.id, item.name, item.price])
    }
    for (const order of state.orders || []) {
      await client.query(`INSERT INTO ${table('orders')} (id, company_id, client_id, delivery_date, created_at, status, observation) VALUES ($1, $2, $3, $4, $5::date, $6, $7)`, [order.id, company.id, order.clientId || null, order.delivery, order.createdAt || order.delivery, order.status || 'pending', order.observation || null])
      for (const item of order.items || []) {
        const product = (state.products || []).find((entry) => entry.id === item.productId)
        await client.query(`INSERT INTO ${table('order_items')} (order_id, product_id, product_name, quantity, unit_price) VALUES ($1, $2, $3, $4, $5)`, [order.id, item.productId || null, item.productName || product?.name || 'Produto removido', item.quantity, item.unitPrice || product?.price || 0])
      }
    }
    for (const list of state.shopping || []) {
      await client.query(`INSERT INTO ${table('shopping_lists')} (id, company_id, created_at) VALUES ($1, $2, $3)`, [list.id, company.id, list.createdAt || new Date().toISOString().slice(0, 10)])
      for (const item of list.items || []) {
        await client.query(`INSERT INTO ${table('shopping_list_items')} (shopping_list_id, name, quantity) VALUES ($1, $2, $3)`, [list.id, item.name, item.quantity])
      }
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export { readState, writeState }

registerRoutes(app, pool)

app.get('/api/health', async (_request, response) => {
  try {
    await pool.query('SELECT 1')
    response.json({ ok: true })
  } catch (error) {
    response.status(503).json({ ok: false, error: error.message })
  }
})

app.listen(port, () => console.log(`API Pediflow ouvindo em http://localhost:${port}`))
