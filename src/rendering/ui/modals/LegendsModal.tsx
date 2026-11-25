import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { createToggleLegendsAction } from '../../../actions/core.actions.ts';
import { MACRO_BIOME_GLYPHS, MACRO_SITE_STATUS_GLYPHS } from '../../../constants/macro_world.constants.ts';
import { getComponent } from '../../../core/ecs.ts';
import { queuePlayerIntent } from '../../../core/game-loop.ts';
import { PresentationDomain } from '../../../core/presentation_queue.ts';
import { readSeasonalCalendar } from '../../../systems/world_clock.system.ts';
import { ComponentType } from '../../../types/components.types.ts';
import { UIMode } from '../../../types/game-state.types.ts';
import type {
  HistoricalArtifactRecord,
  HistoricalFigureRecord,
  LegendsEventRecord,
  MacroSiteRecord,
  MacroSiteStatus
} from '../../../types/macro_world.types.ts';
import { useUiSelector } from '../core/ui_store.ts';
import { Button } from '../primitives/Button.tsx';
import { Badge, type BadgeTone } from '../primitives/DataDisplay.tsx';
import { TextInput } from '../primitives/FormControls.tsx';
import { ListBox, type ListBoxItem } from '../primitives/ListBox.tsx';
import { ModalShell } from '../primitives/ModalShell.tsx';
import { Panel, SplitPane } from '../primitives/Panel.tsx';
import { Tabs, type TabItem } from '../primitives/Tabs.tsx';

type LegendsTabId = 'map' | 'figures' | 'sites' | 'artifacts' | 'chronicle';

const LEGENDS_TABS: ReadonlyArray<TabItem> = [
  { id: 'map', label: 'World Map & Eras', icon: '🗺️' },
  { id: 'figures', label: 'Historical Figures', icon: '👑' },
  { id: 'sites', label: 'Sites & Civilizations', icon: '🏰' },
  { id: 'artifacts', label: 'Artifacts & Relics', icon: '⚔️' },
  { id: 'chronicle', label: 'World Chronicle', icon: '📜' }
];

function siteStatusTone(status: MacroSiteStatus): BadgeTone {
  switch (status) {
    case 'intact':
      return 'success';
    case 'besieged':
    case 'raided':
      return 'warning';
    case 'burned':
    case 'ruined':
      return 'danger';
    case 'abandoned':
      return 'neutral';
  }
}

/**
 * Accessible 5-tab Preact World Legends & Ring 2 Macro-World browser modal built on shared UI primitives.
 * Displays continental geography, active caravans/armies/weather fronts, multi-century dynasties,
 * forged relic provenances, and filterable chronicle history.
 */
export function LegendsModal(): JSX.Element | null {
  const state = useUiSelector((s) => s.gameState);
  const modalsVer = useUiSelector((s) => s.domainVersions[PresentationDomain.Modals]);
  void modalsVer;

  const [activeTab, setActiveTab] = useState<LegendsTabId>('map');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedEraFilter, setSelectedEraFilter] = useState<string>('all');
  const [selectedFigureId, setSelectedFigureId] = useState<string | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);

  if (!state || state.uiMode !== UIMode.Legends) {
    return null;
  }

  const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (playerId === undefined) return null;

  const handleClose = (): void => {
    queuePlayerIntent(createToggleLegendsAction(playerId));
  };

  const macro = state.macroWorld;
  const calendar = readSeasonalCalendar(state);

  if (!macro) {
    return (
      <ModalShell
        title="World Legends & Chronicle"
        subtitle="Macro-world simulation is not enabled for this campaign"
        size="lg"
        fullHeight
        onClose={handleClose}
        footer={
          <Button variant="primary" size="sm" onClick={handleClose}>
            Close
          </Button>
        }
      >
        <Panel title="Local World History Only">
          <p className="ui-field__hint">
            This campaign runs without a continental macro-world layer. You can inspect local major events in the World
            Ledger (Shift+L) or configure <code>rules.macroWorld.enabled = true</code> in campaign data.
          </p>
        </Panel>
      </ModalShell>
    );
  }

  const query = searchQuery.trim().toLowerCase();
  const siteList: ReadonlyArray<MacroSiteRecord> = Object.values(macro.sites);
  const figureList: ReadonlyArray<HistoricalFigureRecord> = Object.values(macro.legends.figures);
  const artifactList: ReadonlyArray<HistoricalArtifactRecord> = Object.values(macro.legends.artifacts);
  const caravans = Object.values(macro.caravans);
  const armies = Object.values(macro.armies);

  const filteredFigures = figureList.filter(
    (f) =>
      query.length === 0 ||
      f.name.toLowerCase().includes(query) ||
      (f.epithet ?? '').toLowerCase().includes(query) ||
      f.factionId.toLowerCase().includes(query) ||
      f.dynastyId.toLowerCase().includes(query)
  );
  const effectiveFigure = filteredFigures.find((f) => f.id === selectedFigureId) ?? filteredFigures[0] ?? figureList[0];

  const filteredSites = siteList.filter(
    (s) =>
      query.length === 0 ||
      s.name.toLowerCase().includes(query) ||
      s.archetype.toLowerCase().includes(query) ||
      s.factionId.toLowerCase().includes(query) ||
      s.status.toLowerCase().includes(query)
  );
  const effectiveSite = filteredSites.find((s) => s.id === selectedSiteId) ?? filteredSites[0] ?? siteList[0];

  const filteredArtifacts = artifactList.filter(
    (a) => query.length === 0 || a.name.toLowerCase().includes(query) || a.description.toLowerCase().includes(query)
  );
  const effectiveArtifact =
    filteredArtifacts.find((a) => a.id === selectedArtifactId) ?? filteredArtifacts[0] ?? artifactList[0];

  const filteredEvents: ReadonlyArray<LegendsEventRecord> = [...macro.legends.events].reverse().filter((evt) => {
    if (selectedEraFilter !== 'all' && evt.eraId !== selectedEraFilter) return false;
    if (query.length === 0) return true;
    return (
      evt.summary.toLowerCase().includes(query) ||
      (evt.factionId ?? '').toLowerCase().includes(query) ||
      evt.kind.toLowerCase().includes(query)
    );
  });

  const navigateToSite = (siteId: string): void => {
    setSelectedSiteId(siteId);
    setActiveTab('sites');
  };

  const navigateToFigure = (figureId: string): void => {
    setSelectedFigureId(figureId);
    setActiveTab('figures');
  };

  const renderMapGridRows = (): JSX.Element[] => {
    const { width, height, cells } = macro.continent;
    const caravanByCoord = new Map<string, string>();
    for (const c of caravans) caravanByCoord.set(`${c.x},${c.y}`, c.id);
    const armyByCoord = new Map<string, string>();
    for (const a of armies) armyByCoord.set(`${a.x},${a.y}`, a.id);

    const rows: JSX.Element[] = [];
    for (let y = 0; y < height; y++) {
      const cellsInRow: JSX.Element[] = [];
      for (let x = 0; x < width; x++) {
        const cell = cells[y * width + x];
        if (!cell) continue;
        const site = cell.siteId ? macro.sites[cell.siteId] : undefined;
        const hasArmy = armyByCoord.has(`${x},${y}`);
        const hasCaravan = caravanByCoord.has(`${x},${y}`);
        const biomeMeta = MACRO_BIOME_GLYPHS[cell.biome];

        let glyph = biomeMeta.glyph;
        let color = biomeMeta.fg;
        let title = `(${x},${y}) ${cell.biome}`;

        if (site) {
          glyph = site.isCapital && site.status === 'intact' ? '★' : MACRO_SITE_STATUS_GLYPHS[site.status];
          color =
            site.status === 'burned' || site.status === 'ruined'
              ? 'var(--ui-status-danger)'
              : 'var(--ui-accent-primary)';
          title = `${site.name} [${site.archetype} - ${site.status}] (${site.factionId})`;
        } else if (hasArmy) {
          glyph = '⚔';
          color = 'var(--ui-status-danger)';
          title = 'Active army/warband';
        } else if (hasCaravan) {
          glyph = 'c';
          color = 'var(--ui-status-warning)';
          title = 'Traveling merchant caravan';
        } else if (cell.hasRiver) {
          glyph = '≈';
          color = 'var(--ui-status-info)';
        } else if (cell.hasRoad) {
          glyph = '·';
          color = 'var(--ui-ink-muted)';
        }

        cellsInRow.push(
          <span
            key={`${x}_${y}`}
            title={title}
            role={site ? 'button' : undefined}
            tabIndex={site ? 0 : undefined}
            aria-label={site ? title : undefined}
            onClick={site ? (): void => navigateToSite(site.id) : undefined}
            onKeyDown={
              site
                ? (ev: KeyboardEvent): void => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault();
                      navigateToSite(site.id);
                    }
                  }
                : undefined
            }
            style={{
              color,
              cursor: site ? 'pointer' : 'default',
              fontWeight: site ? 700 : 400
            }}
          >
            {glyph}
          </span>
        );
      }
      rows.push(
        <div key={`row_${y}`} style={{ lineHeight: '1.1', whiteSpace: 'pre' }}>
          {cellsInRow}
        </div>
      );
    }
    return rows;
  };

  return (
    <ModalShell
      title={`${macro.legends.worldName} — World Legends`}
      subtitle={`Year ${macro.legends.simulatedYears + calendar.year}, ${calendar.season.toUpperCase()} Day ${calendar.dayOfSeason} · Ring 2 Tick ${macro.currentTick}`}
      size="xl"
      fullHeight
      onClose={handleClose}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
          <span className="ui-field__hint">
            {`${siteList.length} Sites · ${figureList.length} Figures · ${artifactList.length} Relics · ${caravans.length} Caravans · ${armies.length} Armies`}
          </span>
          <Button variant="primary" size="sm" onClick={handleClose}>
            Close
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ui-space-2)', height: '100%', minHeight: 0 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 'var(--ui-space-2)',
            flexWrap: 'wrap'
          }}
        >
          <Tabs
            tabs={LEGENDS_TABS}
            activeTabId={activeTab}
            onSelectTab={(id): void => setActiveTab(id as LegendsTabId)}
            ariaLabel="Legends Sections"
          />
          <TextInput
            type="search"
            value={searchQuery}
            onInput={setSearchQuery}
            placeholder="Filter legends, sites, factions..."
            ariaLabel="Search Legends"
          />
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {activeTab === 'map' ? (
            <SplitPane
              leftWidth="minmax(320px, 1.3fr)"
              rightWidth="1fr"
              left={
                <Panel title="Continental Geography & Ring 2 Activity">
                  <div
                    style={{
                      fontFamily: 'var(--ui-font-mono)',
                      fontSize: 'var(--ui-font-sm)',
                      padding: 'var(--ui-space-2)',
                      background: 'var(--ui-bg-canvas)',
                      border: '1px solid var(--ui-border-subtle)',
                      borderRadius: 'var(--ui-radius-sm)',
                      overflow: 'auto'
                    }}
                  >
                    {renderMapGridRows()}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      gap: 'var(--ui-space-2)',
                      flexWrap: 'wrap',
                      marginTop: 'var(--ui-space-2)'
                    }}
                  >
                    <Badge tone="info">{`Weather Fronts: ${macro.weatherFronts.length}`}</Badge>
                    {macro.weatherFronts.map((wf) => (
                      <Badge key={wf.id} tone="warning">
                        {`${wf.kind.toUpperCase()} @ (${wf.x},${wf.y})`}
                      </Badge>
                    ))}
                  </div>
                </Panel>
              }
              right={
                <Panel title="Historical Eras">
                  <div className="ui-card-stack">
                    {macro.legends.eras.map((era) => (
                      <article key={era.id} className="ui-quest-card">
                        <div className="ui-quest-card__head">
                          <h4 className="ui-quest-card__title">{era.name}</h4>
                          <Badge tone="neutral">{`Years ${era.startYear}–${era.endYear}`}</Badge>
                        </div>
                        <p className="ui-field__hint">{era.summary}</p>
                      </article>
                    ))}
                  </div>
                </Panel>
              }
            />
          ) : null}

          {activeTab === 'figures' ? (
            <SplitPane
              leftWidth="300px"
              rightWidth="1fr"
              left={
                <ListBox
                  ariaLabel="Historical Figures"
                  selectedId={effectiveFigure?.id}
                  onSelect={(id): void => setSelectedFigureId(id)}
                  items={filteredFigures.map((fig): ListBoxItem => ({
                    id: fig.id,
                    label: `${fig.name}${fig.epithet ? ` ${fig.epithet}` : ''}`,
                    subtitle: `${fig.role} · ${fig.factionId}`,
                    meta: <Badge tone={fig.isAlive ? 'success' : 'danger'}>{fig.isAlive ? 'Alive' : 'Slain'}</Badge>
                  }))}
                  emptyMessage="No matching historical figures."
                />
              }
              right={
                effectiveFigure ? (
                  <Panel
                    title={`${effectiveFigure.name}${effectiveFigure.epithet ? ` ${effectiveFigure.epithet}` : ''}`}
                  >
                    <div className="ui-card-stack">
                      <div style={{ display: 'flex', gap: 'var(--ui-space-2)', flexWrap: 'wrap' }}>
                        <Badge tone={effectiveFigure.isAlive ? 'success' : 'danger'}>
                          {effectiveFigure.isAlive ? 'Living' : `Died Year ${effectiveFigure.deathYear ?? '?'}`}
                        </Badge>
                        <Badge tone="info">{`Dynasty: ${effectiveFigure.dynastyId}`}</Badge>
                        <Badge tone="neutral">{`Kills: ${effectiveFigure.kills}`}</Badge>
                        {effectiveFigure.seededEntityId !== undefined ? (
                          <Badge tone="warning">Present in World</Badge>
                        ) : null}
                      </div>
                      <p className="ui-field__hint">
                        {`Born Year ${effectiveFigure.birthYear} · Allegiance: ${effectiveFigure.factionId} · Role: ${effectiveFigure.role}`}
                      </p>
                      {effectiveFigure.scars.length > 0 ? (
                        <div>
                          <strong>Scars:</strong> {effectiveFigure.scars.join(', ')}
                        </div>
                      ) : null}
                      <div style={{ display: 'flex', gap: 'var(--ui-space-2)', alignItems: 'center' }}>
                        <strong>Current Site:</strong>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={(): void => navigateToSite(effectiveFigure.currentSiteId)}
                        >
                          {macro.sites[effectiveFigure.currentSiteId]?.name ?? effectiveFigure.currentSiteId}
                        </Button>
                      </div>
                      <h4 className="ui-dossier-section-title">Recorded Deeds</h4>
                      {macro.legends.events
                        .filter((e) => e.figureIds.includes(effectiveFigure.id))
                        .slice(-15)
                        .reverse()
                        .map((evt) => (
                          <div key={evt.id} className="ui-ledger-entry">
                            <strong>{`Year ${evt.year} (${evt.season})`}</strong>
                            <span>{evt.summary}</span>
                          </div>
                        ))}
                    </div>
                  </Panel>
                ) : null
              }
            />
          ) : null}

          {activeTab === 'sites' ? (
            <SplitPane
              leftWidth="300px"
              rightWidth="1fr"
              left={
                <ListBox
                  ariaLabel="Macro Sites"
                  selectedId={effectiveSite?.id}
                  onSelect={(id): void => setSelectedSiteId(id)}
                  items={filteredSites.map((s): ListBoxItem => ({
                    id: s.id,
                    label: s.name,
                    subtitle: `${s.archetype} · ${s.factionId}`,
                    meta: <Badge tone={siteStatusTone(s.status)}>{s.status}</Badge>
                  }))}
                  emptyMessage="No matching sites."
                />
              }
              right={
                effectiveSite ? (
                  <Panel title={`${effectiveSite.name} (${effectiveSite.archetype})`}>
                    <div className="ui-card-stack">
                      <div style={{ display: 'flex', gap: 'var(--ui-space-2)', flexWrap: 'wrap' }}>
                        <Badge tone={siteStatusTone(effectiveSite.status)}>{effectiveSite.status.toUpperCase()}</Badge>
                        <Badge tone="info">{`Faction: ${effectiveSite.factionId}`}</Badge>
                        <Badge tone="neutral">{`Chunk (${effectiveSite.chunkX}, ${effectiveSite.chunkY})`}</Badge>
                      </div>
                      <p className="ui-field__hint">
                        {`Population: ${effectiveSite.population} · Prosperity: ${effectiveSite.prosperity}/100 · Garrison: ${effectiveSite.garrison} · Food: ${effectiveSite.foodStock}`}
                      </p>
                      {effectiveSite.residentFigureIds.length > 0 ? (
                        <div>
                          <strong>Notable Figures:</strong>
                          <div
                            style={{ display: 'flex', gap: 'var(--ui-space-1)', flexWrap: 'wrap', marginTop: '4px' }}
                          >
                            {effectiveSite.residentFigureIds.slice(0, 8).map((fid) => {
                              const fig = macro.legends.figures[fid];
                              if (!fig) return null;
                              return (
                                <Button
                                  key={fid}
                                  size="sm"
                                  variant="secondary"
                                  onClick={(): void => navigateToFigure(fid)}
                                >
                                  {fig.name}
                                </Button>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                      {effectiveSite.artifactIds.length > 0 ? (
                        <div>
                          <strong>Relics & Artifacts:</strong>{' '}
                          {effectiveSite.artifactIds.map((aid) => macro.legends.artifacts[aid]?.name ?? aid).join(', ')}
                        </div>
                      ) : null}
                      <h4 className="ui-dossier-section-title">Site History & Ring 2 Deltas</h4>
                      {macro.pendingSiteDeltas
                        .filter((d) => d.siteId === effectiveSite.id)
                        .slice(-8)
                        .reverse()
                        .map((delta) => (
                          <div key={delta.id} className="ui-ledger-entry">
                            <div style={{ display: 'flex', gap: 'var(--ui-space-2)', alignItems: 'center' }}>
                              <strong>{`Tick ${delta.tick}`}</strong>
                              <Badge tone="info">{delta.kind}</Badge>
                            </div>
                            <span>{delta.summary}</span>
                          </div>
                        ))}
                      {macro.legends.events
                        .filter((e) => e.siteId === effectiveSite.id)
                        .slice(-12)
                        .reverse()
                        .map((evt) => (
                          <div key={evt.id} className="ui-ledger-entry">
                            <strong>{`Year ${evt.year}`}</strong>
                            <span>{evt.summary}</span>
                          </div>
                        ))}
                    </div>
                  </Panel>
                ) : null
              }
            />
          ) : null}

          {activeTab === 'artifacts' ? (
            <SplitPane
              leftWidth="300px"
              rightWidth="1fr"
              left={
                <ListBox
                  ariaLabel="Historical Artifacts"
                  selectedId={effectiveArtifact?.id}
                  onSelect={(id): void => setSelectedArtifactId(id)}
                  items={filteredArtifacts.map((a): ListBoxItem => ({
                    id: a.id,
                    label: a.name,
                    subtitle: `Forged Year ${a.forgedYear}`,
                    meta: (
                      <Badge tone={a.materializedEntityId !== undefined ? 'success' : 'neutral'}>
                        {a.materializedEntityId !== undefined ? 'Materialized' : 'Hidden'}
                      </Badge>
                    )
                  }))}
                  emptyMessage="No forged relics recorded."
                />
              }
              right={
                effectiveArtifact ? (
                  <Panel title={effectiveArtifact.name}>
                    <div className="ui-card-stack">
                      <p>{effectiveArtifact.description}</p>
                      <div style={{ display: 'flex', gap: 'var(--ui-space-2)', flexWrap: 'wrap' }}>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={(): void => navigateToFigure(effectiveArtifact.creatorFigureId)}
                        >
                          {`Creator: ${macro.legends.figures[effectiveArtifact.creatorFigureId]?.name ?? effectiveArtifact.creatorFigureId}`}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={(): void => navigateToSite(effectiveArtifact.currentSiteId)}
                        >
                          {`Location: ${macro.sites[effectiveArtifact.currentSiteId]?.name ?? effectiveArtifact.currentSiteId}`}
                        </Button>
                      </div>
                    </div>
                  </Panel>
                ) : null
              }
            />
          ) : null}

          {activeTab === 'chronicle' ? (
            <Panel
              title="World Historical Chronicle"
              headerActions={
                <div style={{ display: 'flex', gap: 'var(--ui-space-1)', flexWrap: 'wrap' }}>
                  <Button
                    size="sm"
                    variant={selectedEraFilter === 'all' ? 'primary' : 'secondary'}
                    onClick={(): void => setSelectedEraFilter('all')}
                  >
                    All Eras
                  </Button>
                  {macro.legends.eras.map((era) => (
                    <Button
                      key={era.id}
                      size="sm"
                      variant={selectedEraFilter === era.id ? 'primary' : 'secondary'}
                      onClick={(): void => setSelectedEraFilter(era.id)}
                    >
                      {era.name}
                    </Button>
                  ))}
                </div>
              }
            >
              <div className="ui-card-stack">
                {filteredEvents.length === 0 ? (
                  <p className="ui-field__hint">No chronicle events match the current filter.</p>
                ) : (
                  filteredEvents.slice(0, 100).map((evt) => (
                    <div key={evt.id} className="ui-ledger-entry">
                      <div
                        style={{ display: 'flex', gap: 'var(--ui-space-2)', alignItems: 'center', flexWrap: 'wrap' }}
                      >
                        <strong>{`Year ${evt.year} (${evt.season})`}</strong>
                        <Badge
                          tone={evt.importance === 'epic' ? 'warning' : evt.importance === 'major' ? 'info' : 'neutral'}
                        >
                          {evt.kind}
                        </Badge>
                        {evt.siteId ? (
                          <Button size="sm" variant="secondary" onClick={(): void => navigateToSite(evt.siteId!)}>
                            {macro.sites[evt.siteId]?.name ?? evt.siteId}
                          </Button>
                        ) : null}
                      </div>
                      <span>{evt.summary}</span>
                    </div>
                  ))
                )}
              </div>
            </Panel>
          ) : null}
        </div>
      </div>
    </ModalShell>
  );
}
