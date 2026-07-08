/** Color mappings for NetHack */
export const NETHACK_COLOR_MAP: Record<string, string> = {
  CLR_BLACK: "#000000",
  CLR_RED: "#FF0000",
  CLR_GREEN: "#008000",
  CLR_BROWN: "#8B4513",
  CLR_BLUE: "#0000FF",
  CLR_MAGENTA: "#FF00FF",
  CLR_CYAN: "#00FFFF",
  CLR_GRAY: "#808080",
  NO_COLOR: "#C0C0C0",
  CLR_ORANGE: "#FFA500",
  CLR_BRIGHT_GREEN: "#00FF00",
  CLR_YELLOW: "#FFFF00",
  CLR_BRIGHT_BLUE: "#00BFFF",
  CLR_BRIGHT_MAGENTA: "#EE82EE",
  CLR_BRIGHT_CYAN: "#E0FFFF",
  CLR_WHITE: "#FFFFFF"
};

/** Glyph mappings for NetHack Monster Classes */
export const NETHACK_GLYPH_MAP: Record<string, string> = {
  S_ANT: "a",
  S_BLOB: "b",
  S_COCKATRICE: "c",
  S_DOG: "d",
  S_EYE: "e",
  S_FELINE: "f",
  S_GREMLIN: "g",
  S_HUMANOID: "h",
  S_IMP: "i",
  S_JELLY: "j",
  S_KOBOLD: "k",
  S_LEPRECHAUN: "l",
  S_MIMIC: "m",
  S_NYMPH: "n",
  S_ORC: "o",
  S_PIERCER: "p",
  S_QUADRUPED: "q",
  S_RODENT: "r",
  S_SPIDER: "s",
  S_TRAPPER: "t",
  S_UNICORN: "u",
  S_VORTEX: "v",
  S_WORM: "w",
  S_XAN: "x",
  S_LIGHT: "y",
  S_ZRUTY: "z",
  S_ANGEL: "A",
  S_BAT: "B",
  S_CENTAUR: "C",
  S_DRAGON: "D",
  S_ELEMENTAL: "E",
  S_FUNGUS: "F",
  S_GNOME: "G",
  S_GIANT: "H",
  S_INVIS: "I",
  S_JABBERWOCK: "J",
  S_KOP: "K",
  S_LICH: "L",
  S_MUMMY: "M",
  S_NAGA: "N",
  S_OGRE: "O",
  S_PUDDING: "P",
  S_QUANTMECH: "Q",
  S_RUSTMONST: "R",
  S_SNAKE: "S",
  S_TROLL: "T",
  S_UMBER: "U",
  S_VAMPIRE: "V",
  S_WRAITH: "W",
  S_XORN: "X",
  S_YETI: "Y",
  S_ZOMBIE: "Z",
  S_HUMAN: "@",
  S_GHOST: " "
};

/** NetHack materials to engine tags */
export const NETHACK_MATERIAL_MAP: Record<string, string[]> = {
  IRON: ["iron", "metal"],
  SILVER: ["silver", "metal"],
  GOLD: ["gold", "metal"],
  MITHRIL: ["mithril", "metal"],
  WOOD: ["wood"],
  BONE: ["bone"],
  LEATHER: ["leather"],
  CLOTH: ["cloth"],
  GLASS: ["glass"],
  GEMSTONE: ["gemstone"],
  PLASTIC: ["plastic"]
};

/** NetHack flags to engine tags */
export const NETHACK_FLAG_MAP: Record<string, string[]> = {
  M1_ANIMAL: ["animal"],
  M1_CARNIVORE: ["carnivore"],
  M1_HERBIVORE: ["herbivore"],
  M1_OMNIVORE: ["carnivore", "herbivore"],
  M1_AMPHIBIOUS: ["amphibious"],
  M1_FLY: ["flyer"],
  M2_DEMON: ["demon"],
  M2_UNDEAD: ["undead"],
  M2_WERE: ["lycanthrope"],
  M2_ELF: ["elf"],
  M2_DWARF: ["dwarf"],
  M2_GNOME: ["gnome"],
  M2_ORC: ["orc"],
  M2_HUMAN: ["human"]
};

/** Color mappings for Incursion */
export const INCURSION_COLOR_MAP: Record<string, string> = {
  white: "#FFFFFF",
  black: "#000000",
  red: "#FF0000",
  green: "#008000",
  blue: "#0000FF",
  cyan: "#00FFFF",
  magenta: "#FF00FF",
  yellow: "#FFFF00",
  gray: "#808080",
  brown: "#8B4513",
  orange: "#FFA500"
};

/** Incursion flags to engine tags */
export const INCURSION_FLAG_MAP: Record<string, string[]> = {
  M_FLYER: ["flyer"],
  M_UNDEAD: ["undead"],
  M_EVIL: ["evil"],
  M_CHAOTIC: ["chaotic"],
  M_GOOD: ["good"],
  M_LAWFUL: ["lawful"],
  M_ANIMAL: ["animal"],
  M_CARNI: ["carnivore"],
  M_HERBI: ["herbivore"]
};

/** Incursion materials to tags */
export const INCURSION_MATERIAL_MAP: Record<string, string[]> = {
  MAT_IRON: ["iron", "metal"],
  MAT_SILVER: ["silver", "metal"],
  MAT_ADAMANT: ["adamantium", "metal"],
  MAT_MITHRIL: ["mithril", "metal"],
  MAT_DARKWOOD: ["darkwood", "wood"],
  MAT_WOOD: ["wood"],
  MAT_BONE: ["bone"],
  MAT_GLASS: ["glass"],
  MAT_CLOTH: ["cloth"],
  MAT_LEATHER: ["leather"]
};
