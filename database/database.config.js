// Configuracao do PostgreSQL usada pela API local.

/*const databaseConfig = {
  connectionString: process.env.DATABASE_URL || undefined,
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'pediflow',
  user: process.env.PGUSER || 'pediflow',
  password: process.env.PGPASSWORD || '',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : process.env.PGSSL === 'true',
  maxConnections: Number(process.env.PGPOOL_MAX || 10),
}*/

// Configuração do PostgreSQL usada pela API (Render + Supabase)

const databaseConfig = {
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Supabase exige SSL
  host: 'db.foabxggxqgllkzqadily.supabase.co', // substitua pelo host exato do Supabase
  port: 5432,
  max: 10 // número máximo de conexões no pool
}

//export default databaseConfig

export default databaseConfig
