const esbuild = require('esbuild');

const build = async () => {
  await esbuild.build({
    entryPoints: ['src/cli.ts'],
    bundle: true,
    outfile: 'bin/cli.js',
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    minify: true,
    sourcemap: false,
    banner: {
      js: '#!/usr/bin/env node',
    },
    external: [
      // Keep external dependencies as external to reduce bundle size
      'csv-parser',
      'graphql-request',
      'commander'
    ],
  });
  
  console.log('✅ CLI bundled successfully');
};

build().catch((error) => {
  console.error('❌ Build failed:', error);
  process.exit(1);
});
