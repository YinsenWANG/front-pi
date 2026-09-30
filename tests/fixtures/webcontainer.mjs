// Test double only: memory filesystem and two canned echo commands, no Node runtime.
// Routed by the browser harness; never imported by production source or builds.
export const WebContainer = {
  async boot(options) {
    if (options.coep !== 'credentialless') throw new Error('Unexpected COEP option');
    window.__fixtureBoots = (window.__fixtureBoots || 0) + 1;
    const files = new Map();
    const directories = new Set(['/']);
    const normalize = (path) => path.replace(/\/$/, '') || '/';
    const fs = {
      async mkdir(path) {
        const parts = normalize(path).split('/').filter(Boolean);
        for (let i = 1; i <= parts.length; i++) directories.add(`/${parts.slice(0, i).join('/')}`);
      },
      async writeFile(path, content) {
        files.set(normalize(path), typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(content));
      },
      async readFile(path, encoding) {
        const bytes = files.get(normalize(path));
        if (!bytes) throw new Error(`ENOENT: ${path}`);
        return encoding === 'utf8' ? new TextDecoder().decode(bytes) : new Uint8Array(bytes);
      },
      async readdir(path) {
        const prefix = `${normalize(path)}/`;
        return [...directories, ...files.keys()].filter((entry) => entry.startsWith(prefix) && !entry.slice(prefix.length).includes('/'))
          .map((entry) => ({ name: entry.slice(prefix.length), isDirectory: () => directories.has(entry), isFile: () => files.has(entry) }));
      },
    };
    return {
      fs,
      async spawn(command, args, options) {
        if (command !== 'jsh' || args[0] !== '-c' || options.cwd !== '/workspace') throw new Error('Unexpected fixture spawn');
        let output = '';
        if (args[1] === 'echo browser-ok') output = 'browser-ok\n';
        else if (args[1] === 'echo persisted > note.txt') await fs.writeFile('/workspace/note.txt', 'persisted\n');
        else throw new Error(`Unsupported fixture command: ${args[1]}`);
        return { output: new ReadableStream({ start(controller) { if (output) controller.enqueue(output); controller.close(); } }), exit: Promise.resolve(0), kill() {} };
      },
    };
  },
};
