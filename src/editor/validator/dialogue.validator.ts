import type { CampaignData } from '../../types/campaign.types.ts';
import type { ValidationError } from './validator.types.ts';

/**
 * Validates dialogue trees and their internal references.
 */
export async function validateDialogues(campaign: Readonly<CampaignData>): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];

  if (!campaign.dialogues) return errors;

  for (const [dlgId, dlg] of Object.entries(campaign.dialogues)) {
    if (!dlg) continue;

    const nodes = dlg.nodes || {};

    // Check startNodeId
    if (dlg.startNodeId && !nodes[dlg.startNodeId]) {
      errors.push({
        severity: 'error',
        path: `/dialogues/${dlgId}/startNodeId`,
        message: `Dialogue startNodeId '${dlg.startNodeId}' does not exist inside nodes map.`
      });
    }

    for (const [nodeId, node] of Object.entries(nodes)) {
      if (!node) continue;

      const options = node.options || [];

      for (let oIdx = 0; oIdx < options.length; oIdx++) {
        const opt = options[oIdx];
        if (!opt) continue;

        // 1. Check nextNodeId
        if (opt.nextNodeId && !nodes[opt.nextNodeId]) {
          errors.push({
            severity: 'error',
            path: `/dialogues/${dlgId}/nodes/${nodeId}/options/${oIdx}/nextNodeId`,
            message: `Option '${opt.id}' references non-existent nextNodeId '${opt.nextNodeId}'.`
          });
        }

        // 2. Check Consequence Template Mapping
        if (opt.consequences) {
          for (let cIdx = 0; cIdx < opt.consequences.length; cIdx++) {
            const cons = opt.consequences[cIdx];
            if (!cons) continue;

            if (cons.type === 'spawn_entity' && cons.entityTemplateId) {
              const entityExists = campaign.entities?.[cons.entityTemplateId] !== undefined;
              if (!entityExists) {
                errors.push({
                  severity: 'error',
                  path: `/dialogues/${dlgId}/nodes/${nodeId}/options/${oIdx}/consequences/${cIdx}`,
                  message: `Consequence 'spawn_entity' references non-existent entity ID '${cons.entityTemplateId}' (Is it an Item ID by mistake?).`
                });
              }
            }
          }
        }
      }
    }
  }

  return errors;
}
