import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

const secret = process.env.JWT_SECRET
const expiresIn = process.env.JWT_EXPIRES_IN || '1d'

if (!secret) throw new Error('JWT_SECRET nao configurado.')

export function createToken(user) {
  return jwt.sign({ userId: user.id, companyId: user.company_id, role: user.role }, secret, { expiresIn })
}

export function authenticateToken(request, response, next) {
  const authorization = request.headers.authorization || ''
  const [scheme, token] = authorization.split(' ')
  if (scheme !== 'Bearer' || !token) return response.status(401).json({ error: 'Autenticacao necessaria.' })
  try {
    request.user = jwt.verify(token, secret)
    next()
  } catch {
    response.status(401).json({ error: 'Token invalido ou expirado.' })
  }
}

export const comparePassword = (password, hash) => bcrypt.compare(password, hash)
export const hashPassword = (password) => bcrypt.hash(password, 12)