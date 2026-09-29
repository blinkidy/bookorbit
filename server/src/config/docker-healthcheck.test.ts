import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dockerfile = readFileSync(resolve(__dirname, '../../../Dockerfile'), 'utf8');
const healthcheckJson = dockerfile.match(/HEALTHCHECK[^\n]*\\\r?\n\s*CMD (\[[^\r\n]+\])/)?.[1];
const healthcheck = healthcheckJson ? (JSON.parse(healthcheckJson) as string[]) : undefined;

describe('Docker healthcheck bind address', () => {
  it.each([
    { host: undefined, port: undefined, expected: '127.0.0.1:3000' },
    { host: '', port: '', expected: '127.0.0.1:3000' },
    { host: '   ', port: '31015', expected: '127.0.0.1:31015' },
    { host: '0.0.0.0', port: '31015', expected: '127.0.0.1:31015' },
    { host: '127.0.0.1', port: '31015', expected: '127.0.0.1:31015' },
    { host: ' 192.0.2.10 ', port: '31015', expected: '192.0.2.10:31015' },
    { host: '::', port: '31015', expected: '[::1]:31015' },
    { host: '::1', port: '31015', expected: '[::1]:31015' },
    { host: '2001:db8::1', port: '31015', expected: '[2001:db8::1]:31015' },
  ])('probes $expected with HOST=$host and PORT=$port', ({ host, port, expected }) => {
    expect(healthcheck).toBeDefined();
    expect(healthcheck?.slice(0, 2)).toEqual(['node', '-e']);
    const env = { ...process.env };
    delete env.HOST;
    delete env.PORT;
    if (host !== undefined) env.HOST = host;
    if (port !== undefined) env.PORT = port;

    const output = execFileSync(process.execPath, ['-e', `global.fetch=async url=>{console.log(url);return {ok:true}};${healthcheck?.[2]}`], {
      env,
      encoding: 'utf8',
    }).trim();

    expect(output).toBe(`http://${expected}/api/v1/health`);
  });

  it('propagates a failed HTTP probe to Docker', () => {
    expect(healthcheck).toBeDefined();
    expect(() => execFileSync(process.execPath, ['-e', `global.fetch=async()=>({ok:false});${healthcheck?.[2]}`])).toThrow();
  });
});
