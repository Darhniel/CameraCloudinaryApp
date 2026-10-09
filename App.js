import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

// ==========================================
// CONFIGURATION - REPLACE THESE 2 VALUES
// ==========================================
const CLOUD_NAME = 'mwc44csc'; // e.g., 'dxxxxx123'
const UPLOAD_PRESET = 'Sample preset'; // e.g., 'a1b2c3d4'
const CLOUDINARY_FOLDER = 'camera_app_uploads'; // Optional: folder name in Cloudinary
// ==========================================

const QUEUE_KEY = 'camera_upload_queue';

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef(null);

  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [isOnline, setIsOnline] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  // Initialize
  useEffect(() => {
    (async () => {
      updatePendingCount();

      const unsubscribe = NetInfo.addEventListener((state) => {
        const connected = state.isConnected;
        setIsOnline(connected);
        if (connected) {
          syncQueue(); // Auto-sync immediately when internet returns
        }
      });
      return () => unsubscribe();
    })();
  }, []);

  const updatePendingCount = async () => {
    const queueString = await AsyncStorage.getItem(QUEUE_KEY);
    const queue = queueString ? JSON.parse(queueString) : [];
    setPendingCount(queue.length);
  };

  const takePicture = async () => {
    if (!cameraRef.current || isProcessing) return;
    setIsProcessing(true);

    try {
      // 1. Capture image
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });

      // 2. Add to offline queue
      const queueString = await AsyncStorage.getItem(QUEUE_KEY);
      const queue = queueString ? JSON.parse(queueString) : [];
      queue.push({ uri: photo.uri, id: Date.now().toString() });
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));

      updatePendingCount();

      // 3. Sync immediately if online
      if (isOnline) {
        await syncQueue();
      }
    } catch (error) {
      console.error('Capture error:', error);
      Alert.alert('Error', `Failed to capture: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const syncQueue = async () => {
    if (isSyncing) return; // Prevent multiple simultaneous syncs

    const queueString = await AsyncStorage.getItem(QUEUE_KEY);
    if (!queueString) return;

    let queue = JSON.parse(queueString);
    if (queue.length === 0) return;

    setIsSyncing(true);
    const item = queue[0];

    try {
      // ✅ FIXED: Use direct URI object for React Native FormData (No blob conversion needed)
      const formData = new FormData();
      formData.append('file', {
        uri: item.uri,
        type: 'image/jpeg',
        name: `capture_${item.id}.jpg`,
      });
      formData.append('upload_preset', UPLOAD_PRESET);
      if (CLOUDINARY_FOLDER) {
        formData.append('folder', CLOUDINARY_FOLDER);
      }

      // Upload to Cloudinary
      const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;
      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        body: formData,
        // Do NOT set 'Content-Type': 'multipart/form-data' manually.
        // React Native will automatically set it with the correct boundary.
      });

      const responseData = await uploadResponse.json();

      if (!uploadResponse.ok) {
        throw new Error(
          responseData.error?.message || `HTTP ${uploadResponse.status}`
        );
      }

      console.log('✅ Successfully uploaded:', responseData.secure_url);

      // Success! Remove from queue
      queue.shift();
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
      updatePendingCount();

      // Trigger next item if queue is still not empty
      if (queue.length > 0) {
        setTimeout(() => syncQueue(), 500);
      }
    } catch (error) {
      console.error('❌ Sync error for item:', error.message);
      // Show alert ONLY if it's a configuration error (like wrong preset), not a temporary network drop
      if (
        error.message.includes('Invalid') ||
        error.message.includes('not found')
      ) {
        Alert.alert(
          'Upload Failed',
          `Cloudinary Error: ${error.message}\n\nCheck your CLOUD_NAME and UPLOAD_PRESET.`
        );
      }
      // Leave item in queue to retry later when network improves
    } finally {
      setIsSyncing(false);
    }
  };

  const clearQueue = async () => {
    await AsyncStorage.removeItem(QUEUE_KEY);
    updatePendingCount();
    Alert.alert('Cleared', 'Pending uploads have been deleted.');
  };

  if (!permission) {
    return (
      <View style={styles.container}>
        <Text>Requesting camera permission...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>No access to camera</Text>
        <TouchableOpacity onPress={requestPermission} style={styles.actionBtn}>
          <Text style={styles.btnText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView style={styles.camera} facing="back" ref={cameraRef}>
        {/* Top Bar: Status */}
        <View style={styles.topBar}>
          <View style={styles.statusBadge}>
            <View
              style={[
                styles.dot,
                { backgroundColor: isOnline ? '#4CAF50' : '#F44336' },
              ]}
            />
            <Text style={styles.statusText}>
              {isOnline ? 'Online' : 'Offline'}{' '}
              {isSyncing ? '(Syncing...)' : ''}
            </Text>
          </View>

          {pendingCount > 0 && (
            <View style={styles.pendingBadge}>
              <Text style={styles.pendingText}>{pendingCount} Pending</Text>
            </View>
          )}
        </View>

        {/* Bottom Bar: Capture Button */}
        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={[
              styles.captureBtn,
              (isProcessing || isSyncing) && styles.disabledBtn,
            ]}
            onPress={takePicture}
            disabled={isProcessing || isSyncing}>
            {isProcessing || isSyncing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <View style={styles.captureInner} />
            )}
          </TouchableOpacity>

          {pendingCount > 0 && (
            <TouchableOpacity onPress={clearQueue} style={styles.clearBtn}>
              <Text style={styles.clearText}>Clear Queue</Text>
            </TouchableOpacity>
          )}
        </View>
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  topBar: {
    flex: 1,
    backgroundColor: 'transparent',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 50,
    paddingHorizontal: 20,
  },
  bottomBar: {
    flex: 1,
    backgroundColor: 'transparent',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 40,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  statusText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  pendingBadge: {
    backgroundColor: 'rgba(255, 152, 0, 0.9)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  pendingText: { color: '#fff', fontWeight: 'bold' },
  actionBtn: {
    backgroundColor: '#4285F4',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    marginTop: 20,
  },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  captureBtn: {
    width: 75,
    height: 75,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#fff',
  },
  captureInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#fff',
  },
  disabledBtn: { opacity: 0.5 },
  clearBtn: {
    marginTop: 20,
    backgroundColor: 'rgba(244, 67, 54, 0.8)',
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 20,
  },
  clearText: { color: '#fff', fontWeight: 'bold' },
  text: { color: '#fff', fontSize: 18, textAlign: 'center', marginTop: 50 },
});
