import 'dotenv/config';
import pg from 'pg';
import { prisma } from './db.js';
import { createApp, createPostgresSessionStore } from './app.js';

const port = Number(process.env.PORT) || 5000;
const sessionPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const sessionStore = createPostgresSessionStore(sessionPool);
const app = createApp({ prisma, sessionStore });

const server = app.listen(port, () => {
  console.log(`Blood Bank API listening on http://localhost:${port}`);
});

function shutdown() {
  server.close(async () => {
    await sessionPool.end();
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
