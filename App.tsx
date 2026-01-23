import { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, ActivityIndicator, Dimensions, ScrollView, Image, TouchableOpacity } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { databaseService } from './src/services/DatabaseService';
import { ocrService } from './src/services/OCRService';
import * as ImageManipulator from 'expo-image-manipulator';

const { width: SCREEN_W } = Dimensions.get('window');
const FRAME_W = SCREEN_W * 0.8;
const FRAME_H = FRAME_W * 1.4;

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const [ready, setReady] = useState(false);
  const [debugText, setDebugText] = useState('Booting...'); // Changed default
  const [candidates, setCandidates] = useState<any[]>([]);
  const [scanning, setScanning] = useState(false);
  const [selectedCard, setSelectedCard] = useState<any>(null);
  
  const cameraRef = useRef<CameraView>(null);

  useEffect(() => {
    (async () => {
      try {
          setDebugText('Requesting Perms...');
          await requestPermission();
          
          setDebugText('Init DB...');
          const dbOk = await databaseService.initDb();
          if (!dbOk) throw new Error('DB Init Failed');
          
          setReady(true);
          setDebugText('Ready to Scan');
      } catch (e: any) {
          setDebugText('Init Error: ' + e.message);
      }
    })();
  }, []);

  useEffect(() => {
    if (!ready || selectedCard) return;

    const scan = async () => {
      if (cameraRef.current && !scanning) {
        setScanning(true);
        try {
          const photo = await cameraRef.current.takePictureAsync({
              quality: 0.5, 
              skipProcessing: true,
              shutterSound: false
          });

          if (photo) {
            let uriToScan = photo.uri;
            try {
                // Crop to match the green frame: 80% width, 1.4 aspect ratio, centered
                const cropW = Math.floor(photo.width * 0.8);
                const cropH = Math.min(Math.floor(cropW * 1.4), photo.height);
                const originX = Math.floor((photo.width - cropW) / 2);
                const originY = Math.floor((photo.height - cropH) / 2);

                if (cropW > 0 && cropH > 0 && originX >= 0 && originY >= 0) {
                    const cropped = await ImageManipulator.manipulateAsync(
                        photo.uri,
                        [{ crop: { originX, originY, width: cropW, height: cropH } }]
                    );
                    uriToScan = cropped.uri;
                }
            } catch (e) { }

            const result = await ocrService.recognize(uriToScan);

            if (result) {
                setDebugText(result.fullText.replace(/\n/g, ' ').substring(0, 100));

                if (result.words.length > 0) {
                    const found = await databaseService.findCandidates(result.words, result.fullText, result);
                    setCandidates(found);
                }
            }
          }
        } catch (e: any) {
          setDebugText('Scan Error: ' + e.message);
        } finally {
          setScanning(false);
        }
      }
    };

    const timer = setInterval(scan, 1500); 
    return () => clearInterval(timer);
  }, [ready, scanning, selectedCard]);

  const onSelect = (card: any) => setSelectedCard(card);
  const reset = () => { setSelectedCard(null); setCandidates([]); };

  if (!permission?.granted) return <View style={styles.center}><Text>No Camera</Text></View>;

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={styles.camera} facing="back" animateShutter={false} />
      
      <View style={styles.maskContainer}>
        <View style={styles.maskTop} />
        <View style={styles.maskMiddle}>
          <View style={styles.maskSide} />
          <View style={styles.frame} />
          <View style={styles.maskSide} />
        </View>
        <View style={styles.maskBottom} />
      </View>

      <View style={styles.overlay}>
        <Text style={styles.debugText}>{debugText}</Text>
        
        {selectedCard ? (
            <View style={styles.detailPanel}>
                <Image source={{ uri: selectedCard.image_url }} style={styles.bigImage} resizeMode="contain" />
                <Text style={styles.cardName}>{selectedCard.name}</Text>
                <Text style={styles.cardSet}>{selectedCard.set_name}</Text>
                <TouchableOpacity onPress={reset} style={styles.closeBtn}>
                    <Text style={{color:'#fff'}}>Scan Again</Text>
                </TouchableOpacity>
            </View>
        ) : (
            <ScrollView style={styles.list} contentContainerStyle={{paddingBottom: 20}}>
                {candidates.length > 0 ? candidates.map((c, i) => (
                    <TouchableOpacity key={i} style={styles.item} onPress={() => onSelect(c)}>
                        <Image source={{ uri: c.image_url }} style={styles.thumb} resizeMode="contain" />
                        <View style={{flex:1}}>
                            <Text style={styles.itemTitle}>{c.name}</Text>
                            <Text style={styles.itemSub}>{c.set_name} • {c.hp} HP</Text>
                        </View>
                    </TouchableOpacity>
                )) : (
                    <Text style={styles.noMatch}>Scanning...</Text>
                )}
            </ScrollView>
        )}
        
        {scanning && !selectedCard && <ActivityIndicator size="small" color="#fff" style={{position:'absolute', right:10, top:10}} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'black' },
  camera: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  maskContainer: { ...StyleSheet.absoluteFillObject },
  maskTop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)' },
  maskBottom: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)' },
  maskMiddle: { height: FRAME_H, flexDirection: 'row' },
  maskSide: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)' },
  frame: { width: FRAME_W, height: FRAME_H, borderWidth: 2, borderColor: '#0f0', borderRadius: 15 },
  overlay: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 280, backgroundColor: 'rgba(0,0,0,0.9)', padding: 15, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  debugText: { color: '#0f0', fontSize: 10, marginBottom: 10, height: 30 },
  list: { flex: 1 },
  item: { flexDirection: 'row', marginBottom: 10, borderBottomWidth: 1, borderBottomColor: '#333', paddingBottom: 5, alignItems: 'center' },
  thumb: { width: 40, height: 56, marginRight: 10, backgroundColor: '#333' },
  itemTitle: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  itemSub: { color: '#aaa' },
  noMatch: { color: '#777', textAlign: 'center', marginTop: 20 },
  detailPanel: { alignItems: 'center' },
  bigImage: { width: 120, height: 160, marginBottom: 10 },
  cardName: { color: '#fff', fontWeight: 'bold', fontSize: 18 },
  cardSet: { color: '#aaa' },
  closeBtn: { marginTop: 10, padding: 10, backgroundColor: '#444', borderRadius: 5 }
});