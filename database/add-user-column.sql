-- Adiciona o nome de usuario usado no login.
-- Execute uma vez antes de usar o novo login.

ALTER TABLE pediflowsb.users
ADD COLUMN IF NOT EXISTS "user" VARCHAR(80);

UPDATE pediflowsb.users
   SET "user" = lower(split_part(email, '@', 1))
 WHERE "user" IS NULL OR trim("user") = '';

ALTER TABLE pediflowsb.users
ALTER COLUMN "user" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_user_unique
ON pediflowsb.users (lower("user"));