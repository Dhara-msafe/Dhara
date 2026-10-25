// babel.config.js
// IMPORTANT: Do not remove — this file is required to fix the Expo web build.
//
// Root cause: Zustand 5.x ships an ESM build (esm/middleware.mjs) that uses
// `import.meta.env.MODE` (a Vite-specific pattern).  Metro 0.83+ resolves
// zustand/middleware to the ESM file for the web platform via package-exports
// "import" condition.  When Metro bundles the file as a plain script (no
// type="module"), the browser throws:
//   "Cannot use 'import.meta' outside a module"
//
// Fix: the inline plugin below rewrites every `import.meta` occurrence to an
// object `({env: process.env})` at Babel-transform time, so:
//   import.meta.env          → process.env
//   import.meta.env.MODE     → process.env.MODE  (= process.env.NODE_ENV)
// This is semantically equivalent for the production/development check that
// zustand uses and has no effect on any other part of the application.

module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Transform import.meta → ({env: process.env}) for Metro/web compatibility
      function transformImportMetaEnv({ types: t }) {
        return {
          name: 'transform-import-meta-env',
          visitor: {
            MetaProperty(path) {
              if (
                t.isIdentifier(path.node.meta, { name: 'import' }) &&
                t.isIdentifier(path.node.property, { name: 'meta' })
              ) {
                // Replace import.meta with ({env: process.env})
                // so that import.meta.env.MODE becomes process.env.MODE
                path.replaceWith(
                  t.objectExpression([
                    t.objectProperty(
                      t.identifier('env'),
                      t.memberExpression(
                        t.identifier('process'),
                        t.identifier('env')
                      )
                    ),
                  ])
                );
              }
            },
          },
        };
      },
    ],
  };
};
