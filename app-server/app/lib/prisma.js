import { PrismaClient } from '@prisma/client';
import { config } from '@/app/lib/config/index.mjs';

const globalForPrisma = globalThis;

// We MUST pass an object {} inside PrismaClient() for Prisma 7 to work with Next.js
export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error']});

if (!config.env.isProduction) {
  globalForPrisma.prisma = prisma;
}