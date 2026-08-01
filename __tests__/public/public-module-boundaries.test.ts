import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const publicDir = path.resolve(process.cwd(), 'src/public');
const indexHtml = readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const appSource = readPublicAppSource();

describe('public application module boundaries', () => {
  const expectedModules = [
    'app-core',
    'shell-navigation',
    'chat-backgrounds',
    'chat-context',
    'writing-workspace',
    'experiment-composer',
    'settings-runtime',
    'skill-config',
    'provider-config',
    'content-tools',
    'memory-management',
    'project-runtime',
    'feature-state',
    'academic-workflows',
    'embedding-library',
    'bibliometrics',
    'pdf-wiki-core',
    'meta-analysis',
    'pdf-wiki-workspace',
    'auto-research',
    'chat-history',
    'pdf-wiki-upload',
    'chat',
    'analysis-tools'
  ];

  it('loads the runtime and feature modules in deterministic document order', () => {
    const moduleSources = [
      '/app/module-runtime.js',
      '/app/app-core.js',
      '/app/shell-navigation.js',
      '/app/chat-backgrounds.js',
      '/app/chat-context.js',
      '/app/writing-workspace.js',
      '/app/experiment-composer.js',
      '/app/settings-runtime.js',
      '/app/skill-config.js',
      '/app/provider-config.js',
      '/app/content-tools.js',
      '/app/memory-management.js',
      '/app/project-runtime.js',
      '/app/feature-state.js',
      '/app/academic-workflows.js',
      '/embedding-library.js',
      '/bibliometrics.js',
      '/app/pdf-wiki-core.js',
      '/app/meta-analysis.js',
      '/app/pdf-wiki-workspace.js',
      '/app/auto-research.js',
      '/app/chat-history.js',
      '/app/pdf-wiki-upload.js',
      '/app/chat.js',
      '/app/analysis-tools.js'
    ];
    const offsets = moduleSources.map((source) => indexHtml.indexOf(`src="${source}`));

    offsets.forEach((offset) => expect(offset).toBeGreaterThan(-1));
    expect(offsets).toEqual(offsets.slice().sort((left, right) => left - right));
  });

  it('loads modular stylesheets in their original cascade order', () => {
    const stylesheetSources = [
      '/styles/core.css',
      '/styles/shell-layout.css',
      '/styles/experiment-upload.css',
      '/styles/chat-composer.css',
      '/styles/popovers.css',
      '/styles/compatibility.css',
      '/styles/responsive.css'
    ];
    const offsets = stylesheetSources.map((source) => indexHtml.indexOf(`href="${source}`));

    offsets.forEach((offset) => expect(offset).toBeGreaterThan(-1));
    expect(offsets).toEqual(offsets.slice().sort((left, right) => left - right));
    expect(indexHtml).not.toContain('<style>');
  });

  it('registers every extracted feature boundary for diagnostics', () => {
    expectedModules.forEach((moduleName) => {
      expect(appSource).toContain(`ScholarHarnessModules.register('${moduleName}'`);
    });
  });

  it('keeps the established public entry points available in expanded source', () => {
    expect(appSource).toContain('window.showPdfWikiViewer = async function(options)');
    expect(appSource).toContain('window.showPdfWikiMetaDatabase = async function(options)');
    expect(appSource).toContain('async function sendMessage(queuedItem, sendOptions)');
    expect(appSource).toContain('window.showBibliometricsDialog = async function(options)');
  });
});
