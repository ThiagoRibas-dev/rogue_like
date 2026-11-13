import { getComponent } from '../core/ecs.ts';
import { getHoverState } from '../core/hover_state.ts';
import { getActiveRuleset } from '../rulesets/registry.ts';
import {
  ComponentType,
  type ChronicleComponent,
  type CompanionStance,
  type ControllerLinkComponent,
  type FieldComponent,
  type FighterComponent,
  type IdentityComponent,
  type ItemComponent,
  type LockComponent,
  type MemoryComponent,
  type NemesisComponent,
  type PortalComponent,
  type ShopComponent,
  type TemplateComponent
} from '../types/components.types.ts';
import { type EntityId, type GameState, UIMode } from '../types/game-state.types.ts';
import { coordToIndex } from '../utils/grid.ts';
import { getEffectiveStats } from '../utils/stats.ts';
import { FACET_DOMINANT_HIGH_THRESHOLD, FACET_DOMINANT_LOW_THRESHOLD } from '../constants/personality.constants.ts';
import type { InspectSectionDTO, InspectTooltipDTO } from './viewport_snapshot.types.ts';

/** Default patience threshold when none is explicitly set on a MemoryComponent. */
const DEFAULT_PATIENCE_THRESHOLD = 5;

const STANCE_TOOLTIP_LABELS: Readonly<Record<CompanionStance, string>> = {
  aggressive: 'Aggressive',
  defensive: 'Defensive',
  passive: 'Passive',
  hold: 'Hold Position'
};

/**
 * Resolves the human-readable display name for any entity reactively from its ECS components
 * (`IdentityComponent`, `ItemComponent`, `FieldComponent`, `TemplateComponent`, `PortalComponent`).
 *
 * @param state The current GameState.
 * @param entityId The target entity ID.
 * @returns The resolved display name string.
 */
export function resolveEntityDisplayName(state: GameState, entityId: EntityId): string {
  const identity = getComponent(state, entityId, ComponentType.Identity) as IdentityComponent | undefined;
  if (identity) {
    return `${identity.name} ${identity.title ?? ''}`.trim();
  }

  const item = getComponent(state, entityId, ComponentType.Item) as ItemComponent | undefined;
  if (item) {
    const itemDef = state.campaign.items[item.itemId];
    const isIdentified = state.identifiedItems.has(item.itemId);
    const resolvedItemName = isIdentified
      ? itemDef?.name
      : (state.itemUnidentifiedNames.get(item.itemId) ?? itemDef?.unidentifiedName ?? item.itemId);
    return resolvedItemName || 'Item';
  }

  const field = getComponent(state, entityId, ComponentType.Field) as FieldComponent | undefined;
  if (field) {
    return state.campaign.fields[field.fieldType]?.name ?? field.fieldType;
  }

  const template = getComponent(state, entityId, ComponentType.Template) as TemplateComponent | undefined;
  if (template) {
    const templateDef = state.campaign.entities[template.templateId];
    if (templateDef?.name) {
      return templateDef.name;
    }
  }

  const portal = getComponent(state, entityId, ComponentType.Portal) as PortalComponent | undefined;
  if (portal) {
    const targetAreaName = state.campaign.areas[portal.targetAreaId]?.name ?? portal.targetAreaId;
    return `Passage (${targetAreaName})`;
  }

  return getComponent(state, entityId, ComponentType.Actor) ? 'Actor' : 'Feature';
}

/**
 * Appends component-reactive inspection sections for a single entity onto `sections`.
 *
 * @param state The current GameState.
 * @param entityId The inspected entity ID.
 * @param sections Mutable array of InspectSectionDTOs being constructed.
 */
function appendEntityComponentSections(state: GameState, entityId: EntityId, sections: InspectSectionDTO[]): void {
  const fighter = getComponent(state, entityId, ComponentType.Fighter) as FighterComponent | undefined;
  if (fighter) {
    const stats = getEffectiveStats(state, entityId);
    sections.push({ type: 'stat', label: 'HP', value: `${fighter.hp}/${stats.maxHp}` });
    sections.push({ type: 'stat', label: 'ATK', value: `${stats.attack}` });
    sections.push({ type: 'stat', label: 'DEF', value: `${stats.defense}` });
  }

  const item = getComponent(state, entityId, ComponentType.Item) as ItemComponent | undefined;
  if (item) {
    const itemDef = state.campaign.items[item.itemId];
    if (itemDef?.description && state.identifiedItems.has(item.itemId)) {
      sections.push({ type: 'desc', value: itemDef.description });
    }
  }

  const field = getComponent(state, entityId, ComponentType.Field) as FieldComponent | undefined;
  if (field) {
    const fieldDef = state.campaign.fields[field.fieldType];
    if (fieldDef?.damagePerTurn) {
      sections.push({ type: 'stat', label: 'Damage/Turn', value: `${fieldDef.damagePerTurn}`, color: '#ff4444' });
    }
  }

  const portal = getComponent(state, entityId, ComponentType.Portal) as PortalComponent | undefined;
  if (portal) {
    const targetAreaName = state.campaign.areas[portal.targetAreaId]?.name ?? portal.targetAreaId;
    sections.push({ type: 'stat', label: 'Destination', value: targetAreaName });
  }

  const lock = getComponent(state, entityId, ComponentType.Lock) as LockComponent | undefined;
  if (lock) {
    const lockStateLabel = lock.jammed ? 'Jammed' : lock.locked ? 'Locked' : 'Unlocked';
    sections.push({
      type: 'stat',
      label: 'Status',
      value: lockStateLabel,
      color: lock.locked || lock.jammed ? '#e6a23c' : '#2ed573'
    });
  }

  const shop = getComponent(state, entityId, ComponentType.Shop) as ShopComponent | undefined;
  if (shop) {
    sections.push({ type: 'stat', label: 'Merchant Stock', value: `${shop.inventory.length} items` });
  }

  const memory = getComponent(state, entityId, ComponentType.Memory) as MemoryComponent | undefined;
  if (memory) {
    if (memory.stress !== undefined && memory.stress > 0) {
      sections.push({ type: 'stat', label: 'Stress', value: `${Math.floor(memory.stress)}`, color: '#ffaa00' });
    }
    if (memory.facets) {
      const dominant = Object.entries(memory.facets).filter(
        ([_, v]) => v >= FACET_DOMINANT_HIGH_THRESHOLD || v <= FACET_DOMINANT_LOW_THRESHOLD
      );
      if (dominant.length > 0) {
        sections.push({
          type: 'desc',
          value: 'Traits: ' + dominant.map(([k, v]) => `${k} (${v})`).join(', '),
          color: '#ff6666'
        });
      }
    }

    if (state.uiMode === UIMode.Debug) {
      sections.push({
        type: 'stat',
        label: 'Talk/Trd/Intm/Hlp/Btr',
        value: `${memory.timesTalked ?? 0}/${memory.timesTraded ?? 0}/${memory.timesIntimidated ?? 0}/${memory.timesHelped ?? 0}/${memory.timesBetrayed ?? 0}`,
        color: '#8888ff'
      });
    }

    const threshold = memory.patienceThreshold ?? DEFAULT_PATIENCE_THRESHOLD;
    const remainingPatience = threshold - (memory.timesTalked ?? 0);
    sections.push({ type: 'stat', label: 'Patience', value: `${remainingPatience}/${threshold}` });

    if ((memory.annoyedDuration ?? 0) > 0) {
      sections.push({ type: 'desc', value: `Annoyed (${memory.annoyedDuration} turns remaining)`, color: '#ffaa00' });
    }
    if ((memory.gratefulDuration ?? 0) > 0) {
      sections.push({ type: 'desc', value: `Grateful (${memory.gratefulDuration} turns remaining)`, color: '#00ffaa' });
    }

    if (memory.relationshipAxes) {
      for (const [axis, value] of Object.entries(memory.relationshipAxes)) {
        if (value !== 0) {
          const formattedAxis = axis.charAt(0).toUpperCase() + axis.slice(1);
          sections.push({
            type: 'stat',
            label: formattedAxis,
            value: `${value > 0 ? '+' : ''}${value}`,
            color: value > 0 ? '#00ffaa' : '#ff4444'
          });
        }
      }
    }

    const knowledgeKeys = Object.keys(memory.knowledge ?? {});
    if (knowledgeKeys.length > 0) {
      sections.push({ type: 'desc', value: 'Knowledge: ' + knowledgeKeys.join(', '), color: '#55ff55' });
    }
  }

  const nemesis = getComponent(state, entityId, ComponentType.Nemesis) as NemesisComponent | undefined;
  if (nemesis) {
    const rankDef = state.campaign.nemesisHierarchies[nemesis.hierarchyId]?.ranks.find(
      (r) => r.rankId === nemesis.rankId
    );
    if (rankDef) {
      sections.push({ type: 'desc', value: `${rankDef.displayName} (Tier ${nemesis.tier})`, color: '#f1c40f' });
    }
  }

  const isActor = getComponent(state, entityId, ComponentType.Actor) !== undefined;
  if (fighter || isActor) {
    const activeRuleset = getActiveRuleset(state);
    if (activeRuleset.projectInspectLoreLines) {
      for (const loreLine of activeRuleset.projectInspectLoreLines(state, entityId)) {
        sections.push({ type: 'desc', value: loreLine.value, color: loreLine.color });
      }
    }
  }

  const controllerLink = getComponent(state, entityId, ComponentType.ControllerLink) as
    ControllerLinkComponent | undefined;
  if (controllerLink) {
    const stance = controllerLink.stance ?? 'defensive';
    sections.push({
      type: 'stat',
      label: 'Stance',
      value: STANCE_TOOLTIP_LABELS[stance],
      color: '#88ccff'
    });
    if (controllerLink.commandTargetId !== undefined) {
      sections.push({
        type: 'stat',
        label: 'Target',
        value: resolveEntityDisplayName(state, controllerLink.commandTargetId),
        color: '#ffaa44'
      });
    }
  }

  const chronicle = getComponent(state, entityId, ComponentType.Chronicle) as ChronicleComponent | undefined;
  if (chronicle && chronicle.scars.length > 0) {
    sections.push({ type: 'desc', value: `Scars: ${chronicle.scars.join(', ')}`, color: '#e74c3c' });
  }
  if (chronicle && chronicle.eventExcerpts.length > 0) {
    const latestEventId = chronicle.eventExcerpts[chronicle.eventExcerpts.length - 1];
    const latestEvent = state.historicalLedger.find((e) => e.id === latestEventId);
    if (latestEvent && latestEvent.summary) {
      sections.push({ type: 'desc', value: `Latest: ${latestEvent.summary}`, color: '#bdc3c7' });
    }
  }
}

/**
 * Builds the presentational inspect tooltip DTO from inspectMode or transient pointer hover state.
 */
export function buildInspectTooltip(
  state: GameState,
  cameraX: number,
  cameraY: number,
  viewportW: number,
  viewportH: number
): InspectTooltipDTO {
  const hovered = getHoverState().hoveredTile;
  const isKeyboardInspect = Boolean(state.inspectMode?.active);
  const ix = isKeyboardInspect ? state.inspectMode!.x : hovered?.x;
  const iy = isKeyboardInspect ? state.inspectMode!.y : hovered?.y;

  if (ix === undefined || iy === undefined) {
    return { active: false, vx: 0, vy: 0, sections: [] };
  }

  const vx = ix - cameraX;
  const vy = iy - cameraY;

  if (vx < 0 || vx >= viewportW || vy < 0 || vy >= viewportH) {
    return { active: false, vx, vy, sections: [] };
  }

  const idx = coordToIndex(ix, iy, state.map.width);
  const tile = state.map.tiles[idx];
  if (!tile || (!tile.explored && !state.map.isFullyExplored)) {
    return { active: false, vx, vy, sections: [] };
  }

  const sections: InspectSectionDTO[] = [];
  const entitiesAt = state.spatialIndex.get(`${ix},${iy}`) || [];

  const sortedEntities = [...entitiesAt].sort((a, b) => {
    const aActor = getComponent(state, a, ComponentType.Actor) ? 1 : 0;
    const bActor = getComponent(state, b, ComponentType.Actor) ? 1 : 0;
    return bActor - aActor;
  });

  for (const entityId of sortedEntities) {
    const renderable = getComponent(state, entityId, ComponentType.Renderable);
    if (!renderable) continue;

    const displayName = resolveEntityDisplayName(state, entityId);
    sections.push({
      type: 'header',
      value: `${renderable.glyph} ${displayName}`
    });

    appendEntityComponentSections(state, entityId, sections);
  }

  if (sections.length === 0) {
    const tileDef = state.campaign.tiles[tile.tileId];
    if (tileDef) {
      const formattedName = tile.tileId
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      sections.push({
        type: 'header',
        value: `${tileDef.glyph} ${formattedName}`
      });
    }
  }

  if (sections.length === 0) {
    sections.push({
      type: 'desc',
      value: 'Nothing inspected.'
    });
  }

  return {
    active: true,
    showFloatingBox: isKeyboardInspect,
    vx,
    vy,
    sections
  };
}
