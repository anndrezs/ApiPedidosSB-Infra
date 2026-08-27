-- Corrige a senha do primeiro usuario usando o formato bcrypt esperado pela API.

BEGIN;

UPDATE pediflowsb.users
    SET password_hash = '$2b$12$82l.TmtWtyE2i8IOCDDSq.T51dLKDpWwA5gULDlNJ3FKzLa0MqynG',
       active = TRUE,
       updated_at = NOW()
 WHERE lower(email) = 'admin@pediflow.local';

COMMIT;

-- Login:
-- Email: admin@pediflow.local
-- Senha: mudar@123