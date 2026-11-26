import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { createSetAutomapNoteAction, createToggleAutomapAction } from '../../../actions/core.actions.ts';
import { getComponent } from '../../../core/ecs.ts';
import { queuePlayerIntent } from '../../../core/game-loop.ts';
import { PresentationDomain } from '../../../core/presentation_queue.ts';
import { getDebugModeEnabled } from '../../../core/settings.ts';
import type { AutomapHitResult3D } from '../../../types/automap3d.types.ts';
import { ComponentType, type PositionComponent } from '../../../types/components.types.ts';
import { UIMode } from '../../../types/game-state.types.ts';
import { buildLiveGameAutomapScene3D } from '../../automap3d/automap3d_scene.ts';
import { useUiSelector } from '../core/ui_store.ts';
import { Button } from '../primitives/Button.tsx';
import { Checkbox, FormField, TextInput } from '../primitives/FormControls.tsx';
import { ModalShell } from '../primitives/ModalShell.tsx';
import { Automap3DViewport } from '../primitives/Automap3DViewport.tsx';

/**
 * In-game Daggerfall-style interactive 3D dungeon automap modal (`UIMode.Automap`, `M`).
 * Enforces explored-tile fog-of-war (with an optional God-Mode reveal toggle) and supports
 * click-to-pin persistent custom player notes across Z-levels.
 */
export function Automap3DModal(): JSX.Element | null {
  const state = useUiSelector((s) => s.gameState);
  const modalsVer = useUiSelector((s) => s.domainVersions[PresentationDomain.Modals]);
  const mapVer = useUiSelector((s) => s.domainVersions[PresentationDomain.Map]);
  const settingsVer = useUiSelector((s) => s.settingsVersion);
  void modalsVer;
  void mapVer;
  void settingsVer;

  const [revealUnexplored, setRevealUnexplored] = useState<boolean>(false);
  const [selectedHit, setSelectedHit] = useState<AutomapHitResult3D | null>(null);
  const [noteDraft, setNoteDraft] = useState<string>('');

  const isOpen = state !== null && state.uiMode === UIMode.Automap;

  const playerId = useMemo(() => {
    if (!state) return undefined;
    return state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  }, [state]);

  const debugModeEnabled = getDebugModeEnabled();
  const isGodMode = useMemo(() => {
    if (!state || playerId === undefined) return false;
    return getComponent(state, playerId, ComponentType.GodMode) !== undefined || state.map.isFullyExplored === true;
  }, [state, playerId]);
  const canOmniscientReveal = debugModeEnabled && isGodMode;

  const playerPos = useMemo(() => {
    if (!state || playerId === undefined) return undefined;
    return getComponent(state, playerId, ComponentType.Position) as PositionComponent | undefined;
  }, [state, playerId]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedHit(null);
      setNoteDraft('');
    }
  }, [isOpen]);

  const scene = useMemo(() => {
    if (!state || !isOpen) return null;
    return buildLiveGameAutomapScene3D(state, canOmniscientReveal && revealUnexplored);
  }, [state, isOpen, canOmniscientReveal, revealUnexplored]);

  if (!state || !isOpen || !scene || playerId === undefined) {
    return null;
  }

  const areaDef = state.campaign.areas[state.currentAreaId];
  const areaName = areaDef?.name ?? state.currentAreaId;
  const playerZ = playerPos?.z ?? 0;

  const activeTargetCoord =
    selectedHit?.kind === 'voxel' && selectedHit.voxel
      ? { x: selectedHit.voxel.x, y: selectedHit.voxel.y, z: selectedHit.voxel.z }
      : selectedHit?.kind === 'beacon' && selectedHit.beacon
        ? { x: selectedHit.beacon.x, y: selectedHit.beacon.y, z: selectedHit.beacon.z }
        : playerPos
          ? { x: playerPos.x, y: playerPos.y, z: playerZ }
          : null;

  const areaNotes = (state.automapNotes ?? []).filter((n) => n.areaId === state.currentAreaId);
  const existingNoteAtTarget = activeTargetCoord
    ? areaNotes.find((n) => n.x === activeTargetCoord.x && n.y === activeTargetCoord.y && n.z === activeTargetCoord.z)
    : undefined;

  const handleClose = (): void => {
    queuePlayerIntent(createToggleAutomapAction(playerId));
  };

  const handleSelectHit = (hit: AutomapHitResult3D | null): void => {
    setSelectedHit(hit);
    if (!hit) return;
    const coord = hit.voxel ?? hit.beacon;
    if (!coord) return;
    const matched = areaNotes.find((n) => n.x === coord.x && n.y === coord.y && n.z === coord.z);
    setNoteDraft(matched?.label ?? '');
  };

  const handleSaveNote = (): void => {
    if (!activeTargetCoord) return;
    queuePlayerIntent(
      createSetAutomapNoteAction(
        playerId,
        state.currentAreaId,
        activeTargetCoord.x,
        activeTargetCoord.y,
        activeTargetCoord.z,
        noteDraft
      )
    );
  };

  return (
    <ModalShell
      title="3D Dungeon Automap"
      subtitle={`${areaName} · Player Elevation Z:${playerZ}`}
      size="xl"
      onClose={handleClose}
      headerActions={
        canOmniscientReveal ? (
          <Checkbox
            id="automap3d-god-reveal"
            label="Reveal Unexplored (Omniscient)"
            checked={revealUnexplored}
            onChange={setRevealUnexplored}
          />
        ) : undefined
      }
      footer={
        <Button variant="primary" size="sm" onClick={handleClose}>
          Close (Esc / M)
        </Button>
      }
    >
      <Automap3DViewport
        scene={scene}
        initialActiveZ={playerZ}
        heightPx={500}
        onSelectVoxel={handleSelectHit}
        dataTestId="ingame-automap3d-viewport"
        extraInspector={
          <section className="ui-automap3d__card" data-testid="automap3d-notes-card">
            <h4 className="ui-automap3d__card-title">Custom Map Notes</h4>
            {activeTargetCoord ? (
              <>
                <span className="ui-editor-muted ui-tabular">
                  Target: ({activeTargetCoord.x}, {activeTargetCoord.y}, Z:{activeTargetCoord.z})
                </span>
                <FormField label="Pin Label">
                  <TextInput
                    id="automap3d-note-input"
                    value={noteDraft}
                    placeholder="e.g. Locked Crypt Door"
                    onInput={setNoteDraft}
                  />
                </FormField>
                <div className="ui-automap3d__group">
                  <Button size="sm" variant="primary" disabled={noteDraft.trim().length === 0} onClick={handleSaveNote}>
                    {existingNoteAtTarget ? 'Update Note' : 'Pin Note'}
                  </Button>
                  {existingNoteAtTarget ? (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={(): void => {
                        setNoteDraft('');
                        queuePlayerIntent(
                          createSetAutomapNoteAction(
                            playerId,
                            state.currentAreaId,
                            activeTargetCoord.x,
                            activeTargetCoord.y,
                            activeTargetCoord.z,
                            null
                          )
                        );
                      }}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              </>
            ) : null}

            {areaNotes.length > 0 ? (
              <div className="ui-automap3d__note-list">
                {areaNotes.map((note) => (
                  <div key={note.id} className="ui-automap3d__note-row">
                    <span>
                      <strong>{note.label}</strong>{' '}
                      <span className="ui-editor-muted ui-tabular">
                        ({note.x},{note.y},Z:{note.z})
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(): void =>
                        queuePlayerIntent(
                          createSetAutomapNoteAction(playerId, note.areaId, note.x, note.y, note.z, null)
                        )
                      }
                    >
                      ✕
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <span className="ui-editor-muted">No notes pinned in this area yet.</span>
            )}
          </section>
        }
      />
    </ModalShell>
  );
}
