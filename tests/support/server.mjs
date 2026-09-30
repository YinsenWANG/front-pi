import { createServer, preview } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

export async function startServers() {
  let dev;
  let production;
  try {
    dev = await createServer({
      root,
      resolve: { alias: { '@webcontainer/api': fileURLToPath(new URL('../fixtures/webcontainer.mjs', import.meta.url)) } },
      server: { host: '127.0.0.1', port: 0, strictPort: true, open: false },
    });
    await dev.listen();
    production = await preview({ root, preview: { host: '127.0.0.1', port: 0, strictPort: true, open: false } });
    return {
      devUrl: `http://127.0.0.1:${dev.httpServer.address().port}`,
      previewUrl: `http://127.0.0.1:${production.httpServer.address().port}`,
      close: async () => { await Promise.all([dev.close(), production.close()]); },
    };
  } catch (error) {
    await Promise.all([dev?.close(), production?.close()]);
    throw error;
  }
}
