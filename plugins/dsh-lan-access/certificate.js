import acme from 'acme-client';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { X509Certificate } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

export async function ensureCertificate(config) {
  const certificatePath = join(config.directory, 'server.json');
  if (existsSync(certificatePath)) {
    const saved = JSON.parse(await readFile(certificatePath, 'utf8'));
    const certificate = new X509Certificate(saved.cert);
    if (certificate.checkHost(config.domain) && Date.parse(certificate.validTo) - Date.now() > 30 * 86400000) return saved;
  }
  await mkdir(config.directory, { recursive: true, mode: 0o700 });
  const token = (await readFile(config.tokenFile, 'utf8')).trim();
  async function dns(path, method = 'GET', body) {
    const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${config.zoneId}/dns_records${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000),
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(`DNS 配置失败：${JSON.stringify(result.errors)}`);
    return result.result;
  }
  const existing = await dns(`?name=${encodeURIComponent(config.domain)}`);
  if (!existing.length) await dns('', 'POST', { type: 'A', name: config.domain, content: config.address, ttl: 120, proxied: false });
  else if (existing.length !== 1 || existing[0].type !== 'A' || existing[0].content !== config.address || existing[0].proxied) {
    throw new Error('HTTPS 域名已有不同的 DNS 配置');
  }
  const accountPath = join(config.directory, 'account.pem');
  const accountKey = existsSync(accountPath) ? await readFile(accountPath) : await acme.crypto.createPrivateKey();
  if (!existsSync(accountPath)) await writeFile(accountPath, accountKey, { mode: 0o600 });
  const client = new acme.Client({ directoryUrl: acme.directory.letsencrypt.production, accountKey });
  const [key, csr] = await acme.crypto.createCsr({ altNames: [config.domain] });
  const records = new Map();
  const cert = await client.auto({
    csr, termsOfServiceAgreed: true, challengePriority: ['dns-01'],
    challengeCreateFn: async (authorization, challenge, content) => {
      if (challenge.type !== 'dns-01') throw new Error('证书验证方式无效');
      const name = `_acme-challenge.${authorization.identifier.value}`;
      const record = await dns('', 'POST', { type: 'TXT', name, content, ttl: 120 });
      records.set(challenge.url, record.id);
      await setTimeout(15000);
    },
    challengeRemoveFn: async (_authorization, challenge) => {
      const id = records.get(challenge.url);
      if (id) await dns(`/${id}`, 'DELETE');
    },
  });
  const saved = { key: key.toString(), cert };
  await writeFile(`${certificatePath}.new`, JSON.stringify(saved), { mode: 0o600 });
  await rename(`${certificatePath}.new`, certificatePath);
  return saved;
}
