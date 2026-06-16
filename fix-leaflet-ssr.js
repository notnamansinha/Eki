const fs = require('fs');
const path = require('path');

function processDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      processDir(fullPath);
    } else if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes('import L from "leaflet";')) {
        console.log('Fixing', fullPath);
        
        // Replace import L from "leaflet";
        content = content.replace('import L from "leaflet";', 'let L: any;\nif (typeof window !== "undefined") {\n  L = require("leaflet");\n}');
        
        // Wrap the delete and mergeOptions in window check if they exist globally
        // We'll just replace the specific block if it exists
        const regex = /delete\s+\(L\.Icon\.Default\.prototype\s+as\s+any\)\._getIconUrl;\s*L\.Icon\.Default\.mergeOptions\(\{[\s\S]*?\}\);/g;
        content = content.replace(regex, (match) => {
          return `if (typeof window !== "undefined" && L) {\n  ${match}\n}`;
        });
        
        fs.writeFileSync(fullPath, content);
      }
    }
  }
}

processDir(path.join(__dirname, 'frontend/src'));
console.log('Done');
