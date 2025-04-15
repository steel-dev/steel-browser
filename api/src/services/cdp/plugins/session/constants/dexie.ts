// These would normally contain the full minified Dexie code
// For brevity we'll just define placeholders that will fetch from CDN at runtime

export const dexieCore = `
  // This would be replaced with the actual Dexie core library
  // For now we'll dynamically load it from CDN 
  if (!window.Dexie) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/dexie@3.2.3/dist/dexie.min.js';
      script.onload = () => resolve(window.Dexie);
      script.onerror = () => reject(new Error('Failed to load Dexie'));
      document.head.appendChild(script);
    });
  }
`;

export const dexieExportImport = `
  // This would be replaced with the actual Dexie export/import addon
  // For now we'll dynamically load it from CDN
  if (!window.Dexie.export) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/dexie-export-import@1.0.3/dist/dexie-export-import.min.js';
      script.onload = () => resolve(window.Dexie);
      script.onerror = () => reject(new Error('Failed to load Dexie Export/Import'));
      document.head.appendChild(script);
    });
  }
`;
