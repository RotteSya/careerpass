import type { NudgeRule, ProactiveNudge, UserJobContext } from "../types";
import { portalCheckRule } from "./portalChecks";
import { statusSuggestionsRule } from "./statusSuggestions";
import { timeNudgeRules } from "./timeNudges";

const allRules: NudgeRule[] = [
  statusSuggestionsRule,
  portalCheckRule,
  ...timeNudgeRules,
];

export function evaluateAllRules(context: UserJobContext): ProactiveNudge[] {
  const nudges: ProactiveNudge[] = [];
  for (const rule of allRules) {
    try {
      nudges.push(...rule.evaluate(context));
    } catch (err) {
      console.error(`[Proactive] Rule ${rule.id} failed:`, err);
    }
  }
  return nudges;
}
