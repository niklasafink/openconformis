import { sleep } from "workflow";

import {
  deletePolicyOriginalIfDue,
  getPolicyOriginalRetentionState,
} from "@/server/maintenance/policy-original-retention";

async function retentionStateStep(policyVersionId: string) {
  "use step";
  return getPolicyOriginalRetentionState(policyVersionId);
}
retentionStateStep.maxRetries = 3;

async function deleteOriginalStep(policyVersionId: string) {
  "use step";
  return deletePolicyOriginalIfDue(policyVersionId);
}
deleteOriginalStep.maxRetries = 5;

export async function policyOriginalRetentionWorkflow(policyVersionId: string) {
  "use workflow";

  for (;;) {
    const state = await retentionStateStep(policyVersionId);
    if (state.deleted) return state;
    await sleep(new Date(state.deleteAfter));
    const result = await deleteOriginalStep(policyVersionId);
    if (result.deleted) return result;
  }
}
