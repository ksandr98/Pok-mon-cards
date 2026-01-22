import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

interface ParsedOCR {
  name: string | null;
  hp: number | null;
  setNumber: string | null;
  words: string[];
  attacks: string[];
}

interface CardCandidate {
  card: any;
  score: number;
  reasons: string[];
}

export class DatabaseService {
  private db: SQLite.SQLiteDatabase | null = null;
  private allCards: any[] = [];

  // Индексы для быстрого поиска
  private cardsByHP: Map<number, any[]> = new Map();
  private cardsByName: Map<string, any[]> = new Map();
  private attackIndex: Map<string, any[]> = new Map();

  async initDb() {
    try {
      const dbDir = `${FileSystem.documentDirectory}SQLite`;
      const dbPath = `${dbDir}/pokemon-cards.db`;
      const info = await FileSystem.getInfoAsync(dbDir);
      if (!info.exists) await FileSystem.makeDirectoryAsync(dbDir, { intermediates: true });

      const dbFile = await FileSystem.getInfoAsync(dbPath);
      if (!dbFile.exists && Platform.OS === 'android') {
        try {
          await FileSystem.copyAsync({
            from: 'file:///android_asset/pokemon-cards.db',
            to: dbPath
          });
        } catch (e) {
          const { Asset } = require('expo-asset');
          const asset = Asset.fromModule(require('../../assets/pokemon-cards.db'));
          await asset.downloadAsync();
          await FileSystem.copyAsync({ from: asset.localUri!, to: dbPath });
        }
      }

      this.db = await SQLite.openDatabaseAsync('pokemon-cards.db');
      this.allCards = await this.db.getAllAsync('SELECT * FROM pokemon_cards');

      // Строим индексы
      this.buildIndexes();

      console.log(`Indexed ${this.allCards.length} cards.`);
      return true;
    } catch (error) {
      console.error('Failed to init database:', error);
      return false;
    }
  }

  private buildIndexes() {
    for (const card of this.allCards) {
      // Индекс по HP
      if (card.hp) {
        const hp = parseInt(card.hp);
        if (!this.cardsByHP.has(hp)) this.cardsByHP.set(hp, []);
        this.cardsByHP.get(hp)!.push(card);
      }

      // Индекс по имени (lowercase)
      const nameLower = card.name.toLowerCase().trim();
      if (!this.cardsByName.has(nameLower)) this.cardsByName.set(nameLower, []);
      this.cardsByName.get(nameLower)!.push(card);

      // Индекс по атакам из caption
      if (card.caption) {
        const attackMatches = card.caption.match(/the attack (\w+)/gi);
        if (attackMatches) {
          for (const match of attackMatches) {
            const attackName = match.replace(/the attack /i, '').toLowerCase();
            if (attackName.length > 3) {
              if (!this.attackIndex.has(attackName)) this.attackIndex.set(attackName, []);
              this.attackIndex.get(attackName)!.push(card);
            }
          }
        }
      }
    }

    console.log(`HP buckets: ${this.cardsByHP.size}, Name buckets: ${this.cardsByName.size}, Attacks: ${this.attackIndex.size}`);
  }

  /**
   * Парсит OCR текст и извлекает структурированные данные
   */
  parseOCRText(fullText: string, words: string[]): ParsedOCR {
    const result: ParsedOCR = {
      name: null,
      hp: null,
      setNumber: null,
      words: words,
      attacks: []
    };

    // DEBUG: Логируем что OCR реально видит
    console.log('OCR RAW TEXT:', fullText.substring(0, 300));

    // 1. Извлекаем HP - множество паттернов
    const hpPatterns = [
      /(\d{2,3})\s*HP/i,           // "70 HP", "70HP"
      /HP\s*(\d{2,3})/i,           // "HP 70", "HP70"
      /(\d{2,3})\s*H\s*P/i,        // "70 H P" (OCR может разбить)
    ];
    for (const pattern of hpPatterns) {
      const match = fullText.match(pattern);
      if (match) {
        const hp = parseInt(match[1]);
        if (hp >= 30 && hp <= 340) {
          result.hp = hp;
          break;
        }
      }
    }

    // Если не нашли HP по паттернам - ищем числа в начале текста (первые 50 символов)
    // На современных картах HP часто просто число в углу
    if (!result.hp) {
      const firstPart = fullText.substring(0, 80);
      const numbers = firstPart.match(/\b(\d{2,3})\b/g);
      if (numbers) {
        for (const numStr of numbers) {
          const num = parseInt(numStr);
          // HP обычно кратно 10 и в диапазоне 30-340
          if (num >= 30 && num <= 340 && num % 10 === 0) {
            result.hp = num;
            console.log(`HP detected from number: ${num}`);
            break;
          }
        }
      }
    }

    // 2. Извлекаем номер сета - паттерн: "123/456"
    const setMatch = fullText.match(/(\d{1,3})\s*[\/]\s*(\d{2,3})/);
    if (setMatch) {
      result.setNumber = `${setMatch[1]}/${setMatch[2]}`;
    }

    // 3. Извлекаем имя покемона
    // Стратегия: ищем известные имена покемонов в тексте
    const cleanWords = words
      .map(w => w.replace(/[^a-zA-Z]/g, '').toLowerCase())
      .filter(w => w.length > 2);

    // Ищем точное совпадение с именем в базе
    for (const word of cleanWords) {
      if (this.cardsByName.has(word)) {
        result.name = word;
        break;
      }
    }

    // Если не нашли, ищем частичное совпадение
    if (!result.name) {
      for (const word of cleanWords) {
        if (word.length < 4) continue;
        for (const [name, _] of this.cardsByName) {
          if (name.includes(word) || word.includes(name)) {
            result.name = name;
            break;
          }
        }
        if (result.name) break;
      }
    }

    // 4. Извлекаем названия атак и способностей
    // Ищем паттерны типа "Ability: Name" или просто капитализированные фразы
    const abilityMatch = fullText.match(/Ability[\s:]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/);
    if (abilityMatch) {
      result.attacks.push(abilityMatch[1].toLowerCase());
    }

    // Ищем двухсловные названия атак (Overdrive Smash, Thunder Shock, etc.)
    const twoWordAttacks = fullText.match(/([A-Z][a-z]+\s+[A-Z][a-z]+)(?=\s|$|\n)/g);
    if (twoWordAttacks) {
      for (const attack of twoWordAttacks) {
        const clean = attack.toLowerCase();
        const skip = ['basic pokemon', 'stage pokemon', 'active spot', 'stadium cards', 'your opponent'];
        if (!skip.some(s => clean.includes(s)) && clean.length > 5) {
          result.attacks.push(clean);
        }
      }
    }

    // Также собираем отдельные длинные слова
    const skipWords = new Set(['basic', 'stage', 'pokemon', 'trainer', 'energy', 'weakness',
                               'resistance', 'retreat', 'cost', 'damage', 'coin', 'flip',
                               'your', 'opponent', 'this', 'that', 'the', 'attack', 'ability',
                               'spatial', 'active', 'stadium', 'cards', 'hand', 'during']);

    const potentialAttacks = words
      .filter(w => {
        const clean = w.replace(/[^a-zA-Z]/g, '').toLowerCase();
        return clean.length > 5 && !skipWords.has(clean) && !/^\d+$/.test(w);
      })
      .map(w => w.replace(/[^a-zA-Z]/g, '').toLowerCase());

    result.attacks = [...new Set([...result.attacks, ...potentialAttacks])];

    console.log('Detected attacks:', result.attacks.slice(0, 5));

    return result;
  }

  /**
   * Главный метод поиска кандидатов
   */
  async findCandidates(words: string[], fullText: string): Promise<any[]> {
    const parsed = this.parseOCRText(fullText, words);
    const candidates: CardCandidate[] = [];

    console.log('Parsed OCR:', { name: parsed.name, hp: parsed.hp, setNumber: parsed.setNumber });

    // Стратегия 1: Если есть HP - начинаем с фильтрации по HP
    let searchPool = this.allCards;

    if (parsed.hp && this.cardsByHP.has(parsed.hp)) {
      searchPool = this.cardsByHP.get(parsed.hp)!;
      console.log(`Filtered by HP ${parsed.hp}: ${searchPool.length} cards`);
    }

    // Стратегия 2: Если нашли имя - ищем точное совпадение
    if (parsed.name && this.cardsByName.has(parsed.name)) {
      let nameMatches = this.cardsByName.get(parsed.name)!;

      // Если есть setNumber - фильтруем по номеру карты в ID
      // setNumber "04/025" → ищем карты где id заканчивается на "-4" или содержит номер
      if (parsed.setNumber) {
        const cardNum = parsed.setNumber.split('/')[0].replace(/^0+/, ''); // "04" → "4"
        const filtered = nameMatches.filter(c => {
          const idNum = c.id.split('-').pop(); // "xy5-4" → "4"
          return idNum === cardNum || c.id.includes(`-${cardNum}`);
        });

        if (filtered.length > 0) {
          console.log(`SetNumber ${parsed.setNumber} narrowed ${nameMatches.length} → ${filtered.length} cards`);
          for (const card of filtered) {
            candidates.push({
              card,
              score: 120, // Очень высокий скор - имя + номер карты
              reasons: [`Exact name: ${parsed.name}`, `Card number match: ${cardNum}`]
            });
          }
          // Если нашли по номеру - можно сразу вернуть
          if (candidates.length > 0) {
            candidates.sort((a, b) => b.score - a.score);
            return candidates.slice(0, 3).map(c => c.card);
          }
        }
      }

      // Если есть и HP и имя - пересекаем
      if (parsed.hp) {
        const intersection = nameMatches.filter(c => parseInt(c.hp) === parsed.hp);
        if (intersection.length > 0) {
          // Отличное совпадение: имя + HP
          for (const card of intersection) {
            candidates.push({
              card,
              score: 100,
              reasons: [`Exact name: ${parsed.name}`, `HP match: ${parsed.hp}`]
            });
          }
        } else {
          // Имя совпало, HP нет - всё равно добавляем с меньшим скором
          for (const card of nameMatches.slice(0, 5)) {
            candidates.push({
              card,
              score: 50,
              reasons: [`Exact name: ${parsed.name}`, `HP mismatch (card: ${card.hp}, OCR: ${parsed.hp})`]
            });
          }
        }
      } else {
        // Только имя, без HP — ранжируем по атакам!
        for (const card of nameMatches) {
          let score = 40;
          const reasons = [`Exact name: ${parsed.name}`];

          // Проверяем атаки для дифференциации
          if (card.caption && parsed.attacks.length > 0) {
            const captionLower = card.caption.toLowerCase();
            for (const attack of parsed.attacks) {
              if (attack.length > 5 && captionLower.includes(attack)) {
                score += 25;
                reasons.push(`Attack: ${attack}`);
              }
            }
          }

          candidates.push({ card, score, reasons });
        }
      }
    }

    // Стратегия 3: Fuzzy поиск по словам в searchPool
    if (candidates.length < 3) {
      const lowerText = fullText.toLowerCase();

      for (const card of searchPool) {
        // Пропускаем уже добавленные
        if (candidates.some(c => c.card.id === card.id)) continue;

        let score = 0;
        const reasons: string[] = [];

        const cardNameLower = card.name.toLowerCase();

        // Проверяем имя в тексте
        if (lowerText.includes(cardNameLower)) {
          score += 30;
          reasons.push(`Name in text: ${card.name}`);
        } else {
          // Частичное совпадение имени
          const nameParts = cardNameLower.split(/\s+/);
          for (const part of nameParts) {
            if (part.length > 3 && lowerText.includes(part)) {
              score += 10;
              reasons.push(`Partial name: ${part}`);
            }
          }
        }

        // HP бонус (если HP совпал, но имя не точное)
        if (parsed.hp && parseInt(card.hp) === parsed.hp) {
          score += 20;
          reasons.push(`HP match: ${parsed.hp}`);
        }

        // Проверяем атаки - ВЫСОКИЙ ПРИОРИТЕТ
        if (card.caption && parsed.attacks.length > 0) {
          const captionLower = card.caption.toLowerCase();
          let attackMatches = 0;
          for (const attack of parsed.attacks) {
            if (attack.length > 5 && captionLower.includes(attack)) {
              attackMatches++;
              score += 25; // Увеличил вес атак
              reasons.push(`Attack: ${attack}`);
            }
          }
          // Бонус за множественные совпадения атак
          if (attackMatches >= 2) {
            score += 30;
            reasons.push(`Multi-attack bonus!`);
          }
        }

        // Проверяем set_name
        if (card.set_name) {
          const setNameWords = card.set_name.toLowerCase().split(/\s+/);
          for (const setWord of setNameWords) {
            if (setWord.length > 4 && lowerText.includes(setWord)) {
              score += 10;
              reasons.push(`Set match: ${setWord}`);
            }
          }
        }

        if (score > 10) {
          candidates.push({ card, score, reasons });
        }
      }
    }

    // Сортируем по скору и возвращаем топ 3
    candidates.sort((a, b) => b.score - a.score);

    const top = candidates.slice(0, 3);

    // Логируем для отладки
    for (const c of top) {
      console.log(`Candidate: ${c.card.name} (${c.card.hp}HP) - Score: ${c.score} - ${c.reasons.join(', ')}`);
    }

    return top.map(c => c.card);
  }

  async getCardById(id: string) {
    return this.allCards.find(c => c.id === id) || null;
  }

  // Для отладки - получить все карты
  getAllCards() {
    return this.allCards;
  }
}

export const databaseService = new DatabaseService();
