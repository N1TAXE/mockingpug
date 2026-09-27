import { appIdentity } from '../cloud/appIdentity.js';
import { cloudAdvice } from '../cloud/advice.js';
import { CloudError, getProject, pushProject } from '../cloud/client.js';
import { collectLocalSnapshot } from '../cloud/localSnapshot.js';
import { resolveToken, writeLinkFile } from '../cloud/config.js';
import { asCommandFailure, fail, ok, type CommandResult } from '../commandResult.js';
import { pull } from './pull.js';

export interface LinkOptions {
  /** Link without uploading local mocks, even if some exist (then `pull --yes` mirrors cloud down). */
  noPush?: boolean;
}

/**
 * Links this folder to a cloud project and does the right one-time sync:
 * - local mocks present → **push** them into the project's draft (cloud merges;
 *   nothing published — the user Publishes in the editor, then `pull`);
 * - no local mocks → **pull** the published version straight down (a fresh
 *   mirror); nothing published yet → just link;
 * - `--no-push` → link only, leaving the sync to a later `pull --yes`.
 *
 * Writes `.mockingpug/project.json` (committed; the token stays in user config
 * / env). Re-linking an already-linked folder just re-runs this — push is a
 * merge, so it's idempotent enough.
 */
export async function link(projectDir: string, projectId: string | undefined, options: LinkOptions = {}): Promise<CommandResult> {
  if (!projectId) return fail(['usage: mockingpug link <projectId>']);

  const token = await resolveToken();
  if (!token) return fail(['not signed in — run "mockingpug login" (or set MOCKINGPUG_TOKEN)']);

  try {
    const project = await getProject(projectId, token);
    const snapshot = await collectLocalSnapshot(projectDir);

    // Local mocks + push allowed → upload to the draft, don't pull over local.
    if (snapshot.hasLocal && !options.noPush) {
      const headers = await appIdentity(projectDir);
      const push = await pushProject(projectId, token, headers, snapshot.payload);
      await writeLinkFile(projectDir, { projectId: project.id });
      const messages = [
        `linked to "${project.name}" (${project.id}) — wrote .mockingpug/project.json (commit it)`,
        `pushed local mocks to the draft${push.draft?.summary ? `: ${push.draft.summary}` : ''}`,
      ];
      if (push.draft?.issues) messages.push(`draft has ${push.draft.issues} validation issue(s) to fix in the editor`);
      if (push.project.url) messages.push(`open ${push.project.url}`);
      messages.push('Publish there, then run "mockingpug pull" to mirror it back');
      return ok(messages);
    }

    await writeLinkFile(projectDir, { projectId: project.id });

    if (options.noPush) {
      return ok([`linked to "${project.name}" (${project.id}) — wrote .mockingpug/project.json`, 'run "mockingpug pull --yes" to mirror the cloud schema over local files']);
    }
    if (project.latestVersion === null) {
      return ok([`linked to "${project.name}" (${project.id}) — wrote .mockingpug/project.json`, 'nothing published yet — build the schema in cloud, then run "mockingpug pull"']);
    }

    // No local mocks → mirror the published version straight down (no overwrites/removals to gate).
    const pulled = await pull(projectDir, {});
    return { ok: pulled.ok, messages: [`linked to "${project.name}" (${project.id})`, ...pulled.messages], warnings: pulled.warnings };
  } catch (error) {
    if (error instanceof CloudError) return fail([cloudAdvice(error)]);
    return asCommandFailure(error);
  }
}
