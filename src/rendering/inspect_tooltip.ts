import { getComponent } from '../core/ecs.ts';
import { getHoverState } from '../core/hover_state.ts';
import { getActiveRuleset } from '../rulesets/registry.ts';
import {
  ComponentType,
  type ChronicleComponent,
  type IdentityComponent,
  type MemoryComponent,
  type NemesisComponent
} from '../types/components.types.ts';
import { type GameState, UIMode } from '../types/game-state.types.ts';
import { coordToIndex } from '../utils/grid.ts';
import { getEffectiveStats } from '../utils/stats.ts';
import { FACET_DOMINANT_HIGH_THRESHOLD, FACET_DOMINANT_LOW_THRESHOLD } from '../constants/personality.constants.ts';
import type { InspectSectionDTO, InspectTooltipDTO } from './viewport_snapshot.types.ts';

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

    const fighter = getComponent(state, entityId, ComponentType.Fighter);
    const item = getComponent(state, entityId, ComponentType.Item);

    if (fighter) {
      const identity = getComponent(state, entityId, ComponentType.Identity) as IdentityComponent | undefined;
      const nameStr = identity ? `${identity.name} ${identity.title ?? ''}`.trim() : 'Actor';

      sections.push({
        type: 'header',
        value: `${renderable.glyph} ${nameStr}`
      });

      const stats = getEffectiveStats(state, entityId);
      sections.push({
        type: 'stat',
        label: 'HP',
        value: `${fighter.hp}/${stats.maxHp}`
      });
      sections.push({
        type: 'stat',
        label: 'ATK',
        value: `${stats.attack}`
      });
      sections.push({
        type: 'stat',
        label: 'DEF',
        value: `${stats.defense}`
      });

      const memory = getComponent(state, entityId, ComponentType.Memory) as MemoryComponent | undefined;
      if (memory) {
        if (memory.stress !== undefined && memory.stress > 0) {
          sections.push({
            type: 'stat',
            label: 'Stress',
            value: `${Math.floor(memory.stress)}`,
            color: '#ffaa00'
          });
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

        const remainingPatience = (memory.patienceThreshold ?? 5) - (memory.timesTalked ?? 0);
        sections.push({
          type: 'stat',
          label: 'Patience',
          value: `${remainingPatience}/${memory.patienceThreshold ?? 5}`
        });

        if ((memory.annoyedDuration ?? 0) > 0) {
          sections.push({
            type: 'desc',
            value: `Annoyed (${memory.annoyedDuration} turns remaining)`,
            color: '#ffaa00'
          });
        }
        if ((memory.gratefulDuration ?? 0) > 0) {
          sections.push({
            type: 'desc',
            value: `Grateful (${memory.gratefulDuration} turns remaining)`,
            color: '#00ffaa'
          });
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
          sections.push({
            type: 'desc',
            value: 'Knowledge: ' + knowledgeKeys.join(', '),
            color: '#55ff55'
          });
        }
      }

      const nemesis = getComponent(state, entityId, ComponentType.Nemesis) as NemesisComponent | undefined;
      if (nemesis) {
        const rankDef = state.campaign.nemesisHierarchies[nemesis.hierarchyId]?.ranks.find(
          (r) => r.rankId === nemesis.rankId
        );
        if (rankDef) {
          sections.push({
            type: 'desc',
            value: `${rankDef.displayName} (Tier ${nemesis.tier})`,
            color: '#f1c40f'
          });
        }
      }

      const activeRuleset = getActiveRuleset(state);
      if (activeRuleset.projectInspectLoreLines) {
        for (const loreLine of activeRuleset.projectInspectLoreLines(state, entityId)) {
          sections.push({
            type: 'desc',
            value: loreLine.value,
            color: loreLine.color
          });
        }
      }

      const chronicle = getComponent(state, entityId, ComponentType.Chronicle) as ChronicleComponent | undefined;
      if (chronicle && chronicle.scars.length > 0) {
        sections.push({
          type: 'desc',
          value: `Scars: ${chronicle.scars.join(', ')}`,
          color: '#e74c3c'
        });
      }
      if (chronicle && chronicle.eventExcerpts.length > 0) {
        const latestEventId = chronicle.eventExcerpts[chronicle.eventExcerpts.length - 1];
        const latestEvent = state.historicalLedger.find((e) => e.id === latestEventId);
        if (latestEvent && latestEvent.summary) {
          sections.push({
            type: 'desc',
            value: `Latest: ${latestEvent.summary}`,
            color: '#bdc3c7'
          });
        }
      }
    } else if (item) {
      const itemDef = state.campaign.items[item.itemId];
      const isIdentified = state.identifiedItems.has(item.itemId);
      const name = isIdentified
        ? itemDef?.name
        : (state.itemUnidentifiedNames.get(item.itemId) ?? itemDef?.unidentifiedName ?? item.itemId);

      sections.push({
        type: 'header',
        value: `${renderable.glyph} ${name || 'Item'}`
      });

      if (itemDef?.description && isIdentified) {
        sections.push({
          type: 'desc',
          value: itemDef.description
        });
      }
    } else {
      sections.push({
        type: 'header',
        value: `${renderable.glyph} Feature`
      });
    }
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
