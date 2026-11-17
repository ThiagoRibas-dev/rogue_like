import type { CurrencyConfig } from '../../types/campaign.types.ts';

/** Number of copper pieces (cp) in one silver piece (sp) (PHB p. 112). */
export const DND35E_CP_PER_SP = 10;

/** Number of copper pieces (cp) in one electrum piece (ep). */
export const DND35E_CP_PER_EP = 50;

/** Number of copper pieces (cp) in one gold piece (gp) (PHB p. 112). */
export const DND35E_CP_PER_GP = 100;

/** Number of copper pieces (cp) in one platinum piece (pp) (PHB p. 112). */
export const DND35E_CP_PER_PP = 1000;

/**
 * Canonical D&D 3.5e SRD monetary configuration expressed in copper pieces (`cp`) as the base unit.
 * Standard exchange rates: `1 pp = 10 gp = 20 ep = 100 sp = 1000 cp` (PHB p. 112).
 */
export const DND35E_DEFAULT_CURRENCY_CONFIG: CurrencyConfig = {
  baseUnitId: 'cp',
  defaultValueDenominationId: 'gp',
  displayOrder: ['pp', 'gp', 'ep', 'sp', 'cp'],
  denominations: [
    {
      id: 'cp',
      name: 'Copper Piece',
      abbreviation: 'cp',
      baseMultiplier: 1,
      color: '#b87333',
      itemId: 'copper_coin'
    },
    {
      id: 'sp',
      name: 'Silver Piece',
      abbreviation: 'sp',
      baseMultiplier: DND35E_CP_PER_SP,
      color: '#bdc3c7',
      itemId: 'silver_coin'
    },
    {
      id: 'ep',
      name: 'Electrum Piece',
      abbreviation: 'ep',
      baseMultiplier: DND35E_CP_PER_EP,
      color: '#d4e6f1',
      itemId: 'electrum_coin'
    },
    {
      id: 'gp',
      name: 'Gold Piece',
      abbreviation: 'gp',
      baseMultiplier: DND35E_CP_PER_GP,
      color: '#f1c40f',
      itemId: 'gold_coin'
    },
    {
      id: 'pp',
      name: 'Platinum Piece',
      abbreviation: 'pp',
      baseMultiplier: DND35E_CP_PER_PP,
      color: '#ecf0f1',
      itemId: 'platinum_coin'
    }
  ]
};
