// Option B from mockingpug/react's README — CRA/webpack has no auto-discovery
// plugin (that's mockingpug/vite, Vite-only), so schemas are wired up with
// one static import per entity file + the same parseEntitySchema() the CLI
// and Vite plugin use internally.
import { parseEntitySchema } from 'mockingpug';

import userRaw from '../mock/api/user/schema.json';
import blogpostRaw from '../mock/api/blogpost/schema.json';
import roleDictionary from '../mock/data/role.json';

export const customDictionaries = { role: roleDictionary };

const knownCustomTypes = Object.keys(customDictionaries);

export const schemas = {
  user: parseEntitySchema('user', 'src/mock/api/user/schema.json', userRaw, knownCustomTypes),
  blogpost: parseEntitySchema('blogpost', 'src/mock/api/blogpost/schema.json', blogpostRaw, knownCustomTypes),
};
