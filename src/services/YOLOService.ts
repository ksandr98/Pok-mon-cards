import * as ort from 'onnxruntime-react-native';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import decode from 'jpeg-js';
import { Buffer } from 'buffer';

const MODEL_SIZE = 640;

export class YOLOService {
  private session: ort.InferenceSession | null = null;

  async loadModel() {
    try {
      // console.log('Loading YOLO ONNX Model...');
      const modelAsset = Asset.fromModule(require('../../assets/yolo11_obb.onnx'));
      await modelAsset.downloadAsync();
      const modelPath = `${FileSystem.documentDirectory}yolo11_obb.onnx`;
      const info = await FileSystem.getInfoAsync(modelPath);
      if (!info.exists) {
        await FileSystem.copyAsync({ from: modelAsset.localUri!, to: modelPath });
      }
      this.session = await ort.InferenceSession.create(modelPath);
      console.log('YOLO ONNX Model loaded ✅');
      return true;
    } catch (error) {
      console.error('Failed to load YOLO model:', error);
      return false;
    }
  }

  async detect(uri: string) {
    if (!this.session) return null;

    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: MODEL_SIZE, height: MODEL_SIZE } }],
        { format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );

      const jpegBuffer = Buffer.from(manipulated.base64!, 'base64');
      const { data } = decode.decode(jpegBuffer, { useTArray: true });

      const float32Data = new Float32Array(3 * MODEL_SIZE * MODEL_SIZE);
      for (let i = 0; i < MODEL_SIZE * MODEL_SIZE; i++) {
        float32Data[i] = data[i * 4] / 255.0;
        float32Data[i + MODEL_SIZE * MODEL_SIZE] = data[i * 4 + 1] / 255.0;
        float32Data[i + 2 * MODEL_SIZE * MODEL_SIZE] = data[i * 4 + 2] / 255.0;
      }

      const inputTensor = new ort.Tensor('float32', float32Data, [1, 3, MODEL_SIZE, MODEL_SIZE]);
      const outputs = await this.session.run({ images: inputTensor });
      const output = outputs[this.session.outputNames[0]];

      return this.parseOBB(output.data as Float32Array, [...output.dims]);
    } catch (error) {
      console.error('Inference error:', error);
      return null;
    }
  }

  private parseOBB(data: Float32Array, dims: number[]) {
    const anchors = dims[2]; 
    let bestScore = 0;
    let bestIdx = -1;

    for (let i = 0; i < anchors; i++) {
      const score = data[4 * anchors + i]; 
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx !== -1 && bestScore > 0.6) { // 60% threshold
      return {
        score: bestScore,
        x: data[0 * anchors + bestIdx],
        y: data[1 * anchors + bestIdx],
        w: data[2 * anchors + bestIdx],
        h: data[3 * anchors + bestIdx],
      };
    }
    return null;
  }
}

export const yoloService = new YOLOService();
