import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import decode from 'jpeg-js';
import { Buffer } from 'buffer';
import { databaseService } from './DatabaseService';

const HASH_W = 8;
const HASH_H = 11;
const HASH_BITS = HASH_W * HASH_H;
const HASHES_FILE = FileSystem.documentDirectory + 'local_dhashes_8x11.json'; // New file for dHash

export class RecognitionService {
  private hashes: { id: string; hash: string }[] = [];

  async loadOrGenerateHashes(onProgress: (current: number, total: number) => void) {
    try {
      const exists = await FileSystem.getInfoAsync(HASHES_FILE);
      if (exists.exists) {
        console.log('Loading local hashes...');
        const json = await FileSystem.readAsStringAsync(HASHES_FILE);
        this.hashes = JSON.parse(json);
        console.log(`Loaded ${this.hashes.length} hashes from local storage.`);
        return true;
      }

      console.log('Generating hashes on device...');
      const cards = databaseService.getAllCards().slice(0, 100); 
      
      const newHashes = [];
      let count = 0;

      for (const card of cards) {
        try {
            if (!card.image_url) continue;
            
            const tempFile = FileSystem.cacheDirectory + `temp_${card.id}.png`;
            await FileSystem.downloadAsync(card.image_url, tempFile);
            
            const hash = await this.calculateHash(tempFile);
            if (hash) {
                newHashes.push({ id: card.id, hash });
            }
            
            await FileSystem.deleteAsync(tempFile, { idempotent: true });
            
            count++;
            onProgress(count, cards.length);
        } catch (e) {
            console.warn(`Failed to process ${card.id}:`, e);
        }
      }

      this.hashes = newHashes;
      await FileSystem.writeAsStringAsync(HASHES_FILE, JSON.stringify(this.hashes));
      console.log(`Generated and saved ${newHashes.length} hashes.`);
      return true;

    } catch (e) {
      console.error('Failed to init hashes:', e);
      return false;
    }
  }

  async calculateHash(uri: string) {
    try {
      // Resize for dHash: Width + 1
      const manipulated = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: HASH_W + 1, height: HASH_H } }],
        { format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );

      const jpegBuffer = Buffer.from(manipulated.base64!, 'base64');
      const { data } = decode.decode(jpegBuffer, { useTArray: true });

      let binaryHash = '';
      const w = HASH_W + 1;
      
      for (let y = 0; y < HASH_H; y++) {
        for (let x = 0; x < HASH_W; x++) {
            let i = (y * w + x) * 4;
            const b1 = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
            
            let i2 = (y * w + (x + 1)) * 4;
            const b2 = 0.299 * data[i2] + 0.587 * data[i2+1] + 0.114 * data[i2+2];

            binaryHash += (b1 > b2) ? '1' : '0';
        }
      }
      
      return this.binaryToHex(binaryHash);
    } catch (e) {
        console.warn('Hash calc error:', e);
        return null;
    }
  }

  async identify(uri: string) {
    const hash = await this.calculateHash(uri);
    if (!hash) return null;
    return this.findBestMatch(hash);
  }

  private binaryToHex(s: string) {
    let ret = '';
    while (s.length % 4 !== 0) s += '0';
    for (let i = 0; i < s.length; i += 4) {
      ret += parseInt(s.substr(i, 4), 2).toString(16);
    }
    return ret;
  }

  private findBestMatch(targetHash: string) {
    let bestId = null;
    let minDistance = HASH_BITS; 

    for (const item of this.hashes) {
      const dist = this.hammingDistance(targetHash, item.hash);
      if (dist < minDistance) {
        minDistance = dist;
        bestId = item.id;
      }
    }

    console.log(`Best diff: ${minDistance} / ${HASH_BITS}`);

    if (minDistance < 25) { 
      return { id: bestId, distance: minDistance };
    }
    
    return null;
  }

  private hammingDistance(h1: string, h2: string) {
    let dist = 0;
    const len = Math.min(h1.length, h2.length);
    for (let i = 0; i < len; i++) {
        let x = parseInt(h1[i], 16) ^ parseInt(h2[i], 16);
        while(x > 0) {
            if(x & 1) dist++;
            x >>= 1;
        }
    }
    return dist;
  }
}

export const recognitionService = new RecognitionService();
