// mockingpug/graphql — auto-generated GraphQL over the same schemas and store
// as the REST transport. No separate GraphQL server: the schema is derived
// from `mock/tables/**` and resolved through the same store-backed CRUD, so
// GraphQL and REST always return consistent data. Intercepted the same way —
// an MSW `POST /graphql` handler in the browser (see `createGraphQLHandler`),
// or `executeGraphQL(body, ctx)` inside a Next.js Route Handler.
//
// Requires the `graphql` package as a peer dependency (optional — only pulled
// in when you import `mockingpug/graphql`).
export { generateGraphQLSDL, buildGraphQLSchema } from './schema.js';
export { executeGraphQL, type GraphQLRequestBody } from './execute.js';
export { createGraphQLHandler, type GraphQLHandlerOptions } from './handler.js';
export type { QueryContext } from '../query/index.js';
