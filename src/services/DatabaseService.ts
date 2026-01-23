import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { ZoneResult } from './OCRService';

// Русский маппинг
import ruMapping from '../../assets/ru-mapping.json';

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

  // Русский маппинг
  private ruPokemon: Record<string, string> = ruMapping.pokemon;
  private ruAttacks: Record<string, string> = ruMapping.attacks;

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
   * Парсит OCR текст и извлекает структурированные данные с учётом зон
   */
  parseOCRText(fullText: string, words: string[], zones?: ZoneResult): ParsedOCR {
    const result: ParsedOCR = {
      name: null,
      hp: null,
      setNumber: null,
      words: words,
      attacks: []
    };

    const topText = zones?.topText || fullText.substring(0, Math.floor(fullText.length * 0.3));
    const middleText = zones?.middleText || '';
    const bottomText = zones?.bottomText || '';

    // DEBUG: Логируем зоны
    console.log('ZONE TOP:', topText.replace(/\n/g, ' ').substring(0, 120));
    console.log('ZONE MID:', middleText.replace(/\n/g, ' ').substring(0, 120));
    console.log('ZONE BOT:', bottomText.replace(/\n/g, ' ').substring(0, 80));

    // 1. Извлекаем HP - ищем сначала в верхней зоне, потом в полном тексте
    const hpPatterns = [
      /(\d{2,3})\s*HP/i,
      /HP\s*(\d{2,3})/i,
      /(\d{2,3})\s*H\s*P/i,
      /(\d{2,3})\s*ОЖ/i,
      /ОЖ\s*(\d{2,3})/i,
      /(\d{2,3})\s*О\s*Ж/i,
    ];

    // Приоритет: верхняя зона (там обычно HP)
    const hpSearchTexts = [topText, fullText];
    for (const searchText of hpSearchTexts) {
      if (result.hp) break;
      for (const pattern of hpPatterns) {
        const match = searchText.match(pattern);
        if (match) {
          const hp = parseInt(match[1]);
          if (hp >= 30 && hp <= 340) {
            result.hp = hp;
            break;
          }
        }
      }
    }

    // Fallback: числа кратные 10 в верхней зоне
    if (!result.hp) {
      const numbers = topText.match(/\b(\d{2,3})\b/g);
      if (numbers) {
        for (const numStr of numbers) {
          const num = parseInt(numStr);
          if (num >= 30 && num <= 340 && num % 10 === 0) {
            result.hp = num;
            console.log(`HP from top zone number: ${num}`);
            break;
          }
        }
      }
    }

    // 2. Извлекаем номер сета - приоритет нижняя зона
    const setSearchTexts = [bottomText, fullText];
    for (const searchText of setSearchTexts) {
      if (result.setNumber) break;
      const setMatch = searchText.match(/(\d{1,3})\s*[\/]\s*(\d{2,3})/);
      if (setMatch) {
        result.setNumber = `${setMatch[1]}/${setMatch[2]}`;
      }
    }

    // 3. Извлекаем имя покемона - приоритет верхняя зона
    const topWords = topText.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const allCleanWords = words
      .map(w => w.replace(/[^a-zA-Zа-яёА-ЯЁ\-\.]/g, '').toLowerCase())
      .filter(w => w.length > 2);
    const topCleanWords = topWords
      .map(w => w.replace(/[^a-zA-Zа-яёА-ЯЁ\-\.]/g, '').toLowerCase())
      .filter(w => w.length > 2);

    // Проверяем русские имена (сначала в верхней зоне, потом везде)
    const wordSets = [topCleanWords, allCleanWords];
    for (const wordSet of wordSets) {
      if (result.name) break;
      for (const word of wordSet) {
        if (this.ruPokemon[word]) {
          const englishName = this.ruPokemon[word];
          console.log(`RU→EN: ${word} → ${englishName}`);
          if (this.cardsByName.has(englishName)) {
            result.name = englishName;
            break;
          }
        }
      }
    }

    // Детектируем суффиксы карт по контексту
    let suffix = '';
    const textLower = fullText.toLowerCase();
    if (textLower.includes('team galactic')) suffix = ' g';
    else if (textLower.includes('vmax') || /\bvmax\b/i.test(fullText)) suffix = ' vmax';
    else if (textLower.includes('vstar') || /\bvstar\b/i.test(fullText)) suffix = ' vstar';
    else if (/\bv\b/i.test(fullText) && !textLower.includes('vmax')) suffix = ' v';
    else if (textLower.includes('-gx') || /\bgx\b/i.test(fullText)) suffix = '-gx';
    else if (textLower.includes('-ex') || /\bex\b/i.test(fullText)) suffix = '-ex';
    for (const w of allCleanWords) {
      if (w === 'gx' || w === 'ex' || w === 'vmax' || w === 'vstar') {
        if (!suffix) suffix = w === 'gx' ? '-gx' : w === 'ex' ? '-ex' : ` ${w}`;
      }
    }

    // Ищем точное совпадение (приоритет: верхняя зона, потом все слова)
    if (!result.name) {
      for (const wordSet of [topCleanWords, allCleanWords]) {
        if (result.name) break;
        for (const word of wordSet) {
          if (suffix && this.cardsByName.has(word + suffix)) {
            result.name = word + suffix;
            break;
          }
          if (this.cardsByName.has(word)) {
            result.name = suffix && this.cardsByName.has(word + suffix) ? word + suffix : word;
            break;
          }
        }
      }
    }

    // Частичное совпадение (fallback)
    if (!result.name) {
      for (const word of allCleanWords) {
        if (word.length < 4) continue;
        for (const [name] of this.cardsByName) {
          if (name.includes(word) || word.includes(name)) {
            result.name = name;
            break;
          }
        }
        if (result.name) break;
      }
    }

    // 4. Извлекаем атаки - приоритет средняя зона
    const attackSource = middleText || fullText;

    const abilityMatch = attackSource.match(/Ability[\s:]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/);
    if (abilityMatch) {
      result.attacks.push(abilityMatch[1].toLowerCase());
    }

    // Двухсловные атаки из средней зоны
    const twoWordAttacks = attackSource.match(/([A-Z][a-z]+\s+[A-Z][a-z]+)(?=\s|$|\n)/g);
    if (twoWordAttacks) {
      for (const attack of twoWordAttacks) {
        const clean = attack.toLowerCase();
        const skip = ['basic pokemon', 'stage pokemon', 'active spot', 'stadium cards', 'your opponent'];
        if (!skip.some(s => clean.includes(s)) && clean.length > 5) {
          result.attacks.push(clean);
        }
      }
    }

    // Длинные слова из средней зоны как потенциальные атаки
    const skipWords = new Set(['basic', 'stage', 'pokemon', 'trainer', 'energy', 'weakness',
                               'resistance', 'retreat', 'cost', 'damage', 'coin', 'flip',
                               'your', 'opponent', 'this', 'that', 'the', 'attack', 'ability',
                               'spatial', 'active', 'stadium', 'cards', 'hand', 'during']);

    const midWords = (middleText || fullText).toLowerCase().split(/\s+/);
    const potentialAttacks = midWords
      .filter(w => {
        const clean = w.replace(/[^a-zA-Zа-яёА-ЯЁ]/g, '').toLowerCase();
        return clean.length > 5 && !skipWords.has(clean) && !/^\d+$/.test(w);
      })
      .map(w => w.replace(/[^a-zA-Zа-яёА-ЯЁ]/g, '').toLowerCase());

    result.attacks = [...new Set([...result.attacks, ...potentialAttacks])];

    // Переводим русские атаки
    const translatedAttacks: string[] = [];
    for (const attack of result.attacks) {
      if (this.ruAttacks[attack]) {
        translatedAttacks.push(this.ruAttacks[attack]);
      } else {
        translatedAttacks.push(attack);
      }
    }
    // Проверяем полный текст на русские атаки (многословные)
    for (const [ruAttack, enAttack] of Object.entries(this.ruAttacks)) {
      if (fullText.toLowerCase().includes(ruAttack)) {
        translatedAttacks.push(enAttack);
      }
    }
    result.attacks = [...new Set(translatedAttacks)];

    console.log('Parsed:', { name: result.name, hp: result.hp, set: result.setNumber, attacks: result.attacks.slice(0, 3) });

    return result;
  }

  /**
   * Главный метод поиска кандидатов
   */
  async findCandidates(words: string[], fullText: string, zones?: ZoneResult): Promise<any[]> {
    const parsed = this.parseOCRText(fullText, words, zones);
    const candidates: CardCandidate[] = [];

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
