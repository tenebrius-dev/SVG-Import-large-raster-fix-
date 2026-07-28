const { JSDOM } = require('jsdom');
const dom = new JSDOM();
const parser = new dom.window.DOMParser();
const svg = `<svg><g clipPath="url(#myclip)"></g><g clip-path="url(#myclip2)"></g></svg>`;
const doc = parser.parseFromString(svg, "image/svg+xml");
console.log("clipPath:", doc.querySelectorAll('[clipPath]').length);
console.log("clip-path:", doc.querySelectorAll('[clip-path]').length);
// Check if getAttribute works case-insensitively?
const g1 = doc.querySelectorAll('g')[0];
console.log("getAttribute clipPath:", g1.getAttribute('clipPath'));
console.log("getAttribute clip-path:", g1.getAttribute('clip-path'));
