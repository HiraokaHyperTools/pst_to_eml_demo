const fs = require('fs');
const path = require('path');

fs.copyFileSync(
  path.resolve(__dirname, 'public', 'demo.html'),
  path.resolve(__dirname, 'docs', 'demo.html')
);
