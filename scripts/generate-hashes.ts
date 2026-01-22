// @ts-nocheck
const sqlite3 = require('sqlite3').verbose();
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const https = require('https');

const DB_PATH = path.join(__dirname, '../assets/pokemon-cards.db');
const OUT_PATH = path.join(__dirname, '../assets/my_hashes.csv');
const LIMIT = 100;
const HASH_SIZE = 32;

// Ensure assets dir exists
if (!fs.existsSync(path.dirname(OUT_PATH))) {
    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
}

// Open DB
const db = new sqlite3.Database(DB_PATH);

// Helper to download image
function downloadImage(url, filepath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(filepath);
        https.get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve(true);
            });
        }).on('error', (err) => {
            fs.unlink(filepath);
            reject(err);
        });
    });
}

// Helper to calculate dHash (Must match RecognitionService.ts)
async function calculateDHash(filepath) {
    // 1. Resize to (Size + 1) x Size
    // 2. Greyscale
    // 3. Raw pixels
    const { data, info } = await sharp(filepath)
        .resize(HASH_SIZE + 1, HASH_SIZE, { fit: 'fill' }) // Ignore aspect ratio
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

    let binaryHash = '';
    const w = HASH_SIZE + 1;
    const h = HASH_SIZE;

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < HASH_SIZE; x++) {
            const p1 = data[y * w + x];
            const p2 = data[y * w + (x + 1)];
            binaryHash += (p1 > p2) ? '1' : '0';
        }
    }

    // Convert to Hex
    let ret = '';
    for (let i = 0; i < binaryHash.length; i += 4) {
      const part = binaryHash.substr(i, 4);
      ret += parseInt(part, 2).toString(16);
    }
    return ret;
}

// Main Loop
db.all(`SELECT id, image_url FROM pokemon_cards LIMIT ${LIMIT}`, async (err, rows) => {
    if (err) {
        console.error(err);
        return;
    }

    console.log(`Processing ${rows.length} cards...`);
    const stream = fs.createWriteStream(OUT_PATH);
    // stream.write('id,hash\n'); // No header for compatibility

    for (const row of rows) {
        if (!row.image_url) continue;

        const tempFile = path.join(__dirname, `temp_${row.id}.png`);
        try {
            // console.log(`Downloading ${row.id}...`);
            await downloadImage(row.image_url, tempFile);
            
            const hash = await calculateDHash(tempFile);
            stream.write(`${row.id},${hash}\n`);
            
            process.stdout.write('.');
        } catch (e) {
            console.error(`\nFailed ${row.id}:`, e.message);
        } finally {
            if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        }
    }

    console.log(`\nDone! Saved to ${OUT_PATH}`);
    db.close();
});