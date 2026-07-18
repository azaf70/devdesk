import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { Client, ConnectConfig } from "ssh2";

export type SshConfig = {
  host: string;
  port: number;
  username: string;
  privateKey: Buffer | string;
  passphrase?: string;
};

function resolveKeyPath(raw: string): string {
  if (raw.startsWith("/")) return raw;
  return resolve(process.cwd(), raw);
}

export function getSshConfig(): SshConfig {
  const host = process.env.SSH_HOST;
  const username = process.env.SSH_USER ?? "root";
  const port = Number(process.env.SSH_PORT ?? "22");
  const keyPathRaw =
    process.env.SSH_PRIVATE_KEY_PATH ?? "../azaf-codes.pem";
  const passphrase = process.env.SSH_PRIVATE_KEY_PASSPHRASE || undefined;

  if (!host) {
    throw new Error("SSH_HOST must be set in .env (see .env.example)");
  }

  const keyPath = resolveKeyPath(keyPathRaw);
  if (!existsSync(keyPath)) {
    throw new Error(
      `SSH private key not found at ${keyPath}. Set SSH_PRIVATE_KEY_PATH in .env`,
    );
  }

  const privateKey = readFileSync(keyPath);

  return { host, port, username, privateKey, passphrase };
}

export function connectConfig(cfg: SshConfig): ConnectConfig {
  return {
    host: cfg.host,
    port: cfg.port,
    username: cfg.username,
    privateKey: cfg.privateKey,
    passphrase: cfg.passphrase,
    readyTimeout: 20_000,
  };
}

export function withSsh<T>(
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const cfg = getSshConfig();
  const client = new Client();

  return new Promise<T>((resolve, reject) => {
    const fail = (err: Error) => {
      try {
        client.end();
      } catch {
        /* ignore */
      }
      reject(err);
    };

    client
      .on("ready", () => {
        fn(client)
          .then((result) => {
            client.end();
            resolve(result);
          })
          .catch(fail);
      })
      .on("error", fail)
      .connect(connectConfig(cfg));
  });
}

export function execCommand(
  client: Client,
  command: string,
  timeoutMs = 30_000,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    client.exec(command, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        reject(err);
        return;
      }

      let stdout = "";
      let stderr = "";

      stream
        .on("close", (code: number | null) => {
          clearTimeout(timer);
          resolve({ stdout, stderr, code });
        })
        .on("data", (data: Buffer) => {
          stdout += data.toString("utf8");
        });

      stream.stderr.on("data", (data: Buffer) => {
        stderr += data.toString("utf8");
      });
    });
  });
}

export async function sshExec(
  command: string,
  timeoutMs = 30_000,
): Promise<{
  stdout: string;
  stderr: string;
  code: number | null;
}> {
  return withSsh((client) => execCommand(client, command, timeoutMs));
}
