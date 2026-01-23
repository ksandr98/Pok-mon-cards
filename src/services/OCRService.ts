import TextRecognition from '@react-native-ml-kit/text-recognition';

export interface ZoneResult {
  topText: string;      // Top 30% - name, HP
  middleText: string;   // Middle 40% - attacks, abilities
  bottomText: string;   // Bottom 30% - set number, weakness, retreat
  fullText: string;
  words: string[];
}

export class OCRService {
  async recognize(uri: string): Promise<ZoneResult | null> {
    try {
      const result = await TextRecognition.recognize(uri);

      const allText = result.text;
      const words = allText.toLowerCase().split(/\s+/).filter((w: string) => w.length > 1);

      // Assign blocks to zones based on Y position
      let topText = '';
      let middleText = '';
      let bottomText = '';

      if (result.blocks && result.blocks.length > 0) {
        // Find the bounding box of all text to normalize positions
        let maxY = 0;
        for (const block of result.blocks) {
          if (block.frame) {
            const blockBottom = block.frame.top + block.frame.height;
            if (blockBottom > maxY) maxY = blockBottom;
          }
        }

        if (maxY > 0) {
          for (const block of result.blocks) {
            if (!block.frame) {
              middleText += block.text + '\n';
              continue;
            }
            // Center Y of block relative to total height
            const centerY = (block.frame.top + block.frame.height / 2) / maxY;

            if (centerY < 0.3) {
              topText += block.text + '\n';
            } else if (centerY < 0.7) {
              middleText += block.text + '\n';
            } else {
              bottomText += block.text + '\n';
            }
          }
        } else {
          // Fallback: no frame data, split text by lines
          const lines = allText.split('\n');
          const third = Math.ceil(lines.length / 3);
          topText = lines.slice(0, third).join('\n');
          middleText = lines.slice(third, third * 2).join('\n');
          bottomText = lines.slice(third * 2).join('\n');
        }
      } else {
        // No blocks - split by lines
        const lines = allText.split('\n');
        const third = Math.ceil(lines.length / 3);
        topText = lines.slice(0, third).join('\n');
        middleText = lines.slice(third, third * 2).join('\n');
        bottomText = lines.slice(third * 2).join('\n');
      }

      return { topText, middleText, bottomText, fullText: allText, words };
    } catch (e) {
      console.error('OCR Error:', e);
      return null;
    }
  }
}

export const ocrService = new OCRService();
