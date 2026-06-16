import { readFileSync } from 'fs';
import { join } from 'path';
import { loadCampaign } from './src/core/loader.ts';
import { initRNG } from './src/core/rng.ts';
import { generateArea } from './src/map/generator.ts';

globalThis.sessionStorage = {
  getItem: () => null,
  setItem: () => { },
  removeItem: () => { },
  clear: () => { },
  length: 0,
  key: () => null,
} as any;

globalThis.fetch = async (url: string | URL | Request) => {
  const urlStr = url.toString();
  const filePath = join('public', urlStr.replace(/^\//, ''));
  const content = readFileSync(filePath, 'utf-8');
  return {
    ok: true,
    json: async () => JSON.parse(content)
  } as any;
};

async function main() {
  initRNG(12345);
  console.log('Loading default campaign...');
  const campaign = await loadCampaign('default');
  console.log('Generating area...');
  const area = generateArea(campaign, 'dungeon_1');

  console.log('Placed Entities:', area.placedEntities);
}

main().catch(console.error);
