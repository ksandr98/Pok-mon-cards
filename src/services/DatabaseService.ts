import * as SQLite from 'expo-sqlite';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';

export class DatabaseService {
  private db: SQLite.SQLiteDatabase | null = null;

  async initDb() {
    try {
      const dbPath = `${FileSystem.documentDirectory}SQLite/pokemon-cards.db`;
      const dbDir = `${FileSystem.documentDirectory}SQLite`;
      
      const { exists } = await FileSystem.getInfoAsync(dbDir);
      if (!exists) {
        await FileSystem.makeDirectoryAsync(dbDir, { intermediates: true });
      }

      console.log('Loading database asset...');
      const asset = Asset.fromModule(require('../../assets/pokemon-cards.db'));
      await asset.downloadAsync();
      
      await FileSystem.copyAsync({
        from: asset.localUri!,
        to: dbPath,
      });

      this.db = await SQLite.openDatabaseAsync('pokemon-cards.db');
      console.log('Database loaded successfully');
      return true;
    } catch (error) {
      console.error('Failed to init database:', error);
      return false;
    }
  }

  async getCardById(id: string) {
    if (!this.db) return null;
    return await this.db.getFirstAsync('SELECT * FROM cards WHERE id = ?', id);
  }
}

export const databaseService = new DatabaseService();