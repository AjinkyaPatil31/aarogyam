import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis;

// We MUST pass an object {} inside PrismaClient() for Prisma 7 to work with Next.js
export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error']});

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}