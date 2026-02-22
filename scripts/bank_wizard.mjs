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

async function askIndex(rl, prompt, max) {
  while (true) {
    const answer = (await rl.question(prompt)).trim();
    if (!answer) return null;

    const value = Number(answer);
    if (Number.isInteger(value) && value >= 1 && value <= max) {
      return value - 1;
    }

    console.log(`Nomor ga valid. Masukin angka 1-${max} atau Enter kosong buat batal.`);
  }
}

function truncateText(text, max = 100) {
  const raw = String(text ?? '').trim();
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max - 3)}...`;
}

function reindexCaptions(captions) {
  return captions.map((entry, index) => ({ ...entry, id: index + 1 }));
}

async function manageCaptions(rl, currentCaptions) {
  let captions = reindexCaptions([...currentCaptions]);

  while (captions.length > 0) {
    console.log('\nCaption yang ada sekarang:');
    captions.forEach((entry, index) => {
      const usage = entry.used ? 'used' : 'fresh';
      console.log(`${index + 1}. ${truncateText(entry.text)} [${usage}]`);
    });

    console.log('\nMenu caption:');
    console.log('1) Edit caption by nomor');
    console.log('2) Hapus caption by nomor');
    console.log('3) Lanjut');
    const action = await askChoice(rl, 'Pilih [1-3]: ', ['1', '2', '3']);
    if (action === '3') break;

    const index = await askIndex(
      rl,
      `Nomor caption (1-${captions.length}, Enter kosong buat batal): `,
      captions.length,
    );
    if (index === null) continue;

    if (action === '1') {
      const current = captions[index];
      const replacement = (await rl.question(`Caption baru untuk #${index + 1} (Enter kosong batal): `)).trim();
      if (!replacement) {
        console.log('Edit dibatalin.');
        continue;
      }
      captions[index] = { ...current, text: replacement };
      console.log(`Caption #${index + 1} diupdate.`);
      continue;
    }

    const removed = captions.splice(index, 1)[0];
    captions = reindexCaptions(captions);
    console.log(`Caption #${index + 1} dihapus: "${truncateText(removed.text, 60)}"`);
  }

  return captions;
}

async function manageHashtags(rl, currentHashtags) {
  const hashtags = [...currentHashtags];

  while (hashtags.length > 0) {
    console.log('\nHashtag yang ada sekarang:');
    hashtags.forEach((tag, index) => {
      console.log(`${index + 1}. ${tag}`);
    });

    console.log('\nMenu hashtag:');
    console.log('1) Edit hashtag by nomor');
    console.log('2) Hapus hashtag by nomor');
    console.log('3) Lanjut');
    const action = await askChoice(rl, 'Pilih [1-3]: ', ['1', '2', '3']);
    if (action === '3') break;

    const index = await askIndex(
      rl,
      `Nomor hashtag (1-${hashtags.length}, Enter kosong buat batal): `,
      hashtags.length,
    );
    if (index === null) continue;

    if (action === '1') {
      const replacementRaw = await rl.question(`Hashtag baru untuk #${index + 1} (Enter kosong batal): `);
      const replacement = normalizeHashtag(replacementRaw);
      if (!replacement) {
        console.log('Edit dibatalin.');
        continue;
      }

      const duplicateIndex = hashtags.findIndex(
        (tag, tagIndex) => tagIndex !== index && tag.toLowerCase() === replacement.toLowerCase(),
      );
      if (duplicateIndex >= 0) {
        console.log(`${replacement} udah ada di nomor ${duplicateIndex + 1}.`);
        continue;
      }

      hashtags[index] = replacement;
      console.log(`Hashtag #${index + 1} diupdate jadi ${replacement}.`);
      continue;
    }

    const removed = hashtags.splice(index, 1)[0];
    console.log(`Hashtag #${index + 1} dihapus: ${removed}`);
  }

  return hashtags;
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

    const manageOld = isYes(
      await rl.question('Mau edit/hapus caption lama by nomor dulu? (y/N): '),
    );
    if (manageOld) {
      captions = await manageCaptions(rl, captions);
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
  } else if (hashtags.length > 0) {
    const manageOld = isYes(
      await rl.question('Mau edit/hapus hashtag lama by nomor dulu? (y/N): '),
    );
    if (manageOld) {
      hashtags = await manageHashtags(rl, hashtags);
    }
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
