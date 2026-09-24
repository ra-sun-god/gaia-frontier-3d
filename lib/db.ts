import { PrismaClient } from '@prisma/client';

// Prisma singleton — Next.js hot-reloads modules in dev, which would otherwise
// spawn a new PrismaClient (and a new SQLite connection pool) on every reload.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}
