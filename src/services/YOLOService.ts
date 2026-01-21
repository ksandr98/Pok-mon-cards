import { loadTensorflowModel, TensorflowModel } from 'react-native-fast-tflite';
import { Asset } from 'expo-asset';

export class YOLOService {
  private model: TensorflowModel | null = null;

  async loadModel() {
    try {
      console.log('Loading TFLite Model...');
      const modelAsset = Asset.fromModule(require('../../assets/yolo11_obb.tflite'));
      await modelAsset.downloadAsync();

      if (!modelAsset.localUri) {
        throw new Error('Failed to get local URI for TFLite model');
      }

      this.model = await loadTensorflowModel(modelAsset.localUri, 'core-ml'); // 'core-ml' uses GPU on iOS, NNAPI on Android
      console.log('TFLite Model loaded successfully');
      return true;
    } catch (error) {
      console.error('Failed to load TFLite model:', error);
      return false;
    }
  }

  isLoaded() {
    return this.model !== null;
  }

  async runInference(input: Float32Array) {
    if (!this.model) return null;
    return await this.model.run([input]);
  }
}

export const yoloService = new YOLOService();