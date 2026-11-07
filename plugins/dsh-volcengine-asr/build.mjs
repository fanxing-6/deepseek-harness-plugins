import { build } from 'esbuild';

await build({
  entryPoints: ['client-source.jsx'], outfile: 'client.js', bundle: true,
  format: 'cjs', platform: 'browser', target: 'chrome130',
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-store', 'zod'],
  loader: { '.worklet': 'text', '.css': 'text' },
  banner: { js: 'window.__ModuleLoader__.load({id:"@local/dsh-volcengine-asr",factory:(require)=>{const module={exports:{}};const exports=module.exports;' },
  footer: { js: 'return module.exports;}});' },
});
