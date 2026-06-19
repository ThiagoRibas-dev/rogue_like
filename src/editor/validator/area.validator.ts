import type { CampaignData } from '../../types/campaign.types.ts';
import type { ValidationError } from './validator.types.ts';

/**
 * Validates area definitions, particularly static map layouts and procedural connections.
 */
export async function validateAreas(campaign: Readonly<CampaignData>): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];

  if (!campaign.areas) return errors;

  for (const [areaId, area] of Object.entries(campaign.areas)) {
    if (!area) continue;

    // Procedural direction check
    if (area.generatorType === 'digger' || area.generatorType === 'cellular') {
      if (area.connections) {
        area.connections.forEach((conn, cIdx) => {
          if (conn.direction === 'edge') {
            // Edge transitions are now supported in procedural generation
          }
          if (conn.direction === 'portal') {
            if (
              conn.portalTemplateId &&
              !campaign.entities[conn.portalTemplateId] &&
              !campaign.items[conn.portalTemplateId]
            ) {
              errors.push({
                severity: 'error',
                path: `/areas/${areaId}/connections/${cIdx}/portalTemplateId`,
                message: `Portal template ID '${conn.portalTemplateId}' not found in entities or items registry.`
              });
            }
          }
        });
      }
    }

    // Static Map validation
    if (area.generatorType === 'static' && area.staticMap) {
      const { layout, legend, entityLegend = {} } = area.staticMap;
      if (!layout || layout.length === 0) continue;

      const rowLength = layout.reduce((max, row) => Math.max(max, row.length), 0);

      for (let y = 0; y < layout.length; y++) {
        const row = layout[y] || '';

        // 1. Check Row Length Consistency
        // We output a warning since the engine supports dynamic row lengths, but it could be a typo.
        if (row.length !== rowLength) {
          errors.push({
            severity: 'warning',
            path: `/areas/${areaId}/staticMap/layout/${y}`,
            message: `Row length mismatch. Row ${y} has length ${row.length} (max ${rowLength}). This is supported but might be a typo.`
          });
        }

        for (let x = 0; x < row.length; x++) {
          const char = row[x]!;
          if (char === ' ') continue; // Ignore empty spaces

          // 2. Check for Legend Omissions
          const hasTile = legend[char] !== undefined;
          const hasEntity = entityLegend[char] !== undefined;

          if (!hasTile && !hasEntity) {
            errors.push({
              severity: 'error',
              path: `/areas/${areaId}/staticMap/layout/${y}/${x}`,
              message: `Layout character '${char}' at (${x}, ${y}) is not defined in legend or entityLegend.`
            });
          }

          // 3. Check if statically placed actors are standing on walls
          const targetTileId = legend[char];
          let isWall = false;
          if (targetTileId) {
            const tileDef = campaign.tiles[targetTileId];
            if (!tileDef || !tileDef.walkable) {
              isWall = true;
            }
          }

          if (isWall) {
            const hasPlacedEntity = area.placedEntities?.some((ent) => ent.x === x && ent.y === y);
            if (hasPlacedEntity) {
              errors.push({
                severity: 'error',
                path: `/areas/${areaId}/placedEntities`,
                message: `Placed entity at (${x}, ${y}) stands on an unmapped or solid wall character '${char}'.`
              });
            }
          }
        }
      }

      // 4. Check Portal Coordinates Walkability
      if (area.connections) {
        area.connections.forEach((conn, cIdx) => {
          if (conn.placementX !== undefined && conn.placementY !== undefined) {
            const charAtCoord = layout[conn.placementY]?.[conn.placementX];
            if (charAtCoord !== undefined) {
              const mappedTile = legend[charAtCoord];
              let isWall = false;
              if (mappedTile) {
                const tileDef = campaign.tiles[mappedTile];
                if (!tileDef || !tileDef.walkable) {
                  isWall = true;
                }
              } else if (charAtCoord === ' ') {
                isWall = true; // Empty space is unwalkable
              }

              if (isWall) {
                errors.push({
                  severity: 'error',
                  path: `/areas/${areaId}/connections/${cIdx}`,
                  message: `Portal connection exit at (${conn.placementX}, ${conn.placementY}) is placed on a solid wall or unmapped character '${charAtCoord}'.`
                });
              }
            } else {
              errors.push({
                severity: 'error',
                path: `/areas/${areaId}/connections/${cIdx}`,
                message: `Portal connection exit at (${conn.placementX}, ${conn.placementY}) is outside the layout bounds.`
              });
            }
          }
        });
      }
    }
  }

  return errors;
}
