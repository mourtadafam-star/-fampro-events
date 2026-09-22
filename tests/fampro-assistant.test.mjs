import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('the assistant endpoint is authenticated, read-only, and keeps model credentials server-side', async () => {
  const [server, browser, config] = await Promise.all([
    read('supabase/functions/fampro-assistant/index.ts'),
    read('admin-workflows.js'),
    read('supabase/config.toml'),
  ]);

  assert.match(config, /\[functions\.fampro-assistant\][\s\S]*verify_jwt = true/);
  assert.match(server, /supabase\.auth\.getUser\(token\)/);
  assert.match(server, /Accès administrateur requis/);
  assert.match(server, /Deno\.env\.get\("OPENAI_API_KEY"\)/);
  assert.match(server, /fetch\("https:\/\/api\.openai\.com\/v1\/responses"/);
  assert.match(server, /store: false/);
  assert.match(server, /rateLimited\(user\.id\)/);
  assert.doesNotMatch(server, /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEYS/);
  assert.doesNotMatch(server, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/);
  assert.doesNotMatch(browser, /OPENAI_API_KEY|api\.openai\.com/);
});

test('the administrator UI labels the assistant as read-only and invokes only the Edge Function', async () => {
  const browser = await read('admin-workflows.js');
  assert.match(browser, /Assistant IA FAMpro/);
  assert.match(browser, /Lecture seule/);
  assert.match(browser, /validation humaine|confirmée par une personne/);
  assert.match(browser, /supabaseClient\.functions\.invoke\('fampro-assistant'/);
  assert.doesNotMatch(browser, /localStorage\.setItem\([^\n]*assistant/i);
  assert.match(browser, /Impossible de joindre l’Assistant IA pour le moment/);
});
