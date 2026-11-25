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

    if (area.generatorType !== 'streaming_overworld') {
      area.placedEntities?.forEach((ent, eIdx) => {
        if (ent.x < 0 || ent.y < 0) {
          errors.push({
            severity: 'error',
            path: `/areas/${areaId}/placedEntities/${eIdx}`,
            message: `Placed entity '${ent.templateId}' at (${ent.x}, ${ent.y}) cannot have negative coordinates in finite area '${areaId}'.`,
            fixSuggestion: 'Use non-negative (x, y) coordinates inside the finite map bounds.'
          });
        }
      });
    }

    area.connections?.forEach((conn, cIdx) => {
      if (
        area.generatorType !== 'streaming_overworld' &&
        ((conn.placementX !== undefined && conn.placementX < 0) ||
          (conn.placementY !== undefined && conn.placementY < 0))
      ) {
        errors.push({
          severity: 'error',
          path: `/areas/${areaId}/connections/${cIdx}`,
          message: `Connection placement (${conn.placementX ?? 0}, ${conn.placementY ?? 0}) cannot be negative in finite area '${areaId}'.`,
          fixSuggestion: 'Use non-negative placementX/placementY coordinates.'
        });
      }
      const targetArea = campaign.areas[conn.targetAreaId];
      if (
        targetArea &&
        targetArea.generatorType !== 'streaming_overworld' &&
        ((conn.targetX !== undefined && conn.targetX < 0) || (conn.targetY !== undefined && conn.targetY < 0))
      ) {
        errors.push({
          severity: 'error',
          path: `/areas/${areaId}/connections/${cIdx}`,
          message: `Connection target coordinates (${conn.targetX ?? 0}, ${conn.targetY ?? 0}) cannot be negative for finite area '${conn.targetAreaId}'.`,
          fixSuggestion: 'Use non-negative targetX/targetY coordinates or target a streaming_overworld area.'
        });
      }
    });

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
                message: `Portal template ID '${conn.portalTemplateId}' not found in entities or items registry.`,
                fixSuggestion: `Create an entity or item with ID "${conn.portalTemplateId}", or select an existing one.`
              });
            }
          }
        });
      }
    }

    // Streaming Overworld check
    if (area.generatorType === 'streaming_overworld') {
      if (!area.streamingConfig) {
        errors.push({
          severity: 'error',
          path: `/areas/${areaId}/streamingConfig`,
          message: `Streaming overworld area '${areaId}' requires a 'streamingConfig' block.`,
          fixSuggestion: 'Add streamingConfig with chunkSize, worldSeed, and biomePalette tile mappings.'
        });
      } else {
        const cfg = area.streamingConfig;
        if (cfg.prefetchRadiusChunks < cfg.activeRadiusChunks) {
          errors.push({
            severity: 'error',
            path: `/areas/${areaId}/streamingConfig/prefetchRadiusChunks`,
            message: `prefetchRadiusChunks (${cfg.prefetchRadiusChunks}) must be >= activeRadiusChunks (${cfg.activeRadiusChunks}).`,
            fixSuggestion: 'Increase prefetchRadiusChunks so Ring 1 surrounds Ring 0.'
          });
        }
        if (cfg.minZ !== undefined && cfg.maxZ !== undefined && cfg.minZ > cfg.maxZ) {
          errors.push({
            severity: 'error',
            path: `/areas/${areaId}/streamingConfig/minZ`,
            message: `Streaming minZ (${cfg.minZ}) cannot exceed maxZ (${cfg.maxZ}).`,
            fixSuggestion: 'Set minZ <= maxZ.'
          });
        }
        const palette = cfg.biomePalette;
        const paletteEntries: ReadonlyArray<readonly [string, string | undefined]> = [
          ['water', palette.water],
          ['shore', palette.shore],
          ['plains', palette.plains],
          ['forest', palette.forest],
          ['ridge', palette.ridge],
          ['road', palette.road],
          ['openAir', palette.openAir],
          ['underground', palette.underground],
          ['ramp', palette.ramp]
        ];
        for (const [slot, tileId] of paletteEntries) {
          if (tileId !== undefined && !campaign.tiles[tileId]) {
            errors.push({
              severity: 'error',
              path: `/areas/${areaId}/streamingConfig/biomePalette/${slot}`,
              message: `Streaming biomePalette.${slot} references missing tile '${tileId}'.`,
              fixSuggestion: `Register tile '${tileId}' in tiles.json or point biomePalette.${slot} to an existing tile.`
            });
          }
        }
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
            message: `Row length mismatch. Row ${y} has length ${row.length} (max ${rowLength}). This is supported but might be a typo.`,
            fixSuggestion: 'Pad this row with spaces or characters so it matches the length of other rows.'
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
              message: `Layout character '${char}' at (${x}, ${y}) is not defined in legend or entityLegend.`,
              fixSuggestion: `Add '${char}' to the staticMap legend (for tiles) or entityLegend (for entities).`
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
                message: `Placed entity at (${x}, ${y}) stands on an unmapped or solid wall character '${char}'.`,
                fixSuggestion: `Move the entity, or change the tile mapping of '${char}' to reference a walkable tile.`
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
                  message: `Portal connection exit at (${conn.placementX}, ${conn.placementY}) is placed on a solid wall or unmapped character '${charAtCoord}'.`,
                  fixSuggestion: `Change placementX/placementY to walkable coordinates, or change '${charAtCoord}' to be walkable.`
                });
              }
            } else {
              errors.push({
                severity: 'error',
                path: `/areas/${areaId}/connections/${cIdx}`,
                message: `Portal connection exit at (${conn.placementX}, ${conn.placementY}) is outside the layout bounds.`,
                fixSuggestion: `Make sure placementX/placementY coordinates are within the static map dimensions (width/height).`
              });
            }
          }
          if (conn.preserveCoords === true && conn.placementX !== undefined && conn.placementY !== undefined) {
            const targetArea = campaign.areas[conn.targetAreaId];
            if (targetArea?.generatorType === 'static' && targetArea.staticMap) {
              const targetLayout =
                conn.targetZ !== undefined && conn.targetZ !== 0
                  ? targetArea.staticMap.zLevels?.[String(conn.targetZ)]
                  : targetArea.staticMap.layout;
              if (targetLayout) {
                const targetChar = targetLayout[conn.placementY]?.[conn.placementX];
                if (targetChar === undefined) {
                  errors.push({
                    severity: 'error',
                    path: `/areas/${areaId}/connections/${cIdx}/preserveCoords`,
                    message: `preserveCoords connection (${conn.placementX}, ${conn.placementY}) falls outside static target area '${conn.targetAreaId}' bounds.`,
                    fixSuggestion: `Align '${conn.targetAreaId}' map dimensions or disable preserveCoords.`
                  });
                } else {
                  const targetTileId = targetArea.staticMap.legend[targetChar];
                  if (targetTileId && !campaign.tiles[targetTileId]?.walkable) {
                    errors.push({
                      severity: 'error',
                      path: `/areas/${areaId}/connections/${cIdx}/preserveCoords`,
                      message: `preserveCoords connection (${conn.placementX}, ${conn.placementY}) lands on unwalkable tile '${targetTileId}' in '${conn.targetAreaId}'.`,
                      fixSuggestion: `Place a matching stair/floor tile at (${conn.placementX}, ${conn.placementY}) in '${conn.targetAreaId}'.`
                    });
                  }
                }
              }
            }
          }
        });
      }

      // 5. Multi-Z slice & vertical shaft alignment validation
      if (area.staticMap.zLevels) {
        const allSlices: Record<string, ReadonlyArray<string>> = {
          '0': layout
        };
        for (const [zStr, sliceLayout] of Object.entries(area.staticMap.zLevels)) {
          const zNum = Number(zStr);
          if (!Number.isInteger(zNum)) {
            errors.push({
              severity: 'error',
              path: `/areas/${areaId}/staticMap/zLevels/${zStr}`,
              message: `zLevels key '${zStr}' must be an integer string.`,
              fixSuggestion: 'Use integer strings like "-1" or "1".'
            });
            continue;
          }
          allSlices[zStr] = sliceLayout;

          for (let sy = 0; sy < sliceLayout.length; sy++) {
            const sRow = sliceLayout[sy] ?? '';
            for (let sx = 0; sx < sRow.length; sx++) {
              const ch = sRow[sx]!;
              if (ch === ' ') continue;
              if (legend[ch] === undefined && entityLegend[ch] === undefined) {
                errors.push({
                  severity: 'error',
                  path: `/areas/${areaId}/staticMap/zLevels/${zStr}/layout/${sy}/${sx}`,
                  message: `Layout character '${ch}' at (${sx}, ${sy}, ${zStr}) is not defined in legend or entityLegend.`,
                  fixSuggestion: `Add '${ch}' to staticMap.legend or entityLegend.`
                });
              }
            }
          }
        }

        for (const [zStr, sliceLayout] of Object.entries(allSlices)) {
          const z = Number(zStr);
          const lowerSlice = allSlices[String(z - 1)];
          if (!lowerSlice) continue;
          for (let sy = 0; sy < sliceLayout.length; sy++) {
            const sRow = sliceLayout[sy] ?? '';
            for (let sx = 0; sx < sRow.length; sx++) {
              const ch = sRow[sx]!;
              const tid = legend[ch];
              const def = tid ? campaign.tiles[tid] : undefined;
              if (
                def?.verticalLink === 'stairs_down' ||
                def?.verticalLink === 'stairs_both' ||
                def?.verticalLink === 'ladder'
              ) {
                const lowerCh = lowerSlice[sy]?.[sx] ?? ' ';
                const lowerTid = legend[lowerCh];
                const lowerDef = lowerTid ? campaign.tiles[lowerTid] : undefined;
                if (
                  lowerDef &&
                  !lowerDef.walkable &&
                  !lowerDef.isOpenAir &&
                  lowerDef.verticalLink === undefined &&
                  lowerDef.isClimbable !== true
                ) {
                  errors.push({
                    severity: 'warning',
                    path: `/areas/${areaId}/staticMap/zLevels/${zStr}`,
                    message: `Vertical stair/ladder '${tid}' at (${sx}, ${sy}, ${z}) sits directly above solid tile '${lowerTid}' on z=${z - 1}.`,
                    fixSuggestion: `Ensure (${sx}, ${sy}) on z=${z - 1} has matching stairs, ladder, floor, or open air.`
                  });
                }
              }
            }
          }
        }
      }
    }
  }

  return errors;
}
