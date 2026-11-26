// Skylane Courier — the program that hands the game in (Node 22, standard
// library only). It takes this repository's game/ and screenshots/ folders,
// copies them into the output directory the grader provides, and writes
// /output/dossier.json with the vendored make.fun library, which is the
// summary the judge reads. Run it with:
//
//   MAKEFUN_OUTPUT_DIR=/tmp/flight-out node main.ts
//
// Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output; without it
// the program writes to /output. It finishes in well under ten seconds and
// writes exactly the same dossier.json on every run.

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The scorer's caps for this competition (see the kit's reference/gate.json):
// at most 4 screenshots of at most 256 KiB each, at most 993 files and
// 48 MiB under game/, no game path longer than 1000 bytes, dossier text
// capped at 160 KiB. The dossier builder enforces them; the checks below
// fail loudly first, so a bad entry never ships silently.
const LIMITS = {
  textMaxBytes: 163840,
  screenshotsMax: 4,
  screenshotMaxBytes: 262144,
  gameMaxFiles: 993,
  gameMaxBytes: 50331648,
  gamePathMaxBytes: 1000,
};

function countGameFiles(dir, prefix) {
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (Buffer.byteLength(rel, 'utf8') > LIMITS.gamePathMaxBytes) {
      throw new Error(`game path too long: ${rel}`);
    }
    if (entry.isDirectory()) {
      const sub = countGameFiles(full, rel);
      files += sub.files;
      bytes += sub.bytes;
    } else {
      files += 1;
      bytes += statSync(full).size;
    }
  }
  return { files, bytes };
}

function checkScreenshots(dir) {
  if (!existsSync(dir)) throw new Error('screenshots/ is missing from the repository');
  const names = readdirSync(dir).filter((name) => /\.(jpe?g|png)$/i.test(name)).sort();
  if (names.length === 0) throw new Error('no screenshots found in screenshots/');
  if (names.length > LIMITS.screenshotsMax) {
    throw new Error(`too many screenshots: ${names.length} (max ${LIMITS.screenshotsMax})`);
  }
  for (const name of names) {
    const size = statSync(join(dir, name)).size;
    if (size > LIMITS.screenshotMaxBytes) {
      throw new Error(`screenshot ${name} is ${size} bytes (max ${LIMITS.screenshotMaxBytes})`);
    }
  }
  return names;
}

function main() {
  const gameDir = join(repoRoot, 'game');
  const shotsDir = join(repoRoot, 'screenshots');
  if (!existsSync(gameDir)) throw new Error('game/ is missing from the repository');

  const gameStats = countGameFiles(gameDir, 'game');
  if (gameStats.files > LIMITS.gameMaxFiles) {
    throw new Error(`game/ has ${gameStats.files} files (max ${LIMITS.gameMaxFiles})`);
  }
  if (gameStats.bytes > LIMITS.gameMaxBytes) {
    throw new Error(`game/ is ${gameStats.bytes} bytes (max ${LIMITS.gameMaxBytes})`);
  }
  const shotNames = checkScreenshots(shotsDir);

  mkdirSync(outputDir, { recursive: true });
  cpSync(gameDir, join(outputDir, 'game'), { recursive: true });
  mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
  cpSync(shotsDir, join(outputDir, 'screenshots'), { recursive: true });

  const dossier = buildDossier(outputDir, {
    text_max_bytes: LIMITS.textMaxBytes,
    screenshots: { max: LIMITS.screenshotsMax, max_bytes: LIMITS.screenshotMaxBytes },
    game_max_files: LIMITS.gameMaxFiles,
    game_max_bytes: LIMITS.gameMaxBytes,
    game_path_max_bytes: LIMITS.gamePathMaxBytes,
  });
  writeFileSync(join(outputDir, 'dossier.json'), dossier);

  console.log(
    `Skylane Courier handed in: ${gameStats.files} game files (${gameStats.bytes} bytes), ` +
    `${shotNames.length} screenshots (${shotNames.join(', ')}), dossier written to ${join(outputDir, 'dossier.json')}`,
  );
}

main();
