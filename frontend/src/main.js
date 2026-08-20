import './style.css'
import { jsPDF } from 'jspdf'

const localDateKey = (value) => {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
const today = localDateKey(new Date())
const apiBaseUrl = (import.meta.env.VITE_API_URL || 'http://localhost:3000').replace(/\/$/, '')
const apiUrl = (path) => `${apiBaseUrl}${path}`
let state = null
let view = 'overview'; let edit = null; let separationDate = today; let ordersDate = today; let ordersFilter = 'created'; let reportDate = today; let reportMode = 'day'; let reportWeekStart = null
const nav = [['overview', '⌂', 'Visao geral'], ['clients', '♙', 'Clientes'], ['products', '▦', 'Produtos'], ['orders', '↗', 'Pedidos'], ['separation', '☷', 'Separacao'], ['shopping', '□', 'Lista de compras'], ['reports', '◒', 'Relatorios'], ['settings', '⚙', 'Configuracoes']]
let saveQueue = Promise.resolve()
const save = () => {
  const snapshot = structuredClone(state)
  saveQueue = saveQueue.then(async () => {
    const response = await fetch(apiUrl('/api/state'), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot) })
    if (!response.ok) throw new Error('Falha ao salvar os dados')
  }).catch((error) => {
    flash('Nao foi possivel salvar no banco de dados')
    console.error(error)
  })
  return saveQueue
}
const applyTheme = () => { document.documentElement.dataset.theme = state.theme === 'dark' ? 'dark' : 'light'; document.documentElement.dataset.accent = ['purple', 'green', 'blue', 'red', 'gray', 'pink', 'yellow', 'orange'].includes(state.accent) ? state.accent : 'orange' }
const money = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const date = (v) => new Date(`${v}T12:00:00`).toLocaleDateString('pt-BR')
const dateKey = localDateKey
const addDays = (value, amount) => { const result = new Date(value); result.setDate(result.getDate() + amount); return result }
const reportPeriod = (mode, anchor) => {
  const current = new Date(`${anchor}T12:00:00`)
  if (mode === 'month') return { start: dateKey(new Date(current.getFullYear(), current.getMonth(), 1)), end: dateKey(new Date(current.getFullYear(), current.getMonth() + 1, 0)) }
  if (mode === 'week') {
    const mondayOffset = (current.getDay() + 6) % 7
    const start = addDays(current, -mondayOffset)
    return { start: dateKey(start), end: dateKey(addDays(start, 6)) }
  }
  return { start: anchor, end: anchor }
}
const reportWeeks = (anchor) => {
  const month = new Date(`${anchor}T12:00:00`)
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1)
  const firstMonday = addDays(firstDay, -((firstDay.getDay() + 6) % 7))
  const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0)
  const weeks = []
  for (let start = firstMonday; start <= lastDay; start = addDays(start, 7)) weeks.push(reportPeriod('week', dateKey(start)))
  return weeks
}
const reportRangeLabel = (range) => `${date(range.start)} a ${date(range.end)}`
const id = () => crypto.randomUUID()
const client = (id) => state.clients.find((x) => x.id === id)
const product = (id) => state.products.find((x) => x.id === id)
const total = (o) => o.items.reduce((s, i) => s + (product(i.productId)?.price || i.unitPrice || 0) * Number(i.quantity), 0)
const ordersTotal = (orders) => orders.reduce((sum, order) => sum + total(order), 0)
const greeting = () => { const hour = new Date().getHours(); return hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite' }
const initials = (name) => (name || 'Pedi flow').trim().split(/\s+/).map((word) => word[0]).slice(0, 2).join('').toUpperCase()
const profileAvatar = () => state.avatar ? `<img src="${state.avatar}" alt="Foto do perfil">` : initials(state.company)
const isMobileDevice = () => /Android|iPhone|iPad|iPod|Windows Phone/i.test(navigator.userAgent)
const flash = (text) => { const el = document.querySelector('#toast'); el.textContent = text; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2400) }
let pendingDelete = null
const deleteLabels = { client: 'cliente', product: 'produto', order: 'pedido', list: 'lista de compras' }
const requestDelete = (button) => { const type = Object.keys(deleteLabels).find((key) => button.dataset[`delete${key[0].toUpperCase()}${key.slice(1)}`]); const idKey = `delete${type[0].toUpperCase()}${type.slice(1)}`; pendingDelete = { type, id: button.dataset[idKey] }; const modal = document.querySelector('#confirm-modal'); modal.querySelector('[data-confirm-title]').textContent = `Excluir ${deleteLabels[type]}`; modal.querySelector('[data-confirm-message]').textContent = `Deseja realmente excluir este ${deleteLabels[type]}? Esta acao nao pode ser desfeita.`; modal.classList.add('show'); modal.querySelector('[data-confirm-cancel]').focus() }
const closeDeleteModal = () => { const modal = document.querySelector('#confirm-modal'); modal.classList.remove('show'); pendingDelete = null }
const confirmDelete = () => { if (!pendingDelete) return; const { type, id: itemId } = pendingDelete; if (type === 'client') state.clients = state.clients.filter((item) => item.id !== itemId); if (type === 'product') state.products = state.products.filter((item) => item.id !== itemId); if (type === 'order') state.orders = state.orders.filter((item) => item.id !== itemId); if (type === 'list') state.shopping = state.shopping.filter((item) => item.id !== itemId); save(); closeDeleteModal(); ({ client: clients, product: products, order: orders, list: shopping })[type]() }
async function exportTextLegacy(text, name) {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  const margin = 18
  const pageWidth = 210
  const pageHeight = 297
  const contentWidth = pageWidth - margin * 2
  const exportDate = date(localDateKey(new Date()))
  const documentTitle = name.replace('.pdf', '').replaceAll('_', ' ')
  const addHeader = () => {
    pdf.setFillColor(245, 245, 245)
    pdf.roundedRect(margin, 14, contentWidth, 29, 4, 4, 'F')
    pdf.setTextColor(45, 40, 38)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(15)
    pdf.text(state.company, margin + 5, 26)
    pdf.setTextColor(130, 122, 115)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    pdf.text(exportDate, margin + 5, 34)
    pdf.setDrawColor(80, 80, 80)
    pdf.setLineWidth(0.7)
    pdf.line(margin, 51, pageWidth - margin, 51)
  }
  const addFooter = (pageNumber) => {
    pdf.setDrawColor(230, 225, 218)
    pdf.setLineWidth(0.3)
    pdf.line(margin, pageHeight - 16, pageWidth - margin, pageHeight - 16)
    pdf.setTextColor(165, 155, 147)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.text(state.company, margin, pageHeight - 9)
    pdf.text(`Pagina ${pageNumber}`, pageWidth - margin - 18, pageHeight - 9)
  }
  let pageNumber = 1
  let y = 64
  addHeader()
  pdf.setTextColor(45, 40, 38)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(12)
  pdf.text(documentTitle, margin, y)
  y += 10
  const lines = pdf.splitTextToSize(text, contentWidth)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10.5)
  lines.forEach((line) => {
    if (y > pageHeight - 25) { addFooter(pageNumber); pdf.addPage(); pageNumber += 1; addHeader(); y = 64 }
    if (line.startsWith('## ') || line.startsWith('Valor total')) {
      pdf.setFont('helvetica', 'bold')
      pdf.setTextColor(55, 55, 55)
    } else {
      pdf.setFont('helvetica', 'normal')
      pdf.setTextColor(65, 59, 55)
    }
    pdf.text(line, margin, y)
    y += 5.5
  })
  addFooter(pageNumber)
  const blob = pdf.output('blob')
  const file = new File([blob], name, { type: 'application/pdf' })
  if (isMobileDevice() && navigator.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ title: state.company, text: name, files: [file] })
      flash('PDF compartilhado com sucesso')
      return
    } catch (error) {
      if (error.name === 'AbortError') return
    }
  }
  pdf.save(name)
  flash(`Arquivo ${name} gerado`)
}
async function exportText(text, name) {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  const margin = 18
  const pageWidth = 210
  const pageHeight = 297
  const contentWidth = pageWidth - margin * 2
  const exportDate = date(localDateKey(new Date()))
  const documentTitle = name.replace('.pdf', '').replaceAll('_', ' ')
  const accents = { purple: [135, 87, 181], green: [60, 154, 118], blue: [77, 130, 184], red: [214, 83, 83], gray: [115, 123, 134], pink: [216, 92, 138], yellow: [199, 148, 40], orange: [231, 111, 81] }
  const accent = accents[state.accent] || accents.orange
  const mix = (color, amount) => color.map((channel) => Math.round(channel + (255 - channel) * amount))
  const pale = mix(accent, .88)
  const line = mix(accent, .72)
  const ink = [45, 40, 38]
  const muted = [125, 116, 108]
  const setText = (color) => pdf.setTextColor(...color)
  const setFill = (color) => pdf.setFillColor(...color)
  const setDraw = (color) => pdf.setDrawColor(...color)
  const addFrame = () => {
    setDraw(line)
    pdf.setLineWidth(.45)
    pdf.roundedRect(10, 10, pageWidth - 20, pageHeight - 20, 5, 5, 'S')
    setDraw(accent)
    pdf.setLineWidth(1.2)
    pdf.line(18, 10, 55, 10)
    pdf.line(pageWidth - 55, pageHeight - 10, pageWidth - 18, pageHeight - 10)
  }
  const addHeader = () => {
    addFrame()
    setFill(pale)
    pdf.roundedRect(margin, 17, contentWidth, 37, 4, 4, 'F')
    setFill(accent)
    pdf.roundedRect(margin, 17, contentWidth, 10, 4, 4, 'F')
    pdf.rect(margin, 22, contentWidth, 5, 'F')
    setText([255, 255, 255])
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(9)
    pdf.text(state.company.toUpperCase(), margin + 6, 24)
    setText(ink)
    pdf.setFontSize(15)
    pdf.text(documentTitle, margin + 6, 39)
    setText(muted)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8.5)
    pdf.text(`Gerado em ${exportDate}`, margin + 6, 47)
    setDraw(accent)
    pdf.setLineWidth(.7)
    pdf.line(margin, 61, pageWidth - margin, 61)
  }
  const addFooter = (pageNumber) => {
    setDraw(line)
    pdf.setLineWidth(.35)
    pdf.line(margin, pageHeight - 19, pageWidth - margin, pageHeight - 19)
    setText(muted)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7.5)
    pdf.text(state.company, margin, pageHeight - 12)
    setText(accent)
    pdf.setFont('helvetica', 'bold')
    pdf.text(`${String(pageNumber).padStart(2, '0')}  /  PDF`, pageWidth - margin - 25, pageHeight - 12)
  }
  let pageNumber = 1
  let y = 73
  addHeader()
  const ensureSpace = (height) => { if (y + height > pageHeight - 28) { addFooter(pageNumber); pdf.addPage(); pageNumber += 1; addHeader(); y = 73 } }
  const lines = pdf.splitTextToSize(text, contentWidth - 8)
  lines.forEach((lineText) => {
    const trimmed = lineText.trim()
    if (!trimmed) { y += 3; return }
    if (trimmed.startsWith('#######')) {
      ensureSpace(9)
      setDraw(line)
      pdf.setLineWidth(.35)
      pdf.line(margin + 2, y - 2, pageWidth - margin - 2, y - 2)
      y += 6
      return
    }
    if (trimmed.startsWith('## ')) {
      ensureSpace(14)
      setText(accent)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(10)
      pdf.text(trimmed.replace(/^##\s*|\s*##$/g, ''), margin, y + 1.5)
      y += 11
      return
    }
    if (/^valor total/i.test(trimmed)) {
      ensureSpace(14)
      setDraw(line)
      pdf.setLineWidth(.35)
      pdf.line(margin, y + 6, pageWidth - margin, y + 6)
      setText(accent)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(10)
      pdf.text(trimmed, margin, y + 2)
      y += 12
      return
    }
    ensureSpace(7)
    setText(trimmed.startsWith('- ') ? ink : muted)
    pdf.setFont('helvetica', trimmed.startsWith('- ') ? 'normal' : 'normal')
    pdf.setFontSize(9.5)
    if (trimmed.startsWith('- ')) { setDraw(accent); pdf.setLineWidth(.6); pdf.line(margin, y - 1.5, margin + 3, y - 1.5) }
    pdf.text(trimmed.startsWith('- ') ? trimmed.slice(2) : trimmed, margin + (trimmed.startsWith('- ') ? 6 : 0), y)
    y += 5.5
  })
  addFooter(pageNumber)
  const blob = pdf.output('blob')
  const file = new File([blob], name, { type: 'application/pdf' })
  if (isMobileDevice() && navigator.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ title: state.company, text: name, files: [file] })
      flash('PDF compartilhado com sucesso')
      return
    } catch (error) {
      if (error.name === 'AbortError') return
    }
  }
  pdf.save(name)
  flash(`Arquivo ${name} gerado`)
}
function orderText(o) { return `## ${client(o.clientId)?.name?.toUpperCase()} ##\nPedido:\n${o.items.map((i) => `- ${i.quantity} ${product(i.productId)?.name}`).join('\n')}\n\nValor Total: ${money(total(o))}\nData de entrega: ${date(o.delivery)}${o.observation ? `\nObservacao: ${o.observation}` : ''}` }
function ordersExportText(orders) { return `${orders.map(orderText).join('\n\n#######\n\n')}\n\nValor total de todos os pedidos: ${money(ordersTotal(orders))}` }
function rowsWithTotal(orders) { return `${rows(orders)}<div class="orders-total"><span>Valor total de todos os pedidos</span><strong>${money(ordersTotal(orders))}</strong></div>` }
function layout(title, html, label = 'Painel de operacao') { document.querySelector('#app').innerHTML = `<aside class="sidebar"><div class="brand"><span class="brand-mark">P</span><div><strong>Pedi<span>flow</span></strong><small>gestao de pedidos</small></div></div><nav>${nav.map(([key, icon, text]) => `<button class="nav-item ${view === key ? 'active' : ''}" data-view="${key}"><span class="nav-icon">${icon}</span><span>${text}</span></button>`).join('')}</nav><div class="sidebar-foot"><span class="avatar">${profileAvatar()}</span><div><strong>${state.company}</strong><small>Conta administradora</small></div></div></aside><main class="main"><header class="topbar"><div><p class="eyebrow">${label}</p><h1>${title}</h1></div><span class="date-chip">Hoje, ${date(today)}</span></header><section class="content">${html}</section></main><div id="toast" class="toast"></div><div id="confirm-modal" class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><div class="confirm-card"><span class="confirm-icon">×</span><h2 id="confirm-title" data-confirm-title>Confirmar exclusao</h2><p data-confirm-message>Deseja realmente excluir este item?</p><div class="confirm-actions"><button type="button" class="ghost" data-confirm-cancel>Cancelar</button><button type="button" class="primary" data-confirm-delete>Excluir</button></div></div></div>`; document.querySelectorAll('[data-view]').forEach((b) => b.onclick = () => { view = b.dataset.view; edit = null; render() }) }
function empty(text) { return `<div class="empty"><span>◌</span><strong>${text}</strong><p>Comece adicionando um novo registro.</p></div>` }
function status(s) { return { pending: ['Pendente', 'pending'], ready: ['Separado', 'ready'], delivered: ['Entregue', 'delivered'] }[s] }
function rows(orders) { return `<div class="table-head"><span>Cliente</span><span>Itens</span><span>Total</span><span>Entrega</span><span>Status</span><span></span></div>${orders.map((o) => { const c = client(o.clientId); const [label, cls] = status(o.status); return `<div class="table-row"><div class="person"><span class="avatar soft">${c?.name.split(' ').map((n) => n[0]).slice(0, 2).join('')}</span><strong>${c?.name || 'Removido'}</strong></div><span class="items-summary">${o.items.map((i) => `${i.quantity}x ${product(i.productId)?.name}`).join(', ')}</span><strong>${money(total(o))}</strong><span>${date(o.delivery)}</span><span class="status ${cls}"><i></i>${label}</span><div class="row-actions"><button data-edit-order="${o.id}">✎</button><button data-delete-order="${o.id}">×</button></div></div>` }).join('')}</div>` }
function overview() { const orders = state.orders.filter((o) => o.delivery === today); const sales = orders.reduce((s, o) => s + total(o), 0); layout('Visão geral', `<div class="welcome"><div><span class="kicker">QUARTA-FEIRA, ${date(today).toUpperCase()}</span><h2>Bom dia, Nanda<span class="accent">.</span></h2><p>Seu atelie em movimento. Aqui esta o resumo de hoje.</p></div><button class="primary" data-new-order>+ Novo pedido</button></div><div class="stat-grid"><article class="stat-card"><span class="stat-icon coral">↗</span><div><small>Pedidos hoje</small><strong>${orders.length}</strong><em class="positive">+12% <i>vs. ontem</i></em></div></article><article class="stat-card"><span class="stat-icon green">$</span><div><small>Vendas de hoje</small><strong>${money(sales)}</strong><em class="positive">+8,4% <i>vs. ontem</i></em></div></article><article class="stat-card"><span class="stat-icon yellow">◷</span><div><small>Aguardando producao</small><strong>${orders.filter((o) => o.status === 'pending').length}</strong><em class="neutral">para hoje</em></div></article><article class="stat-card"><span class="stat-icon blue">♙</span><div><small>Clientes ativos</small><strong>${state.clients.filter((c) => c.active).length}</strong><em class="neutral">na sua base</em></div></article></div><div class="section-heading"><div><h3>Pedidos de hoje</h3><p>Acompanhe o andamento das suas entregas.</p></div><button class="text-button" data-view="orders">Ver todos →</button></div><div class="table-card">${orders.length ? rows(orders) : empty('Nenhum pedido para hoje')}</div><div class="section-heading"><h3>Acesso rapido</h3></div><div class="quick-grid"><button data-view="clients"><span>♙</span><strong>Novo cliente</strong><small>Cadastre um cliente</small></button><button data-view="products"><span>▦</span><strong>Adicionar produto</strong><small>Atualize seu catalogo</small></button><button data-view="shopping"><span>□</span><strong>Lista de compras</strong><small>Organize sua producao</small></button></div>`); bind() }
function clients() { layout('Clientes', `<div class="page-actions"><p class="muted">${state.clients.length} clientes cadastrados</p><button class="primary" data-new-client>+ Novo cliente</button></div><div class="split-layout"><div class="form-card"><div class="card-title"><h3>${edit ? 'Editar cliente' : 'Novo cliente'}</h3><span class="step">01</span></div><form id="client-form"><label>Nome completo<input name="name" required value="${edit?.name || ''}" placeholder="Ex: Marina Costa"></label><label>Telefone<input name="phone" value="${edit?.phone || ''}" placeholder="(00) 00000-0000"></label><label>Status<select name="active"><option value="true" ${edit?.active !== false ? 'selected' : ''}>Ativo</option><option value="false" ${edit?.active === false ? 'selected' : ''}>Inativo</option></select></label><button class="primary full">${edit ? 'Salvar alteracoes' : 'Salvar cliente'}</button></form></div><div class="list-card"><div class="card-title"><div><h3>Todos os clientes</h3><p>Inativos ficam fora dos novos pedidos.</p></div><span class="count-badge">${state.clients.filter((c) => c.active).length} ativos</span></div>${state.clients.map((c) => `<div class="client-line"><span class="avatar soft">${c.name.split(' ').map((n) => n[0]).slice(0, 2).join('')}</span><div class="client-info"><strong>${c.name}</strong><small>${c.phone || 'Sem telefone'}</small></div><span class="status ${c.active ? 'active' : 'inactive'}"><i></i>${c.active ? 'Ativo' : 'Inativo'}</span><button class="mini-button" data-edit-client="${c.id}">Editar</button><button class="danger-link" data-toggle-client="${c.id}">${c.active ? 'Inativar' : 'Ativar'}</button><button class="danger-icon" data-delete-client="${c.id}">×</button></div>`).join('')}</div></div>`, 'Painel de operacao'); bind(); document.querySelector('#client-form').onsubmit = (e) => { e.preventDefault(); const f = new FormData(e.target); const item = { id: edit?.id || id('c'), name: f.get('name'), phone: f.get('phone'), active: f.get('active') === 'true' }; state.clients = edit ? state.clients.map((x) => x.id === item.id ? item : x) : [...state.clients, item]; save(); edit = null; flash('Cliente salvo com sucesso'); clients() } }
function products() { layout('Produtos', `<div class="page-actions"><p class="muted">Catalogo de produtos e precos unitarios</p><button class="primary" data-new-product>+ Novo produto</button></div><div class="split-layout"><div class="form-card"><div class="card-title"><h3>${edit ? 'Editar produto' : 'Novo produto'}</h3><span class="step">01</span></div><form id="product-form"><label>Nome do produto<input name="name" required value="${edit?.name || ''}" placeholder="Ex: Bolo de cenoura"></label><label>Preco unitario<div class="money-input"><span>R$</span><input name="price" type="number" min=".01" step=".01" required value="${edit?.price || ''}" placeholder="0,00"></div></label><button class="primary full">${edit ? 'Salvar alteracoes' : 'Salvar produto'}</button></form></div><div class="list-card"><div class="card-title"><div><h3>Catalogo</h3><p>${state.products.length} produtos disponiveis para pedidos.</p></div></div>${state.products.map((p) => `<div class="product-line"><span class="product-dot">✦</span><div class="client-info"><strong>${p.name}</strong><small>Preco unitario</small></div><strong class="product-price">${money(p.price)}</strong><button class="mini-button" data-edit-product="${p.id}">Editar</button><button class="danger-icon" data-delete-product="${p.id}">×</button></div>`).join('')}</div></div>`, 'Painel de operacao'); bind(); document.querySelector('#product-form').onsubmit = (e) => { e.preventDefault(); const f = new FormData(e.target); const item = { id: edit?.id || id('p'), name: f.get('name'), price: Number(f.get('price')) }; state.products = edit ? state.products.map((x) => x.id === item.id ? item : x) : [...state.products, item]; save(); edit = null; flash('Produto salvo com sucesso'); products() } }
function orderForm() { const o = edit; const items = o?.items || [{ productId: state.products[0]?.id, quantity: 1 }]; return `<div class="form-card wide-form"><div class="card-title"><div><h3>${o ? 'Editar pedido' : 'Novo pedido'}</h3><p>Preencha os dados da encomenda.</p></div><span class="step">01</span></div><form id="order-form"><label>Cliente<select name="clientId" required>${state.clients.filter((c) => c.active).map((c) => `<option value="${c.id}" ${o?.clientId === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}</select></label><div class="items-head"><h4>Produtos do pedido</h4><button type="button" class="text-button" id="add-item">+ Adicionar produto</button></div><div id="order-items">${items.map((i) => `<div class="order-item"><select name="productId" required>${state.products.map((p) => `<option value="${p.id}" ${i.productId === p.id ? 'selected' : ''}>${p.name} · ${money(p.price)}</option>`).join('')}</select><input name="quantity" type="number" min="1" value="${i.quantity}" required><button type="button" class="remove-item">×</button></div>`).join('')}</div><label>Data de entrega<input name="delivery" type="date" value="${o?.delivery || today}" required></label><label>Observacao <span class="field-hint">(opcional)</span><textarea name="observation" rows="3" maxlength="240" placeholder="Ex: entregar pela manha ou retirar no local">${o?.observation || ''}</textarea></label><div class="total-box"><span>Valor total</span><strong id="form-total">${money(o ? total(o) : 0)}</strong></div><button class="primary full">Salvar pedido</button></form></div>` }
function orders() {
  const dateField = ordersFilter === 'created' ? 'createdAt' : 'delivery'
  const dateLabel = ordersFilter === 'created' ? 'Data de criacao' : 'Data de entrega'
  const emptyLabel = ordersFilter === 'created' ? 'Nenhum pedido criado nesta data' : 'Nenhum pedido com entrega nesta data'
  const list = state.orders.filter((order) => order[dateField] === ordersDate)
  layout('Pedidos', `<div class="page-actions"><p class="muted">Consulte e acompanhe todas as encomendas.</p><button class="primary" data-new-order>+ Novo pedido</button></div><div class="toolbar"><div class="filter-pills"><button class="${ordersFilter === 'created' ? 'selected' : ''}" data-orders-filter="created">Criacao</button><button class="${ordersFilter === 'delivery' ? 'selected' : ''}" data-orders-filter="delivery">Entrega</button></div><div class="date-select"><label>${dateLabel}<input id="orders-date" type="date" value="${ordersDate}"></label><div><strong>${list.length}</strong><span> pedidos encontrados</span></div></div><button class="outline-button" id="export-orders">⇩ Exportar pedidos</button></div><div class="table-card">${list.length ? rowsWithTotal(list) : empty(emptyLabel)}</div>`, 'Painel de operacao')
  bind()
  document.querySelectorAll('[data-orders-filter]').forEach((button) => button.onclick = () => { ordersFilter = button.dataset.ordersFilter; orders() })
  document.querySelector('#orders-date').onchange = (event) => { ordersDate = event.target.value || today; orders() }
  document.querySelector('#export-orders').onclick = () => exportText(ordersExportText(list), `Pedidos_${date(ordersDate).replaceAll('/', '-')}.pdf`)
}
function separation() { const list = state.orders.filter((o) => o.delivery === separationDate); layout('Separacão', `<div class="page-actions"><p class="muted">Organize a producao por data de entrega.</p><button class="outline-button" id="export-separation">⇩ Exportar separacao</button></div><div class="date-select"><label>Data de entrega<input id="sep-date" type="date" value="${separationDate}"></label><div><strong>${list.length}</strong><span> pedidos encontrados</span></div></div><div class="separation-list">${list.length ? list.map((o) => { const [label, cls] = status(o.status); return `<article class="separation-card"><div class="separation-top"><div><h3>${client(o.clientId)?.name}</h3><span class="status ${cls}"><i></i>${label}</span></div><strong>${money(total(o))}</strong></div><div class="separation-items">${o.items.map((i) => `<div><b>${i.quantity}</b><span>${product(i.productId)?.name}</span></div>`).join('')}</div><p class="delivery-line">Data de entrega: ${date(o.delivery)}</p><div class="separation-actions">${o.status === 'pending' ? `<button class="outline-button" data-ready="${o.id}">✓ Marcar como separado</button>` : ''}${o.status !== 'delivered' ? `<button class="primary small" data-delivered="${o.id}">✓ Marcar como entregue</button>` : '<span class="delivered-note">Pedido entregue</span>'}</div></article>` }).join('') : empty('Nenhum pedido nesta data')}</div><div class="orders-total"><span>Valor total de todos os pedidos</span><strong>${money(ordersTotal(list))}</strong></div>`, 'Painel de operacao'); bind(); document.querySelector('#sep-date').onchange = (e) => { separationDate = e.target.value; separation() }; document.querySelector('#export-separation').onclick = () => exportText(ordersExportText(list), `Separacao_${date(separationDate).replaceAll('/', '-')}.pdf`) }
function shopping() { layout('Lista de compras', `<div class="page-actions"><p class="muted">Planeje os insumos da sua producao.</p><button class="primary" data-new-list>+ Nova lista</button></div><div class="split-layout"><div class="form-card"><div class="card-title"><h3>${edit ? 'Editar lista' : 'Nova lista'}</h3><span class="step">01</span></div><form id="shop-form"><div id="shop-items">${(edit?.items || [{ name: '', quantity: '' }]).map((i) => `<div class="order-item"><input name="item" value="${i.name}" placeholder="Item, ex: farinha" required><input name="qty" value="${i.quantity}" placeholder="Quantidade" required><button type="button" class="remove-item">×</button></div>`).join('')}</div><button type="button" class="text-button" id="add-shop">+ Adicionar item</button><button class="primary full">Salvar lista</button></form></div><div class="list-card"><div class="card-title"><div><h3>Listas salvas</h3><p>Suas listas recentes.</p></div></div>${state.shopping.length ? state.shopping.map((l) => `<div class="saved-list"><div><strong>Lista de compras</strong><small>${date(l.createdAt)} · ${l.items.length} itens</small></div><button class="outline-button" data-export-list="${l.id}">Exportar</button><button class="mini-button" data-edit-list="${l.id}">Editar</button><button class="danger-icon" data-delete-list="${l.id}">×</button></div>`).join('') : empty('Nenhuma lista salva')}</div></div>`, 'Painel de operacao'); bind(); document.querySelector('#add-shop').onclick = () => { document.querySelector('#shop-items').insertAdjacentHTML('beforeend', '<div class="order-item"><input name="item" placeholder="Item, ex: farinha" required><input name="qty" placeholder="Quantidade" required><button type="button" class="remove-item">×</button></div>'); removeButtons() }; removeButtons(); document.querySelector('#shop-form').onsubmit = (e) => { e.preventDefault(); const f = new FormData(e.target); const names = f.getAll('item'); const qty = f.getAll('qty'); const l = { id: edit?.id || id('l'), createdAt: edit?.createdAt || today, items: names.map((name, i) => ({ name, quantity: qty[i] })) }; state.shopping = edit ? state.shopping.map((x) => x.id === l.id ? l : x) : [l, ...state.shopping]; save(); edit = null; flash('Lista salva com sucesso'); shopping() } }
function reportExportText(list, selectedDate) { const groups = [...list.reduce((map, order) => { const name = client(order.clientId)?.name || 'Cliente removido'; const group = map.get(name) || []; group.push(order); map.set(name, group); return map }, new Map())]; const details = groups.map(([name, orders]) => `${name}\n${orders.length} ${orders.length === 1 ? 'Pedido' : 'Pedidos'}\nValor total desse cliente: ${money(ordersTotal(orders))}`).join('\n-----------------------------------------------\n'); const sales = list.reduce((sum, order) => sum + total(order), 0); return `## Relatorio Diario - ${date(selectedDate)} ##\n${details}${details ? '\n' : ''}Total vendido: ${money(sales)}\nSoma final do dia: ${money(sales)}` }
function reports() {
  const weeks = reportWeeks(reportDate)
  if (!reportWeekStart || !weeks.some((week) => week.start === reportWeekStart)) reportWeekStart = reportPeriod('week', reportDate).start
  const range = reportMode === 'week' ? { start: reportWeekStart, end: dateKey(addDays(new Date(`${reportWeekStart}T12:00:00`), 6)) } : reportPeriod(reportMode, reportDate)
  const list = state.orders.filter((order) => order.delivery >= range.start && order.delivery <= range.end)
  const sales = list.reduce((sum, order) => sum + total(order), 0)
  const periodLabel = reportMode === 'day' ? date(reportDate) : reportRangeLabel(range)
  const weekOptions = weeks.map((week) => `<option value="${week.start}" ${week.start === reportWeekStart ? 'selected' : ''}>${reportRangeLabel(week)}</option>`).join('')
  layout('Relatorios', `<div class="report-tabs"><button class="${reportMode === 'day' ? 'selected' : ''}" data-report-mode="day">Diario</button><button class="${reportMode === 'week' ? 'selected' : ''}" data-report-mode="week">Semanal</button><button class="${reportMode === 'month' ? 'selected' : ''}" data-report-mode="month">Mensal</button></div><div class="report-header"><div><p class="muted">Resumo financeiro · ${periodLabel}</p><h2>Relatorios de vendas</h2></div><button class="outline-button" id="export-report">⇩ Exportar relatorio</button></div><div class="report-date"><label>${reportMode === 'week' ? 'Intervalo da semana<select id="report-week">${weekOptions}</select>' : 'Data do relatório<input id="report-date" type="date" value="' + reportDate + '">'}</label><span>${reportMode === 'day' ? 'Por padrão, hoje' : reportMode === 'week' ? 'Semanas de segunda a domingo' : 'Do primeiro ao último dia do mês'}</span></div><div class="report-grid"><article><span>Pedidos no periodo</span><strong>${list.length}</strong><small>Todos os pedidos registrados</small></article><article><span>Total vendido</span><strong>${money(sales)}</strong><small>Valor bruto das encomendas</small></article><article><span>Ticket medio</span><strong>${money(list.length ? sales / list.length : 0)}</strong><small>Media por pedido</small></article></div><div class="insight-card"><div><span class="kicker">DESEMPENHO DO MES</span><h3>Seu faturamento esta saudavel</h3><p>Continue acompanhando os pedidos para manter o ritmo.</p></div><div class="circle-progress"><strong>${list.length}</strong><small>pedidos</small></div></div>`, 'Painel de operacao')
  bind()
  document.querySelectorAll('[data-report-mode]').forEach((button) => button.onclick = () => { reportMode = button.dataset.reportMode; if (reportMode === 'week') reportWeekStart = reportPeriod('week', reportDate).start; reports() })
  document.querySelector('#report-date')?.addEventListener('change', (event) => { reportDate = event.target.value || today; if (reportMode === 'week') reportWeekStart = reportPeriod('week', reportDate).start; reports() })
  document.querySelector('#report-week')?.addEventListener('change', (event) => { reportWeekStart = event.target.value; reports() })
  document.querySelector('#export-report').onclick = () => exportText(reportExportText(list, range.start), `Relatorio_${reportMode}_${range.start}_${range.end}.pdf`)
}
function settings() { layout('Configuracoes', `<div class="settings-wrap"><div class="form-card"><div class="card-title"><div><h3>Dados da empresa</h3><p>Essas informacoes aparecem no painel.</p></div><span class="step">01</span></div><form id="settings-form"><label>Nome da empresa<input name="company" value="${state.company}" required></label><button class="primary full">Salvar alteracoes</button></form></div><div class="settings-note"><span class="brand-mark">P</span><h3>Pedi<span>flow</span></h3><p>Gestao simples para quem faz acontecer.</p><small>Dados salvos neste dispositivo.</small></div></div>`, 'Painel de operacao'); bind(); document.querySelector('#settings-form').onsubmit = (e) => { e.preventDefault(); state.company = new FormData(e.target).get('company'); save(); flash('Configuracoes salvas'); settings(); enhanceSettings() } }
function bind() { document.querySelectorAll('[data-new-client]').forEach((b) => b.onclick = () => { edit = null; clients() }); document.querySelectorAll('[data-new-product]').forEach((b) => b.onclick = () => { edit = null; products() }); document.querySelectorAll('[data-new-order]').forEach((b) => b.onclick = () => { edit = null; view = 'orders'; orders(); document.querySelector('.content').insertAdjacentHTML('afterbegin', orderForm()); document.querySelector('.content .page-actions').remove(); bindOrder() }); document.querySelectorAll('[data-new-list]').forEach((b) => b.onclick = () => { edit = null; shopping() }); document.querySelectorAll('[data-edit-client]').forEach((b) => b.onclick = () => { edit = client(b.dataset.editClient); clients() }); document.querySelectorAll('[data-toggle-client]').forEach((b) => b.onclick = () => { const c = client(b.dataset.toggleClient); c.active = !c.active; save(); clients() }); document.querySelectorAll('[data-edit-product]').forEach((b) => b.onclick = () => { edit = product(b.dataset.editProduct); products() }); document.querySelectorAll('[data-delete-product]').forEach((b) => b.onclick = () => { state.products = state.products.filter((p) => p.id !== b.dataset.deleteProduct); save(); products() }); document.querySelectorAll('[data-edit-order]').forEach((b) => b.onclick = () => { edit = state.orders.find((o) => o.id === b.dataset.editOrder); view = 'orders'; orders(); document.querySelector('.content').insertAdjacentHTML('afterbegin', orderForm()); document.querySelector('.content .page-actions').remove(); bindOrder() }); document.querySelectorAll('[data-delete-order]').forEach((b) => b.onclick = () => { state.orders = state.orders.filter((o) => o.id !== b.dataset.deleteOrder); save(); orders() }); document.querySelectorAll('[data-ready],[data-delivered]').forEach((b) => b.onclick = () => { const o = state.orders.find((x) => x.id === (b.dataset.ready || b.dataset.delivered)); o.status = b.dataset.ready ? 'ready' : 'delivered'; save(); separation() }); document.querySelectorAll('[data-edit-list]').forEach((b) => b.onclick = () => { edit = state.shopping.find((l) => l.id === b.dataset.editList); shopping() }); document.querySelectorAll('[data-delete-list]').forEach((b) => b.onclick = () => { state.shopping = state.shopping.filter((l) => l.id !== b.dataset.deleteList); save(); shopping() }); document.querySelectorAll('[data-export-list]').forEach((b) => b.onclick = () => { const l = state.shopping.find((x) => x.id === b.dataset.exportList); exportText(`## Lista de Compras (${date(l.createdAt)}) ##\n${l.items.map((i) => `- ${i.quantity} ${i.name}`).join('\n')}`, `Compras_${date(l.createdAt).replaceAll('/', '-')}.pdf`) }) }
function removeButtons() { document.querySelectorAll('.remove-item').forEach((b) => b.onclick = () => { if (document.querySelectorAll('.order-item').length > 1) b.parentElement.remove() }) }
function bindOrder() { const form = document.querySelector('#order-form'); const update = () => { const ps = [...form.querySelectorAll('[name=productId]')]; const qs = [...form.querySelectorAll('[name=quantity]')]; document.querySelector('#form-total').textContent = money(ps.reduce((s, p, i) => s + (product(p.value)?.price || 0) * Number(qs[i].value), 0)) }; form.oninput = update; document.querySelector('#add-item').onclick = () => { document.querySelector('#order-items').insertAdjacentHTML('beforeend', `<div class="order-item"><select name="productId" required>${state.products.map((p) => `<option value="${p.id}">${p.name} · ${money(p.price)}</option>`).join('')}</select><input name="quantity" type="number" min="1" value="1" required><button type="button" class="remove-item">×</button></div>`); removeButtons(); update() }; removeButtons(); form.onsubmit = (e) => { e.preventDefault(); const f = new FormData(form); const ps = f.getAll('productId'); const qs = f.getAll('quantity'); const o = { id: edit?.id || id('o'), clientId: f.get('clientId'), createdAt: edit?.createdAt || today, delivery: f.get('delivery'), observation: f.get('observation')?.trim(), status: edit?.status || 'pending', items: ps.map((p, i) => ({ productId: p, quantity: Number(qs[i]) })) }; state.orders = edit ? state.orders.map((x) => x.id === o.id ? o : x) : [o, ...state.orders]; save(); edit = null; flash('Pedido salvo com sucesso'); orders() } }
function enhanceOverview() { const heading = document.querySelector('.welcome h2'); const message = document.querySelector('.welcome p'); if (heading) heading.innerHTML = `${greeting()}, ${state.company}<span class="accent">.</span>`; if (message) message.textContent = 'Aqui está o resumo de hoje' }
function enhanceSettings() { const form = document.querySelector('#settings-form'); if (!form || document.querySelector('#avatar-input')) return; const paletteNames = { purple: 'Roxo', green: 'Verde', blue: 'Azul', red: 'Vermelho', gray: 'Cinza', pink: 'Rosa', yellow: 'Amarelo', orange: 'Laranja' }; const selectedAccent = paletteNames[state.accent] ? state.accent : 'orange'; const imageField = document.createElement('label'); imageField.innerHTML = `Foto do perfil<input id="avatar-input" type="file" accept="image/*">`; const themeField = document.createElement('label'); themeField.className = 'theme-toggle-field'; themeField.innerHTML = `<span>Tema da interface</span><span class="dark-mode-toggle"><input id="theme-toggle" type="checkbox" ${state.theme === 'dark' ? 'checked' : ''}><i></i><b>Dark Mode</b></span>`; const paletteField = document.createElement('details'); paletteField.className = 'palette-picker'; paletteField.innerHTML = `<summary><span>Cor de destaque</span><strong><i class="palette-current" data-current-accent="${selectedAccent}"></i>${paletteNames[selectedAccent]}</strong><small>Escolher cor</small></summary><div class="palette-options" role="group" aria-label="Escolha a cor do tema">${Object.entries(paletteNames).map(([value, label]) => `<button type="button" class="palette-swatch ${selectedAccent === value ? 'selected' : ''}" data-accent-choice="${value}" aria-label="${label}" title="${label}"><i></i><small>${label}</small></button>`).join('')}</div>`; const submit = form.querySelector('button'); form.insertBefore(themeField, submit); form.insertBefore(paletteField, submit); form.insertBefore(imageField, submit); document.querySelector('#theme-toggle').onchange = (event) => { state.theme = event.target.checked ? 'dark' : 'light'; save(); applyTheme() }; document.querySelectorAll('[data-accent-choice]').forEach((button) => button.onclick = () => { state.accent = button.dataset.accentChoice; save(); applyTheme(); paletteField.open = false; paletteField.querySelector('summary strong').innerHTML = `<i class="palette-current" data-current-accent="${state.accent}"></i>${paletteNames[state.accent]}`; document.querySelectorAll('[data-accent-choice]').forEach((item) => item.classList.toggle('selected', item === button)) }); document.querySelector('#avatar-input').onchange = (event) => { const [file] = event.target.files; if (!file) return; const reader = new FileReader(); reader.onload = () => { state.avatar = reader.result; save(); settings(); enhanceSettings() }; reader.readAsDataURL(file) } }
function enhanceSettingsLegacy() { const form = document.querySelector('#settings-form'); if (!form || document.querySelector('#avatar-input')) return; const field = document.createElement('label'); field.innerHTML = `Foto do perfil<input id="avatar-input" type="file" accept="image/*">`; const themeField = document.createElement('label'); themeField.innerHTML = `Tema da interface<select id="theme-select"><option value="light" ${state.theme !== 'dark' ? 'selected' : ''}>Claro</option><option value="dark" ${state.theme === 'dark' ? 'selected' : ''}>Escuro</option></select>`; const paletteField = document.createElement('div'); paletteField.className = 'palette-field'; paletteField.innerHTML = `<span>Cor de destaque</span><div class="palette-options" role="group" aria-label="Escolha a cor do tema">${[['purple', 'Roxo'], ['green', 'Verde'], ['blue', 'Azul'], ['red', 'Vermelho'], ['gray', 'Cinza'], ['pink', 'Rosa'], ['yellow', 'Amarelo'], ['orange', 'Laranja']].map(([value, label]) => `<button type="button" class="palette-swatch ${state.accent === value ? 'selected' : ''}" data-accent-choice="${value}" aria-label="${label}" title="${label}"><i></i><small>${label}</small></button>`).join('')}</div>`; form.insertBefore(themeField, form.querySelector('button')); form.insertBefore(paletteField, form.querySelector('button')); form.insertBefore(field, form.querySelector('button')); document.querySelector('#theme-select').onchange = (event) => { state.theme = event.target.value; save(); applyTheme() }; document.querySelectorAll('[data-accent-choice]').forEach((button) => button.onclick = () => { state.accent = button.dataset.accentChoice; save(); applyTheme(); document.querySelectorAll('[data-accent-choice]').forEach((item) => item.classList.toggle('selected', item === button)) }); document.querySelector('#avatar-input').onchange = (event) => { const [file] = event.target.files; if (!file) return; const reader = new FileReader(); reader.onload = () => { state.avatar = reader.result; save(); settings() }; reader.readAsDataURL(file) }; form.addEventListener('submit', () => setTimeout(enhanceSettings, 0)) }
document.addEventListener('click', (e) => { const button = e.target.closest('[data-delete-client],[data-delete-product],[data-delete-order],[data-delete-list]'); if (!button) return; e.preventDefault(); e.stopImmediatePropagation(); requestDelete(button) }, true)
document.addEventListener('click', (e) => { if (e.target.closest('[data-confirm-cancel]') || e.target.matches('#confirm-modal')) closeDeleteModal(); if (e.target.closest('[data-confirm-delete]')) confirmDelete() })
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pendingDelete) closeDeleteModal() })
function render() { applyTheme(); ({ overview, clients, products, orders, separation, shopping, reports, settings }[view] || overview)(); if (view === 'overview') enhanceOverview(); if (view === 'settings') enhanceSettings() }
async function bootstrap() {
  try {
    const response = await fetch(apiUrl('/api/state'))
    if (!response.ok) throw new Error('Falha ao carregar os dados')
    state = await response.json()
    render()
  } catch (error) {
    document.querySelector('#app').innerHTML = '<main class="main"><section class="content"><div class="empty"><strong>Nao foi possivel conectar ao banco de dados.</strong><p>Confirme se o PostgreSQL e a API estao em execucao.</p></div></section></main>'
    console.error(error)
  }
}
bootstrap()
