import { JSDOM } from 'jsdom';

const svg = `
<svg>
  <g id="G1">
    <g id="G2">
      <rect x="0" y="0" width="100" height="100" />
    </g>
  </g>
  <g id="G3" opacity="0.5">
    <g id="G4" opacity="0.5">
      <rect x="0" y="0" width="100" height="100" />
    </g>
  </g>
</svg>
`;

const dom = new JSDOM(svg, { contentType: 'image/svg+xml' });
const doc = dom.window.document;

const groups = Array.from(doc.querySelectorAll('g')).reverse();
console.log("Found groups:", groups.map(g => g.getAttribute('id')));

groups.forEach((g) => {
  const children = Array.from(g.children);
  if (children.length === 1) {
    const child = children[0]!;
    
    const unmergeable = ['opacity', 'clip-path', 'mask', 'filter'];
    let canUnwrap = true;
    for (const attr of unmergeable) {
      if (g.hasAttribute(attr) && child.hasAttribute(attr)) {
        canUnwrap = false;
        break;
      }
    }

    if (canUnwrap) {
      for (const attr of Array.from(g.attributes)) {
        const name = attr.name;
        const pVal = attr.value;
        const cVal = child.getAttribute(name);
        if (name === 'transform') {
          child.setAttribute('transform', cVal ? `${pVal} ${cVal}` : pVal);
        } else if (name === 'class') {
          child.setAttribute('class', cVal ? `${pVal} ${cVal}` : pVal);
        } else if (name === 'style') {
          child.setAttribute('style', cVal ? `${pVal}; ${cVal}` : pVal);
        } else if (name === 'id' || name === 'data-name') {
          if (!cVal) child.setAttribute(name, pVal);
        } else {
          if (!cVal) child.setAttribute(name, pVal);
        }
      }
      g.parentNode?.insertBefore(child, g);
      g.remove();
    }
  }
});

console.log(doc.documentElement.outerHTML);
