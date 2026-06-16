import { runHeadlessSmokeTest, validateCampaign } from './src/editor/campaign_validator.ts';
import { loadCampaign } from './src/core/loader.ts';
import { readFileSync } from 'fs';
import { join } from 'path';

globalThis.sessionStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  length: 0,
  key: () => null,
} as any;

globalThis.fetch = async (url: string | URL | Request) => {
  const urlStr = url.toString();
  const filePath = join('public', urlStr.replace(/^\//, ''));
  try {
    const content = readFileSync(filePath, 'utf-8');
    return {
      ok: true,
      json: async () => JSON.parse(content)
    } as any;
  } catch (err) {
    console.error('Mock fetch failed for', filePath, err);
    throw err;
  }
};

async function main() {
  console.log('Loading default campaign...');
  const campaign = await loadCampaign('default');
  console.log('Running validation...');
  const report = await validateCampaign(campaign);
  
  if (report.errors.length > 0) {
    console.log(`Found ${report.errors.length} errors:`);
    report.errors.forEach((err, i) => {
      console.log(`[Error ${i + 1}] ${err.type} @ ${err.path || 'unknown'}: ${err.message}`);
    });
  } else {
    console.log('No errors found!');
  }

  if (report.warnings.length > 0) {
    console.log(`Found ${report.warnings.length} warnings:`);
    report.warnings.forEach((warn, i) => {
      console.log(`[Warning ${i + 1}] ${warn.type} @ ${warn.path || 'unknown'}: ${warn.message}`);
    });
  }
}

main().catch(console.error);
