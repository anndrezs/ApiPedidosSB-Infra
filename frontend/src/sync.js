/**
 * Módulo de sincronização em tempo real (quase)
 * 
 * Implementa:
 * 1. BroadcastChannel: Sincroniza entre abas do mesmo dispositivo instantaneamente
 * 2. Polling com Hash: Verifica mudanças a cada 5 segundos para diferentes dispositivos
 * 
 * Resolve problema: Dados criados em um dispositivo (PC) aparecem no outro (Mobile) sem refresh manual
 */

let syncEnabled = false
let lastKnownHash = null
let pollInterval = null
const broadcastChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('pediflow-state-sync') : null

/**
 * Inicializa o sistema de sincronização
 * @param {string} apiBaseUrl - URL base da API (ex: http://localhost:3000)
 * @param {string} authToken - Token JWT para autenticação
 * @param {Function} onStateChanged - Callback quando o estado mudou
 * @param {Function} getHash - Função que retorna hash do estado atual
 */
export function initSync(apiBaseUrl, authToken, onStateChanged, getHash) {
  if (syncEnabled) return
  syncEnabled = true

  // 1. Configurar BroadcastChannel para sincronização entre abas
  if (broadcastChannel) {
    broadcastChannel.onmessage = (event) => {
      const { type, data } = event.data
      
      if (type === 'state-changed') {
        // Outra aba/janela mudou o estado
        console.log('[Sync] Estado sincronizado entre abas')
        onStateChanged()
      } else if (type === 'hash-update') {
        // Atualizar o hash conhecido (evita requisições desnecessárias)
        lastKnownHash = data.hash
      }
    }
  }

  // 2. Configurar polling para sincronização entre dispositivos
  startPolling(apiBaseUrl, authToken, onStateChanged, getHash)
}

/**
 * Para o sistema de sincronização
 */
export function stopSync() {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
  if (broadcastChannel) {
    broadcastChannel.close()
  }
  syncEnabled = false
}

/**
 * Notifica outras abas que o estado mudou
 * Chamado pelo frontend após salvar dados
 */
export function notifyStateChange() {
  if (!broadcastChannel) return
  
  broadcastChannel.postMessage({
    type: 'state-changed',
    timestamp: Date.now(),
  })
}

/**
 * Atualiza o hash conhecido no BroadcastChannel
 */
export function broadcastHashUpdate(newHash) {
  if (!broadcastChannel) return
  
  broadcastChannel.postMessage({
    type: 'hash-update',
    data: { hash: newHash },
    timestamp: Date.now(),
  })
}

/**
 * Inicia o polling inteligente para verificar mudanças
 */
function startPolling(apiBaseUrl, authToken, onStateChanged, getHash) {
  // Verificar mudanças a cada 5 segundos
  const pollInterval = setInterval(async () => {
    try {
      // Fazer fetch do hash do estado remoto
      const response = await fetch(`${apiBaseUrl}/api/state/hash`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${authToken}` },
      })

      if (response.status === 401) {
        // Token expirou, parar sincronização
        stopSync()
        return
      }

      if (!response.ok) {
        console.warn('[Sync] Erro ao verificar hash:', response.status)
        return
      }

      const { hash: remoteHash } = await response.json()
      const currentHash = getHash()

      // Se o hash mudou, o estado foi alterado remotamente
      if (remoteHash !== currentHash && lastKnownHash !== remoteHash) {
        console.log('[Sync] Mudanças detectadas, sincronizando do servidor...')
        lastKnownHash = remoteHash
        onStateChanged()
      }

      // Atualizar o hash conhecido
      lastKnownHash = remoteHash
    } catch (error) {
      console.error('[Sync] Erro no polling:', error.message)
      // Continuar tentando mesmo com erro
    }
  }, 5000)

  return pollInterval
}

/**
 * Calcula o hash MD5 de um objeto (compatível com backend)
 * 
 * NOTA: Em produção, é melhor usar o hash do servidor via /api/state/hash
 * Esta função é principalmente para referência
 */
export function calculateStateHash(state) {
  // Em um navegador moderno, usamos SubtleCrypto
  // Mas para MD5, precisamos usar uma biblioteca ou confiar no servidor
  // Por enquanto, retornamos undefined e deixamos o servidor calcular
  
  // Uma alternativa simples (não-criptográfica) para teste:
  const json = JSON.stringify(state)
  let hash = 0
  for (let i = 0; i < json.length; i++) {
    const char = json.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Converter para 32-bit integer
  }
  return Math.abs(hash).toString(16)
}

/**
 * Obtém o hash via API (recomendado)
 */
export async function getRemoteStateHash(apiBaseUrl, authToken) {
  try {
    const response = await fetch(`${apiBaseUrl}/api/state/hash`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${authToken}` },
    })
    
    if (!response.ok) return null
    
    const { hash } = await response.json()
    return hash
  } catch (error) {
    console.error('[Sync] Erro ao obter hash remoto:', error.message)
    return null
  }
}

export default {
  initSync,
  stopSync,
  notifyStateChange,
  broadcastHashUpdate,
  getRemoteStateHash,
  calculateStateHash,
}
