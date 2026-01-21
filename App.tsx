import 'react-native-worklets-core'; // MUST BE FIRST
import 'react-native-reanimated';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { Camera, useCameraDevice, useFrameProcessor } from 'react-native-vision-camera';
import { yoloService } from './src/services/YOLOService';
import { databaseService } from './src/services/DatabaseService';

export default function App() {
  const [modelLoaded, setModelLoaded] = useState(false);
  const [dbLoaded, setDbLoaded] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  
  const device = useCameraDevice('back');

  useEffect(() => {
    (async () => {
      const status = await Camera.requestCameraPermission();
      setHasPermission(status === 'granted');

      const modelOk = await yoloService.loadModel();
      if (modelOk) setModelLoaded(true);
      else console.log('TFLite model missing (Expected for now)');

      const dbOk = await databaseService.initDb();
      if (dbOk) setDbLoaded(true);
    })();
  }, []);

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    // console.log(`Frame: ${frame.width}x${frame.height}`);
  }, []);

  if (!hasPermission) return <View style={styles.center}><Text>No Camera Permission</Text></View>;
  if (!device) return <View style={styles.center}><Text>No Back Camera Found</Text></View>;

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        frameProcessor={frameProcessor}
        pixelFormat="yuv"
      />
      
      <View style={styles.overlay}>
        <Text style={styles.statusText}>
          ML: {modelLoaded ? '✅' : '❌'} | DB: {dbLoaded ? '✅' : '❌'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlay: {
    position: 'absolute',
    top: 50,
    left: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 10,
    borderRadius: 8,
  },
  statusText: {
    color: 'white',
    fontWeight: 'bold',
  },
  errorText: {
    color: 'red',
    fontSize: 16,
  }
});