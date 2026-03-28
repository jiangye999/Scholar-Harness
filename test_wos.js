const fs = require('fs');

// 读取示例WoS文件内容
const content = `FN Clarivate Analytics Web of Science
VR 1.0
PT J
TI Effects of nitrogen fertilizer on N2O emissions from
   agricultural soils: A meta-analysis
AU Smith, John
AU Johnson, Mary
PY 2023
SO Journal of Environmental Science
ER

PT J
TI Climate change impacts on crop production
AU Zhang, Wei
PY 2024
SO Nature Climate Change
ER`;

function parseLiteratureToStructured(content) {
  const papers = [];
  
  const separators = [/^ER\s*$/m];
  let entries = [];
  
  for (const sep of separators) {
    if (content.match(sep)) {
      entries = content.split(sep);
      break;
    }
  }
  
  console.log(`Found ${entries.length} entries`);
  
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
    const entry = entries[entryIndex];
    if (!entry.trim() || entry.length < 20) continue;
    
    console.log(`\n--- Entry ${entryIndex} ---`);
    console.log('Entry preview:', entry.slice(0, 200));
    
    const lines = entry.split('\n');
    let title = '';
    
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      const trimmed = line.trim();
      
      if (trimmed.startsWith('TI ')) {
        console.log('Found TI line:', line);
        title = trimmed.replace(/^(TI|T1)\s*-?\s*/, '').trim();
        console.log('Initial title:', title);
        
        let j = lineIndex + 1;
        console.log('Checking continuation lines from:', j);
        
        while (j < lines.length) {
          const nextLine = lines[j];
          const isContinuation = nextLine.match(/^   \S/);
          console.log(`Line ${j}: "${nextLine}" - isContinuation: ${isContinuation ? 'YES' : 'NO'}`);
          
          if (isContinuation) {
            title += ' ' + nextLine.trim();
            j++;
          } else {
            break;
          }
        }
        
        lineIndex = j - 1;
        console.log('Final title:', title);
      }
    }
    
    if (title) {
      papers.push({ title });
    }
  }
  
  return papers;
}

const papers = parseLiteratureToStructured(content);
console.log('\n\n=== Final Results ===');
papers.forEach((p, i) => {
  console.log(`Paper ${i + 1}: ${p.title}`);
});
