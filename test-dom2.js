const { JSDOM } = require('jsdom');
const dom = new JSDOM();
const parser = new dom.window.DOMParser();
const svg = `<svg><g clipPath="url(#myclip)"></g><g clip-path="url(#myclip2)"></g></svg>`;
const doc = parser.parseFromString(svg, "image/svg+xml");
const all = Array.from(doc.querySelectorAll('[clip-path], [clipPath]'));
console.log(all.length);
