/** Team label for metadata summaries: CLI flag, then env vars used by CI and local workflows. */
export function resolveMetadataSummaryTeam(cliTeam?: string): string | undefined {
  const fromFlag = cliTeam?.trim();
  if (fromFlag) return fromFlag;
  const auditTeam = process.env.METADATA_AUDIT_TEAM?.trim();
  if (auditTeam) return auditTeam;
  const sfGitAiTeam = process.env.SF_GIT_AI_TEAM?.trim();
  return sfGitAiTeam ?? undefined;
}
