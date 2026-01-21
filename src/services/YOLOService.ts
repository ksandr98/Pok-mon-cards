import * as ort from 'onnxruntime-react-native';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';

export class YOLOService {
  private session: ort.InferenceSession | null = null;

  async loadModel() {
    try {
      const modelAsset = Asset.fromModule(require('../../assets/yolo11_obb.onnx'));
      await modelAsset.downloadAsync();

      if (!modelAsset.localUri) {
        throw new Error('Failed to get local URI for model asset');
      }

      // ONNX Runtime on Android needs a direct file path
      const modelPath = `${FileSystem.documentDirectory}yolo11_obb.onnx`;
      await FileSystem.copyAsync({
        from: modelAsset.localUri,
        to: modelPath,
      });

      this.session = await ort.InferenceSesion.create(modelPath);
      console.log('YOLO Model loaded successfully');
      return true;
    } catch (error) {
      console.error('Failed to load YOLO Model:', error);
      return false;
    }
  }

  isLoaded() {
    return this.session !== null;
  }
}

export const yoloService = new YOLOService();
