# Archived Asset Set — RLTiles 64×64 Isometric Pack

- **Source:** Dungeon Crawl X11 (`rltiles-pack` via OpenGameArt: https://opengameart.org/content/64x64-isometric-roguelike-tiles)
- **License:** Public Domain (`attribution.txt`) — artists listed at http://rltiles.sourceforge.net/author.html (`http://rltiles.sf.net`)
- **Format:** 26 PNG spritesheets (`64×64` px **isometric** tiles: `1` `1024×768` sheet + `25` `512×192` biome/wall sheets in `sheets/`)
- **Why Archived:** The active engine uses an orthogonal square `32×32` `ROT.Display` tile renderer, where 45-degree diamond isometric wall/floor tiles leave triangular corner gaps and cannot tile seamlessly alongside orthogonal entities/effects. Meanwhile, the orthogonal `32×32` `RLTiles` descendants are packed natively inside [`public/data/sprite_packs/dcss/`](../../../public/data/sprite_packs/dcss/). Retained here for future isometric camera/renderer exploration.
