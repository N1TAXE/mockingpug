// dir points inside src/ (not the project root) because CRA/webpack refuses
// to bundle imports that reach outside src/ — see react/README.md's "CRA /
// webpack gotcha" under Option B. This file itself is only read by
// `npx mpug doctor` (a Node CLI process, not bundled), so it could
// point anywhere on disk — it points at src/mock only to stay consistent
// with the runtime import path in src/mocks/schemas.ts.
module.exports = {
  dir: 'src/mock',
  seed: 'react-cra-example',
};
