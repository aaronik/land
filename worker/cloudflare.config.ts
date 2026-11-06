import { bindings, defineConfig } from 'cf/config';

// OpenTofu creates this namespace; its ID is printed by `tofu output preview_kv_id`.
// The ID is not a credential. Keep the API token and OpenTofu state out of git.
const kvId = process.env.PREVIEW_KV_ID;

export default defineConfig({
  worker: {
    name: 'shasta-land-atlas-preview',
    entrypoint: './src/index.js',
    compatibilityDate: '2026-10-01',
    compatibilityFlags: ['nodejs_compat'],
    workersDev: true,
    observability: { enabled: true, headSamplingRate: 1, redactQueryString: true },
    env: {
      BROWSER: bindings.browser(),
      PREVIEWS: bindings.kv(kvId ? { id: kvId } : {})
    }
  }
});
