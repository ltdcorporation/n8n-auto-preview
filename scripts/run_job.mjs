#!/usr/bin/env node

import fs from 'node:fs/promises';
import { constants as fsConstants, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov']);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(scriptDir, '..');
const rootDir = process.env.AUTO_PREVIEW_ROOT || defaultRoot;

const sourceImageDir = path.join(rootDir, 'source_media', 'images');
const sourceVideoDir = path.join(rootDir, 'source_media', 'videos');
const outputJobsDir = path.join(rootDir, 'output_jobs');
const dataDir = path.join(rootDir, 'data');
const captionsPath = path.join(dataDir, 'captions.json');
const hashtagsPath = path.join(dataDir, 'hashtags.json');
const lockFilePath = path.join(dataDir, '.run.lock');

function log(message) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${message}`);
}

function randomIntInclusive(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandomItems(items, count) {
  if (count <= 0) return [];
  if (count > items.length) {
    throw new Error(`Cannot pick ${count} items from ${items.length} items.`);
  }

  const pool = [...items];
  const selected = [];
  for (let i = 0; i < count; i += 1) {
    const idx = Math.floor(Math.random() * pool.length);
    selected.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return selected;
}

async function ensureDirectories() {
  await fs.mkdir(sourceImageDir, { recursive: true });
  await fs.mkdir(sourceVideoDir, { recursive: true });
  await fs.mkdir(outputJobsDir, { recursive: true });
  await fs.mkdir(dataDir, { recursive: true });
}

async function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

async function acquireLock() {
  const payload = `${process.pid}\n${new Date().toISOString()}\n`;

  try {
    const lockHandle = await fs.open(lockFilePath, 'wx', 0o644);
    await lockHandle.writeFile(payload);
    await lockHandle.close();
    return true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }

  try {
    const existing = await fs.readFile(lockFilePath, 'utf8');
    const firstLine = existing.split(/\r?\n/, 1)[0]?.trim();
    const activePid = Number(firstLine);
    if (await isProcessAlive(activePid)) {
      return false;
    }
  } catch {
    // If lock file can't be parsed/read, treat it as stale.
  }

  await fs.rm(lockFilePath, { force: true });
  const lockHandle = await fs.open(lockFilePath, 'wx', 0o644);
  await lockHandle.writeFile(payload);
  await lockHandle.close();
  return true;
}

async function releaseLock() {
  await fs.rm(lockFilePath, { force: true });
}

async function readJsonFile(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return JSON.parse(content);
}

async function writeJsonFile(filePath, value) {
  const content = JSON.stringify(value, null, 2);
  await fs.writeFile(filePath, `${content}\n`, 'utf8');
}

async function collectFilesRecursive(root, extensionSet) {
  if (!existsSync(root)) return [];

  const results = [];
  const queue = [root];

  while (queue.length > 0) {
    const current = queue.shift();
    const entries = await fs.readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (extensionSet.has(ext)) {
        results.push(fullPath);
      }
    }
  }

  results.sort((a, b) => a.localeCompare(b));
  return results;
}

function chooseComposition(imageCount, videoCount) {
  const total = imageCount + videoCount;
  if (total < 4) {
    return null;
  }

  if (imageCount > 0 && videoCount > 0) {
    const possibleImageCounts = [];
    for (let candidate = 1; candidate <= 3; candidate += 1) {
      const remainingVideos = 4 - candidate;
      if (candidate <= imageCount && remainingVideos <= videoCount) {
        possibleImageCounts.push(candidate);
      }
    }

    if (possibleImageCounts.length > 0) {
      const imagePick = possibleImageCounts[Math.floor(Math.random() * possibleImageCounts.length)];
      return { images: imagePick, videos: 4 - imagePick };
    }
  }

  if (imageCount >= 4) {
    return { images: 4, videos: 0 };
  }

  if (videoCount >= 4) {
    return { images: 0, videos: 4 };
  }

  return null;
}

function normalizeCaptionEntries(raw) {
  if (!Array.isArray(raw)) {
    throw new Error('captions.json must contain an array.');
  }

  return raw.map((entry, index) => {
    if (typeof entry === 'string') {
      return {
        id: index + 1,
        text: entry.trim(),
        used: false,
        used_at: null,
      };
    }

    if (!entry || typeof entry !== 'object') {
      throw new Error(`Invalid caption entry at index ${index}.`);
    }

    const textCandidate =
      typeof entry.text === 'string'
        ? entry.text
        : typeof entry.caption === 'string'
          ? entry.caption
          : '';

    const text = textCandidate.trim();
    if (!text) {
      throw new Error(`Caption entry at index ${index} does not contain text.`);
    }

    return {
      id: entry.id ?? index + 1,
      text,
      used: Boolean(entry.used),
      used_at: entry.used_at ?? null,
    };
  });
}

function pickCaption(captions) {
  let state = captions.map((entry) => ({ ...entry }));
  let availableIndexes = state
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !entry.used)
    .map(({ index }) => index);

  if (availableIndexes.length === 0) {
    state = state.map((entry) => ({ ...entry, used: false, used_at: null }));
    availableIndexes = state.map((_, index) => index);
  }

  if (availableIndexes.length === 0) {
    throw new Error('No caption entries available in captions.json.');
  }

  const selectedIndex = availableIndexes[Math.floor(Math.random() * availableIndexes.length)];
  state[selectedIndex].used = true;
  state[selectedIndex].used_at = new Date().toISOString();

  return {
    captionText: state[selectedIndex].text,
    nextCaptions: state,
  };
}

function normalizeHashtags(raw) {
  if (!Array.isArray(raw)) {
    throw new Error('hashtags.json must contain an array.');
  }

  const tags = raw
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object') {
        if (typeof entry.tag === 'string') return entry.tag;
        if (typeof entry.hashtag === 'string') return entry.hashtag;
        if (typeof entry.text === 'string') return entry.text;
      }
      return '';
    })
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith('#') ? tag : `#${tag.replace(/\s+/g, '')}`));

  return [...new Set(tags)];
}

function pickHashtags(hashtags) {
  if (hashtags.length === 0) {
    return [];
  }

  const maxPick = Math.min(5, hashtags.length);
  const minPick = Math.min(3, maxPick);
  const pickCount = randomIntInclusive(minPick, maxPick);
  return pickRandomItems(hashtags, pickCount);
}

function formatWibJobFolderName(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);

  const map = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );

  return `job_${map.year}-${map.month}-${map.day}_${map.hour}-${map.minute}_WIB`;
}

async function uniqueDirectoryPath(baseDir, desiredName) {
  let attempt = 0;
  while (true) {
    const suffix = attempt === 0 ? '' : `_${String(attempt).padStart(2, '0')}`;
    const candidate = path.join(baseDir, `${desiredName}${suffix}`);
    try {
      await fs.mkdir(candidate, { recursive: false });
      return candidate;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      attempt += 1;
    }
  }
}

async function uniqueFilePath(targetDir, baseName) {
  const parsed = path.parse(baseName);
  let attempt = 0;

  while (true) {
    const suffix = attempt === 0 ? '' : `_${attempt}`;
    const candidateName = `${parsed.name}${suffix}${parsed.ext}`;
    const candidatePath = path.join(targetDir, candidateName);

    try {
      await fs.access(candidatePath, fsConstants.F_OK);
      attempt += 1;
    } catch {
      return candidatePath;
    }
  }
}

async function moveFileSafe(sourcePath, destinationPath) {
  try {
    await fs.rename(sourcePath, destinationPath);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    await fs.copyFile(sourcePath, destinationPath, fsConstants.COPYFILE_EXCL);
    await fs.unlink(sourcePath);
  }
}

async function run() {
  await ensureDirectories();

  const lockAcquired = await acquireLock();
  if (!lockAcquired) {
    log('Run skipped: previous execution is still active.');
    return;
  }

  try {
    const [images, videos] = await Promise.all([
      collectFilesRecursive(sourceImageDir, IMAGE_EXTENSIONS),
      collectFilesRecursive(sourceVideoDir, VIDEO_EXTENSIONS),
    ]);

    const composition = chooseComposition(images.length, videos.length);
    if (!composition) {
      log(
        `Run skipped: not enough source media. images=${images.length}, videos=${videos.length}, total=${images.length + videos.length}.`,
      );
      return;
    }

    const selectedImages = pickRandomItems(images, composition.images);
    const selectedVideos = pickRandomItems(videos, composition.videos);
    const selectedMedia = [...selectedImages, ...selectedVideos];

    const captionsRaw = await readJsonFile(captionsPath);
    const normalizedCaptions = normalizeCaptionEntries(captionsRaw);
    const { captionText, nextCaptions } = pickCaption(normalizedCaptions);

    const hashtagsRaw = await readJsonFile(hashtagsPath);
    const hashtags = normalizeHashtags(hashtagsRaw);
    const selectedHashtags = pickHashtags(hashtags);

    const jobFolderName = formatWibJobFolderName();
    const jobDir = await uniqueDirectoryPath(outputJobsDir, jobFolderName);

    for (const sourcePath of selectedMedia) {
      const destinationPath = await uniqueFilePath(jobDir, path.basename(sourcePath));
      await moveFileSafe(sourcePath, destinationPath);
    }

    const hashtagsLine = selectedHashtags.join(' ');
    const captionFileContent = `${captionText}\n${hashtagsLine}\n`;
    await fs.writeFile(path.join(jobDir, 'caption.txt'), captionFileContent, 'utf8');

    await writeJsonFile(captionsPath, nextCaptions);

    log(
      `Run success: ${selectedMedia.length} media moved to ${jobDir}. images=${composition.images}, videos=${composition.videos}, hashtags=${selectedHashtags.length}.`,
    );
  } finally {
    await releaseLock();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
