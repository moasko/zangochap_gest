import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prismaClientSingleton = () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not defined in environment variables");
  }
  const pool = new Pool({
    connectionString,
    max: 10, // Neon free-tier supports ~20 connections; keep headroom
    idleTimeoutMillis: 60000,
    connectionTimeoutMillis: 60000,
    statement_timeout: 60000, // Prevent hanging queries
    ssl: connectionString.includes('neon.tech')
      ? {
        rejectUnauthorized: false,
      }
      : undefined
  });

  pool.on('error', (err) => {
    console.error('❌ Prisma Pool Error:', err.message);
  });

  const adapter = new PrismaPg(pool);

  return new PrismaClient({ adapter });
};

declare global {
  var prisma: undefined | ReturnType<typeof prismaClientSingleton>;
}

const prisma = globalThis.prisma ?? prismaClientSingleton();

export default prisma;

if (process.env.NODE_ENV !== "production") globalThis.prisma = prisma;
