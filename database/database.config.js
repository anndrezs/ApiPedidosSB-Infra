// Configuracao do PostgreSQL usada pela API local.

/*const databaseConfig = {
  connectionString: process.env.DATABASE_URL || undefined,
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'postgres',
  user: process.env.PGUSER || 'pediflow',
  password: process.env.PGPASSWORD || '',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : process.env.PGSSL === 'true',
  maxConnections: Number(process.env.PGPOOL_MAX || 10),
}*/

// Configuração do PostgreSQL usada pela API (Render + Supabase)

export default {
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10
};

//export default databaseConfig
