import TextRecognition from '@react-native-ml-kit/text-recognition';

export class OCRService {
  async recognize(uri: string) {
    try {
      const result = await TextRecognition.recognize(uri);
      
      const allText = result.text; // Keep case and newlines for regex
      const words = allText.toLowerCase().split(/\s+/).filter(w => w.length > 1);
      
      // console.log('Recognized:', allText.replace(/\n/g, ' '));
      return { text: allText, words };
    } catch (e) {
      console.error('OCR Error:', e);
      return null;
    }
  }
}

export const ocrService = new OCRService();
