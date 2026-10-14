import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import pin from './nativeLanAudioAsset.json';

/** Only a fixed package resource can be started. No renderer-supplied executable. */
export function verifiedNativeLanAudioExecutable(resourceRoot: string): string | null {
  const filename = join(resourceRoot, 'native-lan-audio', 'laokuai-native-audio.exe');
  try {
    if (!statSync(filename).isFile()) return null;
    const bytes = readFileSync(filename);
    if (bytes.length !== pin.bytes || createHash('sha256').update(bytes).digest('hex') !== pin.sha256) return null;
    return filename;
  } catch { return null; }
}
