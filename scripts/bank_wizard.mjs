#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(scriptDir, '..');
const rootDir = process.env.AUTO_PREVIEW_ROOT || defaultRoot;
const dataDir = path.join(rootDir, 'data');
const captionsPath = path.join(dataDir, 'captions.json');
const hashtagsPath = path.join(dataDir, 'hashtags.json');

const yesPattern = /^(y|yes|ya|iya|1)$/i;

function isYes(value) {
  return yesPattern.test(String(value).trim());
}

function normalizeCaptions(raw) {
  if (!Array.isArray(raw)) return [];

  let fallbackId = 1;
  const normalized = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      const text = entry.trim();
      if (!text) continue;
      normalized.push({ id: fallbackId, text, used: false, used_at: null });
      fallbackId += 1;
      continue;
    }

    if (!entry || typeof entry !== 'object') continue;
    const textCandidate =
      typeof entry.text === 'string'
        ? entry.text
        : typeof entry.caption === 'string'
          ? entry.caption
          : '';
    const text = textCandidate.trim();
    if (!text) continue;

    const parsedId = Number(entry.id);
    const id = Number.isInteger(parsedId) && parsedId > 0 ? parsedId : fallbackId;

    normalized.push({
      id,
      text,
      used: Boolean(entry.used),
      used_at: entry.used_at ?? null,
    });

    fallbackId = Math.max(fallbackId, id + 1);
  }

  return normalized
    .sort((a, b) => a.id - b.id)
    .map((entry, index) => ({ ...entry, id: index + 1 }));
}

function normalizeHashtag(rawTag) {
  const trimmed = String(rawTag ?? '').trim();
  if (!trimmed) return '';
  const compact = trimmed.replace(/\s+/g, '');
  if (!compact) return '';
  return compact.startsWith('#') ? compact : `#${compact}`;
}

function normalizeHashtags(raw) {
  if (!Array.isArray(raw)) return [];

  const seen = new Set();
  const result = [];
  for (const entry of raw) {
    const candidate =
      typeof entry === 'string'
        ? entry
        : entry && typeof entry === 'object'
          ? entry.tag ?? entry.hashtag ?? entry.text ?? ''
          : '';
    const normalized = normalizeHashtag(candidate);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

async function readJson(filePath, fallbackValue) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') return fallbackValue;
    throw error;
  }
}

async function writeJson(filePath, value) {
  const content = JSON.stringify(value, null, 2);
  await fs.writeFile(filePath, `${content}\n`, 'utf8');
}

async function askChoice(rl, prompt, validChoices) {
  while (true) {
    const answer = (await rl.question(prompt)).trim();
    if (validChoices.includes(answer)) return answer;
    console.log(`Input ga valid. Pilih salah satu: ${validChoices.join(', ')}`);
  }
}

async function handleCaptions(rl) {
  const existingRaw = await readJson(captionsPath, []);
  let captions = normalizeCaptions(existingRaw);

  console.log('\n=== Wizard Caption ===');
  console.log(`Caption sekarang: ${captions.length}`);

  const replaceAll = isYes(
    await rl.question('Mau ganti total caption lama? (y/N): '),
  );
  if (replaceAll) {
    captions = [];
  } else if (captions.length > 0) {
    const resetUsage = isYes(
      await rl.question('Mau reset status used caption lama jadi fresh lagi? (y/N): '),
    );
    if (resetUsage) {
      captions = captions.map((entry) => ({ ...entry, used: false, used_at: null }));
    }
  }

  console.log('Masukin caption satu-satu. Enter kosong buat selesai.');

  let nextId = captions.reduce((max, entry) => Math.max(max, entry.id), 0) + 1;
  while (true) {
    const inputText = await rl.question(`Caption #${nextId}: `);
    const text = inputText.trim();
    if (!text) break;

    captions.push({
      id: nextId,
      text,
      used: false,
      used_at: null,
    });
    nextId += 1;
  }

  captions = captions
    .sort((a, b) => a.id - b.id)
    .map((entry, index) => ({ ...entry, id: index + 1 }));

  if (captions.length === 0) {
    console.log('Caption bank kosong, file ga jadi diubah.');
    return false;
  }

  await writeJson(captionsPath, captions);
  console.log(`Beres. Total caption aktif: ${captions.length}`);
  return true;
}

async function handleHashtags(rl) {
  const existingRaw = await readJson(hashtagsPath, []);
  let hashtags = normalizeHashtags(existingRaw);

  console.log('\n=== Wizard Hashtag ===');
  console.log(`Hashtag sekarang: ${hashtags.length}`);

  const replaceAll = isYes(
    await rl.question('Mau ganti total hashtag lama? (y/N): '),
  );
  if (replaceAll) {
    hashtags = [];
  }

  console.log('Masukin hashtag satu-satu. Boleh pake # atau engga. Enter kosong buat selesai.');

  const seen = new Set(hashtags.map((tag) => tag.toLowerCase()));
  while (true) {
    const inputTag = await rl.question(`Hashtag #${hashtags.length + 1}: `);
    const normalized = normalizeHashtag(inputTag);
    if (!normalized) break;

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      console.log(`Lewat, ${normalized} udah ada.`);
      continue;
    }

    seen.add(key);
    hashtags.push(normalized);
  }

  if (hashtags.length === 0) {
    console.log('Hashtag bank kosong, file ga jadi diubah.');
    return false;
  }

  await writeJson(hashtagsPath, hashtags);
  console.log(`Beres. Total hashtag aktif: ${hashtags.length}`);
  return true;
}

async function run() {
  await fs.mkdir(dataDir, { recursive: true });

  const rl = readline.createInterface({ input, output });
  try {
    console.log('=== Wizard Bank n8n-auto-preview ===');
    console.log(`Root: ${rootDir}`);
    console.log(`Data: ${dataDir}`);
    console.log('\nPilih mode:');
    console.log('1) Isi/tambah caption');
    console.log('2) Isi/tambah hashtag');
    console.log('3) Isi dua-duanya');
    console.log('4) Keluar');

    const mode = await askChoice(rl, 'Pilih [1-4]: ', ['1', '2', '3', '4']);
    if (mode === '4') {
      console.log('Sip, wizard ditutup.');
      return;
    }

    let changed = false;

    if (mode === '1' || mode === '3') {
      changed = (await handleCaptions(rl)) || changed;
    }

    if (mode === '2' || mode === '3') {
      changed = (await handleHashtags(rl)) || changed;
    }

    if (changed) {
      console.log('\nSemua update beres.');
      console.log('Ga perlu restart n8n. Run berikutnya otomatis kebaca.');
      console.log('Kalo mau test langsung: node scripts/run_job.mjs');
    } else {
      console.log('\nGa ada perubahan yang disimpan.');
    }
  } finally {
    rl.close();
  }
}

run().catch((error) => {
  console.error('Wizard error:', error.message);
  process.exitCode = 1;
});
