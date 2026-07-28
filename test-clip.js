const { DOMParser } = require('xmldom');
const doc = new DOMParser().parseFromString('<svg><g style="clip-path: url(#myclip)"></g></svg>');
console.log(doc.querySelectorAll ? "Has QSA" : "No QSA");
