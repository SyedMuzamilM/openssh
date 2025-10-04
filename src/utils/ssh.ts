import crypto from 'crypto';
import { promises as fs } from 'fs';
import { spawn } from 'child_process';

export async function calculateFingerprint(publicKeyPath: string): Promise<string | undefined> {
  try {
    const fingerprint = await runSshKeygenFingerprint(publicKeyPath);
    if (fingerprint) {
      return fingerprint;
    }
  } catch {
    // ignore, fall back to manual calculation
  }

  try {
    const contents = await fs.readFile(publicKeyPath, 'utf-8');
    const keyParts = contents.trim().split(' ');
    const base64 = keyParts[1];
    if (!base64) {
      return undefined;
    }
    const decoded = Buffer.from(base64, 'base64');
    const hash = crypto.createHash('md5').update(decoded).digest('hex');
    return hash.match(/.{1,2}/g)?.join(':');
  } catch {
    return undefined;
  }
}

async function runSshKeygenFingerprint(publicKeyPath: string): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const child = spawn('ssh-keygen', ['-lf', publicKeyPath]);
    let output = '';
    let errorOutput = '';

    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    child.on('error', reject);

    child.on('close', (code) => {
      if (code === 0 && output) {
        const fingerprint = output.split(' ')[1];
        resolve(fingerprint);
      } else if (errorOutput) {
        reject(new Error(errorOutput));
      } else {
        resolve(undefined);
      }
    });
  });
}
