import { spawn } from 'node:child_process';
import { once } from 'node:events';
import os from 'node:os';

import { startWebSession } from './session.js';

export async function runWebCommand(openBrowser: boolean): Promise<number> {
  const { server, url, pendingUpdate } = await startWebSession({ project: process.cwd(), user: os.homedir() });
  const closed = once(server, 'close');
  const stop = () => server.close();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    console.log(`Kitia web: ${url}`);
    console.log('Keep this session URL private. Press Ctrl+C to stop.');
    if (openBrowser) {
      const [program, args] =
        process.platform === 'win32'
          ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
          : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
      const child = spawn(program, args, { stdio: 'ignore', windowsHide: true });
      const manual = () => console.error('Could not open the browser automatically. Open the session URL above.');
      child.once('error', manual);
      child.once('exit', (code) => {
        if (code !== 0) manual();
      });
      child.unref();
    }
    await closed;
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
  const apply = pendingUpdate();
  if (apply) {
    console.log('Kitia web is closed. Updating Kitia; run kitia web again after the update.');
    await apply();
  }
  return 0;
}
