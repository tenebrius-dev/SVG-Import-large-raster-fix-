const fs = require('fs');
const { JSDOM } = require('jsdom');
const { optimizeSVGDocument } = require('./dist/ui.js'); // Wait, we can't easily require UI code in node because it's bundled for browser.
