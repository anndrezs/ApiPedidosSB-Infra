-- Pediflow - criacao do primeiro usuario administrador
-- Edite estes tres valores antes de executar o script.

INSERT INTO pediflowsb.companies (name)
SELECT 'Empresa'
WHERE NOT EXISTS (SELECT 1 FROM pediflowsb.companies);

UPDATE pediflowsb.companies
   SET name = 'Empresa'
 WHERE name = 'Atelie da Nanda';

INSERT INTO pediflowsb.users (company_id, name, "user", email, password_hash, role, active)
SELECT id,
       'Administrador',
      'admin',
       'admin@pediflow.local',
       '$2b$12$82l.TmtWtyE2i8IOCDDSq.T51dLKDpWwA5gULDlNJ3FKzLa0MqynG',
      'owner',
       TRUE
  FROM pediflowsb.companies
 ORDER BY created_at
 LIMIT 1
ON CONFLICT (email) DO UPDATE
  SET company_id = EXCLUDED.company_id,
      name = EXCLUDED.name,
        "user" = EXCLUDED."user",
      password_hash = EXCLUDED.password_hash,
      role = EXCLUDED.role,
      active = TRUE,
      updated_at = NOW();

-- Login inicial definido no script:
-- Email: admin@pediflow.local
-- Usuario: admin
-- Senha: mudar@123
-- Altere os valores acima antes de executar em producao.
