# Deploy

## Banco Railway

1. Crie um PostgreSQL no Railway.
2. Execute `../database/schema.sql` no banco criado.
3. Copie a variavel `DATABASE_URL` do Railway.

## Backend Render

1. Crie um Web Service apontando para este repositorio e defina `backend` como Root Directory.
2. Use `npm ci` como build command e `npm start` como start command.
3. Configure `DATABASE_URL` com a URL do Railway.
4. Configure `FRONTEND_URL` com a URL final do Vercel.
5. O health check fica em `/api/health`.

## Frontend Vercel

1. Crie um projeto Vercel apontando para este repositorio e defina `frontend` como Root Directory.
2. Configure `VITE_API_URL` com a URL do backend Render, por exemplo `https://pediflow-api.onrender.com`.
3. Use `npm run build` e publique a pasta `dist`.

Em desenvolvimento, use `VITE_API_URL=http://localhost:3000`. O frontend faz chamadas HTTP diretamente ao backend.

## Execucao local

Em terminais separados, com o PostgreSQL ativo:

```bash
cd backend && npm start
cd frontend && npm run dev
```

## API REST

Os recursos possuem aliases com e sem o prefixo `/api`:

- `GET|POST|PUT|DELETE /clientes`
- `GET|POST|PUT|DELETE /produtos`
- `GET|POST|PUT|DELETE /pedidos`
- `GET /separacao?data=YYYY-MM-DD`
- `PATCH /pedidos/:id/status` com `pending`, `ready` ou `delivered`
- `GET|POST|DELETE /compras`
- `GET /relatorios?tipo=diario|semanal|mensal&periodo=YYYY-MM-DD`

O endpoint `/api/state` continua disponível para compatibilidade com a interface atual durante a migração.