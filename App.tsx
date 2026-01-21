import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { Camera } from 'react-native-vision-camera';
import { yoloService } from './src/services/YOLOService';
import { databaseService } from './src/services/DatabaseService';

export default function App() {
  const [modelLoaded, setModelLoaded] = useState(false);
  const [dbLoaded, setDbLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      try {
        const status = await Camera.requestCameraPermission();
        if (status === 'denied') {
          setError('Camera permission denied');
          return;
        }

        const modelOk = await yoloService.loadModel();
        if (modelOk) setModelLoaded(true);
        else setError('Failed to load YOLO Model');

        const dbOk = await databaseService.initDb();
        if (dbOk) setDbLoaded(true);
        else setError('Failed to load Database');
      } catch (e: any) {
        setError(e.message);
      }
    }
    init();
  }, []);

  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Pokemon Camera Lab</Text>
      
      <View style={styles.statusBox}>
        <Text>ML Model: {modelLoaded ? 'LOADED ✅' : 'LOADING...'}</Text>
      </View>
      <View style={[styles.statusBox, { marginTop: 10 }]}>
        <Text>Database: {dbLoaded ? 'LOADED ✅' : 'LOADING...'}</Text>
      </View>

      {(!modelLoaded || !dbLoaded) && <ActivityIndicator style={{ marginTop: 20 }} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  statusBox: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    width: '85%',
    alignItems: 'center',
    elevation: 2,
  },
  errorText: {
    color: 'red',
    fontSize: 16,
  },
});
