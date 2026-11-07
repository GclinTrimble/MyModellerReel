// Sign-in is required (#115), and a build without the suite's Supabase project has no sign-in at all: refuse to
// package a release without it. The values are public (URL and anon key), see MyVoiceReel's docs/SUITE_ACCOUNT.md.
// They go into src/main/suite.json (not in git), which the packaged app reads.
import fs from 'node:fs';

const missing = ['MYSTUDIOREEL_SUPABASE_URL', 'MYSTUDIOREEL_SUPABASE_ANON_KEY'].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Set ${missing.join(' and ')} before building a release: without them the app has no sign-in.`);
  process.exit(1);
}
if (!process.env.MYSTUDIOREEL_SUPABASE_URL.startsWith('https://')) {
  console.error('MYSTUDIOREEL_SUPABASE_URL must be an https:// address.');
  process.exit(1);
}
const suite = { url: process.env.MYSTUDIOREEL_SUPABASE_URL, anonKey: process.env.MYSTUDIOREEL_SUPABASE_ANON_KEY };
fs.writeFileSync(new URL('../src/main/suite.json', import.meta.url), JSON.stringify(suite));
