const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'docs', 'MILESTONES.md');
let content = fs.readFileSync(filePath, 'utf-8');

// 1. Shift internal M-references inside Phase 7-10 text first
// We only want to shift M42 to M67 up by 2
// To avoid double-shifting, we go backwards from 67 down to 42
for (let i = 67; i >= 42; i--) {
  const newNum = i + 2;
  // Regex to match exact M42, M43 etc without matching M420 or similar
  const regex = new RegExp(`M${i}(?!\\d)`, 'g');
  content = content.replace(regex, `M${newNum}`);
}

// Do the same for the Milestone XX: headers
for (let i = 67; i >= 42; i--) {
  const newNum = i + 2;
  const regex = new RegExp(`Milestone ${i}(?!\\d)`, 'g');
  content = content.replace(regex, `Milestone ${newNum}`);
}

// 2. Insert the new milestones right after Milestone 41
const newMilestones = `
## 🟢 Milestone 42: "Hot Path" Dijkstra Mapping & Spawning
Use distance maps to guarantee procedural pacing and solvability.
- [ ] Implement Dijkstra maps to score area topology.
- [ ] Ensure boss objectives and high-tier loot are placed mathematically furthest from the entry portal.
- [ ] Create tools for the Encounter Director to use distance as a spawning budget modifier.

## 🟢 Milestone 43: Advanced Biome Algorithms (DLA/Voronoi)
Expand the world generator with algorithms that produce more organic, sprawling terrain.
- [ ] Implement Diffusion Limited Aggregation (DLA) for realistic cave networks.
- [ ] Implement Voronoi diagrams for clustered sub-biomes (e.g., fungal patches, structured camps).
- [ ] Expose these algorithms as new options in the Area Editor alongside BSP and Cellular.
`;

// Find the end of M41 section (which is right before "---" and "# 🚀 Phase 7")
const insertPointMarker = "---" + "\n" + "\n" + "# 🚀 Phase 7";
const insertPoint = content.indexOf(insertPointMarker);

if (insertPoint !== -1) {
  content = content.slice(0, insertPoint) + newMilestones + "\n" + content.slice(insertPoint);
  fs.writeFileSync(filePath, content, 'utf-8');
  console.log('Successfully updated MILESTONES.md');
} else {
  console.error('Could not find insertion point for new milestones');
}
