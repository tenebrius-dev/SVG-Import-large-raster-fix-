import { JSDOM } from 'jsdom';

const svg = `
<svg>
  <g id="Layer_1">
    <g>
      <defs>
        <clipPath id="clip"><rect width="10" height="10"/></clipPath>
      </defs>
      <rect />
    </g>
  </g>
</svg>
`;

const dom = new JSDOM(svg, { contentType: 'image/svg+xml' });
const doc = dom.window.document;

const groups = Array.from(doc.querySelectorAll('g')).reverse();

groups.forEach((g) => {
  // We want to count graphics children
  const graphicsTags = ['g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'image', 'use'];
  const graphicsChildren = Array.from(g.children).filter(c => graphicsTags.includes(c.tagName.toLowerCase()));
  
  if (graphicsChildren.length === 1) {
    const child = graphicsChildren[0]!;
    
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
      
      // Move ALL nodes (including text, defs, etc) out of the group
      while (g.firstChild) {
        g.parentNode?.insertBefore(g.firstChild, g);
      }
      g.remove();
    }
  } else if (graphicsChildren.length === 0) {
    // If no graphics children, but maybe defs?
    // Move defs out, then remove
    while (g.firstChild) {
      g.parentNode?.insertBefore(g.firstChild, g);
    }
    g.remove();
  }
});

console.log(doc.documentElement.outerHTML);
