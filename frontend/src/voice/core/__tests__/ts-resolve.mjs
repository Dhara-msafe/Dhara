// Lets `node --test` resolve extensionless TypeScript imports (as the app
// writes them) by retrying with ".ts". Test-only; not bundled into the app.
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); }
  catch (e) {
    if (specifier.startsWith('.') && !/\\.[cm]?[jt]s$/.test(specifier)) {
      return next(specifier + '.ts', context);
    }
    throw e;
  }
}`));
