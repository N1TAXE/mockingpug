// Option B from mockingpug/react's README — CRA/webpack has no auto-discovery
// plugin (that's mockingpug/vite, Vite-only), so schemas are wired up with
// one static import per entity file + the same parseEntitySchema() the CLI
// and Vite plugin use internally.
import { parseEntitySchema, type Route } from 'mockingpug';

import userRaw from '../mock/tables/user.json';
import blogpostRaw from '../mock/tables/blogpost.json';
import userRoutes from '../mock/routes/user.json';
import roleDictionary from '../mock/data/role.json';

export const customDictionaries = { role: roleDictionary };

const knownCustomTypes = Object.keys(customDictionaries);

// `blogpost` has no route → an internal table: generated and used in relations
// (`user.posts`, `blogpost.author`), but with no URL of its own.
export const schemas = {
  user: parseEntitySchema('user', 'src/mock/tables/user.json', userRaw, knownCustomTypes),
  blogpost: parseEntitySchema('blogpost', 'src/mock/tables/blogpost.json', blogpostRaw, knownCustomTypes),
};

export const routes = userRoutes as Route[];
