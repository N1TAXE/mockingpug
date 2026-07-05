// Option A from mockingpug/react's README — the Vite plugin scans mock/api/**
// and mock/data/** at build/dev time and exposes the already-parsed result
// as a virtual module, so there's no per-entity import list to maintain.
import { schemas, customDictionaries } from 'virtual:mockingpug/schemas';
export { schemas, customDictionaries };
