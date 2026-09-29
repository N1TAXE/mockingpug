import { appIdentity } from '../cloud/appIdentity.js';
import { cloudAdvice } from '../cloud/advice.js';
import { CloudError, getProject, pushProject } from '../cloud/client.js';
import { collectLocalSnapshot } from '../cloud/localSnapshot.js';
import { readLinkFile, resolveToken, writeLinkFile } from '../cloud/config.js';
import { asCommandFailure, fail, ok, type CommandResult } from '../commandResult.js';
import { pull } from './pull.js';

export interface LinkOptions {
  /** Link without uploading local mocks, even if some exist (then `pull --yes` mirrors cloud down). */
  noPush?: boolean;
  /** Force a push even when re-linking an already-linked folder (R29), and pass `?force=1` to override unpublished cloud edits (R30). */
  push?: boolean;
  /** Override unpublished cloud edits a push conflicts with, and skip the pre-push confirmation. */
  force?: boolean;
  /** Skip confirmations: relinking to a different project (R29), and the pre-push overwrite prompt (R30). */
  yes?: boolean;
}

/**
 * Links this folder to a cloud project and does the right one-time sync:
 * - **already linked to the same project** → does nothing destructive; suggests
 *   `pull` (or `link --push` to upload local mocks). Guards against a teammate
 *   habitually re-running `link` on a clone and overwriting cloud edits (R29).
 * - **linked to a different project** → needs `--yes` to relink.
 * - **local mocks + first link** → pushes them to the draft, after a
 *   confirmation when the cloud project isn't empty (`--yes`/`--force` skip it, R30).
 * - **no local mocks** → pulls the published version straight down.
 * - `--no-push` → link only.
 *
 * Writes `.mockingpug/project.json` (commit it; the token stays in user config/env).
 */
export async function link(projectDir: string, projectId: string | undefined, options: LinkOptions = {}): Promise<CommandResult> {
  if (!projectId) return fail(['usage: mockingpug link <projectId>']);
  if (options.push && options.noPush) return fail(['--push and --no-push cannot be used together']);

  const token = await resolveToken();
  if (!token) return fail(['not signed in — run "mockingpug login" (or set MOCKINGPUG_TOKEN)']);

  try {
    const project = await getProject(projectId, token);
    const existing = await readLinkFile(projectDir);
    const relinkSame = existing?.projectId === projectId;
    const relinkDifferent = existing !== undefined && existing.projectId !== projectId;

    // R29: relinking to a *different* project is destructive to the link file — confirm.
    if (relinkDifferent && !options.yes) {
      return fail([
        `this folder is already linked to a different project (${existing!.projectId})`,
        `re-run with "--yes" to relink it to "${project.name}" (${projectId})`,
      ]);
    }

    const snapshot = await collectLocalSnapshot(projectDir);

    // R29: re-linking the *same* project never uploads local mocks unless asked.
    if (relinkSame && !options.push) {
      await writeLinkFile(projectDir, { projectId: project.id });
      const messages = [`already linked to "${project.name}" (${project.id})`, 'run "mockingpug pull" to mirror the published schema'];
      if (snapshot.hasLocal) messages.push('to upload your local mocks to the draft, re-run with "mockingpug link --push"');
      return ok(messages);
    }

    const wantPush = snapshot.hasLocal && !options.noPush;

    if (wantPush) {
      // R30: pushing over a non-empty cloud draft replaces its tables/endpoints —
      // confirm first (the exact overwrite set comes back as a 409 if any).
      if (project.empty !== true && !options.yes && !options.force) {
        const tables = Object.keys(snapshot.payload.tables);
        const routeCount = Array.isArray(snapshot.payload.routes) ? snapshot.payload.routes.length : 0;
        return fail(
          [
            `pushing will replace the cloud draft's tables/endpoints with your local ones:`,
            `  tables: ${tables.join(', ') || '(none)'}`,
            routeCount ? `  endpoints: ${routeCount}` : '',
            `re-run with "--yes" to push, or "--force" to also override unpublished cloud edits`,
          ].filter(Boolean),
        );
      }
      const headers = await appIdentity(projectDir);
      const push = await pushProject(projectId, token, headers, snapshot.payload, options.force);
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
