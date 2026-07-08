/** Raw parsed monster from either game, pre-conversion. */
export interface RawMonster {
  source: 'nethack' | 'incursion';
  rawId: string;       // e.g., "giant_ant" or "white_dragon"
  name: string;        // Display name
  glyph: string;       // Single character
  color: string;       // Source color name (e.g., "CLR_BROWN", "white")
  level: number;       // Challenge level
  hp: number;          // Hit points (raw)
  ac: number;          // Armor class (raw, game-specific semantics)
  speed: number;       // Movement speed (raw, game-specific)
  attacks: string[];   // Raw attack strings
  flags: string[];     // Raw flag strings (e.g., "M1_ANIMAL", "M_FLYER")
  immunities: string[];
  material?: string;   // For Incursion: base material
}

/** Raw parsed item from either game, pre-conversion. */
export interface RawItem {
  source: 'nethack' | 'incursion';
  rawId: string;
  name: string;
  glyph: string;
  color: string;
  category: 'weapon' | 'armor' | 'potion' | 'scroll' | 'ring' | 'amulet' | 'food' | 'tool' | 'wand';
  material: string;
  weight: number;
  cost: number;
  smallDamage?: number;  // Average small-monster damage
  largeDamage?: number;  // Average large-monster damage
  acBonus?: number;      // For armor
  power?: string;        // For rings/amulets: granted power name
  flags: string[];
}

/** Raw parsed static map. */
export interface RawStaticMap {
  source: 'nethack' | 'incursion';
  rawId: string;
  name: string;
  layout: string[];    // Array of ASCII rows
  legend: Record<string, string>;  // char -> source tile/entity name
  placedEntities: { name: string; x: number; y: number }[];
}
